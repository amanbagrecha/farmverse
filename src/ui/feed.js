import { h, css, fmt, dateLabel, dayStrip, nums, legend, chartFig } from './util.js';
import { yearLines, anomalyBars, phenoChart } from '../charts.js';

css('feed', `
#drawer .fstat { font-size: 11.5px; color: var(--muted); margin: 0 0 8px; line-height: 1.45; }
#drawer .days { gap: 4px; margin-top: 6px; } #drawer .days > div { background: var(--surface-2); }
#drawer table.ph { border-collapse: collapse; width: 100%; margin-top: 8px; font-size: 11.5px; font-variant-numeric: tabular-nums; }
#drawer table.ph th { font-weight: 600; color: var(--faint); text-align: right; padding: 3px 4px; font-size: 10.5px; }
#drawer table.ph td { text-align: right; padding: 3px 4px; border-top: 1px solid var(--hair); white-space: nowrap; }
#drawer table.ph th:first-child, #drawer table.ph td:first-child { text-align: left; }
#drawer .legend i.tri { width: 0; height: 0; border-radius: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-bottom: 9px solid var(--accent); background: none; }
#drawer .legend i.tri.down { border-bottom: 0; border-top: 9px solid var(--accent); }
#drawer .legend i.pk { border-radius: 50%; background: var(--ink); }
`);

