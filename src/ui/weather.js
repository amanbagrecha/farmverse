// Weather and time bar: today's weather, the date with +1/+7 day buttons, and the next 7 days behind a toggle.
import { $, h, css, fmt, wxKind, wxIcon, WX_WORD, isPhone, dayStrip } from './util.js';

css('weather', `
#wx { padding: 5px; max-width: calc(100vw - 24px); }
#wx .bar { display: flex; align-items: center; gap: 6px; }
#wx .now { display: flex; align-items: center; gap: 8px; height: 32px; padding: 0 8px 0 5px; border-radius: 9px; text-align: left; min-width: 0; }
#wx .now:hover, #wx.open .now { background: var(--surface-2); }
#wx .now:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#wx .now svg { flex: none; }
#wx .nt { min-width: 0; display: flex; flex-direction: column; }
#wx .nt b { font: 700 15px/1.1 var(--sans); letter-spacing: -0.3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
#wx .nt b small { font-size: 12px; font-weight: 600; color: var(--muted); }
#wx .nt span { font-size: 11px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#wx .caret { font-style: normal; font-size: 10px; color: var(--muted); flex: none; }
#dayctl { display: flex; align-items: center; gap: 2px; padding-left: 8px; border-left: 1px solid var(--hair); }
#dayctl .day { display: flex; flex-direction: column; justify-content: center; min-width: 0; height: 32px; padding: 0 8px; margin: 0 2px; border-radius: 9px; text-align: left; }
#dayctl .day:hover, #dayctl .day[aria-expanded="true"] { background: var(--surface-2); }
#dayctl .day:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#dayctl .day b { font: 700 13.5px/1.15 var(--sans); white-space: nowrap; letter-spacing: -0.2px; font-variant-numeric: tabular-nums; }
#dayctl .day span { font-size: 11px; color: var(--muted); white-space: nowrap; }
#dayctl .btn.chev { height: 30px; width: 26px; padding: 0; border-radius: 7px; font-size: 15px; font-weight: 700; line-height: 1; font-variant-numeric: tabular-nums; }
#dayctl .btn.chev[disabled] { opacity: 0.3; }
#wx .more { margin-top: 5px; padding: 7px 5px 2px; border-top: 1px solid var(--hair); }
#wx .nx { display: flex; justify-content: space-between; gap: 10px; font-size: 11.5px; color: var(--muted); white-space: nowrap; }
#wx .nx b { color: var(--ink); font-variant-numeric: tabular-nums; }
#wx .dh { margin: 8px 0 4px; display: flex; justify-content: space-between; font-size: 10.5px; letter-spacing: 0.6px; text-transform: uppercase; color: var(--faint); }
#wx .days > div:first-child { background: var(--surface-2); }
#wx .empty { font-size: 11.5px; color: var(--faint); padding: 6px 0 2px; }
@media (max-width: 859px) {
  #wx .nt b small, #wx .caret { display: none; }
  #wx .nt span { max-width: 72px; }
}
@media (max-width: 599px) {
  #wx { padding: 4px; }
  #wx .bar { gap: 5px; }
  #wx .now { gap: 6px; padding: 0 6px 0 3px; }
  #wx .nt span, #wx .nt b small, #wx .caret { display: none; }
  #dayctl { gap: 1px; padding-left: 5px; }
  #dayctl .day { padding: 0 5px; margin: 0 1px; }
  #dayctl .day b { font-size: 13px; } #dayctl .day span { display: none; }
  #dayctl .btn.chev { width: 22px; }
  #wx.open { left: calc(var(--gap) + var(--sl)); z-index: 35; }
}
`);

export function createWeather(ctx) {
  const root = $('wx'), now = $('wx-now'), more = $('wx-more');
  let open = ctx.readParam('wx', '') === 'open';
  function setOpen(on) {
    open = on;
    ctx.writeParam('wx', on ? 'open' : '');
    render();
  }
  now.addEventListener('click', () => { ctx.sfx('ui'); setOpen(!open); });
  document.addEventListener('pointerdown', (e) => { if (open && isPhone() && !root.contains(e.target)) setOpen(false); });
  function render() {
    root.classList.toggle('open', open);
    more.classList.toggle('hidden', !open);
    now.setAttribute('aria-expanded', String(open));
    const S = ctx.S, st = S.state; if (!st) return;
    const w = { ...(ctx.dayWeather(st.day) || {}), ...(st.weather_today || {}) };
    const kind = wxKind(w), days = ctx.nextDays(7), word = WX_WORD[kind] + (w.source === 'forecast' ? ' · forecast' : '');
    now.innerHTML = wxIcon(kind, isPhone() ? 26 : 28);
    now.append(
      h('span', { class: 'nt' }, h('b', { html: fmt(w.tmax) + '°<small> / ' + fmt(w.tmin) + '°</small>' }), h('span', { text: word })),
      h('i', { class: 'caret', 'aria-hidden': 'true', text: open ? '▴' : '▾' }));
    now.setAttribute('aria-label', 'Weather today: ' + word + ', ' + fmt(w.tmax) + '° / ' + fmt(w.tmin) + '°. ' + (open ? 'Hide' : 'Show') + ' the next 7 days');
    more.textContent = '';
    more.appendChild(h('div', { class: 'nx' }, h('span', { text: word }), h('span', {}, 'rain ', h('b', { text: fmt(w.precip, 1) + ' mm' }), ' · ET₀ ', h('b', { text: fmt(w.et0, 1) + ' mm' }))));
    more.appendChild(h('div', { class: 'dh' }, h('span', { text: 'Next 7 game days' })));
    more.appendChild(days.length ? dayStrip(days) : h('div', { class: 'empty', text: S.weather ? 'No weather beyond today' : 'Loading the weather…' }));
    requestAnimationFrame(() => ctx.layout());
  }
  return { render, el: root, close: () => { if (open) setOpen(false); }, toggle: () => setOpen(!open), isOpen: () => open };
}
