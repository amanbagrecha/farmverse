"""FarmVerse Earth-observation proxy: runs eo_udf.py on Fused with the user's own sign-in or on this Mac, whichever the
Run on setting in .fused/data/settings.json says (place and roads stay local via OpenStreetMap), and caches the JSON in
.fused/cache/eo/."""

import hashlib
import importlib.util
import json
import os
import re
import sys
import threading
import time

T0 = time.time()
APP_DIR = os.path.dirname(os.path.abspath(__file__))
CACHE_DIR = os.path.join(APP_DIR, ".fused", "cache", "eo")
SETTINGS_FILE = os.path.join(APP_DIR, ".fused", "data", "settings.json")
UDF_FILE = os.path.join(APP_DIR, "eo_udf.py")
UDF_CACHE_DIR = os.path.join(APP_DIR, ".fused", "cache", "udf")
VERSION = "v3"
TTL_S = {"farm": 7 * 86400, "ndvi_grid": 7 * 86400, "weather": 6 * 3600, "cdl_history": 7 * 86400, "aef_fields": 7 * 86400}
DEADLINE_S = 54
ENGINES = ("fused", "local")
LOCAL_PACKAGES = ("rasterio", "shapely", "pyproj", "geopandas", "affine", "fsspec", "aiohttp", "pyarrow", "numpy", "pandas", "icechunk",
                  "zarr")
ACCOUNT_TTL_S = 600
ACCOUNT_TIMEOUT_S = 20
SIGN_IN = "Sign in to Fused from the prompt in FarmVerse, or set Run on to This Mac (no account needed)."
LOCAL_MISSING = ("This Mac is missing a Python package for the local engine; open FarmVerse again so fused-render installs them, "
                 "or set Run on to Fused.")
LOCAL_SLOW = "This Mac took too long; try again (finished parts are cached) or set Run on to Fused."
LOCAL_OFFLINE = "This Mac cannot reach the satellite data; check the connection or set Run on to Fused."
AUTH_WORDS = ("401", "403", "credential", "login", "token", "not logged")
NETWORK_WORDS = ("connection", "resolve", "network")
LOCAL_TTL_S = 30 * 86400
FEED_DIR = os.path.join(APP_DIR, ".fused", "cache", "feed")
FEED_YEARS = 4
FEED_TTL_S = {"weather": 12 * 3600, "forecast": 3 * 3600, "climatology": 90 * 86400, "past": 90 * 86400, "now": 86400}
FEED_JOB = "_build.json"
FEED_LOCK = "_build.lock"
FEED_LOG = "_build.log"
FEED_STEP_S = 900
FEED_BEAT_S = 15
UA = "FarmVerse/0.1 (fused-render app)"
NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_TIMEOUT_S = 8
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.openstreetmap.fr/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
OVERPASS_TIMEOUT_S = 25
OVERPASS_BUDGET_S = 48
HIGHWAYS = "motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|track"
MINOR_MIN_M = 300.0
LOCALITY_KEYS = ("city", "town", "village", "hamlet", "locality", "municipality", "county")


def main(action: str = "farm", **kw) -> dict:
    """Run eo_udf.py's `action` on the saved engine (Fused with the user's own sign-in, or this Mac) with every other kw as
    a string param; cached JSON in .fused/cache/eo/ plus _cached, _ms and _engine. Fused with no sign-in answers
    {"error", "hint", "signin": True} without calling the SDK. `settings`, `account`, `place`, `roads` and `feed` run here."""
    local = {"place": place, "roads": roads, "settings": configure, "account": account, "feed": feed}
    if action in local:
        return local[action](**kw)
    if action not in TTL_S:
        return {"error": f"unknown action {action!r}", "hint": f"use one of {sorted(TTL_S) + sorted(local)}"}
    params = {str(k): "" if v is None else str(v) for k, v in kw.items()}
    return cached("fv_" + action, params, TTL_S[action], lambda: run_action(action, params))


