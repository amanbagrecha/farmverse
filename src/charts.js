// FarmVerse charts: NDVI sparkline, season water balance and the feed charts, Canvas 2D with crosshair tooltips.
import { fmt, dateLabel } from './ui/util.js';
const FONT = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const tok = (el, name, fb) => (getComputedStyle(el).getPropertyValue(name).trim() || fb);

function begin(canvas, dw = 300, dh = 64) {
  if (canvas._fv) canvas._fv();
  const host = canvas.parentElement; if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  let el = host.querySelector(':scope > .tip');
  if (!el) { el = document.createElement('div'); el.className = 'tip hidden'; host.appendChild(el); }
  const dpr = Math.min(2, window.devicePixelRatio || 1), r = canvas.getBoundingClientRect();
  const W = Math.max(10, Math.round(r.width || dw)), H = Math.max(10, Math.round(r.height || dh));
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
  return { ctx, W, H, el };
}
function blank(ctx, canvas, H, msg) { ctx.fillStyle = tok(canvas, '--muted', '#999'); ctx.font = FONT; ctx.fillText(msg, 4, H / 2 + 4); canvas._fv = null; }
function hover(canvas, el, xs, onIndex, draw) {
  let cur = -1;
  const move = (e) => {
    const r = canvas.getBoundingClientRect(); const px = e.clientX - r.left;
    let k = 0, best = 1e9; xs.forEach((x, i) => { const d = Math.abs(x - px); if (d < best) { best = d; k = i; } });
    if (k === cur) return; cur = k; draw(k);
    el.textContent = '';
    for (const row of onIndex(k)) {
      const d = document.createElement('div');
      if (row.head) { d.className = 'th'; d.textContent = row.head; }
      else { d.className = 'tr'; if (row.color) { const i = document.createElement('i'); i.style.background = row.color; d.appendChild(i); } const v = document.createElement('b'); v.textContent = row.value; const l = document.createElement('span'); l.textContent = row.label; d.append(v, l); }
      el.appendChild(d);
    }
    el.classList.remove('hidden');
    const ox = canvas.offsetLeft, oy = canvas.offsetTop;
    const right = xs[k] + 10 + el.offsetWidth > r.width;
    el.style.left = Math.max(0, ox + (right ? xs[k] - el.offsetWidth - 10 : xs[k] + 10)) + 'px'; el.style.top = (oy + 2) + 'px';
  };
  const leave = () => { cur = -1; el.classList.add('hidden'); draw(-1); };
  canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerdown', move); canvas.addEventListener('pointerleave', leave);
  return () => { canvas.removeEventListener('pointermove', move); canvas.removeEventListener('pointerdown', move); canvas.removeEventListener('pointerleave', leave); el.classList.add('hidden'); };
}
function cross(ctx, x, H, ink) { ctx.strokeStyle = ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, H); ctx.stroke(); ctx.globalAlpha = 1; }
function dot(ctx, x, y, color, ring) { ctx.fillStyle = ring; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill(); }

const dayNum = (s) => { const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const monthShort = (n) => new Date(n * 86400000).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });

