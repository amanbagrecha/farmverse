// FarmVerse sprites: every pixel-art asset (tiles, crops, buildings, trees, tractor, labels, op effects) generated in code, memoised per season.
export const HEAD = 14;

export const hx = (s) => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
export const NDVI_STOPS = [hx('#a8542a'), hx('#d9b53a'), hx('#8fc84a'), hx('#1f7a2e')];
export function ramp(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(x)), f = x - k, a = stops[k], b = stops[k + 1];
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * f));
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scl = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export function hash(a, b = 0, c = 0) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

class Pix {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  set(x, y, c, a = 255) {
    x = Math.floor(x); y = Math.floor(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const k = (y * this.w + x) * 4, d = this.d;
    if (a >= 255 || d[k + 3] === 0) { d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = a; return; }
    const t = a / 255; d[k] += (c[0] - d[k]) * t; d[k + 1] += (c[1] - d[k + 1]) * t; d[k + 2] += (c[2] - d[k + 2]) * t; d[k + 3] = Math.max(d[k + 3], a);
  }
  al(x, y) { return x < 0 || y < 0 || x >= this.w || y >= this.h ? 0 : this.d[(y * this.w + x) * 4 + 3]; }
  rect(x, y, w, h, c, a) { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c, a); }
  poly(pts, c, a) {
    let y0 = Infinity, y1 = -Infinity;
    for (const p of pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(this.h - 1, Math.ceil(y1)); y++) {
      const py = y + 0.5, xs = [];
      for (let i = 0; i < pts.length; i++) {
        const a0 = pts[i], b0 = pts[(i + 1) % pts.length];
        if ((a0[1] > py) !== (b0[1] > py)) xs.push(a0[0] + ((py - a0[1]) * (b0[0] - a0[0])) / (b0[1] - a0[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.ceil(xs[k] - 0.5); x < Math.ceil(xs[k + 1] - 0.5); x++) this.set(x, y, c, a);
    }
  }
  line(x0, y0, x1, y1, c) { const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1); for (let k = 0; k <= n; k++) this.set(Math.round(x0 + ((x1 - x0) * k) / n), Math.round(y0 + ((y1 - y0) * k) / n), c); }
  ellipse(cx, cy, rx, ry, c, a) { for (let y = Math.floor(cy - ry); y <= cy + ry; y++) for (let x = Math.floor(cx - rx); x <= cx + rx; x++) if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1) this.set(x, y, c, a); }
  outline(c, a = 255) {
    const add = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) if (this.al(x, y) < 200 && (this.al(x - 1, y) >= 200 || this.al(x + 1, y) >= 200 || this.al(x, y - 1) >= 200 || this.al(x, y + 1) >= 200)) add.push(x, y);
    for (let k = 0; k < add.length; k += 2) { const i = (add[k + 1] * this.w + add[k]) * 4; this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a; }
    return this;
  }
  canvas() {
    const cv = document.createElement('canvas'); cv.width = this.w; cv.height = this.h;
    const g = cv.getContext('2d'), im = g.createImageData(this.w, this.h); im.data.set(this.d); g.putImageData(im, 0, 0);
    return cv;
  }
}

const inD = (x, y) => { if (y < 0 || y > 15) return false; const r = y < 8 ? y : 15 - y; return x >= 15 - 2 * r && x <= 16 + 2 * r; };
const ab = (x, y) => { const X = x + 0.5 - 16, Y = y + 0.5; return [(X / 16 + Y / 8) / 2, (Y / 8 - X / 16) / 2]; };
const xy = (a, b) => [16 + (a - b) * 16, (a + b) * 8];
function inside(R, m = 2) { for (;;) { const x = (R() * 32) | 0, y = (R() * 16) | 0; if (inD(x - m, y) && inD(x + m, y) && inD(x, y - 1) && inD(x, y + 1)) return [x, y]; } }

