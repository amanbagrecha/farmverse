// FarmVerse page controller: farm loading (eo.py, game.py), HUD, action card, tour, panels, sounds and URL state.
import { createGame } from './engine.js';
import { $, fmt, dateLabel, shiftDate, weekEnd, cap, cropLabel, toast, sha1hex, isCompact, isTouch, isStressed } from './ui/util.js';
import { fieldRows } from './ui/feed.js';
import { createWeather } from './ui/weather.js';
import { createCalendar } from './ui/calendar.js';
import { createRealMap } from './ui/realmap.js';
import { createCard } from './ui/card.js';
import { createTour } from './ui/tour.js';
import { createPopover } from './ui/popover.js';
import { createOutlook } from './ui/outlook.js';
import { createDrawer } from './ui/drawer.js';
import { createPicker, boxAround } from './ui/picker.js';
import { createPad } from './ui/pad.js';
import { createMenu } from './ui/menu.js';
import { createLoader } from './ui/loader.js';
import { createAccount } from './ui/account.js';
import { loadImagery, IMAGERY_CREDIT } from './ui/basemap.js';

const P = window.fused && window.fused.params;
const hasPy = !!(window.fused && typeof window.fused.runPython === 'function');
const DEFAULT = { id: 'story-iowa', title: 'Story County, Iowa', bounds: [-93.365, 42.168, -93.335, 42.19], cols: 64, rows: 64 };
const NEW_GRID = { cols: 78, rows: 63 };
const OPS = ['plant', 'irrigate', 'spray', 'harvest'];

function readParam(k, d) { try { const v = P && P.get(k); return v == null || v === '' ? d : v; } catch (e) { return d; } }
function writeParam(k, v) { try { if (P && (P.get(k) || '') !== String(v ?? '')) P.set(k, String(v ?? '')); } catch (e) {} }

const S = {
  farmId: readParam('farm', DEFAULT.id), farm: null, state: null, weather: null, feed: null, grid: null, cdl: null, aef: null,
  selected: readParam('field', null), overlay: readParam('overlay', 'none'), base: readParam('base', 'farm') === 'satellite' ? 'satellite' : 'farm', imagery: null, place: null, busy: false, raw: {}, muted: false, cine: false, q: Promise.resolve(),
};

const game = createGame($('world'));
const can = (m) => typeof game[m] === 'function';
function call(m, ...a) { if (!can(m)) return undefined; try { return game[m](...a); } catch (e) { console.warn('engine.' + m, e); return undefined; } }
function fly(target, opts) { const r = call('flyTo', target, opts); return Promise.resolve(r).catch(() => null); }

let snd = null, ambient = null, introDone = false;
import('./sound.js').then((m) => { snd = m.createSound(); try { snd.setMuted(S.muted); } catch (e) {} updateAmbient(); }).catch(() => {});
function sfx(name) { try { if (snd) snd.play(name); } catch (e) {} }
function updateAmbient() {
  if (!snd || !S.state) return;
  const w = S.state.weather_today || {};
  const k = (+w.precip || 0) > 0.5 ? 'rain' : ['spring', 'summer'].includes(S.state.season) ? 'birds' : 'wind';
  if (k !== ambient) { ambient = k; try { snd.ambient(k); } catch (e) {} }
}

const OPEN_EO = ['place', 'roads', 'settings', 'account'], EO_SLOT_MS = 65000;
let eoTail = Promise.resolve();
function eoQueue(run) {
  let free; const mine = new Promise((r) => { free = r; }), turn = eoTail; eoTail = mine;
  return turn.then(() => { const p = Promise.resolve().then(run), t = setTimeout(free, EO_SLOT_MS), done = () => { clearTimeout(t); free(); }; p.then(done, done); return p; });
}
async function py(file, params, opts, label) {
  if (!hasPy) throw new Error('no python bridge');
  const eo = file === 'eo.py' && !OPEN_EO.includes(params && params.action) && !(params && params.action === 'feed' && !params.build);
  if (eo) {
    try { await account.gate(); } catch (e) { S.needData = true; throw e; }
  }
  let t0 = performance.now();
  const go = () => { t0 = performance.now(); return fused.runPython(file, params, opts); };
  const out = await (eo && params.action !== 'feed' && account.engine() === 'local' ? eoQueue(go) : go());
  if (label) S.raw[label] = { file, params, at: Date.now(), ms: out && out._ms != null ? out._ms : Math.round(performance.now() - t0), data: out };
  if (out && out.signin) { S.needData = true; account.openSignIn({ expired: true }); }
  if (out && !Array.isArray(out) && out.error && !out.rows && !out.fields) throw new Error(out.error + (out.hint ? ' (' + out.hint + ')' : ''));
  return out;
}
function gameCall(action, payload, label, farmId) {
  const run = () => py('game.py', { action, farm_id: farmId || S.farmId, payload: payload == null ? '' : JSON.stringify(payload) }, { key: 'game' }, label);
  const p = S.q.then(run, run);
  S.q = p.catch(() => null);
  return p;
}
function setState(st, action = 'load') {
  S.state = st;
  S.raw.state = { file: 'game.py', params: { action, farm_id: S.farmId }, at: Date.now(), ms: st && st._ms, data: st };
}
const fieldOf = (id) => S.farm && S.farm.fields.find((x) => x.field_id === id);
const fieldName = (id) => { const fs = S.state && S.state.fields[id]; if (fs && fs.name) return fs.name; const f = fieldOf(id); return f ? f.name : id; };
const centerOf = (f) => f.center || { lat: (f.bounds[1] + f.bounds[3]) / 2, lon: (f.bounds[0] + f.bounds[2]) / 2 };

