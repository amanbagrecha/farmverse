import { $, h, css, dateLabel, shiftDate } from './util.js';

const MS_DAY = 86400000;
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const REACH = 60;

function parse(s) {
  if (!s) return null;
  const [y, m, d] = String(s).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}
function iso(d) { return d.toISOString().slice(0, 10); }

function daysBetween(a, b) {
  const da = parse(a), db = parse(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / MS_DAY);
}

function monthsSpanning(startDate, endDate) {
  const s = parse(startDate); if (!s) return [];
  const e = parse(endDate) || s;
  const last = e < s ? s : e;
  const out = [];
  let y = s.getUTCFullYear(), m = s.getUTCMonth();
  const ly = last.getUTCFullYear(), lm = last.getUTCMonth();
  while (y < ly || (y === ly && m <= lm)) {
    const n = new Date(Date.UTC(y, m + 1, 0)).getUTCDate(), days = [];
    for (let d = 1; d <= n; d++) days.push(iso(new Date(Date.UTC(y, m, d))));
    out.push({ year: y, month: m + 1, days });
    m++; if (m > 11) { m = 0; y++; }
  }
  return out;
}

function seasonLabel(state) {
  if (!state || !state.day) return '';
  const start = state.start_date || state.day;
  const idx = state.day_index != null ? state.day_index : daysBetween(start, state.day);
  const year = String(start).slice(0, 4);
  return 'Day ' + idx + ' of the ' + year + ' season · started ' + dateLabel(start, false);
}

function jumpTitle(from, to) {
  const n = daysBetween(from, to);
  if (n < 0) return 'Go back to ' + dateLabel(to, false) + ': rewinds ' + -n + (n === -1 ? ' day' : ' days') + ', moves after it are undone';
  return 'Jump to ' + dateLabel(to, false) + ': advance ' + n + (n === 1 ? ' day' : ' days');
}

function lastWeatherDate(weather) {
  if (!weather) return null;
  let hist = null;
  for (const d of weather.history || []) if (d && d.date && (!hist || d.date > hist)) hist = d.date;
  let last = hist;
  for (const d of weather.forecast || []) {
    if (!d || !d.date) continue;
    if (hist && (daysBetween(hist, d.date) > 8 || d.date < hist)) continue;
    if (!last || d.date > last) last = d.date;
  }
  return last;
}

