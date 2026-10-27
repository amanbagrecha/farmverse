// FarmVerse UI helpers: DOM, formatting, dates, crops, weather icons, toasts, hashing.
export const $ = (id) => document.getElementById(id);

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

export function css(id, text) {
  if (document.getElementById('css-' + id)) return;
  const s = document.createElement('style'); s.id = 'css-' + id; s.textContent = text; document.head.appendChild(s);
}

export function fmt(n, d = 0) { return n == null || isNaN(n) ? '–' : Number(n).toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d }); }
const D = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export function dateLabel(s, year = true) { if (!s) return '–'; return D(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }); }
function weekday(s) { return D(s).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }); }
export function shiftDate(s, days) { const d = D(s); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
export function weekEnd(s) { const n = Math.floor(D(s).getTime() / 86400000); return new Date(Math.floor(n / 7) * 7 * 86400000).toISOString().slice(0, 10); }
export function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
export function debounce(fn, ms) { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

export const PLANTABLE = ['corn', 'soybeans', 'winter_wheat', 'alfalfa', 'hay', 'pasture'];
const CROP_LABEL = { corn: 'Corn', soybeans: 'Soybeans', winter_wheat: 'Winter wheat', alfalfa: 'Alfalfa', hay: 'Hay', pasture: 'Pasture', fallow: 'Fallow', other: 'Other', unknown: 'Unknown crop' };
export const CROP_COLORS = { corn: '#e0b92f', soybeans: '#4fa64a', winter_wheat: '#b9814a', alfalfa: '#2f8a7a', hay: '#9db347', pasture: '#6f8f5c', fallow: '#8a7560', other: '#7c7f90', unknown: '#5d6658' };
export const SOURCE_BADGE = { cdl: 'CDL', aef: 'AlphaEarth', player: 'you', none: 'unknown' };
export const cropLabel = (c) => CROP_LABEL[c] || cap(String(c || 'unknown').replace(/_/g, ' '));
export const stageLabel = (s) => String(s || '–').replace(/_/g, ' ');

export function waterWords(fs) {
  if (!fs || fs.taw_mm == null) return { text: '–', level: '' };
  const sw = Math.round(fs.soil_water_mm), taw = Math.round(fs.taw_mm), dep = taw - sw, raw = fs.raw_mm ?? taw * 0.55;
  let word = 'comfortable', level = 'ok';
  if (sw >= taw - 1) word = 'full';
  else if ((fs.ks != null && fs.ks < 1) || dep > raw) { word = 'stressed'; level = 'warn'; }
  else if (dep > raw * 0.7) { word = 'drying'; level = 'mid'; }
  return { text: sw + ' of ' + taw + ' mm, ' + word, word, level };
}
export function isStressed(fs) { return !!fs && fs.planted && !fs.harvested && ((fs.ks != null && fs.ks < 1) || (fs.alerts || []).some((a) => /moist|stress|dry|water/i.test(a))); }

export function wxKind(d) {
  if (!d) return 'cloud';
  const p = +d.precip || 0, cold = d.tmax != null && d.tmax < 1;
  if (p >= 15) return 'storm';
  if (p >= 1) return cold ? 'snow' : 'rain';
  if (d.rad != null) return d.rad < 10 ? 'cloud' : d.rad < 17 ? 'part' : 'sun';
  const pp = d.precip_prob ?? (d.p_rain == null ? null : 100 * d.p_rain);
  if (pp != null) return pp >= 60 ? 'cloud' : pp >= 30 ? 'part' : 'sun';
  return p > 0.2 ? 'part' : 'sun';
}
const SUN = '<circle cx="12" cy="12" r="4.6" fill="var(--sun)"/><g stroke="var(--sun)" stroke-width="2" stroke-linecap="round"><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7"/></g>';
const CLOUD = (y = 0) => `<path transform="translate(0 ${y})" d="M7.2 18.5h10.3a3.9 3.9 0 0 0 .4-7.8 5.6 5.6 0 0 0-10.8 1.4 3.2 3.2 0 0 0 .1 6.4z" fill="var(--cloud)"/>`;
const ICONS = {
  sun: SUN,
  part: '<g transform="translate(-3 -3) scale(.8)">' + SUN + '</g>' + CLOUD(1),
  cloud: CLOUD(0),
  rain: CLOUD(-3) + '<g stroke="var(--rain)" stroke-width="2" stroke-linecap="round"><path d="M8.5 18.5l-1 2.6M12.5 18.5l-1 2.6M16.5 18.5l-1 2.6"/></g>',
  storm: CLOUD(-3) + '<path d="M12.8 16.2l-2.6 3.6h2.4l-1.4 3.2 3.8-4.6h-2.5l1.5-2.2z" fill="var(--sun)"/><g stroke="var(--rain)" stroke-width="2" stroke-linecap="round"><path d="M7.5 18l-.8 2M17.5 18l-.8 2"/></g>',
  snow: CLOUD(-3) + '<g fill="var(--cloud)"><circle cx="8" cy="19.5" r="1.2"/><circle cx="12" cy="21" r="1.2"/><circle cx="16" cy="19.5" r="1.2"/></g>',
};
export function wxIcon(kind, size = 24) { return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[kind] || ICONS.cloud}</svg>`; }
export const WX_WORD = { sun: 'Sunny', part: 'Partly cloudy', cloud: 'Cloudy', rain: 'Rain', storm: 'Heavy rain', snow: 'Snow' };
export function dayStrip(days, note) {
  const grid = h('div', { class: 'days', role: 'list' });
  for (const d of days) {
    const p = +d.precip || 0, cell = h('div', { role: 'listitem', title: dateLabel(d.date) + ': ' + (note ? note(d) : WX_WORD[wxKind(d)]) }, h('span', { text: weekday(d.date) }));
    cell.insertAdjacentHTML('beforeend', wxIcon(wxKind(d), 22));
    cell.append(h('b', { text: fmt(d.tmax) + '°' }), h('small', { text: fmt(d.tmin) + '°' }), h('em', { class: p >= 1 ? 'wet' : '', text: fmt(d.precip, p >= 10 || !p ? 0 : 1) + ' mm' }));
    grid.append(cell);
  }
  return grid;
}
export const nums = (items, style) => h('div', { class: 'nums', style }, items.map(([b, s]) => h('div', {}, h('b', { text: b }), h('span', { text: s }))));
export const legend = (items) => h('div', { class: 'legend' }, items.filter(Boolean).map(([style, label, cls]) => h('span', {}, h('i', { class: cls, style }), label)));
export function chartFig(label, height, caption, cls) {
  const cv = h('canvas', { 'aria-label': label, style: height ? 'height:' + height + 'px' : null });
  return { cv, fig: h('figure', { class: cls }, cv, caption ? h('figcaption', { text: caption }) : null) };
}

export function toast(text, kind = 'info', ms = 4200) {
  const box = $('toasts'); if (!box) return;
  const el = h('div', { class: 'toast panel ' + kind, role: 'status', text });
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 320); }, ms);
}

export async function sha1hex(s) {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' }); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
    ta.remove(); return ok;
  }
}

export function isPhone() { return window.innerWidth < 600; }
export function isCompact() { return window.innerWidth < 860; }
export function isTouch() { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || window.innerWidth < 600; }