const ctx = {
  S, game, py, sfx, readParam, writeParam, fieldOf, fieldName, farmTitle, cropLabel, feedOf,
  layout, dayWeather, nextDays, selectField, act, advance, rewind, fly, intro, cinematic, saveUi, refreshCard, userInput, padAction,
  ndviRows, loadSeries, loadFeed, loadAef, loadCdl, setOverlay, recommendedOp, listFarms, switchFarm, startFarm, resetSeason,
  openDrawer, openOutlook: (id) => outlook.open(id), openPicker: () => picker.open(), openMap: (o) => realmap.open(o), openCalendar: () => calendar.open(),
  tourEvent: (ev) => tour.onEvent(ev), onPopoverClose, place: () => S.place,
  muted: () => S.muted, toggleMute, onAccount: retryData,
};
const loader = createLoader();
const account = createAccount(ctx); ctx.account = account;
const weather = createWeather(ctx);
const calendar = createCalendar(ctx);
const realmap = createRealMap(ctx);
const card = createCard(ctx);
const tour = createTour(ctx); ctx.tour = tour;
const popover = createPopover(ctx);
const outlook = createOutlook(ctx);
const drawer = createDrawer(ctx);
const picker = createPicker(ctx);
const pad = createPad(ctx);
const menu = createMenu(ctx);

function layout() {
  const app = $('app'), wx = $('wx'), stats = $('stats');
  if (wx) {
    const r = wx.getBoundingClientRect();
    app.style.setProperty('--wx-bottom', Math.round(r.bottom - app.getBoundingClientRect().top) + 'px');
    if (!wx.classList.contains('open')) app.style.setProperty('--wx-w', Math.ceil(r.width) + 'px');
  }
  if (stats) app.style.setProperty('--st-w', Math.ceil(stats.getBoundingClientRect().width) + 'px');
  const touch = isTouch();
  pad.show(touch);
  call('setQuality', touch ? 'low' : 'high');
  tour.place();
  game.resize();
}
window.addEventListener('resize', () => requestAnimationFrame(() => { layout(); if (S.state) renderHud(); }));

function intro() {
  if (introDone) return; introDone = true;
  fly('overview', { duration: 2500 }).then(() => { if (!S.touched) cinematic(true); });
}
function cinematic(on) { S.cine = !!on; call('setCinematic', !!on); }
function userInput() { S.touched = true; if (S.cine) cinematic(false); }
$('world').addEventListener('pointerdown', userInput);
$('world').addEventListener('wheel', userInput, { passive: true });

async function saveUi(obj) {
  if (!S.state) return;
  S.state.ui = { ...(S.state.ui || {}), ...obj };
  try { const out = await gameCall('set', obj, 'set'); if (out && out.state && out.state.ui) S.state.ui = { ...S.state.ui, ...out.state.ui }; }
  catch (e) { console.warn('game.py set', e); }
}
function toggleMute() { S.muted = !S.muted; try { if (snd) snd.setMuted(S.muted); } catch (e) {} toast(S.muted ? 'Sound off' : 'Sound on'); saveUi({ muted: S.muted }); }

function dayWeather(date) {
  const w = S.weather; if (!w) return null;
  return (w.history || []).find((d) => d.date === date) || (w.forecast || []).find((d) => d.date === date) || null;
}
function nextDays(n) {
  const w = S.weather; if (!w || !S.state) return [];
  const seen = new Set(), rows = [];
  for (const d of [...(w.history || []), ...(w.forecast || [])]) if (d && d.date > S.state.day && !seen.has(d.date)) { seen.add(d.date); rows.push(d); }
  return rows.sort((a, b) => (a.date < b.date ? -1 : 1)).slice(0, n);
}

function hemisphereStart(lat) { return lat < -10 ? '2025-10-01' : '2025-05-01'; }
const fetchWeather = (c, sd) => py('eo.py', { action: 'weather', lat: String(c.lat), lon: String(c.lon), start: shiftDate(sd, -30), end: shiftDate(sd, 213), forecast_days: '7' }, { key: 'eo-wx' }, 'weather');
async function loadWeather() {
  const c = centerOf(S.farm), sd = S.state.start_date || hemisphereStart(c.lat), a = shiftDate(sd, -30), b = shiftDate(sd, 213);
  await loadFeed();
  const P = (feedOf() || {}).parts || {};
  try { S.weather = P.weather && P.forecast ? { history: fieldRows(P, 'weather').filter((r) => r.date >= a && r.date <= b), forecast: fieldRows(P, 'forecast') } : await fetchWeather(c, sd); }
  catch (e) { console.warn('weather', e); S.weather = null; }
  weather.render(); calendar.refresh(); updateAmbient();
}

function retryData() {
  if (!S.needData || !S.farm || loader.isOpen()) return;
  S.needData = false;
  const F = feedOf();
  if (!F || F.err) { S.feed = null; loadFeed(); }
  if (!S.weather) loadWeather();
  if (!S.grid) loadGrid();
  drawer.refresh();
}

