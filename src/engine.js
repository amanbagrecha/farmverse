// FarmVerse engine: isometric pixel-art farm renderer, tractor driving, camera moves, overlays and op effects (contract in ../CONTRACTS.md).
import { createSprites, HEAD, CROP_KEYS, hash, hx, ramp, NDVI_STOPS as NDVI } from './sprites.js';

const M = 4, GRASS = 0, ROAD = 1, WATER = 2, FIELD = 3, YARD = 4;
const STAGES = { bare: 0, emergence: 1, vegetative: 2, flowering: 3, grain_fill: 4, mature: 5 };
const NB = [[-1, 0], [0, -1], [1, 0], [0, 1]];
const MOIST = [hx('#c8773a'), hx('#e8d8a0'), hx('#4f9bd6')];
const FX = { plant: 1, irrigate: 1, spray: 1, harvest: 1, stress: 1 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
function toRgb(c) {
  if (!Array.isArray(c) || c.length < 3 || c.slice(0, 3).some((v) => v == null || isNaN(v))) return null;
  const k = c[0] <= 1 && c[1] <= 1 && c[2] <= 1 ? 255 : 1;
  return [0, 1, 2].map((i) => clamp(Math.round((+c[i] * k) / 4) * 4, 0, 255));
}
const dayNum = (s) => { const t = s ? Date.parse(String(s).slice(0, 10) + 'T00:00:00Z') : NaN; return isNaN(t) ? null : t / 86400000; };

export function createGame(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const handlers = { select: [], op: [], tractor: [], idle: [], drive: [] };
  const st = {
    farm: null, states: {}, season: 'summer', weather: null, today: null, overlay: { kind: 'none', data: null }, selected: null, outline: [],
    tractor: { u: 0, v: 0, dir: 1, moving: false, fieldId: null, anim: 0, fr: 0, dustT: 0 }, cam: { x: 0, y: 0 }, follow: true,
    zoom: 1, zr: 1, S: 1, dprI: 1, bpc: 1, cssW: 0, cssH: 0, keys: {}, raf: 0, last: 0, t: 0, dirty: true, dust: [], rain: [], drag: null, wheelAcc: 0, wheelT: 0, err: false,
    low: false, joy: null, fly: null, cine: false, cineOn: false, cineForce: false, cineT: 0, lastInput: 0, idleFired: false, fx: [], ptrs: new Map(), pinch: null,
    base: 'farm', imagery: null, userZoom: false,
  };
  let spr = createSprites(st.season), W = null, cache = null;

  const emit = (k, v) => (handlers[k] || []).forEach((fn) => { try { fn(v); } catch (e) { console.error(e); } });
  const E = (i, j) => (!W || i < -M || j < -M || i >= W.cols + M || j >= W.rows + M ? -1 : (j + M) * W.ew + (i + M));
  const kindAt = (i, j) => { const e = E(i, j); return e < 0 ? -1 : W.kind[e]; };
  const fieldAt = (i, j) => { const e = E(i, j); return e < 0 || W.own[e] < 0 ? null : st.farm.fields[W.own[e]].field_id; };

  function setFarm(farm) {
    st.farm = farm;
    layoutWorld(null);
    const { cols, rows } = W;
    const tr = st.tractor; tr.u = W.home[0]; tr.v = W.home[1]; tr.dir = 1; tr.moving = false; tr.fieldId = fieldAt(Math.floor(tr.u), Math.floor(tr.v));
    st.selected = null; st.outline = []; st.dust = []; st.fx = []; st.follow = true; st.imagery = null; st.userZoom = false;
    if (st.fly) endFly(false);
    resize();
    const fit = Math.min(st.cssW / ((cols + rows) * 16), st.cssH / ((cols + rows) * 8));
    st.zoom = st.zr = clamp(Math.floor(fit * 1.25), 1, 4); st.S = st.zoom * st.dprI;
    const p = worldOf(tr.u, tr.v); st.cam.x = p.x; st.cam.y = p.y - 8;
    st.dirty = true;
  }

  function layoutWorld(roads) {
    const farm = st.farm, cols = farm.cols, rows = farm.rows, ew = cols + 2 * M, eh = rows + 2 * M;
    W = { cols, rows, ew, eh, kind: new Uint8Array(ew * eh), own: new Int16Array(ew * eh).fill(-1), vown: null, blk: new Uint8Array(ew * eh), idx: new Map(), props: [], water: [], labels: [], roadLabels: [], tags: [], sprinklers: [], dirtField: [], roads: null };
    farm.fields.forEach((f, k) => { W.idx.set(f.field_id, k); for (const t of f.tiles) { const e = E(t % cols, Math.floor(t / cols)); if (e >= 0) { W.kind[e] = FIELD; W.own[e] = k; } } });
    for (const t of farm.water || []) { const i = t % cols, j = Math.floor(t / cols), e = E(i, j); if (e >= 0 && W.kind[e] !== FIELD) { W.kind[e] = WATER; W.water.push([i, j]); } }
    W.vown = W.own.slice();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const e = E(i, j); if (W.kind[e] !== GRASS) continue;
      const cnt = new Map(); let nf = 0;
      for (const [a, b] of NB) { const ne = E(i + a, j + b); if (ne >= 0 && W.own[ne] >= 0) { nf++; cnt.set(W.own[ne], (cnt.get(W.own[ne]) || 0) + 1); } }
      for (const [k, c] of cnt) if (c >= 3 || (c >= 2 && nf >= 3)) { W.vown[e] = k; W.kind[e] = FIELD; break; }
    }
    if (roads) {
      W.roads = roads;
      for (const t of roads.tiles) { const i = t % cols, j = Math.floor(t / cols); if (i < 0 || j < 0 || i >= cols || j >= rows) continue; const e = E(i, j); if (W.kind[e] === GRASS) W.kind[e] = ROAD; }
    } else autoRoads();
    farmstead();
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const e = E(i, j);
      if (W.kind[e] === GRASS && !W.blk[e] && hash(i, j, 3) < 0.09) { W.blk[e] = 1; W.props.push({ k: 'tree', t: hash(i, j, 5) < 0.3 ? 'pine' : 'oak', v: Math.floor(hash(i, j, 7) * 3), u: i + 0.5, v2: j + 0.5, deco: 1 }); }
    }
    W.polys = farm.fields.map((f) => polysOf(f.geometry));
    W.labels = farm.fields.map((f, k) => {
      let si = 0, sj = 0; for (const t of f.tiles) { si += t % cols; sj += Math.floor(t / cols); }
      const ci = si / f.tiles.length, cj = sj / f.tiles.length; let best = f.tiles[0], bd = Infinity;
      for (const t of f.tiles) { const d = (t % cols - ci) ** 2 + (Math.floor(t / cols) - cj) ** 2; if (d < bd) { bd = d; best = t; } }
      return { k, id: f.field_id, name: String(f.name || f.field_id), i: best % cols, j: Math.floor(best / cols) };
    });
    if (roads) W.roadLabels = roadLabels(roads);
  }

  function bounds() { const b = st.farm && st.farm.bounds; return Array.isArray(b) && b.length === 4 && b.every((x) => isFinite(+x)) && +b[2] > +b[0] && +b[3] > +b[1] ? b.map(Number) : null; }
  function polysOf(gm) {
    const b = bounds(); if (!b || !gm || !gm.coordinates) return null;
    const polys = gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : [];
    const ku = W.cols / (b[2] - b[0]), kv = W.rows / (b[3] - b[1]), rings = [];
    for (const poly of polys) for (const r of poly || []) {
      if (!Array.isArray(r) || r.length < 3) continue;
      const pts = [];
      for (const c of r) { const u = (+c[0] - b[0]) * ku, v = (b[3] - +c[1]) * kv; if (isFinite(u) && isFinite(v)) pts.push(16 * (u - v), 8 * (u + v)); }
      if (pts.length >= 6) rings.push(pts);
    }
    return rings.length ? rings : null;
  }
  function groundBox() {
    const b = bounds(); if (!b || !W) return null;
    const du = (b[2] - b[0]) / W.cols, dv = (b[3] - b[1]) / W.rows;
    return [b[0] - M * du, b[1] - M * dv, b[2] + M * du, b[3] + M * dv];
  }
  function setImagery(im) {
    const b = bounds();
    if (!im || !im.canvas || !Array.isArray(im.box) || !b || !W) { st.imagery = null; st.dirty = true; return; }
    const levels = [im.canvas];
    while (levels.length < 6) {
      const p = levels[levels.length - 1]; if (Math.max(p.width, p.height) <= 512) break;
      const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(p.width / 2)); c.height = Math.max(1, Math.round(p.height / 2));
      const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(p, 0, 0, c.width, c.height);
      levels.push(c);
    }
    const ku = W.cols / (b[2] - b[0]), kv = W.rows / (b[3] - b[1]);
    st.imagery = { levels, u0: (im.box[0] - b[0]) * ku, u1: (im.box[2] - b[0]) * ku, v0: (b[3] - im.box[3]) * kv, v1: (b[3] - im.box[1]) * kv };
    st.dirty = true;
  }
  const satOn = () => st.base === 'satellite' && !!st.imagery;

  function autoRoads() {
    const { cols, rows } = W;
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const e = E(i, j); if (W.kind[e] !== GRASS) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) for (let di = -1; di <= 1; di++) if (kindAt(i + di, j + dj) === FIELD) { near = true; break; }
      if (near) W.kind[e] = ROAD;
    }
  }

  function roadLabels(roads) {
    const { cols, rows } = W, best = new Map();
    for (const w of roads.ways || []) {
      const name = String(w.name || '').trim(), tiles = (w.tiles || []).filter((t) => t >= 0 && t < cols * rows);
      if (!name || tiles.length < 4) continue;
      const cur = best.get(name); if (!cur || tiles.length > cur.tiles.length) best.set(name, { name, tiles });
    }
    const yard = W.yard || [cols / 2, rows / 2], far = (t) => Math.hypot(t % cols + 0.5 - yard[0], Math.floor(t / cols) + 0.5 - yard[1]) >= 7;
    return [...best.values()].map(({ name, tiles }) => {
      const n = tiles.length, mid = Math.floor(n / 2), q = Math.floor(n / 4);
      const m = [mid, mid + q, mid - q].map((k) => clamp(k, 0, n - 1)).find((k) => far(tiles[k])) ?? mid;
      const a = tiles[Math.max(0, m - 2)], b = tiles[Math.min(n - 1, m + 2)], t = tiles[m];
      const pa = worldOf(a % cols, Math.floor(a / cols)), pb = worldOf(b % cols, Math.floor(b / cols));
      let ang = Math.atan2(pb.y - pa.y, pb.x - pa.x); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      return { name: name.toUpperCase(), i: t % cols, j: Math.floor(t / cols), ang };
    });
  }

  function setRoads(roads) {
    if (!W || !st.farm) return;
    const ok = roads && Array.isArray(roads.tiles) ? roads : null, tr = st.tractor, keep = { u: tr.u, v: tr.v, dir: tr.dir };
    layoutWorld(ok);
    tr.u = keep.u; tr.v = keep.v; tr.dir = keep.dir; tr.fieldId = fieldAt(Math.floor(tr.u), Math.floor(tr.v));
    st.outline = st.selected ? computeOutline(st.selected) : [];
    st.dirty = true;
  }

  function farmstead() {
    const { cols, rows } = W;
    const ok = (i, j, n) => { for (let dj = 0; dj < n; dj++) for (let di = 0; di < n; di++) { const k = kindAt(i + di, j + dj); if (k !== GRASS && k !== ROAD) return false; } return true; };
    let best = null;
    for (const n of [4, 3]) {
      for (let j = 0; j <= rows - n; j++) for (let i = 0; i <= cols - n; i++) {
        if (!ok(i, j, n)) continue;
        const d = (i + n / 2 - cols / 2) ** 2 + (j + n / 2 - rows / 2) ** 2;
        if (!best || d < best.d) best = { i, j, n, d };
      }
      if (best) break;
    }
    if (!best) best = { i: cols, j: Math.max(0, Math.floor(rows / 2) - 2), n: 4 };
    const { i, j, n } = best, block = (di, dj) => { const e = E(i + di, j + dj); if (e >= 0) W.blk[e] = 1; };
    for (let dj = 0; dj < n; dj++) for (let di = 0; di < n; di++) { const e = E(i + di, j + dj); if (e >= 0) W.kind[e] = YARD; }
    W.props.push({ k: 'barn', u: i + 1, v2: j + 1 }); block(0, 0); block(1, 0); block(0, 1); block(1, 1);
    W.props.push({ k: 'silo', u: i + 2.5, v2: j + 0.55 }); block(2, 0);
    if (n === 4) {
      W.props.push({ k: 'house', u: i + 3.5, v2: j + 2.6 }); block(3, 2);
      W.props.push({ k: 'tree', t: 'oak', v: 0, u: i + 3.5, v2: j + 0.5 }); block(3, 0);
      W.props.push({ k: 'tree', t: 'pine', v: 1, u: i + 0.5, v2: j + 3.5 }); block(0, 3);
    }
    W.home = [clamp(i + 1.5, 0.5, cols - 0.5), clamp(j + 2.5, 0.5, rows - 0.5)];
    W.yard = [i + n / 2, j + n / 2];
  }

  function worldOf(u, v) { return { x: Math.round((u - v) * 16), y: Math.round((u + v) * 8) }; }

  function look(f, k) {
    const s = st.states[f.field_id], crop = CROP_KEYS.includes(f.crop) ? f.crop : 'other';
    const harvested = !!(s && (s.harvested || s.stage === 'harvested'));
    const planted = crop === 'pasture' || !s || !!s.planted;
    const stage = s ? STAGES[s.stage] ?? 2 : 2, canopy = s && s.canopy != null ? +s.canopy : 0.6;
    const dens = canopy < 0.2 ? 0 : canopy < 0.45 ? 1 : canopy < 0.7 ? 2 : 3;
    const lo = s && s.last_op;
    let wet = !!(lo && lo.op === 'irrigate');
    if (wet && st.today != null && dayNum(lo.date) != null) wet = st.today - dayNum(lo.date) <= 3;
    return { crop, stage: planted ? stage : 0, dens, stress: !!(s && s.health != null && s.health < 60), orient: hash(k, 9) < 0.5 ? 0 : 1, wet, harvested, planted };
  }

  function build() {
    st.dirty = false;
    if (!W) return;
    const { cols, rows } = W, farm = st.farm;
    const minX = (-M - (rows + M - 1)) * 16 - 16, maxX = (cols + M - 1 + M) * 16 + 16, minY = -2 * M * 8 - 48, maxY = (cols + rows + 2 * M - 2) * 8 + 16 + 14;
    const cw = maxX - minX, ch = maxY - minY;
    if (!cache) cache = document.createElement('canvas');
    if (cache.width !== cw || cache.height !== ch) { cache.width = cw; cache.height = ch; }
    const g = cache.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cw, ch); g.imageSmoothingEnabled = false;
    W.ox = -minX; W.oy = -minY;
    const looks = farm.fields.map((f, k) => look(f, k));
    W.dirtField = looks.map((L) => L.harvested || L.stage === 0 || L.crop === 'fallow');
    W.sprinklers = [];
    const winter = st.season === 'winter', sat = satOn();
    for (let j = -M; j < rows + M; j++) for (let i = -M; i < cols + M; i++) {
      const e = E(i, j), kd = W.kind[e], X = (i - j) * 16 + W.ox, Y = (i + j) * 8 + W.oy, h = hash(i, j, 11);
      let L = kd === FIELD ? looks[W.vown[e]] : null;
      if (L && L.wet && i % 4 === 2 && j % 4 === 2 && i < cols && j < rows) W.sprinklers.push({ k: W.vown[e], x: X - W.ox, y: Y - W.oy + 8, ph: hash(i, j, 33) * 6.28 });
      if (sat) {
        if (i === cols + M - 1) g.drawImage(spr.cliff(1), X - 16, Y);
        if (j === rows + M - 1) g.drawImage(spr.cliff(0), X - 16, Y);
        continue;
      }
      if (L) g.drawImage(spr.crop({ ...L, v: h < 0.5 ? 0 : 1 }), X - 16, Y - HEAD);
      else g.drawImage(spr.ground(kd === WATER ? 'water' : kd === ROAD ? 'road' : kd === YARD ? 'yard' : 'grass', Math.floor(h * 4)), X - 16, Y - HEAD);
      for (let s = 0; s < 4; s++) {
        const ne = E(i + NB[s][0], j + NB[s][1]), nk = ne < 0 ? -1 : W.kind[ne];
        if (kd === FIELD && (nk !== FIELD || W.vown[ne] !== W.vown[e])) g.drawImage(spr.edge('rim', s), X - 16, Y);
        else if ((kd === ROAD || kd === YARD) && nk === GRASS) g.drawImage(spr.edge('fringe', s), X - 16, Y);
        else if (kd === WATER && nk >= 0 && nk !== WATER) g.drawImage(spr.edge('shore', s), X - 16, Y);
      }
      if (i === cols + M - 1) g.drawImage(spr.cliff(1), X - 16, Y);
      if (j === rows + M - 1) g.drawImage(spr.cliff(0), X - 16, Y);
      const out = Math.max(-i, i - cols + 1, -j, j - rows + 1), front = i >= cols || j >= rows;
      let obj = null;
      if (out >= (front ? 3 : 1) && hash(i, j, 13) < 0.42) obj = spr.tree(hash(i, j, 17) < 0.35 ? 'pine' : 'oak', Math.floor(hash(i, j, 19) * 3));
      else if (L && L.crop === 'pasture' && !winter && hash(i, j, 21) < 0.05) obj = spr.cow(Math.floor(hash(i, j, 23) * 4));
      else if (L && L.harvested && ['hay', 'alfalfa', 'winter_wheat'].includes(L.crop) && hash(i, j, 25) < 0.08) obj = spr.bale(hash(i, j, 27) < 0.5 ? 0 : 1);
      if (obj) g.drawImage(obj.c, X - obj.ax + Math.round((hash(i, j, 29) - 0.5) * 8), Y + 8 - obj.ay + Math.round((hash(i, j, 31) - 0.5) * 4));
    }
    looks.forEach((L, k) => { if (L.wet && !W.sprinklers.some((s) => s.k === k)) { const lb = W.labels[k]; if (lb && (lb.i % 4 !== 2 || lb.j % 4 !== 2)) W.sprinklers.push({ k, x: (lb.i - lb.j) * 16, y: (lb.i + lb.j) * 8 + 8, ph: k }); } });
    const ov = st.overlay, d = ov.data;
    W.tags = [];
    if (ov.kind === 'ndvi' && d && d.values) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const e = E(i, j), kd = W.kind[e], v = d.values[j * cols + i], X = (i - j) * 16 + W.ox - 16, Y = (i + j) * 8 + W.oy;
        if (kd === WATER) continue;
        if (v == null || isNaN(v)) { if (kd === FIELD) g.drawImage(spr.hatch(), X, Y); continue; }
        g.drawImage(spr.diamond(ramp(NDVI, Math.round(((v - 0.1) / 0.8) * 24) / 24), kd === FIELD ? 0.74 : 0.42), X, Y);
      }
    } else if (ov.kind === 'moisture' && d && d.byField) {
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const e = E(i, j); if (W.kind[e] !== FIELD) continue;
        const v = d.byField[farm.fields[W.vown[e]].field_id], X = (i - j) * 16 + W.ox - 16, Y = (i + j) * 8 + W.oy;
        g.drawImage(v == null || isNaN(v) ? spr.hatch() : spr.diamond(ramp(MOIST, Math.round(v * 20) / 20), 0.74), X, Y);
      }
    } else if ((ov.kind === 'classes' || ov.kind === 'aef') && d && d.byField) {
      const cls = ov.kind === 'classes', tint = farm.fields.map((f) => { const v = d.byField[f.field_id]; return toRgb(cls ? v && v.rgb : v); }), dim = spr.diamond([10, 14, 8], 0.3);
      if (cls) W.tags = farm.fields.map((f, k) => { const v = d.byField[f.field_id]; return v && v.label && tint[k] ? { text: String(v.label).toUpperCase().replace(/[^A-Z0-9 -]/g, ' ').slice(0, 14), rgb: tint[k] } : null; });
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const e = E(i, j); if (W.kind[e] !== FIELD) continue;
        const c = tint[W.vown[e]], X = (i - j) * 16 + W.ox - 16, Y = (i + j) * 8 + W.oy;
        g.drawImage(dim, X, Y); g.drawImage(c ? spr.diamond(c, 0.62) : spr.hatch(), X, Y);
        for (let s = 0; s < 4; s++) { const ne = E(i + NB[s][0], j + NB[s][1]); if (ne < 0 || W.kind[ne] !== FIELD || W.vown[ne] !== W.vown[e]) g.drawImage(spr.edge('rim', s), X, Y); }
      }
    }
  }

  function computeOutline(id) {
    const k = W && W.idx.get(id); if (k == null) return [];
    const segs = [];
    for (const t of st.farm.fields[k].tiles) {
      const i = t % W.cols, j = Math.floor(t / W.cols), X = (i - j) * 16, Y = (i + j) * 8;
      const pts = [[X, Y], [X + 16, Y + 8], [X, Y + 16], [X - 16, Y + 8]], sides = [[3, 0], [0, 1], [1, 2], [2, 3]];
      for (let s = 0; s < 4; s++) { const e = E(i + NB[s][0], j + NB[s][1]); if (e < 0 || W.own[e] !== k) segs.push([...pts[sides[s][0]], ...pts[sides[s][1]]]); }
    }
    return segs;
  }

  function strokeSegs(segs, ox, oy, S) {
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of segs) { ctx.moveTo(ox + x1 * S, oy + y1 * S); ctx.lineTo(ox + x2 * S, oy + y2 * S); }
  }

  function draw() {
    const Wd = canvasEl.width, Ht = canvasEl.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 1;
    ctx.fillStyle = '#0e140c'; ctx.fillRect(0, 0, Wd, Ht);
    if (!W || !cache) return;
    const S = st.S, ox = Math.round(Wd / 2 - st.cam.x * S), oy = Math.round(Ht / 2 - st.cam.y * S), t = st.t;
    ctx.imageSmoothingEnabled = S < 0.999;
    const vis = (x, y, w, h) => ox + (x + w) * S >= 0 && ox + x * S <= Wd && oy + (y + h) * S >= 0 && oy + y * S <= Ht;
    let sx = Math.floor(-ox / S) + W.ox, sy = Math.floor(-oy / S) + W.oy, sw = Math.ceil(Wd / S) + 2, sh = Math.ceil(Ht / S) + 2;
    if (sx < 0) { sw += sx; sx = 0; } if (sy < 0) { sh += sy; sy = 0; }
    sw = Math.min(sw, cache.width - sx); sh = Math.min(sh, cache.height - sy);
    const sat = satOn();
    if (sat) imagery(ox, oy, S);
    ctx.imageSmoothingEnabled = S < 0.999;
    if (S < 1) ctx.drawImage(cache, ox - W.ox * S, oy - W.oy * S, cache.width * S, cache.height * S);
    else if (sw > 0 && sh > 0) ctx.drawImage(cache, sx, sy, sw, sh, ox + (sx - W.ox) * S, oy + (sy - W.oy) * S, sw * S, sh * S);
    if (sat) fieldLines(ox, oy, S);
    if (!st.low && !sat) {
      const sh0 = spr.shimmer(Math.floor(t / 0.7) % 2);
      for (const [i, j] of W.water) { const X = (i - j) * 16 - 16, Y = (i + j) * 8; if (vis(X, Y, 32, 16)) ctx.drawImage(sh0, ox + X * S, oy + Y * S, 32 * S, 16 * S); }
    }
    for (const s of W.sprinklers) {
      if (!vis(s.x - 16, s.y - 16, 32, 24)) continue;
      ctx.fillStyle = '#4a5258'; ctx.fillRect(ox + (s.x - 1) * S, oy + (s.y - 5) * S, 2 * S, 5 * S);
      ctx.fillStyle = '#c9e6fa';
      const a = t * 1.3 + s.ph;
      for (let q = 0; q < 9; q++) {
        const ph = (t * 1.8 + q / 9) % 1, r = ph * 13, hgt = ph * (1 - ph) * 16;
        ctx.globalAlpha = 0.9 * (1 - ph * 0.7);
        ctx.fillRect(ox + Math.round(s.x + Math.cos(a) * r) * S, oy + Math.round(s.y - 5 + Math.sin(a) * r * 0.5 - hgt) * S, S, S);
        ctx.fillRect(ox + Math.round(s.x + Math.cos(a + 3.14) * r * 0.6) * S, oy + Math.round(s.y - 5 + Math.sin(a + 3.14) * r * 0.3 - hgt * 0.6) * S, S, S);
      }
      ctx.globalAlpha = 1;
    }
    const selPoly = sat && st.selected && W.polys[W.idx.get(st.selected)];
    if (selPoly || st.outline.length) {
      ctx.save();
      if (selPoly) { clipGround(ox, oy, S, 0); polyPath(selPoly, ox, oy, S); } else strokeSegs(st.outline, ox, oy, S);
      ctx.lineCap = 'square'; ctx.strokeStyle = 'rgba(10,16,8,0.55)'; ctx.lineWidth = 4 * st.dprI; ctx.setLineDash([]); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2 * st.dprI; ctx.setLineDash([6 * st.dprI, 4 * st.dprI]); ctx.lineDashOffset = -t * 24 * st.dprI; ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    const items = [];
    for (const p of W.props) {
      if (sat && p.deco) continue;
      const sp = p.k === 'tree' ? spr.tree(p.t, p.v) : spr[p.k](), X = Math.round((p.u - p.v2) * 16), Y = Math.round((p.u + p.v2) * 8);
      if (vis(X - sp.ax, Y - sp.ay, sp.c.width, sp.c.height)) items.push({ d: p.u + p.v2, sp, X, Y });
    }
    const tr = st.tractor, tp = worldOf(tr.u, tr.v);
    items.push({ d: tr.u + tr.v, sp: spr.tractor(tr.dir, tr.fr), X: tp.x, Y: tp.y });
    for (const p of st.dust) items.push({ d: p.d, dust: p });
    items.sort((a, b) => a.d - b.d);
    for (const it of items) {
      if (it.dust) {
        const p = it.dust, s = Math.max(1, Math.round(p.s));
        ctx.globalAlpha = 0.6 * (1 - p.age / p.life); ctx.fillStyle = p.c;
        ctx.fillRect(ox + Math.round(p.x - s / 2) * S, oy + Math.round(p.y - p.z - s / 2) * S, s * S, s * S);
        ctx.globalAlpha = 1;
      } else ctx.drawImage(it.sp.c, ox + (it.X - it.sp.ax) * S, oy + (it.Y - it.sp.ay) * S, it.sp.c.width * S, it.sp.c.height * S);
    }
    drawFx(ox, oy, S, vis);
    ctx.imageSmoothingEnabled = false;
    const L = Math.max(2, Math.round((st.zoom >= 2 ? 3 : st.zoom >= 0.9 ? 2 : 1.5) * st.dprI));
    for (const lb of W.labels) {
      const c = spr.label(lb.name, lb.id === st.selected), X = (lb.i - lb.j) * 16, Y = (lb.i + lb.j) * 8 - 2;
      const lx = Math.round(ox + X * S - (c.width * L) / 2), ly = Math.round(oy + Y * S - (c.height * L) / 2);
      if (lx + c.width * L < 0 || lx > Wd || ly + c.height * L < 0 || ly > Ht) continue;
      ctx.drawImage(c, lx, ly, c.width * L, c.height * L);
      const tg = W.tags[lb.k];
      if (tg) { const tc = spr.label(tg.text, false, tg.rgb); ctx.drawImage(tc, Math.round(ox + X * S - (tc.width * L) / 2), ly + (c.height + 1) * L, tc.width * L, tc.height * L); }
    }
    roadNames(ox, oy, S, Wd, Ht);
    weather(Wd, Ht);
  }

  function clipGround(ox, oy, S, m) {
    const pt = (u, v) => [ox + 16 * (u - v) * S, oy + 8 * (u + v) * S], a = pt(-m, -m), b = pt(W.cols + m, -m), c = pt(W.cols + m, W.rows + m), d = pt(-m, W.rows + m);
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(d[0], d[1]); ctx.closePath(); ctx.clip();
  }

  function imagery(ox, oy, S) {
    const im = st.imagery;
    let k = 0, c = im.levels[0], ku = (im.u1 - im.u0) / c.width, kv = (im.v1 - im.v0) / c.height;
    while (k < im.levels.length - 1 && 17.9 * S * Math.min(ku, kv) < 0.75) { c = im.levels[++k]; ku = (im.u1 - im.u0) / c.width; kv = (im.v1 - im.v0) / c.height; }
    ctx.save();
    clipGround(ox, oy, S, M);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.setTransform(16 * S * ku, 8 * S * ku, -16 * S * kv, 8 * S * kv, ox + 16 * (im.u0 - im.v0) * S, oy + 8 * (im.u0 + im.v0) * S);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  function addRings(rings, ox, oy, S) {
    for (const r of rings) { ctx.moveTo(ox + r[0] * S, oy + r[1] * S); for (let q = 2; q < r.length; q += 2) ctx.lineTo(ox + r[q] * S, oy + r[q + 1] * S); ctx.closePath(); }
  }
  function polyPath(rings, ox, oy, S) { ctx.beginPath(); addRings(rings, ox, oy, S); }

  function fieldLines(ox, oy, S) {
    ctx.save();
    clipGround(ox, oy, S, 0);
    ctx.beginPath();
    for (const rings of W.polys) if (rings) addRings(rings, ox, oy, S);
    ctx.lineJoin = 'round'; ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(10, 16, 8, 0.3)'; ctx.lineWidth = 2.5 * st.dprI; ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 246, 214, 0.6)'; ctx.lineWidth = st.dprI; ctx.stroke();
    ctx.restore();
  }

  function roadNames(ox, oy, S, Wd, Ht) {
    if (!W.roadLabels.length || st.zoom < 0.6) return;
    const px = Math.round((st.zoom >= 2 ? 11 : 9) * st.dprI), pad = px * 6;
    ctx.font = '700 ' + px + 'px ui-monospace, Menlo, Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(2, Math.round(2.5 * st.dprI)); ctx.strokeStyle = 'rgba(14, 20, 12, 0.8)'; ctx.fillStyle = 'rgba(244, 241, 222, 0.92)';
    for (const r of W.roadLabels) {
      const x = ox + ((r.i - r.j) * 16) * S, y = oy + ((r.i + r.j) * 8 + 8) * S;
      if (x < -pad || x > Wd + pad || y < -pad || y > Ht + pad) continue;
      ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.rotate(r.ang);
      ctx.strokeText(r.name, 0, 0); ctx.fillText(r.name, 0, 0);
      ctx.restore();
    }
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
  }

  function drawFx(ox, oy, S, vis) {
    for (const f of st.fx) {
      if (f.kind === 'stress') {
        if (!f.segs.length) continue;
        strokeSegs(f.segs, ox, oy, S);
        ctx.globalAlpha = Math.abs(Math.sin(f.t * Math.PI * 2)) * (1 - (f.t / f.dur) * 0.4);
        ctx.lineCap = 'square'; ctx.setLineDash([]); ctx.strokeStyle = 'rgba(60,0,0,0.6)'; ctx.lineWidth = 5 * st.dprI; ctx.stroke();
        ctx.strokeStyle = '#ff4433'; ctx.lineWidth = 3 * st.dprI; ctx.stroke();
        ctx.globalAlpha = 1;
        continue;
      }
      for (const q of f.parts) {
        const age = f.t - q.d; if (age < 0) continue;
        let name, x = q.x, y = q.y, a = 1, p;
        if (f.kind === 'plant') {
          p = age / 0.7; if (p > 1) continue;
          if (p < 0.5) { name = 'seed'; y -= 22 * (1 - (p / 0.5) ** 2); } else { name = 'sprout'; a = p > 0.8 ? (1 - p) / 0.2 : 1; }
        } else if (f.kind === 'irrigate') {
          p = age / 0.55; if (p > 1.45) continue;
          if (p <= 1) { name = 'drop'; x = q.x + (q.x1 - q.x) * p; y = q.y + (q.y1 - q.y) * p - 4 - q.h * 4 * p * (1 - p) * (1 - p * 0.3); } else { name = 'splash'; x = q.x1; y = q.y1 + 1; a = (1.45 - p) / 0.45; }
        } else if (f.kind === 'spray') {
          p = age / 0.9; if (p > 1) continue;
          name = 'mist' + Math.min(2, Math.floor(p * 3)); x += q.vx * p; y -= 5 + p * 9; a = 0.9 * (1 - p * p);
        } else {
          p = age / (q.g ? 0.55 : 0.8); if (p > 1) continue;
          if (q.g) name = p < 0.3 || p > 0.75 ? 'glint0' : 'glint1';
          else { name = 'speck'; x += q.vx * p; y -= 3 + p * 16; a = 1 - p; }
        }
        const sp = spr.fx(name), X = Math.round(x) - sp.ax, Y = Math.round(y) - sp.ay;
        if (!vis(X, Y, sp.c.width, sp.c.height)) continue;
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.drawImage(sp.c, ox + X * S, oy + Y * S, sp.c.width * S, sp.c.height * S);
      }
      ctx.globalAlpha = 1;
    }
  }

  function weather(Wd, Ht) {
    const wx = st.weather || {}, precip = +wx.precip || 0, snow = st.season === 'winter', u = st.dprI;
    if (precip > 0.5) {
      ctx.fillStyle = snow ? 'rgba(220,230,240,0.10)' : 'rgba(24,34,54,0.20)'; ctx.fillRect(0, 0, Wd, Ht);
      const n = st.low ? 0 : Math.min(420, Math.round(80 + precip * 18));
      while (st.rain.length < n) st.rain.push({ x: Math.random(), y: Math.random(), s: 0.7 + Math.random() * 0.6 });
      st.rain.length = n;
      ctx.fillStyle = snow ? 'rgba(250,252,255,0.9)' : 'rgba(170,200,240,0.65)';
      for (const r of st.rain) {
        const x = Math.round(r.x * Wd), y = Math.round(r.y * Ht);
        if (snow) ctx.fillRect(x, y, 2 * u, 2 * u);
        else { ctx.fillRect(x, y, u, 4 * u); ctx.fillRect(x - u, y + 4 * u, u, 4 * u); }
      }
    } else st.rain.length = 0;
    if (+wx.tmax >= 32) { ctx.fillStyle = 'rgba(255,164,64,0.13)'; ctx.fillRect(0, 0, Wd, Ht); }
  }

  function free(u, v) {
    if (u < 0 || v < 0 || u >= W.cols || v >= W.rows) return false;
    return !W.blk[E(Math.floor(u), Math.floor(v))];
  }

  function input() {
    st.lastInput = st.t; st.idleFired = false; st.cineForce = false;
    if (st.cineOn) { st.cineOn = false; if (!st.fly) st.follow = true; }
  }

  function endFly(done) {
    const f = st.fly; if (!f) return;
    st.fly = null;
    if (done) { st.cam.x = f.x1; st.cam.y = f.y1; st.zoom = st.zr = f.z1; } else st.zr = st.zoom >= 1 ? clamp(Math.round(st.zoom), 1, 4) : st.zoom;
    st.S = st.zoom * st.dprI;
    f.resolve({ fieldId: f.fieldId, cancelled: !done });
  }

  function targetOf(tg, o) {
    const { cols, rows } = W, fit = (w, h) => Math.min((st.cssW || 1) / w, (st.cssH || 1) / h), z = o.zoom != null ? +o.zoom : null;
    if (tg === 'overview') {
      const p = worldOf(cols / 2, rows / 2), f = fit((cols + rows) * 16 + 48, (cols + rows) * 8 + 96);
      return { x: p.x, y: p.y - 6, z: z ?? (f >= 1 ? Math.min(4, Math.floor(f)) : Math.max(0.2, f)), fieldId: null };
    }
    if (tg === 'farmstead') { const p = worldOf(W.yard[0], W.yard[1]); return { x: p.x, y: p.y - 14, z: z ?? Math.max(2, Math.round(st.zr)), fieldId: null }; }
    if (tg && typeof tg === 'object' && isFinite(tg.i) && isFinite(tg.j)) {
      const p = worldOf(+tg.i + 0.5, +tg.j + 0.5);
      return { x: p.x, y: p.y, z: z ?? Math.max(2, Math.round(st.zr)), fieldId: fieldAt(Math.floor(tg.i), Math.floor(tg.j)) };
    }
    const k = W.idx.get(tg); if (k == null) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const t of st.farm.fields[k].tiles) { const i = t % cols, j = Math.floor(t / cols), X = (i - j) * 16, Y = (i + j) * 8; x0 = Math.min(x0, X - 16); x1 = Math.max(x1, X + 16); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y + 16); }
    return { x: Math.round((x0 + x1) / 2), y: Math.round((y0 + y1) / 2), z: z ?? clamp(Math.floor(fit((x1 - x0) * 1.3 + 64, (y1 - y0) * 1.6 + 96)), 1, 3), fieldId: tg };
  }

  function flyTo(target, o) {
    o = o || {};
    if (st.fly) endFly(false);
    if (!W) return Promise.resolve({ fieldId: null, cancelled: true });
    const tg = targetOf(target, o);
    if (!tg) return Promise.resolve({ fieldId: null, cancelled: true });
    st.cineOn = false; st.follow = false; st.userZoom = false;
    const z1 = clamp(+tg.z || 1, 0.2, 4), d = Math.hypot(tg.x - st.cam.x, tg.y - st.cam.y), raw = o.duration != null ? +o.duration : NaN;
    const dur = isFinite(raw) ? Math.max(0, raw > 20 ? raw / 1000 : raw) : clamp(0.7 + d / 900 + Math.abs(z1 - st.zoom) * 0.15, 0.8, 2.4);
    return new Promise((resolve) => {
      st.fly = { x0: st.cam.x, y0: st.cam.y, z0: st.zoom, x1: tg.x, y1: tg.y, z1, dip: Math.min(Math.min(st.zoom, z1) * 0.35, d / 2400), t: 0, dur, fieldId: tg.fieldId, resolve };
      if (dur === 0) endFly(true);
    });
  }

  function effect(kind, id) {
    const k = W && W.idx.get(id); if (k == null || !FX[kind]) return;
    const tiles = st.farm.fields[k].tiles, R = Math.random, cnt = (f, a, b) => Math.round(clamp(tiles.length * f, a, b) * (st.low ? 0.5 : 1));
    const at = () => { const t = tiles[(R() * tiles.length) | 0]; return worldOf((t % W.cols) + 0.15 + R() * 0.7, Math.floor(t / W.cols) + 0.15 + R() * 0.7); };
    const parts = [];
    if (kind === 'plant') for (let n = cnt(0.8, 12, 64); n-- > 0;) parts.push({ ...at(), d: R() * 0.8 });
    else if (kind === 'irrigate') for (let m = cnt(1 / 12, 2, 6); m-- > 0;) { const p = at(); for (let n = 0; n < 9; n++) { const a = R() * 6.283, r = 8 + R() * 14; parts.push({ x: p.x, y: p.y, x1: Math.round(p.x + Math.cos(a) * r), y1: Math.round(p.y + Math.sin(a) * r * 0.5), h: 8 + R() * 8, d: R() * 0.9 }); } }
    else if (kind === 'spray') for (let n = cnt(0.6, 10, 36); n-- > 0;) parts.push({ ...at(), d: R() * 0.6, vx: (R() - 0.5) * 12 });
    else if (kind === 'harvest') for (let n = cnt(1, 14, 50); n-- > 0;) parts.push({ ...at(), d: R() * 0.9, g: R() < 0.45, vx: (R() - 0.5) * 8 });
    st.fx.push({ kind, t: 0, dur: 1.6, parts, segs: kind === 'stress' ? computeOutline(id) : [] });
    if (st.fx.length > 8) st.fx.shift();
  }

  function step(dt) {
    st.t += dt;
    if (!W) return;
    const k = st.keys, tr = st.tractor, js = st.joy, was = tr.moving;
    let di = 0, dj = 0, mag = 1;
    if (k.ArrowUp || k.w) { di -= 1; dj -= 1; } if (k.ArrowDown || k.s) { di += 1; dj += 1; }
    if (k.ArrowLeft || k.a) { di -= 1; dj += 1; } if (k.ArrowRight || k.d) { di += 1; dj -= 1; }
    if (!di && !dj && js) { const m = Math.hypot(js.dx, js.dy); if (m > 0.15) { di = js.dx + js.dy; dj = js.dy - js.dx; mag = Math.min(1, m); } }
    const fast = k.Shift || (js && js.fast);
    tr.moving = !!(di || dj) && !k[' '];
    const ci = Math.floor(tr.u), cj = Math.floor(tr.v), here = kindAt(ci, cj);
    if (tr.moving) {
      input(); if (st.fly) endFly(false); if (st.zr < 1 && !st.userZoom) st.zr = 1;
      const n = Math.hypot(di, dj); di /= n; dj /= n;
      const sp = (fast ? 9 : 5) * mag * (here === WATER ? 0.45 : 1) * dt, nu = tr.u + di * sp, nv = tr.v + dj * sp;
      const stuck = !free(tr.u, tr.v) && tr.u >= 0 && tr.v >= 0;
      if (stuck || free(nu, nv)) { tr.u = clamp(nu, 0, W.cols - 0.001); tr.v = clamp(nv, 0, W.rows - 0.001); }
      else if (free(nu, tr.v)) tr.u = nu; else if (free(tr.u, nv)) tr.v = nv;
      tr.dir = ((Math.round(Math.atan2(dj, di) / (Math.PI / 4)) % 8) + 8) % 8;
      tr.anim += dt * (fast ? 14 : 9) * Math.max(0.5, mag); tr.fr = Math.floor(tr.anim) % 2;
      st.follow = true;
      const L = here === FIELD ? W.dirtField[W.vown[E(ci, cj)]] : here === ROAD || here === YARD || here === WATER;
      tr.dustT -= dt;
      if (L && !st.low && tr.dustT <= 0) {
        tr.dustT = 0.05;
        const p = worldOf(tr.u - di * 0.45, tr.v - dj * 0.45);
        st.dust.push({ x: p.x + (Math.random() - 0.5) * 6, y: p.y + (Math.random() - 0.5) * 3, z: 0, s: 2, age: 0, life: 0.55 + Math.random() * 0.35, d: tr.u + tr.v - (di + dj) * 0.45, c: here === WATER ? '#cfe6f4' : st.season === 'winter' ? '#f2f6f8' : '#c8ad7f' });
        if (st.dust.length > 90) st.dust.shift();
      }
      const ni = Math.floor(tr.u), nj = Math.floor(tr.v), fid = fieldAt(ni, nj);
      if (fid !== tr.fieldId) { tr.fieldId = fid; emit('tractor', { i: ni, j: nj, fieldId: fid }); if (fid) selectField(fid, true); }
    }
    if (tr.moving !== was) emit('drive', tr.moving);
    for (const p of st.dust) { p.age += dt; p.z += dt * 7; p.s += dt * 5; }
    st.dust = st.dust.filter((p) => p.age < p.life);
    for (const f of st.fx) f.t += dt;
    if (st.fx.length) st.fx = st.fx.filter((f) => f.t < f.dur);
    for (const r of st.rain) {
      if (st.season === 'winter') { r.y += dt * 0.08 * r.s; r.x += Math.sin(st.t * 2 + r.s * 9) * dt * 0.01; } else { r.y += dt * 0.9 * r.s; r.x -= dt * 0.18 * r.s; }
      if (r.y > 1) { r.y -= 1; r.x = Math.random(); } if (r.x < 0) r.x += 1; if (r.x > 1) r.x -= 1;
    }
    const idle = st.t - st.lastInput;
    if (!st.idleFired && idle >= 20) { st.idleFired = true; emit('idle', Math.round(idle)); }
    st.cineOn = st.cine && !st.fly && !st.drag && !st.pinch && (st.cineForce || idle > 10);
    if (st.fly) {
      const f = st.fly; f.t += dt;
      const p = Math.min(1, f.t / (f.dur || 1)), e = ease(p);
      st.cam.x = f.x0 + (f.x1 - f.x0) * e; st.cam.y = f.y0 + (f.y1 - f.y0) * e;
      st.zoom = f.z0 + (f.z1 - f.z0) * e - f.dip * Math.sin(Math.PI * e);
      if (p >= 1) endFly(true);
    } else if (st.cineOn) {
      st.cineT += dt; st.follow = false;
      const c = st.cineT, p = worldOf(W.cols * (0.5 + 0.3 * Math.sin(c * 0.045)), W.rows * (0.5 + 0.3 * Math.sin(c * 0.033 + 1.3))), f = Math.min(1, dt * 0.6);
      st.cam.x += (p.x - st.cam.x) * f; st.cam.y += (p.y - st.cam.y) * f;
    } else if (st.follow) { const p = worldOf(tr.u, tr.v), f = Math.min(1, dt * 4); st.cam.x += (p.x - st.cam.x) * f; st.cam.y += (p.y - 8 - st.cam.y) * f; }
    if (!st.fly && st.zoom !== st.zr) { st.zoom += (st.zr - st.zoom) * Math.min(1, dt * 6); if (Math.abs(st.zr - st.zoom) < 0.01) st.zoom = st.zr; }
    st.S = st.zoom * st.dprI;
  }

  function loop(ts) {
    st.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - st.last) / 1000 || 0); st.last = ts;
    try {
      if (canvasEl.clientWidth !== st.cw || canvasEl.clientHeight !== st.ch) resize();
      step(dt); if (st.dirty) build(); draw();
    } catch (e) { if (!st.err) { st.err = true; console.error(e); } }
  }

  function selectField(id, emitIt) {
    st.selected = id || null; st.outline = st.selected ? computeOutline(st.selected) : [];
    if (emitIt !== false) emit('select', st.selected);
  }
  function onKey(e, down) {
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    if (e.target && e.target.isContentEditable) return;
    if (down && (e.metaKey || e.ctrlKey || e.altKey)) return;
    if (down) input();
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    st.keys[k] = down; st.keys.Shift = e.shiftKey;
    const ops = { i: 'irrigate', p: 'plant', h: 'harvest', x: 'spray' };
    if (down && !e.repeat && st.tractor.fieldId && k in ops) emit('op', { op: ops[k], fieldId: st.tractor.fieldId });
    if (down && (k === '=' || k === '+')) zoomBy(1, null); else if (down && (k === '-' || k === '_')) zoomBy(-1, null);
  }
  function toBacking(e) { const r = canvasEl.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvasEl.width / (r.width || 1)), y: (e.clientY - r.top) * (canvasEl.height / (r.height || 1)) }; }
  function pick(e) {
    if (!W) return;
    const b = toBacking(e), S = st.S, ox = Math.round(canvasEl.width / 2 - st.cam.x * S), oy = Math.round(canvasEl.height / 2 - st.cam.y * S);
    const px = (b.x - ox) / S, py = (b.y - oy) / S, i = Math.floor(px / 32 + py / 16), j = Math.floor(py / 16 - px / 32);
    if (i < 0 || j < 0 || i >= W.cols || j >= W.rows) return selectField(null);
    selectField(fieldAt(i, j));
  }
  function endDrag() {
    const d = st.drag; if (!d) return;
    st.drag = null; canvasEl.style.cursor = '';
    try { if (d.id != null) canvasEl.releasePointerCapture(d.id); } catch (err) { d.id = null; }
  }
  function onDown(e) {
    if (e.button !== 0) return;
    st.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (st.ptrs.size >= 2) {
      const [a, b] = [...st.ptrs.values()];
      st.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1 }; endDrag(); return;
    }
    st.drag = { x: e.clientX, y: e.clientY, cx: st.cam.x, cy: st.cam.y, moved: false, id: e.pointerId };
    try { canvasEl.setPointerCapture(e.pointerId); } catch (err) { st.drag.id = null; }
  }
  function onMove(e) {
    const q = st.ptrs.get(e.pointerId); if (q) { q.x = e.clientX; q.y = e.clientY; }
    if (st.pinch && st.ptrs.size >= 2) {
      const [a, b] = [...st.ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), r = d / st.pinch.d;
      if (r > 1.3 || r < 0.77) { zoomBy(r > 1 ? 1 : -1, toBacking({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })); st.pinch.d = d; }
      return;
    }
    const d = st.drag; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; canvasEl.style.cursor = 'grabbing'; if (st.fly) endFly(false); d.cx = st.cam.x; d.cy = st.cam.y; d.x = e.clientX; d.y = e.clientY; }
    if (d.moved) { st.follow = false; st.cam.x = d.cx - ((e.clientX - d.x) * st.bpc) / st.S; st.cam.y = d.cy - ((e.clientY - d.y) * st.bpc) / st.S; }
  }
  function onUp(e) {
    st.ptrs.delete(e.pointerId); if (st.ptrs.size < 2) st.pinch = null;
    const d = st.drag; if (!d) return;
    endDrag();
    if (!d.moved && e.type === 'pointerup') pick(e);
  }
  function minZoom() {
    if (!W) return 0.5;
    const f = Math.min((st.cssW || 1) / ((W.cols + W.rows + 2 * M) * 16), (st.cssH || 1) / ((W.cols + W.rows + 2 * M) * 8 + 64));
    return clamp(f * 0.6, 0.1, 0.5);
  }
  function zoomStep(z, dir) {
    if (dir > 0) return z < 1 ? (z * 1.25 >= 0.95 ? 1 : z * 1.25) : Math.min(4, Math.floor(z + 0.01) + 1);
    if (z > 1) return Math.max(1, Math.ceil(z - 0.01) - 1);
    return Math.max(minZoom(), z / 1.25);
  }
  function zoomBy(dir, b) {
    if (st.fly) endFly(false);
    const z = zoomStep(st.zr, dir);
    st.userZoom = true;
    if (z === st.zr && z === st.zoom) return;
    const S0 = st.S, S1 = z * st.dprI;
    if (!st.follow && b) {
      const Wd = canvasEl.width, Ht = canvasEl.height;
      const wx = (b.x - Math.round(Wd / 2 - st.cam.x * S0)) / S0, wy = (b.y - Math.round(Ht / 2 - st.cam.y * S0)) / S0;
      st.cam.x = (Wd / 2 - b.x) / S1 + wx; st.cam.y = (Ht / 2 - b.y) / S1 + wy;
    }
    st.zoom = st.zr = z; st.S = S1;
  }
  function onWheel(e) {
    e.preventDefault(); input();
    const now = performance.now();
    if (now - st.wheelT > 250) st.wheelAcc = 0;
    st.wheelT = now; st.wheelAcc += e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
    if (Math.abs(st.wheelAcc) < 40) return;
    const dir = st.wheelAcc < 0 ? 1 : -1; st.wheelAcc = 0;
    zoomBy(dir, toBacking(e));
  }
  function resize() {
    const r = canvasEl.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (canvasEl.width !== w) canvasEl.width = w;
    if (canvasEl.height !== h) canvasEl.height = h;
    st.cssW = r.width; st.cssH = r.height; st.cw = canvasEl.clientWidth; st.ch = canvasEl.clientHeight; st.bpc = r.width ? w / r.width : dpr;
    st.dprI = dpr >= 1.5 ? 2 : 1; st.S = st.zoom * st.dprI;
    ctx.imageSmoothingEnabled = false;
  }
  const blur = () => { st.keys = {}; };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false), anyDown = () => input();
  const L = [[window, 'keydown', kd], [window, 'keyup', ku], [window, 'blur', blur], [window, 'pointerdown', anyDown, true], [canvasEl, 'pointerdown', onDown], [canvasEl, 'pointermove', onMove],
    [canvasEl, 'pointerup', onUp], [canvasEl, 'pointercancel', onUp], [canvasEl, 'wheel', onWheel, { passive: false }]];
  for (const [t, n, f, o] of L) t.addEventListener(n, f, o);
  canvasEl.style.touchAction = 'none';
  resize(); st.raf = requestAnimationFrame(loop);

  return {
    setFarm,
    setRoads,
    setStates: (s) => { st.states = s || {}; st.dirty = true; },
    setSeason: (s) => { const v = ['spring', 'summer', 'autumn', 'winter'].includes(s) ? s : 'summer'; if (v !== st.season) { st.season = v; spr = createSprites(v); st.dirty = true; } },
    setWeather: (w) => { st.weather = w || null; const d = dayNum(w && w.date); if (d !== st.today) { st.today = d; st.dirty = true; } },
    setOverlay: (kind, data) => { st.overlay = { kind: kind || 'none', data: data || null }; st.dirty = true; },
    selectField: (id) => selectField(id, false),
    on: (k, fn) => { (handlers[k] ||= []).push(fn); },
    tractor: () => ({ i: Math.floor(st.tractor.u), j: Math.floor(st.tractor.v), dir: st.tractor.dir, fieldId: st.tractor.fieldId, moving: st.tractor.moving }),
    flyTo,
    setCinematic: (on) => { st.cine = !!on; st.cineForce = !!on; if (!on && st.cineOn) { st.cineOn = false; if (!st.fly) st.follow = true; } },
    setInput: (v) => {
      const dx = v ? clamp(+v.dx || 0, -1, 1) : 0, dy = v ? clamp(+v.dy || 0, -1, 1) : 0;
      st.joy = dx || dy ? { dx, dy, fast: !!v.fast } : null;
      if (st.joy) input();
    },
    setQuality: (q) => { const low = q === 'low'; if (low !== st.low) { st.low = low; if (low) { st.dust = []; st.rain = []; } resize(); } },
    effect,
    zoomBy: (dir) => { input(); zoomBy(dir > 0 ? 1 : -1, null); },
    groundBox,
    setImagery,
    setBasemap: (kind) => { const v = kind === 'satellite' ? 'satellite' : 'farm'; if (v !== st.base) { st.base = v; st.dirty = true; } },
    resize,
  };
}