def run_action(action: str = "farm", params: dict | None = None) -> dict:
    """One fresh eo_udf.py run on the saved engine; failures answer {"error", "hint"} (plus "signin" for a sign-in problem)."""
    engine = settings()["engine"]
    if engine == "fused" and not os.path.isfile(credentials_file()):
        return {"error": "Not signed in to Fused", "hint": SIGN_IN, "signin": True}
    try:
        out = run_udf(action, params, engine)
    except Exception as err:
        hint = hint_for(err, engine)
        return {"error": short(err), "hint": hint, **({"signin": True} if hint == SIGN_IN else {}), "_engine": engine}
    if not isinstance(out, dict):
        return {"error": f"{action} returned {type(out).__name__}, expected a JSON object", "hint": "check eo_udf.py", "_engine": engine}
    return {**out, "_engine": engine}


def cached(name: str = "", params: dict | None = None, ttl_s: float = 0, make=None) -> dict:
    """make()'s dict, cached in .fused/cache/eo/ for ttl_s unless it holds an "error"; plus _cached and _ms."""
    t0 = time.time()
    path = os.path.join(CACHE_DIR, cache_key(name, params) + ".json")
    hit = read_json(path, ttl_s)
    if hit is not None:
        return {**hit, "_cached": True, "_ms": ms(t0)}
    out = make()
    if "error" not in out:
        write_cache(path, out)
    return {**out, "_cached": False, "_ms": ms(t0)}


def ms(t0: float = 0) -> int:
    return int((time.time() - t0) * 1000)


def settings() -> dict:
    """The saved settings from .fused/data/settings.json with `engine` always "fused" or "local" (default "fused")."""
    saved = read_json(SETTINGS_FILE) or {}
    return {**saved, "engine": saved["engine"] if saved.get("engine") in ENGINES else "fused"}


def configure(engine: str | None = None, **_) -> dict:
    """Action `settings`: save `engine` ("fused" or "local") when given, then report {"engine", "signed_in", "local_ready",
    "missing"}; an engine outside ENGINES answers {"error", "hint"} and saves nothing."""
    if engine not in (None, ""):
        if engine not in ENGINES:
            return {"error": f"engine must be one of {list(ENGINES)}, got {engine!r}",
                    "hint": 'pass engine "fused" (Run on Fused) or "local" (Run on This Mac)'}
        try:
            write_json(SETTINGS_FILE, {**settings(), "engine": engine})
        except OSError as err:
            return {"error": short(err), "hint": "the choice could not be saved; check the app folder is writable"}
    missing = local_missing()
    return {"engine": settings()["engine"], "signed_in": os.path.isfile(credentials_file()), "local_ready": not missing,
            "missing": missing}


def local_missing() -> list:
    """Import names from LOCAL_PACKAGES that this interpreter cannot find (find_spec only, nothing is imported)."""
    out = []
    for name in LOCAL_PACKAGES:
        try:
            found = importlib.util.find_spec(name) is not None
        except (ImportError, ValueError):
            found = False
        if not found:
            out.append(name)
    return out


def credentials_file() -> str:
    """Path of the Fused sign-in file: FUSED_RENDER_FUSED_CREDENTIALS, else ~/.fused/credentials."""
    return os.environ.get("FUSED_RENDER_FUSED_CREDENTIALS") or os.path.expanduser("~/.fused/credentials")


def account(refresh: str = "", **_) -> dict:
    """Action `account`: {"signed_in", "email", "handle"} plus "detail" when whoami failed; never an "error" key. No
    credentials file is signed out without touching the SDK; otherwise `fused.api.whoami()` once, cached 10 minutes in
    .fused/cache/eo/account.json for that file's mtime (refresh="1" skips the cache). A whoami that cannot reach Fused
    (offline, timeout) keeps signed_in true with a detail, since the credentials exist; any other failure is signed out."""
    out = {"signed_in": False, "email": None, "handle": None}
    creds = credentials_file()
    if not os.path.isfile(creds):
        return out
    stamp = os.path.getmtime(creds)
    path = os.path.join(CACHE_DIR, "account.json")
    hit = None if str(refresh) == "1" else read_json(path, ACCOUNT_TTL_S)
    if hit is not None and hit.get("stamp") == stamp:
        return {k: hit.get(k) for k in out}
    try:
        info = call_bounded(lambda: real_fused().api.whoami(), min(ACCOUNT_TIMEOUT_S, remaining_s()), "whoami")
        info = info if isinstance(info, dict) else {}
    except Exception as err:
        if is_auth(err) or not (is_timeout(err) or is_network(err)):
            return {**out, "detail": short(err)}
        return {**out, "signed_in": True, "detail": f"signed in, but Fused could not be reached to confirm it: {short(err)}"}
    out = {"signed_in": True, "email": info.get("email"), "handle": info.get("handle")}
    write_cache(path, {**out, "stamp": stamp})
    return out