async function loadGrid() {
  if (!S.farm) return;
  try {
    const end = weekEnd(S.state.day), start = shiftDate(end, -60);
    S.grid = await py('eo.py', { action: 'ndvi_grid', bounds: S.farm.bounds.join(','), cols: String(S.farm.cols), rows: String(S.farm.rows), start, end, max_cloud: '60' }, { key: 'eo-grid' }, 'ndvi_grid');
    applyOverlay(); drawer.refresh();
  } catch (e) { console.warn('ndvi grid', e); }
}
async function loadSeries(id) {
  const out = await py('game.py', { action: 'series', farm_id: S.farmId, payload: JSON.stringify({ field_id: id }) }, { key: 'series' }, 'series:' + fieldName(id));
  return (out && out.days) || [];
}

const FEED_POLL_MS = 2000, FEED_WAIT_MS = 30000;
function feedOf() { return S.feed && S.feed.farmId === S.farmId ? S.feed : null; }
function feedStep(id) {
  const w = window.fused && typeof fused.watchJob === 'function' ? fused.watchJob('farmverse-feed-' + id) : null;
  if (!w) return new Promise((r) => setTimeout(r, FEED_POLL_MS));
  let first = null;
  const t = setTimeout(() => w.stop(), FEED_WAIT_MS);
  return w.watch((r) => { if (first === null) first = r.done; else if (r.done !== first) w.stop(); }, 1000).finally(() => clearTimeout(t));
}
function loadFeed(force) {
  if (!S.farm) return Promise.resolve(null);
  const old = feedOf();
  if (old && force && !old.loaded) return old.ready.then(() => loadFeed(true));
  if (old && (!force || old.building)) return old.ready;
  const id = S.farmId, F = S.feed = old || { farmId: id, parts: {}, missing: [], stale: [], errors: {}, since: 0 };
  const here = () => S.feed === F && S.farmId === id;
  const read = (extra) => py('eo.py', { action: 'feed', farm_id: id, since: String(F.since), ...extra }, { key: 'eo-feed-' + id }, extra ? 'feed:build' : 'feed');
  const take = (out) => {
    if (!here()) return;
    const names = Object.keys(out.parts || {}), b = out.build, was = F.building, ndvi = !F.loaded || names.some((n) => n.startsWith('ndvi_'));
    for (const n of names) { F.parts[n] = out.parts[n]; F.since = Math.max(F.since, out.parts[n].built_at); }
    F.missing = out.missing || []; F.stale = out.stale || []; F.errors = (b && b.errors) || {}; F.engine = b ? b.engine : F.engine;
    F.building = b && b.running ? b.step || 'the feed' : null; F.loaded = true;
    if (drawer.tab() === 'feed' ? names.length || was !== F.building || ndvi : ndvi && drawer.tab() === 'satellite') drawer.refresh();
    if (ndvi) popover.refresh();
  };
  const fail = (e) => { if (here()) { F.err = e.message; F.building = null; F.loaded = true; drawer.refresh(); } };
  F.err = '';
  F.ready = read().then(take, fail);
  F.done = F.ready.then(async () => {
    if (!here() || F.err) return;
    if (!F.building && (force || F.missing.length || F.stale.length)) {
      const c = centerOf(S.farm);
      take(await read({ build: force ? 'all' : 'auto', bounds: S.farm.bounds.join(','), fields: JSON.stringify(fieldList(false)), lat: String(c.lat), lon: String(c.lon) }));
    }
    while (here() && F.building) {
      await Promise.all([feedStep(id), new Promise((r) => setTimeout(r, 1000))]);
      take(await read());
    }
  }).catch(fail);
  return F.ready;
}
function ndviRows(id) {
  const F = feedOf(); if (!F || !F.loaded || !S.state) return null;
  const end = weekEnd(S.state.day), start = shiftDate(end, -120);
  return fieldRows(F.parts, 'ndvi_', id).filter((r) => r.date > start && r.date <= end);
}
function fieldList(withCrop, fields = S.farm.fields, st = S.state) {
  return fields.map((f) => {
    const o = { field_id: f.field_id, ...(f.geometry ? { geometry: f.geometry } : { bounds: f.bounds }) };
    const c = withCrop && ((st && st.fields[f.field_id] && st.fields[f.field_id].crop) || f.crop);
    if (c && c !== 'unknown') o.crop = c;
    return o;
  });
}
async function loadCdl() {
  return py('eo.py', { action: 'cdl_history', fields: JSON.stringify(fieldList(false)), years: '2017-2024' }, { key: 'eo-cdl' }, 'cdl_history');
}
async function loadAef({ supervised = true, k = 4 } = {}) {
  return py('eo.py', { action: 'aef_fields', bounds: S.farm.bounds.join(','), fields: JSON.stringify(fieldList(supervised)), year: '2024', k: String(k) }, { key: 'eo-aef' }, 'aef_fields');
}
async function loadPlace() {
  if (!S.farm || !S.farm.center) return;
  const c = S.farm.center, farmId = S.farmId;
  try {
    const p = await py('eo.py', { action: 'place', lat: String(c.lat), lon: String(c.lon) }, { key: 'eo-place' }, 'place');
    if (farmId !== S.farmId || !p || !p.title) return;
    S.place = p; renderHud(); drawer.refresh(); realmap.refresh(); refreshCard();
    if (!S.state.ui || !S.state.ui.place || S.state.ui.place.title !== p.title) saveUi({ place: { title: p.title, region: p.region || '' } });
  } catch (e) { console.warn('place', e); }
}
async function loadRoads() {
  if (!S.farm || !can('setRoads')) return;
  if (S.farm.roads) { call('setRoads', S.farm.roads); return; }
  const farmId = S.farmId;
  try {
    const r = await py('eo.py', { action: 'roads', bounds: S.farm.bounds.join(','), cols: String(S.farm.cols), rows: String(S.farm.rows) }, { key: 'eo-roads' }, 'roads');
    if (farmId !== S.farmId || !r || !Array.isArray(r.tiles)) return;
    S.farm.roads = r; call('setRoads', r); realmap.refresh();
  } catch (e) {
    console.warn('roads', e);
    if (!S.roadsRetried) { S.roadsRetried = true; setTimeout(() => { if (farmId === S.farmId && !S.farm.roads) loadRoads(); }, 90000); }
  }
}
async function listFarms() {
  const out = await py('game.py', { action: 'list' }, { key: 'game-list' }, 'list');
  return Array.isArray(out) ? out : (out && out.farms) || [];
}