css('calendar', `
#cal { position: absolute; z-index: 36; right: calc(var(--gap) + var(--sr)); top: calc(var(--wx-bottom) + 6px); width: 340px; max-width: calc(100vw - 24px);
  max-height: calc(100% - var(--wx-bottom) - 20px - var(--sb) - var(--pad-h)); display: flex; flex-direction: column; animation: fv-pop 0.2s ease-out; background: var(--surface); }
#cal:focus { outline: none; }
#cal .ch { flex: none; padding: 12px 14px 8px; border-bottom: 1px solid var(--hair); }
#cal .ch b { display: block; font: 700 19px/1.15 var(--sans); letter-spacing: -0.3px; }
#cal .ch small { display: block; margin-top: 3px; color: var(--muted); font-size: 11.5px; line-height: 1.4; }
#cal .ch .note { margin-top: 4px; color: var(--faint); font-size: 11.5px; line-height: 1.4; }
#cal .months { flex: 1 1 auto; min-height: 0; padding: 6px 10px 8px; }
#cal .mo { padding: 6px 0 4px; }
#cal .mo h4 { margin: 0 0 4px 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: var(--muted); display: flex; align-items: center; gap: 8px; }
#cal .mo h4 > span { flex: 1 1 auto; min-width: 0; }
#cal .mo h4 em { font-style: normal; font-weight: 500; letter-spacing: 0; text-transform: none; color: var(--faint); }
#cal .mo h4 button { flex: none; width: 26px; height: 26px; border-radius: 7px; display: grid; place-items: center; color: var(--muted); font-size: 15px; line-height: 1; }
#cal .mo h4 button:hover:not([disabled]) { background: var(--surface-2); color: var(--ink); }
#cal .mo h4 button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
#cal .mo h4 button[disabled] { opacity: 0.3; cursor: default; }
#cal .grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px 1px; }
#cal .wd { text-align: center; font-size: 10px; font-weight: 600; color: var(--faint); padding-bottom: 2px; }
#cal .d { position: relative; height: 30px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ink); min-width: 0; }
#cal .d.pre { color: var(--faint); opacity: 0.45; }
#cal .d.played { color: var(--muted); }
#cal .d.played.jump:hover { color: var(--ink); }
#cal .d.played::after { content: ""; position: absolute; left: 50%; bottom: 4px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--accent-2); opacity: 0.75; }
#cal .d.today { background: var(--accent); color: var(--on-accent); font-weight: 700; }
#cal .d.jump { cursor: pointer; }
#cal .d.jump:hover { background: var(--surface-2); }
#cal .d.jump:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
#cal .d.nowx { color: var(--faint); }
#cal .d.nowx.jump::before { content: ""; position: absolute; inset: 3px; border: 1px dashed var(--hair); border-radius: 7px; pointer-events: none; }
#cal .d.far { color: var(--faint); opacity: 0.4; }
#cal .d i { position: absolute; left: 50%; bottom: 4px; width: 4px; height: 4px; margin-left: -2px; border-radius: 50%; background: var(--water); }
#cal .d.today i { background: var(--on-accent); opacity: 0.8; }
#cal .d[disabled] { cursor: default; opacity: 0.45; }
#cal .legend { display: flex; flex-wrap: wrap; gap: 4px 12px; padding: 6px 4px 2px; font-size: 10.5px; color: var(--faint); line-height: 1.5; }
#cal .legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#cal .legend i { width: 8px; height: 8px; border-radius: 50%; flex: none; }
#cal .legend i.k-today { background: var(--accent); } #cal .legend i.k-played { background: var(--accent-2); opacity: 0.75; width: 5px; height: 5px; margin: 0 1.5px; }
#cal .legend i.k-rain { background: var(--water); width: 5px; height: 5px; margin: 0 1.5px; } #cal .legend i.k-nowx { border: 1px dashed var(--faint); border-radius: 2px; }
#cal .empty { padding: 18px 14px; color: var(--muted); font-size: 12.5px; }
@media (max-width: 599px) {
  #cal { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-width: none; max-height: 76%; border-radius: 16px 16px 0 0; background: var(--surface); animation: fv-rise 0.25s ease-out; }
  #cal .ch { padding: 12px 14px 8px; }
  #cal .d { height: 34px; }
}
`);

