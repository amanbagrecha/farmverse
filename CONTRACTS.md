# FarmVerse contracts

Shared shapes between the parts. Change a shape here first, then in code.

```
eo_udf.py (Fused or this Mac)   Earth observation; fused.run(engine="remote") on your own Fused sign-in, or engine="local"
eo.py (local)                   dispatch, .fused/cache/eo/ JSON cache, Run on setting, feed parquet in .fused/cache/feed/
game.py + sim.py (local)        game state in .fused/data/farmverse.duckdb
index.html + src/               the page and the isometric renderer
```

## Grid

A farm is a lon/lat box `bounds = [w, s, e, n]` cut into `cols` x `rows` tiles (`cols * rows <= 16384`). Tile index
`t = j * cols + i`, `i` west to east, `j` north to south; tile centre `lon = w + (i + 0.5) * (e - w) / cols`,
`lat = n - (j + 0.5) * (n - s) / rows`. Default farm `story-iowa`: `[-93.365, 42.168, -93.335, 42.19]`, 64 x 64 (about 38 m
per tile). Other farms: `farm_id = "fv-" + sha1("w,s,e,n" at 4 dp)[:8]`, 78 x 63 tiles. Field `name` is a chess label from the
centroid tile (column letter per 8 tiles, row number per 8 tiles, e.g. "B3", duplicates "B3b").

## eo_udf.py actions

`udf(action, payload)`: `payload` is the JSON text of the action's params. Every action returns JSON, `{"error", "hint"}` for a
caller problem, and finishes in under 50 s.

- `farm(bounds, cols = 64, rows = 64, ftw_year = 2025, cdl_year = 2024, min_tiles = 6)`: Fields of The World polygons with the
  centroid in the box, rasterized (a tile belongs to the field holding its centre), fields under `min_tiles` dropped, ordered by
  area, `field_id` F01, F02... Crop = USDA CDL majority inside CONUS (fused-asset public copy), else "unknown".
  `{bounds, cols, rows, tile_m, center, fields: [{field_id, name, area_ha, crop_code, crop, cdl_pct, centroid_lon, centroid_lat,
  confidence, bounds, tiles, geometry}], water: [t], cdl_available, crop_source, country_hint, ftw_year_used, sources}`.
  `crop` is corn, soybeans, winter_wheat, alfalfa, hay, pasture, fallow, other or unknown.
- `ndvi_grid(bounds, cols, rows, start, end, max_cloud = 30)`: newest Sentinel-2 L2A scene with a >= 60 % clear box (else the
  clearest of the 4 newest), NDVI per tile. `{date, scene_id, clear_pct, cols, rows, values: [3 dp | null]}`, `note` when none.
- `weather(lat, lon, start, end, forecast_days = 7)`: `feed_weather` for start..end and `feed_forecast` as rows for the game.
  `{lat, lon, history: [{date, tmax, tmin, precip}], forecast: [{date, tmax, tmin, precip, p_rain}], sources}`; deg C and mm;
  ET0 is computed by sim.py (Hargreaves). The page uses it only for a new farm; later it reads the same rows from the feed.
- `cdl_history(fields, years = "2017-2024")`: majority CDL crop per field per year (2009-2024), one window per year.
  `{years, available, fields: {F01: {"2017": "soybeans"}}, rotation: {F01: "corn-soybeans"}, typical: {F01: "corn"}, source}`;
  outside CONUS `available: false`.
- `aef_fields(bounds, fields, year = 2024, k = 4)`: AlphaEarth Foundations annual embeddings (source.coop, 64 int8 bands,
  `sign(v) * (v / 127.5)^2`) averaged per field and L2-normalised; k-means classes, and nearest-centroid crops with
  leave-one-out accuracy when 2 crops have 2 labelled fields. `{year, supervised, accuracy_loo, n_fields, k, classes,
  fields: {F01: {cluster, pred_crop, confidence, rgb, pixels}}, clusters: [{id, size, label, rgb}], source}`.

### The feed

Per farm: `weather`, `forecast`, `climatology`, and `ndvi_<year>` + `pheno_<year>` for the current year and the 3 before
(11 parts). Same code and sources on both engines: dynamical.org Icechunk stores and Sentinel-2 at native 10 m.

- `feed_build(bounds, fields, lat, lon, parts, years = 4)`: one round for the named parts. Jobs: weather, forecast,
  climatology, one `feed_ndvi` per calendar quarter. On a Fused worker (`AWS_LAMBDA_FUNCTION_NAME`) each job is its own parallel
  `fused.run(engine="remote")` (past quarters 90d, recent 12h, weather 6h, forecast 3h, normals 90d); elsewhere 6 threads. Each
  `ndvi_<year>` also gives `pheno_<year>`; a year with a failed quarter is dropped. Returns `{parts: {name: parquet},
  errors: {name: text}}`, `parquet` = base64 of a zstd parquet file with the meta JSON in the schema key `feed_meta`.
- `feed_weather(lat, lon, start, end = today)`: GEFS analysis temperature (local solar days), rain from CHIRPS final, else
  CHIRPS preliminary, else GEFS (GEFS only outside 50S-50N). Cols `date, tmax, tmin, precip, precip_src`.