const SCOUT_N = 6, SCOUT_DROP = 0.08;
function scoutNdvi() {
  const found = [];
  for (const f of S.farm.fields.slice(0, SCOUT_N)) {
    const rows = ndviRows(f.field_id) || [], fs = S.state.fields[f.field_id];
    const drop = rows.length >= 3 ? rows[rows.length - 3].ndvi - rows[rows.length - 1].ndvi : 0;
    if (drop >= SCOUT_DROP && fs && fs.planted && !fs.harvested) found.push({ f, drop });
  }
  const top = found.sort((a, b) => b.drop - a.drop)[0];
  if (top) toast('Field ' + top.f.name + ': NDVI fell ' + fmt(top.drop, 2) + ' in recent scenes. Check its water before acting.', 'warn', 6000);
}

function setOverlay(kind) {
  S.overlay = ['ndvi', 'moisture', 'classes', 'aef'].includes(kind) ? kind : 'none';
  writeParam('overlay', S.overlay === 'none' ? '' : S.overlay);
  applyOverlay();
}
function applyOverlay() {
  if (!S.state) return;
  const k = S.overlay;
  if (k === 'ndvi') { game.setOverlay('ndvi', S.grid || { values: [] }); return; }
  if (k === 'moisture') { const byField = {}; for (const [id, fs] of Object.entries(S.state.fields)) byField[id] = fs.taw_mm ? fs.soil_water_mm / fs.taw_mm : 0; game.setOverlay('moisture', { byField }); return; }
  if (k === 'classes' || k === 'aef') {
    if (!S.aef) { game.setOverlay('none', null); if (!S.aefLoading) { S.aefLoading = true; loadAef().then((a) => { S.aef = a; applyOverlay(); drawer.refresh(); }).catch(() => {}).finally(() => { S.aefLoading = false; }); } return; }
    if (k === 'classes') game.setOverlay('classes', drawer.classesOverlay());
    else { const byField = {}; for (const [id, v] of Object.entries(S.aef.fields || {})) if (v.rgb) byField[id] = v.rgb; game.setOverlay('aef', { byField }); }
    return;
  }
  game.setOverlay('none', null);
}

function setBase(kind) {
  S.base = kind === 'satellite' ? 'satellite' : 'farm';
  writeParam('base', S.base === 'farm' ? '' : S.base);
  call('setBasemap', S.base);
  const on = S.base === 'satellite';
  $('base-btn').setAttribute('aria-pressed', String(on));
  $('credit').classList.toggle('hidden', !on);
  if (on) ensureImagery();
}
async function ensureImagery() {
  const farmId = S.farmId, box = call('groundBox');
  if (!box) { toast('This farm has no map location for satellite imagery', 'warn'); if (S.base === 'satellite') setBase('farm'); return; }
  if (S.imagery && S.imagery.farmId === farmId && (S.imagery.ok || S.imagery.busy)) return;
  const job = S.imagery = { farmId, busy: true, ok: false }, btn = $('base-btn');
  btn.classList.add('wait');
  try {
    const quick = await loadImagery(box, { maxPx: 1024, maxTiles: 36 });
    if (S.imagery !== job) return;
    call('setImagery', quick); job.ok = true;
    const fine = await loadImagery(box, { maxPx: isTouch() ? 2048 : 4096, maxTiles: 256 });
    if (S.imagery === job && fine.z > quick.z) call('setImagery', fine);
  } catch (e) {
    if (S.imagery !== job) return;
    if (!job.ok) { S.imagery = null; toast('Satellite imagery did not load: ' + e.message, 'warn', 6000); if (S.base === 'satellite') setBase('farm'); }
  } finally {
    job.busy = false;
    if (S.imagery === job || !S.imagery) btn.classList.remove('wait');
  }
}

