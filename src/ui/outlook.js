// Harvest outlook card after irrigating: before/after yield, the no-irrigation path, and this season's NDVI against past peaks.
import { h, css, fmt, dateLabel } from './util.js';

css('outlook', `
#ol { position: absolute; z-index: 51; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(460px, calc(100% - 24px)); max-height: calc(100% - 40px);
  padding: 16px 18px 14px; animation: fv-zoom 0.3s ease-out; }
@keyframes fv-zoom { from { opacity: 0; transform: translate(-50%, -46%) scale(0.97); } to { opacity: 1; transform: translate(-50%, -50%); } }
#ol .k { font-size: 10.5px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--accent); }
#ol h3 { margin: 2px 0 0; font: 700 19px/1.2 var(--sans); letter-spacing: -0.3px; }
#ol .big { display: flex; align-items: baseline; gap: 10px; margin-top: 10px; flex-wrap: wrap; }
#ol .big b { font: 700 32px/1 var(--sans); letter-spacing: -0.8px; font-variant-numeric: tabular-nums; }
#ol .big span { color: var(--muted); font-size: 13px; }
#ol .big .up { color: var(--accent-2); font-weight: 700; } #ol .big .down { color: var(--danger); font-weight: 700; }
#ol table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 12.5px; }
#ol th { text-align: right; font-weight: 600; color: var(--faint); font-size: 11px; padding: 0 0 4px 8px; }
#ol th:first-child { text-align: left; padding-left: 0; }
#ol td { padding: 6px 0 6px 8px; border-top: 1px solid var(--hair); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
#ol td:first-child { text-align: left; padding-left: 0; color: var(--muted); white-space: normal; }
#ol tr.now td { color: var(--ink); font-weight: 700; }
#ol .note { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
#ol .act { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
@media (max-width: 599px) {
  #ol { left: 0; right: 0; top: auto; bottom: 0; transform: none; width: auto; max-height: 82%; border-radius: 16px 16px 0 0; padding-bottom: calc(14px + var(--sb)); animation: fv-rise 0.3s ease-out; }
}
`);

export function createOutlook(ctx) {
  const S = ctx.S, hud = document.getElementById('hud');
  let el = null, scrim = null, token = 0;
  function close() {
    if (!el) return;
    el.remove(); scrim.remove(); el = scrim = null; token++;
    ctx.tourEvent({ type: 'outlook-close' });
  }
  async function open(fid, info = {}) {
    if (!fid || !S.farm) return;
    if (el) { el.remove(); scrim.remove(); }
    const my = ++token;
    const f = ctx.fieldOf(fid), fs = S.state.fields[fid] || {};
    const area = f ? f.area_ha || 0 : 0;
    scrim = h('div', { id: 'ol-scrim', class: 'scrim', onclick: close });
    el = h('section', { id: 'ol', class: 'panel scroll', role: 'dialog', 'aria-label': 'Harvest outlook' });
    hud.append(scrim, el);
    const pick = (o) => (o && (o.now || o)) || null;
    const opOl = info.out && info.out.outlook;
    let before = pick(opOl && opOl.before), after = pick(opOl && opOl.after), full = null, unavailable = '';
    if (!before && info.before) before = { yield_est_t_ha: info.before.yield_est_t_ha };
    if (!after) after = { yield_est_t_ha: fs.yield_est_t_ha };
    const draw = () => {
      if (my !== token || !el) return;
      el.textContent = '';
      el.append(h('div', { class: 'k', text: 'Harvest outlook' }), h('h3', { text: 'Field ' + ctx.fieldName(fid) + ' · ' + ctx.cropLabel(fs.crop) }));
      const a = after && after.yield_est_t_ha, b = before && before.yield_est_t_ha, d = a != null && b != null ? a - b : null;
      const big = h('div', { class: 'big' }, h('b', { text: fmt(a, 1) + ' t/ha' }), h('span', { text: (full ? 'projected at harvest' : 'current estimate') + ' · ' + fmt(a * area) + ' t on ' + fmt(area) + ' ha' }));
      if (d != null) big.append(h('span', { class: Math.abs(d) < 0.05 ? '' : d > 0 ? 'up' : 'down', text: Math.abs(d) < 0.05 ? 'no yield change: the root zone was not short of water' : (d > 0 ? '+' : '−') + fmt(Math.abs(d), 1) + ' t/ha from this irrigation' }));
      el.append(big);
      const t = h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Path' }), h('th', { text: 't/ha' }), h('th', { text: 'Harvest' }), h('th', { text: 'Ready' }))));
      const tb = h('tbody'); t.append(tb);
      const row = (label, o, cls, extra) => { if (!o || o.yield_est_t_ha == null) return; tb.append(h('tr', { class: cls || '' }, h('td', { text: label + (extra ? ' · ' + extra : '') }), h('td', { text: fmt(o.yield_est_t_ha, 1) }), h('td', { text: fmt(o.harvest_t ?? o.yield_est_t_ha * area) + ' t' }), h('td', { text: o.mature_date ? dateLabel(o.mature_date, false) : '–' }))); };
      row('Before this irrigation', before);
      row('After (now)', full ? (full.now || after) : after, 'now');
      if (full) { row('Never irrigate again', full.no_irrigation, '', full.no_irrigation && full.no_irrigation.stress_days != null ? full.no_irrigation.stress_days + ' stress days' : ''); row('Irrigate every week', full.weekly_irrigation, '', full.weekly_irrigation && full.weekly_irrigation.water_m3 != null ? fmt(full.weekly_irrigation.water_m3) + ' m³' : ''); }
      el.append(t);
      if (!full) el.append(h('p', { class: 'note', text: unavailable ? 'Season projection unavailable: ' + unavailable : 'Projecting the rest of the season…' }));
      else if (full.history && full.history.note) el.append(h('p', { class: 'note', text: full.history.note + '.' }));
      el.append(h('div', { class: 'act' }, h('button', { class: 'btn', text: 'Open water chart', onclick: () => { close(); ctx.openDrawer('water'); } }), h('button', { class: 'btn primary', text: 'Got it', onclick: () => { ctx.sfx('ui'); close(); } })));
    };
    draw();
    try {
      full = await ctx.py('game.py', { action: 'outlook', farm_id: S.farmId, payload: JSON.stringify({ field_id: fid }) }, { key: 'outlook' }, 'outlook:' + fid);
      if (!full || (!full.now && !full.no_irrigation)) { unavailable = 'the server returned no projection'; full = null; }
    } catch (e) { unavailable = e.message; full = null; }
    draw();
  }
  return { open, close, isOpen: () => !!el };
}
