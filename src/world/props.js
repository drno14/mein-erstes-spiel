import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './noise.js';

// Alle Objekte sind Low-Poly mit Vertexfarben → ein Material für alles, wenige Draw-Calls.
// DoubleSide: Dach- und Giebelflächen sind von beiden Seiten sichtbar, egal wie sie gewunden sind.
export const propMaterial = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.85, flatShading: true, side: THREE.DoubleSide,
});

/** Einheitliches Format: nicht-indiziert, nur position/normal/color. */
function paint(geo, hex) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
const merge = (parts) => mergeGeometries(parts, false);

function jitter(geo, amount, rand) {
  const p = geo.attributes.position;
  // gleiche Ecke → gleicher Versatz, damit keine Löcher entstehen
  const seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]);
    const d = seen.get(key);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  return geo;
}

// ---------- Bäume, Tannen, Büsche, Felsen ----------
function makeTree(rand, leafHex) {
  const trunk = paint(new THREE.CylinderGeometry(0.16, 0.24, 1.8, 6).translate(0, 0.9, 0), 0x6b4428);
  const crowns = [[0, 2.3, 0, 1.15], [0.45, 2.9, 0.2, 0.85], [-0.35, 3.15, -0.25, 0.75]].map(([x, y, z, s]) =>
    paint(jitter(new THREE.IcosahedronGeometry(s, 1), 0.18, rand).translate(x, y, z), leafHex));
  return merge([trunk, ...crowns]);
}
function makeFir(hex) {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.18, 1.0, 6).translate(0, 0.5, 0), 0x5a3a22);
  const tiers = [[1.35, 1.5, 1.4], [1.05, 1.3, 2.3], [0.7, 1.1, 3.05]].map(([r, h, y]) =>
    paint(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), hex));
  return merge([trunk, ...tiers]);
}
function makeBush(rand, hex) {
  return paint(jitter(new THREE.IcosahedronGeometry(0.7, 1), 0.2, rand).scale(1, 0.7, 1).translate(0, 0.35, 0), hex);
}
function makeRock(rand, hex) {
  return paint(jitter(new THREE.IcosahedronGeometry(1, 0), 0.5, rand).scale(1, 0.65, 0.85).translate(0, 0.2, 0), hex);
}

// ---------- Häuser ----------
const WALLS = [0xebd9b4, 0xe2a08f, 0x9fbfd8, 0xf0cf6c, 0xd8d8d0, 0xc9a27c];
const ROOFS = [0x9e2b1c, 0x5a3420, 0x3f454d, 0x7a3b22];

function box(w, h, d, x, y, z, hex) { return paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex); }

function roofGeometry(w, d, rh, ov, hex) {
  // Satteldach: First entlang X, Neigung nach ±Z
  const x0 = -w / 2 - ov, x1 = w / 2 + ov, z0 = -d / 2 - ov, z1 = d / 2 + ov;
  const v = [
    // vordere Dachfläche
    x0, 0, z0, x1, 0, z0, x1, rh, 0, x0, 0, z0, x1, rh, 0, x0, rh, 0,
    // hintere Dachfläche
    x1, 0, z1, x0, 0, z1, x0, rh, 0, x1, 0, z1, x0, rh, 0, x1, rh, 0,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  // dicker machen: zweite, leicht versetzte Unterseite
  const top = paint(g, hex);
  const under = paint(g.clone().translate(0, -0.15, 0), hex);
  // Unterseite umdrehen, damit sie von unten sichtbar ist
  const p = under.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i + 1), ay = p.getY(i + 1), az = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, ax, ay, az);
  }
  under.computeVertexNormals();
  return merge([top, under]);
}
function gableGeometry(w, d, rh, hex) {
  const v = [];
  for (const sx of [-1, 1]) {
    const x = (sx * w) / 2;
    if (sx < 0) v.push(x, 0, d / 2, x, 0, -d / 2, x, rh, 0);
    else v.push(x, 0, -d / 2, x, 0, d / 2, x, rh, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  return paint(g, hex);
}

/** Haus mit Ursprung am Boden in der Mitte; Vorderseite (Tür) zeigt nach −Z. 2 m Fundament unter dem Boden. */
function makeHouse(rand) {
  const w = 3 + rand() * 2.5, d = 2.8 + rand() * 1.4, h = 2.4 + rand() * 1.0;
  const wall = WALLS[Math.floor(rand() * WALLS.length)];
  const roof = ROOFS[Math.floor(rand() * ROOFS.length)];
  const rh = h * (0.45 + rand() * 0.2);
  const parts = [
    box(w, h + 2, d, 0, h / 2 - 1, 0, wall),                       // Wände + Fundament
    gableGeometry(w, d, rh, wall).translate(0, h, 0),
    roofGeometry(w, d, rh, 0.3, roof).translate(0, h, 0),
    box(0.75, 1.3, 0.08, 0, 0.65, -d / 2 - 0.03, 0x5b3a1e),        // Tür
    box(0.36, 1.2, 0.36, w * 0.25, h + rh * 0.7, d * 0.15, 0x77736c), // Schornstein
  ];
  for (const sx of [-1, 1]) {
    const x = sx * (w / 2 - 0.65);
    parts.push(box(0.66, 0.66, 0.06, x, 1.55, -d / 2 - 0.02, 0xf4f2ec));   // Rahmen
    parts.push(box(0.52, 0.52, 0.08, x, 1.55, -d / 2 - 0.035, 0x35546e));  // Glas
    parts.push(box(0.06, 0.6, 0.6, sx * (w / 2 + 0.02), 1.55, 0, 0x35546e)); // Seitenfenster
  }
  const geo = merge(parts);
  return { geo, w, d, h: h + rh };
}

/** Erzeugt alle gemeinsamen Geometrien einmal (mit Seed → jede Welt sieht etwas anders aus). */
export function createProps(seed) {
  const rand = mulberry32(seed ^ 0x9e3779b9);
  return {
    trees: [makeTree(rand, 0x3f8f34), makeTree(rand, 0x5aa83a), makeTree(rand, 0x2f7230)],
    firs: [makeFir(0x1f5a2e), makeFir(0x2a6b35)],
    bushes: [makeBush(rand, 0x3f8a33), makeBush(rand, 0x5a9a3a)],
    rocks: [makeRock(rand, 0x85817a), makeRock(rand, 0x6d6a65)],
    houses: Array.from({ length: 8 }, () => makeHouse(rand)),
  };
}