def place(lat: str = "42.179", lon: str = "-93.35", **_) -> dict:
    """Reverse geocode one point with OpenStreetMap Nominatim (zoom 14, then 10 when nothing locality-like comes back); cached 30 days."""
    try:
        la, lo = round(float(lat), 4), round(float(lon), 4)
    except (TypeError, ValueError):
        return {"error": f"bad lat/lon {lat!r}, {lon!r}", "hint": "pass decimal degrees as strings"}
    if not (-90 <= la <= 90 and -180 <= lo <= 180):
        return {"error": f"lat/lon out of range {la}, {lo}", "hint": "lat in -90..90, lon in -180..180"}

    def make():
        try:
            addr = nominatim(la, lo, 14)
            if not any(addr.get(k) for k in LOCALITY_KEYS):
                addr = {**nominatim(la, lo, 10), **{k: v for k, v in addr.items() if v}}
        except Exception as err:
            return {"error": short(err), "hint": "OpenStreetMap Nominatim did not answer; check the connection and retry."}
        out = place_from_address(addr)
        if not out["title"]:
            return {"error": "Nominatim found no place here", "hint": "the point may be at sea; try another box"}
        return {**out, "lat": la, "lon": lo, "source": "OpenStreetMap Nominatim"}

    return cached("place", {"lat": str(la), "lon": str(lo)}, LOCAL_TTL_S, make)


def nominatim(lat: float = 0.0, lon: float = 0.0, zoom: int = 14) -> dict:
    """One reverse request; the `address` dict (empty when Nominatim answers an error)."""
    import requests

    r = requests.get(NOMINATIM, params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": zoom, "accept-language": "en"},
                     headers={"User-Agent": UA}, timeout=NOMINATIM_TIMEOUT_S)
    if r.status_code != 200:
        raise RuntimeError(f"Nominatim {r.status_code}: {r.text[:200]}")
    body = r.json()
    addr = body.get("address") if isinstance(body, dict) else None
    return addr if isinstance(addr, dict) else {}


def place_from_address(addr: dict | None = None) -> dict:
    """Title "<finest locality>, <state or country>" and region "<county>, <state>, <country>" from a Nominatim address dict."""
    addr = addr or {}
    get = lambda k: str(addr.get(k) or "").strip()
    loc = next((get(k) for k in LOCALITY_KEYS if get(k)), "")
    county, state, country = get("county"), get("state") or get("region") or get("province"), get("country")
    title = ", ".join(p for p in (loc, state or country) if p)
    region = ", ".join(p for p in (county, state, country) if p and p != loc)
    return {"title": title, "region": region, "locality": loc, "county": county, "state": state, "country": country}


def roads(bounds: str = "", cols: int = 64, rows: int = 64, **_) -> dict:
    """OpenStreetMap roads inside the farm box from the Overpass API, rasterized into the tile grid; cached 30 days."""
    try:
        box = [round(float(v), 5) for v in str(bounds).split(",")]
        cols, rows = int(cols), int(rows)
        if len(box) != 4 or box[0] >= box[2] or box[1] >= box[3] or cols < 1 or rows < 1 or cols * rows > 16384:
            raise ValueError(bounds)
    except (TypeError, ValueError):
        return {"error": f"bad bounds {bounds!r} or grid {cols}x{rows}", "hint": "bounds is \"w,s,e,n\" with w<e, s<n; cols*rows <= 16384"}

    def make():
        try:
            ways = overpass_ways(box)
        except Exception as err:
            return {"error": short(err), "hint": "The Overpass API is busy; roads load on a later try and are then cached for 30 days."}
        out = rasterize_ways(ways, box, cols, rows)
        return {**out, "n_ways": len(out["ways"]), "source": "OpenStreetMap via Overpass", "bounds": box, "cols": cols, "rows": rows}

    return cached("roads", {"bounds": ",".join(str(v) for v in box), "cols": str(cols), "rows": str(rows)}, LOCAL_TTL_S, make)


