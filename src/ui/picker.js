// Area picker: MapLibre map with a fixed 3 x 2.4 km box, Open-Meteo place search, saved farms list, "Start farm here".
import { h, css, dateLabel, debounce } from './util.js';
import { basemapStyle, BASEMAPS, loadMapLibre } from './basemap.js';

css('picker', `
#pk { position: absolute; z-index: 51; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(1000px, calc(100% - 32px)); height: min(660px, calc(100% - 32px));
  display: grid; grid-template-columns: minmax(0, 1fr) 320px; grid-template-rows: auto minmax(0, 1fr); background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; animation: fv-fade 0.25s ease-out; }
#pk header { grid-column: 1 / -1; display: flex; align-items: center; gap: 10px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
#pk header h2 { margin: 0; flex: 1; min-width: 0; font: 700 16px/1.2 var(--sans); }
#pk .mapw { position: relative; min-width: 0; min-height: 0; background: var(--surface-2); }
#pk .map { position: absolute; inset: 0; }
#pk .box { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); border: 2px solid #e0a400; background: rgba(242, 194, 48, 0.12); border-radius: 3px; pointer-events: none; box-shadow: 0 0 0 9999px rgba(20, 27, 18, 0.18); }
#pk .box span { position: absolute; left: 0; top: -22px; font: 600 11px/1 var(--sans); color: #1d2616; background: #f2c230; padding: 4px 6px; border-radius: 5px; white-space: nowrap; }
#pk .where small { display: block; font-weight: 400; font-size: 12px; color: var(--muted); }
#pk .mapmsg { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 20px; color: var(--muted); font-size: 13px; }
#pk .side { display: flex; flex-direction: column; min-height: 0; border-left: 1px solid var(--line); }
#pk .sec { flex: none; padding: 12px 14px; border-bottom: 1px solid var(--hair); }
#pk .sec h3 { margin: 0 0 6px; }
#pk input[type=search] { width: 100%; height: 36px; padding: 0 10px; border-radius: 9px; border: 1px solid var(--line); background: var(--bg); -webkit-appearance: none; appearance: none; }
#pk input[type=search]:focus { outline: 2px solid var(--accent); outline-offset: 0; }
#pk .res { display: grid; gap: 2px; margin-top: 6px; }
#pk .res button { text-align: left; padding: 6px 8px; border-radius: 7px; font-size: 12.5px; }
#pk .res button:hover, #pk .res button:focus-visible { background: var(--surface-2); outline: none; }
#pk .res small { color: var(--muted); }
#pk p { margin: 0; font-size: 12px; color: var(--muted); }
#pk .where { font: 700 14px/1.3 var(--sans); margin-bottom: 4px; min-height: 18px; }
#pk .go { width: 100%; height: 42px; margin-top: 10px; font-size: 14px; }
#pk .saved { flex: 1 1 0; min-height: 0; }
#pk .saved button { display: flex; flex-direction: column; width: 100%; text-align: left; padding: 7px 8px; border-radius: 8px; font-size: 13px; min-width: 0; }
#pk .saved button:hover { background: var(--surface-2); }
#pk .saved button.cur { background: var(--surface-2); }
#pk .saved button b { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
#pk .saved button small { color: var(--muted); font-size: 11.5px; }
@media (max-width: 759px) {
  #pk { left: 0; top: 0; transform: none; width: 100%; height: 100%; border-radius: 0; grid-template-columns: 1fr; grid-template-rows: auto minmax(220px, 1fr) auto; padding-top: var(--st); padding-bottom: var(--sb); }
  #pk .side { border-left: 0; border-top: 1px solid var(--line); max-height: 46vh; overflow-y: auto; }
  #pk .saved { flex: none; overflow: visible; }
}
`);

const W_M = 3000, H_M = 2400;
let basemap = 'satellite';
export function boxAround(lon, lat) {
  const dlon = W_M / (111320 * Math.cos((lat * Math.PI) / 180)), dlat = H_M / 110574;
  const r = (v) => Math.round(v * 1e4) / 1e4;
  return [r(lon - dlon / 2), r(lat - dlat / 2), r(lon + dlon / 2), r(lat + dlat / 2)];
}

