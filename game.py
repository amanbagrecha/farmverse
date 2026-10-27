"""FarmVerse game API (load/init/advance/op/series/outlook/set/reset/list/rewind) over a DuckDB file in .fused/data."""
import datetime as dt
import json
import os
import sys
import time
import traceback

APP_DIR = os.path.dirname(os.path.abspath(__file__))
if APP_DIR not in sys.path:
    sys.path.insert(0, APP_DIR)

import sim

DB_PATH = os.path.join(APP_DIR, ".fused", "data", "farmverse.duckdb")
MAX_ADVANCE_DAYS = 366
LOCK_RETRIES = 3
ACTIONS = ("load", "init", "advance", "op", "series", "outlook", "set", "reset", "list", "rewind")

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS farms (farm_id VARCHAR PRIMARY KEY, title VARCHAR, farm_json VARCHAR, "
    "weather_json VARCHAR, created_at VARCHAR)",
    "CREATE TABLE IF NOT EXISTS state (farm_id VARCHAR PRIMARY KEY, state_json VARCHAR, updated_at VARCHAR)",
    "CREATE TABLE IF NOT EXISTS ops_log (farm_id VARCHAR, date DATE, field_id VARCHAR, op VARCHAR, "
    "amount_mm DOUBLE, note VARCHAR, crop VARCHAR)",
    "ALTER TABLE ops_log ADD COLUMN IF NOT EXISTS crop VARCHAR",
    "CREATE TABLE IF NOT EXISTS events (farm_id VARCHAR, seq INTEGER, date DATE, field_id VARCHAR, kind VARCHAR, "
    "text VARCHAR)",
    "CREATE TABLE IF NOT EXISTS field_days (farm_id VARCHAR, date DATE, field_id VARCHAR, soil_water_mm DOUBLE, "
    "taw_mm DOUBLE, raw_mm DOUBLE, ks DOUBLE, health INTEGER, yield_est_t_ha DOUBLE, irrigation_mm DOUBLE, "
    "rain_mm DOUBLE, et0 DOUBLE, stage VARCHAR)",
)
DAY_COLS = ("date", "field_id", "soil_water_mm", "taw_mm", "raw_mm", "ks", "health", "yield_est_t_ha",
            "irrigation_mm", "rain_mm", "et0", "stage")


UserError = sim.OpError


def _now():
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _lit(v):
    """SQL literal for a JSON-native value (quote-doubled strings)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return repr(v) if v == v and abs(v) != float("inf") else "NULL"
    return "'" + str(v).replace("'", "''") + "'"


def _q(con, sql, params=()):
    """Execute with ? placeholders inlined as literals; DuckDB's parameter binding imports pandas (~250 ms)."""
    parts = sql.split("?")
    if len(parts) - 1 != len(params):
        raise ValueError("placeholder count mismatch")
    out = [parts[0]]
    for v, tail in zip(params, parts[1:]):
        out.append(_lit(v))
        out.append(tail)
    return con.execute("".join(out))


def _connect():
    """Open the DuckDB file, retrying while another call holds its lock."""
    import duckdb
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    for attempt in range(LOCK_RETRIES + 1):
        try:
            con = duckdb.connect(DB_PATH)
            break
        except duckdb.Error as e:
            if "lock" not in str(e).lower():
                raise
            if attempt == LOCK_RETRIES:
                raise UserError("the game database is busy", "another FarmVerse call is running; retry in a moment")
            time.sleep(0.3 * (2 ** attempt))
    for q in SCHEMA:
        con.execute(q)
    return con


def _days(p):
    try:
        days = int(p.get("days", 1))
    except (TypeError, ValueError):
        raise UserError("days must be an integer", "e.g. {\"days\": 7}")
    if not 1 <= days <= MAX_ADVANCE_DAYS:
        raise UserError("days must be between 1 and %d" % MAX_ADVANCE_DAYS, "move in smaller steps")
    return days


def _date(v, what):
    try:
        return sim._d(v).isoformat()
    except ValueError:
        raise UserError("%s '%s' is not a date" % (what, v), "use YYYY-MM-DD")