export function sparkline(canvas, rows, opts = {}) {
  const { ctx, W, H, el } = begin(canvas);
  const line = opts.color || tok(canvas, '--accent-2', '#5fb24a'), grid = tok(canvas, '--hair', '#2a3626'), muted = tok(canvas, '--muted', '#999'), ink = tok(canvas, '--ink', '#eee'), ring = tok(canvas, '--surface', '#1b2418'), accent = tok(canvas, '--accent', '#f2c230');
  const lo = opts.min ?? 0, hi = opts.max ?? 1, pad = 4, time = !!opts.time && rows && rows.length > 1 && rows.every((d) => d.date);
  const axisH = time ? 14 : 0, plotH = H - axisH;
  if (!rows || !rows.length) return blank(ctx, canvas, H, opts.empty || 'no data');
  const ts = time ? rows.map((d) => dayNum(d.date)) : null;
  const t0 = time ? Math.min(ts[0], opts.today ? dayNum(opts.today) - 1 : ts[0]) : 0, t1 = time ? Math.max(ts[ts.length - 1], opts.today ? dayNum(opts.today) : 0) : 1;
  const xt = (t) => pad + (W - 2 * pad) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5);
  const x = (k) => (time ? xt(ts[k]) : pad + (W - 2 * pad) * (rows.length === 1 ? 0.5 : k / (rows.length - 1)));
  const y = (v) => pad + (plotH - 2 * pad) * (1 - Math.max(0, Math.min(1, (v - lo) / (hi - lo))));
  const xs = rows.map((_, k) => x(k));
  const vline = (px, color, dash, label) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.setLineDash(dash); ctx.beginPath(); ctx.moveTo(Math.round(px) + 0.5, 0); ctx.lineTo(Math.round(px) + 0.5, plotH); ctx.stroke(); ctx.setLineDash([]);
    if (label) { ctx.fillStyle = color; ctx.font = FONT; ctx.textAlign = px > W - 40 ? 'right' : 'left'; ctx.fillText(label, px + (px > W - 40 ? -4 : 4), 11); ctx.textAlign = 'left'; }
  };
  function draw(hk) {
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (const g of [0.25, 0.5, 0.75]) { const yy = Math.round(y(lo + g * (hi - lo))) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
    if (opts.axis) { ctx.fillStyle = muted; ctx.font = FONT; for (const g of [0.25, 0.5, 0.75]) ctx.fillText((lo + g * (hi - lo)).toFixed(2), 2, y(lo + g * (hi - lo)) - 3); }
    if (time) {
      ctx.fillStyle = muted; ctx.font = FONT; ctx.textAlign = 'center';
      const first = new Date(t0 * 86400000), m0 = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1) / 86400000;
      for (let m = m0; m <= t1; ) {
        const d = new Date(m * 86400000), next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86400000;
        const a = Math.max(m, t0), b = Math.min(next, t1);
        if (b - a >= 12) ctx.fillText(monthShort(m), xt((a + b) / 2), H - 2);
        if (m > t0) { ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(Math.round(xt(m)) + 0.5, 0); ctx.lineTo(Math.round(xt(m)) + 0.5, plotH); ctx.stroke(); }
        m = next;
      }
      ctx.textAlign = 'left';
    }
    if (opts.marker) {
      if (time) { const t = dayNum(opts.marker); if (t >= t0 && t <= t1) vline(xt(t), muted, [3, 3], 'planted'); }
      else { const k = rows.findIndex((d) => d.date >= opts.marker); if (k >= 0) vline(x(k), muted, [3, 3]); }
    }
    if (time && opts.today) vline(xt(dayNum(opts.today)), accent, [2, 3], 'today');
    ctx.strokeStyle = line; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.beginPath();
    rows.forEach((d, k) => { k ? ctx.lineTo(x(k), y(d.ndvi)) : ctx.moveTo(x(k), y(d.ndvi)); }); ctx.stroke();
    if (time) { ctx.fillStyle = line; for (let k = 0; k < rows.length; k++) { ctx.beginPath(); ctx.arc(x(k), y(rows[k].ndvi), 2, 0, Math.PI * 2); ctx.fill(); } }
    const lk = rows.length - 1; dot(ctx, x(lk), y(rows[lk].ndvi), line, ring);
    if (hk >= 0) { cross(ctx, x(hk), plotH, ink); dot(ctx, x(hk), y(rows[hk].ndvi), line, ring); }
  }
  draw(-1);
  canvas._fv = hover(canvas, el, xs, (k) => { const d = rows[k]; return [{ head: dateLabel(d.date, false) + (d.clear_pct != null ? ' · ' + Math.round(d.clear_pct) + '% clear' : '') }, { value: d.ndvi.toFixed(2), label: 'NDVI mean', color: line }]; }, draw);
}

