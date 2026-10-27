import { $, h, css, toast, isPhone } from './util.js';

css('account', `
#signwrap { position: absolute; z-index: 62; left: calc(var(--gap) + var(--sl)); right: calc(var(--gap) + var(--sr)); top: calc(var(--wx-bottom) + 6px); display: flex; justify-content: center; pointer-events: none; }
#signin { display: flex; align-items: center; gap: 8px; min-width: 0; max-width: 100%; min-height: 44px; padding: 6px 6px 6px 14px; pointer-events: auto; animation: fv-pop 0.2s ease-out; }
#signin .sm { flex: 0 100 auto; min-width: 0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#signin .sm.note { color: var(--muted); }
#signin .btn { flex: none; height: 30px; padding: 0 12px; font-size: 12.5px; }
#app.signin-open #toasts { margin-top: 52px; }
#menu .run .seg { flex: none; flex-wrap: nowrap; background: var(--surface); }
#menu .acct { padding: 0 4px 2px 10px; }
#menu .run { display: flex; align-items: center; justify-content: space-between; gap: 8px; height: 32px; font-size: 13px; }
#menu .who { display: flex; align-items: center; gap: 7px; min-height: 22px; font-size: 12px; color: var(--muted); }
#menu .who .dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
#menu .who .dot.ok { background: var(--accent-2); }
#menu .who .dot.warn { background: var(--accent); }
#menu .who span { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#menu .who .link { flex: none; }
@media (max-width: 599px) {
  #signwrap { top: max(calc(var(--wx-bottom) + 6px), calc(var(--gap) + var(--st) + 100px)); }
  #signin { gap: 6px; padding: 5px 5px 5px 12px; }
  #signin .btn { padding: 0 10px; font-size: 12px; }
}
`);

const ASK = 'Sign in to Fused to load satellite data', NEED = 'Not signed in to Fused';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function inPreview() {
  try { let w = window; for (;;) { if (new URLSearchParams(w.location.search).get('_preview') === '1') return true; if (!w.parent || w.parent === w) return false; w = w.parent; } } catch (e) { return false; }
}
async function loginStatus() {
  const r = await fetch('/api/canvases/status', { cache: 'no-store' });
  if (!r.ok) throw new Error('status ' + r.status);
  return r.json();
}

