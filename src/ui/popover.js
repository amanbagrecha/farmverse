// Field popover: name, crop with source badge, stage, water in words, latest NDVI with sparkline, op buttons, crop picker.
import { h, css, fmt, dateLabel, cropLabel, stageLabel, waterWords, SOURCE_BADGE, PLANTABLE, CROP_COLORS, chartFig } from './util.js';
import { sparkline } from '../charts.js';

css('popover', `
#pop { position: absolute; z-index: 20; left: calc(var(--gap) + var(--sl)); bottom: calc(var(--gap) + var(--sb) + var(--pad-h)); width: 312px;
  max-height: calc(100% - var(--wx-bottom) - 8px - var(--gap) - var(--sb) - var(--pad-h)); padding: 12px 14px 12px; animation: fv-rise 0.25s ease-out; }
#pop .ph { display: flex; align-items: flex-start; gap: 8px; }
#pop .ph h3 { flex: 1; min-width: 0; margin: 0; font: 700 19px/1.15 var(--sans); letter-spacing: -0.3px; }
#pop .crop { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 4px; font-size: 13px; }
#pop .sw { width: 10px; height: 10px; border-radius: 3px; flex: none; }
#pop .badge { font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; padding: 2px 6px; border-radius: 5px; border: 1px solid var(--line); color: var(--muted); text-transform: uppercase; }
#pop .badge.cdl { color: var(--accent); border-color: rgba(242, 194, 48, 0.45); }
#pop .badge.aef { color: #9fc8ff; border-color: rgba(159, 200, 255, 0.45); }
#pop .badge.player { color: var(--accent-2); border-color: rgba(108, 194, 84, 0.45); }
#pop .area { color: var(--muted); }
#pop dl { margin: 10px 0 0; display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 5px 12px; font-size: 12.5px; }
#pop dt { color: var(--muted); } #pop dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; min-width: 0; }
#pop dd.warn { color: var(--danger); font-weight: 600; } #pop dd.mid { color: var(--accent); }
#pop .spark { margin: 6px 0 0; } #pop .spark canvas { width: 100%; height: 46px; cursor: crosshair; }
#pop .spark figcaption { font-size: 10.5px; color: var(--faint); margin-top: 2px; }
#pop .alerts { margin-top: 8px; font-size: 12px; color: var(--danger); }
#pop .ops { display: flex; gap: 4px; margin-top: 12px; }
#pop .ops .step { position: relative; flex: 1 1 0; min-width: 0; height: 36px; display: flex; align-items: center; justify-content: center; gap: 3px; padding: 0 2px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface-2); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
#pop .ops .step i { flex: none; width: 15px; height: 15px; border-radius: 50%; border: 1px solid var(--line); font: 700 9.5px/13px var(--mono); font-style: normal; text-align: center; color: var(--muted); }
#pop .ops .step kbd { position: absolute; top: -7px; right: -2px; font-size: 9px; padding: 1px 3px; background: var(--surface); }
#pop .ops .step:hover { border-color: var(--accent); }
#pop .ops .step.next { border-color: var(--accent); color: var(--accent); }
#pop .ops .step.next i { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
#pop .ops .step.done { color: var(--faint); background: transparent; }
#pop .ops .step.done i { border-color: var(--accent-2); color: var(--accent-2); }
#pop .ops .step[disabled] { opacity: 0.4; cursor: default; filter: none; }
#pop .ops .step.done[disabled] { opacity: 0.75; }
#pop .ops .step[disabled]:hover { border-color: var(--line); }
#pop .lastop { margin: 6px 0 0; font-size: 11.5px; color: var(--muted); }
#pop .pick { margin-top: 8px; padding: 8px; border-radius: 10px; background: var(--surface-2); }
#pop .pick p { margin: 0 0 6px; font-size: 12px; color: var(--muted); }
#pop .pick [role=listbox] { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#pop .pick [role=option] { display: flex; align-items: center; gap: 7px; padding: 7px 8px; border-radius: 7px; font-size: 12.5px; text-align: left; border: 1px solid transparent; }
#pop .pick [role=option]:hover, #pop .pick [role=option]:focus-visible { border-color: var(--accent); outline: none; background: rgba(0, 0, 0, 0.2); }
#pop .foot { display: flex; gap: 14px; margin-top: 10px; }
@media (max-width: 599px) {
  #pop { left: var(--gap); right: var(--gap); width: auto; max-height: 52%; }
  #pop dl { grid-template-columns: auto minmax(0, 1fr) auto minmax(0, 1fr); }
  #pop .ops kbd { display: none; }
}
`);

const OPS = [['plant', 'Plant', 'P'], ['irrigate', 'Irrigate', 'I'], ['spray', 'Spray', 'X'], ['harvest', 'Harvest', 'H']];
const PAST = { plant: 'planted', irrigate: 'irrigated', spray: 'sprayed', harvest: 'harvested' };