def _insert_days(con, farm_id, rows):
    _insert_many(con, "field_days", 13, [[farm_id] + [r[c] for c in DAY_COLS] for r in rows])


def _payload(payload):
    if not payload:
        return {}
    try:
        p = json.loads(payload)
    except (TypeError, ValueError):
        raise UserError("payload is not valid JSON", "pass payload as a JSON object string, e.g. {\"days\": 1}")
    if not isinstance(p, dict):
        raise UserError("payload must be a JSON object", "e.g. {\"field_id\": \"F01\", \"op\": \"irrigate\"}")
    return p


def _get_farm(con, farm_id):
    row = _q(con, "SELECT farm_json, weather_json FROM farms WHERE farm_id = ?", [farm_id]).fetchone()
    if not row:
        return None, None
    return json.loads(row[0]), json.loads(row[1] or "{}")


def _get_state(con, farm_id):
    row = _q(con, "SELECT state_json FROM state WHERE farm_id = ?", [farm_id]).fetchone()
    return json.loads(row[0]) if row else None


def _require(con, farm_id):
    farm, weather = _get_farm(con, farm_id)
    state = _get_state(con, farm_id)
    if farm is None or state is None:
        raise UserError("no farm '%s'" % farm_id, "call action=init with a farm and weather payload first")
    return farm, weather, sim.upgrade_state(state)


def _save_state(con, farm_id, state):
    _q(con, "INSERT OR REPLACE INTO state VALUES (?, ?, ?)", [farm_id, json.dumps(state), _now()])


def _insert_events(con, farm_id, events):
    if not events:
        return
    seq = _q(con, "SELECT coalesce(max(seq), 0) FROM events WHERE farm_id = ?", [farm_id]).fetchone()[0]
    rows = [[farm_id, seq + i + 1, e["date"], e.get("field_id"), e["kind"], e["text"]] for i, e in enumerate(events)]
    _insert_many(con, "events", 6, rows)


def _insert_many(con, table, ncols, rows, chunk=300):
    """Multi-row VALUES inserts (much faster than executemany in DuckDB)."""
    ph = "(" + ",".join(["?"] * ncols) + ")"
    for i in range(0, len(rows), chunk):
        part = rows[i:i + chunk]
        flat = [v for r in part for v in r]
        _q(con, "INSERT INTO %s VALUES %s" % (table, ",".join([ph] * len(part))), flat)


def _delete_farm(con, farm_id):
    n = _q(con, "SELECT count(*) FROM farms WHERE farm_id = ?", [farm_id]).fetchone()[0]
    for t in ("farms", "state", "ops_log", "events", "field_days"):
        _q(con, "DELETE FROM %s WHERE farm_id = ?" % t, [farm_id])
    return n > 0


def _strip(state):
    """State as sent to the page: internal model accumulators and _-prefixed keys removed."""
    out = {k: v for k, v in state.items() if not k.startswith("_")}
    out["fields"] = {k: {kk: vv for kk, vv in v.items() if kk != "model"} for k, v in state["fields"].items()}
    return out


def _do_init(con, farm_id, p):
    farm, weather = p.get("farm"), p.get("weather") or {}
    if not isinstance(farm, dict) or not farm.get("fields"):
        raise UserError("payload.farm has no fields", "pass the eo.py action=farm result as payload.farm")
    if not isinstance(weather, dict):
        raise UserError("payload.weather must be an object", "pass the eo.py action=weather result")
    start = p.get("start_date")
    if start:
        _date(start, "start_date")
    title = p.get("title") or farm.get("title") or farm_id
    bounds = _bounds(p.get("bounds")) or _bounds(farm.get("bounds"))
    history, aef = p.get("history"), p.get("aef")
    prev = _get_state(con, farm_id)
    state = sim.new_state(farm, weather, start, farm_id, title, history=history, aef=aef)
    state["ui"] = dict((prev or {}).get("ui") or {})
    state["bounds"] = bounds
    farm = dict(farm, farm_id=farm_id, title=title, bounds=bounds)
    if sim._ok(history):
        farm["cdl_history"] = {k: history.get(k) for k in ("years", "available", "source")}
    if sim._ok(aef):
        farm["aef"] = {k: v for k, v in aef.items() if k != "fields" and not k.startswith("_")}
    con.execute("BEGIN TRANSACTION")
    _delete_farm(con, farm_id)
    _q(con, "INSERT INTO farms VALUES (?, ?, ?, ?, ?)", [farm_id, title, json.dumps(farm), json.dumps(weather), _now()])
    _save_state(con, farm_id, state)
    con.execute("COMMIT")
    return {"farm": farm, "state": _strip(state)}


