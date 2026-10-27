@fused.udf(cache_max_age="7d")
def udf(action: str = "farm", payload: str = "{}"):
    """Run one FarmVerse Earth-observation action with its parameters passed as a JSON object in `payload`."""
    import json

    try:
        kw = json.loads(payload) if str(payload or "").strip() else {}
    except ValueError as err:
        return {"error": f"payload is not valid JSON: {err}", "hint": "action is one of " + ", ".join(ACTIONS)}
    if not isinstance(kw, dict) or action not in ACTIONS:
        why = "payload must be a JSON object" if not isinstance(kw, dict) else f"unknown action {action!r}"
        return {"error": why, "hint": "action is one of " + ", ".join(ACTIONS)}
    return ACTIONS[action](**kw)


EARTH_SEARCH = "https://earth-search.aws.element84.com/v1/search"
PC_STAC = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
PC_SIGN = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
CDL_FUSED = "https://fused-asset.s3.us-west-2.amazonaws.com/data/cdls/{year}_30m_cdls.tif"
FTW_URL = "https://data.source.coop/ftw/global-field-boundaries/download-tiles/geoparquet/{year}/{year}_{name}.parquet"
FTW_GRID = "https://data.source.coop/ftw/global-field-boundaries/download-tiles/ftw-download-grid-v2.geojson"
NE_COUNTRIES = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson"
SCL_MASK = (0, 1, 3, 8, 9, 10)
CROPS = {1: "corn", 5: "soybeans", 24: "winter_wheat", 36: "alfalfa", 37: "hay", 61: "fallow", 176: "pasture"}
WATER = (83, 87, 111, 190, 195)
CONUS = (-125.0, 24.0, -66.0, 50.0)
NO_LABEL = ("", "unknown", "other", None)
GDAL_ENV = {"GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR", "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES", "GDAL_HTTP_MULTIPLEX": "YES",
            "GDAL_INGESTED_BYTES_AT_OPEN": "32768", "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF,.tiff", "AWS_NO_SIGN_REQUEST": "YES",
            "GDAL_HTTP_TIMEOUT": "60", "GDAL_HTTP_CONNECTTIMEOUT": "5", "GDAL_HTTP_MAX_RETRY": "3", "GDAL_HTTP_RETRY_DELAY": "1",
            "VSI_CACHE": "TRUE"}


def parse_bounds(bounds):
    """'w,s,e,n' text or a 4-sequence -> validated (w, s, e, n) floats rounded to 6 dp."""
    vals = [float(v) for v in (bounds.split(",") if isinstance(bounds, str) else bounds)]
    if len(vals) != 4:
        raise ValueError("bounds must be 'w,s,e,n'")
    w, s, e, n = vals
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise ValueError(f"bounds out of range or inverted: {vals}")
    return tuple(round(v, 6) for v in (w, s, e, n))


def check_grid(cols, rows):
    """cols and rows as ints, 1..256 each with cols * rows <= 16384."""
    cols, rows = int(cols), int(rows)
    if not (1 <= cols <= 256 and 1 <= rows <= 256 and cols * rows <= 16384):
        raise ValueError("cols and rows must be 1..256 with cols * rows <= 16384")
    return cols, rows


def check_size(b, deg, what="bounds"):
    """Raise when a (w, s, e, n) box is wider or taller than deg degrees."""
    if (b[2] - b[0]) > deg or (b[3] - b[1]) > deg:
        raise ValueError(f"{what} must fit in {deg} degrees on each side")


def date_range(start, end):
    """(start, end) as ISO dates; raises when end is before start."""
    import datetime as dt

    d0, d1 = dt.date.fromisoformat(start), dt.date.fromisoformat(end)
    if d1 < d0:
        raise ValueError("end is before start")
    return d0.isoformat(), d1.isoformat()


def parse_geometry(geometry):
    """GeoJSON text (geometry, Feature or FeatureCollection) or 'w,s,e,n' -> a valid shapely geometry in EPSG:4326."""
    import json

    import shapely
    from shapely.geometry import box, shape

    text = (geometry or "").strip()
    if not text.startswith("{"):
        return box(*parse_bounds(text))
    obj = json.loads(text)
    if obj.get("type") == "FeatureCollection":
        geom = shapely.union_all([shape(f["geometry"]) for f in obj["features"]])
    elif obj.get("type") == "Feature":
        geom = shape(obj["geometry"])
    else:
        geom = shape(obj)
    geom = shapely.make_valid(geom)
    if geom.is_empty or geom.area == 0:
        raise ValueError("geometry is empty or has no area")
    return geom


def in_conus(bounds):
    """True when the centre of a (w, s, e, n) box lies inside the CONUS rectangle covered by USDA CDL."""
    w, s, e, n = bounds
    x, y = (w + e) / 2, (s + n) / 2
    return CONUS[0] <= x <= CONUS[2] and CONUS[1] <= y <= CONUS[3]


def parse_fields(fields):
    """JSON list (text or list) of {"field_id", "geometry"|"bounds", "crop"?} -> [(field_id, shapely geometry, crop or None)]."""
    import json

    import shapely
    from shapely.geometry import box, shape

    items = json.loads(fields) if isinstance(fields, str) else fields
    if isinstance(items, dict):
        items = items.get("fields", [])
    if not isinstance(items, list):
        raise ValueError("fields must be a JSON list of {field_id, geometry|bounds}")
    out = []
    for k, it in enumerate(items):
        fid = str(it.get("field_id") or f"F{k + 1:02d}")
        g = it.get("geometry")
        if isinstance(g, str) and g.strip():
            geom = parse_geometry(g)
        elif isinstance(g, dict):
            geom = shapely.make_valid(shape(g.get("geometry", g)))
        elif it.get("bounds"):
            geom = box(*parse_bounds(it["bounds"]))
        else:
            raise ValueError(f"field {fid} has neither geometry nor bounds")
        if geom.is_empty:
            continue
        out.append((fid, geom, it.get("crop")))
    return out


def union_bounds(geoms):
    """(w, s, e, n) covering every geometry, rounded outward to 6 dp."""
    import math

    b = [g.bounds for g in geoms]
    return (math.floor(min(v[0] for v in b) * 1e6) / 1e6, math.floor(min(v[1] for v in b) * 1e6) / 1e6,
            math.ceil(max(v[2] for v in b) * 1e6) / 1e6, math.ceil(max(v[3] for v in b) * 1e6) / 1e6)


def tile_centres(bounds, cols, rows):
    """Tile centre lon and lat arrays in tile index order t = j * cols + i."""
    import numpy as np

    w, s, e, n = bounds
    i = np.tile(np.arange(cols), rows)
    j = np.repeat(np.arange(rows), cols)
    return w + (i + 0.5) * (e - w) / cols, n - (j + 0.5) * (n - s) / rows


def tile_index(lon, lat, bounds, cols, rows):
    """Tile index for lon/lat arrays; -1 outside the box."""
    import numpy as np

    w, s, e, n = bounds
    i = np.floor((np.asarray(lon) - w) / (e - w) * cols).astype("int64")
    j = np.floor((n - np.asarray(lat)) / (n - s) * rows).astype("int64")
    ok = (i >= 0) & (i < cols) & (j >= 0) & (j < rows)
    return np.where(ok, j * cols + i, -1)


def tile_m(bounds, cols, rows):
    """Mean tile edge in metres (geometric mean of width and height)."""
    import math

    w, s, e, n = bounds
    lat = math.radians((s + n) / 2)
    wx = (e - w) / cols * 111320 * math.cos(lat)
    hy = (n - s) / rows * 110574
    return round(math.sqrt(wx * hy), 1)


def chess_names(points, bounds, cols, rows):
    """Chess-style labels (column letter per 8 tiles, row number per 8 tiles) for (lon, lat) points; duplicates get b, c, ..."""
    w, s, e, n = bounds
    seen, out = {}, []
    for lon, lat in points:
        i = min(max(int((lon - w) / (e - w) * cols), 0), cols - 1)
        j = min(max(int((n - lat) / (n - s) * rows), 0), rows - 1)
        base = f"{_letters(i // 8)}{j // 8 + 1}"
        k = seen.get(base, 0)
        seen[base] = k + 1
        out.append(base if k == 0 else base + chr(ord("a") + min(k, 25)))
    return out


def _letters(k):
    s = ""
    k += 1
    while k:
        k, r = divmod(k - 1, 26)
        s = chr(65 + r) + s
    return s


def crop_of(code):
    """CDL code -> FarmVerse crop name."""
    return CROPS.get(int(code), "other")