def overpass_ways(box: list | None = None) -> list:
    """Highway ways touching the box as [{"name", "highway", "geometry": [[lon, lat], ...]}], trying each Overpass mirror in turn."""
    import requests

    w, s, e, n = box
    query = f'[out:json][timeout:20]; way["highway"~"^({HIGHWAYS})$"]({s},{w},{n},{e}); out geom;'
    errors, t0, elements = [], time.time(), None
    for url in OVERPASS:
        left = OVERPASS_BUDGET_S - (time.time() - t0)
        if left < 3:
            break
        host = url.split("/")[2]
        try:
            r = requests.post(url, data={"data": query}, headers={"User-Agent": UA}, timeout=min(OVERPASS_TIMEOUT_S, left))
            if r.status_code != 200:
                raise RuntimeError(f"{host} answered {r.status_code}")
            elements = r.json().get("elements", [])
            break
        except Exception as err:
            errors.append(f"{host}: {type(err).__name__}")
    if elements is None:
        raise RuntimeError("no Overpass mirror answered (" + "; ".join(errors) + ")")
    ways = []
    for el in elements:
        if el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        geom = [[float(p["lon"]), float(p["lat"])] for p in el.get("geometry") or [] if "lon" in p and "lat" in p]
        if len(geom) >= 2:
            ways.append({"name": str(tags.get("name") or tags.get("ref") or ""), "highway": str(tags.get("highway") or ""), "geometry": geom})
    return ways


def way_length_m(geometry: list | None = None) -> float:
    """Equirectangular length in metres of a [[lon, lat], ...] line."""
    import math

    total = 0.0
    pts = geometry or []
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        dx = (x1 - x0) * 111320.0 * math.cos(math.radians((y0 + y1) / 2))
        dy = (y1 - y0) * 110574.0
        total += math.hypot(dx, dy)
    return total


def bresenham(i0: int = 0, j0: int = 0, i1: int = 0, j1: int = 0) -> list:
    """Integer tiles from (i0, j0) to (i1, j1) inclusive."""
    di, dj = abs(i1 - i0), -abs(j1 - j0)
    si, sj = (1 if i0 < i1 else -1), (1 if j0 < j1 else -1)
    err, out = di + dj, []
    while True:
        out.append((i0, j0))
        if i0 == i1 and j0 == j1:
            return out
        e2 = 2 * err
        if e2 >= dj:
            err += dj
            i0 += si
        if e2 <= di:
            err += di
            j0 += sj


def rasterize_ways(ways: list | None = None, bounds: list | None = None, cols: int = 64, rows: int = 64) -> dict:
    """Tiles each way crosses (t = j * cols + i, i west to east, j north to south), clipped to the grid; track and service
    ways shorter than MINOR_MIN_M get none."""
    w, s, e, n = [float(v) for v in bounds]
    sx, sy = cols / (e - w), rows / (n - s)
    import math

    out_ways, all_tiles = [], set()
    for way in ways or []:
        geom = way.get("geometry") or []
        kind = str(way.get("highway") or "")
        if kind in ("track", "service") and way_length_m(geom) < MINOR_MIN_M:
            continue
        pts = [(math.floor((x - w) * sx), math.floor((n - y) * sy)) for x, y in geom]
        tiles, seen = [], set()
        for (i0, j0), (i1, j1) in zip(pts, pts[1:]):
            if (i0 < 0 and i1 < 0) or (j0 < 0 and j1 < 0) or (i0 >= cols and i1 >= cols) or (j0 >= rows and j1 >= rows):
                continue
            for i, j in bresenham(i0, j0, i1, j1):
                if 0 <= i < cols and 0 <= j < rows:
                    t = j * cols + i
                    if t not in seen:
                        seen.add(t)
                        tiles.append(t)
        if tiles:
            out_ways.append({"name": str(way.get("name") or ""), "highway": kind, "tiles": tiles})
            all_tiles.update(tiles)
    return {"tiles": sorted(all_tiles), "ways": out_ways}