- `feed_forecast(lat, lon, days = 7)`: next days from GFS (tmax, tmin, precip) and ECMWF IFS ENS 51 members. Cols `date, tmax,
  tmin, precip, tmax_sd, tmin_sd, precip_p10, precip_p90, p_rain` (share of members over 1 mm).
- `feed_climatology(lat, lon, years = "2001-2025")`: per day of year over a 15-day window: `tmax_p10/p50/p90`,
  `tmin_p10/p50/p90`, `tmid_mean`, `precip_mean`, `precip30_p50`.
- `feed_ndvi(bounds, fields, start, end, max_cloud = 80)`: every scene in the window (one per local solar date), mean NDVI over
  clear pixels (SCL 0, 1, 3, 8, 9, 10 masked) per field; under 30 % clear gives no row; over 10 % failed reads raise. Cols
  `field_id, date, ndvi, clear_pct`.
- `pheno_<year>`: per field, a smoothed daily curve; green-up / senescence where it crosses base + 50 % of the amplitude before /
  after the peak. Cols `field_id, year, n_scenes, quality (ok | sparse | flat | none), base_ndvi, peak_ndvi, peak_date,
  amplitude, sos_date, eos_date, season_days, auc`. All dates are ISO strings.

## eo.py (`fused.runPython("eo.py", {action, ...})`, every param a string)

`farm`, `ndvi_grid`, `weather`, `cdl_history`, `aef_fields` run on the saved engine and are cached in
`.fused/cache/eo/<sha1>.json` (weather 6 h, the rest 7 days; the same ages go to `cache_max_age` on Fused). The answer carries
`_cached`, `_ms` and `_engine`. Failures answer `{"error", "hint"}` and never raise.

- Run on: `engine` "fused" (default) or "local" in `.fused/data/settings.json`. Fused needs the credentials file
  (`FUSED_RENDER_FUSED_CREDENTIALS`, else `~/.fused/credentials`); without it the answer is `{"error": "Not signed in to Fused",
  "hint", "signin": true}` and the SDK is not called. "local" runs in this process with the SDK cache in `.fused/cache/udf/`.
  Page calls are bounded at 54 s from import; on This Mac the page runs EO calls one at a time.
- `settings` (`engine` optional): saves it, answers `{engine, signed_in, local_ready, missing}`. No SDK, no network.
- `account` (`refresh` "1" skips the 10 min cache): `{signed_in, email, handle}` plus `detail` when whoami failed; never `error`.
  Offline with credentials stays signed in.
- `place` (`lat`, `lon`): Nominatim reverse geocode, cached 30 days. `{title, region, locality, county, state, country, lat,
  lon, source}`.
- `roads` (`bounds`, `cols`, `rows`): Overpass highways (4 mirrors, 48 s budget), rasterized with Bresenham; track and service
  ways under 300 m dropped. Cached 30 days. `{tiles, ways: [{name, highway, tiles}], n_ways, source, bounds, cols, rows}`.
- `feed` (`farm_id`, `since`, `build`, plus `bounds`, `fields`, `lat`, `lon` for a build): reads `.fused/cache/feed/<farm_id>/`
  only. TTLs: weather 12 h, forecast 3 h, climatology 90 d, past years 90 d, current year 1 d. `since` = epoch s: only parts built
  after it. `build` = "auto" (missing and stale), "all" or part names: when the farm's `_build.lock` is free, it starts
  `eo.py feed-build <folder>` detached (args on stdin, lock held by that process; the OS frees it when the process ends) and
  answers at once. Plan: Fused = one step with every part; this Mac = weather, forecast, normals and the newest NDVI year, then one NDVI year per
  step, each job cached in `.fused/cache/udf/` for the same ages as on Fused.
  Each step has 900 s; parts are saved as they arrive; progress goes to the fused-render download manager every 15 s.
  `{farm_id, parts: {name: {cols, meta, built_at}}, missing, stale, build: {engine, step, errors, running} | null}`; a builder
  that ended without finishing reports `errors.build`; a build request on Fused without a sign-in answers `{error, hint, signin}`.

## game.py (`fused.runPython("game.py", {action, farm_id, payload})`, payload = JSON text)

- `load` -> `{farm | null, state | null}`; `list` -> `[{farm_id, title, bounds, day, created_at}]`; `reset` deletes the farm.
- `init` `{farm, weather, start_date, title, bounds, history?, aef?}` -> `{farm, state}`. A field with crop "unknown" takes the
  AEF prediction when the classifier is supervised.
- `advance` `{days}` (1-366): every field steps through the weather (history, then forecast, then the last 7 days repeated).
  -> `{state, events}`.
- `op` `{field_id, op: plant | irrigate | spray | harvest, amount_mm?, crop?}` -> `{state, events}`; `irrigate` also returns
  `outlook: {before, after}`. `crop` is required to plant an unknown, other or fallow field.