export function createPopover(ctx) {
  const S = ctx.S;
  const el = h('aside', { id: 'pop', class: 'panel hidden scroll', role: 'dialog', 'aria-label': 'Field' });
  document.getElementById('hud').appendChild(el);
  let id = null, picking = false;
  function open(fid, opts = {}) {
    if (!fid) return close();
    if (fid !== id) picking = false;
    id = fid; if (opts.pickCrop) picking = true;
    el.classList.remove('hidden');
    document.getElementById('app').classList.add('pop-open');
    render();
  }
  function close() {
    if (!id && el.classList.contains('hidden')) return;
    id = null; picking = false; el.classList.add('hidden');
    document.getElementById('app').classList.remove('pop-open');
    ctx.onPopoverClose();
  }
  function render() {
    if (!id || !S.farm || !S.state) return;
    const f = ctx.fieldOf(id), fs = S.state.fields[id];
    if (!f || !fs) return close();
    const src = fs.crop_source || (fs.crop === 'unknown' ? 'none' : 'cdl');
    const ww = waterWords(fs);
    el.textContent = '';
    el.append(h('div', { class: 'ph' }, h('h3', { text: 'Field ' + (fs.name || f.name) }), h('button', { class: 'x sm', 'aria-label': 'Close', text: '×', onclick: () => { ctx.sfx('ui'); close(); } })));
    el.append(h('div', { class: 'crop' }, h('i', { class: 'sw', style: 'background:' + (CROP_COLORS[fs.crop] || CROP_COLORS.other) }), h('b', { text: cropLabel(fs.crop) }), h('span', { class: 'badge ' + src, title: 'Crop source', text: SOURCE_BADGE[src] || src }), h('span', { class: 'area', text: '· ' + fmt(f.area_ha) + ' ha' })));
    const stage = fs.harvested ? 'harvested' + (fs.harvest_date ? ' ' + dateLabel(fs.harvest_date, false) : '') : fs.planted ? stageLabel(fs.stage) : 'not planted';
    const nd = ctx.ndviRows(id), rows = nd || [], last = rows[rows.length - 1];
    el.append(h('dl', {},
      h('dt', { text: 'Stage' }), h('dd', { text: stage }),
      h('dt', { text: 'Water' }), h('dd', { class: ww.level, text: ww.text }),
      h('dt', { text: 'Est. yield' }), h('dd', { text: fs.planted ? fmt(fs.yield_est_t_ha, 1) + ' t/ha' : '–' }),
      h('dt', { text: 'NDVI' }), h('dd', { text: last ? fmt(last.ndvi, 2) + ' · ' + dateLabel(last.date, false) : nd ? 'no clear scene' : 'loading…' })));
    const spark = chartFig('NDVI sparkline', 0, 'Sentinel-2 NDVI, last 120 days', 'spark');
    el.append(spark.fig);
    if ((fs.alerts || []).length) el.append(h('div', { class: 'alerts', text: fs.alerts.join(' · ') }));
    const rec = ctx.recommendedOp(id);
    const state = (op) => (op === 'plant' ? (fs.planted || fs.harvested ? 'done' : 'open') : op === 'harvest' ? (fs.harvested ? 'done' : fs.planted ? 'open' : 'locked') : fs.planted && !fs.harvested ? 'open' : 'locked');
    const openOps = OPS.filter(([op]) => state(op) === 'open').map(([op]) => op);
    const next = openOps.includes(rec) ? rec : openOps[0];
    const ops = h('div', { class: 'ops', role: 'group', 'aria-label': 'Field operations' });
    OPS.forEach(([op, label, key], i) => {
      const st = state(op), cls = st === 'done' ? ' done' : op === next ? ' next' : '';
      const b = h('button', { class: 'step' + cls, title: label + ' (' + key + ')', onclick: () => onOp(op) }, h('i', { text: st === 'done' ? '✓' : String(i + 1) }), h('span', { text: label }), h('kbd', { text: key }));
      b.disabled = st !== 'open' || !!S.busy; ops.append(b);
    });
    el.append(ops);
    if (fs.last_op && fs.last_op.op) el.append(h('p', { class: 'lastop', text: 'Last: ' + (PAST[fs.last_op.op] || fs.last_op.op) + (fs.last_op.date ? ' ' + dateLabel(fs.last_op.date, false) : '') + (fs.last_op.amount_mm ? ', ' + fmt(fs.last_op.amount_mm) + ' mm' : '') }));
    if (picking && !fs.planted) {
      const lb = h('div', { role: 'listbox', 'aria-label': 'Crop to plant' });
      for (const c of PLANTABLE) lb.append(h('button', { role: 'option', 'aria-selected': 'false', onclick: () => { picking = false; ctx.act('plant', id, { crop: c }); } }, h('i', { class: 'sw', style: 'background:' + CROP_COLORS[c] }), h('span', { text: ctx.cropLabel(c) })));
      lb.addEventListener('keydown', (e) => { const o = [...lb.children], k = o.indexOf(document.activeElement); if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { o[(k + 1) % o.length].focus(); e.preventDefault(); } if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { o[(k - 1 + o.length) % o.length].focus(); e.preventDefault(); } });
      el.append(h('div', { class: 'pick' }, h('p', { text: 'No crop map here. What do you plant?' }), lb));
      requestAnimationFrame(() => { const o = lb.querySelector('[role=option]'); if (o) o.focus(); });
    }
    el.append(h('div', { class: 'foot' }, h('button', { class: 'link', text: 'Crop history', onclick: () => ctx.openDrawer('crops') }), h('button', { class: 'link', text: 'Water chart', onclick: () => ctx.openDrawer('water') })));
    requestAnimationFrame(() => sparkline(spark.cv, rows, { min: 0, max: 1, marker: fs.plant_date, empty: nd ? 'no clear scenes' : 'loading Sentinel-2…' }));
  }
  function onOp(op) {
    const fs = S.state.fields[id];
    if (op === 'plant' && fs && ['unknown', 'other', 'fallow'].includes(fs.crop)) { picking = !picking; ctx.sfx('ui'); render(); return; }
    ctx.act(op, id);
  }
  return { open, close, refresh: () => { if (id) render(); }, isOpen: () => !!id };
}
