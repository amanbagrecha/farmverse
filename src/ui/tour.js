// Guided tour: eight steps on the action card with camera flights and a spotlight, progress saved through game.py set.
import { h, css, cropLabel, isStressed, isCompact, dateLabel } from './util.js';

css('tour', `
#spot { position: absolute; z-index: 30; pointer-events: none; border-radius: 14px; box-shadow: 0 0 0 4px var(--accent), 0 0 0 9999px rgba(6, 9, 5, 0.58); transition: left 0.35s ease, top 0.35s ease, width 0.35s ease, height 0.35s ease, opacity 0.3s; }
#spot.off { opacity: 0; }
.lit { z-index: 31 !important; }
`);

const ORDER = ['welcome', 'biggest', 'plant', 'advance', 'satellite', 'irrigate', 'outlook', 'free'];

export function createTour(ctx) {
  const spot = h('div', { id: 'spot', class: 'off', 'aria-hidden': 'true' });
  document.getElementById('app').appendChild(spot);
  let step = 'welcome', startDay = 0, litEl = null, spotSel = null, irrigated = null;
  const S = ctx.S;
  const fields = () => (S.farm ? S.farm.fields : []);
  const fs = (id) => (S.state && S.state.fields[id]) || null;
  const nm = (id) => ctx.fieldName(id);
  const biggest = () => fields().slice().sort((a, b) => (b.area_ha || 0) - (a.area_ha || 0))[0];
  const bareField = () => fields().filter((f) => { const s = fs(f.field_id); return s && !s.planted && !s.harvested; }).sort((a, b) => (b.area_ha || 0) - (a.area_ha || 0))[0];
  const plantedField = () => fields().filter((f) => { const s = fs(f.field_id); return s && s.planted && !s.harvested; }).sort((a, b) => (b.area_ha || 0) - (a.area_ha || 0))[0];
  const stressedField = () => fields().map((f) => f.field_id).filter((id) => isStressed(fs(id))).sort((a, b) => (fs(b).depletion_pct || 0) - (fs(a).depletion_pct || 0))[0];

  function specFor(id) {
    const n = ORDER.indexOf(id) + 1, kicker = 'Tour ' + n + '/' + ORDER.length;
    const base = { kicker, skip: id === 'free' ? null : { label: 'Skip tour', run: () => go('done') } };
    const title = ctx.farmTitle();
    if (id === 'welcome') return { ...base, title: 'Welcome to ' + title, why: S.state ? 'It is ' + dateLabel(S.state.day) + ', season day ' + S.state.day_index : fields().length + ' real fields, real weather', label: 'Start the tour', run: () => go('biggest') };
    if (id === 'biggest') {
      const f = biggest(); if (!f) return { ...base, title: 'No fields here', why: 'This box has no field boundaries', label: 'Next', run: () => go('plant') };
      const s = fs(f.field_id) || {}, src = s.crop_source === 'aef' ? 'AlphaEarth' : s.crop_source === 'player' ? 'you' : s.crop_source === 'none' || s.crop === 'unknown' ? 'no crop map' : 'USDA CDL';
      return { ...base, title: 'Biggest field: ' + nm(f.field_id), why: Math.round(f.area_ha || 0) + ' ha of ' + cropLabel(s.crop || f.crop).toLowerCase() + ' (' + src + '). Tap any field.', label: 'Next', run: () => go('plant') };
    }
    if (id === 'plant') {
      const f = bareField();
      if (!f) return { ...base, title: 'Every field is planted', why: 'Planting comes next spring.', label: 'Next', run: () => go('advance') };
      return { ...base, title: 'Plant field ' + nm(f.field_id), why: 'Bare soil earns nothing. Press P or plant it here.', label: 'Plant ' + nm(f.field_id), key: 'P', run: () => ctx.act('plant', f.field_id) };
    }
    if (id === 'advance') {
      const left = Math.max(1, 14 - ((S.state ? S.state.day_index : 0) - startDay));
      return { ...base, title: 'Let the season run ' + left + ' days', why: 'Time moves only when you say so.', label: 'Skip ahead ' + left + ' days', run: () => ctx.advance(left) };
    }
    if (id === 'satellite') return { ...base, title: 'Read the satellite', why: 'NDVI shows which fields are green and which lag.', label: 'Open the Data drawer', key: '2', run: () => ctx.openDrawer('satellite') };
    if (id === 'irrigate') {
      const sid = stressedField();
      if (sid) return { ...base, title: 'Field ' + nm(sid) + ' is thirsty', why: 'Root zone ' + Math.round(fs(sid).depletion_pct || 0) + '% depleted. Give it 25 mm.', label: 'Irrigate ' + nm(sid), key: 'I', run: () => ctx.act('irrigate', sid) };
      const p = plantedField();
      return { ...base, title: 'Wait for a stress alert', why: 'No field is short of water yet. Advance a week.', label: 'Skip ahead 7 days', run: () => ctx.advance(7), more: p ? { label: 'Irrigate ' + nm(p.field_id) + ' anyway', run: () => ctx.act('irrigate', p.field_id) } : null };
    }
    if (id === 'outlook') return { ...base, title: 'What did that water buy?', why: 'Yield with and without irrigation, vs past seasons.', label: 'Show harvest outlook', run: () => ctx.openOutlook(irrigated || plantedField()?.field_id) };
    return { ...base, kicker: 'Tour done', title: 'The farm is yours', why: 'This card always shows the one best next move.', label: 'Start playing', run: () => go('done') };
  }

  function place() {
    if (!spotSel) { spot.classList.add('off'); return; }
    const t = document.querySelector(spotSel);
    if (!t || !t.offsetParent) { spot.classList.add('off'); return; }
    const r = t.getBoundingClientRect(), a = document.getElementById('app').getBoundingClientRect();
    Object.assign(spot.style, { left: (r.left - a.left - 6) + 'px', top: (r.top - a.top - 6) + 'px', width: (r.width + 12) + 'px', height: (r.height + 12) + 'px' });
    spot.classList.remove('off');
  }
  function setSpot(sel) {
    if (litEl) litEl.classList.remove('lit');
    document.getElementById('app').classList.toggle('lit-card', !!sel);
    spotSel = sel; litEl = sel ? document.querySelector(sel) : null;
    if (litEl) litEl.classList.add('lit');
    place();
  }
  window.addEventListener('resize', () => requestAnimationFrame(place));

  function enter(id, fromRestore) {
    step = id;
    startDay = S.state ? S.state.day_index : 0;
    if (!fromRestore) ctx.saveUi({ tour_step: id });
    setSpot(null);
    const moveCam = !fromRestore;
    if (id === 'welcome') ctx.intro();
    else if (!moveCam) { if (id === 'advance') setSpot('#wx'); else if (id === 'satellite') setSpot('#data-btn'); }
    else if (id === 'biggest') { const f = biggest(); if (f) { ctx.fly(f.field_id, { zoom: 2, duration: 1600 }); ctx.selectField(f.field_id, { popover: !isCompact() }); } }
    else if (id === 'plant') { const f = bareField(); if (f) { ctx.fly(f.field_id, { duration: 1400 }); ctx.selectField(f.field_id, { popover: false }); } }
    else if (id === 'advance') { ctx.fly('overview', { duration: 1400 }); setSpot('#wx'); }
    else if (id === 'satellite') setSpot('#data-btn');
    else if (id === 'irrigate') { const sid = stressedField(); if (sid) ctx.fly(sid, { duration: 1400 }); }
    else if (id === 'done') { ctx.cinematic(false); }
    ctx.refreshCard();
  }
  function go(id) { if (id !== step) ctx.sfx(id === 'done' ? 'mission' : 'ui'); enter(id, false); }

  function onEvent(ev) {
    if (!active()) return;
    if (step === 'plant' && ev.type === 'op' && ev.op === 'plant') go('advance');
    else if (step === 'advance' && ev.type === 'advance' && S.state.day_index - startDay >= 14) go('satellite');
    else if (step === 'satellite' && ev.type === 'drawer') go('irrigate');
    else if (step === 'irrigate' && ev.type === 'op' && ev.op === 'irrigate') { irrigated = ev.fieldId; go('outlook'); }
    else if (step === 'outlook' && ev.type === 'outlook-close') go('free');
    else ctx.refreshCard();
  }
  function restore(saved) {
    step = ORDER.includes(saved) || saved === 'done' ? saved : 'welcome';
    enter(step, true);
  }
  function active() { return step !== 'done'; }
  return { spec: () => specFor(step), onEvent, restore, active, skip: () => go('done'), restart: () => go('welcome'), place };
}