function recommendedOp(id) {
  const fs = S.state && S.state.fields[id]; if (!fs || fs.harvested) return null;
  if (!fs.planted) return 'plant';
  if (fs.stage === 'mature') return 'harvest';
  if (isStressed(fs)) return 'irrigate';
  if ((fs.pest_pressure || 0) > 0.45) return 'spray';
  return null;
}

function farmTitle() { const p = S.place || {}, st = S.state || {}; return p.title || st.title || (S.farm && S.farm.title) || 'FarmVerse'; }
function renderHud() {
  const st = S.state, compact = isCompact(); if (!st) return;
  const p = S.place || {}, t = st.totals || {};
  $('farm-title').textContent = farmTitle();
  $('farm-sub').textContent = [compact ? null : p.region, S.farm.fields.length + ' fields', fmt(t.score) + ' pts'].filter(Boolean).join(' · ');
  $('day-lab').textContent = dateLabel(st.day, !compact);
  $('day-sub').textContent = 'Day ' + st.day_index + (st.start_date ? ' since ' + dateLabel(st.start_date, false) : '') + ' · ' + cap(st.season);
  $('day-btn').setAttribute('aria-label', 'Season day ' + st.day_index + ', ' + dateLabel(st.day, true) + '. Open the season calendar');
  syncDays();
  calendar.refresh();
}
function renderAll() {
  const st = S.state; if (!st || !S.farm) return;
  renderHud();
  game.setStates(st.fields); game.setSeason(st.season); game.setWeather(st.weather_today);
  applyOverlay(); weather.render(); popover.refresh(); drawer.refresh(); refreshCard(); updateAmbient();
}

function nextSpec(na) {
  const fid = na.field_id && S.state.fields[na.field_id] ? na.field_id : null;
  const verb = { plant: 'Plant', irrigate: 'Irrigate', spray: 'Spray', harvest: 'Harvest', advance: 'Skip ahead 7 days', wait: 'Wait a day' }[na.kind] || 'Go';
  const title = na.kind === 'advance' ? 'Nothing needs you this week' : na.title || verb;
  return {
    kicker: 'Next move', title, why: na.why || '', key: na.key || '',
    label: fid && OPS.includes(na.kind) ? verb + ' ' + fieldName(fid) : verb,
    run: () => (OPS.includes(na.kind) && fid ? act(na.kind, fid, na.crop ? { crop: na.crop } : {}) : advance(na.kind === 'wait' ? 1 : na.days || 7)),
    more: { label: fid ? 'Open field ' + fieldName(fid) : 'Open the data', run: () => (fid ? selectField(fid, { popover: true, fly: true }) : drawer.open()) },
  };
}
function refreshCard() {
  if (!S.state) return;
  card.show(tour.active() ? tour.spec() : nextSpec(S.state.next_action || { kind: 'advance' }));
  updatePad();
}
function updatePad() {
  const t = game.tractor ? game.tractor() : {}, op = t.fieldId ? recommendedOp(t.fieldId) : null;
  if (op) pad.label(cap(op), 'field ' + fieldName(t.fieldId));
  else { const c = card.current(); pad.label('Action', c ? c.label : ''); }
}
function padAction() {
  const t = game.tractor ? game.tractor() : {}, op = t.fieldId ? recommendedOp(t.fieldId) : null;
  if (op) return act(op, t.fieldId);
  return card.run();
}

const sheetMode = () => window.innerWidth < 960;
function openDrawer(t) { drawer.open(t); if (sheetMode()) popover.close(); }
function selectField(id, o = {}) {
  const exists = id && S.state && S.state.fields[id];
  S.selected = exists ? id : null;
  writeParam('field', S.selected || '');
  game.selectField(S.selected);
  if (S.selected && o.fly) fly(S.selected, { duration: 1100 });
  if (S.selected && o.popover !== false && !(sheetMode() && drawer.isOpen())) popover.open(S.selected);
  if (!S.selected) popover.close();
  drawer.refresh();
}
function onPopoverClose() {
  if (drawer.isOpen()) return;
  S.selected = null; writeParam('field', ''); game.selectField(null);
}

function flashDay() {
  const d = $('dayctl'); d.classList.remove('flash'); void d.offsetWidth; d.classList.add('flash');
}
function syncDays() {
  const di = (S.state && S.state.day_index) || 0;
  $('adv1').disabled = $('adv7').disabled = S.busy;
  $('back1').disabled = $('back7').disabled = S.busy || di < 1;
}
function setBusy(b) {
  S.busy = b; syncDays();
  card.setBusy(b); popover.refresh(); calendar.refresh();
}
function eventToasts(events, max) {
  const rank = { mission: 0, harvest: 1, stress: 2, op: 3, stage: 4, rain: 5 };
  const evs = (events || []).slice().sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9)).slice(0, max);
  for (const e of evs) toast(e.text, e.kind === 'stress' ? 'warn' : e.kind === 'rain' ? 'info' : 'good');
  if ((events || []).some((e) => e.kind === 'mission')) sfx('mission');
  else if ((events || []).some((e) => e.kind === 'stress')) sfx('alert');
}