def post_json(url, body, timeout=30):
    import requests

    r = requests.post(url, json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()


def get_json(url, params=None, timeout=30):
    import requests

    r = requests.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    return r.json()


def s2_search(bbox, start, end, max_cloud, limit=100):
    """Sentinel-2 L2A items over bbox in [start, end], cloud cover <= max_cloud, newest first (compact dicts)."""
    body = {"collections": ["sentinel-2-l2a"], "bbox": list(bbox), "limit": 100,
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z", "query": {"eo:cloud_cover": {"lte": max_cloud}},
            "sortby": [{"field": "properties.datetime", "direction": "desc"}]}
    feats, url = [], EARTH_SEARCH
    while url and len(feats) < limit:
        page = post_json(url, body)
        feats += page.get("features", [])
        nxt = [lk for lk in page.get("links", []) if lk.get("rel") == "next"]
        if not nxt or not page.get("features"):
            break
        url, body = nxt[0]["href"], nxt[0].get("body", body)
    out = []
    for f in feats[:limit]:
        p, a = f["properties"], f["assets"]
        if not all(k in a for k in ("red", "nir", "scl")):
            continue
        out.append({"id": f["id"], "datetime": p["datetime"], "cloud_cover": p.get("eo:cloud_cover"),
                    "red": a["red"]["href"], "nir": a["nir"]["href"], "scl": a["scl"]["href"],
                    "scale": _band(a["red"], "scale", 1e-4),
                    "offset": 0.0 if p.get("earthsearch:boa_offset_applied") else _band(a["red"], "offset", 0.0)})
    return out


def _band(asset, key, default):
    rb = asset.get("raster:bands") or [{}]
    v = rb[0].get(key)
    return float(default if v is None else v)


def solar_date(dt, lon):
    """ISO datetime (UTC) + lon/15 hours -> local solar date 'YYYY-MM-DD'."""
    import datetime as _dt

    t = _dt.datetime.fromisoformat(dt.replace("Z", "+00:00"))
    return (t + _dt.timedelta(hours=lon / 15.0)).date().isoformat()


def read_window(href, bounds, out_shape=None, window_bounds=None):
    """Band 1 over lon/lat bounds (or `window_bounds` already in the raster CRS), boundless with 0 fill, nearest resampling
    to `out_shape` when given. Returns (array, transform, raster crs)."""
    import math
    import os

    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window, from_bounds

    os.environ.update(GDAL_ENV)
    with rasterio.open(href) as src:
        win = from_bounds(*(window_bounds or transform_bounds("EPSG:4326", src.crs, *bounds, densify_pts=21)), src.transform)
        if out_shape is None:
            c0, r0 = math.floor(win.col_off), math.floor(win.row_off)
            win = Window(c0, r0, max(math.ceil(win.col_off + win.width) - c0, 1), max(math.ceil(win.row_off + win.height) - r0, 1))
        return src.read(1, window=win, out_shape=out_shape, boundless=True, fill_value=0), src.window_transform(win), src.crs


def s2_read(item, bounds):
    """Red, nir (reflectance, float32, NaN where no data) and SCL (uint8, resampled to 10 m) for one item over a lon/lat box.
    Returns dict with red, nir, scl, transform, crs."""
    from concurrent.futures import ThreadPoolExecutor

    import numpy as np

    red, tr, crs = read_window(item["red"], bounds)
    h, w = red.shape
    wb = (tr.c, tr.f + tr.e * h, tr.c + tr.a * w, tr.f)
    with ThreadPoolExecutor(1) as pool:
        scl_job = pool.submit(read_window, item["scl"], None, window_bounds=wb, out_shape=(h, w))
        nir, _, _ = read_window(item["nir"], None, window_bounds=wb, out_shape=(h, w))
        scl, _, _ = scl_job.result()
    nodata = (red == 0) | (nir == 0)
    red = np.where(nodata, np.nan, red * item["scale"] + item["offset"]).astype("float32")
    nir = np.where(nodata, np.nan, nir * item["scale"] + item["offset"]).astype("float32")
    return {"red": red, "nir": nir, "scl": scl.astype("uint8"), "transform": tr, "crs": crs}


def ndvi(red, nir):
    """NDVI with NaN where undefined; reflectances clipped at 0."""
    import numpy as np

    r, n = np.clip(red, 0, None), np.clip(nir, 0, None)
    with np.errstate(invalid="ignore", divide="ignore"):
        v = (n - r) / (n + r)
    v[~np.isfinite(v)] = np.nan
    return v


def clear_mask(scene):
    """Pixels with data whose SCL class is not cloud, shadow, saturated or no data."""
    import numpy as np

    return np.isfinite(scene["red"]) & np.isfinite(scene["nir"]) & ~np.isin(scene["scl"], SCL_MASK)


def threads(fn, items, workers=12):
    """Map fn over items in a thread pool; an exception becomes that item's result."""
    from concurrent.futures import ThreadPoolExecutor

    def safe(x):
        try:
            return fn(x)
        except Exception as err:
            return err

    with ThreadPoolExecutor(max(1, min(workers, len(items) or 1))) as pool:
        return list(pool.map(safe, items))


def clean(obj, digits=None):
    """Make obj JSON-safe: numpy scalars to Python, NaN/inf to None, tuples to lists, optional float rounding."""
    import math

    import numpy as np

    if isinstance(obj, dict):
        return {str(k): clean(v, digits) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean(v, digits) for v in obj]
    if isinstance(obj, np.ndarray):
        return [clean(v, digits) for v in obj.tolist()]
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (float, np.floating)):
        f = float(obj)
        if not math.isfinite(f):
            return None
        return round(f, digits) if digits is not None else f
    if isinstance(obj, np.bool_):
        return bool(obj)
    return obj


def farm(
    bounds: str = "-93.365,42.168,-93.335,42.19",
    cols: int = 64,
    rows: int = 64,
    ftw_year: int = 2025,
    cdl_year: int = 2024,
    min_tiles: int = 6,
    **_,
):
    """Fields of The World polygons (any region with FTW data) whose centroid is inside `bounds`, rasterized to a cols x rows
    grid (a tile belongs to the field containing its centre), crop type from the USDA CDL majority inside CONUS, else "unknown".
    Returns {bounds, cols, rows, tile_m, center, fields, water, cdl_available, crop_source, country_hint, ftw_year_used,
    sources}; {"error", "hint"} when no FTW tile or field covers the box."""
    b, (cols, rows) = parse_bounds(bounds), check_grid(cols, rows)
    check_size(b, 0.5)
    return _farm(b, cols, rows, int(ftw_year), int(cdl_year), max(1, int(min_tiles)))


@fused.cache
def _ftw_grid():
    """FTW download grid: {tile_id: [years with data]} (None when the grid file cannot be read)."""
    import requests

    try:
        r = requests.get(FTW_GRID, timeout=30)
        r.raise_for_status()
        return {f["properties"]["tile_id"]: [int(y) for y, c in (f["properties"].get("feature_counts") or {}).items() if c]
                for f in r.json()["features"]}
    except Exception:
        return None


@fused.cache
def _ftw_box(year: int, name: str, bounds: tuple):
    """Polygons of one FTW 1x1 degree tile whose centroid is inside bounds as {wkb, confidence}; None when the tile is missing."""
    import fsspec
    import numpy as np
    import pyarrow.parquet as pq
    import shapely

    url = FTW_URL.format(year=year, name=name)
    try:
        with fsspec.open(url, block_size=8 * 2**20).open() as f:
            pf = pq.ParquetFile(f)
            cols = [c for c in ("confidence_mean", "geometry") if c in pf.schema_arrow.names]
            t = pf.read(columns=cols)
    except FileNotFoundError:
        return None
    g = shapely.from_wkb(t.column("geometry").to_numpy(zero_copy_only=False))
    c = shapely.centroid(g)
    x, y = shapely.get_x(c), shapely.get_y(c)
    w, s, e, n = bounds
    m = (x >= w) & (x < e) & (y >= s) & (y < n)
    conf = t.column("confidence_mean").to_numpy(zero_copy_only=False).astype("float64") if "confidence_mean" in cols else np.full(len(g), np.nan)
    conf = np.minimum(conf[m] / 0.578178 * 100, 100).round(0)
    return {"wkb": list(shapely.to_wkb(g[m])), "confidence": conf.tolist()}