export function seasonChart(canvas, days) {
  const { ctx, W, H, el } = begin(canvas, 300, 120);
  const water = tok(canvas, '--water', '#4f9bd6'), grid = tok(canvas, '--hair', '#2a3626'), muted = tok(canvas, '--muted', '#999'), ink = tok(canvas, '--ink', '#eee'), warn = tok(canvas, '--danger', '#e0643f'), accent = tok(canvas, '--accent', '#f2c230'), ring = tok(canvas, '--surface', '#1b2418');
  if (!days || !days.length) return blank(ctx, canvas, H, 'Advance the season to fill this chart');
  const padL = 2, padR = 2, top = 4, rainH = 18, bottom = 4;
  const plotH = H - top - rainH - bottom - 6, plotY = top;
  const taw = Math.max(1, ...days.map((d) => d.taw_mm || 0)), rainMax = Math.max(5, ...days.map((d) => (d.rain_mm || 0) + (d.irrigation_mm || 0)));
  const n = days.length, x = (k) => padL + (W - padL - padR) * (n === 1 ? 0.5 : k / (n - 1)), y = (v) => plotY + plotH * (1 - Math.max(0, Math.min(1, v / taw)));
  const xs = days.map((_, k) => x(k)), bw = Math.max(1, (W - padL - padR) / n - 1);
  function draw(hk) {
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = warn; ctx.globalAlpha = 0.1;
    days.forEach((d, k) => { if (d.raw_mm != null && d.taw_mm) { const lim = y(d.taw_mm - d.raw_mm); ctx.fillRect(k ? (x(k - 1) + x(k)) / 2 : x(k), lim, k < n - 1 ? (x(k + 1) - x(k)) : bw, plotY + plotH - lim); } });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = grid; ctx.lineWidth = 1; [0.5, 1].forEach((g) => { const yy = Math.round(y(taw * g)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); });
    const ry = H - bottom;
    days.forEach((d, k) => { const r = d.rain_mm || 0, ir = d.irrigation_mm || 0; if (r) { ctx.fillStyle = water; ctx.globalAlpha = 0.7; ctx.fillRect(x(k) - bw / 2, ry - rainH * r / rainMax, bw, rainH * r / rainMax); } if (ir) { ctx.fillStyle = accent; ctx.globalAlpha = 0.9; ctx.fillRect(x(k) - bw / 2, ry - rainH * (r + ir) / rainMax, bw, rainH * ir / rainMax); } });
    ctx.globalAlpha = 1;
    ctx.strokeStyle = water; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    days.forEach((d, k) => { k ? ctx.lineTo(x(k), y(d.soil_water_mm)) : ctx.moveTo(x(k), y(d.soil_water_mm)); }); ctx.stroke();
    days.forEach((d, k) => { if (d.ks != null && d.ks < 0.8) { ctx.fillStyle = warn; ctx.fillRect(x(k) - 1, plotY + plotH + 1, 2, 3); } });
    if (hk >= 0) { cross(ctx, x(hk), H, ink); dot(ctx, x(hk), y(days[hk].soil_water_mm), water, ring); }
  }
  draw(-1);
  canvas._fv = hover(canvas, el, xs, (k) => { const d = days[k]; return [{ head: dateLabel(d.date, false) + (d.stage ? ' · ' + String(d.stage).replace(/_/g, ' ') : '') }, { value: Math.round(d.soil_water_mm) + ' / ' + Math.round(d.taw_mm || taw) + ' mm', label: 'root-zone water', color: water }, { value: (d.rain_mm || 0).toFixed(1) + ' mm', label: 'rain', color: water }, ...(d.irrigation_mm ? [{ value: d.irrigation_mm + ' mm', label: 'irrigation', color: accent }] : []), ...(d.ks != null ? [{ value: d.ks.toFixed(2), label: 'water stress Ks' }] : []), ...(d.yield_est_t_ha != null ? [{ value: Number(d.yield_est_t_ha).toFixed(1) + ' t/ha', label: 'est. yield' }] : [])]; }, draw);
}