async function act(op, fieldId, extra = {}) {
  if (!fieldId || !S.state) return;
  const fs = S.state.fields[fieldId]; if (!fs) return;
  const name = fieldName(fieldId);
  if (fs.harvested) { toast('Field ' + name + ' is already harvested', 'warn'); return; }
  if (op !== 'plant' && !fs.planted) { toast('Plant field ' + name + ' first', 'warn'); return; }
  if (op === 'plant' && fs.planted) { toast('Field ' + name + ' is already planted'); return; }
  if (op === 'plant' && !extra.crop && ['unknown', 'other', 'fallow'].includes(fs.crop)) { selectField(fieldId, { popover: true, fly: true }); popover.open(fieldId, { pickCrop: true }); return; }
  if (S.busy) return;
  userInput();
  if (S.selected !== fieldId) selectField(fieldId, { popover: popover.isOpen() });
  fly(fieldId, { duration: 900 });
  const before = { ...fs };
  setBusy(true);
  try {
    const out = await gameCall('op', { field_id: fieldId, op, amount_mm: op === 'irrigate' ? 25 : 0, ...extra }, 'last op');
    setState(out.state, 'op');
    eventToasts(out.events, 2);
    sfx(op); call('effect', op, fieldId);
    renderAll();
    tour.onEvent({ type: 'op', op, fieldId });
    if (op === 'irrigate') outlook.open(fieldId, { before, out });
  } catch (e) { toast('Could not ' + op + ' field ' + name + ': ' + e.message, 'warn', 6000); sfx('alert'); }
  setBusy(false);
}
async function advance(days) {
  if (S.busy || !S.state) return;
  const back = days < 0, n = back ? Math.min(-days, S.state.day_index || 0) : days;
  if (n < 1) { toast('This is the first day of the season', 'info'); return; }
  userInput(); setBusy(true);
  const wk = weekEnd(S.state.day), from = S.state.day, kind = back ? 'rewind' : 'advance';
  try {
    const out = await gameCall(kind, { days: n }, 'last ' + kind);
    setState(out.state, kind);
    sfx('advance');
    if (!back) eventToasts(out.events, 2);
    const what = back ? (n === 1 ? 'Back one day' : n + ' days back') : n === 1 ? 'Next day' : n + ' days later';
    const undone = out.dropped_ops ? ' · ' + out.dropped_ops + ' later move' + (out.dropped_ops === 1 ? '' : 's') + ' undone' : '';
    toast(what + ': ' + dateLabel(from, false) + ' → ' + dateLabel(S.state.day, false) + undone, 'info', 3600);
    flashDay();
    if (weekEnd(S.state.day) !== wk) loadGrid();
    renderAll();
    tour.onEvent({ type: kind, days: n });
  } catch (e) { toast('Could not ' + (back ? 'go back' : 'advance') + ': ' + e.message, 'warn', 6000); sfx('alert'); }
  setBusy(false);
}
function rewind(days) { return advance(-Math.max(1, Math.round(+days || 1))); }

async function buildFarm(spec) {
  const cols = spec.cols || NEW_GRID.cols, rows = spec.rows || NEW_GRID.rows, bstr = spec.bounds.join(',');
  loader.start('Building ' + spec.title, [['farm', 'Field boundaries, Fields of The World'], ['cdl', 'Crop history 2017-2024, USDA CDL'], ['aef', 'Crop classes, AlphaEarth embeddings'], ['wx', 'Weather history and 7-day forecast'], ['init', 'Starting the season']]);
  loader.step('farm', 'work', 'Rasterising field polygons to a ' + cols + ' × ' + rows + ' grid');
  let farm;
  try { farm = await py('eo.py', { action: 'farm', bounds: bstr, cols: String(cols), rows: String(rows) }, { key: 'eo-farm' }, 'farm'); }
  catch (e) { loader.step('farm', 'fail', e.message); throw new Error('Could not read field boundaries here: ' + e.message); }
  if (!farm.fields || !farm.fields.length) { loader.step('farm', 'fail', 'no fields in the box'); throw new Error('Fields of The World has no fields in this box. Try farmland nearby.'); }
  loader.step('farm', 'done', farm.fields.length + ' fields' + (farm.ftw_year_used ? ' from FTW ' + farm.ftw_year_used : '') + (farm.country_hint ? ' · ' + farm.country_hint : ''));
  const flist = fieldList(false, farm.fields);
  let history = null, aef = null;
  if (farm.cdl_available === false) loader.step('cdl', 'skip', 'CDL covers the USA only');
  else {
    loader.step('cdl', 'work', 'Majority crop per field per year');
    try { history = await py('eo.py', { action: 'cdl_history', fields: JSON.stringify(flist), years: '2017-2024' }, { key: 'eo-cdl' }, 'cdl_history'); loader.step('cdl', 'done', Object.keys(history.fields || {}).length + ' fields with history'); }
    catch (e) { history = null; loader.step('cdl', 'skip', 'unavailable: ' + e.message.slice(0, 90)); }
  }
  loader.step('aef', 'work', 'Averaging 64-band embeddings inside each field');
  try {
    aef = await py('eo.py', { action: 'aef_fields', bounds: bstr, fields: JSON.stringify(fieldList(true, farm.fields, null)), year: '2024', k: '4' }, { key: 'eo-aef' }, 'aef_fields');
    loader.step('aef', 'done', aef.supervised ? 'supervised, ' + fmt((aef.accuracy_loo || 0) * 100) + '% leave-one-out accuracy' : (aef.clusters || []).length + ' unsupervised classes');
  } catch (e) { aef = null; loader.step('aef', 'skip', 'unavailable: ' + e.message.slice(0, 90)); }
  const c = centerOf(farm), sd = hemisphereStart(c.lat);
  loader.step('wx', 'work', 'NOAA GEFS, CHIRPS and the GFS forecast (dynamical.org)');
  let wx;
  try { wx = await fetchWeather(c, sd); }
  catch (e) { loader.step('wx', 'fail', e.message); throw new Error('Weather unavailable: ' + e.message); }
  loader.step('wx', 'done', (wx.history || []).length + ' days of history, ' + (wx.forecast || []).length + ' forecast days');
  loader.step('init', 'work', 'Soil, crops and missions');
  let init;
  try { init = await gameCall('init', { farm, weather: wx, start_date: sd, title: spec.title, bounds: spec.bounds, history, aef }, 'init', spec.id); }
  catch (e) { loader.step('init', 'fail', e.message); throw new Error('Could not start the season: ' + e.message); }
  loader.step('init', 'done');
  S.farmId = spec.id; S.farm = init.farm; setState(init.state, 'init'); S.weather = wx; S.cdl = history; S.aef = aef;
}