def _tile_names(bounds):
    """FTW 1x1 degree tile ids (e.g. N42W094) touched by bounds."""
    import math

    w, s, e, n = bounds
    return [f"{'N' if la >= 0 else 'S'}{abs(la):02d}{'E' if lo >= 0 else 'W'}{abs(lo):03d}"
            for la in range(math.floor(s), math.floor(n - 1e-9) + 1)
            for lo in range(math.floor(w), math.floor(e - 1e-9) + 1)]


def _ftw(bounds, year, grid):
    """(GeoDataFrame of FTW polygons with centroid inside bounds, number of tiles that exist for that year)."""
    import geopandas as gpd
    import numpy as np
    import shapely

    geoms, confs, found = [], [], 0
    for name in _tile_names(bounds):
        if grid is not None and year not in grid.get(name, []):
            continue
        cell = _ftw_box(year, name, bounds)
        if cell is None:
            continue
        found += 1
        geoms += list(shapely.from_wkb(np.asarray(cell["wkb"], dtype=object)))
        confs += list(cell["confidence"])
    return gpd.GeoDataFrame({"confidence": confs}, geometry=geoms, crs="EPSG:4326"), found


@fused.cache
def _countries():
    """Natural Earth 1:50m countries as [(ISO alpha-2, WKB)]."""
    import requests
    import shapely
    from shapely.geometry import shape

    r = requests.get(NE_COUNTRIES, timeout=30)
    r.raise_for_status()
    return [(f["properties"].get("ISO_A2_EH") or f["properties"].get("ISO_A2"), shapely.to_wkb(shape(f["geometry"])))
            for f in r.json()["features"]]


def _country_hint(bounds):
    """Two-letter country code at the box centre (Natural Earth, nearest country within ~50 km); "US" or "" as fallback."""
    import shapely

    w, s, e, n = bounds
    p = shapely.Point((w + e) / 2, (s + n) / 2)
    try:
        best = (0.5, "")
        for iso, wkb in _countries():
            if not iso or iso == "-99":
                continue
            d = shapely.from_wkb(wkb).distance(p)
            if d < best[0]:
                best = (d, iso)
        if best[1]:
            return best[1]
    except Exception:
        pass
    return "US" if in_conus(bounds) else ""


@fused.cache
def _cdl_window(bounds: tuple, year: int):
    """CDL codes over bounds: (array, transform tuple, crs wkt, year used, source label). Fused public copy first, then
    Planetary Computer usda-cdl; nearest earlier year when a year is missing."""
    errors = []
    for y in range(year, max(year - 4, 2008) - 1, -1):
        url = CDL_FUSED.format(year=y)
        try:
            arr, tr, crs = read_window(url, bounds)
            return arr, tuple(tr)[:6], crs.to_wkt(), y, f"USDA CDL {y} (fused-asset public copy)"
        except Exception as err:
            errors.append(f"{y}: {err}")
    try:
        feats = post_json(PC_STAC, {"collections": ["usda-cdl"], "bbox": list(bounds), "limit": 50,
                                              "query": {"usda_cdl:type": {"eq": "cropland"}}})["features"]
        feats = [f for f in feats if "cropland" in f["assets"]]
        yrs = {int(f["properties"]["datetime"][:4]): f for f in feats}
        pick = max([y for y in yrs if y <= year] or yrs)
        href = get_json(PC_SIGN, {"href": yrs[pick]["assets"]["cropland"]["href"]})["href"]
        arr, tr, crs = read_window(href, bounds)
        return arr, tuple(tr)[:6], crs.to_wkt(), pick, f"USDA CDL {pick} (Planetary Computer)"
    except Exception as err:
        errors.append(f"pc: {err}")
    raise RuntimeError("; ".join(errors)[-400:])


@fused.cache
def _farm(bounds: tuple, cols: int, rows: int, ftw_year: int, cdl_year: int, min_tiles: int, _v: int = 5):
    import numpy as np
    import shapely
    from affine import Affine
    from pyproj import Transformer

    w, s, e, n = bounds
    prefetch = [_ftw_grid, _countries] + [lambda nm=nm: _ftw_box(ftw_year, nm, bounds) for nm in _tile_names(bounds)]
    if in_conus(bounds):
        prefetch.append(lambda: _cdl_window(bounds, cdl_year))
    threads(lambda job: job(), prefetch, len(prefetch))
    grid = _ftw_grid()
    names = _tile_names(bounds)
    if grid is not None and not any(grid.get(nm) for nm in names):
        return {"error": f"no Fields of The World tile covers this box ({', '.join(names)})",
                "hint": "FTW maps cropland on every continent but not oceans, deserts, ice or cities; move the box onto farmland"}
    used_year, (gdf, found) = ftw_year, _ftw(bounds, ftw_year, grid)
    if gdf.empty and ftw_year != 2024:
        used_year, (gdf, found2) = 2024, _ftw(bounds, 2024, grid)
        found += found2
    if not found:
        return {"error": f"no Fields of The World tile covers this box ({', '.join(names)})",
                "hint": "FTW maps cropland on every continent but not oceans, deserts, ice or cities; move the box onto farmland"}
    notes = [] if used_year == ftw_year else [f"FTW {ftw_year} had no fields here; used {used_year}"]
    lon, lat = tile_centres(bounds, cols, rows)
    owner = np.full(cols * rows, -1, dtype="int64")
    if not gdf.empty:
        tree = shapely.STRtree(gdf.geometry.values)
        pi, gi = tree.query(shapely.points(lon, lat), predicate="intersects")
        first = np.unique(pi, return_index=True)[1]
        owner[pi[first]] = gi[first]

    codes = np.zeros(cols * rows, dtype="int64")
    cdl_label, cdl_ok = "none", False
    if in_conus(bounds):
        try:
            arr, tr, crs, cdl_used, cdl_label = _cdl_window(bounds, cdl_year)
            x, y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(lon, lat)
            c, r = ~Affine(*tr) * (np.asarray(x), np.asarray(y))
            c, r = np.floor(c).astype("int64"), np.floor(r).astype("int64")
            ok = (r >= 0) & (r < arr.shape[0]) & (c >= 0) & (c < arr.shape[1])
            codes[ok] = arr[r[ok], c[ok]]
            cdl_ok = True
            if cdl_used != cdl_year:
                notes.append(f"CDL {cdl_year} unavailable; used {cdl_used}")
        except Exception as err:
            cdl_label = "none"
            notes.append(f"CDL read failed, crops unknown: {str(err)[:200]}")
    else:
        notes.append("outside CONUS: no USDA CDL, crops unknown")

    is_water = np.isin(codes, WATER)
    area = gdf.to_crs("EPSG:6933").area.values / 1e4 if not gdf.empty else np.array([])
    keep = []
    for gi in range(len(gdf)):
        tiles = np.flatnonzero(owner == gi)
        if len(tiles) < min_tiles:
            continue
        keep.append((gi, tiles))
    if not keep:
        return {"error": f"{len(gdf)} FTW {used_year} polygons in this box but none covers {min_tiles} or more tiles",
                "hint": "move the box over open farmland, or lower min_tiles"}
    keep.sort(key=lambda kt: -area[kt[0]])
    centroids = [gdf.geometry.values[gi].centroid for gi, _ in keep]
    names = chess_names([(p.x, p.y) for p in centroids], bounds, cols, rows)
    fields, owned = [], np.zeros(cols * rows, dtype=bool)
    for k, ((gi, tiles), cen, name) in enumerate(zip(keep, centroids, names)):
        geom = gdf.geometry.values[gi]
        fc = codes[tiles]
        fc_land = fc[(fc > 0)]
        if cdl_ok and len(fc_land):
            vals, cnt = np.unique(fc_land, return_counts=True)
            code, pct = int(vals[cnt.argmax()]), round(100.0 * cnt.max() / len(tiles), 1)
        else:
            code, pct = 0, 0.0
        crop = (crop_of(code) if code else "other") if cdl_ok else "unknown"
        owned[tiles] = True
        simple = geom.simplify(0.00005, preserve_topology=True)
        fields.append({
            "field_id": f"F{k + 1:02d}", "name": name, "area_ha": round(float(area[gi]), 2), "crop_code": code,
            "crop": crop, "cdl_pct": pct,
            "centroid_lon": round(cen.x, 6), "centroid_lat": round(cen.y, 6),
            "confidence": None if not np.isfinite(gdf["confidence"].values[gi]) else int(gdf["confidence"].values[gi]),
            "bounds": [round(v, 6) for v in geom.bounds], "tiles": tiles.tolist(),
            "geometry": clean(shapely.geometry.mapping(simple), 6),
        })
    water = np.flatnonzero(is_water & ~owned).tolist()
    return clean({
        "bounds": list(bounds), "cols": cols, "rows": rows, "tile_m": tile_m(bounds, cols, rows),
        "center": {"lat": round((s + n) / 2, 6), "lon": round((w + e) / 2, 6)},
        "fields": fields, "water": water,
        "cdl_available": cdl_ok, "crop_source": "cdl" if cdl_ok else "none",
        "country_hint": _country_hint(bounds), "ftw_year_used": used_year,
        "sources": {"fields": f"FTW {used_year} (source.coop)", "crop": cdl_label.split(" (")[0] if cdl_ok else "none",
                    "note": "; ".join(notes + ([f"crop from {cdl_label}"] if cdl_ok else []) +
                                      [f"{len(gdf)} FTW polygons with centroid in box, {len(fields)} kept (>= {min_tiles} tiles)"])},
    })


