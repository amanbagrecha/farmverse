// Farm menu from the chip: new farm, calendar, map, data, tour, sound, restart season, missions and a shortcuts panel.
import { h, css, fmt } from './util.js';

css('menu', `
#menu { position: absolute; z-index: 46; left: calc(var(--gap) + var(--sl)); top: calc(var(--gap) + var(--st) + 52px); width: 260px; max-height: calc(100% - 90px - var(--st)); padding: 4px; animation: fv-pop 0.2s ease-out; }
#menu .mh { padding: 7px 10px 6px; }
#menu .mh b { display: block; font: 700 14px/1.25 var(--sans); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#menu .mh small { display: block; color: var(--muted); font-size: 11.5px; line-height: 1.35; margin-top: 1px; }
#menu [role=menuitem] { display: flex; align-items: center; gap: 8px; width: 100%; height: 32px; padding: 7px 10px; border-radius: 8px; text-align: left; font-size: 13px; }
#menu [role=menuitem]:hover, #menu [role=menuitem]:focus-visible { background: var(--surface-2); outline: none; }
#menu [role=menuitem] span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#menu [role=menuitem] em { font-style: normal; color: var(--muted); font-size: 11.5px; }
#menu [role=menuitem] kbd { opacity: 0.7; }
#menu hr { border: 0; border-top: 1px solid var(--hair); margin: 3px 6px; }
#menu .ms { display: grid; grid-template-columns: 14px minmax(0, 1fr); gap: 6px; padding: 4px 10px 4px 20px; font-size: 12px; }
#menu .ms i { font-style: normal; color: var(--faint); }
#menu .ms.done i { color: var(--accent-2); }
#menu .ms small { display: block; color: var(--muted); font-size: 11px; }
#keys { position: absolute; z-index: 47; left: calc(var(--gap) + var(--sl)); top: calc(var(--gap) + var(--st) + 52px); width: 300px; padding: 10px 12px 12px; animation: fv-pop 0.2s ease-out; }
#keys .kh { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
#keys .kh b { flex: 1; font: 700 13px/1.2 var(--sans); }
#keys .kg { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 14px; font-size: 12px; }
#keys .kg div { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-width: 0; height: 24px; }
#keys .kg span { color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#keys .kg kbd { flex: none; }
@media (max-width: 599px) {
  #menu, #keys { left: 0; right: 0; top: auto; bottom: 0; width: auto; max-height: 78%; border-radius: 16px 16px 0 0; padding-bottom: calc(8px + var(--sb)); animation: fv-rise 0.25s ease-out; }
}
`);

const KEYS = [['← → ↑ ↓', 'Drive (WASD too)'], ['Shift', 'Drive fast'], ['P', 'Plant'], ['I', 'Irrigate'], ['X', 'Spray'], ['H', 'Harvest'], ['Enter', 'Next day'], ['1', 'Farm view'], ['2', 'Data drawer'], ['C', 'Season calendar'], ['M', 'Satellite map'], ['B', 'Satellite ground'], ['+ −', 'Zoom (wheel too)'], ['?', 'Shortcuts'], ['Esc', 'Close panel']];