def feed(farm_id: str = "", build: str = "", bounds: str = "", fields: str = "", lat: str = "", lon: str = "", since: str = "",
         **_) -> dict:
    """Action `feed`: the stored parts built after `since`, the missing and stale part names and the builder state; `build`
    starts the detached builder unless one runs for this farm."""
    t0 = time.time()
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", farm_id or ""):
        return {"error": "farm_id must be 1-64 letters, digits, - or _", "hint": "pass the farm_id from game.py list"}
    try:
        cut = float(since or 0)
    except ValueError:
        return {"error": f"since must be epoch seconds, got {since!r}", "hint": "pass the newest built_at the page has"}
    names, folder = feed_names(), os.path.join(FEED_DIR, farm_id)
    stamps = {n: m for n in names if (m := mtime(os.path.join(folder, n + ".parquet"))) is not None}
    running = building(folder)
    if build and not running and (todo := feed_todo(build, names, stamps)):
        if settings()["engine"] == "fused" and not os.path.isfile(credentials_file()):
            return {"error": "Not signed in to Fused", "hint": SIGN_IN, "signin": True}
        try:
            running = start_build(folder, farm_id, todo, {"bounds": bounds, "fields": compact_fields(fields), "lat": lat, "lon": lon})
        except OSError as err:
            return {"error": short(err), "hint": "the feed builder could not start; check the app folder is writable"}
    job = read_json(os.path.join(folder, FEED_JOB))
    if job and not running and not job.get("finished"):
        job["errors"] = {**(job.get("errors") or {}), "build": f"the builder stopped early (see {FEED_LOG})"}
    parts = {n: {**p, "built_at": m} for n, m in stamps.items() if m > cut and (p := read_part(os.path.join(folder, n + ".parquet")))}
    out = {"farm_id": farm_id, "parts": parts, "missing": [n for n in names if n not in stamps],
           "stale": [n for n, m in stamps.items() if not feed_fresh(n, m)],
           "build": job and {"engine": job.get("engine"), "step": job.get("step"), "errors": job.get("errors") or {}, "running": running}}
    return {**out, "_ms": ms(t0)}


def feed_names() -> list:
    y = time.gmtime().tm_year
    return ["weather", "forecast", "climatology"] + [f"{k}_{y - i}" for i in range(FEED_YEARS) for k in ("ndvi", "pheno")]


def mtime(path: str = "") -> float | None:
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def feed_fresh(name: str = "", built_at: float = 0) -> bool:
    if name in FEED_TTL_S:
        ttl = FEED_TTL_S[name]
    else:
        year = int(name.rsplit("_", 1)[1])
        closed = built_at >= time.mktime((year + 1, 1, 15, 0, 0, 0, 0, 0, -1))
        ttl = FEED_TTL_S["past" if closed else "now"]
    return time.time() - built_at < ttl


def stale_names(names: list | None = None, stamps: dict | None = None) -> list:
    stamps = stamps or {}
    return [n for n in names or [] if n not in stamps or not feed_fresh(n, stamps[n])]


def feed_todo(build: str = "", names: list | None = None, stamps: dict | None = None) -> list:
    names = names or []
    if build == "all":
        picked = names
    elif build == "auto":
        picked = stale_names(names, stamps)
    else:
        picked = [n.strip() for n in str(build or "").split(",") if n.strip() in names]
    return list(dict.fromkeys(n.replace("pheno_", "ndvi_") for n in picked))


def feed_plan(todo: list | None = None, engine: str = "fused") -> list:
    todo = todo or []
    if engine != "local":
        return [",".join(todo)] if todo else []
    ndvi = sorted((n for n in todo if n.startswith("ndvi_")), reverse=True)
    first = [n for n in todo if not n.startswith("ndvi_")] + ndvi[:1]
    return ([",".join(first)] if first else []) + ndvi[1:]