- `rewind` `{days}` or `{day}`: rebuilds the season from start and replays the ops before that day; later ops are dropped.
  -> `{state, events, dropped_ops, replayed_ops}`.
- `outlook` `{field_id, crop?}` -> `{now, no_irrigation, weekly_irrigation, history: {peak_ndvi_years, this_year_peak_so_far,
  relative_index, note}}`. `history` comes from the farm's feed parts: peaks from `pheno_<year>`, this season from `ndvi_<year>`
  in the 120 days before the game day.
- `series` `{field_id}` -> `{field_id, days: [{date, soil_water_mm, taw_mm, raw_mm, rain_mm, irrigation_mm, et0, ks, stage,
  health, yield_est_t_ha}]}`.
- `set` `{key: value}` stores `state.ui` (tour step, mute, place).

`state`: `{farm_id, title, day, day_index, start_date, season, weather_today: {date, tmax, tmin, precip, et0}, totals:
{water_used_m3, ops, est_yield_t, harvested_t, score, area_ha, water_budget_m3, missions_done, early_harvests}, fields: {F01:
{crop, crop_source: cdl | aef | player | none, planted, plant_date, stage, soil_water_mm, taw_mm, raw_mm, depletion_pct, ks,
stress_days, irrigation_mm, rain_mm, yield_est_t_ha, harvested, last_op, alerts, crop_history, rotation, ...}}, missions,
next_action: {kind, field_id, title, why, key}, ui}`. Score = 100 x missions + 1 x t harvested - m3 irrigation / 1000 - 20 x
early harvests. `events` = `[{date, field_id | null, kind: rain | stress | stage | op | harvest | mission | rewind, text}]`.

## sim.py (pure functions, no I/O)

FAO-56 style water balance per field: `ETc = et0 * kc(stage) * ks`, `ks = 1` below RAW, then linear to 0 at TAW; drainage above
field capacity; canopy and stages by GDD; yield from potential and the mean `ks` over the season and over flowering. ET0 from
the weather row, else Hargreaves.

## src/engine.js

```js
createGame(canvasEl) -> game
game.setFarm(farm); game.setStates(fieldsById); game.setSeason(season); game.setWeather(wx); game.setRoads(roads | null)
game.setOverlay("none" | "ndvi" {values} | "moisture" {byField: 0..1} | "classes" {byField: {rgb, label}} | "aef" {byField: rgb})
game.selectField(id | null); game.flyTo(target, {zoom, duration}) -> Promise   // fieldId | {i, j} | "farmstead" | "overview"
game.setCinematic(on); game.setInput({dx, dy, fast} | null); game.setQuality("low" | "high"); game.zoomBy(+1 | -1); game.resize()
game.groundBox() -> [w, s, e, n]; game.setImagery({canvas, box} | null); game.setBasemap("farm" | "satellite")
game.tractor() -> {i, j, dir, fieldId, moving}
game.on("select" | "op" | "tractor" | "drive" | "idle", fn)
```
Canvas 2D iso tiles 32 x 16, integer zoom 1-4 plus steps down to the whole-farm fit, pixel art generated in `sprites.js`.
Satellite mode projects Esri imagery (`loadImagery` in `src/ui/basemap.js`) onto the ground plane.

## src/sound.js

`createSound() -> {play(name), loop(name, on), ambient(kind | null), setMuted(bool), muted()}`; WebAudio only, no files.

## Page

- Full-bleed world for desktop, tablet and phone (breakpoints 600, 860 and 960 px, safe areas, touch pad). Numbers, words
  and charts only: no progress bars, meters or sliders. One action card at a time: the tour step, else `state.next_action`.
- Panels: field popover, weather bar (today and the next 7 game days), season calendar, Data drawer (Satellite, Water, Crops,
  Feed, Raw), real map (MapLibre), area picker, harvest outlook, menu. The per-field NDVI in the popover and on the
  Satellite tab is the feed `ndvi_<year>` rows for the 120 days before the game day; opening a farm reads the feed and starts a
  build when parts are missing or stale.
- Feed tab: a status line only while building or failed, the 7-day forecast strip, rain since January 1 by year against the
  normal with three numbers, monthly temperature against the normal, the field's NDVI record with green-up, peak and senescence
  marks, one comparison sentence, a 4-column phenology table and one source line with Rebuild. The page polls `feed` with
  `since` after each step of the builder's download-manager row (`fused.watchJob`, at most every 30 s), and redraws only the
  tab that shows the new parts.
- URL: `do=<cmd>[:arg[:arg]]` runs once after the farm opens: `advance:N`, `rewind:N`, `plant|irrigate|spray|harvest:<field>[:crop]`,
  `select:<field>`, `calendar`, `map[:layer]`, `data[:tab]`, `feed[:build]`, `menu`, `picker`, `signin`, `build:lon,lat`,
  `tour[:skip]`, `overlay:<kind>`, `base[:farm|satellite]`, `zoom:in|out[:n]`, `weather`, `mute`, `outlook:<field>`. View
  params: `farm`, `field`, `mode=data&tab=<tab>`, `overlay`, `base`, `view=map`, `cal=open`, `wx=open`.
