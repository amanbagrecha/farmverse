---
name: farmverse
description: FarmVerse app - isometric farm sim over real FTW fields; runs Earth observation (Sentinel-2 NDVI, dynamical.org weather) on Fused with your own sign-in or on this Mac (Run on setting).
approve: [game.py]
---

## eo.py

Runs one Earth-observation action on Fused or on this Mac. Writes `.fused/cache/eo/` (cached JSON results, the account check), `.fused/cache/udf/` (SDK cache of the This Mac engine), `.fused/cache/feed/` (feed parquet and the builder state, written by the detached `eo.py feed-build` process) and, for `settings` with `engine`, `.fused/data/settings.json`; every other call only reads.
Dispatcher for `eo_udf.py` (the UDF that ships with the app). Page call: `fused.runPython("eo.py", {action, ...})`, every param a string.

| action | params |
| --- | --- |
| `farm` | `bounds` "w,s,e,n", `cols`, `rows`, `ftw_year` 2025, `cdl_year` 2024, `min_tiles` 6 |
| `ndvi_grid` | `bounds`, `cols`, `rows`, `start`, `end`, `max_cloud` 30 |
| `weather` | `lat`, `lon`, `start`, `end`, `forecast_days` 7 |
| `cdl_history` | `fields` (JSON list of `{field_id, geometry}`; the `farm` fields work), `years` "2017-2024" |
| `aef_fields` | `bounds`, `fields` (JSON list of `{field_id, geometry, crop}`), `year` 2024, `k` 4 |
| `place` | `lat`, `lon` (decimal degrees as strings); local, OpenStreetMap Nominatim |
| `roads` | `bounds` "w,s,e,n", `cols` 64, `rows` 64; local, OpenStreetMap Overpass |
| `settings` | `engine` (optional: "fused" or "local"; saves the Run on choice, omit to only read); no SDK, no network |
| `account` | `refresh` (optional "1": skip the 10 minute cache); the Fused sign-in check |
| `feed` | `farm_id`; `since` (epoch s: only parts built after it); `build` ("" = read only, "auto" = missing and stale parts, "all", or a comma list of part names) with `bounds`, `fields` (the `farm` fields), `lat`, `lon` |

- Returns the action's JSON (shapes in CONTRACTS.md) plus `_cached` (bool), `_ms` and `_engine` ("fused"|"local"). Failures return `{"error", "hint"}`, never raise.
  `farm` also answers `{"error", "hint"}` when no FTW tile or no field covers the box (not cached).
- `farm` works anywhere FTW has fields: `cdl_available`, `crop_source` ("cdl"|"none"), `country_hint` (Natural Earth, e.g. "FR"), `ftw_year_used`;
  outside CONUS every field is `crop: "unknown"`, `cdl_pct: 0`, `water: []`. Fields carry `geometry` (GeoJSON, ~5 m).
- `weather` = GEFS analysis temperature and CHIRPS rain for start..end plus the GFS + ECMWF ensemble forecast, as `history` and `forecast` rows
  (`date, tmax, tmin, precip`, forecast also `p_rain` 0-1). No ET0: `game.py` computes it.
- `cdl_history` outside CONUS: `available: false`, `fields: {}`. `rotation` is the alphabetical pair ("corn-soybeans"), the single crop when one
  crop holds >= 75 % of the years, else "mixed". `aef_fields` also returns `k`, `classes` and per field `pixels`; in unsupervised mode
  `confidence` is the cluster-membership share (softmax of cosine, tau 0.05).
- Run on: `settings.json` holds `engine`, "fused" (default) or "local". The five EO actions check the cache first, then run
  `fused.run(fused.load("eo_udf.py"), engine="remote"|"local", action=<action>, payload=<JSON of the params>)`: "fused" runs on the caller's own Fused
  sign-in with `cache_max_age` "7d" ("6h" for weather); "local" runs the same UDF in this process and needs the geo packages (pyproject lists them).
  The cache is shared by both engines. `place` and `roads` never touch the engine.
- Signed out: engine "fused" with no credentials file (`FUSED_RENDER_FUSED_CREDENTIALS`, else `~/.fused/credentials`) and no cached answer returns at once,
  without the SDK, `{"error": "Not signed in to Fused", "hint": "Sign in to Fused from the prompt in FarmVerse, or set Run on to This Mac (no account needed).", "signin": true}`.
  A Fused auth error (401, 403, credential, login, token, not logged in) gives the same `signin` and hint. Local errors never set `signin`.
- `settings` returns `{"engine", "signed_in" (credentials file exists), "local_ready", "missing": [import names]}`. An engine other than fused/local returns
  `{"error", "hint"}` and saves nothing.
- `account` returns `{"signed_in", "email", "handle"}` and never an `error` key (a reason goes in `detail`). `fused.api.whoami()` runs once (20 s cap),
  cached 10 minutes for the credentials file's mtime. Offline with credentials stays `signed_in: true` + `detail`.
- Examples: `{"action":"py","app":"farmverse","file":"eo.py","args":{"action":"settings","engine":"local"}}`;
  `{"action":"py","app":"farmverse","file":"eo.py","args":{"action":"account"}}` returns `{"signed_in": true, "email": "you@example.com", "handle": "you"}`.