def ndvi_grid(
    bounds: str = "-93.365,42.168,-93.335,42.19",
    cols: int = 64,
    rows: int = 64,
    start: str = "2025-07-01",
    end: str = "2025-08-31",
    max_cloud: int = 30,
    **_,
):
    """Newest Sentinel-2 L2A scene over the box in [start, end] that is at least 60 % clear (tries the 4 newest under
    max_cloud, else keeps the clearest of them), NDVI averaged into the cols x rows grid tiles; null where a tile has no clear pixel.
    Returns {date, scene_id, clear_pct, cols, rows, values}, plus a note when no scene could be found or read."""
    b, (cols, rows) = parse_bounds(bounds), check_grid(cols, rows)
    check_size(b, 0.2)
    return _grid(b, cols, rows, *date_range(start, end), max(0, min(int(max_cloud), 100)))


@fused.cache
def _grid(bounds: tuple, cols: int, rows: int, start: str, end: str, max_cloud: int, _v: int = 4):
    import numpy as np
    from pyproj import Transformer

    lon_c = (bounds[0] + bounds[2]) / 2
    items = sorted(s2_search(bounds, start, end, max_cloud, limit=200), key=lambda it: it["datetime"], reverse=True)
    empty = {"date": None, "scene_id": None, "clear_pct": 0.0, "cols": cols, "rows": rows, "values": [None] * (cols * rows)}
    if not items:
        return {**empty, "note": "no Sentinel-2 scene under max_cloud in the date range"}

    def load(it):
        try:
            return s2_read(it, bounds)
        except Exception:
            return None

    best = None
    for it, sc in zip(items[:4], threads(load, items[:4], 4)):
        if sc is None:
            continue
        h, w = sc["red"].shape
        tr = sc["transform"]
        xs = tr.c + tr.a * (np.arange(w) + 0.5)
        ys = tr.f + tr.e * (np.arange(h) + 0.5)
        xx, yy = np.meshgrid(xs, ys)
        lon, lat = Transformer.from_crs(sc["crs"], "EPSG:4326", always_xy=True).transform(xx.ravel(), yy.ravel())
        t = tile_index(lon, lat, bounds, cols, rows)
        inbox = t >= 0
        ok = clear_mask(sc).ravel() & inbox
        v = ndvi(sc["red"], sc["nir"]).ravel()
        ok &= np.isfinite(v)
        clear = 100.0 * ok.sum() / max(int(inbox.sum()), 1)
        if best is None or clear > best[0]:
            best = (clear, it, t, ok, v)
        if clear >= 60:
            break
    if best is None:
        return {**empty, "note": "Sentinel-2 reads failed"}
    clear, it, t, ok, v = best
    n = np.bincount(t[ok], minlength=cols * rows)
    sm = np.bincount(t[ok], weights=v[ok], minlength=cols * rows)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = sm / n
    values = [None if c == 0 else round(float(m), 3) for c, m in zip(n, mean)]
    return clean({"date": solar_date(it["datetime"], lon_c), "scene_id": it["id"], "clear_pct": round(clear, 1),
                       "cols": cols, "rows": rows, "values": values})


def weather(lat: float = 42.011, lon: float = -93.64, start: str = "2025-05-01", end: str = "2025-10-31", forecast_days: int = 7, **_):
    """Daily weather for start..end (feed_weather) and the next forecast_days (feed_forecast) as rows for game.py; ET0 is left
    to sim.py (Hargreaves). Returns {lat, lon, history, forecast, sources}."""
    lat, lon = float(lat), float(lon)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise ValueError("lat/lon out of range")
    start, end = date_range(start, end)
    hist, fc = pmap(lambda a: a[0](*a[1:]), [(feed_weather, lat, lon, start, end), (feed_forecast, lat, lon, forecast_days)], 2)
    history = [dict(zip(("date", "tmax", "tmin", "precip"), v)) for v in zip(*(hist["cols"][k] for k in ("date", "tmax", "tmin", "precip")))]
    forecast = [dict(zip(("date", "tmax", "tmin", "precip", "p_rain"), v)) for v in zip(*(fc["cols"][k] for k in ("date", "tmax", "tmin", "precip", "p_rain")))]
    sources = {"history": hist["meta"]["sources"]["temperature"], "forecast": fc["meta"]["source"]}
    return {"lat": lat, "lon": lon, "history": history, "forecast": forecast, "sources": sources}


def cdl_history(
    fields: str = '[{"field_id": "F01", "bounds": [-93.3655, 42.181, -93.3477, 42.1952]}, {"field_id": "F02", "bounds": [-93.3465, 42.1735, -93.3352, 42.1855]}]',
    years: str = "2017-2024",
    **_,
):
    """Majority USDA CDL crop per field per year (one window read per year over the union bounds), the dominant rotation
    and the most frequent crop. `fields` = JSON list of {field_id, geometry | bounds}. available=false outside CONUS.
    Returns {years, available, fields, rotation, typical, source}, plus a note when some years could not be read."""
    items = parse_fields(fields)
    if not items:
        return {"error": "no fields given", "hint": "pass fields as a JSON list of {field_id, geometry | bounds}"}
    y0, y1 = _cdl_years(years)
    ub = union_bounds([g for _, g, _ in items])
    check_size(ub, 0.5, "fields")
    if not in_conus(ub):
        return {"years": list(range(y0, y1 + 1)), "available": False, "fields": {}, "rotation": {}, "typical": {},
                "source": "USDA CDL covers the contiguous US only"}
    return _cdl_history(tuple((fid, g.wkt) for fid, g, _ in items), ub, y0, y1)


def _cdl_years(years):
    """'2017-2024' or '2019' -> (first, last) clamped to the CDL copy (2009-2024)."""
    parts = [int(p) for p in str(years).replace(" ", "").split("-") if p]
    if not parts or len(parts) > 2:
        raise ValueError("years must look like '2017-2024'")
    y0, y1 = parts[0], parts[-1]
    y0, y1 = max(min(y0, y1), 2009), min(max(y0, y1), 2024)
    if y0 > y1:
        raise ValueError("years must overlap 2009-2024")
    return y0, y1


@fused.cache
def _cdl_year(bounds: tuple, year: int):
    """CDL codes over bounds for one year: (array, transform tuple, crs wkt); raises when the year cannot be read."""
    arr, tr, crs = read_window(CDL_FUSED.format(year=year), bounds)
    return arr, tuple(tr)[:6], crs.to_wkt()


def _rotation(seq):
    """Dominant 2-year pattern (alphabetical, 'corn-soybeans') from a year-ordered crop list, the single crop when one
    dominates (>= 75 %), else 'mixed'."""
    from collections import Counter

    crops = [c for c in seq if c]
    if not crops:
        return None
    freq = Counter(crops)
    top, n_top = freq.most_common(1)[0]
    if len(freq) == 1 or n_top / len(crops) >= 0.75:
        return top
    pairs = Counter(tuple(sorted((a, b))) for a, b in zip(crops, crops[1:]) if a != b)
    if pairs:
        (a, b), n = pairs.most_common(1)[0]
        if n >= (len(crops) - 1) / 2:
            return f"{a}-{b}"
    return "mixed"


