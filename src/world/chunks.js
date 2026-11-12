import * as THREE from 'three/webgpu';
import { CHUNK_SIZE, SEA_LEVEL } from './terrain.js';
import { mulberry32, hash2 } from './noise.js';
import { propMaterial } from './props.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);   // "unsichtbare" Instanz
const START_CLEAR = 42;       // im Blender-Dorf keine generierten Objekte
const VILLAGE_CHANCE = 0.07;   // Anteil der Chunks mit Dorf
const VILLAGE_CLEAR = 24;      // Radius ohne Bäume um ein Dorfzentrum

/**
 * Lädt Chunks rund um den Spieler, entlädt ferne. Jeder Chunk ist rein aus
 * (Seed, cx, cz) berechnet → beim Zurückkommen sieht alles genauso aus.
 */
export class ChunkManager {
  constructor({ scene, terrain, props, seed, radius = 4, buildPerFrame = 2 }) {
    Object.assign(this, { scene, terrain, props, seed, radius, buildPerFrame });
    this.chunks = new Map();
    this.terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
    this.villageCache = new Map();
    this.destroyed = new Set();   // "cx,cz:n" – zerstörte Bäume/Büsche/Felsen
  }

  key(cx, cz) { return `${cx},${cz}`; }

  /** Dorfzentrum eines Chunks oder null (deterministisch, auch für Nachbarn abfragbar). */
  villageAt(cx, cz) {
    const k = this.key(cx, cz);
    if (this.villageCache.has(k)) return this.villageCache.get(k);
    let v = null;
    const rand = mulberry32(hash2(cx, cz, this.seed ^ 0x51ed));
    if (rand() < VILLAGE_CHANCE) {
      const x = (cx + 0.3 + rand() * 0.4) * CHUNK_SIZE;
      const z = (cz + 0.3 + rand() * 0.4) * CHUNK_SIZE;
      const h = this.terrain.height(x, z);
      const flat = Math.max(...[[12, 0], [-12, 0], [0, 12], [0, -12]].map(([dx, dz]) =>
        Math.abs(this.terrain.height(x + dx, z + dz) - h)));
      if (Math.hypot(x, z) > 120 && h > SEA_LEVEL + 1.5 && h < 24 && flat < 3) v = { x, z, h };
    }
    this.villageCache.set(k, v);
    return v;
  }