export function createPicker(ctx) {
  const S = ctx.S, app = document.getElementById('app');
  let el = null, scrim = null, map = null, center = null, place = null, boxEl = null, whereEl = null, goBtn = null, geo = null, geoSeq = 0, searchSeq = 0;
  function close() { if (!el) return; try { map && map.remove(); } catch (e) {} map = null; el.remove(); scrim.remove(); el = scrim = null; }
  function label() {
    if (!center) return '';
    if (place) { const d = Math.hypot((place.lon - center.lon) * Math.cos((center.lat * Math.PI) / 180), place.lat - center.lat) * 111; if (d < 15) return place.label; }
    return 'Farm near ' + center.lat.toFixed(2) + ', ' + center.lon.toFixed(2);
  }
  function title() { return geo && geo.title ? geo.title : label(); }
  function renderWhere() {
    whereEl.textContent = '';
    if (geo && geo.title) { whereEl.append(geo.title, geo.region ? h('small', { text: geo.region }) : null); return; }
    whereEl.textContent = label();
  }
  async function geocode() {
    if (!center || !el) return;
    const c = center, seq = ++geoSeq;
    try {
      const p = await ctx.py('eo.py', { action: 'place', lat: String(c.lat), lon: String(c.lon) }, { key: 'eo-place-pk' });
      if (seq !== geoSeq || !el) return;
      geo = p && p.title ? { title: p.title, region: p.region || '', lat: c.lat, lon: c.lon } : null;
    } catch (e) { if (seq === geoSeq) geo = null; }
    renderWhere();
  }
  const geocodeSoon = debounce(geocode, 500);
  function update() {
    if (!center || !el) return;
    const b = boxAround(center.lon, center.lat);
    if (geo && Math.hypot(geo.lat - center.lat, geo.lon - center.lon) > 0.02) geo = null;
    renderWhere();
    el.querySelector('.bnd').textContent = b.join(', ');
    if (map && boxEl) {
      const p1 = map.project([b[0], b[3]]), p2 = map.project([b[2], b[1]]);
      const w = Math.max(14, p2.x - p1.x), hh = Math.max(11, p2.y - p1.y);
      boxEl.style.width = w + 'px'; boxEl.style.height = hh + 'px';
      boxEl.querySelector('span').textContent = w < 40 ? 'zoom in' : '3 × 2.4 km';
    }
  }
  async function search(q, list) {
    const seq = ++searchSeq;
    list.textContent = '';
    if (!q || q.trim().length < 2) return;
    try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q.trim()) + '&count=5&language=en&format=json');
      const j = await r.json();
      if (seq !== searchSeq) return;
      const res = j.results || [];
      if (!res.length) { list.append(h('p', { text: 'No place called "' + q + '"' })); return; }
      for (const p of res) {
        const lbl = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
        list.append(h('button', { onclick: () => { place = { label: [p.name, p.admin1 || p.country].filter(Boolean).join(', '), lat: p.latitude, lon: p.longitude }; center = { lat: p.latitude, lon: p.longitude }; list.textContent = ''; ctx.sfx('select'); if (map) map.flyTo({ center: [p.longitude, p.latitude], zoom: 12.5, duration: 1600 }); update(); } }, h('span', { text: lbl }), h('br'), h('small', { text: p.latitude.toFixed(3) + ', ' + p.longitude.toFixed(3) + (p.feature_code ? ' · ' + p.feature_code : '') })));
      }
    } catch (e) { list.append(h('p', { text: 'Search failed: ' + e.message })); }
  }
  async function renderSaved(box) {
    box.textContent = '';
    box.append(h('p', { text: 'Loading saved farms…' }));
    let farms = [];
    try { farms = await ctx.listFarms(); } catch (e) { farms = []; }
    box.textContent = '';
    const pl = ctx.place && ctx.place();
    const def = { farm_id: 'story-iowa', title: S.farmId === 'story-iowa' && pl && pl.title ? pl.title : 'Default farm', region: S.farmId === 'story-iowa' && pl ? pl.region || '' : '' };
    const all = [def, ...farms.filter((f) => f.farm_id !== def.farm_id)];
    const byId = Object.fromEntries(farms.map((f) => [f.farm_id, f]));
    for (const f of all) {
      const info = byId[f.farm_id] || {};
      const live = f.farm_id === S.farmId && ctx.place() && ctx.place().title ? ctx.place() : null;
      const t = (live && live.title) || info.title || info.name || f.title || f.farm_id, region = (live && live.region) || info.region || f.region || '';
      box.append(h('button', { class: f.farm_id === S.farmId ? 'cur' : '', onclick: () => { ctx.sfx('ui'); close(); ctx.switchFarm(f.farm_id); } }, h('b', { text: t }), h('small', { text: [f.farm_id === S.farmId ? 'playing now' : null, region || null, info.day ? 'season day ' + dateLabel(info.day) : f.farm_id === def.farm_id ? 'default farm' : 'not started'].filter(Boolean).join(' · ') })));
    }
  }
  async function open() {
    if (el) return;
    const c0 = S.farm && S.farm.center ? S.farm.center : { lat: 42.179, lon: -93.35 };
    center = { lat: c0.lat, lon: c0.lon }; place = S.state ? { label: S.state.title || 'This farm', lat: c0.lat, lon: c0.lon } : null;
    const pl0 = ctx.place && ctx.place();
    geo = pl0 && pl0.title ? { title: pl0.title, region: pl0.region || '', lat: c0.lat, lon: c0.lon } : null;
    scrim = h('div', { id: 'pk-scrim', class: 'scrim', onclick: close });
    el = h('section', { id: 'pk', role: 'dialog', 'aria-label': 'Start a farm anywhere' });
    const seg = h('div', { class: 'seg float', role: 'group', 'aria-label': 'Basemap' });
    const setBase = (k) => { basemap = k; for (const b of seg.children) b.setAttribute('aria-pressed', String(b.dataset.k === k)); if (map) map.setStyle(basemapStyle(k)); };
    for (const [k, lbl] of BASEMAPS) seg.append(h('button', { 'data-k': k, 'aria-pressed': String(k === basemap), text: lbl, onclick: () => { ctx.sfx('ui'); setBase(k); } }));
    const mapw = h('div', { class: 'mapw' }, h('div', { class: 'map' }), h('div', { class: 'mapmsg', text: 'Loading the map…' }));
    boxEl = h('div', { class: 'box' }, h('span', { text: '3 × 2.4 km' }));
    const list = h('div', { class: 'res' });
    const input = h('input', { type: 'search', placeholder: 'Search a town or region', 'aria-label': 'Search place', autocomplete: 'off' });
    const doSearch = debounce((q) => search(q, list), 300);
    input.addEventListener('input', () => doSearch(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const b = list.querySelector('button'); if (b) b.click(); } e.stopPropagation(); });
    whereEl = h('div', { class: 'where' });
    goBtn = h('button', { class: 'btn primary go', text: 'Start farm here', onclick: () => { if (!center) return; const b = boxAround(center.lon, center.lat), t = title(); ctx.sfx('ui'); close(); ctx.startFarm({ bounds: b, title: t }); } });
    const saved = h('div', { class: 'saved scroll' });
    el.append(
      h('header', {}, h('h2', { text: 'Start a farm anywhere' }), h('button', { class: 'x lg', 'aria-label': 'Close', text: '×', onclick: close })),
      mapw,
      h('div', { class: 'side' },
        h('div', { class: 'sec' }, h('h3', { class: 'lbl', text: 'Find a place' }), input, list),
        h('div', { class: 'sec' }, h('h3', { class: 'lbl', text: 'Your box' }), whereEl, h('p', { class: 'bnd' }), h('p', { style: 'margin-top:6px', text: 'Fields come from Fields of The World, so the box must sit on farmland it covers. Crop history uses USDA CDL in the USA; elsewhere AlphaEarth classes stand in.' }), goBtn),
        h('div', { class: 'sec', style: 'border-bottom:0;padding-bottom:4px' }, h('h3', { class: 'lbl', text: 'Saved farms' })),
        h('div', { class: 'sec saved', style: 'padding-top:0' }, saved)));
    app.append(scrim, el);
    update(); renderSaved(saved); if (!geo) geocodeSoon();
    if (window.innerWidth >= 760) input.focus();
    try {
      const ml = await loadMapLibre();
      if (!el) return;
      map = new ml.Map({ container: mapw.querySelector('.map'), style: basemapStyle(basemap), center: [center.lon, center.lat], zoom: 12.5, maxZoom: 19, attributionControl: { compact: true } });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'bottom-right');
      mapw.append(boxEl, seg);
      map.on('move', () => { const c = map.getCenter(); center = { lat: c.lat, lon: c.lng }; update(); });
      map.on('moveend', () => { if (!geo || Math.hypot(geo.lat - center.lat, geo.lon - center.lon) > 0.004) geocodeSoon(); });
      map.on('load', update); map.on('resize', update);
      const msg = mapw.querySelector('.mapmsg'); if (msg) msg.remove();
      update();
    } catch (e) {
      map = null;
      const m = mapw.querySelector('.mapmsg'); if (m) m.textContent = 'Map unavailable (' + e.message + '). Search a place and start there; the box is centred on the place you pick.';
    }
  }
  return { open, close, isOpen: () => !!el };
}