@fused.cache
def _cdl_history(items: tuple, bounds: tuple, y0: int, y1: int, _v: int = 2):
    from collections import Counter

    import numpy as np
    import shapely
    from affine import Affine
    from pyproj import CRS, Transformer
    from rasterio.features import geometry_mask
    from shapely.ops import transform as sh_transform

    years = list(range(y0, y1 + 1))
    reads = threads(lambda y: _cdl_year(bounds, y), years, 16)
    geoms = [(fid, shapely.from_wkt(wkt)) for fid, wkt in items]
    out = {fid: {} for fid, _ in geoms}
    missing = []
    for y, rd in zip(years, reads):
        if not isinstance(rd, tuple):
            missing.append(str(y))
            continue
        arr, tr, wkt = rd
        to_r = Transformer.from_crs("EPSG:4326", CRS.from_wkt(wkt), always_xy=True).transform
        aff = Affine(*tr)
        for fid, g in geoms:
            gr = sh_transform(to_r, g)
            m = geometry_mask([gr], out_shape=arr.shape, transform=aff, invert=True)
            if not m.any():
                m = geometry_mask([gr], out_shape=arr.shape, transform=aff, invert=True, all_touched=True)
            v = arr[m]
            v = v[v > 0]
            if len(v) == 0:
                out[fid][str(y)] = None
                continue
            vals, cnt = np.unique(v, return_counts=True)
            out[fid][str(y)] = crop_of(int(vals[cnt.argmax()]))
    rotation, typical = {}, {}
    for fid, by_year in out.items():
        seq = [by_year.get(str(y)) for y in years]
        rotation[fid] = _rotation(seq)
        known = [c for c in seq if c]
        typical[fid] = Counter(known).most_common(1)[0][0] if known else None
    got = [y for y in years if str(y) not in missing]
    res = {"years": got, "available": bool(got), "fields": out, "rotation": rotation, "typical": typical,
           "source": f"USDA CDL {got[0]}-{got[-1]} (fused-asset copy)" if got else "USDA CDL (no year could be read)"}
    if missing:
        res["note"] = f"CDL years not readable: {', '.join(missing)}"
    return clean(res)


def aef_fields(
    bounds: str = "-93.365,42.168,-93.335,42.19",
    fields: str = "",
    year: int = 2024,
    k: int = 4,
    **_,
):
    """AlphaEarth Foundations annual embeddings averaged per field polygon (one window per AEF file over the box), k-means
    classes and, when labels allow, nearest-centroid crop classes with leave-one-out accuracy. `fields` = JSON list of
    {field_id, geometry | bounds, crop?}; empty = the `farm` fields of `bounds`.
    Returns {year, supervised, accuracy_loo, n_fields, k, classes, fields, clusters, source}; {"error", "hint"} when no
    AEF file or pixel covers the fields."""
    b = parse_bounds(bounds)
    check_size(b, 0.2)
    year = int(year)
    if not 2017 <= year <= 2025:
        raise ValueError("year must be between 2017 and 2025")
    if not fields.strip():
        from concurrent.futures import ThreadPoolExecutor

        pool = ThreadPoolExecutor(1)
        pool.submit(_aef_index, year)
        pool.shutdown(wait=False)
        farm = _farm(b, 64, 64, 2025, 2024, 6)
        if "error" in farm:
            return farm
        fields = farm["fields"]
    items = parse_fields(fields)
    if not items:
        return {"error": "no fields given", "hint": "pass fields as a JSON list of {field_id, geometry | bounds, crop?}"}
    ub = union_bounds([g for _, g, _ in items])
    box = (min(b[0], ub[0]), min(b[1], ub[1]), max(b[2], ub[2]), max(b[3], ub[3]))
    check_size(box, 0.25, "fields and bounds together")
    crops = tuple((c or "unknown") for _, _, c in items)
    return _classify(tuple((fid, g.wkt) for fid, g, _ in items), crops, box, year, max(1, min(int(k), 12)))


@fused.cache
def _aef_index(year: int):
    """AEF annual file index for one year: path, crs and WGS84 bbox per COG."""
    import fsspec
    import pyarrow.parquet as pq

    cols = ["path", "crs", "wgs84_west", "wgs84_south", "wgs84_east", "wgs84_north"]
    with fsspec.open("https://data.source.coop/tge-labs/aef/v1/annual/aef_index.parquet").open() as f:
        t = pq.read_table(f, columns=cols + ["year"], filters=[("year", "=", year)])
    return t.select(cols).to_pandas()


@fused.cache
def _aef_window(path: str, bounds: tuple):
    """64-band int8 window of one AEF COG covering lon/lat bounds: (array, transform tuple, crs string) or None."""
    import os

    import rasterio
    from rasterio.warp import transform_bounds
    from rasterio.windows import Window

    os.environ.update(AWS_NO_SIGN_REQUEST="YES", AWS_REGION="us-west-2", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
                      GDAL_HTTP_MULTIPLEX="YES", GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES", GDAL_INGESTED_BYTES_AT_OPEN="65536",
                      VSI_CACHE="TRUE", GDAL_NUM_THREADS="16")
    with rasterio.open("/vsis3/" + path[5:]) as ds:
        bx = transform_bounds("EPSG:4326", ds.crs, *bounds, densify_pts=21)
        inv = ~ds.transform
        cs, rs = zip(*[inv * (x, y) for x in (bx[0], bx[2]) for y in (bx[1], bx[3])])
        c0, c1 = max(0, int(min(cs)) - 1), min(ds.width, int(max(cs)) + 2)
        r0, r1 = max(0, int(min(rs)) - 1), min(ds.height, int(max(rs)) + 2)
        if c1 <= c0 or r1 <= r0:
            return None
        win = Window(c0, r0, c1 - c0, r1 - r0)
        return ds.read(window=win), tuple(ds.window_transform(win))[:6], ds.crs.to_string()


def _rgb(v, stretch=0.25):
    """Embedding axes 1, 16, 9 -> [r, g, b] with a linear stretch of +-stretch."""
    import numpy as np

    return [int(x) for x in (np.clip((v[[1, 16, 9]] + stretch) / (2 * stretch), 0, 1) * 255).round()]


def _unit(x):
    import numpy as np

    n = np.linalg.norm(x, axis=-1, keepdims=True)
    return x / np.where(n == 0, 1, n)


def _soft(sims, tau=0.05):
    """Softmax weight of the best entry of a similarity vector."""
    import numpy as np

    z = np.exp((sims - sims.max()) / tau)
    return float(z.max() / z.sum())


def _kmeans(X, k, iters=20, seed=0):
    """k-means++ seeded k-means on unit vectors; labels renumbered by cluster size (0 = largest)."""
    import numpy as np

    rng = np.random.default_rng(seed)
    C = [X[rng.integers(len(X))]]
    for _ in range(1, k):
        d = np.min(((X[:, None, :] - np.asarray(C)[None]) ** 2).sum(-1), axis=1)
        C.append(X[rng.choice(len(X), p=d / d.sum())] if d.sum() > 0 else X[rng.integers(len(X))])
    C = np.asarray(C)
    for _ in range(iters):
        lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
        newC = np.asarray([X[lab == j].mean(0) if (lab == j).any() else C[j] for j in range(k)])
        if np.allclose(newC, C):
            break
        C = newC
    lab = np.argmin(((X[:, None, :] - C[None]) ** 2).sum(-1), axis=1)
    order = sorted(range(k), key=lambda j: (-(lab == j).sum(), j))
    remap = {old: new for new, old in enumerate(order)}
    return np.array([remap[v] for v in lab]), _unit(C[order])