const SNOW = [hx('#eef3f6'), hx('#d9e3ea')];
const GRASS = {
  spring: ['#5fae3e', '#6dbd48', '#86cf5c', '#4b9631'], summer: ['#4f8f2e', '#5c9e36', '#70b244', '#3f7a26'],
  autumn: ['#8c8a3c', '#9c9944', '#b4ac54', '#76723a'], winter: ['#ccd6d6', '#dfe7e9', '#eef3f4', '#a9b6ae'],
};
const SOIL = ['#6e4a2e', '#80593a', '#553822', '#8c6444'];
const STUB = ['#9c8158', '#ad9468', '#806646', '#bea672'];
const DIRT = ['#a07a4c', '#b08a5a', '#c29c6a', '#8a683f'];
const YARD = ['#8f8878', '#a29b8a', '#b8b1a0', '#746d5e'];
const WATER = ['#2f6aa8', '#3a7bbd', '#68a6de', '#275a92'];
const CROPS = {
  corn: { rows: 3, per: 4, row: 1, G: '#2c7428', g: '#58a63a', Y: '#ecd250', T: '#e0c068', B: '#a07a3a', b: '#d2b064', P: '#ecd250',
    gl: [['g', 'G'], ['g.g', '.G.', 'gGg', '.G.'], ['.Y.', 'gG.', '.Gg', 'gGg', '.G.', '.G.'], ['.Y.', 'gG.', '.GT', 'gGg', '.Gg', '.G.'], ['.b.', 'bB.', '.BT', 'bBb', '.Bb', '.B.']] },
  soybeans: { rows: 4, per: 5, row: 1, G: '#3a8432', g: '#74ba48', Y: '#d8c050', T: '#55822e', B: '#a88a38', b: '#d2b652', P: '#bb8ddc',
    gl: [['gg'], ['.g.', 'gGg'], ['gPg', 'GgG', 'GGG'], ['gGg', 'GTG', 'GGG'], ['bbb', 'BbB', 'BBB']] },
  winter_wheat: { rows: 6, per: 7, row: 1, G: '#4f8f34', g: '#88c252', Y: '#d8c462', T: '#c8a850', B: '#b89040', b: '#e4c672', P: '#d8c462',
    gl: [['g'], ['g', 'G'], ['Y', 'g', 'G'], ['Y', 'Y', 'G'], ['b', 'b', 'B']] },
  alfalfa: { rows: 5, per: 5, row: 0, G: '#2c6c2c', g: '#4f9a3c', Y: '#c8d060', T: '#2c6c2c', B: '#7a8a3a', b: '#9aa850', P: '#9d6ed4',
    gl: [['g'], ['g.g', 'GgG'], ['P.P', 'gGg', 'GGG'], ['PgP', 'gGg', 'GGG'], ['gPg', 'GgG', 'GGG']] },
  hay: { rows: 5, per: 5, row: 0, G: '#5f8e34', g: '#94c058', Y: '#d6c56a', T: '#5f8e34', B: '#a89050', b: '#cab46a', P: '#e8e0a0',
    gl: [['g'], ['g.g', '.G.'], ['Y.g', 'g.g', '.G.'], ['Y.Y', 'g.g', '.G.'], ['b.b', 'bYb', '.B.']] },
  pasture: { rows: 5, per: 5, row: 0, G: '#4a8632', g: '#78b24a', Y: '#f0e070', T: '#4a8632', B: '#8a9a48', b: '#a8b45a', P: '#f4f1de',
    gl: [['g'], ['g.g', '.G.'], ['g.g', '.G.'], ['gYg', '.G.'], ['gPg', '.G.']] },
  fallow: { rows: 3, per: 3, row: 0, sparse: 1, G: '#6a7a38', g: '#8e9a4a', Y: '#d8c060', T: '#6a7a38', B: '#8a7448', b: '#a89060', P: '#d8c060',
    gl: [['g'], ['g.', 'Gg'], ['g.', 'Gg'], ['Y.', 'Gg'], ['b.', 'Bb']] },
  other: { rows: 4, per: 4, row: 1, G: '#447f40', g: '#78ac5e', Y: '#d8c060', T: '#447f40', B: '#9a8a48', b: '#c0ac60', P: '#d8c060',
    gl: [['g'], ['.g.', 'gGg'], ['.g.', 'gGg', '.G.'], ['.Y.', 'gGg', '.G.'], ['.b.', 'bBb', '.B.']] },
};
export const CROP_KEYS = Object.keys(CROPS);

function toner(season) {
  const memo = new Map();
  return (c) => {
    const key = c.join(); let r = memo.get(key); if (r) return r;
    const [R, G, B] = c, l = 0.3 * R + 0.59 * G + 0.11 * B, green = G > R && G > B;
    if (season === 'summer') r = [l + (R - l) * 1.15, l + (G - l) * 1.15, l + (B - l) * 1.15];
    else if (season === 'spring') r = scl(green ? mix(c, [G * 0.82, G * 1.1, B * 0.75], 0.25) : c, 1.04);
    else if (season === 'autumn') r = green ? mix(c, [G * 1.05, G * 0.8, B * 0.5], 0.55) : c;
    else r = mix(c, [l * 1.04 + 14, l * 1.06 + 16, l * 1.1 + 22], 0.62);
    r = r.map((x) => Math.max(0, Math.min(255, Math.round(x)))); memo.set(key, r); return r;
  };
}

