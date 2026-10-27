// Data drawer: Satellite (NDVI overlay + series), Water (season chart), Crops (CDL history, AlphaEarth classes), Raw (every response).
import { h, css, fmt, dateLabel, cropLabel, stageLabel, CROP_COLORS, copyText, nums, legend, chartFig } from './util.js';
import { sparkline, seasonChart } from '../charts.js';
import { hx } from '../sprites.js';
import { feedTab } from './feed.js';

css('drawer', `
#drawer { position: absolute; z-index: 25; right: calc(var(--gap) + var(--sr)); bottom: calc(var(--gap) + var(--sb) + var(--pad-h) + 52px); max-height: calc(100% - var(--wx-bottom) - 8px - var(--gap) - var(--sb) - var(--pad-h) - 52px);
  width: 432px; display: flex; flex-direction: column; animation: fv-rise 0.28s ease-out; }
#drawer header { display: flex; align-items: center; gap: 8px; padding: 8px 8px 0 10px; }
#drawer [role=tablist] { flex: 1; display: flex; gap: 2px; min-width: 0; }
#drawer [role=tab] { flex: 1; height: 34px; border-radius: 9px 9px 0 0; font-weight: 600; font-size: 12.5px; color: var(--muted); border-bottom: 2px solid transparent; min-width: 0; }
#drawer [role=tab][aria-selected=true] { color: var(--ink); border-bottom-color: var(--accent); }
#drawer [role=tab]:hover { color: var(--ink); }
#drawer .body { flex: 0 1 auto; min-height: 0; padding: 12px 14px 14px; border-top: 1px solid var(--hair); }
#drawer h4 { margin: 14px 0 6px; }
#drawer h4:first-child { margin-top: 0; }
#drawer p { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
#drawer .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
#drawer select { height: 32px; padding: 0 30px 0 10px; border-radius: 8px; border: 1px solid var(--line); background-color: var(--surface-2); min-width: 0; max-width: 100%;
  appearance: none; -webkit-appearance: none; background-image: linear-gradient(45deg, transparent 50%, var(--muted) 50%), linear-gradient(135deg, var(--muted) 50%, transparent 50%);
  background-position: calc(100% - 15px) 14px, calc(100% - 10px) 14px; background-size: 5px 5px; background-repeat: no-repeat; }
#drawer .ramp { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-size: 11px; color: var(--muted); }
#drawer .ramp i { flex: 1; height: 10px; border-radius: 3px; }
#drawer .ramp i.ndvi { background: linear-gradient(90deg, #a8542a, #d9b53a, #8fc84a, #1f7a2e); }
#drawer .ramp i.moist { background: linear-gradient(90deg, #c8773a, #e8d8a0, #4f9bd6); }
#drawer figure { margin: 8px 0 0; } #drawer figure canvas { width: 100%; height: 132px; cursor: crosshair; }
#drawer p.why { padding: 8px 10px; border-radius: 9px; background: var(--surface-2); color: var(--ink); line-height: 1.4; }
#drawer figcaption { font-size: 11px; color: var(--faint); margin-top: 3px; }
#drawer .nums { display: grid; grid-template-columns: repeat(auto-fit, minmax(84px, 1fr)); gap: 8px; margin-top: 10px; }
#drawer .nums div { display: flex; flex-direction: column; }
#drawer .nums b { font: 700 17px/1.1 var(--sans); font-variant-numeric: tabular-nums; }
#drawer .nums span { font-size: 11px; color: var(--muted); }
#drawer .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; margin-top: 8px; font-size: 11.5px; color: var(--muted); }
#drawer .legend span { display: inline-flex; align-items: center; gap: 5px; }
#drawer .legend i { width: 10px; height: 10px; border-radius: 3px; flex: none; }
#drawer .legend i.line { height: 2px; border-radius: 1px; width: 14px; }
#drawer .strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(36px, 1fr)); gap: 4px; margin-top: 10px; }
#drawer .strip .yr { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
#drawer .strip .yr span { font-size: 10.5px; font-weight: 600; color: var(--faint); }
#drawer .strip .yr i { display: block; width: 100%; height: 26px; border-radius: 6px; }
#drawer .strip .yr small { font-size: 10.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
#drawer .body > .link { margin-top: 10px; }
#drawer .links { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; }
#drawer p.formula { margin-top: 6px; font-size: 11.5px; color: var(--faint); }
#drawer .cdlwrap { max-height: 220px; margin-top: 8px; }
#drawer table.cdl { border-collapse: separate; border-spacing: 2px; width: 100%; font-size: 11.5px; }
#drawer table.cdl th { font-weight: 600; color: var(--faint); text-align: center; font-size: 10.5px; }
#drawer table.cdl th:first-child, #drawer table.cdl td:first-child { text-align: left; color: var(--ink); font-weight: 600; white-space: nowrap; padding-right: 4px; }
#drawer table.cdl td.c { height: 18px; border-radius: 3px; min-width: 14px; cursor: default; }
#drawer table.cdl td.c:hover { outline: 2px solid var(--ink); outline-offset: -1px; }
#drawer table.cdl td.rot { color: var(--muted); white-space: nowrap; padding-left: 6px; font-size: 11px; }
#drawer table.cdl tr.sel td:first-child { color: var(--accent); }
#drawer .readout { min-height: 18px; margin-top: 6px; font-size: 12px; color: var(--ink); }
#drawer .aefl { margin-top: 14px; gap: 8px 10px; font-size: 12px; }
#drawer .aefl .btn { height: 28px; }
#drawer .aefl .k { display: inline-flex; align-items: center; gap: 5px; color: var(--ink); font-variant-numeric: tabular-nums; }
#drawer .aefl .k i { width: 8px; height: 8px; border-radius: 50%; }
#drawer .aefl small { color: var(--muted); font-size: 11.5px; }
#drawer pre { margin: 8px 0 0; padding: 10px; border-radius: 9px; background: rgba(0, 0, 0, 0.3); border: 1px solid var(--hair); font: 11px/1.45 var(--mono); color: var(--ink); white-space: pre; overflow: auto; max-height: 56vh;
  -webkit-user-select: text; user-select: text; }
#drawer pre.req { max-height: 140px; color: var(--muted); }
#drawer .meta { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
#drawer .warnline { color: var(--danger); }
@media (max-width: 959px) {
  #drawer { left: 0; right: 0; bottom: 0; width: auto; max-height: 74%; border-radius: 16px 16px 0 0; padding-bottom: var(--sb); z-index: 42; }
  #drawer header, #drawer .body { width: 100%; max-width: 640px; margin: 0 auto; }
}
`);