@fused.cache
def _classify(items: tuple, crops: tuple, box: tuple, year: int, k: int, _v: int = 1):
    from collections import Counter

    import numpy as np
    import shapely
    from affine import Affine
    from pyproj import Transformer
    from rasterio.features import geometry_mask
    from shapely.ops import transform as sh_transform

    idx = _aef_index(year)
    w, s, e, n = box
    sel = idx[(idx.wgs84_west < e) & (idx.wgs84_east > w) & (idx.wgs84_south < n) & (idx.wgs84_north > s)]
    source = f"AlphaEarth Foundations v1 annual {year} (source.coop/tge-labs/aef)"
    if sel.empty:
        return {"error": f"no AlphaEarth {year} file covers this box", "hint": "AEF covers land 2017-2025; try another year"}
    geoms = [(fid, shapely.from_wkt(wkt)) for fid, wkt in items]
    sums = np.zeros((len(geoms), 64), "float64")
    cnts = np.zeros(len(geoms), "int64")
    reads = threads(lambda p: _aef_window(p, box), sel.path.tolist(), 16)
    errors = [str(r)[:160] for r in reads if isinstance(r, Exception)]
    for rd in reads:
        if not isinstance(rd, tuple):
            continue
        arr, tr, crs = rd
        valid = arr[0] != -128
        if not valid.any():
            continue
        v = arr.astype("float32")
        v = np.sign(v) * (v / 127.5) ** 2
        to_r = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform
        for gi, (fid, g) in enumerate(geoms):
            m = geometry_mask([sh_transform(to_r, g)], out_shape=valid.shape, transform=Affine(*tr), invert=True) & valid
            if m.any():
                sums[gi] += v[:, m].sum(axis=1)
                cnts[gi] += int(m.sum())
    ok = np.flatnonzero(cnts > 0)
    out_fields = {fid: {"cluster": None, "pred_crop": None, "confidence": None, "rgb": None, "pixels": 0} for fid, _ in geoms}
    if len(ok) == 0:
        return {"error": "no AlphaEarth pixels inside the fields", "hint": "; ".join(errors) or "the fields may be outside AEF coverage"}
    X = _unit(sums[ok] / cnts[ok, None])
    ids = [geoms[i][0] for i in ok]
    labels = [crops[i] for i in ok]

    kk = min(k, len(ok))
    lab, C = _kmeans(X, kk)
    known = [c not in NO_LABEL for c in labels]
    clusters = []
    for j in range(kk):
        members = [labels[i] for i in range(len(ok)) if lab[i] == j and known[i]]
        clusters.append({"id": j, "size": int((lab == j).sum()),
                         "label": Counter(members).most_common(1)[0][0] if members else None, "rgb": _rgb(C[j])})

    counts = Counter(c for c, kn in zip(labels, known) if kn)
    classes = sorted(c for c, m in counts.items() if m >= 2)
    supervised = len(classes) >= 2
    acc, pred, conf = None, [None] * len(ok), [None] * len(ok)
    if supervised:
        train = [i for i in range(len(ok)) if labels[i] in classes]
        cent = {c: _unit(X[[i for i in train if labels[i] == c]].mean(0)) for c in classes}
        M = np.asarray([cent[c] for c in classes])
        for i in range(len(ok)):
            sims = M @ X[i]
            pred[i], conf[i] = classes[int(sims.argmax())], round(_soft(sims), 3)
        hits = 0
        for i in train:
            loo = []
            for c in classes:
                rows = [t for t in train if labels[t] == c and t != i]
                loo.append(_unit(X[rows].mean(0)))
            hits += classes[int((np.asarray(loo) @ X[i]).argmax())] == labels[i]
        acc = round(hits / len(train), 3)
    else:
        for i in range(len(ok)):
            conf[i] = round(_soft(C @ X[i]), 3)

    for i, fid in enumerate(ids):
        out_fields[fid] = {"cluster": int(lab[i]), "pred_crop": pred[i], "confidence": conf[i], "rgb": _rgb(X[i]),
                           "pixels": int(cnts[ok[i]])}
    res = {"year": year, "supervised": supervised, "accuracy_loo": acc, "n_fields": len(ok), "k": kk,
           "classes": classes if supervised else [], "fields": out_fields, "clusters": clusters, "source": source}
    if len(ok) < len(geoms):
        res["note"] = f"{len(geoms) - len(ok)} fields had no AEF pixels"
    return clean(res)


DYN = {"gefs": ("dynamical-noaa-gefs", "noaa-gefs-analysis/v0.1.2.icechunk/"),
       "chirps_final": ("dynamical-ucsb-chc-chirps", "ucsb-chc-chirps-analysis-final/v0.1.0.icechunk/"),
       "chirps_prelim": ("dynamical-ucsb-chc-chirps", "ucsb-chc-chirps-analysis-preliminary/v0.1.0.icechunk/"),
       "gfs": ("dynamical-noaa-gfs", "noaa-gfs-forecast/v0.2.7.icechunk/"),
       "ifs_ens": ("dynamical-ecmwf-ifs-ens", "ecmwf-ifs-ens-forecast-15-day-0-25-degree/v0.1.0.icechunk/")}
DYN_UNITS = {"seconds": "s", "minutes": "m", "hours": "h", "days": "D"}
GEFS_TEMP = ["maximum_temperature_2m", "minimum_temperature_2m"]
GEFS_RAIN_DAYS = 60
CHIRPS_LAT = 50.0
FEED_QUARTERS = (("01-01", "03-31"), ("04-01", "06-30"), ("07-01", "09-30"), ("10-01", "12-31"))
NDVI_COLS = ("field_id", "date", "ndvi", "clear_pct")
_DYN = {}
DYN_TTL_S = 600


def dyn_cached(key, make):
    import time

    hit = _DYN.get(key)
    if hit is None or time.time() - hit[0] > DYN_TTL_S:
        hit = _DYN[key] = (time.time(), make())
    return hit[1]


def dyn(key):
    def open_group():
        import icechunk
        import zarr

        bucket, prefix = DYN[key]
        storage = icechunk.s3_storage(bucket=bucket, prefix=prefix, region="us-west-2", anonymous=True)
        return zarr.open_group(icechunk.Repository.open(storage).readonly_session("main").store, mode="r")

    return dyn_cached(key, open_group)


def dyn_times(arr):
    import pandas as pd

    unit, _, origin = dict(arr.attrs).get("units", "seconds since 1970-01-01").partition(" since ")
    td = pd.to_timedelta(arr[:].astype("int64"), unit=DYN_UNITS[unit.strip()])
    return pd.Timestamp(origin) + td if origin else td


def dyn_coord(key, name):
    def read():
        arr = dyn(key)[name]
        return dyn_times(arr) if name.endswith("time") else arr[:]

    return dyn_cached((key, name), read)


def dyn_cell(key, lat, lon):
    import numpy as np

    lats, lons = dyn_coord(key, "latitude"), dyn_coord(key, "longitude")
    iy, ix = int(np.abs(lats - lat).argmin()), int(np.abs(lons - lon).argmin())
    return iy, ix, {"lat": round(float(lats[iy]), 3), "lon": round(float(lons[ix]), 3)}


def pmap(fn, items, workers):
    out = threads(fn, items, workers)
    for r in out:
        if isinstance(r, Exception):
            raise r
    return out


def dyn_series(key, names, start, end, lat, lon, shift_h=0):
    import numpy as np
    import pandas as pd

    g = dyn(key)
    times = dyn_coord(key, "time")
    a = int(times.searchsorted(pd.Timestamp(start) - pd.Timedelta(hours=shift_h)))
    b = int(times.searchsorted(pd.Timestamp(end) + pd.Timedelta(days=1) - pd.Timedelta(hours=shift_h)))
    iy, ix, cell = dyn_cell(key, lat, lon)
    cols = pmap(lambda n: np.asarray(g[n][a:b, iy, ix], dtype="float64"), names, len(names))
    return pd.DataFrame(dict(zip(names, cols)), index=times[a:b] + pd.Timedelta(hours=shift_h)), cell


def chirps_mm(df):
    c = df.precipitation_surface * 86400
    c.index = c.index.normalize()
    return c


def gefs_daily(temp, rain=None):
    import pandas as pd

    step_h = temp.index.to_series().diff().median() / pd.Timedelta("1h")
    day = temp.resample("1D")
    out = pd.DataFrame({"tmax": day.maximum_temperature_2m.max(), "tmin": day.minimum_temperature_2m.min()})
    out = out[(day.maximum_temperature_2m.count() >= round(24 / step_h)) & out.tmax.notna()]
    out["precip"] = float("nan")
    if rain is not None and len(rain):
        mm = (rain.precipitation_surface * step_h * 3600).resample("1D").sum(min_count=1)
        out["precip"] = mm.reindex(out.index)
    return out


def feed_weather(lat: float = 42.179, lon: float = -93.35, start: str = "2023-01-01", end: str = "", **_):
    import datetime as dt

    import pandas as pd

    lat, lon = float(lat), float(lon)
    today = dt.datetime.now(dt.timezone.utc).date()
    end = end or today.isoformat()
    chirps, shift = abs(lat) <= CHIRPS_LAT, round(lon / 15)
    rain0 = max(start, (today - dt.timedelta(days=GEFS_RAIN_DAYS)).isoformat()) if chirps else start
    jobs = [("gefs", "gefs", GEFS_TEMP, start, shift), ("gefs_rain", "gefs", ["precipitation_surface"], rain0, shift)]
    if chirps:
        jobs += [(k, k, ["precipitation_surface"], start, 0) for k in ("chirps_prelim", "chirps_final")]
    res = dict(zip([j[0] for j in jobs], pmap(lambda j: dyn_series(j[1], j[2], j[3], end, lat, lon, j[4]), jobs, 4)))
    day = gefs_daily(res["gefs"][0], res["gefs_rain"][0])
    src = pd.Series("gefs", index=day.index)
    last = {}
    for key in ("chirps_prelim", "chirps_final"):
        if key in res:
            c = chirps_mm(res[key][0])
            last[key] = c.dropna().index.max().date().isoformat() if c.notna().any() else None
            c = c.reindex(day.index)
            day.loc[c.notna(), "precip"] = c[c.notna()]
            src[c.notna()] = key
    cols = {"date": [d.date().isoformat() for d in day.index], **{k: clean(day[k].tolist(), 2) for k in ("tmax", "tmin", "precip")},
            "precip_src": src.tolist()}
    meta = {"lat": lat, "lon": lon, "cell": res["gefs"][1], "start": start, "end": cols["date"][-1] if cols["date"] else None,
            "last_gefs": cols["date"][-1] if cols["date"] else None, "last_chirps_final": last.get("chirps_final"),
            "last_chirps_prelim": last.get("chirps_prelim"),
            "sources": {"temperature": "NOAA GEFS analysis 0.25 deg (dynamical.org)",
                        "precip": "CHIRPS v2 0.05 deg final + preliminary (dynamical.org), GEFS analysis for the newest days" if chirps
                        else "NOAA GEFS analysis 0.25 deg (dynamical.org; CHIRPS covers 50S-50N only)"}}
    return {"cols": cols, "meta": meta}