function ground(kind, v, season, T) {
  const p = new Pix(32, HEAD + 16), R = rng(9 + v * 7919 + kind.length * 104729 + season.length * 31);
  const pal = kind === 'grass' ? GRASS[season].map(hx) : (kind === 'road' ? DIRT : kind === 'yard' ? YARD : WATER).map((c) => T(hx(c)));
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    if (!inD(x, y)) continue;
    const n = R(); let c = n < 0.1 ? pal[3] : n < 0.32 ? pal[0] : n > 0.92 ? pal[2] : pal[1];
    if (kind === 'water') { c = pal[1]; if (((x >> 2) * 5 + y * 3 + v) % 11 === 0 && (x & 3) < 3) c = pal[2]; else if (n < 0.12) c = pal[0]; else if (n > 0.95) c = pal[3]; }
    if (kind === 'road' && season === 'winter' && R() < 0.45) c = SNOW[R() < 0.5 ? 0 : 1];
    p.set(x, y + HEAD, c);
  }
  const dots = (n, cols, m = 1) => { for (let k = 0; k < n; k++) { const [x, y] = inside(R, m); p.set(x, y + HEAD, hx(cols[(R() * cols.length) | 0])); } };
  if (kind === 'grass') {
    for (let k = 0; k < 6; k++) { const [x, y] = inside(R); p.set(x, y + HEAD, pal[3]); p.set(x - 1, y + HEAD - 1, pal[2]); p.set(x + 1, y + HEAD - 1, pal[2]); }
    if (season === 'spring') dots(4, ['#f4f1de', '#f2d04a', '#e88ab0']);
    else if (season === 'summer') dots(2, ['#f2d04a', '#f4f1de']);
    else if (season === 'autumn') dots(6, ['#d0782a', '#b8412e', '#e0a83a']);
    else dots(7, ['#7f8f72', '#94a386']);
  } else if (kind === 'road') { dots(3, ['#7c6a56', '#6e5c48']); dots(3, ['#d4b484']); }
  else if (kind === 'yard') { dots(8, ['#6a6458', '#c8c0ae', '#8a7a64']); }
  return p.canvas();
}

function stamp(p, gl, x, y, pal, snow) {
  const h = gl.length, w = gl[0].length, x0 = x - (w >> 1), y0 = y - h + 1;
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) {
    const ch = gl[r][q]; if (ch === '.') continue;
    p.set(x0 + q, y0 + r, snow && r === 0 && snow() < 0.6 ? SNOW[0] : pal[ch]);
  }
}

function cropTile(o, season, T) {
  const cf = CROPS[o.crop] || CROPS.other, p = new Pix(32, HEAD + 16), pasture = o.crop === 'pasture';
  const R = rng(1 + Math.floor(hash(o.v + 3, o.stage * 7 + o.dens * 61, o.crop.length * 13 + o.orient * 5 + (o.wet ? 3 : 0)) * 1e9));
  const pal = {};
  for (const k of 'GgYTBbP') { let c = T(hx(cf[k])); if (o.stress && 'GgT'.includes(k)) c = mix(c, [200, 178, 70], 0.45); pal[k] = c; }
  const stage = o.harvested || !o.planted ? 0 : o.stage;
  const soil = (o.harvested ? STUB : SOIL).map((c) => T(hx(c)));
  const cover = stage === 0 ? 0 : pasture ? 0.97 : [0.14, 0.38, 0.62, 0.88][o.dens] * (stage === 1 ? 0.35 : 1);
  const leaf = stage >= 5 && !pasture ? [pal.B, pal.b] : [scl(pal.G, 0.8), pal.G];
  const nrow = cf.row ? cf.rows : 4, straw = [T(hx('#dcc48e')), T(hx('#8a6a40'))];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) {
    if (!inD(x, y)) continue;
    const [a, b] = ab(x, y), r = (o.orient ? a : b) * nrow, d = Math.abs(r - Math.floor(r) - 0.5) * 2, n = R();
    let c = d < 0.3 ? soil[1] : d > 0.72 ? soil[2] : soil[0];
    if (n < 0.1) c = soil[3]; else if (n > 0.94) c = soil[2];
    if (o.harvested && d < 0.4 && R() < 0.5) c = straw[R() < 0.6 ? 0 : 1];
    if (o.wet) c = mix(c, [30, 42, 66], 0.34);
    let covered = false;
    if (stage > 0) covered = cf.row && !pasture ? d < cover * 1.1 + (R() - 0.5) * 0.3 : R() < cover;
    if (covered) c = leaf[R() < 0.7 ? 0 : 1];
    if (season === 'winter' && R() < (covered ? 0.18 : 0.3)) c = SNOW[R() < 0.6 ? 0 : 1];
    p.set(x, y + HEAD, c);
  }
  if (stage > 0) {
    const gl = cf.gl[stage - 1], keep = cf.sparse ? 0.35 : 0.5 + 0.5 * Math.min(1, (o.dens + 1) / 3.5), pts = [];
    for (let r = 0; r < cf.rows; r++) for (let m = 0; m < cf.per; m++) {
      if (R() > keep) continue;
      let ra = (r + 0.5) / cf.rows, ma = (m + 0.5) / cf.per;
      if (!cf.row) { ra += ((R() - 0.5) * 0.6) / cf.rows; ma += ((R() - 0.5) * 0.6) / cf.per; }
      const [x, y] = xy(o.orient ? ra : ma, o.orient ? ma : ra);
      pts.push([Math.floor(x), Math.floor(y)]);
    }
    pts.sort((q, w) => q[1] - w[1]);
    for (const [x, y] of pts) stamp(p, gl, x, y + HEAD, pal, season === 'winter' ? R : null);
  }
  return p.canvas();
}

