"""FarmVerse simulation: GDD phenology, FAO-56 root-zone bucket, AquaCrop-style biomass and yield, game rules (pure, no I/O)."""
import copy
import datetime as dt
import json
import math
import random
import zlib

STAGES = ("emergence", "vegetative", "flowering", "grain_fill", "mature")
FORAGES = ("alfalfa", "hay", "pasture")
PRE_PLANTED = ("winter_wheat", "alfalfa", "hay", "pasture")
BARE_KC = 0.3
BARE_ROOT_M = 0.3
CCX = 0.95
PEST_THRESHOLD = 0.6
PEST_RATE = 0.025
PEST_MIN_CANOPY = 0.2
PEST_MAX_DAMAGE = 0.25
SPRAY_PROTECT_DAYS = 14
HEAT_TMAX = 34.0
HEAT_YIELD_FACTOR = 0.7
STRESS_EVENT_KS = 0.8
LATE_HARVEST_DAYS = 10
OVERWATER_MM = 10.0
WATER_BUDGET_MM = 20.0
MAX_IRRIGATION_MM = 100.0
SOIL_FC = 0.35
SOIL_WP = 0.20
DEFAULT_SOIL = {"taw_mm_per_m": 150.0, "init_fraction": 0.7}
DEFAULT_WX = {"tmax": 25.0, "tmin": 13.0, "precip": 0.0, "et0": 4.0}
PLANTABLE = ("corn", "soybeans", "winter_wheat", "alfalfa", "hay", "pasture")
NO_CROP = ("unknown", "other", "fallow")
AEF_MIN_CONFIDENCE = 0.5
PLANT_WINDOWS = {"corn": ((4, 20), (6, 10)), "soybeans": ((4, 20), (6, 10)), "winter_wheat": ((9, 15), (10, 31)),
                 "alfalfa": ((4, 1), (8, 31)), "hay": ((4, 1), (8, 31)), "pasture": ((4, 1), (8, 31))}
OUTLOOK_DAYS = 200
OUTLOOK_IRRIGATION_MM = 25.0
OUTLOOK_IRRIGATION_EVERY = 7
CLOSE_RAW_MM = 15.0
CLOSE_PEST = 0.5
CLOSE_GDD = 60.0
OP_ORDER = {"plant": 0, "irrigate": 1, "spray": 2, "harvest": 3}


def _crop(label, base, cap, gdd, kc, root, yp, hi, wp, p, sens, days, cuts=0):
    """Build one CROPS entry."""
    return {"label": label, "base_temp": base, "temp_cap": cap, "gdd": dict(zip(STAGES, gdd)),
            "kc": dict(zip(("initial", "mid", "late"), kc)), "max_root_m": root, "yield_potential_t_ha": yp,
            "hi": hi, "wp_g_m2_mm": wp, "p": p, "sensitivity": dict(zip(STAGES, sens)), "duration_days": days,
            "max_cuts": cuts}


CROPS = {
    "corn": _crop("Corn", 10, 30, (100, 400, 800, 1200, 1500), (0.3, 1.2, 0.5), 1.2, 12.5, 0.5, 33, 0.55,
                  (0.2, 0.6, 1.5, 1.0, 0.0), 140),
    "soybeans": _crop("Soybeans", 10, 30, (80, 350, 700, 1050, 1300), (0.3, 1.15, 0.5), 1.0, 4.0, 0.4, 15, 0.55,
                      (0.2, 0.5, 1.3, 1.1, 0.0), 125),
    "winter_wheat": _crop("Winter wheat", 0, 26, (100, 400, 900, 1300, 1600), (0.3, 1.15, 0.4), 1.2, 6.5, 0.45, 18,
                          0.55, (0.2, 0.5, 1.3, 1.0, 0.0), 270),
    "alfalfa": _crop("Alfalfa", 5, 30, (50, 150, 300, 400, 500), (0.4, 1.2, 1.0), 0.8, 12.0, 0.9, 15, 0.55,
                     (0.3, 0.7, 0.8, 0.6, 0.0), 35, 4),
    "hay": _crop("Hay", 5, 30, (60, 200, 400, 500, 600), (0.4, 1.05, 0.9), 0.8, 8.0, 0.9, 15, 0.6,
                 (0.3, 0.6, 0.7, 0.5, 0.0), 40, 3),
    "pasture": _crop("Pasture", 5, 30, (60, 200, 350, 450, 550), (0.4, 1.0, 0.85), 0.8, 6.0, 0.8, 15, 0.6,
                     (0.3, 0.6, 0.7, 0.5, 0.0), 35, 3),
    "fallow": _crop("Fallow", 5, 30, (60, 200, 350, 450, 550), (0.3, 0.3, 0.3), 0.3, 0.0, 0.0, 0, 0.5,
                    (0.0, 0.0, 0.0, 0.0, 0.0), 0),
    "other": _crop("Other", 10, 30, (80, 350, 700, 1050, 1300), (0.3, 1.1, 0.5), 1.0, 5.0, 0.4, 18, 0.55,
                   (0.2, 0.5, 1.2, 1.0, 0.0), 120),
}

MISSIONS = (
    ("find-stress", "Find the stressed field"),
    ("save-water", "Finish the season under {budget} m³"),
    ("harvest-efficiency", "Harvest every field within 10 days of maturity"),
    ("no-overwater", "Never let one irrigation drain more than 10 mm"),
)


class OpError(ValueError):
    """A user-level error from an operation, with a hint for the player."""

    def __init__(self, message, hint=""):
        super().__init__(message)
        self.hint = hint


def _soil(state):
    return dict(DEFAULT_SOIL, **(state.get("soil") or {}))


def _d(s):
    return dt.date.fromisoformat(str(s)[:10])


def _add_days(s, n):
    return (_d(s) + dt.timedelta(days=n)).isoformat()