def building(folder: str = "") -> bool:
    """True while a builder process holds the farm's lock file (the OS drops the lock when that process ends)."""
    import fcntl

    try:
        fd = os.open(os.path.join(folder, FEED_LOCK), os.O_RDONLY)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_SH | fcntl.LOCK_NB)
        return False
    except OSError:
        return True
    finally:
        os.close(fd)


def start_build(folder: str = "", farm_id: str = "", todo: list | None = None, args: dict | None = None) -> bool:
    """Take the farm's lock and start `eo.py feed-build` detached with the lock and the args on stdin; True also when another
    call holds the lock, since a builder then runs."""
    import fcntl
    import subprocess

    os.makedirs(folder, exist_ok=True)
    fd = os.open(os.path.join(folder, FEED_LOCK), os.O_CREAT | os.O_RDWR, 0o644)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        os.close(fd)
        return True
    try:
        engine = settings()["engine"]
        write_json(os.path.join(folder, FEED_JOB), {"farm_id": farm_id, "engine": engine, "plan": feed_plan(todo, engine), "step": None,
                                                    "done": [], "errors": {}, "finished": None})
        with open(os.path.join(folder, FEED_LOG), "wb") as log:
            proc = subprocess.Popen([sys.executable, "-I", os.path.abspath(__file__), "feed-build", folder], cwd=APP_DIR,
                                    stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, pass_fds=(fd,), start_new_session=True)
        try:
            proc.stdin.write(json.dumps(args or {}).encode())
            proc.stdin.close()
        except BrokenPipeError:
            pass
        return True
    finally:
        os.close(fd)


def feed_worker(folder: str = "") -> None:
    """The detached builder: runs each step of the job plan, saves each part's parquet as it arrives, reports to the
    fused-render download manager every FEED_BEAT_S, and marks the job finished whatever happens."""
    import base64

    path = os.path.join(folder, FEED_JOB)
    job = read_json(path) or {"farm_id": os.path.basename(folder), "engine": "fused", "plan": [], "done": [], "errors": {}}
    stop = threading.Event()

    def beat():
        while not stop.wait(FEED_BEAT_S):
            report_job(job)

    threading.Thread(target=beat, daemon=True).start()
    try:
        args = json.loads(sys.stdin.read() or "{}")
        for step in job["plan"]:
            job["step"] = step
            write_json(path, job)
            report_job(job)
            built = build_feed(step.split(","), job["engine"], **args)
            for n, part in built.get("parts", {}).items():
                try:
                    write_file(os.path.join(folder, n + ".parquet"), base64.b64decode(part, validate=True))
                    job["done"].append(n)
                except (OSError, ValueError, TypeError) as err:
                    job["errors"][n] = f"not saved: {short(err)}"
            job["errors"].update(built.get("errors", {}))
    except Exception as err:
        job["errors"]["build"] = short(err)
    finally:
        stop.set()
        job["step"], job["finished"] = None, time.time()
        write_json(path, job)
        report_job(job)
        log = os.path.join(folder, FEED_LOG)
        try:
            if not os.path.getsize(log):
                os.remove(log)
        except OSError:
            pass


def report_job(job: dict | None = None) -> None:
    """Post the job's progress row to fused-render's download manager; silent when there is no fused-render to tell."""
    import requests

    origin = os.environ.get("FUSED_RENDER_ORIGIN")
    if not origin or not job:
        return
    plan, step = job.get("plan") or [], job.get("step")
    state = "running" if not job.get("finished") else "error" if job["errors"] and not job["done"] else "done"
    detail = ("building " + step.replace(",", ", ")) if step else f"{len(job['done'])} parts saved"
    body = {"id": "farmverse-feed-" + job["farm_id"], "title": "FarmVerse feed for " + job["farm_id"], "kind": "task", "state": state,
            "done": plan.index(step) if step in plan else len(plan), "total": len(plan), "detail": detail[:200]}
    headers = {"X-Fused": "1", **({"X-Fused-Page": os.environ["FUSED_RENDER_PAGE"]} if os.environ.get("FUSED_RENDER_PAGE") else {})}
    try:
        requests.post(origin + "/api/jobs", json=body, headers=headers, timeout=3)
    except Exception:
        pass