function edge(kind, side, season) {
  const p = new Pix(32, 16), R = rng(31 + side * 17 + kind.length * 7), g = GRASS[season].map(hx);
  for (let k = 0; k < 8; k++) {
    const y = side < 2 ? k : 8 + k, r = y < 8 ? y : 15 - y, left = side === 0 || side === 3, x0 = left ? 15 - 2 * r : 15 + 2 * r, inn = left ? 2 : -2;
    for (const dx of [0, 1]) {
      if (kind === 'rim') p.set(x0 + dx, y, [52, 34, 18], 120);
      else if (kind === 'fringe') { if (R() < 0.75) p.set(x0 + dx, y, g[R() < 0.5 ? 0 : 3]); if (R() < 0.3) p.set(x0 + inn + dx, y, g[0]); }
      else { p.set(x0 + dx, y, hx(season === 'winter' ? '#e4ecef' : '#d8c48a')); if (R() < 0.5) p.set(x0 + inn + dx, y, hx('#cfe6f4'), 170); }
    }
  }
  return p.canvas();
}

function cliff(side, season, T) {
  const D = 10, p = new Pix(32, 16 + D + 1), R = rng(55 + side * 3);
  const lip = season === 'winter' ? SNOW[1] : hx(GRASS[season][3]), strata = ['#6a4a2e', '#5a3e26', '#7a5636', '#4a3220'].map((c) => T(hx(c)));
  for (let x = side ? 16 : 0; x < (side ? 32 : 17); x++) {
    const ey = side ? (x === 31 ? 8 : 15 - ((x - 15) >> 1)) : x === 0 ? 8 : 8 + ((x - 1) >> 1);
    for (let dy = 1; dy <= D; dy++) {
      let c = dy <= 2 ? lip : strata[(((dy + (x % 5 === 0 ? 1 : 0)) / 3) | 0) % 3];
      if (dy > 2 && R() < 0.12) c = strata[3];
      p.set(x, ey + dy, scl(c, side ? 0.7 : 0.92));
    }
  }
  return p.canvas();
}

const TREE_PAL = {
  spring: [['#3f8a34', '#5aae44', '#86d064']], summer: [['#22582a', '#2f7434', '#459a44']],
  autumn: [['#8e3e1a', '#c4642a', '#e89a44'], ['#7e2a20', '#b0402c', '#d8683e'], ['#8e7420', '#c8a432', '#ead266']], winter: [['#22582a', '#2f7434', '#459a44']],
};
function tree(kind, v, season) {
  const p = new Pix(24, 34), R = rng(400 + v * 37 + kind.length * 11 + season.length), bx = 12, by = 31;
  p.ellipse(bx + 2, by, 8, 3, [0, 0, 0], 60);
  const trunk = hx('#6a4628');
  if (kind === 'pine') {
    p.rect(bx - 1, by - 5, 2, 6, trunk);
    const g = ['#1a4f2c', '#28683c', '#3a8450'].map(hx);
    for (let k = 0; k < 4; k++) {
      const top = by - 28 + k * 5, bot = by - 16 + k * 4, hw = 3 + k * 2.3;
      for (let y = top; y <= bot; y++) {
        const half = ((y - top) / (bot - top)) * hw;
        for (let x = Math.ceil(bx - half - 0.5); x <= bx + half - 0.5; x++) {
          const s = (x + 0.5 - bx) / (hw + 0.01); let c = s < -0.25 ? g[2] : s > 0.3 ? g[0] : g[1];
          if (R() < 0.12) c = g[0];
          if (season === 'winter' && (y - top < 2 || (R() < 0.18 && s < 0.2))) c = SNOW[0];
          p.set(x, y, c);
        }
      }
    }
  } else if (season === 'winter') {
    p.rect(bx - 1, by - 12, 3, 13, trunk);
    for (let k = 0; k < 6; k++) { const sy = by - 8 - k * 2, dir = k % 2 ? 1 : -1; p.line(bx, sy, bx + dir * (3 + R() * 7), sy - 5 - R() * 9, hx('#5a3c22')); }
    for (let y = 1; y < p.h; y++) for (let x = 0; x < p.w; x++) if (p.al(x, y) === 255 && p.al(x, y - 1) === 0 && y < by - 4 && R() < 0.6) p.set(x, y - 1, SNOW[0]);
  } else {
    p.rect(bx - 1, by - 9, 3, 10, trunk); p.rect(bx + 1, by - 9, 1, 10, hx('#4e321c'));
    const set = TREE_PAL[season], g = set[v % set.length].map(hx);
    const blobs = [[bx, by - 16, 7.5], [bx - 4.5, by - 12, 5.2], [bx + 4.5, by - 12, 5.2], [bx + 1, by - 21, 5.5]].map(([x, y, r]) => [x + (R() - 0.5) * 2, y + (R() - 0.5) * 2, r]);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      let best = null;
      for (const [cx, cy, r] of blobs) { const dd = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r; if (dd <= 1 && (!best || dd < best[0])) best = [dd, cx, cy, r]; }
      if (!best) continue;
      const lt = (x + 0.5 - best[1] + (y + 0.5 - best[2])) / best[3];
      let c = lt < -0.45 ? g[2] : lt > 0.4 ? g[0] : g[1];
      if (R() < 0.1) c = g[lt < 0 ? 1 : 0];
      if (season === 'spring' && R() < 0.05) c = hx('#f4b8d0');
      p.set(x, y, c);
    }
  }
  p.outline(hx('#14200f'), 220);
  return { c: p.canvas(), ax: bx, ay: by };
}