async function openFarm(id) {
  loader.start('Opening your farm', [['load', 'Saved season']]);
  loader.step('load', 'work');
  S.feed = null; S.grid = null; S.cdl = null; S.aef = null; S.weather = null;
  try {
    if (!hasPy) throw new Error('Python is not reachable');
    const saved = await py('game.py', { action: 'load', farm_id: id }, { key: 'game-load' }, 'load');
    account.init();
    if (saved && saved.farm && saved.state) { S.farmId = id; S.farm = saved.farm; setState(saved.state, 'load'); S.raw.farm = { ...S.raw.load, data: saved.farm }; loader.step('load', 'done'); }
    else if (id === DEFAULT.id) await buildFarm(DEFAULT);
    else { toast('Farm ' + id + ' is not saved here; opening ' + DEFAULT.title, 'warn'); return openFarm(DEFAULT.id); }
  } catch (e) { loader.fail(e.message, [['Try again', () => openFarm(id), true]]); return; }
  afterOpen();
}

function afterOpen() {
  writeParam('farm', S.farmId === DEFAULT.id ? '' : S.farmId);
  game.setFarm(S.farm);
  S.imagery = null; setBase(S.base);
  S.muted = !!(S.state.ui && S.state.ui.muted);
  try { if (snd) snd.setMuted(S.muted); } catch (e) {}
  loader.done();
  renderAll();
  layout();
  if (S.selected && S.state.fields[S.selected]) selectField(S.selected, { popover: true });
  else S.selected = null;
  S.place = (S.state.ui && S.state.ui.place && S.state.ui.place.title) ? S.state.ui.place : null;
  renderHud();
  tour.restore((S.state.ui && S.state.ui.tour_step) || 'welcome');
  intro();
  if (readParam('mode', 'farm') === 'data') openDrawer(readParam('tab', 'satellite'));
  if (readParam('view', '') === 'map') realmap.open();
  if (readParam('cal', '') === 'open') calendar.open();
  if (!S.weather) loadWeather(); else weather.render();
  loadGrid();
  loadPlace();
  loadRoads();
  const farmId = S.farmId;
  loadFeed().then(() => feedOf() && feedOf().done).then(() => { if (S.farmId === farmId) scoutNdvi(); });
  runDo(readParam('do', ''));
}

async function runDo(raw) {
  const v = String(raw || '').trim(); if (!v || !S.state) return;
  writeParam('do', '');
  const [cmd, a, b] = v.split(':');
  const fid = a && S.state.fields[a] ? a : null;
  try {
    if (cmd === 'advance') await advance(Math.max(1, Math.min(366, +a || 1)));
    else if (cmd === 'rewind') await rewind(Math.max(1, Math.min(366, +a || 1)));
    else if (OPS.includes(cmd)) { if (fid) await act(cmd, fid, b ? { crop: b } : {}); else toast('No field ' + a + ' on this farm', 'warn'); }
    else if (cmd === 'select') selectField(fid, { popover: true, fly: true });
    else if (cmd === 'calendar') calendar.open();
    else if (cmd === 'map') realmap.open(a ? { layer: a } : undefined);
    else if (cmd === 'data') openDrawer(a || undefined);
    else if (cmd === 'feed') { const job = loadFeed(a === 'build'); openDrawer('feed'); await job; }
    else if (cmd === 'menu') menu.open();
    else if (cmd === 'picker') picker.open();
    else if (cmd === 'signin') account.openSignIn();
    else if (cmd === 'build') { const [lon, lat] = String(a || '').split(',').map(Number); if (isFinite(lon) && isFinite(lat)) await startFarm({ bounds: boxAround(lon, lat), title: 'Farm near ' + lat.toFixed(3) + ', ' + lon.toFixed(3) }); else toast('do=build needs lon,lat', 'warn'); }
    else if (cmd === 'tour') { if (a === 'skip') tour.skip(); else tour.restart(); }
    else if (cmd === 'overlay') setOverlay(a || 'none');
    else if (cmd === 'base') setBase(a || (S.base === 'satellite' ? 'farm' : 'satellite'));
    else if (cmd === 'zoom') for (let n = Math.max(1, Math.min(8, +b || 1)); n-- > 0;) call('zoomBy', a === 'in' ? 1 : -1);
    else if (cmd === 'weather') weather.toggle();
    else if (cmd === 'mute') toggleMute();
    else if (cmd === 'outlook') outlook.open(fid || (S.farm.fields[0] || {}).field_id);
    else toast('Unknown do=' + cmd, 'warn');
  } catch (e) { console.warn('do=' + v, e); }
}
try { if (P && typeof P.onChange === 'function') P.onChange(() => { const d = readParam('do', ''); if (d) runDo(d); }); } catch (e) {}