def dyn_forecast(key, names, lat, lon, days):
    import numpy as np
    import pandas as pd

    g = dyn(key)
    inits, leads = dyn_coord(key, "init_time"), dyn_coord(key, "lead_time")
    iy, ix, cell = dyn_cell(key, lat, lon)
    nl = int((leads <= pd.Timedelta(days=days + 2)).sum())
    dims = list(g[names[0]].metadata.dimension_names)

    def sel(k, l0, l1):
        pick = {"init_time": k, "lead_time": slice(l0, l1), "latitude": iy, "longitude": ix}
        return tuple(pick.get(d, slice(None)) for d in dims)

    probe = g[names[0]]
    for k in range(len(inits) - 1, max(len(inits) - 6, -1), -1):
        if np.isfinite(np.asarray(probe[sel(k, nl - 2, nl)], dtype="float64")).any():
            break
    else:
        raise RuntimeError(f"no recent {key} forecast has data at this point")
    data = pmap(lambda n: np.asarray(g[n][sel(k, 0, nl)], dtype="float64"), names, len(names))
    return inits[k], leads[:nl], dict(zip(names, data)), cell


def _step_mm(rate, leads):
    import numpy as np
    import pandas as pd

    step_s = np.diff(np.asarray(leads / pd.Timedelta("1s"), dtype="float64"), prepend=0.0)
    return rate * (step_s if rate.ndim == 1 else step_s[:, None])


def feed_forecast(lat: float = 42.179, lon: float = -93.35, days: int = 7, **_):
    import pandas as pd

    lat, lon, days = float(lat), float(lon), max(1, min(int(days), 14))
    shift = pd.Timedelta(hours=round(lon / 15))
    today = (pd.Timestamp.now(tz="UTC").tz_localize(None) + shift).normalize()
    (gi, gl, gv, cell), (ei, el, ev, _) = pmap(lambda a: dyn_forecast(*a), [
        ("gfs", ["maximum_temperature_2m", "minimum_temperature_2m", "precipitation_surface"], lat, lon, days),
        ("ifs_ens", ["temperature_2m", "precipitation_surface"], lat, lon, days)], 2)
    g = pd.DataFrame({"tmax": gv["maximum_temperature_2m"], "tmin": gv["minimum_temperature_2m"],
                      "precip": _step_mm(gv["precipitation_surface"], gl)}, index=gi + gl + shift)
    d = pd.DataFrame({"tmax": g.tmax.resample("1D").max(), "tmin": g.tmin.resample("1D").min(),
                      "precip": g.precip.resample("1D").sum(min_count=1)})
    et = ei + el + shift
    t2m, pr = pd.DataFrame(ev["temperature_2m"], index=et), pd.DataFrame(_step_mm(ev["precipitation_surface"], el), index=et)
    ens = {"tmax": t2m.resample("1D").max(), "tmin": t2m.resample("1D").min(), "precip": pr.resample("1D").sum(min_count=1)}
    d = d.join(pd.DataFrame({"tmax_sd": ens["tmax"].std(axis=1), "tmin_sd": ens["tmin"].std(axis=1),
                             "precip_p10": ens["precip"].quantile(0.1, axis=1), "precip_p90": ens["precip"].quantile(0.9, axis=1),
                             "p_rain": (ens["precip"] > 1.0).mean(axis=1).where(ens["precip"].notna().any(axis=1))}))
    d = d[d.index > today].head(days)
    cols = {"date": [x.date().isoformat() for x in d.index], **{k: clean(d[k].tolist(), 2) for k in d.columns}}
    return {"cols": cols, "meta": {"lat": lat, "lon": lon, "days": days, "init_time": str(gi)[:16], "ens_init_time": str(ei)[:16],
                                   "cell": cell, "source": "NOAA GFS 0.25 deg + ECMWF IFS ENS 51 members (dynamical.org)"}}


def feed_climatology(lat: float = 42.179, lon: float = -93.35, years: str = "2001-2025", **_):
    lat, lon = float(lat), float(lon)
    y0, y1 = (int(v) for v in str(years).split("-"))
    start, end = f"{y0}-01-01", f"{y1}-12-31"
    chirps = abs(lat) <= CHIRPS_LAT
    jobs = [("gefs", GEFS_TEMP if chirps else GEFS_TEMP + ["precipitation_surface"], round(lon / 15))]
    jobs += [("chirps_final", ["precipitation_surface"], 0)] if chirps else []
    res = pmap(lambda j: dyn_series(j[0], j[1], start, end, lat, lon, j[2])[0], jobs, 2)
    day = gefs_daily(res[0][GEFS_TEMP], None if chirps else res[0])
    if chirps:
        day["precip"] = chirps_mm(res[1]).reindex(day.index)
    label = "NOAA GEFS analysis temperature" + (" + CHIRPS final rain" if chirps else " and rain") + " (dynamical.org)"
    return {"cols": normals(day), "meta": {"lat": lat, "lon": lon, "years": f"{y0}-{y1}", "source": label}}


def normals(day):
    import warnings

    import numpy as np

    day = day.asfreq("1D")
    doy = day.index.dayofyear.values
    tx, tn, pr = day.tmax.values, day.tmin.values, day.precip.values
    series = {"tmax": tx, "tmin": tn, "tmid": (tx + tn) / 2, "precip": pr, "r30": day.precip.rolling(30, min_periods=25).sum().values}
    out = {k: [] for k in ("doy", "tmax_p10", "tmax_p50", "tmax_p90", "tmin_p10", "tmin_p50", "tmin_p90", "tmid_mean", "precip_mean",
                           "precip30_p50")}
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for x in range(1, 367):
            w = {k: v[np.abs((doy - x + 183) % 366 - 183) <= 7] for k, v in series.items()}
            out["doy"].append(x)
            for k in ("tmax", "tmin"):
                for q, v in zip((10, 50, 90), np.nanpercentile(w[k], [10, 50, 90])):
                    out[f"{k}_p{q}"].append(v)
            out["tmid_mean"].append(np.nanmean(w["tmid"]))
            out["precip_mean"].append(np.nanmean(w["precip"]))
            out["precip30_p50"].append(np.nanmedian(w["r30"]))
    return clean(out, 2)