function cow(v, season) {
  const g = ['.WWKWWw.', 'WKKWWWWh', 'WWWWKWWn', '.L.L..LL'], body = v & 1 ? hx('#8a5a34') : hx('#f2efe6');
  const C = { W: body, w: body, h: body, K: hx('#2a2622'), n: hx('#e0a0a0'), L: hx('#3a3430') };
  const p = new Pix(12, 9), flip = v & 2;
  p.ellipse(6, 7.5, 5, 1.6, [0, 0, 0], 55);
  g.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') p.set(flip ? 9 - x : x + 2, y + 3, C[ch]); }));
  if (season === 'winter') p.set(4, 3, SNOW[0]);
  p.outline(hx('#1a2014'), 200);
  return { c: p.canvas(), ax: 6, ay: 7 };
}

function n3(v) { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
function newell(ps) {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < ps.length; i++) { const a = ps[i], b = ps[(i + 1) % ps.length]; x += (a[1] - b[1]) * (a[2] + b[2]); y += (a[2] - b[2]) * (a[0] + b[0]); z += (a[0] - b[0]) * (a[1] + b[1]); }
  return n3([x, y, z]);
}
const cen = (ps) => { const s = [0, 0, 0]; for (const p of ps) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; } return [s[0] / ps.length, s[1] / ps.length, s[2] / ps.length]; };
const solid = (faces, k = 0) => ({ faces, k });
function box(f0, f1, s0, s1, z0, z1, c, dec = {}, top) {
  return solid([
    { p: [[f0, s0, z1], [f1, s0, z1], [f1, s1, z1], [f0, s1, z1]], c: top || c, d: dec.top },
    { p: [[f1, s0, z0], [f1, s1, z0], [f1, s1, z1], [f1, s0, z1]], c, d: dec.pf },
    { p: [[f0, s0, z0], [f0, s1, z0], [f0, s1, z1], [f0, s0, z1]], c, d: dec.nf },
    { p: [[f0, s1, z0], [f1, s1, z0], [f1, s1, z1], [f0, s1, z1]], c, d: dec.ps },
    { p: [[f0, s0, z0], [f1, s0, z0], [f1, s0, z1], [f0, s0, z1]], c, d: dec.ns },
  ]);
}
function prism(prof, f0, f1, c, cap, dec = {}) {
  const A = prof.map(([s, z]) => [f0, s, z]), B = prof.map(([s, z]) => [f1, s, z]), faces = [{ p: A, c: cap, d: dec.nf }, { p: B, c: cap, d: dec.pf }];
  for (let i = 0; i < prof.length; i++) { const j = (i + 1) % prof.length; faces.push({ p: [A[i], A[j], B[j], B[i]], c }); }
  return solid(faces);
}
function cyl(axis, c0, r, len, n, side, cap, capDec) {
  const ring = (o, rr) => Array.from({ length: n }, (_, q) => {
    const a = (q / n) * Math.PI * 2, x = Math.cos(a) * rr, y = Math.sin(a) * rr;
    return axis === 'z' ? [c0[0] + x, c0[1] + y, c0[2] + o] : axis === 's' ? [c0[0] + x, c0[1] + o, c0[2] + y] : [c0[0] + o, c0[1] + x, c0[2] + y];
  });
  const A = ring(-len / 2, r), B = ring(len / 2, r);
  const faces = [{ p: A, c: cap, d: capDec && capDec(ring, -len / 2) }, { p: B, c: cap, d: capDec && capDec(ring, len / 2) }];
  for (let q = 0; q < n; q++) { const q1 = (q + 1) % n; faces.push({ p: [A[q], A[q1], B[q1], B[q]], c: typeof side === 'function' ? side(q) : side }); }
  return solid(faces);
}
function cone(cx, cy, r, z0, z1, n, c) {
  const ring = Array.from({ length: n }, (_, q) => { const a = (q / n) * Math.PI * 2; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z0]; }), top = [cx, cy, z1];
  const faces = [{ p: ring.slice().reverse(), c }];
  for (let q = 0; q < n; q++) faces.push({ p: [ring[q], ring[(q + 1) % n], top], c });
  return solid(faces);
}
const rs = (s, f0, f1, z0, z1, c) => ({ p: [[f0, s, z0], [f1, s, z0], [f1, s, z1], [f0, s, z1]], c });
const rf = (f, s0, s1, z0, z1, c) => ({ p: [[f, s0, z0], [f, s1, z0], [f, s1, z1], [f, s0, z1]], c });
const LV = n3([-0.25, 0.55, 0.8]);
function render(solids, th, w, h, ax, ay, pre) {
  const p = new Pix(w, h), cs = Math.cos(th), sn = Math.sin(th);
  const tr = (q) => [q[0] * cs - q[1] * sn, q[0] * sn + q[1] * cs, q[2]];
  const P = (q) => [ax + (q[0] - q[1]), ay + (q[0] + q[1]) / 2 - q[2]];
  const list = solids.map((so) => {
    const faces = so.faces.map((f) => ({ c: f.c, p: f.p.map(tr), d: f.d && f.d.map((dd) => ({ c: dd.c, p: dd.p.map(tr) })) }));
    const m = cen(faces.flatMap((f) => f.p));
    return { faces, m, k: so.k, dep: m[0] + m[1] + m[2] };
  });
  list.sort((a, b) => a.dep - b.dep || a.k - b.k);
  if (pre) pre(p, P);
  for (const so of list) for (const f of so.faces) {
    let n = newell(f.p); const fc = cen(f.p);
    if (n[0] * (fc[0] - so.m[0]) + n[1] * (fc[1] - so.m[1]) + n[2] * (fc[2] - so.m[2]) < 0) n = [-n[0], -n[1], -n[2]];
    if (n[0] + n[1] + n[2] <= 0.03) continue;
    const b = Math.min(1.08, 0.6 + 0.47 * Math.max(0, n[0] * LV[0] + n[1] * LV[1] + n[2] * LV[2]));
    p.poly(f.p.map(P), scl(f.c, b));
    if (f.d) for (const dd of f.d) p.poly(dd.p.map(P), scl(dd.c, b));
  }
  return p;
}