const MONTH_DOY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
function vgrid(ctx, x, y0, y1, color) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, y0); ctx.lineTo(Math.round(x) + 0.5, y1); ctx.stroke(); }
const MONTH_LETTER = 'JFMAMJJASOND';
function niceMax(v) { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return Math.ceil(v / p / 2) * 2 * p; }
function spread(items, gap, lo, hi) {
  items.sort((a, b) => a.y - b.y);
  for (let i = 1; i < items.length; i++) items[i].y = Math.max(items[i].y, items[i - 1].y + gap);
  const over = items.length ? items[items.length - 1].y - hi : 0;
  if (over > 0) for (const it of items) it.y -= over;
  for (let i = items.length - 2; i >= 0; i--) items[i].y = Math.min(items[i].y, items[i + 1].y - gap);
  for (const it of items) it.y = Math.max(lo, it.y);
  return items;
}

export function yearLines(canvas, series, opts = {}) {
  const { ctx, W, H, el } = begin(canvas, 300, 150);
  const grid = tok(canvas, '--hair', '#2a3626'), muted = tok(canvas, '--muted', '#999'), ink = tok(canvas, '--ink', '#eee'), ring = tok(canvas, '--surface', '#1b2418');
  const unit = opts.unit || '';
  const all = series.flatMap((s) => s.values.filter((v) => v != null));
  if (!all.length) return blank(ctx, canvas, H, opts.empty || 'no data');
  const padL = 2, padR = 44, top = 8, axisH = 14, plotH = H - top - axisH, n = 366, hi = niceMax(Math.max(...all));
  const x = (i) => padL + (W - padL - padR) * i / (n - 1), y = (v) => top + plotH * (1 - v / hi);
  const xs = Array.from({ length: n }, (_, i) => x(i));
  for (const s of series) if (String(s.color).startsWith('--')) s.color = tok(canvas, s.color, ink);
  const lastOf = (s) => { for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] != null) return i; return -1; };
  const labels = spread(series.map((s) => ({ s, i: lastOf(s) })).filter((it) => it.i >= 0).map((it) => ({ s: it.s, x: x(it.i), y: y(it.s.values[it.i]) + 4 })), 11, 10, top + plotH);
  function draw(hk) {
    ctx.clearRect(0, 0, W, H);
    ctx.font = FONT; ctx.lineWidth = 1;
    for (const g of [0.5, 1]) {
      const yy = Math.round(y(hi * g)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W - padR, yy); ctx.stroke();
      ctx.fillStyle = muted; ctx.fillText(fmt(hi * g) + unit, 2, yy - 3);
    }
    ctx.textAlign = 'center';
    MONTH_DOY.forEach((d, m) => { ctx.fillStyle = muted; ctx.fillText(MONTH_LETTER[m], x(d + 15), H - 2); if (m) vgrid(ctx, x(d), top, top + plotH, grid); });
    ctx.textAlign = 'left';
    for (const s of series) {
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2; ctx.setLineDash(s.dash || []); ctx.lineJoin = 'round'; ctx.globalAlpha = s.alpha ?? 1;
      ctx.beginPath(); let on = false;
      s.values.forEach((v, i) => { if (v == null) { on = false; return; } if (on) ctx.lineTo(x(i), y(v)); else { ctx.moveTo(x(i), y(v)); on = true; } });
      ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
    for (const it of labels) { ctx.fillStyle = it.s.strong ? ink : muted; ctx.font = (it.s.strong ? '600 ' : '') + FONT; ctx.fillText(it.s.label, Math.min(it.x + 4, W - padR + 4), it.y); }
    if (hk >= 0) { cross(ctx, x(hk), top + plotH, ink); for (const s of series) if (s.values[hk] != null && !s.dash) dot(ctx, x(hk), y(s.values[hk]), s.color, ring); }
  }
  draw(-1);
  canvas._fv = hover(canvas, el, xs, (k) => [{ head: dateLabel('2001-' + doyDate(k), false) }, ...series.filter((s) => s.values[k] != null).map((s) => ({ value: fmt(s.values[k]) + unit, label: s.label, color: s.color }))], draw);
}
function doyDate(i) { const d = new Date(Date.UTC(2001, 0, 1 + Math.min(i, 364))); return d.toISOString().slice(5, 10); }

