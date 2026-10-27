import { h, css, fmt, dateLabel, cropLabel, stageLabel, CROP_COLORS, isPhone } from './util.js';
import { basemapStyle, loadMapLibre } from './basemap.js';
import { ramp, NDVI_STOPS } from '../sprites.js';

css('realmap', `
#rm { position: absolute; z-index: 51; inset: 12px; display: flex; flex-direction: column; background: var(--surface); color: var(--ink);
  border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; animation: fv-fade 0.25s ease-out; }
#rm header { flex: none; display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid var(--line); }
#rm header h2 { margin: 0; flex: 1; min-width: 0; font: 700 15px/1.25 var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#rm header h2 span { font-weight: 400; color: var(--muted); }
#rm .mapw { position: relative; flex: 1 1 0; min-height: 0; background: #0e140c; }
#rm .map { position: absolute; inset: 0; }
#rm .map canvas { outline: none; }
#rm .mapmsg { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; padding: 20px; color: var(--muted); font-size: 13px; }
#rm .cap { position: absolute; left: 10px; bottom: 10px; z-index: 2; max-width: calc(100% - 20px); padding: 6px 9px; border-radius: 8px; background: var(--glass); border: 1px solid var(--line); font-size: 12px; color: var(--ink); }
#rm .cap.hidden { display: none; }
#rm .info { position: absolute; right: 10px; bottom: 34px; z-index: 2; width: 220px; max-width: calc(100% - 20px); padding: 10px 12px; border-radius: 12px; background: var(--glass); border: 1px solid var(--line); box-shadow: var(--shadow); }
#rm .info.hidden { display: none; }
#rm .info b { display: block; font-size: 14px; margin-bottom: 4px; }
#rm .info .sw { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 6px; vertical-align: -1px; }
#rm .info dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; font-size: 12px; }
#rm .info dt { color: var(--muted); } #rm .info dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
#rm .maplibregl-ctrl-attrib { font-size: 10px; }
@media (max-width: 599px) {
  #rm { inset: 0; border-radius: 0; border: 0; padding-top: var(--st); padding-bottom: var(--sb); }
  #rm header { padding: 8px 10px; }
  #rm header h2 { font-size: 14px; }
  #rm header h2 span { display: none; }
  #rm .info { width: auto; left: 10px; right: 10px; bottom: 44px; }
  #rm .cap { max-width: calc(100% - 20px); }
}
`);

const LAYERS = [['satellite', 'Satellite'], ['streets', 'Streets'], ['ndvi', 'NDVI']];
const IDS = ['rm-ndvi', 'rm-box', 'rm-fill', 'rm-line', 'rm-name', 'rm-tractor-halo', 'rm-tractor'];
function ring(b) { return [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]; }