const JD = { G: hx('#367c2b'), Y: hx('#f5c518'), K: hx('#262626'), GL: hx('#9fd4e6'), HUB: hx('#b8901c'), T1: hx('#1b1b1b'), T2: hx('#3c3c3c') };
function wheel(f, s, r, w, fr) {
  return cyl('s', [f, s, r], r, w, 12, (q) => ((q + fr) % 2 ? JD.T1 : JD.T2), JD.K, (ring, o) => [{ p: ring(o, r * 0.62), c: JD.Y }, { p: ring(o, r * 0.24), c: JD.HUB }]);
}
function tractor(dir, fr) {
  const { G, Y, K, GL } = JD;
  const solids = [
    wheel(-4, 6.3, 5.6, 3, fr), wheel(-4, -6.3, 5.6, 3, fr), wheel(7.2, 4.8, 3.6, 2.4, fr), wheel(7.2, -4.8, 3.6, 2.4, fr),
    box(0, 11, -2.6, 2.6, 3, 9.5, G, { ps: [rs(2.6, 0.5, 10.5, 7, 8.2, Y)], ns: [rs(-2.6, 0.5, 10.5, 7, 8.2, Y)], pf: [rf(11, -1.8, 1.8, 4, 8.6, K)] }),
    box(-8.5, 0, -3.8, 3.8, 3, 8, G),
    box(-8, -0.6, -3.4, 3.4, 8, 15, GL, { pf: [rf(-0.6, -3.4, -2.6, 8, 15, G), rf(-0.6, 2.6, 3.4, 8, 15, G)], ps: [rs(3.4, -8, -7.2, 8, 15, G), rs(3.4, -1.4, -0.6, 8, 15, G)], ns: [rs(-3.4, -8, -7.2, 8, 15, G), rs(-3.4, -1.4, -0.6, 8, 15, G)] }),
    box(-9, 0.4, -4.3, 4.3, 15, 16.6, Y),
    box(-8.2, -0.2, 4.4, 8, 11.2, 12.2, G), box(-8.2, -0.2, -8, -4.4, 11.2, 12.2, G),
    box(8.2, 9.2, 1, 2, 9.5, 14.5, K),
  ];
  const p = render(solids, (dir * Math.PI) / 4, 48, 44, 24, 31, (q) => q.ellipse(24.5, 31.5, 15, 7, [0, 0, 0], 70));
  p.outline(hx('#101810'), 230);
  return { c: p.canvas(), ax: 24, ay: 31 };
}