def build_feed(todo: list | None = None, engine: str = "fused", **args) -> dict:
    """One feed_build run for the parts in `todo`; failures become per-part errors."""
    todo = todo or []
    try:
        res = run_udf("feed_build", {**args, "parts": ",".join(todo), "years": FEED_YEARS}, engine, "0s", FEED_STEP_S)
    except Exception as err:
        return {"errors": {n: f"{short(err)} ({hint_for(err, engine)})" for n in todo}}
    if not isinstance(res, dict) or "parts" not in res:
        why = res.get("error") if isinstance(res, dict) else f"feed_build returned {type(res).__name__}"
        return {"errors": {n: str(why)[:300] for n in todo}}
    return res


def compact_fields(fields: str = "") -> str:
    def rnd(v):
        return [rnd(x) for x in v] if isinstance(v, list) else round(v, 5) if isinstance(v, float) else v

    try:
        items = json.loads(fields or "[]")
    except ValueError:
        return fields or "[]"
    out = [{"field_id": f.get("field_id"), **({"geometry": {**f["geometry"], "coordinates": rnd(f["geometry"].get("coordinates"))}}
                                              if isinstance(f.get("geometry"), dict) else {"bounds": f.get("bounds")})}
           for f in items if isinstance(f, dict)]
    return json.dumps(out, separators=(",", ":"))


def read_part(path: str = "") -> dict | None:
    import pyarrow as pa
    import pyarrow.parquet as pq

    try:
        t = pq.ParquetFile(path).read()
    except (OSError, pa.ArrowException):
        return None
    try:
        meta = json.loads((t.schema.metadata or {}).get(b"feed_meta", b"{}"))
    except ValueError:
        meta = {}
    return {"cols": t.replace_schema_metadata(None).to_pydict(), "meta": meta}


def cache_key(udf: str = "", params: dict | None = None) -> str:
    """sha1 of the UDF name, the sorted params and the cache version."""
    blob = json.dumps([udf, sorted((params or {}).items()), VERSION], separators=(",", ":"))
    return hashlib.sha1(blob.encode()).hexdigest()


def read_json(path: str = "", ttl_s: float | None = None) -> dict | None:
    """The dict in a JSON file; None when it is missing, unreadable, not a dict or older than ttl_s."""
    try:
        if ttl_s is not None and time.time() - os.path.getmtime(path) > ttl_s:
            return None
        with open(path) as f:
            data = json.load(f)
        return data if isinstance(data, dict) else None
    except (OSError, ValueError):
        return None


def write_cache(path: str = "", data: dict | None = None) -> None:
    """Atomic JSON write that ignores failures; a cache miss is the worst outcome."""
    try:
        write_json(path, data)
    except (OSError, TypeError, ValueError):
        pass


def write_json(path: str = "", data: dict | None = None) -> None:
    write_file(path, json.dumps(data, separators=(",", ":")).encode())