export function createCalendar(ctx) {
  const S = ctx.S;
  let el = null, view = null;

  function setExpanded(on) { const b = $('day-btn'); if (b) b.setAttribute('aria-expanded', String(on)); }

  const canRewind = () => typeof ctx.rewind === 'function';
  function jump(days) {
    if (S.busy || !S.state || !days) return;
    if (days < 0 && !canRewind()) return;
    ctx.sfx('ui');
    if (days < 0) ctx.rewind(-days); else ctx.advance(days);
    close();
  }

  function render() {
    if (!el) return;
    const st = S.state;
    el.textContent = '';
    if (!st || !st.day) { el.appendChild(h('div', { class: 'empty', text: 'The season is still loading.' })); return; }
    const today = st.day, start = st.start_date || today, busy = !!S.busy;
    const lastWx = lastWeatherDate(S.weather), reach = shiftDate(today, REACH), endDate = lastWx && lastWx > reach ? lastWx : reach;
    if (!S.weather) armWeatherPoll();
    const source = 'real weather for this ground';
    el.appendChild(h('div', { class: 'ch' },
      h('b', { text: dateLabel(today, true) }),
      h('small', { text: seasonLabel(st) + ' · ' + source }),
      h('div', { class: 'note', text: canRewind() ? 'Time runs both ways: jump ahead, or go back and replay a decision (later moves are undone).' : 'Time only runs forward. Pick a later day to jump there.' })));
    const months = h('div', { class: 'months scroll' });
    let anyNoWx = false;
    const all = monthsSpanning(start, endDate), at = all.findIndex((m) => m.days.includes(today));
    if (view == null || view < 0 || view >= all.length) view = at < 0 ? all.length - 1 : at;
    const mo = all[view];
    if (mo) {
      const first = parse(mo.days[0]), box = h('div', { class: 'mo' });
      const played = mo.days.filter((d) => d >= start && d < today).length;
      const hint = mo.days.includes(today) ? 'this month' : played ? played + (played === 1 ? ' day' : ' days') + ' played' : mo.days[mo.days.length - 1] < start ? '' : 'ahead';
      const step = (n) => { view += n; render(); const b = el && el.querySelector('.mo h4 button:' + (n < 0 ? 'first-of-type' : 'last-of-type')); try { (b && !b.disabled ? b : el).focus({ preventScroll: true }); } catch (e) {} };
      box.appendChild(h('h4', {}, h('span', { text: MONTH[mo.month - 1] + ' ' + mo.year }), h('em', { text: hint }),
        h('button', { type: 'button', text: '‹', 'aria-label': 'Previous month', disabled: view <= 0, onclick: () => step(-1) }),
        h('button', { type: 'button', text: '›', 'aria-label': 'Next month', disabled: view >= all.length - 1, onclick: () => step(1) })));
      const grid = h('div', { class: 'grid', role: 'grid' });
      for (const w of WEEKDAY) grid.appendChild(h('div', { class: 'wd', 'aria-hidden': 'true', text: w }));
      for (let i = 0; i < first.getUTCDay(); i++) grid.appendChild(h('div'));
      for (const day of mo.days) {
        const n = +day.slice(8, 10), diff = daysBetween(today, day);
        let cell;
        if (day < start) cell = h('div', { class: 'd pre', text: n, title: dateLabel(day, false) + ': before the season started' });
        else if (day < today) {
          const back = day > start && canRewind();
          cell = back ? h('button', { class: 'd played jump', type: 'button', text: n, title: jumpTitle(today, day), disabled: busy, onclick: () => jump(diff) })
            : h('div', { class: 'd played', text: n, title: dateLabel(day, false) + ': played, day ' + daysBetween(start, day) });
        }
        else if (day === today) cell = h('div', { class: 'd today', text: n, 'aria-current': 'date', title: dateLabel(day, false) + ': today' });
        else {
          const hasWx = !lastWx || day <= lastWx;
          if (!hasWx) anyNoWx = true;
          if (hasWx || diff <= REACH) cell = h('button', { class: 'd jump' + (hasWx ? '' : ' nowx'), type: 'button', text: n, title: jumpTitle(today, day) + (hasWx ? '' : ' · no weather data, the sim repeats the last week'), disabled: busy, onclick: () => jump(diff) });
          else cell = h('div', { class: 'd far', text: n, title: dateLabel(day, false) + ': too far ahead, jump at most ' + REACH + ' days at a time' });
        }
        if (day > today) { const w = ctx.dayWeather(day); if (w && (+w.precip || 0) >= 1) cell.appendChild(h('i', { 'aria-hidden': 'true' })); }
        grid.appendChild(cell);
      }
      box.appendChild(grid);
      months.appendChild(box);
    }
    const legend = h('div', { class: 'legend' },
      h('span', {}, h('i', { class: 'k-today' }), 'today'),
      h('span', {}, h('i', { class: 'k-played' }), 'played'),
      h('span', {}, h('i', { class: 'k-rain' }), 'rain ≥ 1 mm'));
    if (anyNoWx) legend.appendChild(h('span', {}, h('i', { class: 'k-nowx' }), 'no weather data, the sim repeats the last week'));
    months.appendChild(legend);
    el.appendChild(months);
  }

  let poll = 0, polls = 0;
  function armWeatherPoll() {
    if (poll || polls > 40) return;
    poll = setTimeout(() => { poll = 0; polls++; if (el && !S.weather) armWeatherPoll(); else if (el) render(); }, 750);
  }

  function open() {
    if (el) { render(); return; }
    view = null;
    el = h('div', { id: 'cal', class: 'panel', role: 'dialog', 'aria-label': 'Season calendar', tabindex: '-1' });
    const hud = $('hud'); if (!hud) { el = null; return; }
    hud.appendChild(el);
    render();
    setExpanded(true);
    ctx.writeParam('cal', 'open');
    try { el.focus({ preventScroll: true }); } catch (e) {}
  }
  function close() {
    if (!el) return;
    const inside = el.contains(document.activeElement);
    el.remove(); el = null; view = null;
    setExpanded(false);
    ctx.writeParam('cal', '');
    const b = $('day-btn'); if (inside && b) try { b.focus({ preventScroll: true }); } catch (e) {}
  }
  document.addEventListener('pointerdown', (e) => { if (el && !el.contains(e.target) && !(e.target.closest && e.target.closest('#dayctl'))) close(); });
  return { open, close, toggle: () => (el ? close() : open()), isOpen: () => !!el, refresh: () => { if (el) render(); } };
}