def feed_ndvi(bounds: str = "-93.365,42.168,-93.335,42.19", fields: str = "[]", start: str = "2025-07-01",
              end: str = "2025-09-30", max_cloud: int = 80, workers: int = 24, **_):
    import numpy as np
    from pyproj import Transformer
    from rasterio.features import rasterize
    from shapely.ops import transform as sh_transform

    b = parse_bounds(bounds)
    geoms = [(fid, g) for fid, g, _ in parse_fields(fields)]
    if not geoms:
        raise ValueError("fields is empty")
    lon, k_n = (b[0] + b[2]) / 2, len(geoms)
    best = {}
    for it in s2_search(b, start, end, max(0, min(int(max_cloud), 100)), limit=300):
        if all("sentinel-cogs" in it[k] for k in ("red", "nir", "scl")):
            d = solar_date(it["datetime"], lon)
            if d not in best or (it["cloud_cover"] or 0) < (best[d]["cloud_cover"] or 0):
                best[d] = it
    labels = {}

    def one(d):
        sc = s2_read(best[d], b)
        key = (sc["red"].shape, str(sc["crs"]), tuple(sc["transform"])[:6])
        if key not in labels:
            to_r = Transformer.from_crs("EPSG:4326", sc["crs"], always_xy=True).transform
            labels[key] = rasterize([(sh_transform(to_r, g), k + 1) for k, (_, g) in enumerate(geoms)], out_shape=sc["red"].shape,
                                    transform=sc["transform"], fill=0, dtype="int32").ravel()
        lab, v = labels[key], ndvi(sc["red"], sc["nir"]).ravel()
        ok = clear_mask(sc).ravel() & np.isfinite(v)
        return (d, np.bincount(lab, minlength=k_n + 1), np.bincount(lab[ok], minlength=k_n + 1),
                np.bincount(lab[ok], weights=v[ok], minlength=k_n + 1))

    res = threads(one, sorted(best), max(1, min(int(workers), 32)))
    cols = {k: [] for k in NDVI_COLS}
    for r in res:
        if isinstance(r, Exception):
            continue
        d, tot, cnt, sm = r
        for k, (fid, _) in enumerate(geoms):
            if tot[k + 1] and cnt[k + 1] * 100 >= 30 * tot[k + 1]:
                cols["field_id"].append(fid)
                cols["date"].append(d)
                cols["ndvi"].append(round(float(sm[k + 1] / cnt[k + 1]), 4))
                cols["clear_pct"].append(round(100.0 * cnt[k + 1] / tot[k + 1], 1))
    errors = [short_err(r) for r in res if isinstance(r, Exception)]
    if len(errors) > max(2, len(best) // 10):
        raise RuntimeError(f"{len(errors)} of {len(best)} scenes failed to read ({errors[0]})")
    return {"cols": cols, "meta": {"start": start, "end": end, "n_scenes": len(best), "n_failed": len(errors), "errors": errors[:3],
                                   "source": "Sentinel-2 L2A via Earth Search, 10 m"}}


def short_err(err):
    lines = [ln for ln in str(err).strip().splitlines() if ln.strip()]
    return f"{type(err).__name__}: {(lines[-1] if lines else repr(err))[:200]}"


def pheno_year(cols, year):
    import numpy as np
    import pandas as pd

    df = pd.DataFrame(cols)
    keys = ("field_id", "year", "n_scenes", "quality", "base_ndvi", "peak_ndvi", "peak_date", "amplitude", "sos_date",
            "eos_date", "season_days", "auc")
    out = {k: [] for k in keys}
    groups = df.groupby("field_id", sort=True) if len(df) else []
    for fid, g in groups:
        g = g[(g.clear_pct >= 50) & g.ndvi.between(-0.1, 1.0)]
        row = dict.fromkeys(keys)
        row.update(field_id=fid, year=int(year), n_scenes=len(g), quality="none")
        doy = pd.to_datetime(g.date).dt.dayofyear
        if len(g) >= 4 and ((doy >= 60) & (doy <= 330)).any():
            s = pd.Series(g.ndvi.values, index=pd.to_datetime(g.date)).groupby(level=0).mean()
            days = pd.date_range(f"{year}-01-01", s.index.max())
            s = s.reindex(days.union(s.index)).interpolate(limit_area="inside").ffill().bfill().reindex(days)
            v = s.rolling(15, center=True, min_periods=1).median().rolling(15, center=True, min_periods=1).mean().values
            base, ip = float(np.percentile(v, 5)), int(v.argmax())
            amp = float(v[ip]) - base
            row.update(quality="ok" if len(g) >= 8 else "sparse", base_ndvi=base, peak_ndvi=float(v[ip]),
                       peak_date=days[ip].date().isoformat(), amplitude=amp)
            if amp < 0.25:
                row["quality"] = "flat"
            else:
                thr = base + 0.5 * amp
                before, after = np.flatnonzero(v[:ip] < thr), np.flatnonzero(v[ip:] < thr)
                i0 = int(before[-1]) + 1 if len(before) else None
                i1 = ip + int(after[0]) if len(after) else None
                row["sos_date"] = days[i0].date().isoformat() if i0 is not None else None
                row["eos_date"] = days[i1].date().isoformat() if i1 is not None else None
                if i0 is not None and i1 is not None:
                    row.update(season_days=i1 - i0, auc=float(np.clip(v[i0:i1 + 1] - base, 0, None).sum()))
        for k in keys:
            out[k].append(row[k])
    return clean(out, 3)


def feed_jobs(parts, bounds, fields, lat, lon, today, first_year, workers=24):
    import datetime as dt

    jobs, recent = [], (today - dt.timedelta(days=10)).isoformat()
    for p in parts:
        if p == "weather":
            jobs.append((p, "feed_weather", {"lat": lat, "lon": lon, "start": f"{first_year}-01-01"}, "6h"))
        elif p == "forecast":
            jobs.append((p, "feed_forecast", {"lat": lat, "lon": lon}, "3h"))
        elif p == "climatology":
            jobs.append((p, "feed_climatology", {"lat": lat, "lon": lon}, "90d"))
        elif p.startswith("ndvi_"):
            y = int(p[5:])
            for q0, q1 in FEED_QUARTERS:
                s, e = f"{y}-{q0}", min(f"{y}-{q1}", today.isoformat())
                if s <= e:
                    jobs.append((p, "feed_ndvi", {"bounds": bounds, "fields": fields, "start": s, "end": e, "workers": workers},
                                 "90d" if e < recent else "12h"))
        else:
            raise ValueError(f"unknown feed part {p!r}")
    return jobs


def feed_build(bounds: str = "-93.365,42.168,-93.335,42.19", fields: str = "[]", lat: float = 42.179, lon: float = -93.35,
               parts: str = "weather,forecast,climatology,ndvi_2026", years: int = 4, **_):
    """Build feed parts in one round: on a Fused worker every job is its own parallel remote run, elsewhere 6 threads.
    Returns {"parts": {name: base64 parquet}, "errors": {name: message}}; ndvi_<year> also gives pheno_<year>."""
    import datetime as dt
    import json
    import os

    today = dt.datetime.now(dt.timezone.utc).date()
    want = dict.fromkeys(x.strip() for x in str(parts).split(",") if x.strip())
    remote = bool(os.environ.get("AWS_LAMBDA_FUNCTION_NAME"))
    jobs = feed_jobs(want, bounds, fields, float(lat), float(lon), today, today.year - int(years) + 1, 24 if remote else 8)
    me = globals().get("udf")

    def run(job):
        part, action, kw, age = job
        if remote:
            return fused.run(me, engine="remote", cache_max_age=age, action=action, payload=json.dumps(kw))
        return fused.cache(ACTIONS[action], cache_max_age=age)(**kw)

    out, errors = {}, {}
    for (part, *_), r in zip(jobs, threads(run, jobs, len(jobs) if remote else 6)):
        if isinstance(r, Exception) or not isinstance(r, dict) or "error" in r:
            errors[part] = short_err(r) if isinstance(r, Exception) else str(r.get("error") if isinstance(r, dict) else r)[:300]
        elif part.startswith("ndvi_"):
            acc = out.setdefault(part, {"cols": {k: [] for k in NDVI_COLS}, "meta": {"n_scenes": 0, "n_failed": 0, "source": r["meta"]["source"]}})
            for k in NDVI_COLS:
                acc["cols"][k] += r["cols"][k]
            acc["meta"]["n_scenes"] += r["meta"]["n_scenes"]
            acc["meta"]["n_failed"] += r["meta"]["n_failed"]
        else:
            out[part] = r
    for part in [p for p in out if p.startswith("ndvi_")]:
        if part in errors:
            out.pop(part)
            continue
        y = int(part[5:])
        out[part]["meta"].update(start=f"{y}-01-01", end=min(f"{y}-12-31", today.isoformat()))
        out[f"pheno_{y}"] = {"cols": pheno_year(out[part]["cols"], y), "meta": {"year": y, "method": "smooth_thresh_v1"}}
    return {"parts": {name: feed_parquet(part["cols"], part["meta"]) for name, part in out.items()}, "errors": errors}


def feed_parquet(cols, meta):
    import base64
    import io
    import json

    import pyarrow as pa
    import pyarrow.parquet as pq

    buf = io.BytesIO()
    pq.write_table(pa.table(cols).replace_schema_metadata({"feed_meta": json.dumps(meta)}), buf, compression="zstd")
    return base64.b64encode(buf.getvalue()).decode()


ACTIONS = {"farm": farm, "ndvi_grid": ndvi_grid, "weather": weather, "cdl_history": cdl_history, "aef_fields": aef_fields,
           "feed_weather": feed_weather, "feed_forecast": feed_forecast, "feed_climatology": feed_climatology,
           "feed_ndvi": feed_ndvi, "feed_build": feed_build}