export function createRealMap(ctx) {
  const S = ctx.S, app = document.getElementById('app');
  let el = null, scrim = null, map = null, ml = null, layer = 'satellite', base = null, timer = 0, titleEl = null, segEl = null, capEl = null, infoEl = null, msgEl = null;

  function farmBounds() { const f = S.farm; return f && Array.isArray(f.bounds) && f.bounds.length === 4 ? f.bounds.map(Number) : null; }
  function tileLonLat(i, j) {
    const b = farmBounds(), f = S.farm; if (!b || !f) return null;
    return [b[0] + (i + 0.5) * (b[2] - b[0]) / f.cols, b[3] - (j + 0.5) * (b[3] - b[1]) / f.rows];
  }

  function fieldsGeo() {
    const f = S.farm, feats = [];
    for (const fd of (f && f.fields) || []) {
      if (!fd.geometry || !fd.geometry.type) continue;
      const fs = S.state && S.state.fields ? S.state.fields[fd.field_id] : null, crop = (fs && fs.crop) || fd.crop || 'unknown';
      feats.push({ type: 'Feature', properties: { id: fd.field_id, name: ctx.fieldName(fd.field_id), color: CROP_COLORS[crop] || CROP_COLORS.unknown, lon: fd.centroid_lon, lat: fd.centroid_lat }, geometry: fd.geometry });
    }
    return { type: 'FeatureCollection', features: feats };
  }
  function namesGeo() {
    const g = fieldsGeo();
    return { type: 'FeatureCollection', features: g.features.filter((x) => isFinite(x.properties.lon) && isFinite(x.properties.lat)).map((x) => ({ type: 'Feature', properties: x.properties, geometry: { type: 'Point', coordinates: [+x.properties.lon, +x.properties.lat] } })) };
  }
  function tractorGeo() {
    const t = ctx.game && ctx.game.tractor ? ctx.game.tractor() : null, p = t ? tileLonLat(t.i, t.j) : null;
    return { type: 'FeatureCollection', features: p ? [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } }] : [] };
  }
  function ndviImage() {
    const f = S.farm, g = S.grid; if (!f || !g || !Array.isArray(g.values)) return null;
    const c = document.createElement('canvas'); c.width = f.cols; c.height = f.rows;
    const x = c.getContext('2d'), img = x.createImageData(f.cols, f.rows), d = img.data, vals = g.values;
    for (let k = 0; k < f.cols * f.rows; k++) {
      const v = vals[k]; if (v == null || isNaN(v)) continue;
      const [r, gg, b] = ramp(NDVI_STOPS, Math.round(((v - 0.1) / 0.8) * 24) / 24);
      d[k * 4] = r; d[k * 4 + 1] = gg; d[k * 4 + 2] = b; d[k * 4 + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
  function selColor() { return ['case', ['==', ['get', 'id'], S.selected || ''], '#ffffff', ['get', 'color']]; }

  function addOverlays() {
    if (!map) return;
    const b = farmBounds(); if (!b) return;
    for (const id of IDS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of ['rm-ndvi', 'rm-box', 'rm-fields', 'rm-names', 'rm-tractor']) if (map.getSource(id)) map.removeSource(id);
    const url = ndviImage();
    if (url) {
      map.addSource('rm-ndvi', { type: 'image', url, coordinates: [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]] });
      map.addLayer({ id: 'rm-ndvi', type: 'raster', source: 'rm-ndvi', paint: { 'raster-opacity': 0.8, 'raster-resampling': 'nearest', 'raster-fade-duration': 0 }, layout: { visibility: layer === 'ndvi' ? 'visible' : 'none' } });
    }
    map.addSource('rm-box', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: ring(b) } } });
    map.addLayer({ id: 'rm-box', type: 'line', source: 'rm-box', paint: { 'line-color': '#f2c230', 'line-width': 2, 'line-dasharray': [3, 2] } });
    map.addSource('rm-fields', { type: 'geojson', data: fieldsGeo() });
    map.addLayer({ id: 'rm-fill', type: 'fill', source: 'rm-fields', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': layer === 'ndvi' ? 0 : 0.25 } });
    map.addLayer({ id: 'rm-line', type: 'line', source: 'rm-fields', paint: { 'line-color': selColor(), 'line-width': 1.5 } });
    map.addSource('rm-names', { type: 'geojson', data: namesGeo() });
    map.addLayer({ id: 'rm-name', type: 'symbol', source: 'rm-names', layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 13, 'text-allow-overlap': true, 'text-ignore-placement': true },
      paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(10, 16, 8, 0.85)', 'text-halo-width': 1.6 } });
    map.addSource('rm-tractor', { type: 'geojson', data: tractorGeo() });
    map.addLayer({ id: 'rm-tractor-halo', type: 'circle', source: 'rm-tractor', paint: { 'circle-radius': 10, 'circle-color': '#f2c230', 'circle-opacity': 0.35 } });
    map.addLayer({ id: 'rm-tractor', type: 'circle', source: 'rm-tractor', paint: { 'circle-radius': 5, 'circle-color': '#5fb24a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 } });
    caption();
  }
  function applyLayer() {
    if (!el) return;
    for (const b of segEl.querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.k === layer ? 'true' : 'false');
    if (!map) return;
    const want = layer === 'streets' ? 'streets' : 'satellite';
    if (want !== base) { base = want; map.once('style.load', addOverlays); map.setStyle(basemapStyle(want), { diff: false }); }
    else { if (map.getLayer('rm-ndvi')) map.setLayoutProperty('rm-ndvi', 'visibility', layer === 'ndvi' ? 'visible' : 'none'); if (map.getLayer('rm-fill')) map.setPaintProperty('rm-fill', 'fill-opacity', layer === 'ndvi' ? 0 : 0.25); }
    caption();
  }
  function caption() {
    if (!capEl) return;
    capEl.classList.toggle('hidden', layer !== 'ndvi');
    const g = S.grid;
    capEl.textContent = g && g.date ? 'Sentinel-2 L2A NDVI, scene of ' + dateLabel(g.date) : 'No clear Sentinel-2 scene yet';
  }
  function info() {
    if (!infoEl) return;
    const id = S.selected, f = ctx.fieldOf(id), fs = S.state && S.state.fields ? S.state.fields[id] : null;
    infoEl.classList.toggle('hidden', !f);
    if (!f) return;
    const crop = (fs && fs.crop) || f.crop || 'unknown';
    infoEl.textContent = '';
    infoEl.append(h('b', {}, h('span', { class: 'sw', style: 'background:' + (CROP_COLORS[crop] || CROP_COLORS.unknown) }), 'Field ' + ctx.fieldName(id)),
      h('dl', {}, h('dt', { text: 'Crop' }), h('dd', { text: cropLabel(crop) }), h('dt', { text: 'Area' }), h('dd', { text: fmt(fs && fs.area_ha != null ? fs.area_ha : f.area_ha, 1) + ' ha' }),
        h('dt', { text: 'Stage' }), h('dd', { text: stageLabel(fs ? fs.stage : 'not planted') })));
  }
  function tick() { if (map && map.getSource('rm-tractor')) map.getSource('rm-tractor').setData(tractorGeo()); }
  function refresh() {
    if (!el) return;
    titleEl.textContent = ctx.farmTitle();
    titleEl.append(h('span', { text: ' · real imagery and roads from Esri / OpenStreetMap' }));
    if (map && map.getSource('rm-fields')) {
      map.getSource('rm-fields').setData(fieldsGeo()); map.getSource('rm-names').setData(namesGeo());
      if (map.getLayer('rm-line')) map.setPaintProperty('rm-line', 'line-color', selColor());
      if (!map.getSource('rm-ndvi') && S.grid) addOverlays();
    }
    info(); caption();
  }
  function close() {
    if (!el) return;
    clearInterval(timer); timer = 0;
    try { map && map.remove(); } catch (e) {}
    map = null; base = null; el.remove(); scrim.remove(); el = scrim = null;
    ctx.writeParam('view', '');
  }
  async function open(opts) {
    opts = opts || {};
    if (opts.layer && LAYERS.some(([k]) => k === opts.layer)) layer = opts.layer;
    if (el) { applyLayer(); return; }
    if (!S.farm) return;
    scrim = h('div', { id: 'rm-scrim', class: 'scrim', onclick: close });
    el = h('section', { id: 'rm', role: 'dialog', 'aria-label': 'Real map of this farm' });
    titleEl = h('h2');
    msgEl = h('div', { class: 'mapmsg', text: 'Loading the map…' });
    segEl = h('div', { class: 'seg float', role: 'group', 'aria-label': 'Map layer' }, LAYERS.map(([k, lbl]) => h('button', { 'data-k': k, text: lbl, 'aria-pressed': k === layer ? 'true' : 'false', onclick: () => { layer = k; ctx.sfx('ui'); applyLayer(); } })));
    capEl = h('div', { class: 'cap hidden' });
    infoEl = h('div', { class: 'info hidden' });
    const mapw = h('div', { class: 'mapw' }, h('div', { class: 'map' }), msgEl, segEl, capEl, infoEl);
    el.append(h('header', {}, titleEl, h('button', { class: 'x lg', 'aria-label': 'Close', text: '×', onclick: close })), mapw);
    app.append(scrim, el);
    ctx.writeParam('view', 'map');
    refresh();
    const b = farmBounds();
    try {
      ml = await loadMapLibre();
      if (!el) return;
      base = layer === 'streets' ? 'streets' : 'satellite';
      map = new ml.Map({ container: mapw.querySelector('.map'), style: basemapStyle(base), bounds: b ? [[b[0], b[1]], [b[2], b[3]]] : undefined, fitBoundsOptions: { padding: 40 }, maxZoom: 19, attributionControl: { compact: true } });
      map.addControl(new ml.NavigationControl({ showCompass: false }), 'top-right');
      const fit = () => { if (!map || !b) return; map.resize(); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 40, maxZoom: 19, duration: 0 }); };
      map.on('load', () => { addOverlays(); fit(); });
      map.once('idle', fit);
      map.on('click', 'rm-fill', (e) => { const f = e.features && e.features[0]; if (!f) return; ctx.sfx('select'); ctx.selectField(f.properties.id, { popover: false }); refresh(); });
      map.on('mouseenter', 'rm-fill', () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', 'rm-fill', () => { map.getCanvas().style.cursor = ''; });
      map.on('error', (e) => { const m = e && e.error && e.error.message; if (m && !/tile|glyph|font|pbf|404|403/i.test(m)) console.warn('realmap', m); });
      msgEl.remove(); msgEl = null;
      timer = setInterval(tick, 1000);
    } catch (e) {
      map = null;
      if (msgEl) msgEl.textContent = /webgl/i.test(String(e && e.message)) ? 'This browser could not start a WebGL map. The isometric farm still works; try another browser for the real view.' : 'Map unavailable (' + (e && e.message) + ').';
    }
    if (isPhone()) el.querySelector('.x').focus();
  }
  return { open, close, isOpen: () => !!el, refresh };
}