def _do_advance(con, farm_id, p):
    days = _days(p)
    farm, weather, state = _require(con, farm_id)
    state, events, rows = sim.advance(state, weather, days, farm_id)
    con.execute("BEGIN TRANSACTION")
    _save_state(con, farm_id, state)
    _insert_events(con, farm_id, events)
    _insert_days(con, farm_id, rows)
    con.execute("COMMIT")
    return {"state": _strip(state), "events": events}


def _bounds(b):
    """[w, s, e, n] floats from a list or a "w,s,e,n" string; None when malformed."""
    if isinstance(b, str):
        b = b.split(",")
    if not isinstance(b, (list, tuple)) or len(b) != 4:
        return None
    try:
        return [float(v) for v in b]
    except (TypeError, ValueError):
        return None


def _ops(con, farm_id, field_id):
    rows = _q(con, "SELECT strftime(date, '%Y-%m-%d'), op, amount_mm FROM ops_log WHERE farm_id = ? AND field_id = ? "
                   "ORDER BY date, rowid", [farm_id, field_id]).fetchall()
    return [{"date": d, "op": o, "amount_mm": a} for d, o, a in rows]


def _outlook(con, farm_id, farm, weather, state, field_id, crop=None, latest=None, no_irrigation=None, idx=None):
    return sim.outlook(state, weather, field_id, _ops(con, farm_id, field_id), farm, crop, latest, no_irrigation, idx)


def _feed_ndvi(farm_id, field_id, day):
    """({"years": [[year, peak NDVI]]} | None, this season's peak NDVI in the 120 days before `day` | None) from the farm's feed parts."""
    import glob

    import eo

    folder = os.path.join(eo.FEED_DIR, farm_id)
    cols = lambda path: (eo.read_part(path) or {}).get("cols") or {}
    years = []
    for path in sorted(glob.glob(os.path.join(folder, "pheno_*.parquet"))):
        c = cols(path)
        years += [[y, pk] for f, y, pk in zip(c.get("field_id", []), c.get("year", []), c.get("peak_ndvi", [])) if f == field_id and pk is not None]
    c, start = cols(os.path.join(folder, "ndvi_%s.parquet" % day[:4])), sim._add_days(day, -120)
    seen = [v for f, d, v in zip(c.get("field_id", []), c.get("date", []), c.get("ndvi", [])) if f == field_id and start < d <= day]
    return ({"years": years} if years else None), (max(seen) if seen else None)


def _do_outlook(con, farm_id, p):
    field_id = str(p.get("field_id") or "")
    if not field_id:
        raise UserError("payload needs field_id", "e.g. {\"field_id\": \"F01\"}")
    farm, weather, state = _require(con, farm_id)
    fs = state["fields"].get(field_id)
    if fs is None:
        raise UserError("unknown field_id '%s'" % field_id, "use one of " + ", ".join(sorted(state["fields"])[:12]))
    fs["ndvi_history"], latest = _feed_ndvi(farm_id, field_id, state["day"])
    return _outlook(con, farm_id, farm, weather, state, field_id, p.get("crop"), latest)


def _do_set(con, farm_id, p):
    farm, weather, state = _require(con, farm_id)
    ui = dict(state.get("ui") or {})
    for k, v in p.items():
        if v is None:
            ui.pop(k, None)
        else:
            ui[k] = v
    state["ui"] = ui
    _save_state(con, farm_id, state)
    return {"state": _strip(state)}