  nearVillage(x, z, cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const v = this.villageAt(cx + dx, cz + dz);
      if (v && Math.hypot(x - v.x, z - v.z) < VILLAGE_CLEAR) return true;
    }
    return false;
  }

  buildChunk(cx, cz) {
    const { terrain, props } = this;
    const group = new THREE.Group();
    group.name = `Chunk ${cx},${cz}`;
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;

    // Gelände
    const ground = new THREE.Mesh(terrain.buildChunkGeometry(cx, cz), this.terrainMaterial);
    ground.position.set(x0, 0, z0);
    ground.receiveShadow = true;
    group.add(ground);

    const obstacles = [];
    const rand = mulberry32(hash2(cx, cz, this.seed));
    const placements = new Map(); // Geometrie → Matrizen
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const place = (geo, x, y, z, rotY, scale) => {
      q.setFromAxisAngle(up, rotY);
      s.setScalar(scale);
      p.set(x, y, z);
      if (!placements.has(geo)) placements.set(geo, []);
      const list = placements.get(geo);
      list.push(m.compose(p, q, s).clone());
      return { geo, index: list.length - 1, base: list[list.length - 1] };
    };
    // Zerstörbare Ziele (Bäume, Büsche, Felsen) – siehe combat.js
    const targets = [];
    const target = (ref, t) => { t.geo = ref.geo; t.index = ref.index; t.base = ref.base; t.n = targets.length; targets.push(t); return t; };

    // Dorf
    const village = this.villageAt(cx, cz);
    const housesHere = [];
    if (village) {
      const n = 3 + Math.floor(rand() * 4);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rand() * 0.5;
        const r = 9 + rand() * 6;
        const hx = village.x + Math.cos(a) * r, hz = village.z + Math.sin(a) * r;
        const house = props.houses[Math.floor(rand() * props.houses.length)];
        // Tür (−Z lokal) zeigt zur Dorfmitte
        // lokales −Z nach Drehung um Y = (−sin r, −cos r) → soll auf (Mitte − Haus) zeigen
        const rot = Math.atan2(-(village.x - hx), -(village.z - hz));
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
          const lx = (sx * house.w) / 2, lz = (sz * house.d) / 2;
          return terrain.height(hx + lx * Math.cos(rot) + lz * Math.sin(rot), hz - lx * Math.sin(rot) + lz * Math.cos(rot));
        });
        const base = Math.min(...corners);
        const mesh = new THREE.Mesh(house.geo, propMaterial);
        mesh.position.set(hx, base, hz);
        mesh.rotation.y = rot;
        mesh.castShadow = mesh.receiveShadow = true;
        group.add(mesh);
        housesHere.push({ x: hx, z: hz });
        obstacles.push({ type: 'obb', x: hx, z: hz, cos: Math.cos(rot), sin: Math.sin(rot), hw: house.w / 2 + 0.05, hd: house.d / 2 + 0.05, top: Infinity });
      }
    }

    // Bäume, Tannen, Büsche, Felsen
    const tries = 70;
    for (let i = 0; i < tries; i++) {
      const x = x0 + rand() * CHUNK_SIZE, z = z0 + rand() * CHUNK_SIZE;
      const roll = rand(), rot = rand() * Math.PI * 2, sc = 0.75 + rand() * 0.6;
      if (Math.hypot(x, z) < START_CLEAR) continue;
      const h = terrain.height(x, z);
      if (h < SEA_LEVEL + 0.8) continue;
      const slope = 1 - terrain.normal(x, z).y;
      const bush = () => target(place(props.bushes[i % 2], x, h, z, rot, sc),
        { name: 'Busch', material: 'pflanze', x, z, y: h, r: 0.6 * sc, height: 0.9 * sc, hp: 25, drops: i % 3 === 0 ? [['apple', 1]] : [] });   // ohne rand(): Welt-Anordnung bleibt gleich
      if (this.nearVillage(x, z, cx, cz)) {
        if (roll < 0.15 && slope < 0.2) bush();
        continue;
      }
      const forest = terrain.forest(x, z);
      if (slope < 0.35 && h < 38 && roll < 0.12 + forest * 0.6) {
        const fir = h > 18 || rand() < forest * 0.35;
        const geo = fir ? props.firs[i % props.firs.length] : props.trees[i % props.trees.length];
        const ob = { type: 'circle', x, z, r: 0.3 * sc, top: Infinity };
        obstacles.push(ob);
        target(place(geo, x, h - 0.1, z, rot, sc), { name: fir ? 'Tanne' : 'Baum', material: 'holz', x, z, y: h, r: 0.35 * sc,
          height: 3.5 * sc, hp: Math.round(90 * sc), obstacle: ob, drops: [['holz', 2 + Math.round(sc * 2)]] });
      } else if (roll > 0.9 && slope < 0.3) {
        bush();
      } else if (roll > 0.8) {
        const big = sc * (h > 20 ? 1.8 : 1.0);
        const ob = big > 1.0 ? { type: 'circle', x, z, r: 0.8 * big, top: h + 0.9 * big } : null;
        if (ob) obstacles.push(ob);
        target(place(props.rocks[i % 2], x, h - 0.15 * big, z, rot, big), { name: big > 1.2 ? 'Felsen' : 'Stein', material: 'stein',
          x, z, y: h, r: 0.8 * big, height: 0.9 * big, hp: Math.round(45 * big * big), obstacle: ob, drops: [['stein', Math.max(1, Math.round(big * 2))]] });
      }
    }

    // Pro Geometrie eine InstancedMesh
    const imOf = new Map();
    for (const [geo, mats] of placements) {
      const im = new THREE.InstancedMesh(geo, propMaterial, mats.length);
      mats.forEach((mm, i) => im.setMatrixAt(i, mm));
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = true;
      im.receiveShadow = true;
      group.add(im);
      imOf.set(geo, im);
    }
    const chunk = { group, obstacles, cx, cz, targets };
    for (const t of targets) {
      t.im = imOf.get(t.geo);
      t.chunk = chunk;
      t.maxHp = t.hp;
      t.destroy = () => this.destroyTarget(t);
      // schon früher zerstört? (bleibt weg, auch nach Neuladen des Chunks)
      if (this.destroyed.has(`${cx},${cz}:${t.n}`)) this.destroyTarget(t, true);
    }

    this.scene.add(group);
    return chunk;
  }

  /** Ziel entfernen: Instanz unsichtbar machen, Hindernis löschen. Gibt die Beute zurück. */
  destroyTarget(t, silent = false) {
    t.dead = true;
    t.im.setMatrixAt(t.index, ZERO);
    t.im.instanceMatrix.needsUpdate = true;
    if (t.obstacle) {
      const i = t.chunk.obstacles.indexOf(t.obstacle);
      if (i >= 0) t.chunk.obstacles.splice(i, 1);
    }
    this.destroyed.add(`${t.chunk.cx},${t.chunk.cz}:${t.n}`);
    return silent ? [] : t.drops;
  }

  /** Zerstörbare Ziele in der Nähe (Chunk des Punkts + Nachbarn). */
  *targetsNear(x, z) {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
      if (!c) continue;
      for (const t of c.targets) {
        if (t.dead) continue;
        const ex = t.x - x, ez = t.z - z;
        if (ex * ex + ez * ez < 49) yield t;
      }
    }
  }

  disposeChunk(chunk) {
    this.scene.remove(chunk.group);
    chunk.group.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      // Gelände-Geometrie gehört nur diesem Chunk; Objekt-Geometrien sind geteilt
      else if (o.isMesh && o.geometry && o.material === this.terrainMaterial) o.geometry.dispose();
    });
  }

  /** Jeden Frame aufrufen: lädt fehlende Chunks (nächste zuerst), entlädt ferne. */
  update(x, z) {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    const R = this.radius;
    const missing = [];
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dz * dz > R * R + 1) continue;
      const k = this.key(pcx + dx, pcz + dz);
      if (!this.chunks.has(k)) missing.push([dx * dx + dz * dz, pcx + dx, pcz + dz]);
    }
    missing.sort((a, b) => a[0] - b[0]);
    for (const [, cx, cz] of missing.slice(0, this.buildPerFrame)) {
      this.chunks.set(this.key(cx, cz), this.buildChunk(cx, cz));
    }
    const keep = (R + 1.5) * (R + 1.5);
    for (const [k, c] of this.chunks) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > keep) { this.disposeChunk(c); this.chunks.delete(k); }
    }
    return missing.length;
  }

  /** Hindernisse aus dem Chunk des Spielers und den 8 Nachbarn. */
  *obstaclesNear(x, z) {
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.get(this.key(pcx + dx, pcz + dz));
      if (c) yield* c.obstacles;
    }
  }
}
