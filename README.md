# FarmVerse

Interactive precision-agriculture simulator: an isometric pixel-art farm built from real field boundaries,
with Sentinel-2 NDVI, weather and a crop water-balance model behind every decision.

Open the folder in fused-render. The first open installs the Python packages from `pyproject.toml` (about a minute).

```
index.html, src/app.js      the page: modes, rail, HUD, missions; talks to eo.py and game.py
src/engine.js, sprites.js   Canvas 2D isometric renderer; all pixel art generated in code
src/charts.js               canvas charts
src/ui/feed.js              the Feed tab (weather, forecast, phenology)
src/ui/account.js           Run on (Fused or This Mac) and the Fused sign-in prompt
eo_udf.py                   Earth-observation UDF that runs on Fused or this Mac (fields, crop type, NDVI, weather, feed)
eo.py                       dispatches eo_udf.py actions to Fused or this Mac (Run on), caches results; place and roads from OpenStreetMap
game.py, sim.py             season state in .fused/data/farmverse.duckdb; AquaCrop-style water balance
SKILL.md, CONTRACTS.md      what eo.py and game.py take and return; every shape shared between the parts
```

Earth observation runs where the Run on menu says: Fused (the default, on your own Fused account; the app asks you to sign
in) or This Mac (no account, slower). The choice is saved in `.fused/data/settings.json`. Sources: Fields of The World polygons,
USDA CDL crop type, AlphaEarth embeddings, Sentinel-2 L2A from Earth Search, and NOAA GEFS, CHIRPS, GFS and ECMWF ensemble
weather from dynamical.org. Results are cached in `.fused/cache/eo/` (7 days, weather 6 h), so a farm opens at once the second time.

Feed (Data drawer > Feed): 4 years of daily weather, 2001-2025 normals, the 7-day forecast and a 10 m Sentinel-2 NDVI record per
field with green-up, peak and senescence per year. It also gives the field NDVI in the popover and the Satellite tab. Each part is a
parquet file in `.fused/cache/feed/` on this machine. A new farm builds in a background process: about 15-25 s on Fused,
several minutes on this Mac; the tab fills in as parts arrive.

Play: arrows or WASD drive the tractor, Shift is fast. On a field press I (irrigate 25 mm), P (plant), X (spray),
H (harvest). Enter or the › » buttons step the season; ‹ « rewind it (the season is re-simulated from the start with the
moves before that day, later moves are undone); C opens the season calendar, M the satellite map of the real ground. Key 1
is Farm mode, 2 is Data mode (NDVI or simulated moisture overlay). Soil moisture and yields are simulated and labelled as
estimates; NDVI shows condition, not cause.