const TABS = [['satellite', 'Satellite'], ['water', 'Water'], ['crops', 'Crops'], ['feed', 'Feed'], ['raw', 'Raw']];
const CLASS_COLORS = ['#e0b92f', '#5aa6e0', '#4fa64a', '#d9703c', '#a77fd6', '#3fb8a8', '#c95f8a', '#8b9b5a'];

export function createDrawer(ctx) {
  const S = ctx.S;
  const el = h('aside', { id: 'drawer', class: 'panel hidden', role: 'dialog', 'aria-label': 'Data drawer' });
  document.getElementById('hud').appendChild(el);
  let tab = 'satellite', openFlag = false, cdlAll = false, rawSel = null, aefBusy = false, aefErr = '', cdlErr = '', cdlBusy = false;
  const tabs = h('div', { role: 'tablist' });
  for (const [id, label] of TABS) tabs.append(h('button', { role: 'tab', 'data-tab': id, 'aria-selected': 'false', text: label, onclick: () => { ctx.sfx('ui'); show(id); } }));
  const body = h('div', { class: 'body scroll', role: 'tabpanel' });
  el.append(h('header', {}, tabs, h('button', { class: 'x', 'aria-label': 'Close data drawer', text: '×', onclick: () => { ctx.sfx('ui'); close(); } })), body);

  function open(t) { openFlag = true; el.classList.remove('hidden'); document.getElementById('app').classList.add('drawer-open'); document.getElementById('data-btn').classList.add('on'); ctx.writeParam('mode', 'data'); show(t || tab); ctx.tourEvent({ type: 'drawer' }); }
  function close() { if (!openFlag) return; openFlag = false; el.classList.add('hidden'); document.getElementById('app').classList.remove('drawer-open'); document.getElementById('data-btn').classList.remove('on'); ctx.writeParam('mode', 'farm'); }
  function show(t) { tab = TABS.some(([id]) => id === t) ? t : 'satellite'; ctx.writeParam('tab', tab); for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.tab === tab)); render(); }
  function seg(options, value, onPick) { const s = h('div', { class: 'seg', role: 'group' }); for (const [v, label] of options) s.append(h('button', { 'aria-pressed': String(v === value), text: label, onclick: () => { ctx.sfx('ui'); onPick(v); } })); return s; }
  const fid = () => (S.selected && S.state.fields[S.selected] ? S.selected : S.farm.fields.length ? S.farm.fields[0].field_id : null);
  function fieldSelect() {
    const sel = h('select', { 'aria-label': 'Field', onchange: (e) => ctx.selectField(e.target.value || null, { popover: false }) });
    const cur = fid();
    for (const f of S.farm.fields) { const o = h('option', { value: f.field_id, text: 'Field ' + f.name + ' · ' + cropLabel((S.state.fields[f.field_id] || f).crop) + ' · ' + fmt(f.area_ha) + ' ha' }); if (f.field_id === cur) o.selected = true; sel.append(o); }
    return sel;
  }
  function render() {
    if (!openFlag || !S.farm || !S.state) return;
    const keep = body.scrollTop;
    body.textContent = '';
    ({ satellite: satTab, water: waterTab, crops: cropsTab, feed: () => feedTab(body, ctx, fid(), fieldSelect), raw: rawTab })[tab]();
    body.scrollTop = keep;
  }

  function satTab() {
    body.append(h('h4', { text: 'Map overlay' }), seg([['none', 'None'], ['ndvi', 'NDVI'], ['moisture', 'Moisture']], ['ndvi', 'moisture'].includes(S.overlay) ? S.overlay : 'none', (v) => { ctx.setOverlay(v); render(); }));
    body.append(h('div', { class: 'links' }, h('button', { class: 'link', text: 'Open the satellite map (M)', onclick: () => { ctx.sfx('ui'); ctx.openMap({ layer: 'satellite' }); } }), h('button', { class: 'link', text: 'View NDVI on the real map', onclick: () => { ctx.sfx('ui'); ctx.openMap({ layer: 'ndvi' }); } })));
    if (S.overlay === 'ndvi') {
      body.append(h('div', { class: 'ramp' }, h('span', { text: 'bare 0.1' }), h('i', { class: 'ndvi' }), h('span', { text: '0.9 dense' })));
      body.append(h('p', { text: S.grid && S.grid.date ? 'Sentinel-2 scene of ' + dateLabel(S.grid.date) + (S.grid.clear_pct != null ? ', ' + Math.round(S.grid.clear_pct) + '% clear.' : '.') : S.grid && S.grid.note ? S.grid.note : 'Loading the latest clear Sentinel-2 scene…' }));
    } else if (S.overlay === 'moisture') {
      body.append(h('div', { class: 'ramp' }, h('span', { text: 'dry' }), h('i', { class: 'moist' }), h('span', { text: 'full' })));
      body.append(h('p', { text: 'Simulated root-zone water, not a measurement.' }));
    }
    body.append(h('h4', { text: 'NDVI through the season' }), fieldSelect());
    const id = fid();
    if (!id) { body.append(h('p', { text: 'This farm has no fields.' })); return; }
    const nd = ctx.ndviRows(id), rows = nd || [], fs = S.state.fields[id] || {};
    const spark = chartFig('NDVI series', 0, nd ? rows.length + ' clear Sentinel-2 scenes in the 120 days before today' : 'Loading Sentinel-2 scenes…');
    body.append(spark.fig);
    if (rows.length) {
      const last = rows[rows.length - 1], prev = rows.length >= 3 ? rows[rows.length - 3] : null;
      const game = !fs.planted ? 'the field is still bare' : fs.harvested ? 'the field is harvested' : 'the crop is at the ' + stageLabel(fs.stage) + ' stage';
      body.append(h('p', { class: 'why', text: 'The chart shows the real field; the map shows your game, where ' + game + '.' }));
      body.append(nums([[fmt(last.ndvi, 2), 'latest NDVI'], [prev ? (last.ndvi >= prev.ndvi ? '+' : '−') + fmt(Math.abs(last.ndvi - prev.ndvi), 2) : '–', 'change, 3 scenes'], [dateLabel(last.date, false), 'scene date']]));
    }
    requestAnimationFrame(() => sparkline(spark.cv, rows, { min: 0, max: 1, axis: true, time: true, today: S.state.day, marker: fs.plant_date, empty: nd ? 'no clear scenes' : 'loading…' }));
  }

  function waterTab() {
    const t = S.state.totals || {};
    body.append(h('h4', { text: 'Season totals', title: 'Score = 100 × missions + 1 × t harvested − m³ irrigation / 1000 − 20 × early harvests.' }));
    body.append(nums([[fmt(t.water_used_m3), 'm³ irrigation'], [fmt(t.est_yield_t, 1), 't est. harvest'], [fmt(t.score), 'score']], 'margin-top:4px'));
    body.append(h('h4', { text: 'Season water balance (simulated)' }), fieldSelect());
    const id = fid();
    if (!id) { body.append(h('p', { text: 'This farm has no fields.' })); return; }
    const fs = S.state.fields[id] || {};
    const { fig, cv } = chartFig('Season water chart', 150);
    body.append(fig, legend([['background:var(--water)', 'root-zone water', 'line'], ['background:var(--water);opacity:.7', 'rain'], ['background:var(--accent)', 'irrigation'], ['background:var(--danger)', 'stress day']]));
    body.append(nums([[fmt(fs.rain_mm) + ' mm', 'rain'], [fmt(fs.irrigation_mm) + ' mm', 'irrigation'], [fmt(fs.et_mm) + ' mm', 'crop water use'], [fmt(fs.stress_days), 'stress days']]));
    ctx.loadSeries(id).then((days) => { if (tab === 'water' && fid() === id && cv.isConnected) seasonChart(cv, days); }).catch(() => seasonChart(cv, []));
  }

  function cdlData() {
    const st = S.state.fields, byField = {};
    let years = new Set();
    for (const [id, fs] of Object.entries(st)) if (fs.crop_history && Object.keys(fs.crop_history).length) { byField[id] = { hist: fs.crop_history, rot: fs.rotation }; Object.keys(fs.crop_history).forEach((y) => years.add(+y)); }
    if (!Object.keys(byField).length && S.cdl && S.cdl.fields) for (const [id, hist] of Object.entries(S.cdl.fields)) { byField[id] = { hist, rot: S.cdl.rotation && S.cdl.rotation[id] }; Object.keys(hist).forEach((y) => years.add(+y)); }
    if (S.cdl && S.cdl.years) S.cdl.years.forEach((y) => years.add(+y));
    return { byField, years: [...years].sort() };
  }
  function finishCdl(seen) {
    body.append(legend(Object.keys(CROP_COLORS).filter((c) => seen.has(c)).map((c) => ['background:' + CROP_COLORS[c], cropLabel(c)])));
    if (S.cdl && S.cdl.source) body.append(h('p', { text: S.cdl.source }));
    aefSection();
  }
  function cropsTab() {
    body.append(h('h4', { text: 'Crop history, USDA CDL' }));
    const { byField, years } = cdlData(), seen = new Set();
    if (!Object.keys(byField).length) {
      if (S.farm.cdl_available === false) body.append(h('p', { text: 'The Cropland Data Layer covers the USA only. Crops here come from AlphaEarth classes below or from what you plant.' }));
      else if (cdlErr) body.append(h('p', { class: 'warnline', text: 'Crop history unavailable: ' + cdlErr }));
      else { body.append(h('p', { text: 'Reading 2017-2024 CDL rasters for every field…' })); if (!cdlBusy) loadCdl(); }
    } else {
      const cur = fid(), cd = cur && byField[cur];
      body.append(fieldSelect());
      if (cd) {
        const strip = h('div', { class: 'strip' });
        for (const y of years) {
          const c = cd.hist[y] || cd.hist[String(y)] || null;
          strip.append(h('div', { class: 'yr', title: y + ': ' + (c ? cropLabel(c) : 'no data') }, h('span', { text: "'" + String(y).slice(2) }), h('i', { style: 'background:' + (c ? CROP_COLORS[c] || CROP_COLORS.other : 'transparent') }), h('small', { text: c ? cropLabel(c).split(' ')[0] : '–' })));
          if (c) seen.add(c);
        }
        body.append(strip, h('p', { text: cd.rot ? 'Rotation: ' + String(cd.rot).replace(/_/g, ' ') + '.' : 'No clear rotation.' }));
      }
      const n = Object.keys(byField).length;
      body.append(h('button', { class: 'link', text: (cdlAll ? 'Hide' : 'Compare') + ' all ' + n + ' fields', onclick: () => { ctx.sfx('ui'); cdlAll = !cdlAll; render(); } }));
      if (!cdlAll) { finishCdl(seen); return; }
      const t = h('table', { class: 'cdl' }), hr = h('tr', {}, h('th', { text: 'Field' }));
      for (const y of years) hr.append(h('th', { text: "'" + String(y).slice(2) }));
      hr.append(h('th', { text: '' })); t.append(h('thead', {}, hr));
      const tb = h('tbody');
      const readout = h('div', { class: 'readout', text: 'Hover a cell for the crop and year.' });
      for (const f of S.farm.fields) {
        const d = byField[f.field_id]; if (!d) continue;
        const tr = h('tr', { class: f.field_id === S.selected ? 'sel' : '' }, h('td', { text: f.name }));
        for (const y of years) {
          const c = d.hist[y] || d.hist[String(y)] || null; if (c) seen.add(c);
          const td = h('td', { class: 'c', title: f.name + ' ' + y + ': ' + (c ? cropLabel(c) : 'no data'), style: 'background:' + (c ? CROP_COLORS[c] || CROP_COLORS.other : 'transparent') });
          td.addEventListener('pointerenter', () => { readout.textContent = 'Field ' + f.name + ', ' + y + ': ' + (c ? cropLabel(c) : 'no data'); });
          tr.append(td);
        }
        tr.append(h('td', { class: 'rot', text: d.rot ? String(d.rot).replace(/_/g, ' ') : '' }));
        tr.addEventListener('click', () => ctx.selectField(f.field_id, { popover: false }));
        tb.append(tr);
      }
      t.append(tb); body.append(h('div', { class: 'cdlwrap scroll' }, t), readout);
      finishCdl(seen);
    }
    if (!Object.keys(byField).length) aefSection();
  }
  function aefSection() {
    const on = S.overlay === 'classes', a = S.aef;
    const row = h('div', { class: 'row aefl' },
      h('span', { class: 'lbl', text: 'AlphaEarth' }),
      h('button', { class: 'btn' + (on ? ' primary' : ''), type: 'button', 'aria-pressed': String(on), text: 'Classify', disabled: aefBusy,
        title: 'Colour fields on the map by the crop their 2024 AlphaEarth embedding looks like' + (a && a.supervised ? ' · ' + fmt((a.accuracy_loo || 0) * 100) + '% leave-one-out accuracy over ' + fmt(a.n_fields) + ' fields' : ''), onclick: async () => { ctx.sfx('ui'); if (!on && !S.aef) { await loadAef(); if (!S.aef) return; } ctx.setOverlay(on ? 'none' : 'classes'); render(); } }));
    if (aefBusy) row.append(h('small', { text: 'Classifying…' }));
    else if (aefErr) row.append(h('small', { class: 'warnline', text: 'Unavailable: ' + aefErr }));
    else if (a && on) {
      for (const c of classList()) row.append(h('span', { class: 'k' }, h('i', { style: 'background:' + c.color }), c.label + ' ' + c.size));
    }
    body.append(row);
  }
  function classList() {
    const a = S.aef; if (!a) return [];
    if (a.supervised) {
      const counts = {}; for (const v of Object.values(a.fields || {})) if (v.pred_crop) counts[v.pred_crop] = (counts[v.pred_crop] || 0) + 1;
      return Object.entries(counts).map(([c, n]) => ({ key: c, label: cropLabel(c), size: n, color: CROP_COLORS[c] || CROP_COLORS.other }));
    }
    return (a.clusters || []).map((c, i) => ({ key: c.id, label: c.label ? cropLabel(c.label) + ' (class ' + String.fromCharCode(65 + i) + ')' : 'Class ' + String.fromCharCode(65 + i), size: c.size, color: CLASS_COLORS[i % CLASS_COLORS.length] }));
  }
  function classesOverlay() {
    const a = S.aef, byField = {}; if (!a) return { byField };
    const list = classList(), color = (key) => (list.find((c) => c.key === key) || {}).color || CROP_COLORS.other;
    for (const [id, v] of Object.entries(a.fields || {})) {
      const key = a.supervised ? v.pred_crop : v.cluster;
      if (key == null) continue;
      byField[id] = { rgb: hx(color(key)), label: a.supervised ? v.pred_crop : (list.find((c) => c.key === key) || {}).label };
    }
    return { byField };
  }
  async function loadAef() {
    if (aefBusy) return;
    aefBusy = true; aefErr = '';
    try { S.aef = await ctx.loadAef(); if (['classes', 'aef'].includes(S.overlay)) ctx.setOverlay(S.overlay); }
    catch (e) { aefErr = e.message; }
    aefBusy = false; if (tab === 'crops') render();
  }
  async function loadCdl() {
    cdlBusy = true; cdlErr = '';
    try { S.cdl = await ctx.loadCdl(); if (!S.cdl || S.cdl.available === false) cdlErr = 'no CDL coverage for this box'; }
    catch (e) { cdlErr = e.message; }
    cdlBusy = false; if (tab === 'crops') render();
  }

  function rawTab() {
    const keys = Object.keys(S.raw);
    body.append(h('h4', { text: 'Every response this page received' }));
    if (!keys.length) { body.append(h('p', { text: 'Nothing loaded yet.' })); return; }
    if (!rawSel || !S.raw[rawSel]) rawSel = keys.includes('state') ? 'state' : keys[0];
    const sel = h('select', { 'aria-label': 'Response', onchange: (e) => { rawSel = e.target.value; render(); } });
    for (const k of keys) { const o = h('option', { value: k, text: k }); if (k === rawSel) o.selected = true; sel.append(o); }
    const r = S.raw[rawSel];
    const full = JSON.stringify(r.data, null, 2) || 'null';
    const copyBtn = h('button', { class: 'btn', text: 'Copy JSON', onclick: async () => { const ok = await copyText(full); copyBtn.textContent = ok ? 'Copied' : 'Copy failed'; ctx.sfx('ui'); setTimeout(() => { copyBtn.textContent = 'Copy JSON'; }, 1400); } });
    body.append(h('div', { class: 'row' }, sel, copyBtn));
    body.append(h('div', { class: 'meta', text: r.file + ' · ' + new Date(r.at).toLocaleTimeString('en-US') + (r.ms != null ? ' · ' + fmt(r.ms) + ' ms' : '') + (r.data && r.data._cached ? ' · cached' : '') + ' · ' + fmt(full.length) + ' chars' }));
    body.append(h('h4', { text: 'Request' }), h('pre', { class: 'req scroll', text: JSON.stringify(r.params, (k, v) => (typeof v === 'string' && v.length > 600 ? v.slice(0, 600) + '… (' + v.length + ' chars)' : v), 2) }));
    body.append(h('h4', { text: 'Response' }), h('pre', { class: 'scroll', text: full.length > 250000 ? full.slice(0, 250000) + '\n… truncated here; Copy JSON copies all ' + fmt(full.length) + ' chars' : full }));
  }

  return { open, close, refresh: render, isOpen: () => openFlag, tab: () => tab, classesOverlay };
}
