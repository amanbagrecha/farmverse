const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
const ML_JS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', ML_CSS = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
const ML_SRI = { js: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj', css: 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V' };
const GLYPHS = 'https://tiles.basemaps.cartocdn.com/fonts/{fontstack}/{range}.pbf';
export const BASEMAPS = [['satellite', 'Satellite'], ['streets', 'Streets']];
let mlPromise = null;
export function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (mlPromise) return mlPromise;
  mlPromise = new Promise((res, rej) => {
    if (!document.querySelector('link[href="' + ML_CSS + '"]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = ML_CSS; l.integrity = ML_SRI.css; l.crossOrigin = 'anonymous'; document.head.appendChild(l); }
    const s = document.createElement('script'); s.src = ML_JS; s.integrity = ML_SRI.js; s.crossOrigin = 'anonymous'; s.onload = () => (window.maplibregl ? res(window.maplibregl) : rej(new Error('MapLibre did not load')));
    s.onerror = () => { mlPromise = null; rej(new Error('Could not reach unpkg.com for MapLibre')); }; document.head.appendChild(s);
  });
  return mlPromise;
}
export const IMAGERY_CREDIT = 'Imagery © Esri, Maxar, Earthstar Geographics';
const mercX = (lon) => (lon + 180) / 360;
const mercY = (lat) => { const s = Math.sin((lat * Math.PI) / 180); return 0.5 - Math.atanh(Math.max(-0.9999, Math.min(0.9999, s))) / (2 * Math.PI); };
const lonOf = (x) => x * 360 - 180;
const latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
function tileImage(url) {
  return new Promise((res, rej) => {
    const img = new Image(); img.crossOrigin = 'anonymous'; img.decoding = 'async';
    img.onload = () => res(img); img.onerror = () => rej(new Error('tile failed'));
    img.src = url;
  });
}
export async function loadImagery(box, { maxPx = 4096, maxTiles = 256, zMax = 18 } = {}) {
  const X0 = mercX(box[0]), X1 = mercX(box[2]), Y0 = mercY(box[3]), Y1 = mercY(box[1]);
  if (!(X1 > X0 && Y1 > Y0)) throw new Error('empty box');
  let z = zMax;
  for (; z > 2; z--) {
    const n = 2 ** z, w = (X1 - X0) * n * 256, h = (Y1 - Y0) * n * 256, tiles = (Math.floor(X1 * n) - Math.floor(X0 * n) + 1) * (Math.floor(Y1 * n) - Math.floor(Y0 * n) + 1);
    if (Math.max(w, h) <= maxPx && tiles <= maxTiles) break;
  }
  const n = 2 ** z, px0 = Math.round(X0 * n * 256), py0 = Math.round(Y0 * n * 256), px1 = Math.round(X1 * n * 256), py1 = Math.round(Y1 * n * 256);
  const c = document.createElement('canvas'); c.width = Math.max(1, px1 - px0); c.height = Math.max(1, py1 - py0);
  const g = c.getContext('2d'), jobs = [];
  let failed = 0;
  for (let ty = Math.floor(py0 / 256); ty <= Math.floor((py1 - 1) / 256); ty++) for (let tx = Math.floor(px0 / 256); tx <= Math.floor((px1 - 1) / 256); tx++) {
    jobs.push(tileImage(ESRI + 'World_Imagery/MapServer/tile/' + z + '/' + ty + '/' + tx).then((img) => g.drawImage(img, tx * 256 - px0, ty * 256 - py0), () => { failed++; }));
  }
  await Promise.all(jobs);
  if (failed === jobs.length) throw new Error('could not reach Esri World Imagery');
  return { canvas: c, z, failed, box: [lonOf(px0 / n / 256), latOf(py1 / n / 256), lonOf(px1 / n / 256), latOf(py0 / n / 256)] };
}
export function basemapStyle(kind) {
  if (kind === 'streets') return 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
  return {
    version: 8,
    glyphs: GLYPHS,
    sources: {
      imagery: { type: 'raster', tiles: [ESRI + 'World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
      roads: { type: 'raster', tiles: [ESRI + 'Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
      places: { type: 'raster', tiles: [ESRI + 'Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
    },
    layers: [
      { id: 'imagery', type: 'raster', source: 'imagery' },
      { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.9 } },
      { id: 'places', type: 'raster', source: 'places' },
    ],
  };
}