export function createAccount(ctx) {
  const live = typeof window !== 'undefined' && !!(window.fused && typeof window.fused.runPython === 'function') && !inPreview();
  const S = { engine: 'fused', signedIn: null, email: null, handle: null, detail: '', localReady: true, busy: false, ready: false };
  const P = { open: false, wait: false, note: '' };
  let started = false, ready = Promise.resolve(), known = Promise.resolve(), pending = null, run = 0, view = null, wrap = null, msg = null, go = null, mac = null, quietUntil = 0;

  async function call(params) {
    const out = await window.fused.runPython('eo.py', params, { key: null });
    if (out && out.error) throw new Error(out.error);
    return out || {};
  }
  function applySettings(r, withSignIn) {
    if (r.engine === 'local' || r.engine === 'fused') S.engine = r.engine;
    if (withSignIn && typeof r.signed_in === 'boolean') S.signedIn = r.signed_in;
    if (typeof r.local_ready === 'boolean') S.localReady = r.local_ready;
  }
  function applyAccount(r) { S.signedIn = !!r.signed_in; S.email = r.email || null; S.handle = r.handle || null; S.detail = r.detail || ''; }
  const usable = () => S.engine === 'local' || S.signedIn !== false;
  const changed = () => { if (ctx.onAccount) ctx.onAccount(); };

  function init() {
    if (started || !live) return ready;
    started = true;
    let settled;
    known = new Promise((r) => { settled = r; });
    ready = (async () => {
      try { applySettings(await call({ action: 'settings' }), true); } catch (e) { console.warn('FarmVerse settings', e); }
      settled();
      try { applyAccount(await call({ action: 'account' })); } catch (e) { console.warn('FarmVerse account', e); }
      S.ready = true; paint();
    })();
    return ready;
  }
  async function refresh(force) {
    if (!live) return false;
    try { applyAccount(await call(force ? { action: 'account', refresh: '1' } : { action: 'account' })); paint(); return true; }
    catch (e) { console.warn('FarmVerse account', e); return false; }
  }

  function build() {
    msg = h('span', { class: 'sm' });
    go = h('button', { class: 'btn primary go', onclick: () => { ctx.sfx('ui'); startSignIn(); } });
    mac = h('button', { class: 'btn', title: 'Use this Mac', 'aria-label': 'Use this Mac', onclick: () => { ctx.sfx('ui'); setEngine('local'); } });
    const x = h('button', { class: 'x sm', 'aria-label': 'Dismiss', title: 'Dismiss', text: '×', onclick: () => { ctx.sfx('ui'); dismiss(); } });
    const box = h('section', { id: 'signin', class: 'panel', role: 'dialog', 'aria-label': 'Sign in to Fused', onkeydown: (e) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } } }, msg, go, mac, x);
    wrap = h('div', { id: 'signwrap' }, box);
  }
  function paintPrompt() {
    if (!wrap) return;
    const ph = isPhone(), text = P.note || (ph ? 'Satellite data needs Fused' : ASK), full = P.wait ? 'Waiting for the sign-in…' : 'Sign in to Fused';
    msg.textContent = text; msg.title = text; msg.classList.toggle('note', !!P.note);
    go.textContent = ph ? (P.wait ? 'Waiting…' : 'Sign in') : full; go.title = full; go.setAttribute('aria-label', full); go.disabled = P.wait;
    mac.textContent = ph ? 'This Mac' : 'Use this Mac';
  }
  function show(focus) {
    if (!live) return;
    if (!P.open) {
      P.open = true; P.wait = false; P.note = '';
      if (!wrap) build();
      const hud = $('hud'), app = $('app');
      if (hud) hud.appendChild(wrap);
      if (app) app.classList.add('signin-open');
    }
    paintPrompt();
    if (focus && !P.wait) go.focus({ preventScroll: true });
  }
  function hide() {
    if (!P.open) return;
    P.open = false; if (wrap) wrap.remove();
    const app = $('app'); if (app) app.classList.remove('signin-open');
  }
  function paint() { paintPrompt(); if (view) view.render(); }
  if (live) window.addEventListener('resize', paintPrompt);

  function ask() {
    if (!pending) { pending = {}; pending.p = new Promise((res, rej) => { pending.res = res; pending.rej = rej; }); }
    show(false);
    return pending.p;
  }
  async function gate() {
    await known;
    if (usable()) return;
    return ask();
  }
  function settle() {
    run++;
    if (pending) { const p = pending; pending = null; p.res(); }
    hide(); paint();
  }
  function dismiss() {
    run++; quietUntil = Date.now() + 20000;
    if (pending) { const p = pending; pending = null; p.rej(new Error(NEED)); }
    hide();
  }
  function openSignIn(o) {
    if (o && o.expired) { S.signedIn = false; paint(); if (Date.now() < quietUntil) return; }
    show(!(o && o.expired));
  }

  async function startSignIn() {
    if (P.wait) return;
    const dev = window.fused && window.fused.device;
    if (dev && dev !== 'desktop') { P.note = 'Sign in on the computer that runs FarmVerse.'; paintPrompt(); return; }
    const my = ++run;
    P.wait = true; P.note = ''; paintPrompt();
    try {
      const before = await loginStatus();
      const r = await fetch('/api/canvases/login', { method: 'POST', headers: { 'X-Fused': '1', 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error('login ' + r.status);
      if (my !== run) return;
      P.note = 'Finish the sign-in in your browser.'; paintPrompt();
      const t0 = Date.now();
      while (Date.now() - t0 < 600000) {
        await sleep(1500);
        if (my !== run) return;
        const st = await loginStatus();
        if (st.logged_in && st.creds_stamp !== before.creds_stamp) { await finish(my); return; }
        if (!st.login_in_flight) throw new Error('stopped');
      }
      throw new Error('timeout');
    } catch (e) {
      if (my !== run) return;
      console.warn('FarmVerse sign-in', e);
      P.wait = false; P.note = 'The sign-in did not finish. Try again.'; paintPrompt();
    }
  }
  async function finish(my) {
    const ok = await refresh(true);
    if (my !== run) return;
    if (ok && S.signedIn === false) throw new Error('not confirmed');
    S.signedIn = true;
    const who = S.email || S.handle;
    toast('Signed in to Fused' + (who ? ' as ' + who : ''), 'good');
    settle(); changed();
  }

  async function setEngine(v) {
    if (!live || S.busy || (v !== 'local' && v !== 'fused') || v === S.engine) return;
    const old = S.engine, warn = () => toast('This Mac needs its geo packages: open FarmVerse again so fused-render installs them', 'warn', 6000);
    S.busy = true; paint();
    try {
      if (v === 'local' && !S.localReady) applySettings(await call({ action: 'settings' }));
      if (v === 'local' && !S.localReady) { warn(); return; }
      applySettings(await call({ action: 'settings', engine: v }));
      if (v === 'local' && !S.localReady) { applySettings(await call({ action: 'settings', engine: old })); warn(); return; }
      toast(v === 'local' ? 'FarmVerse reads satellite data on this Mac' : 'FarmVerse reads satellite data on Fused');
      if (usable()) { settle(); changed(); } else show(true);
    } catch (e) { toast('Could not switch: ' + e.message, 'warn', 6000); }
    finally { S.busy = false; paint(); }
  }

  function menuBlock(done) {
    if (!live) return null;
    const pick = (label, v) => h('button', { 'aria-pressed': 'false', onclick: () => { ctx.sfx('ui'); setEngine(v); } }, label);
    const mac = pick('This Mac', 'local'), fu = pick('Fused', 'fused');
    const dot = h('i', { class: 'dot' }), name = h('span'), sign = h('button', { class: 'link', text: 'Sign in', onclick: () => { ctx.sfx('ui'); if (done) done(); openSignIn(); } });
    const root = h('div', { class: 'acct' }, h('div', { class: 'run' }, h('span', { text: 'Run on' }), h('div', { class: 'seg sm', role: 'group', 'aria-label': 'Run on' }, mac, fu)), h('div', { class: 'who' }, dot, name, sign));
    view = {
      render() {
        mac.setAttribute('aria-pressed', String(S.engine === 'local')); fu.setAttribute('aria-pressed', String(S.engine === 'fused'));
        mac.disabled = fu.disabled = S.busy;
        dot.className = 'dot' + (S.signedIn ? ' ok' : S.signedIn === false && S.engine === 'fused' ? ' warn' : '');
        name.textContent = S.signedIn ? S.email || S.handle || 'Signed in to Fused' : S.signedIn === false ? 'Not signed in' : S.ready ? 'Fused status unavailable' : 'Checking the Fused sign-in…';
        name.title = S.detail || name.textContent;
        sign.classList.toggle('hidden', S.signedIn !== false);
      },
    };
    view.render();
    return root;
  }

  return { init, gate, engine: () => S.engine, openSignIn, menuBlock };
}