function barn(season, T) {
  const R = T(hx('#b3362a')), W = hx('#ece6da'), D = T(hx('#6e1f18')), roof = season === 'winter' ? SNOW[0] : T(hx('#4e4a4c'));
  const xs = [{ p: [[16, -5, 0], [16, -4, 0], [16, 5, 11], [16, 4, 11]], c: W }, { p: [[16, 4, 0], [16, 5, 0], [16, -4, 11], [16, -5, 11]], c: W }];
  const win = (f) => [rs(12, f - 2.5, f + 2.5, 7, 12, W), rs(12, f - 1.7, f + 1.7, 7.8, 11.2, D)];
  const solids = [
    box(-16, 16, -12, 12, 0, 16, R, { pf: [rf(16, -6, 6, 0, 12, W), rf(16, -5, 5, 0, 11, D), ...xs], ps: [...win(-9), ...win(0), ...win(9)] }),
    prism([[-13.5, 15.5], [-10.5, 24.5], [0, 30.5], [10.5, 24.5], [13.5, 15.5]], -17, 17, roof, R, { pf: [rf(17, -3, 3, 19, 25, W), rf(17, -2.2, 2.2, 19.8, 24.2, D)] }),
  ];
  const p = render(solids, 0, 96, 80, 40, 56, (q, P) => q.poly([[-16, -12, 0], [30, -12, 0], [30, 12, 0], [-16, 12, 0]].map(P), [0, 0, 0], 60));
  p.outline(hx('#1a1410'), 220);
  return { c: p.canvas(), ax: 40, ay: 56 };
}
function house(season, T) {
  const Wl = T(hx('#ece4d0')), roof = season === 'winter' ? SNOW[0] : T(hx('#4a5a78')), Dr = hx('#6a3a22'), Gl = hx('#9fd0e8'), F = hx('#ffffff');
  const win = (f) => [rs(8, f - 2, f + 2, 4, 8, F), rs(8, f - 1.4, f + 1.4, 4.6, 7.4, Gl)];
  const solids = [
    box(-10, 10, -8, 8, 0, 11, Wl, { ps: [rs(8, -1.6, 1.6, 0, 7, Dr), ...win(-6), ...win(6)], pf: [rf(10, -2.2, 2.2, 4, 8, F), rf(10, -1.6, 1.6, 4.6, 7.4, Gl)] }),
    prism([[-9.6, 10.6], [0, 18.5], [9.6, 10.6]], -11, 11, roof, Wl),
    box(4, 6.4, -5, -2.6, 12, 21, T(hx('#8a4a3a'))),
  ];
  const p = render(solids, 0, 64, 52, 30, 36, (q, P) => q.poly([[-10, -8, 0], [19, -8, 0], [19, 8, 0], [-10, 8, 0]].map(P), [0, 0, 0], 60));
  p.outline(hx('#1a1410'), 220);
  return { c: p.canvas(), ax: 30, ay: 36 };
}
function silo(season, T) {
  const body = T(hx('#c4cbd0')), band = T(hx('#8f9aa3')), dome = season === 'winter' ? SNOW[0] : T(hx('#3f6e8c'));
  const solids = [cyl('z', [0, 0, 14], 6, 28, 16, body, body), solid(cyl('z', [0, 0, 29.5], 6.4, 3, 16, band, band).faces, 1), solid(cone(0, 0, 6.4, 31, 38, 16, dome).faces, 2)];
  const p = render(solids, 0, 28, 56, 12, 48, (q) => q.ellipse(16, 49, 9, 4, [0, 0, 0], 60));
  p.outline(hx('#1a1410'), 220);
  return { c: p.canvas(), ax: 12, ay: 48 };
}
function bale(v, T) {
  const c = T(hx('#d6b462')), e = T(hx('#e8cc80')), sp = T(hx('#a8873e'));
  const p = render([cyl('f', [0, 0, 3.2], 3.2, 4.6, 10, c, e, (ring, o) => [{ p: ring(o, 1.6), c: sp }])], v ? Math.PI / 2 : 0, 18, 14, 9, 10, (q) => q.ellipse(10, 10, 6, 2.5, [0, 0, 0], 55));
  p.outline(hx('#2a2010'), 200);
  return { c: p.canvas(), ax: 9, ay: 10 };
}

const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001010010010', 8: '111101111101111', 9: '111101111001111',
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111', F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111',
  J: '001001001101010', K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010', P: '110101110100100', Q: '010101101110011', R: '110101110101101',
  S: '011100010001110', T: '111010010010010', U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  a: '000011101101011', b: '100110101101110', c: '000011100100011', d: '001011101101011', e: '000010111100011', f: '011100110100100', g: '000011101011110', h: '100110101101101', '-': '000000111000000', ' ': '000000000000000',
};
function label(text, sel, sw) {
  const off = sw ? 6 : 0, w = text.length * 4 + 3 + off, h = 9, p = new Pix(w, h), bg = sel ? hx('#f5c518') : [16, 22, 14], bd = sel ? hx('#fff4c0') : hx('#5f7a4e'), fg = sel ? [24, 24, 16] : hx('#f4f1de');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ex = x === 0 || x === w - 1, ey = y === 0 || y === h - 1;
    if (ex && ey) continue;
    p.set(x, y, ex || ey ? bd : bg, ex || ey ? 255 : sel ? 255 : 225);
  }
  if (sw) p.rect(2, 2, 4, 5, sw);
  [...text].forEach((ch, k) => { const g = FONT[ch] || FONT[ch.toUpperCase()] || FONT[' ']; for (let i = 0; i < 15; i++) if (g[i] === '1') p.set(2 + off + k * 4 + (i % 3), 2 + ((i / 3) | 0), fg); });
  return p.canvas();
}