async function switchFarm(id) {
  if (S.busy) return;
  if (id === S.farmId) return;
  popover.close(); drawer.close(); S.selected = null; writeParam('field', '');
  introDone = false;
  await openFarm(id);
}
async function startFarm({ bounds, title }) {
  if (S.busy) return;
  const id = 'fv-' + (await sha1hex(bounds.map((v) => Number(v).toFixed(4)).join(','))).slice(0, 8);
  const prev = { farmId: S.farmId };
  if (/^Farm near/.test(title)) {
    const c = centerOf({ bounds });
    try { const p = await py('eo.py', { action: 'place', lat: String(c.lat), lon: String(c.lon) }, { key: 'eo-place' }, 'place'); if (p && p.title) title = p.title; } catch (e) {}
  }
  try {
    const saved = await py('game.py', { action: 'load', farm_id: id }, { key: 'game-load' });
    if (saved && saved.farm) return switchFarm(id);
  } catch (e) {}
  popover.close(); drawer.close(); S.selected = null; writeParam('field', '');
  setBusy(true);
  try {
    await buildFarm({ id, bounds, title });
    introDone = false;
    setBusy(false);
    afterOpen();
    toast('Welcome to ' + title, 'good');
  } catch (e) {
    setBusy(false);
    loader.fail(e.message, [['Pick another area', () => { loader.done(); picker.open(); }, true], ['Back to the farm', () => { loader.done(); if (S.farmId !== prev.farmId) switchFarm(prev.farmId); }]]);
  }
}
async function resetSeason() {
  if (S.busy || !S.farm) return;
  if (!window.confirm('Restart the season on ' + farmTitle() + '? Your progress is erased.')) return;
  setBusy(true);
  try {
    const title = farmTitle(), bounds = S.farm.bounds, cols = S.farm.cols, rows = S.farm.rows, id = S.farmId;
    await gameCall('reset', null, 'reset');
    await buildFarm({ id, bounds, title, cols, rows });
    setBusy(false); introDone = false; afterOpen();
  } catch (e) { setBusy(false); loader.fail('Restart failed: ' + e.message, [['Reload the farm', () => openFarm(S.farmId), true]]); }
}

function closeTop() {
  if (picker.isOpen()) picker.close();
  else if (realmap.isOpen()) realmap.close();
  else if (calendar.isOpen()) calendar.close();
  else if (weather.isOpen()) weather.close();
  else if (outlook.isOpen()) outlook.close();
  else if (menu.isOpen()) menu.close();
  else if (popover.isOpen()) popover.close();
  else if (drawer.isOpen()) drawer.close();
}
window.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  userInput();
  if (e.key === 'Escape') closeTop();
  else if (e.key === '1') drawer.close();
  else if (e.key === '2') { if (drawer.isOpen()) drawer.close(); else openDrawer(); }
  else if (e.key === 'm' || e.key === 'M') { if (realmap.isOpen()) realmap.close(); else realmap.open(); }
  else if (e.key === 'c' || e.key === 'C') calendar.toggle();
  else if (e.key === 'b' || e.key === 'B') { sfx('ui'); setBase(S.base === 'satellite' ? 'farm' : 'satellite'); }
  else if (e.key === 'Enter' && !e.repeat && !(t && t.closest && t.closest('button,a,[role=option]'))) advance(1);
});
$('chip').addEventListener('click', () => { sfx('ui'); menu.toggle(); });
$('data-btn').addEventListener('click', () => { sfx('ui'); if (drawer.isOpen()) drawer.close(); else openDrawer(); });
$('base-btn').addEventListener('click', () => { sfx('ui'); setBase(S.base === 'satellite' ? 'farm' : 'satellite'); });
$('credit').textContent = IMAGERY_CREDIT;
$('day-btn').addEventListener('click', () => { sfx('ui'); calendar.toggle(); });
$('back1').addEventListener('click', () => rewind(1));
$('back7').addEventListener('click', () => rewind(7));
$('adv1').addEventListener('click', () => advance(1));
$('adv7').addEventListener('click', () => advance(7));
game.on('select', (id) => { if (id) { sfx('select'); selectField(id, { popover: true }); } else popover.close(); });
game.on('op', ({ op, fieldId }) => act(op, fieldId));
game.on('tractor', () => updatePad());
game.on('drive', (on) => { try { if (snd) snd.loop('engine', on); } catch (e) {} });
game.on('idle', () => { if (!popover.isOpen() && !drawer.isOpen() && !outlook.isOpen() && !picker.isOpen()) cinematic(true); });
new ResizeObserver(() => layout()).observe($('wx'));

layout();
openFarm(S.farmId);