def write_file(path: str = "", data: bytes = b"") -> None:
    """Atomic write (temp file + os.replace), creating the folder; raises on failure and leaves no temp file."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = f"{path}.{os.getpid()}.{threading.get_ident()}.tmp"
    try:
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def real_fused():
    """The real fused SDK module, even when the fused-render runner has put its local `fused` shim first."""
    import importlib

    loaded = sys.modules.get("fused")
    if loaded is not None and hasattr(loaded, "api"):
        return loaded
    saved_path = sys.path[:]
    shim_dirs = {p for p in sys.path if p and os.path.isfile(os.path.join(p, "fused.py"))}
    sys.modules.pop("fused", None)
    sys.path[:] = [p for p in saved_path if p not in shim_dirs]
    try:
        mod = importlib.import_module("fused")
    except ImportError:
        mod = None
    finally:
        sys.path[:] = saved_path
    if mod is None or not hasattr(mod, "api"):
        sys.modules.pop("fused", None)
        mod = _from_site_packages()
    return mod


def _from_site_packages():
    """Import fused from <sys.prefix>/lib/python*/site-packages explicitly."""
    import glob
    import importlib.util

    for init in glob.glob(os.path.join(sys.prefix, "lib", "python*", "site-packages", "fused", "__init__.py")):
        spec = importlib.util.spec_from_file_location("fused", init, submodule_search_locations=[os.path.dirname(init)])
        mod = importlib.util.module_from_spec(spec)
        sys.modules["fused"] = mod
        spec.loader.exec_module(mod)
        if hasattr(mod, "api"):
            return mod
    raise ImportError("the fused SDK is not installed in this environment")


def run_udf(action: str = "farm", params: dict | None = None, engine: str = "fused", cache_max_age: str = "",
            timeout_s: float | None = None):
    """eo_udf.py via fused.run: engine "fused" is remote on the user's own sign-in (with cache_max_age), "local" runs in this
    process on this Mac with the SDK cache in .fused/cache/udf; bounded by timeout_s, else by DEADLINE_S from import."""
    import pathlib

    fused = real_fused()
    udf = fused.load(UDF_FILE)
    kw = {"engine": "remote" if engine == "fused" else "local", "action": action,
          "payload": json.dumps(params or {}, separators=(",", ":"))}
    if engine == "fused":
        kw["cache_max_age"] = cache_max_age or ("6h" if action == "weather" else "7d")
    else:
        fused.options.cache_directory = pathlib.Path(UDF_CACHE_DIR)
    return call_bounded(lambda: fused.run(udf, **kw), timeout_s or remaining_s(), action)


def remaining_s() -> float:
    """Seconds left of DEADLINE_S counted from T0 (this module's import), never under 1."""
    return max(1.0, DEADLINE_S - (time.time() - T0))


def call_bounded(fn, timeout_s: float, what: str = "the call"):
    """fn() on a daemon thread (stdout sent to stderr): its result, its exception, or TimeoutError after timeout_s."""
    import contextlib

    box = {}

    def work():
        with contextlib.redirect_stdout(sys.stderr):
            try:
                box["out"] = fn()
            except Exception as err:
                box["err"] = err

    th = threading.Thread(target=work, daemon=True)
    th.start()
    th.join(timeout_s)
    if th.is_alive():
        shown = round(timeout_s) if timeout_s >= 1 else round(timeout_s, 1)
        raise TimeoutError(f"{what} did not answer within {shown:g} s")
    if "err" in box:
        raise box["err"]
    return box.get("out")


def short(err: BaseException | None = None) -> str:
    """Last meaningful line of an exception, capped."""
    lines = [ln for ln in str(err).strip().splitlines() if ln.strip()]
    return f"{type(err).__name__}: {(lines[-1] if lines else repr(err))[:400]}"


def is_timeout(err: BaseException | None = None) -> bool:
    """A TimeoutError or a message that says timed out / timeout."""
    text = str(err).lower()
    return isinstance(err, TimeoutError) or "timed out" in text or "timeout" in text


def is_auth(err: BaseException | None = None) -> bool:
    """A message that looks like a Fused sign-in problem (401, 403, credential, login, token, not logged in)."""
    text = str(err).lower()
    return any(k in text for k in AUTH_WORDS)


def is_network(err: BaseException | None = None) -> bool:
    """A message that looks like no route to the server (connection, resolve, network)."""
    text = str(err).lower()
    return any(k in text for k in NETWORK_WORDS)


def hint_for(err: BaseException | None = None, engine: str = "fused") -> str:
    """A one-line next step for the page to show; a Fused sign-in problem answers SIGN_IN (main adds "signin": True)."""
    text = str(err).lower()
    if engine == "local":
        if isinstance(err, ImportError) or "no module named" in text:
            return LOCAL_MISSING
        if is_timeout(err):
            return LOCAL_SLOW
        if is_network(err):
            return LOCAL_OFFLINE
        return "The run failed on this Mac; the message above comes from eo_udf.py."
    if is_timeout(err):
        return "Fused took too long; try again (results are cached once they arrive)."
    if is_auth(err):
        return SIGN_IN
    if "not installed" in text or isinstance(err, ImportError):
        return "Install the app dependencies (pyproject lists fused) and retry."
    if is_network(err):
        return "No network to fused.io; check the connection and retry."
    return "The Fused job failed; the message above comes from eo_udf.py."


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "feed-build":
    feed_worker(sys.argv[2])