const FXG = {
  seed: [['.y.', 'yYb', '.b.'], { y: '#e8c870', Y: '#fff2b8', b: '#8a6a30' }, 1],
  sprout: [['g...g', 'Gg.gG', '.GgG.', '..s..', '..s..'], { g: '#9be05e', G: '#3f8f2e', s: '#5a8a2e' }, 1],
  drop: [['.w.', '.l.', 'lwl', 'lLl', '.L.'], { w: '#ffffff', l: '#8fd0f8', L: '#3a8ad0' }, 1],
  splash: [['l.....l', '.l.l.l.', '..lll..'], { l: '#c4e6fb' }, 0],
  mist0: [['.m.', 'mMm', '.m.'], { m: '#e6f4e0a0', M: '#ffffffd0' }, 0],
  mist1: [['.mmm.', 'mmMmm', 'mMMMm', 'mmMmm', '.mmm.'], { m: '#e6f4e090', M: '#ffffffc0' }, 0],
  mist2: [['..mmm..', '.mmmmm.', 'mmmMmmm', 'mmMMMmm', 'mmmMmmm', '.mmmmm.', '..mmm..'], { m: '#e6f4e070', M: '#ffffffa0' }, 0],
  glint0: [['.w.', 'wWw', '.w.'], { w: '#ffe680', W: '#ffffff' }, 0],
  glint1: [['...w...', '...w...', '..wYw..', 'wwYWYww', '..wYw..', '...w...', '...w...'], { w: '#fff2b0', Y: '#ffd84a', W: '#ffffff' }, 0],
  speck: [['yY', 'Yy'], { y: '#d8a83a', Y: '#f4d26a' }, 0],
};
function fxSprite(name) {
  const [g, pal, ol] = FXG[name], p = new Pix(g[0].length + 2, g.length + 2);
  g.forEach((row, y) => [...row].forEach((ch, x) => { const c = pal[ch]; if (c) p.set(x + 1, y + 1, hx(c), c.length > 7 ? parseInt(c.slice(7, 9), 16) : 255); }));
  if (ol) p.outline(hx('#14200f'), 200);
  return { c: p.canvas(), ax: (g[0].length >> 1) + 1, ay: g.length };
}

function shimmer(f) {
  const p = new Pix(32, 16), R = rng(91 + f * 13);
  for (let k = 0; k < 7; k++) { const [x, y] = inside(R, 2); p.set(x, y, hx('#b8dcf6'), 230); p.set(x + 1, y, hx('#e8f4fc'), 230); }
  return p.canvas();
}
function diamond(rgb, a) { const p = new Pix(32, 16); for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (inD(x, y)) p.set(x, y, rgb, Math.round(a * 255)); return p.canvas(); }
function hatch() { const p = new Pix(32, 16); for (let y = 0; y < 16; y++) for (let x = 0; x < 32; x++) if (inD(x, y)) p.set(x, y, (x + 2 * y) % 8 < 2 ? [200, 200, 200] : [92, 92, 92], 170); return p.canvas(); }

export function createSprites(season = 'summer') {
  const T = toner(season), memo = new Map();
  const get = (k, fn) => { let v = memo.get(k); if (!v) { v = fn(); memo.set(k, v); } return v; };
  return {
    season,
    ground: (kind, v) => get('g' + kind + v, () => ground(kind, v, season, T)),
    crop: (o) => get('c' + [o.crop, o.stage, o.dens, o.stress ? 1 : 0, o.orient, o.v, o.wet ? 1 : 0, o.harvested ? 1 : 0, o.planted ? 1 : 0].join(), () => cropTile(o, season, T)),
    edge: (kind, side) => get('e' + kind + side, () => edge(kind, side, season)),
    cliff: (side) => get('k' + side, () => cliff(side, season, T)),
    tree: (kind, v) => get('t' + kind + v, () => tree(kind, v, season)),
    cow: (v) => get('w' + v, () => cow(v, season)),
    bale: (v) => get('b' + v, () => bale(v, T)),
    barn: () => get('barn', () => barn(season, T)),
    house: () => get('house', () => house(season, T)),
    silo: () => get('silo', () => silo(season, T)),
    tractor: (dir, fr) => get('tr' + dir + fr, () => tractor(dir, fr)),
    shimmer: (f) => get('s' + f, () => shimmer(f)),
    diamond: (rgb, a) => get('d' + rgb.join() + a, () => diamond(rgb, a)),
    hatch: () => get('h', hatch),
    label: (text, sel, sw) => get('l' + text + (sel ? 1 : 0) + (sw ? sw.join() : ''), () => label(text, sel, sw)),
    fx: (name) => get('f' + name, () => fxSprite(name)),
  };
}