def _clamp(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def _r(x, n=1):
    return round(float(x), n)


def season_of(date):
    """Season name from the month of an ISO date."""
    m = _d(date).month
    return "spring" if 3 <= m <= 5 else "summer" if 6 <= m <= 8 else "autumn" if 9 <= m <= 11 else "winter"


def crop_of(name):
    """CROPS entry for a crop name, unknown names fall back to other."""
    return CROPS.get(name) or CROPS["other"]


def norm_crop(name):
    """Crop name as stored in field state: a CROPS key, "unknown" when missing, else "other"."""
    if name in CROPS:
        return name
    return "unknown" if name in (None, "", "unknown") else "other"


def gdd_day(tmax, tmin, c):
    """Growing degree days for one day, max temperature capped, min floored at base."""
    base, cap = c["base_temp"], c["temp_cap"]
    tx = _clamp(tmax, base, cap)
    tn = _clamp(tmin, base, cap)
    return max(0.0, (tx + tn) / 2.0 - base)


def stage_of(g, c):
    """Stage label from cumulative GDD."""
    t = c["gdd"]
    if g >= t["mature"]:
        return "mature"
    if g >= t["grain_fill"]:
        return "grain_fill"
    if g >= t["flowering"]:
        return "flowering"
    if g >= t["emergence"]:
        return "vegetative"
    return "emergence"


def kc_of(g, c):
    """FAO-56 crop coefficient interpolated by GDD."""
    t, k = c["gdd"], c["kc"]
    if g < t["emergence"]:
        return k["initial"]
    if g < t["flowering"]:
        return k["initial"] + (k["mid"] - k["initial"]) * (g - t["emergence"]) / (t["flowering"] - t["emergence"])
    if g < t["grain_fill"]:
        return k["mid"]
    if g < t["mature"]:
        return k["mid"] + (k["late"] - k["mid"]) * (g - t["grain_fill"]) / (t["mature"] - t["grain_fill"])
    return k["late"]


def canopy_potential(g, c):
    """Stress-free canopy cover: logistic from emergence, half cover at the vegetative threshold, senescence in grain fill."""
    t = c["gdd"]
    if g < t["emergence"] or c["yield_potential_t_ha"] <= 0:
        return 0.0
    k = math.log(19.0) / max(1.0, t["flowering"] - t["vegetative"])
    lg = lambda x: 1.0 / (1.0 + math.exp(-k * (x - t["vegetative"])))
    l0 = lg(t["emergence"])
    cc = CCX * (lg(g) - l0) / (1.0 - l0)
    if g >= t["grain_fill"]:
        cc *= 1.0 - 0.5 * min(1.0, (g - t["grain_fill"]) / (t["mature"] - t["grain_fill"]))
    return _clamp(cc, 0.0, CCX)


def root_target(g, c, forage):
    """Root depth growing linearly in GDD from 0.3 m at planting to max at flowering."""
    zmax = max(BARE_ROOT_M, c["max_root_m"])
    if forage:
        return zmax
    return BARE_ROOT_M + (zmax - BARE_ROOT_M) * min(1.0, g / c["gdd"]["flowering"])


def ks_of(dr, taw, raw):
    """FAO-56 water stress coefficient."""
    if dr <= raw or taw <= raw:
        return 1.0
    return _clamp((taw - dr) / (taw - raw), 0.0, 1.0)


def p_adjusted(p, etc):
    """FAO-56 depletion fraction adjusted for evaporative demand."""
    return _clamp(p + 0.04 * (5.0 - etc), 0.1, 0.8)


def hargreaves_et0(lat, date, tmax, tmin):
    """Hargreaves reference ET (mm/day) for days without ET0."""
    j = _d(date).timetuple().tm_yday
    phi = math.radians(lat)
    dr = 1 + 0.033 * math.cos(2 * math.pi * j / 365)
    de = 0.409 * math.sin(2 * math.pi * j / 365 - 1.39)
    ws = math.acos(_clamp(-math.tan(phi) * math.tan(de), -1.0, 1.0))
    ra = 24 * 60 / math.pi * 0.082 * dr * (ws * math.sin(phi) * math.sin(de) + math.cos(phi) * math.cos(de) * math.sin(ws))
    return max(0.0, 0.0023 * 0.408 * ra * ((tmax + tmin) / 2 + 17.8) * math.sqrt(max(0.0, tmax - tmin)))


def _num(v):
    try:
        f = float(v)
        return None if math.isnan(f) else f
    except (TypeError, ValueError):
        return None


def _norm_wx(row, source, lat):
    date = str(row.get("date"))[:10]
    tmax, tmin = _num(row.get("tmax")), _num(row.get("tmin"))
    if tmax is None and tmin is None:
        tmax, tmin = DEFAULT_WX["tmax"], DEFAULT_WX["tmin"]
    elif tmax is None:
        tmax = tmin + 10.0
    elif tmin is None:
        tmin = tmax - 10.0
    precip = max(0.0, _num(row.get("precip")) or 0.0)
    et0 = _num(row.get("et0"))
    if et0 is None:
        et0 = hargreaves_et0(lat, date, tmax, tmin)
    out = {"date": date, "tmax": _r(tmax), "tmin": _r(tmin), "precip": _r(precip), "et0": _r(max(0.0, et0), 2),
           "source": source}
    out.update({k: row[k] for k in ("precip_prob", "p_rain") if row.get(k) is not None})
    return out


def weather_index(weather):
    """Index weather history + forecast by date; days past the end repeat the last 7 history days."""
    weather = weather or {}
    lat = _num(weather.get("lat")) or 42.0
    known = {}
    for row in weather.get("history") or []:
        if row and row.get("date"):
            known[str(row["date"])[:10]] = _norm_wx(row, "history", lat)
    hist_dates = sorted(known)
    for row in weather.get("forecast") or []:
        if row and row.get("date"):
            d = str(row["date"])[:10]
            if d not in known:
                known[d] = _norm_wx(row, "forecast", lat)
    dates = sorted(known)
    tail_src = hist_dates[-7:] or dates[-7:]
    tail = [known[d] for d in tail_src] or [_norm_wx({"date": "2025-07-01"}, "default", lat)]
    soil = {str(r.get("date"))[:10]: r for r in weather.get("soil") or [] if r and r.get("date")}
    return {"known": known, "first": dates[0] if dates else None, "last": dates[-1] if dates else None,
            "hist_last": hist_dates[-1] if hist_dates else (dates[-1] if dates else None), "tail": tail, "lat": lat, "soil": soil}


def weather_for(idx, date):
    """Weather record for a date: history, then forecast, then the repeated last week of history."""
    w = idx["known"].get(date)
    if w:
        return dict(w)
    anchor = idx["last"] if idx["last"] and date > idx["last"] else idx.get("hist_last")
    if anchor and date > anchor:
        w = dict(idx["tail"][((_d(date) - _d(anchor)).days - 1) % len(idx["tail"])])
    elif idx["first"]:
        w = dict(idx["known"][idx["first"]])
    else:
        w = dict(idx["tail"][0])
    w["date"], w["source"] = date, "repeat"
    return w


def soil_from_weather(idx, start_date, soil=None):
    """Soil params with init_fraction from modelled volumetric soil moisture on the start date when available."""
    s = dict(DEFAULT_SOIL)
    s.update(soil or {})
    row = idx["soil"].get(start_date) if idx else None
    if row and not (soil or {}).get("init_fraction"):
        vals = [_num(row.get(k)) for k in ("sm_7_28", "sm_28_100")]
        vals = [v for v in vals if v is not None]
        if vals:
            s["init_fraction"] = _r(_clamp((sum(vals) / len(vals) - SOIL_WP) / (SOIL_FC - SOIL_WP), 0.3, 1.0), 2)
            s["init_source"] = "Open-Meteo modelled soil moisture on " + start_date
    return s


def _move_root(m, z_new, taw_m):
    """Change root depth while conserving water: the layer entering or leaving the root zone carries its depletion."""
    z_old, zmax = m["zr"], m["zmax"]
    if z_new > z_old and zmax > z_old:
        mv = m["dsub"] * min(1.0, (z_new - z_old) / (zmax - z_old))
        m["dr"] += mv
        m["dsub"] -= mv
    elif z_new < z_old and z_old > 0:
        mv = m["dr"] * (z_old - z_new) / z_old
        m["dr"] -= mv
        m["dsub"] += mv
    m["zr"] = z_new


def _percolate(m):
    """Water above field capacity leaves the root zone; it refills the subsoil first, the rest is deep drainage."""
    if m["dr"] >= 0:
        return 0.0
    excess = -m["dr"]
    m["dr"] = 0.0
    recharge = min(excess, m["dsub"])
    m["dsub"] -= recharge
    m["deep_mm"] += excess - recharge
    return excess


def _fresh_model(c, zr, dr, dsub):
    return {"gdd": 0.0, "zr": zr, "zmax": max(BARE_ROOT_M, c["max_root_m"]), "dr": dr, "dsub": dsub, "p": c["p"],
            "biomass": 0.0, "biomass_pot": 0.0, "ks_sum": 0.0, "ks_n": 0, "wks": 0.0, "w": 0.0, "ks7": [],
            "pest": 0.0, "pest_damage": 0.0, "protect_until": None, "in_stress": False, "pest_high": False,
            "days_mature": 0, "late": False, "early_harvests": 0, "field_loss": 0.0, "irr_today": 0.0,
            "irr_day": 0.0, "rain_day": 0.0, "et0_day": 0.0, "deep_mm": 0.0, "harvest_t_ha": 0.0,
            "irr_events": 0, "overwater": 0, "max_drain_mm": 0.0, "irrigated_stressed": False,
            "tmax": None, "ccp": 0.0, "cve": 1.0}


def new_field_state(field, soil=None, start_date=None, gdd0=0.0):
    """Initial state of one field from a farm field; perennials and winter wheat start established."""
    soil = dict(DEFAULT_SOIL, **(soil or {}))
    crop = norm_crop(field.get("crop"))
    c = crop_of(crop)
    taw_m, frac = float(soil["taw_mm_per_m"]), float(soil["init_fraction"])
    zmax = max(BARE_ROOT_M, c["max_root_m"])
    m = _fresh_model(c, BARE_ROOT_M, (1 - frac) * taw_m * BARE_ROOT_M, (1 - frac) * taw_m * (zmax - BARE_ROOT_M))
    start_date = start_date or "2025-05-01"
    pre = crop in PRE_PLANTED
    fs = {"field_id": field.get("field_id"), "name": field.get("name") or field.get("field_id"), "crop": crop,
          "area_ha": _r(_num(field.get("area_ha")) or 0.0, 2), "planted": pre, "established": pre,
          "plant_date": None, "stage": "not_planted", "gdd": 0.0, "canopy": 0.0, "biomass_t_ha": 0.0,
          "root_depth_m": BARE_ROOT_M, "soil_water_mm": 0.0, "taw_mm": 0.0, "raw_mm": 0.0, "depletion_pct": 0.0,
          "ks": 1.0, "stress_days": 0, "water_used_mm": 0.0, "irrigation_mm": 0.0, "rain_mm": 0.0, "et_mm": 0.0,
          "drainage_mm": 0.0, "yield_est_t_ha": 0.0, "yield_potential_t_ha": c["yield_potential_t_ha"],
          "yield_t_ha": None, "harvest_t": 0.0, "harvest_date": None, "mature_date": None, "cuts": 0,
          "pest_pressure": 0.0, "health": 100, "harvested": False, "last_op": None, "alerts": [],
          "crop_source": "none" if crop == "unknown" else "cdl", "crop_history": {}, "rotation": None,
          "typical_crop": None, "aef_class": None, "aef_pred": None, "aef_confidence": None, "model": m}
    if pre:
        if crop == "winter_wheat":
            fs["plant_date"] = "%d-10-01" % (_d(start_date).year - 1)
            m["gdd"] = min(float(gdd0), c["gdd"]["flowering"] - 1.0)
        else:
            fs["plant_date"] = start_date
        _move_root(m, root_target(m["gdd"], c, crop in FORAGES), taw_m)
        fs["stage"] = stage_of(m["gdd"], c)
        fs["yield_est_t_ha"] = c["yield_potential_t_ha"]
    _refresh(fs, soil)
    return fs


def _crop_word(crop):
    return CROPS[crop]["label"].lower() if crop in CROPS else "unknown crop"


def _label(fs):
    return "Field %s (%s)" % (fs.get("name") or fs["field_id"], _crop_word(fs["crop"]))


def _yield_est(fs, c):
    m = fs["model"]
    ksw = m["wks"] / m["w"] if m["w"] > 0 else 1.0
    bio = min(1.0, m["biomass"] / m["biomass_pot"]) if m["biomass_pot"] > 0 else 1.0
    y = c["yield_potential_t_ha"] * (0.5 * ksw + 0.5 * bio) * (1 - m["pest_damage"]) * (1 - m["field_loss"])
    return _clamp(y, 0.0, c["yield_potential_t_ha"])


def _refresh(fs, soil):
    """Recompute display values (water, ks, alerts, health) from the model state."""
    m = fs["model"]
    taw_m = float(soil["taw_mm_per_m"])
    taw = taw_m * m["zr"]
    raw = m["p"] * taw
    m["dr"] = _clamp(m["dr"], 0.0, taw)
    ks = ks_of(m["dr"], taw, raw)
    growing = fs["planted"] and not fs["harvested"]
    fs.update({"gdd": _r(m["gdd"]), "root_depth_m": _r(m["zr"], 2), "taw_mm": _r(taw), "raw_mm": _r(raw),
               "soil_water_mm": _r(taw - m["dr"]), "depletion_pct": _r(100.0 * m["dr"] / taw if taw else 0.0),
               "ks": _r(ks, 2), "biomass_t_ha": _r(m["biomass"] / 100.0, 2), "pest_pressure": _r(m["pest"], 2),
               "drainage_mm": _r(fs["model"].get("drain_total", 0.0))})
    if not growing:
        fs["alerts"] = []
        if not fs["planted"]:
            fs["health"] = 100
        return fs
    alerts = []
    if m["dr"] > raw:
        alerts.append("moisture low")
    if fs["stage"] == "flowering" and m["tmax"] is not None and m["tmax"] >= HEAT_TMAX:
        alerts.append("heat stress")
    if m["pest"] > PEST_THRESHOLD:
        alerts.append("pest pressure high")
    if fs["stage"] == "mature":
        alerts.append("ready to harvest")
    fs["alerts"] = alerts
    ks7 = sum(m["ks7"]) / len(m["ks7"]) if m["ks7"] else ks
    cve = fs["canopy"] / m["ccp"] if m["ccp"] > 0.01 else m["cve"]
    h = 100.0 * (0.5 * ks + 0.3 * ks7 + 0.2 * _clamp(cve, 0.0, 1.0)) * (1 - m["pest_damage"])
    if m["pest"] > PEST_THRESHOLD:
        h -= 10
    fs["health"] = int(_clamp(round(h), 0, 100))
    return fs


def _step(fs, wx, soil, farm_id=""):
    """Advance one field one day in place; returns events."""
    c = crop_of(fs["crop"])
    m = fs["model"]
    taw_m = float(soil["taw_mm_per_m"])
    date, tmax, tmin, rain, et0 = wx["date"], wx["tmax"], wx["tmin"], wx["precip"], wx["et0"]
    forage = fs["crop"] in FORAGES
    growing = fs["planted"] and not fs["harvested"]
    events = []
    prev = fs["stage"]
    stage, kc_pot, ccp = prev, BARE_KC, 0.0
    if growing:
        m["gdd"] += gdd_day(tmax, tmin, c)
        stage = stage_of(m["gdd"], c)
        zt = root_target(m["gdd"], c, forage)
        if zt > m["zr"]:
            _move_root(m, zt, taw_m)
        kc_pot, ccp = kc_of(m["gdd"], c), canopy_potential(m["gdd"], c)
    m["dr"] -= rain
    m["drain_total"] = m.get("drain_total", 0.0) + _percolate(m)
    taw = taw_m * m["zr"]
    emerged = growing and m["gdd"] >= c["gdd"]["emergence"]
    kc = c["kc"]["initial"] + (kc_pot - c["kc"]["initial"]) * m["cve"] if emerged else kc_pot
    m["p"] = p_adjusted(c["p"], et0 * kc)
    ks = ks_of(m["dr"], taw, m["p"] * taw)
    eta = min(et0 * kc * ks, max(0.0, taw - m["dr"]))
    m["dr"] += eta
    m["et_total"] = m.get("et_total", 0.0) + eta
    fs["et_mm"] = _r(m["et_total"])
    fs["rain_mm"] = _r(fs["rain_mm"] + rain)
    m["tmax"], m["ccp"], m["rain_day"], m["et0_day"] = tmax, ccp, rain, et0
    m["irr_day"], m["irr_today"] = m["irr_today"], 0.0
    fs["stage"] = stage
    if growing:
        name = _label(fs)
        if emerged:
            m["ks_sum"] += ks
            m["ks_n"] += 1
            m["cve"] = m["ks_sum"] / m["ks_n"]
            if stage != "mature":
                w = c["sensitivity"][stage]
                heat = stage == "flowering" and tmax >= HEAT_TMAX
                m["wks"] += w * ks * (HEAT_YIELD_FACTOR if heat else 1.0)
                m["w"] += w
            fs["canopy"] = _r(ccp * m["cve"] * (1 - 0.5 * m["pest_damage"]), 3)
            m["biomass"] += c["wp_g_m2_mm"] * ks * fs["canopy"]
            m["biomass_pot"] += c["wp_g_m2_mm"] * ccp
        m["ks7"] = (m["ks7"] + [ks])[-7:]
        if ks < 1.0:
            fs["stress_days"] += 1
        if ks < STRESS_EVENT_KS and not m["in_stress"]:
            m["in_stress"] = True
            events.append({"date": date, "field_id": fs["field_id"], "kind": "stress",
                           "text": "%s: moisture low, water stress ks %.2f. Irrigate soon." % (name, ks)})
        elif ks >= STRESS_EVENT_KS:
            m["in_stress"] = False
        if emerged and fs["canopy"] >= PEST_MIN_CANOPY:
            rng = random.Random(zlib.crc32(("%s|%s|%s" % (farm_id, fs["field_id"], date)).encode()))
            tmean = (tmax + tmin) / 2.0
            fav = (1.0 if 18.0 <= tmean <= 30.0 else 0.4) + (0.3 if rain > 2.0 else 0.0)
            rate = PEST_RATE * (0.15 if m["protect_until"] and date <= m["protect_until"] else 1.0)
            m["pest"] = min(1.0, m["pest"] + rng.random() * rate * fav)
            if m["pest"] > PEST_THRESHOLD:
                m["pest_damage"] = min(PEST_MAX_DAMAGE, m["pest_damage"] + 0.004 + 0.01 * (m["pest"] - PEST_THRESHOLD) / 0.4)
                if not m["pest_high"]:
                    m["pest_high"] = True
                    events.append({"date": date, "field_id": fs["field_id"], "kind": "stress",
                                   "text": "%s: pest pressure high. Spray to protect the yield." % name})
            else:
                m["pest_high"] = False
        if stage == "mature":
            if not fs["mature_date"]:
                fs["mature_date"] = date
            m["days_mature"] += 1
            if m["days_mature"] > LATE_HARVEST_DAYS:
                m["late"] = True
                m["field_loss"] = min(0.2, 0.005 * (m["days_mature"] - LATE_HARVEST_DAYS))
        fs["yield_est_t_ha"] = _r(_yield_est(fs, c), 2)
        if stage != prev:
            events.append({"date": date, "field_id": fs["field_id"], "kind": "stage",
                           "text": "%s reached %s" % (name, stage.replace("_", " "))})
    _refresh(fs, soil)
    return events


def _apply(fs, op, amount_mm, date, soil, crop=None):
    """Apply an op to a field in place; returns events. Raises OpError for invalid ops."""
    m = fs["model"]
    taw_m = float(soil["taw_mm_per_m"])
    name = _label(fs)
    events = []
    if op not in ("plant", "irrigate", "spray", "harvest"):
        raise OpError("unknown op '%s'" % op, "op is one of plant, irrigate, spray, harvest")
    if op == "plant":
        if fs["planted"]:
            raise OpError("%s is already %s" % (name, "harvested" if fs["harvested"] else "planted"),
                          "plant only fields that are not planted yet")
        if crop not in (None, "") and crop not in PLANTABLE:
            raise OpError("'%s' is not a crop you can plant" % crop, "crop is one of " + ", ".join(PLANTABLE))
        new_crop = crop or fs["crop"]
        if new_crop not in PLANTABLE:
            raise OpError("%s has no crop to plant yet" % name,
                          "pass crop in the payload, one of " + ", ".join(PLANTABLE))
        if new_crop != fs["crop"]:
            fs["crop_source"] = "player"
        c = CROPS[new_crop]
        zmax = max(BARE_ROOT_M, c["max_root_m"])
        sub_old, sub_new = m["zmax"] - m["zr"], zmax - m["zr"]
        dsub = m["dsub"] * sub_new / sub_old if sub_old > 0 else (1 - soil["init_fraction"]) * taw_m * sub_new
        nm = _fresh_model(c, m["zr"], m["dr"], dsub)
        for k in ("drain_total", "deep_mm", "et_total"):
            nm[k] = m.get(k, 0.0)
        fs.update({"crop": new_crop, "planted": True, "plant_date": date, "stage": "emergence", "canopy": 0.0,
                   "yield_potential_t_ha": c["yield_potential_t_ha"], "yield_est_t_ha": c["yield_potential_t_ha"],
                   "stress_days": 0, "mature_date": None, "model": nm})
        m = nm
        text = "Planted %s on field %s" % (c["label"].lower(), fs["name"])
        amount_mm = 0
    else:
        if not fs["planted"] or fs["harvested"]:
            raise OpError("%s is %s" % (name, "harvested" if fs["harvested"] else "not planted"),
                          "plant the field first" if not fs["planted"] else "the season is over on this field")
    if op == "irrigate":
        a = _num(amount_mm)
        if a is None or a <= 0 or a > MAX_IRRIGATION_MM:
            raise OpError("amount_mm must be between 1 and %d" % MAX_IRRIGATION_MM, "a typical pass is 25 mm")
        stressed = fs["ks"] < 1.0 or "moisture low" in fs["alerts"]
        m["dr"] -= a
        drained = _percolate(m)
        m["drain_total"] = m.get("drain_total", 0.0) + drained
        m["irr_today"] += a
        m["irr_events"] += 1
        m["max_drain_mm"] = max(m["max_drain_mm"], drained)
        if drained > OVERWATER_MM:
            m["overwater"] += 1
        if stressed:
            m["irrigated_stressed"] = True
        fs["irrigation_mm"] = _r(fs["irrigation_mm"] + a)
        fs["water_used_mm"] = _r(fs["water_used_mm"] + a)
        amount_mm = _r(a)
        text = "Irrigated %g mm on field %s" % (amount_mm, fs["name"])
        if drained > 0.5:
            text += ", %.0f mm drained below the roots" % drained
    elif op == "spray":
        m["pest"] = 0.0
        m["pest_high"] = False
        m["protect_until"] = _add_days(date, SPRAY_PROTECT_DAYS)
        amount_mm = 0
        text = "Sprayed field %s, protected until %s" % (fs["name"], m["protect_until"])
    elif op == "harvest":
        c = crop_of(fs["crop"])
        if fs["stage"] not in ("grain_fill", "mature"):
            raise OpError("%s is not ready (%s)" % (name, fs["stage"].replace("_", " ")),
                          "harvest from grain fill onwards; wait for mature for the full yield")
        early = fs["stage"] != "mature"
        factor = 0.85 if early else 1.0
        if early:
            m["early_harvests"] += 1
        y = _yield_est(fs, c) * factor
        amount_mm = 0
        forage = fs["crop"] in FORAGES
        if forage:
            cut = y / max(1, c["max_cuts"])
            m["harvest_t_ha"] += cut
            fs["cuts"] += 1
            final = fs["cuts"] >= c["max_cuts"] or _d(date).month >= 10
            text = "Cut %d on field %s: %.1f t/ha dry matter" % (fs["cuts"], fs["name"], cut)
            if not final:
                g0 = c["gdd"]["emergence"]
                m.update({"gdd": float(g0), "biomass": 0.0, "biomass_pot": 0.0, "wks": 0.0, "w": 0.0,
                          "days_mature": 0, "field_loss": 0.0})
                fs.update({"stage": stage_of(g0, c), "mature_date": None, "canopy": 0.0})
        else:
            m["harvest_t_ha"] += y
            final = True
            text = "Harvested field %s: %.1f t/ha%s" % (fs["name"], y, " (early, 85%)" if early else "")
        if final:
            fs.update({"harvested": True, "stage": "harvested", "canopy": 0.0, "yield_t_ha": _r(m["harvest_t_ha"], 2),
                       "harvest_date": date, "yield_est_t_ha": _r(m["harvest_t_ha"], 2)})
            _move_root(m, BARE_ROOT_M, taw_m)
        fs["harvest_t"] = _r(m["harvest_t_ha"] * fs["area_ha"], 2)
        events.append({"date": date, "field_id": fs["field_id"], "kind": "harvest", "text": text})
    if op != "harvest":
        events.append({"date": date, "field_id": fs["field_id"], "kind": "op", "text": text})
    fs["last_op"] = {"op": op, "date": date, "amount_mm": amount_mm}
    _refresh(fs, soil)
    return events


def _total_area(state):
    return sum(f["area_ha"] for f in state["fields"].values())


def compute_totals(state):
    """Farm totals and score from field states."""
    fields = list(state["fields"].values())
    n = max(1, len(fields))
    water_m3 = sum(f["irrigation_mm"] * 10.0 * f["area_ha"] for f in fields)
    harvested_t = sum(f["harvest_t"] for f in fields)
    est = sum(f["harvest_t"] if f["harvested"] else (f["yield_est_t_ha"] * f["area_ha"] if f["planted"] else 0.0)
              for f in fields)
    early = sum(f["model"]["early_harvests"] for f in fields)
    done = sum(1 for mi in state.get("missions", []) if mi.get("done"))
    score = 100 * done + harvested_t - water_m3 / 1000.0 - 20 * early
    area = _total_area(state)
    state["totals"] = {"water_used_mm_ha": _r(sum(f["irrigation_mm"] for f in fields) / n),
                       "water_used_m3": int(round(water_m3)), "ops": int(state.get("ops_count", 0)),
                       "est_yield_t": _r(est), "harvested_t": _r(harvested_t), "score": int(round(score)),
                       "area_ha": _r(area), "water_budget_m3": int(round(WATER_BUDGET_MM * 10.0 * area)),
                       "missions_done": done, "early_harvests": early}
    return state["totals"]


def evaluate_missions(state):
    """Update state.missions in place; returns mission events for newly completed missions."""
    fields = list(state["fields"].values())
    planted = [f for f in fields if f["planted"]]
    harvested = [f for f in planted if f["harvested"]]
    over = bool(planted) and len(harvested) == len(planted)
    frac = len(harvested) / len(planted) if planted else 0.0
    area = _total_area(state)
    budget = WATER_BUDGET_MM * 10.0 * area
    water = sum(f["irrigation_mm"] * 10.0 * f["area_ha"] for f in fields)
    prev = {mi["id"]: mi for mi in state.get("missions", [])}
    out, events = [], []
    for mid, title in MISSIONS:
        failed = False
        if mid == "find-stress":
            done = any(f["model"]["irrigated_stressed"] for f in fields)
            stressed = any(f["planted"] and not f["harvested"] and f["ks"] < 1.0 for f in fields)
            progress = 1.0 if done else 0.5 if stressed else 0.0
            hint = "A field shows 'moisture low' now: irrigate it" if stressed else "Advance days and watch for 'moisture low', then irrigate that field"
        elif mid == "save-water":
            title = title.format(budget="{:,.0f}".format(budget))
            failed = water > budget
            done = over and not failed
            progress = 0.0 if failed else frac
            hint = "%s of %s m³ used, %d of %d planted fields harvested" % (
                "{:,.0f}".format(water), "{:,.0f}".format(budget), len(harvested), len(planted))
        elif mid == "harvest-efficiency":
            failed = any(f["model"]["late"] or f["model"]["early_harvests"] for f in planted)
            ontime = [f for f in harvested if not f["model"]["late"] and not f["model"]["early_harvests"]]
            done = over and not failed
            progress = 0.0 if failed else (len(ontime) / len(planted) if planted else 0.0)
            hint = "Harvest when a field shows 'ready to harvest'"
        else:
            failed = any(f["model"]["overwater"] for f in fields)
            done = over and not failed
            progress = 0.0 if failed else frac
            hint = "Irrigate only when the root zone has room (depletion > 25 mm)"
        p = prev.get(mid) or {}
        if p.get("done"):
            done, failed, progress = True, False, 1.0
        if failed:
            hint = "Failed. " + hint
        if done and not p.get("done"):
            events.append({"date": state["day"], "field_id": None, "kind": "mission",
                           "text": "Mission complete: %s (+50)" % title})
        out.append({"id": mid, "title": title, "done": bool(done), "failed": bool(failed and not done),
                    "progress": _r(1.0 if done else progress, 2), "hint": hint})
    state["missions"] = out
    return events


def _finish(state, idx):
    state["season"] = season_of(state["day"])
    state["weather_today"] = weather_for(idx, state["day"])
    if state.get("lat") is None:
        state["lat"] = idx["lat"]
    ev = evaluate_missions(state)
    compute_totals(state)
    state["next_action"] = next_action(state)
    return ev


def upgrade_state(state):
    """Fill keys added in round 2 (crop source, AEF, ui, next_action) into an older stored state."""
    for fs in state.get("fields", {}).values():
        for k, v in (("crop_history", {}), ("rotation", None), ("typical_crop", None), ("aef_class", None),
                     ("aef_pred", None), ("aef_confidence", None)):
            fs.setdefault(k, v)
        fs.setdefault("crop_source", "none" if fs.get("crop") == "unknown" else "cdl")
    state.setdefault("ui", {})
    if "next_action" not in state:
        state["next_action"] = next_action(state)
    return state


def wheat_gdd0(idx, start):
    """GDD a winter wheat crop has gathered by the start date: 350 for the autumn plus the known weather before start."""
    g = 350.0
    d = _add_days(start, -1)
    while idx["first"] and d >= idx["first"]:
        w = idx["known"].get(d)
        if w:
            g += gdd_day(w["tmax"], w["tmin"], CROPS["winter_wheat"])
        d = _add_days(d, -1)
    return g


def _ok(obj):
    return isinstance(obj, dict) and not obj.get("error")


def field_meta(field, history=None, aef=None):
    """Crop, crop source, CDL history and AlphaEarth class for one farm field."""
    fid = field.get("field_id")
    history = history if _ok(history) else {}
    aef = aef if _ok(aef) else {}
    crop = norm_crop(field.get("crop"))
    ch = (history.get("fields") or {}).get(fid)
    a = (aef.get("fields") or {}).get(fid)
    a = a if isinstance(a, dict) else {}
    pred = a.get("pred_crop")
    conf = _num(a.get("confidence"))
    source = "none" if crop == "unknown" else "cdl"
    if crop == "unknown" and aef.get("supervised") and pred in CROPS and pred != "other" and conf is not None \
            and conf >= AEF_MIN_CONFIDENCE:
        crop, source = pred, "aef"
    return {"crop": crop, "crop_source": source,
            "crop_history": {str(k): v for k, v in sorted(ch.items())} if isinstance(ch, dict) else {},
            "rotation": (history.get("rotation") or {}).get(fid), "typical_crop": (history.get("typical") or {}).get(fid),
            "aef_class": a.get("cluster"), "aef_pred": pred, "aef_confidence": None if conf is None else _r(conf, 2)}


def new_state(farm, weather, start_date=None, farm_id="farm", title=None, soil=None, history=None, aef=None):
    """Fresh game state for a farm result and a weather result, with optional CDL history and AEF classes."""
    idx = weather_index(weather)
    start = str(start_date or idx["first"] or "2025-05-01")[:10]
    _d(start)
    soil = soil_from_weather(idx, start, soil)
    wheat_gdd = wheat_gdd0(idx, start)
    fields, seeds = {}, {}
    for f in farm.get("fields") or []:
        fid = f.get("field_id")
        if not fid:
            continue
        meta = field_meta(f, history, aef)
        fs = new_field_state(dict(f, crop=meta["crop"]), soil, start, wheat_gdd)
        fs.update(meta)
        fields[fid] = fs
        seeds[fid] = fs["crop"]
    lat = _num((farm.get("center") or {}).get("lat"))
    state = {"farm_id": farm_id, "title": title or farm.get("title") or farm_id, "day": start, "day_index": 0,
             "start_date": start, "season": season_of(start), "weather_today": None, "totals": {}, "fields": fields,
             "missions": [], "log": [], "recent_events": [], "ops_count": 0, "soil": soil, "ui": {},
             "lat": lat if lat is not None else idx["lat"], "_seed": {"crops": seeds, "wheat_gdd": wheat_gdd}}
    _finish(state, idx)
    return state


def advance(state, weather, days=1, farm_id=None):
    """Simulate `days` days for every field. Returns (state, events, field_day_rows)."""
    state = json.loads(json.dumps(state))
    idx = weather_index(weather)
    soil = _soil(state)
    farm_id = farm_id or state.get("farm_id", "")
    events, rows = [], []
    for _ in range(int(days)):
        wx = weather_for(idx, state["day"])
        if wx["precip"] > 5.0:
            events.append({"date": wx["date"], "field_id": None, "kind": "rain",
                           "text": "Rain: %.1f mm across the farm" % wx["precip"]})
        for fs in state["fields"].values():
            events.extend(_step(fs, wx, soil, farm_id))
            m = fs["model"]
            rows.append({"date": wx["date"], "field_id": fs["field_id"], "soil_water_mm": fs["soil_water_mm"],
                         "taw_mm": fs["taw_mm"], "raw_mm": fs["raw_mm"], "ks": fs["ks"], "health": fs["health"],
                         "yield_est_t_ha": fs["yield_est_t_ha"], "irrigation_mm": _r(m["irr_day"]),
                         "rain_mm": _r(m["rain_day"]), "et0": _r(m["et0_day"], 2), "stage": fs["stage"]})
        state["day"] = _add_days(state["day"], 1)
        state["day_index"] = int(state["day_index"]) + 1
    events.extend(_finish(state, idx))
    state["recent_events"] = (state.get("recent_events", []) + events)[-20:]
    return state, events, rows


def apply_state_op(state, weather, field_id, op, amount_mm=0, crop=None):
    """Apply an op on one field of the farm state. Returns (state, events, log_row); raises OpError."""
    state = json.loads(json.dumps(state))
    fs = state["fields"].get(field_id)
    if fs is None:
        raise OpError("unknown field_id '%s'" % field_id, "use one of " + ", ".join(sorted(state["fields"])[:12]))
    soil = _soil(state)
    events = _apply(fs, op, amount_mm, state["day"], soil, crop)
    state["ops_count"] = int(state.get("ops_count", 0)) + 1
    note = events[0]["text"] if events else ""
    row = {"date": state["day"], "field_id": field_id, "op": op, "amount_mm": fs["last_op"]["amount_mm"], "note": note}
    state["log"] = (state.get("log", []) + [row])[-30:]
    events.extend(_finish(state, weather_index(weather)))
    state["recent_events"] = (state.get("recent_events", []) + events)[-20:]
    return state, events, row


def _md(date):
    d = _d(date)
    return "%s %d" % (d.strftime("%b"), d.day)


def _flip(md, lat):
    return ((md[0] + 5) % 12 + 1, md[1]) if lat < 0 else md


def plant_window(crop, lat=42.0):
    """(start, end) as (month, day) for a crop's planting window at this latitude, None when it has none."""
    w = PLANT_WINDOWS.get(crop)
    return (_flip(w[0], lat), _flip(w[1], lat)) if w else None


def in_window(date, crop, lat=42.0):
    """True when the date falls inside the crop's planting window (windows flip by 6 months south of the equator)."""
    w = plant_window(crop, lat)
    if not w:
        return False
    d = _d(date)
    md, (a, b) = (d.month, d.day), w
    return a <= md <= b if a <= b else md >= a or md <= b


def _window_end(date, crop, lat):
    (_, (m, dd)) = plant_window(crop, lat)
    y = _d(date).year
    end = dt.date(y, m, min(dd, 28 if m == 2 else dd))
    if end < _d(date):
        end = dt.date(y + 1, m, min(dd, 28 if m == 2 else dd))
    return end.isoformat()


def _days_to_window(date, crop, lat):
    for k in range(366):
        if in_window(_add_days(date, k), crop, lat):
            return k
    return None


def _fname(fs):
    return fs.get("name") or fs["field_id"]


def _act(kind, fs, title, why, key, **extra):
    out = {"kind": kind, "field_id": fs["field_id"] if fs else None, "title": title, "why": why, "key": key}
    out.update(extra)
    return out


def next_action(state):
    """The single recommended next move: harvest > irrigate > spray > plant > advance > wait."""
    day, lat = state["day"], _num(state.get("lat"))
    lat = 42.0 if lat is None else lat
    fields = sorted(state["fields"].values(), key=lambda f: (-f["area_ha"], f["field_id"]))
    growing = [f for f in fields if f["planted"] and not f["harvested"]]
    active = [f for f in growing if f["stage"] != "mature"]
    mature = [f for f in growing if f["stage"] == "mature"]
    if mature:
        f = max(mature, key=lambda x: (x["model"]["days_mature"], x["area_ha"]))
        dm = f["model"]["days_mature"]
        left = LATE_HARVEST_DAYS - dm
        tail = ("losses start in %d day%s" % (left, "" if left == 1 else "s")) if left > 0 else \
            "it is %d days past the %d-day window and losing yield" % (dm - LATE_HARVEST_DAYS, LATE_HARVEST_DAYS)
        why = "%s has been mature for %d day%s: about %.1f t/ha (%.0f t) is ready and %s." % (
            _label(f), dm, "" if dm == 1 else "s", f["yield_est_t_ha"], f["yield_est_t_ha"] * f["area_ha"], tail)
        return _act("harvest", f, "Harvest field %s" % _fname(f), why, "H")
    dry = [f for f in active if f["taw_mm"] - f["soil_water_mm"] > f["raw_mm"]
           and f["taw_mm"] - f["soil_water_mm"] >= OUTLOOK_IRRIGATION_MM]
    if dry:
        f = min(dry, key=lambda x: (x["ks"], -x["depletion_pct"]))
        deficit = f["taw_mm"] - f["soil_water_mm"]
        why = "%s holds %.0f of %.0f mm, %.0f mm short and past its %.0f mm stress line (ks %.2f), so 25 mm soaks in " \
              "without draining." % (_label(f), f["soil_water_mm"], f["taw_mm"], deficit, f["raw_mm"], f["ks"])
        return _act("irrigate", f, "Irrigate field %s" % _fname(f), why, "I", amount_mm=int(OUTLOOK_IRRIGATION_MM))
    pests = [f for f in active if f["pest_pressure"] > PEST_THRESHOLD]
    if pests:
        f = max(pests, key=lambda x: x["pest_pressure"])
        why = "Pest pressure on %s is %.2f, above the %.2f threshold; spraying resets it and protects the crop for " \
              "%d days." % (_label(f), f["pest_pressure"], PEST_THRESHOLD, SPRAY_PROTECT_DAYS)
        return _act("spray", f, "Spray field %s" % _fname(f), why, "X")
    bare = [f for f in fields if not f["planted"] and not f["harvested"]]
    for f in bare:
        if f["crop"] in PLANTABLE and in_window(day, f["crop"], lat):
            c = CROPS[f["crop"]]
            why = "It is %s and %s can go in until %s; field %s (%.0f ha) is bare and %s needs about %d days." % (
                _md(day), c["label"].lower(), _md(_window_end(day, f["crop"], lat)), _fname(f), f["area_ha"],
                c["label"].lower(), c["duration_days"])
            return _act("plant", f, "Plant %s on field %s" % (c["label"].lower(), _fname(f)), why, "P", crop=f["crop"])
    for f in bare:
        if f["crop"] in ("unknown", "other"):
            ok = [c for c in PLANTABLE if in_window(day, c, lat)]
            if ok:
                guess = ""
                if f.get("aef_pred") in CROPS and f.get("aef_confidence") is not None:
                    guess = "; AlphaEarth guesses %s (%.0f%%)" % (_crop_word(f["aef_pred"]), 100 * f["aef_confidence"])
                why = "Field %s (%.0f ha) is bare and its crop is unknown; on %s you can plant %s%s." % (
                    _fname(f), f["area_ha"], _md(day), ", ".join(c.replace("_", " ") for c in ok), guess)
                return _act("plant", f, "Choose a crop for field %s" % _fname(f), why, "P", crops=ok,
                            hint="Pick a crop to plant: " + ", ".join(ok))
    close = []
    for f in active:
        gap = f["raw_mm"] - (f["taw_mm"] - f["soil_water_mm"])
        if gap < CLOSE_RAW_MM:
            close.append((gap, "%s is %.0f mm from its stress line" % (_label(f), max(0.0, gap))))
        if f["pest_pressure"] > CLOSE_PEST:
            close.append((0.0, "pest pressure on %s is %.2f of %.2f" % (_label(f), f["pest_pressure"], PEST_THRESHOLD)))
        to_go = crop_of(f["crop"])["gdd"]["mature"] - f["gdd"]
        if f["stage"] == "grain_fill" and to_go < CLOSE_GDD:
            close.append((0.0, "%s is %.0f GDD from maturity" % (_label(f), to_go)))
    if close:
        why = "Step one day at a time: %s." % sorted(close, key=lambda x: x[0])[0][1]
        return _act("advance", None, "Advance 1 day", why, "Enter", days=1)
    if active:
        f = max(active, key=lambda x: (x["taw_mm"] - x["soil_water_mm"]) / max(1.0, x["raw_mm"]))
        why = "Nothing is urgent: the driest field, %s, is %.0f mm from its stress line at %.0f of %.0f GDD to maturity." % (
            _label(f), f["raw_mm"] - (f["taw_mm"] - f["soil_water_mm"]), f["gdd"], crop_of(f["crop"])["gdd"]["mature"])
        return _act("advance", None, "Advance 7 days", why, "Enter", days=7)
    waiting = [(_days_to_window(day, f["crop"], lat), f) for f in bare if f["crop"] in PLANTABLE]
    waiting += [(min([k for k in (_days_to_window(day, c, lat) for c in PLANTABLE) if k is not None] or [None]), f)
                for f in bare if f["crop"] in ("unknown", "other")]
    waiting = [(k, f) for k, f in waiting if k is not None]
    if waiting:
        k, f = min(waiting, key=lambda x: (x[0], -x[1]["area_ha"]))
        what = _crop_word(f["crop"]) if f["crop"] in PLANTABLE else "the next crop"
        why = "No crop is growing; the planting window for %s on field %s opens %s, %d days from now." % (
            what, _fname(f), _md(_add_days(day, k)), k)
        return _act("advance", None, "Advance 7 days", why, "Enter", days=7)
    done = [f for f in fields if f["harvested"]]
    if done:
        t = sum(f["harvest_t"] for f in done)
        why = "Every planted field (%d) is harvested: %.0f t in total and a score of %d." % (
            len(done), t, (state.get("totals") or {}).get("score", 0))
        return _act("wait", None, "Season complete", why, None)
    return _act("wait", None, "Nothing to do", "No field on this farm can be planted, watered or harvested.", None)


def _project(fs, idx, soil, day, farm_id, weekly=False, max_days=OUTLOOK_DAYS):
    """Clone a field and step it until mature, harvested or max_days; weekly=True irrigates 25 mm at most every 7 days when depletion > RAW."""
    f = copy.deepcopy(fs)
    last = None
    n = 0
    while n < max_days and f["planted"] and not f["harvested"] and f["stage"] != "mature":
        if weekly and (last is None or (_d(day) - _d(last)).days >= OUTLOOK_IRRIGATION_EVERY) \
                and f["taw_mm"] - f["soil_water_mm"] > f["raw_mm"]:
            _apply(f, "irrigate", OUTLOOK_IRRIGATION_MM, day, soil)
            last = day
        _step(f, weather_for(idx, day), soil, farm_id)
        day = _add_days(day, 1)
        n += 1
    return f


def seed_field(state, field_id, farm=None, weather_idx=None):
    """The field as it stood on the farm's start date (crop as set at init), for replays."""
    seed = state.get("_seed") or {}
    fs = state["fields"][field_id]
    ff = next((f for f in (farm or {}).get("fields") or [] if f.get("field_id") == field_id), {})
    crop = (seed.get("crops") or {}).get(field_id) or norm_crop(ff.get("crop", fs["crop"]))
    wg = seed.get("wheat_gdd")
    if wg is None:
        wg = wheat_gdd0(weather_idx or weather_index({}), state["start_date"])
    soil = _soil(state)
    return new_field_state(dict(ff, field_id=field_id, name=fs.get("name"), area_ha=fs["area_ha"], crop=crop), soil,
                           state["start_date"], wg)


def replay(state, weather, field_id, ops, farm=None, skip=("irrigate",), idx=None):
    """Re-run one field from the start date to today with the logged ops minus `skip`. Returns the field state."""
    idx = idx or weather_index(weather)
    soil = _soil(state)
    farm_id = state.get("farm_id", "")
    crop = state["fields"][field_id]["crop"]
    f = seed_field(state, field_id, farm, idx)
    by = {}
    for o in ops or []:
        if o.get("op") not in skip:
            by.setdefault(str(o["date"])[:10], []).append(o)
    day, today = state["start_date"], state["day"]
    while True:
        for o in sorted(by.get(day, []), key=lambda o: OP_ORDER.get(o["op"], 9)):
            try:
                _apply(f, o["op"], o.get("amount_mm") or 0, day, soil, crop if o["op"] == "plant" else None)
            except OpError:
                pass
        if day >= today or f["harvested"]:
            return f
        _step(f, weather_for(idx, day), soil, farm_id)
        day = _add_days(day, 1)


def _summary(f, area):
    c = crop_of(f["crop"])
    if f["harvested"]:
        y, t = f["yield_t_ha"] or 0.0, f["harvest_t"]
    else:
        y = f["yield_est_t_ha"] if f["planted"] else 0.0
        per = y / max(1, c["max_cuts"]) if f["crop"] in FORAGES else y
        t = (f["model"]["harvest_t_ha"] + per) * area
    return {"yield_est_t_ha": _r(y, 2), "harvest_t": _r(t), "mature_date": f["mature_date"],
            "stress_days": int(f["stress_days"]), "irrigation_mm": _r(f["irrigation_mm"]),
            "water_m3": int(round(f["irrigation_mm"] * 10.0 * area))}


def ndvi_context(fs, season_year, latest=None):
    """Historical peak NDVI for a field against this season's peak so far."""
    h = fs.get("ndvi_history") or {}
    latest = _num(latest)
    years = [y for y in h.get("years") or [] if y[0] < season_year] or list(h.get("years") or [])
    mean = sum(p for _, p in years) / len(years) if years else _num(h.get("mean_peak"))
    span = ("%d-%d" % (years[0][0], years[-1][0]) if len(years) > 1 else str(years[0][0])) if years else "past years"
    rel = latest / mean if latest is not None and mean else None
    if rel is not None:
        pct = round(100 * (rel - 1))
        note = "This season's NDVI is %s the %s average for this field" % (
            "level with" if pct == 0 else "%d%% %s" % (abs(pct), "below" if pct < 0 else "above"), span)
    elif mean is not None:
        note = "Peak NDVI averaged %.2f over %s; no clear scene this season yet" % (mean, span)
    else:
        note = "No NDVI history for this field yet"
    return {"peak_ndvi_years": years, "mean_peak": None if mean is None else _r(mean, 3),
            "this_year_peak_so_far": None if latest is None else _r(latest, 3),
            "relative_index": None if rel is None else _r(rel, 2), "note": note}


def outlook(state, weather, field_id, ops=None, farm=None, crop=None, ndvi_latest=None, no_irrigation=None, idx=None):
    """Rest-of-season projection for one field: as-is, without any irrigation this season, and with weekly 25 mm when dry."""
    fs = state["fields"].get(field_id)
    if fs is None:
        raise OpError("unknown field_id '%s'" % field_id, "use one of " + ", ".join(sorted(state["fields"])[:12]))
    idx = idx or weather_index(weather)
    soil = _soil(state)
    farm_id, day, area = state.get("farm_id", ""), state["day"], fs["area_ha"]
    base = copy.deepcopy(fs)
    assumed = False
    if not base["planted"]:
        _apply(base, "plant", 0, day, soil, crop)
        assumed = True
    now = _project(base, idx, soil, day, farm_id)
    weekly = _project(base, idx, soil, day, farm_id, weekly=True)
    if no_irrigation is None:
        irrigated = fs["irrigation_mm"] > 0 or any((o.get("op") == "irrigate") for o in ops or [])
        if irrigated:
            past = replay(dict(state, fields=dict(state["fields"], **{field_id: base})), weather, field_id,
                          list(ops or []) + ([{"date": day, "op": "plant"}] if assumed else []), farm, idx=idx)
            no_irrigation = _summary(_project(past, idx, soil, day, farm_id), area)
        else:
            no_irrigation = _summary(now, area)
    return {"field_id": field_id, "name": fs.get("name"), "crop": base["crop"], "as_of": day,
            "assumes_planting_today": assumed, "harvested": bool(fs["harvested"]),
            "now": _summary(now, area), "no_irrigation": no_irrigation, "weekly_irrigation": _summary(weekly, area),
            "history": ndvi_context(fs, _d(day).year, ndvi_latest)}