def _do_op(con, farm_id, p):
    field_id, op = p.get("field_id"), p.get("op")
    if not field_id or not op:
        raise UserError("payload needs field_id and op", "e.g. {\"field_id\": \"F01\", \"op\": \"irrigate\", \"amount_mm\": 25}")
    amount = p.get("amount_mm")
    if op == "irrigate" and amount in (None, "", 0):
        amount = 25
    farm, weather, state = _require(con, farm_id)
    before = None
    idx = sim.weather_index(weather)
    if op == "irrigate" and str(field_id) in state["fields"] and state["fields"][str(field_id)]["planted"] \
            and not state["fields"][str(field_id)]["harvested"]:
        before = _outlook(con, farm_id, farm, weather, state, str(field_id), idx=idx)
    state, events, row = sim.apply_state_op(state, weather, str(field_id), str(op), amount or 0, p.get("crop"))
    extra = {}
    if before is not None:
        after = _outlook(con, farm_id, farm, weather, state, str(field_id), no_irrigation=before["no_irrigation"], idx=idx)
        extra["outlook"] = {"before": before, "after": after}
    con.execute("BEGIN TRANSACTION")
    _save_state(con, farm_id, state)
    _q(con, "INSERT INTO ops_log VALUES (?, ?, ?, ?, ?, ?, ?)", [farm_id, row["date"], row["field_id"], row["op"], float(row["amount_mm"] or 0), row["note"], p.get("crop")])
    _insert_events(con, farm_id, events)
    con.execute("COMMIT")
    return dict({"state": _strip(state), "events": events}, **extra)


REWIND_META = ("name", "crop_source", "crop_history", "rotation", "typical_crop", "aef_class", "aef_pred", "aef_confidence")


def _target_day(state, p):
    start, today = state["start_date"], state["day"]
    if p.get("day"):
        target = _date(p["day"], "day")
    else:
        target = sim._add_days(today, -_days(p))
    if target < start:
        target = start
    if target >= today:
        raise UserError("day %s is not before today (%s)" % (target, today), "rewind goes back only; use advance to go forward")
    return target


def _fresh_state(farm, weather, state):
    """The state at season start, rebuilt from the stored farm and weather with the per-field metadata the current state carries."""
    seed = state.get("_seed") or {}
    fresh = sim.new_state(farm, weather, state["start_date"], state["farm_id"], state.get("title"))
    for fid, fs in fresh["fields"].items():
        old = state["fields"].get(fid) or {}
        crop = (seed.get("crops") or {}).get(fid)
        if crop and crop != fs["crop"]:
            fs.update(sim.new_field_state(dict(next(f for f in farm["fields"] if f["field_id"] == fid), crop=crop),
                                          fresh.get("soil"), fresh["start_date"], (seed.get("wheat_gdd") if seed else None) or 0.0))
            fs["crop"] = crop
        for k in REWIND_META:
            if k in old:
                fs[k] = old[k]
    fresh["ui"] = dict(state.get("ui") or {})
    fresh["bounds"] = state.get("bounds")
    sim._finish(fresh, sim.weather_index(weather))
    return fresh


def _do_rewind(con, farm_id, p):
    farm, weather, state = _require(con, farm_id)
    target = _target_day(state, p)
    ops = _q(con, "SELECT strftime(date, '%Y-%m-%d'), field_id, op, amount_mm, crop FROM ops_log WHERE farm_id = ? "
                  "ORDER BY date, rowid", [farm_id]).fetchall()
    keep = [o for o in ops if o[0] < target]
    dropped = len(ops) - len(keep)
    cur = _fresh_state(farm, weather, state)
    rows = []

    def run_to(day):
        nonlocal cur
        n = (dt.date.fromisoformat(day) - dt.date.fromisoformat(cur["day"])).days
        if n > 0:
            cur, _, r = sim.advance(cur, weather, n, farm_id)
            rows.extend(r)

    for day, fid, op, amount, crop in keep:
        run_to(day)
        if crop is None and op == "plant" and (state["fields"].get(fid) or {}).get("crop_source") == "player":
            crop = state["fields"][fid].get("crop")
        try:
            cur, _, _ = sim.apply_state_op(cur, weather, fid, op, amount or 0, crop)
        except sim.OpError:
            continue
    run_to(target)
    con.execute("BEGIN TRANSACTION")
    _q(con, "DELETE FROM ops_log WHERE farm_id = ? AND date >= ?", [farm_id, target])
    _q(con, "DELETE FROM events WHERE farm_id = ? AND date >= ?", [farm_id, target])
    _q(con, "DELETE FROM field_days WHERE farm_id = ?", [farm_id])
    _insert_days(con, farm_id, rows)
    _save_state(con, farm_id, cur)
    con.execute("COMMIT")
    text = "Rewound to %s" % sim._md(target) + (", %d later move%s undone" % (dropped, "" if dropped == 1 else "s") if dropped else "")
    return {"state": _strip(cur), "events": [{"date": target, "field_id": None, "kind": "rewind", "text": text}],
            "dropped_ops": dropped, "replayed_ops": len(keep)}