export function createMenu(ctx) {
  const S = ctx.S;
  let el = null, keys = null, missionsOpen = false;
  function closeMenu() { if (!el) return; el.remove(); el = null; document.getElementById('chip').setAttribute('aria-expanded', 'false'); }
  function closeKeys() { if (!keys) return; keys.remove(); keys = null; }
  function close() { closeMenu(); closeKeys(); }
  function item(label, hint, run, extra) { return h('button', { role: 'menuitem', ...(extra || {}), onclick: () => { ctx.sfx('ui'); run(); } }, h('span', { text: label }), hint ? h('kbd', { text: hint }) : null); }
  function action(label, hint, run) { return item(label, hint, () => { close(); run(); }); }
  function openKeys() {
    closeMenu(); if (keys) return;
    keys = h('section', { id: 'keys', class: 'panel', role: 'dialog', 'aria-label': 'Keyboard shortcuts' });
    keys.append(h('div', { class: 'kh' }, h('b', { text: 'Keyboard shortcuts' }), h('button', { class: 'x sm', 'aria-label': 'Close', text: '×', onclick: () => { ctx.sfx('ui'); closeKeys(); } })));
    const g = h('div', { class: 'kg' });
    for (const [k, what] of KEYS) g.append(h('div', {}, h('span', { text: what }), h('kbd', { text: k })));
    keys.append(g);
    document.getElementById('hud').appendChild(keys);
    const x = keys.querySelector('.x'); if (x) x.focus({ preventScroll: true });
  }
  function missionsBlock() {
    const box = h('div', { class: 'msl' });
    for (const m of (S.state && S.state.missions) || []) box.append(h('div', { class: 'ms' + (m.done ? ' done' : '') }, h('i', { text: m.done ? '✓' : m.failed ? '✕' : '○' }), h('div', {}, h('span', { text: m.title }), h('small', { text: m.done ? 'Done' : m.failed ? 'Missed' : m.hint || '' }))));
    return box;
  }
  function open() {
    close();
    el = h('nav', { id: 'menu', class: 'panel scroll', role: 'menu', 'aria-label': 'Farm menu' });
    const st = S.state || {}, t = st.totals || {}, title = ctx.farmTitle();
    const sub = [(ctx.place() || {}).region || null, S.farm ? S.farm.fields.length + ' fields' : null, t.area_ha != null ? fmt(t.area_ha) + ' ha' : null].filter(Boolean).join(' · ');
    el.append(h('div', { class: 'mh' }, h('b', { text: title, title }), sub ? h('small', { text: sub, title: sub }) : null));
    const acct = ctx.account && ctx.account.menuBlock(close);
    if (acct) el.append(acct, h('hr'));
    el.append(action('New farm anywhere…', '', () => ctx.openPicker()));
    el.append(action('Season calendar', 'C', () => ctx.openCalendar()));
    el.append(action('Satellite map of this ground', 'M', () => ctx.openMap()));
    el.append(action('Data drawer', '2', () => ctx.openDrawer()));
    el.append(action(ctx.tour.active() ? 'Skip the tour' : 'Replay the guided tour', '', () => (ctx.tour.active() ? ctx.tour.skip() : ctx.tour.restart())));
    el.append(action('Sound', ctx.muted() ? 'off' : 'on', () => ctx.toggleMute()));
    el.append(action('Restart this season', '', () => ctx.resetSeason()));
    el.append(h('hr'));
    const ms = st.missions || [], done = ms.filter((m) => m.done).length;
    const list = missionsBlock(); list.hidden = !missionsOpen;
    const mi = item('Missions · ' + done + ' of ' + ms.length + ' done', missionsOpen ? '▴' : '▾', () => { missionsOpen = !missionsOpen; list.hidden = !missionsOpen; mi.querySelector('kbd').textContent = missionsOpen ? '▴' : '▾'; mi.setAttribute('aria-expanded', String(missionsOpen)); }, { 'aria-expanded': String(missionsOpen) });
    el.append(mi, list);
    el.append(action('Keyboard shortcuts', '?', () => openKeys()));
    document.getElementById('hud').appendChild(el);
    document.getElementById('chip').setAttribute('aria-expanded', 'true');
    const first = el.querySelector('[role=menuitem]'); if (first) first.focus({ preventScroll: true });
  }
  document.addEventListener('pointerdown', (e) => {
    if (el && !el.contains(e.target) && !e.target.closest('#chip')) closeMenu();
    if (keys && !keys.contains(e.target)) closeKeys();
  });
  window.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === '?') { e.preventDefault(); ctx.sfx('ui'); if (keys) closeKeys(); else openKeys(); }
  });
  return { open, close, toggle: () => (el ? close() : open()), isOpen: () => !!el || !!keys };
}