export function anomalyBars(canvas, months, opts = {}) {
  const { ctx, W, H, el } = begin(canvas, 300, 110);
  const warm = tok(canvas, '--accent', '#f2c230'), cool = tok(canvas, '--water', '#5aa6e0'), grid = tok(canvas, '--hair', '#2a3626'), muted = tok(canvas, '--muted', '#999'), ink = tok(canvas, '--ink', '#eee');
  const rows = (months || []).filter((m) => m.anom != null);
  if (!rows.length) return blank(ctx, canvas, H, opts.empty || 'no data');
  const axisH = 14, top = 6, plotH = H - axisH - top, lim = Math.max(2, Math.ceil(Math.max(...rows.map((m) => Math.abs(m.anom))))), mid = top + plotH / 2;
  const slot = W / rows.length, bw = Math.max(2, slot - 2), xs = rows.map((_, k) => slot * (k + 0.5));
  const y = (v) => mid - (plotH / 2) * Math.max(-1, Math.min(1, v / lim));
  function draw(hk) {
    ctx.clearRect(0, 0, W, H); ctx.font = FONT;
    ctx.strokeStyle = grid; ctx.lineWidth = 1;
    for (const g of [-1, 1]) { const yy = Math.round(y(lim * g)) + 0.5; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); }
    ctx.fillStyle = muted; ctx.fillText('+' + lim + ' °C', 2, y(lim) + 11); ctx.fillText('−' + lim + ' °C', 2, y(-lim) - 3);
    rows.forEach((m, k) => {
      const v = m.anom, y0 = y(Math.max(v, 0)), hh = Math.max(1, Math.abs(y(v) - mid));
      ctx.fillStyle = v >= 0 ? warm : cool; ctx.globalAlpha = hk === -1 || hk === k ? 1 : 0.55;
      ctx.beginPath(); ctx.roundRect(xs[k] - bw / 2, v >= 0 ? y0 : mid, bw, hh, v >= 0 ? [Math.min(4, bw / 2), Math.min(4, bw / 2), 0, 0] : [0, 0, Math.min(4, bw / 2), Math.min(4, bw / 2)]); ctx.fill();
      ctx.globalAlpha = 1;
      if (m.key.endsWith('-01')) { ctx.fillStyle = muted; ctx.fillText(m.key.slice(0, 4), xs[k] - bw / 2, H - 2); vgrid(ctx, xs[k] - slot / 2, top, top + plotH, grid); }
    });
    ctx.strokeStyle = muted; ctx.beginPath(); ctx.moveTo(0, Math.round(mid) + 0.5); ctx.lineTo(W, Math.round(mid) + 0.5); ctx.stroke();
    if (hk >= 0) cross(ctx, xs[hk], top + plotH, ink);
  }
  draw(-1);
  canvas._fv = hover(canvas, el, xs, (k) => { const m = rows[k]; return [{ head: m.label }, { value: (m.anom >= 0 ? '+' : '−') + Math.abs(m.anom).toFixed(1) + ' °C', label: 'vs normal', color: m.anom >= 0 ? warm : cool }, { value: m.tmax.toFixed(1) + ' / ' + m.tmin.toFixed(1) + ' °C', label: 'mean high / low' }, { value: m.nmax.toFixed(1) + ' / ' + m.nmin.toFixed(1) + ' °C', label: 'normal high / low' }]; }, draw);
}