def _do_series(con, farm_id, p):
    field_id = p.get("field_id")
    if not field_id:
        raise UserError("payload needs field_id", "e.g. {\"field_id\": \"F01\"}")
    rows = _q(
        con,
        "SELECT strftime(date, '%Y-%m-%d'), soil_water_mm, taw_mm, raw_mm, rain_mm, irrigation_mm, et0, ks, stage, "
        "health, yield_est_t_ha FROM field_days WHERE farm_id = ? AND field_id = ? ORDER BY date",
        [farm_id, str(field_id)]).fetchall()
    keys = ("date", "soil_water_mm", "taw_mm", "raw_mm", "rain_mm", "irrigation_mm", "et0", "ks", "stage", "health",
            "yield_est_t_ha")
    days = [{k: (None if v is None else int(v) if k == "health" else float(v) if isinstance(v, (int, float)) else v)
             for k, v in zip(keys, r)} for r in rows]
    return {"field_id": str(field_id), "days": days}


def _do_load(con, farm_id, p):
    farm, _ = _get_farm(con, farm_id)
    state = _get_state(con, farm_id)
    return {"farm": farm, "state": _strip(sim.upgrade_state(state)) if state else None}


def _do_reset(con, farm_id, p):
    con.execute("BEGIN TRANSACTION")
    deleted = _delete_farm(con, farm_id)
    con.execute("COMMIT")
    return {"ok": True, "farm_id": farm_id, "deleted": deleted}


def _do_list(con):
    out = []
    for fid, title, created, day, bounds in con.execute(
            "SELECT f.farm_id, f.title, f.created_at, json_extract_string(s.state_json, '$.day'), "
            "CAST(json_extract(f.farm_json, '$.bounds') AS VARCHAR) FROM farms f LEFT JOIN state s USING (farm_id) "
            "ORDER BY f.created_at").fetchall():
        try:
            b = _bounds(json.loads(bounds)) if bounds else None
        except ValueError:
            b = None
        out.append({"farm_id": fid, "title": title, "bounds": b, "day": day, "created_at": created})
    return out


def main(action: str = "load", farm_id: str = "story-iowa", payload: str = ""):
    """Run one game action; returns JSON-native data or {"error", "hint"}."""
    t0 = time.time()
    action = (action or "load").strip().lower()
    farm_id = (farm_id or "story-iowa").strip()
    if action not in ACTIONS:
        return {"error": "unknown action '%s'" % action, "hint": "action is one of " + ", ".join(ACTIONS)}
    con = None
    try:
        p = _payload(payload)
        con = _connect()
        if action == "list":
            return _do_list(con)
        out = {"load": _do_load, "init": _do_init, "advance": _do_advance, "op": _do_op, "series": _do_series,
               "outlook": _do_outlook, "set": _do_set, "rewind": _do_rewind, "reset": _do_reset}[action](con, farm_id, p)
        out["_ms"] = int((time.time() - t0) * 1000)
        return out
    except UserError as e:
        return {"error": str(e), "hint": e.hint}
    except Exception as e:
        traceback.print_exc()
        return {"error": "%s: %s" % (type(e).__name__, e), "hint": "unexpected failure in game.py; see the python console"}
    finally:
        if con is not None:
            try:
                con.close()
            except Exception:
                pass
