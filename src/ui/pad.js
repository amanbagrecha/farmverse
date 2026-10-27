// Touch pad for phones and tablets: a four-way drive pad (game.setInput, arrow-key fallback) and one round Action button.
import { h, css } from './util.js';

css('pad', `
#pad { position: absolute; left: 0; right: 0; bottom: 0; height: calc(150px + var(--sb)); padding: 0 calc(16px + var(--sr)) calc(12px + var(--sb)) calc(16px + var(--sl)); display: flex; align-items: center; justify-content: space-between; pointer-events: none; z-index: 15; }
#pad > * { pointer-events: auto; }
#pad .joy { position: relative; width: 128px; height: 128px; border-radius: 50%; background: rgba(20, 27, 18, 0.72); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: var(--shadow); touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
#pad .joy i { position: absolute; width: 0; height: 0; border: 9px solid transparent; opacity: 0.7; }
#pad .joy i.u { left: 55px; top: 12px; border-bottom: 12px solid var(--ink); border-top: 0; }
#pad .joy i.d { left: 55px; bottom: 12px; border-top: 12px solid var(--ink); border-bottom: 0; }
#pad .joy i.l { top: 55px; left: 12px; border-right: 12px solid var(--ink); border-left: 0; }
#pad .joy i.r { top: 55px; right: 12px; border-left: 12px solid var(--ink); border-right: 0; }
#pad .joy i.on { opacity: 1; border-bottom-color: var(--accent); border-top-color: transparent; }
#pad .joy i.d.on { border-top-color: var(--accent); border-bottom-color: transparent; }
#pad .joy i.l.on { border-right-color: var(--accent); border-left-color: transparent; border-top-color: transparent; border-bottom-color: transparent; }
#pad .joy i.r.on { border-left-color: var(--accent); border-right-color: transparent; border-top-color: transparent; border-bottom-color: transparent; }
#pad .joy b { position: absolute; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: rgba(255, 255, 255, 0.14); border: 1px solid rgba(255, 255, 255, 0.2); transition: transform 0.08s; }
#pad .act { width: 84px; height: 84px; border-radius: 50%; background: var(--accent); color: var(--on-accent); font: 700 13px/1.1 var(--sans); box-shadow: var(--shadow), inset 0 -4px 0 rgba(0, 0, 0, 0.18); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; touch-action: manipulation; -webkit-user-select: none; user-select: none; padding: 0 6px; text-align: center; }
#pad .act:active { transform: translateY(2px); box-shadow: var(--shadow), inset 0 -2px 0 rgba(0, 0, 0, 0.18); }
#pad .act small { font-size: 10px; font-weight: 600; opacity: 0.8; max-width: 72px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`);

const KEYS = { l: 'ArrowLeft', r: 'ArrowRight', u: 'ArrowUp', d: 'ArrowDown' };

export function createPad(ctx) {
  const joy = h('div', { class: 'joy', role: 'group', 'aria-label': 'Drive the tractor' }, h('i', { class: 'u' }), h('i', { class: 'd' }), h('i', { class: 'l' }), h('i', { class: 'r' }), h('b'));
  const act = h('button', { class: 'act', 'aria-label': 'Action' }, h('span', { text: 'Action' }), h('small', { text: '' }));
  const el = h('div', { id: 'pad', class: 'hud hidden' }, joy, act);
  document.getElementById('app').appendChild(el);
  let pid = null, held = new Set();
  function send(dx, dy) {
    const g = ctx.game;
    if (typeof g.setInput === 'function') { try { g.setInput(dx || dy ? { dx, dy, fast: false } : null); } catch (e) {} }
    else {
      const want = new Set(); if (dx < 0) want.add('l'); if (dx > 0) want.add('r'); if (dy < 0) want.add('u'); if (dy > 0) want.add('d');
      for (const k of held) if (!want.has(k)) window.dispatchEvent(new KeyboardEvent('keyup', { key: KEYS[k], bubbles: true }));
      for (const k of want) if (!held.has(k)) window.dispatchEvent(new KeyboardEvent('keydown', { key: KEYS[k], bubbles: true }));
      held = want;
    }
    for (const i of joy.querySelectorAll('i')) i.classList.toggle('on', (i.classList.contains('l') && dx < 0) || (i.classList.contains('r') && dx > 0) || (i.classList.contains('u') && dy < 0) || (i.classList.contains('d') && dy > 0));
  }
  function at(e) {
    const r = joy.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2), rad = r.width / 2;
    const nx = Math.max(-1, Math.min(1, x / rad)), ny = Math.max(-1, Math.min(1, y / rad));
    joy.querySelector('b').style.transform = 'translate(' + nx * 30 + 'px,' + ny * 30 + 'px)';
    send(Math.abs(nx) > 0.3 ? Math.sign(nx) : 0, Math.abs(ny) > 0.3 ? Math.sign(ny) : 0);
  }
  joy.addEventListener('pointerdown', (e) => { pid = e.pointerId; try { joy.setPointerCapture(pid); } catch (err) {} ctx.userInput(); at(e); e.preventDefault(); });
  joy.addEventListener('pointermove', (e) => { if (e.pointerId === pid) at(e); });
  const end = (e) => { if (e.pointerId !== pid) return; pid = null; joy.querySelector('b').style.transform = ''; send(0, 0); };
  joy.addEventListener('pointerup', end); joy.addEventListener('pointercancel', end); joy.addEventListener('lostpointercapture', end);
  act.addEventListener('click', () => { ctx.userInput(); ctx.padAction(); });
  function show(on) { el.classList.toggle('hidden', !on); document.getElementById('app').classList.toggle('touch', on); }
  function label(main, sub) { act.firstElementChild.textContent = main; act.lastElementChild.textContent = sub || ''; }
  return { show, label, el };
}