const PART_LABEL = { weather: 'weather', forecast: 'forecast', climatology: 'normals' };
const partLabel = (n) => PART_LABEL[n] || (n.startsWith('ndvi_') ? 'NDVI ' + n.slice(5) : n.startsWith('pheno_') ? 'phenology ' + n.slice(6) : n);
const year = (s) => +String(s).slice(0, 4);
const doyIdx = (s) => Math.round((Date.UTC(year(s), +s.slice(5, 7) - 1, +s.slice(8, 10)) - Date.UTC(year(s), 0, 1)) / 86400000);
const mean = (xs) => { const v = xs.filter((x) => x != null && !isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const gdd = (tx, tn) => (tx == null || tn == null ? 0 : Math.max(0, (Math.min(tx, 30) + Math.min(Math.max(tn, 10), 30)) / 2 - 10));
const pct = (a, b) => Math.round((100 * a) / b) + '%';
const memo = new WeakMap();
const cached = (part, key, make) => { if (!part) return make(); let m = memo.get(part); if (!m) memo.set(part, (m = new Map())); if (!m.has(key)) m.set(key, make()); return m.get(key); };
function rowsOf(part, keep) {
  return cached(part, 'rows:' + (keep || ''), () => {
    if (!part) return [];
    const c = part.cols, keys = Object.keys(c), n = keys.length ? c[keys[0]].length : 0, out = [];
    for (let i = 0; i < n; i++) { if (keep && c.field_id[i] !== keep) continue; const r = {}; for (const k of keys) r[k] = c[k][i]; out.push(r); }
    return out;
  });
}
export const fieldRows = (P, prefix, id) => Object.keys(P).filter((k) => k.startsWith(prefix)).sort().flatMap((k) => rowsOf(P[k], id));
const ago = (t) => { const s = Date.now() / 1000 - t; return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' days ago'; };

function weatherStats(w, clim) {
  const last = w[w.length - 1], ly = year(last.date), li = doyIdx(last.date);
  const nc = clim ? clim.cols.precip_mean : null;
  const ytd = w.filter((r) => year(r.date) === ly).reduce((a, r) => a + (r.precip || 0), 0);
  const d30 = w.slice(-30).reduce((a, r) => a + (r.precip || 0), 0);
  const g = w.filter((r) => year(r.date) === ly).reduce((a, r) => a + gdd(r.tmax, r.tmin), 0);
  return {
    ly, ytd, d30, gdd: g,
    ytdNorm: nc ? nc.slice(0, li + 1).reduce((a, b) => a + (b || 0), 0) : null,
    n30: clim ? clim.cols.precip30_p50[Math.min(li, 365)] : null,
    gddNorm: clim ? clim.cols.tmax_p50.slice(0, li + 1).reduce((a, tx, i) => a + gdd(tx, clim.cols.tmin_p50[i]), 0) : null,
  };
}

function rainSeries(w, clim, years) {
  const by = new Map(years.map((y) => [y, { v: new Array(366).fill(null), sum: 0 }]));
  for (const r of w) { const b = by.get(year(r.date)); if (b) { b.sum += r.precip || 0; b.v[doyIdx(r.date)] = b.sum; } }
  const series = years.map((y) => {
    const cur = y === years[years.length - 1];
    return { label: String(y), values: by.get(y).v, color: cur ? '--water' : '--muted', width: cur ? 2.5 : 1.5, alpha: cur ? 1 : 0.7, strong: cur };
  });
  if (clim) { let s = 0; series.unshift({ label: 'normal', values: clim.cols.precip_mean.map((p) => (s += p || 0)), color: '--ink', dash: [4, 3], width: 1.5, alpha: 0.6 }); }
  return series;
}

function monthAnoms(w, clim) {
  const by = {};
  for (const r of w) { if (r.tmax == null || r.tmin == null) continue; const k = r.date.slice(0, 7); (by[k] = by[k] || []).push(r); }
  return Object.keys(by).sort().filter((k) => by[k].length >= 20).map((k) => {
    const rs = by[k], at = (col) => mean(rs.map((r) => (col || [])[doyIdx(r.date)]));
    const tmax = mean(rs.map((r) => r.tmax)), tmin = mean(rs.map((r) => r.tmin)), nmid = at(clim.cols.tmid_mean);
    const label = new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { key: k, label, tmax, tmin, nmax: at(clim.cols.tmax_p50), nmin: at(clim.cols.tmin_p50), anom: nmid == null ? null : (tmax + tmin) / 2 - nmid };
  });
}

export function feedTab(body, ctx, id, fieldSelect) {
  const F = ctx.feedOf();
  if (!F) { ctx.loadFeed(); body.append(h('p', { text: 'Loading the feed…' })); return; }
  const P = F.parts, fails = [...Object.entries(F.errors || {}).map(([k, v]) => partLabel(k) + ': ' + String(v).slice(0, 120)), F.err].filter(Boolean);
  const steps = F.building ? F.building.split(',') : [];
  const note = F.building ? 'Building ' + (steps.length > 2 ? steps.length + ' parts' : steps.map(partLabel).join(', ')) + ' on ' + (F.engine === 'local' ? 'this Mac' : 'Fused') + '…'
    : !F.loaded ? 'Reading the stored feed…' : F.missing.length ? 'Not built yet: ' + F.missing.map(partLabel).join(', ') + '.' : '';
  if (note) body.append(h('p', { class: 'fstat', text: note }));
  if (fails.length) body.append(h('p', { class: 'fstat warnline', text: 'Failed: ' + fails.join('; ') }));

  const fc = rowsOf(P.forecast), w = rowsOf(P.weather), clim = P.climatology || null;
  body.append(h('h4', { text: 'Next 7 days' }));
  body.append(fc.length ? dayStrip(fc, (d) => (d.p_rain != null ? pct(d.p_rain, 1) + ' chance of more than 1 mm' : '')) : h('p', { text: F.loaded ? 'No forecast yet.' : 'Loading…' }));

  body.append(h('h4', { text: 'Rain since January 1' }));
  if (w.length) {
    const years = cached(P.weather, 'years', () => [...new Set(w.map((r) => year(r.date)))].sort());
    const prep = cached(P.weather, clim || 'noclim', () => ({ st: weatherStats(w, clim), anoms: clim ? monthAnoms(w, clim) : [] })), st = prep.st;
    body.append(nums([
      [fmt(st.ytd) + ' mm', st.ytdNorm ? pct(st.ytd, st.ytdNorm) + ' of normal' : 'in ' + st.ly],
      [fmt(st.d30) + ' mm', 'last 30 days' + (st.n30 != null ? ', normal ' + fmt(st.n30) : '')],
      [fmt(st.gdd), 'degree days' + (st.gddNorm ? ', ' + pct(st.gdd, st.gddNorm) : '')]], 'margin-top:2px'));
    const rain = chartFig('Rain and climatology', 150);
    body.append(rain.fig, legend([['background:var(--water)', String(years[years.length - 1]), 'line'], ['background:var(--muted)', 'earlier years', 'line'], clim && ['background:var(--ink);opacity:.6', 'normal ' + (clim.meta.years || ''), 'line']]));
    requestAnimationFrame(() => yearLines(rain.cv, rainSeries(w, clim, years), { unit: ' mm' }));
    body.append(h('h4', { text: 'Temperature against normal', title: 'Monthly mean of (high + low) / 2 minus the normal. Degree days: base 10 °C, cap 30 °C.' }));
    const temp = chartFig('Monthly temperature anomaly', 110);
    body.append(temp.fig);
    requestAnimationFrame(() => anomalyBars(temp.cv, prep.anoms, { empty: 'waiting for the normals' }));
  } else body.append(h('p', { text: F.loaded ? 'No weather yet.' : 'Loading…' }));

  body.append(h('h4', { text: 'Crop phenology' }), fieldSelect());
  const rows = fieldRows(P, 'ndvi_', id), mine = fieldRows(P, 'pheno_', id), years = Object.keys(P).filter((k) => k.startsWith('ndvi_')).map((k) => +k.slice(5)).sort();
  const last = rows.length ? rows[rows.length - 1].date : null, pheno = chartFig('NDVI record with phenology', 140);
  body.append(pheno.fig, legend([['', 'green-up', 'tri'], ['', 'peak', 'pk'], ['', 'senescence', 'tri down']]));
  requestAnimationFrame(() => phenoChart(pheno.cv, rows, mine, { start: years.length ? years[0] + '-01-01' : null, end: last || (years.length ? years[years.length - 1] + '-12-31' : null), empty: F.loaded ? 'no NDVI yet' : 'loading…' }));
  if (mine.length) {
    const cur = mine[mine.length - 1], past = mine.slice(0, -1).filter((r) => r.sos_date);
    if (cur.sos_date && past.length) {
      const d = doyIdx(cur.sos_date) - mean(past.map((r) => doyIdx(r.sos_date)));
      body.append(h('p', { class: 'why', text: 'Green-up on ' + dateLabel(cur.sos_date, false) + ', ' + (Math.abs(d) < 1.5 ? 'the same as' : Math.round(Math.abs(d)) + ' days ' + (d < 0 ? 'earlier than' : 'later than')) + ' the ' + past[0].year + '-' + past[past.length - 1].year + ' mean.' }));
    }
    const tbl = h('table', { class: 'ph' }, h('tr', {}, ...['Year', 'Green-up', 'Peak', 'Senescence'].map((t) => h('th', { text: t }))));
    for (const r of mine) tbl.append(h('tr', {}, h('td', { text: String(r.year) + (r.quality !== 'ok' ? ' (' + r.quality + ')' : '') }), h('td', { text: dateLabel(r.sos_date, false) }), h('td', { text: r.peak_date ? dateLabel(r.peak_date, false) + ' · ' + fmt(r.peak_ndvi, 2) : '–' }), h('td', { text: r.eos_date ? dateLabel(r.eos_date, false) : year(last) === r.year ? 'not yet' : '–' })));
    body.append(tbl);
  }
  const built = Object.values(P).map((p) => p.built_at).filter(Boolean);
  body.append(h('p', { class: 'formula' }, 'dynamical.org, Sentinel-2 L2A' + (built.length ? ' · updated ' + ago(Math.max(...built)) : '') + ' · ',
    F.loaded && !F.building ? h('button', { class: 'link', text: 'Rebuild', onclick: () => { ctx.sfx('ui'); ctx.loadFeed(true); } }) : null));
}
