import * as THREE from 'three/webgpu';

/*
 * Moderne Welt: Einfamilienhäuser, Geschäftshäuser und Hochhäuser (Kenney City Kits, CC0),
 * Asphaltstrassen mit Mittellinie. Die Modelle sind 1 Einheit ≈ 8 m (Kenney-Massstab).
 */
export const CITY_SCALE = 8;

const HOUSES = 'abcdefghijklmnopqrstu'.split('').map((c) => `suburban/building-type-${c}`);
const SHOPS = 'abcdefghijk'.split('').map((c) => `commercial/building-${c}`);
const TOWERS = ['commercial/building-l', 'commercial/building-m', 'commercial/building-n',
  ...'abcde'.split('').map((c) => `commercial/building-skyscraper-${c}`)];

const roadMat = new THREE.MeshStandardMaterial({ color: 0x3b3e44, roughness: 0.92 });
const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2ea, roughness: 0.6 });
const plazaMat = new THREE.MeshStandardMaterial({ color: 0xb9b4aa, roughness: 0.95 });
const plinthMat = new THREE.MeshStandardMaterial({ color: 0x9a968e, roughness: 0.95 });
for (const m of [roadMat, lineMat, plazaMat]) { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }

export async function loadModern(loader) {
  const load = async (f) => {
    try {
      const g = await loader.loadAsync(`models/modern/${f}.glb`);
      const scene = g.scene;
      scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      return { f, scene, w: size.x, d: size.z, h: size.y };
    } catch (err) {
      console.warn('[Modern] Modell fehlt', f, err);
      return null;
    }
  };
  const all = async (list) => (await Promise.all(list.map(load))).filter(Boolean);
  const [house, shop, tower] = await Promise.all([all(HOUSES), all(SHOPS), all(TOWERS)]);
  return { house, shop, tower };
}

/**
 * Gebäude auf unebenem Boden: Haus steht auf der höchsten Ecke, darunter ein Betonsockel.
 * Vorderseite des Kenney-Modells (+Z lokal) zeigt in Richtung `face` (Winkel um Y).
 * Gibt { obj, obstacle } zurück.
 */
export function placeBuilding(proto, terrain, x, z, rotY, scale = CITY_SCALE) {
  const w = proto.w * scale, d = proto.d * scale;
  const c = Math.cos(rotY), s = Math.sin(rotY);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
    const lx = sx * w / 2, lz = sz * d / 2;
    return terrain.height(x + lx * c + lz * s, z - lx * s + lz * c);
  });
  const top = Math.max(...corners), low = Math.min(...corners);
  const g = new THREE.Group();
  const model = proto.scene.clone();
  model.scale.setScalar(scale);
  model.position.y = top;
  g.add(model);
  if (top - low > 0.05) {
    const pl = new THREE.Mesh(new THREE.BoxGeometry(w * 0.98, top - low + 0.6, d * 0.98), plinthMat);
    pl.position.y = (top + low) / 2 - 0.3;
    pl.receiveShadow = true;
    g.add(pl);
  }
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  return { obj: g, w, d, h: proto.h * scale, obstacle: { type: 'obb', x, z, cos: c, sin: s, hw: w / 2 * 0.92, hd: d / 2 * 0.92, top: Infinity } };
}

/** Streifen (Strasse) entlang einer Polylinie, der dem Gelände folgt. */
function stripGeometry(points, width, terrain, lift = 0.06) {
  const pos = [], idx = [];
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i];
    const [ax, az] = points[Math.max(0, i - 1)], [bx, bz] = points[Math.min(points.length - 1, i + 1)];
    let tx = bx - ax, tz = bz - az; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz * width / 2, nz = tx * width / 2;
    for (const k of [-1, 1]) {
      const px = x + nx * k, pz = z + nz * k;
      pos.push(px, terrain.height(px, pz) + lift, pz);
    }
    if (i > 0) { const b = (i - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Runde Fläche (Platz), Höhe folgt dem Gelände. */
function diskGeometry(cx, cz, radius, terrain, lift = 0.05) {
  const rings = Math.max(3, Math.ceil(radius / 1.5)), seg = 40;
  const pos = [cx, terrain.height(cx, cz) + lift, cz], idx = [];
  for (let r = 1; r <= rings; r++) {
    const rr = radius * r / rings;
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2, x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr;
      pos.push(x, terrain.height(x, z) + lift, z);
    }
  }
  for (let i = 0; i < seg; i++) idx.push(0, 1 + (i + 1) % seg, 1 + i);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, b0 = 1 + r * seg;
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      idx.push(a0 + i, a0 + j, b0 + i, a0 + j, b0 + j, b0 + i);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Gestrichelte Mittellinie. */
function dashes(points, terrain, total) {
  const geos = [];
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1], [bx, bz] = points[i];
    const seg = Math.hypot(bx - ax, bz - az);
    acc += seg;
    if (acc % 4 < 2.2 && acc < total - 1) geos.push(stripGeometry([[ax, az], [bx, bz]], 0.16, terrain, 0.09));
  }
  return geos;
}

/** Ringstrasse + Ausfallstrassen + Platz für ein Dorf. Gibt eine Gruppe zurück. */
export function buildVillageRoads(terrain, cx, cz, { ring = 12, spokes = [], spokeLen = 34, plaza = 7.5 } = {}) {
  const g = new THREE.Group();
  const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.receiveShadow = true; g.add(m); };
  // Platz in der Mitte
  add(diskGeometry(cx, cz, plaza / 2, terrain), plazaMat);
  // Ring
  const ringPts = [];
  for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; ringPts.push([cx + Math.cos(a) * ring, cz + Math.sin(a) * ring]); }
  add(stripGeometry(ringPts, 5, terrain), roadMat);
  for (const d of dashes(ringPts, terrain, Infinity)) add(d, lineMat);
  // Ausfallstrassen
  for (const a of spokes) {
    const p = [];
    for (let r = ring + 2; r <= spokeLen; r += 1) p.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]);
    add(stripGeometry(p, 5, terrain), roadMat);
    for (const d of dashes(p, terrain, p.length)) add(d, lineMat);
  }
  return g;
}

/** Gerade Strasse (z. B. im Startdorf) von (x0,z0) nach (x1,z1). */
export function buildStraightRoad(terrain, x0, z0, x1, z1, width = 5) {
  const g = new THREE.Group();
  const n = Math.max(2, Math.ceil(Math.hypot(x1 - x0, z1 - z0)));
  const p = Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, z0 + (z1 - z0) * i / n]);
  const road = new THREE.Mesh(stripGeometry(p, width, terrain), roadMat); road.receiveShadow = true; g.add(road);
  for (const d of dashes(p, terrain, p.length)) g.add(new THREE.Mesh(d, lineMat));
  return g;
}
