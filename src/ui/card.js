// Action card: exactly one recommended move (tour step or next action) with one big button and one-line reason.
import { $, h, css } from './util.js';

css('card', `
#card { width: 100%; max-width: 820px; min-height: 48px; padding: 5px 8px 5px 14px; display: flex; align-items: center; gap: 10px; min-width: 0; }
#card.anim { animation: fv-rise 0.35s ease-out; }
#card:empty { display: none; }
#card .ck { flex: none; font-size: 10px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: var(--accent); white-space: nowrap; }
#card .ct { flex: 0 1 auto; min-width: 60px; max-width: 46%; font: 700 14px/1.2 var(--sans); letter-spacing: -0.2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#card .cw { flex: 1 1 0; min-width: 32px; font-size: 12.5px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#card .go { height: 36px; padding: 0 14px; font-size: 13.5px; border-radius: 10px; flex: none; max-width: 240px; white-space: nowrap; }
#card .go span { overflow: hidden; text-overflow: ellipsis; }
#card .cl { flex: none; display: flex; align-items: center; gap: 10px; }
#card .cl .link { white-space: nowrap; font-size: 11.5px; }
#card .cl .link.dots { font-size: 15px; line-height: 1; text-decoration: none; padding: 0 2px; letter-spacing: 1px; }
#app.lit-card #cardwrap { z-index: 31; }
@media (max-width: 859px) { #card { width: auto; } #card .cw { display: none; } #card .ct { max-width: none; flex: 0 1 auto; } }
@media (max-width: 699px) { #card .ck { display: none; } }
@media (max-width: 599px) {
  #card { padding: 5px 6px 5px 12px; gap: 8px; }
  #card .ck, #card .cl { display: none; }
  #card .go { height: 36px; padding: 0 12px; font-size: 13px; }
  #card .go kbd { display: none; }
  #app.pop-open #cardwrap { display: none; }
}
`);

export function createCard(ctx) {
  const wrap = $('cardwrap');
  const el = h('section', { id: 'card', class: 'panel', 'aria-live': 'polite' });
  wrap.appendChild(el);
  let cur = null, sig = '';
  function quiet(link) {
    if (!link) return null;
    const alt = /^what else\?/i.test(link.label || '');
    return h('button', { class: 'link' + (alt ? ' dots' : ''), text: alt ? '…' : link.label, title: alt ? link.label.replace(/^what else\?\s*/i, '') : null, 'aria-label': alt ? link.label : null, onclick: () => { ctx.sfx('ui'); link.run(); } });
  }
  function show(spec) {
    cur = spec;
    const s = [spec.kicker, spec.title, spec.why, spec.label, spec.more && spec.more.label, spec.skip && spec.skip.label].join('|');
    if (s === sig) { const b = el.querySelector('.go'); if (b) b.disabled = !!ctx.S.busy || !!spec.disabled; return; }
    sig = s;
    el.textContent = '';
    el.append(h('span', { class: 'ck', text: spec.kicker || 'Next move' }));
    el.append(h('b', { class: 'ct', text: spec.title, title: spec.title }));
    if (spec.why) el.append(h('span', { class: 'cw', text: spec.why, title: spec.why }));
    const go = h('button', { class: 'btn primary go', onclick: () => run() }, h('span', { text: spec.label || 'Go' }), spec.key ? h('kbd', { text: spec.key }) : null);
    go.disabled = !!ctx.S.busy || !!spec.disabled;
    el.append(go);
    if (spec.more || spec.skip) el.append(h('span', { class: 'cl' }, quiet(spec.more), quiet(spec.skip)));
    el.classList.remove('anim'); void el.offsetWidth; el.classList.add('anim');
  }
  async function run() {
    if (!cur || ctx.S.busy) return;
    ctx.sfx('ui');
    try { await cur.run(); } catch (e) { console.warn('card action', e); }
  }
  function setBusy(b) { const go = el.querySelector('.go'); if (go) go.disabled = b || !!(cur && cur.disabled); }
  return { show, run, setBusy, el, current: () => cur };
}