export function phenoChart(canvas, rows, years, opts = {}) {
  const { ctx, W, H, el } = begin(canvas, 300, 140);
  const line = tok(canvas, '--accent-2', '#6cc254'), grid = tok(canvas, '--hair', '#2a3626'), muted = tok(canvas, '--muted', '#999'), ink = tok(canvas, '--ink', '#eee'), ring = tok(canvas, '--surface', '#1b2418'), accent = tok(canvas, '--accent', '#f2c230');
  if (!rows || !rows.length) return blank(ctx, canvas, H, opts.empty || 'no clear scenes');
  const axisH = 14, top = 6, plotH = H - axisH - top, pad = 4;
  const t0 = dayNum(opts.start || rows[0].date), t1 = dayNum(opts.end || rows[rows.length - 1].date);
  const x = (t) => pad + (W - 2 * pad) * (t1 > t0 ? (t - t0) / (t1 - t0) : 0.5), y = (v) => top + plotH * (1 - Math.max(0, Math.min(1, v)));
  const ts = rows.map((r) => dayNum(r.date)), xs = ts.map(x);
  const marks = [];
  for (const p of years || []) for (const [key, kind] of [['sos_date', 'up'], ['peak_date', 'peak'], ['eos_date', 'down']]) if (p[key]) marks.push({ t: dayNum(p[key]), kind, v: kind === 'peak' ? p.peak_ndvi : p.base_ndvi + 0.5 * p.amplitude });
  function tri(px, py, upward) { ctx.beginPath(); if (upward) { ctx.moveTo(px, py - 5); ctx.lineTo(px + 5, py + 4); ctx.lineTo(px - 5, py + 4); } else { ctx.moveTo(px, py + 5); ctx.lineTo(px + 5, py - 4); ctx.lineTo(px - 5, py - 4); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
  function draw(hk) {
    ctx.clearRect(0, 0, W, H); ctx.font = FONT; ctx.lineWidth = 1;
    for (const g of [0.25, 0.5, 0.75]) { const yy = Math.round(y(g)) + 0.5; ctx.strokeStyle = grid; ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke(); ctx.fillStyle = muted; ctx.fillText(g.toFixed(2), 2, yy - 3); }
    const y0 = new Date(t0 * 86400000).getUTCFullYear(), y1 = new Date(t1 * 86400000).getUTCFullYear();
    for (let yr = y0; yr <= y1; yr++) {
      const a = Math.max(t0, Date.UTC(yr, 0, 1) / 86400000), b = Math.min(t1, Date.UTC(yr + 1, 0, 1) / 86400000);
      ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText(String(yr), x((a + b) / 2), H - 2);
      if (yr > y0) vgrid(ctx, x(a), top, top + plotH, grid);
    }
    ctx.textAlign = 'left';
    ctx.strokeStyle = line; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.beginPath();
    rows.forEach((r, k) => { const px = xs[k], py = y(r.ndvi); k && ts[k] - ts[k - 1] < 60 ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke(); ctx.globalAlpha = 1;
    ctx.fillStyle = line; ctx.beginPath(); for (let k = 0; k < rows.length; k++) { const py = y(rows[k].ndvi); ctx.moveTo(xs[k] + 1.8, py); ctx.arc(xs[k], py, 1.8, 0, Math.PI * 2); } ctx.fill();
    ctx.strokeStyle = ring; ctx.lineWidth = 2;
    for (const m of marks) { const px = x(m.t), py = y(m.v); ctx.fillStyle = m.kind === 'peak' ? ink : accent; if (m.kind === 'peak') { ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); } else tri(px, py, m.kind === 'up'); }
    ctx.lineWidth = 1;
    if (hk >= 0) { cross(ctx, xs[hk], top + plotH, ink); dot(ctx, xs[hk], y(rows[hk].ndvi), line, ring); }
  }
  draw(-1);
  canvas._fv = hover(canvas, el, xs, (k) => { const r = rows[k]; return [{ head: dateLabel(r.date) + ' · ' + Math.round(r.clear_pct) + '% clear' }, { value: r.ndvi.toFixed(2), label: 'mean NDVI', color: line }]; }, draw);
}