- Cache: `.fused/cache/eo/<sha1 of action + sorted params + "v3">.json`; 7 days, 6 h for weather; `place` and `roads` 30 days. Bump `VERSION` to invalidate.
- `place` returns `{"title": "Warren Township, Iowa", "region": "Story County, Iowa, United States", "locality", "county", "state", "country", "lat", "lon", "source"}`.
  `roads` returns OSM highways rasterized into the farm grid: `{"tiles", "ways": [{"name", "highway", "tiles"}], "n_ways", "source", "bounds", "cols", "rows"}`
  (default farm: 183 tiles, 5 ways). Overpass mirrors are often busy; the hint says to retry.
- Typical cold times on Fused: farm ~12 s, ndvi_grid ~4 s, weather ~14 s; 0 ms cached; This Mac 2-4x slower.
- Default box `-93.365,42.168,-93.335,42.19` (Story County, Iowa: 16 fields). Non-US boxes that work: France Beauce `1.55,48.30,1.58,48.32` (18 fields),
  Brazil `-55.90,-13.10,-55.87,-13.08` (3), India Punjab `75.80,30.90,75.83,30.92` (14).
- `feed` (CONTRACTS.md, The feed): 11 parquet parts per farm in `.fused/cache/feed/<farm_id>/`. A read never calls the engine or the network.
  `build` starts `eo.py feed-build <folder>` detached when the farm's lock is free and returns at once (Fused: one round of 19 parallel jobs, about
  15-25 s; this Mac: several minutes, one NDVI year per step, jobs cached in `.fused/cache/udf/`); poll `feed` with `since` for new parts.
  Returns `{"farm_id", "parts": {name: {"cols", "meta", "built_at"}}, "missing", "stale", "build": {"engine", "step", "errors", "running"} | null, "_ms"}`.
  Example: `{"action":"py","app":"farmverse","file":"eo.py","args":{"action":"feed","farm_id":"story-iowa"}}`.

## game.py

Runs one game action over the season state. Writes `.fused/data/farmverse.duckdb` for init/advance/op/rewind/set/reset; load/series/outlook/list only read (outlook also reads the feed parts).
Simulation lives in `sim.py` (pure functions: GDD phenology, FAO-56 root-zone bucket with Ks, Hargreaves ET0 when the weather has none, AquaCrop-style biomass, pest pressure, missions, score, next action, outlook).

- Args: `action` (one of load, init, advance, op, series, outlook, set, reset, list, rewind; default "load"), `farm_id` (default "story-iowa"), `payload` (JSON object text, default "")
- Payloads and returns:
  - `load` -> `{"farm" | null, "state" | null}`
  - `init` `{"farm": <farm result>, "weather": <weather result>, "start_date": "2025-05-01", "title", "bounds", "history"?: <cdl_history result>, "aef"?: <aef_fields result>}` -> `{"farm", "state"}`; replaces a farm with the same id and keeps its `ui`.
  - `advance` `{"days": 1..366}` -> `{"state", "events"}`; weather = history, then forecast, then the last 7 history days repeated
  - `op` `{"field_id": "F01", "op": "plant"|"irrigate"|"spray"|"harvest", "amount_mm": 25, "crop": "corn"}` -> `{"state", "events"}`. `crop` is required to plant an unknown/other/fallow field. `irrigate` also returns `outlook: {"before", "after"}`.
  - `rewind` `{"days": 7}` or `{"day": "2025-08-18"}` -> `{"state", "events", "dropped_ops", "replayed_ops"}`; replays the ops before that day.
  - `outlook` `{"field_id", "crop"?}` -> `{"field_id", "name", "crop", "as_of", "assumes_planting_today", "harvested", "now", "no_irrigation", "weekly_irrigation", "history"}`. Each path is `{"yield_est_t_ha", "harvest_t", "mature_date", "stress_days", "irrigation_mm", "water_m3"}`. `history` = `{"peak_ndvi_years", "mean_peak", "this_year_peak_so_far", "relative_index", "note"}`, read from the farm's feed parts (`pheno_<year>` peaks, `ndvi_<year>` for the 120 days before the game day).
  - `set` `{"tour_step": "plant", "muted": true, ...}` -> `{"state"}`; keys merged into `state.ui`, `null` removes a key
  - `series` `{"field_id": "F01"}` -> `{"field_id", "days": [{"date", "soil_water_mm", "taw_mm", "raw_mm", "rain_mm", "irrigation_mm", "et0", "ks", "stage", "health", "yield_est_t_ha"}]}`
  - `reset` -> `{"ok": true, "farm_id", "deleted"}`; `list` -> `[{"farm_id", "title", "bounds", "day", "created_at"}]`
- `state` = the CONTRACTS.md shape; per field also `name`, `area_ha`, `et_mm`, `pest_pressure`, `harvest_date`, `mature_date`, `crop_history`, `rotation`, `typical_crop`, `crop_source` (cdl|aef|player|none), `aef_pred`. Stages: not_planted, emergence, vegetative, flowering, grain_fill, mature, harvested.
- `next_action` = `{"kind": "harvest"|"irrigate"|"spray"|"plant"|"advance"|"wait", "field_id", "title", "why", "key"}` plus `amount_mm`, `crop`, `days`. Priority: a mature field > the most stressed field > pest pressure > 0.6 > a bare field in its planting window > advance > wait.
- Every response carries `_ms`. User errors return `{"error", "hint"}`, never raise. The DuckDB lock is retried 3 times when calls overlap.
- Example: `{"action":"py","app":"farmverse","file":"game.py","args":{"action":"outlook","farm_id":"story-iowa","payload":"{\"field_id\": \"F01\"}"}}`
