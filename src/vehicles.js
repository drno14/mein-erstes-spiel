import * as THREE from 'three/webgpu';
import { CHUNK_SIZE, SEA_LEVEL } from './world/terrain.js';
import { mulberry32, hash2 } from './world/noise.js';

/*
 * Fahrbare Fahrzeuge: Autos (Kenney Car Kit), Boote (Kenney Watercraft) und Pferde (über AnimalManager).
 * E = ein-/aussteigen, W/S = Gas/Bremse, A/D = lenken, Leertaste = Handbremse, Shift = Pferd galoppiert.
 * Kenney-Modelle schauen nach +Z (Vorderräder bei +Z) – wie unsere Spielfigur.
 */

const CARS = {
  sedan: 'Limousine', 'sedan-sports': 'Sportlimousine', 'hatchback-sports': 'Sportwagen', suv: 'Geländewagen',
  'suv-luxury': 'Luxus-SUV', taxi: 'Taxi', police: 'Polizeiauto', ambulance: 'Krankenwagen', firetruck: 'Feuerwehr',
  van: 'Lieferwagen', delivery: 'Kastenwagen', truck: 'Pick-up', 'garbage-truck': 'Müllwagen', tractor: 'Traktor',
  race: 'Rennwagen', 'race-future': 'Zukunfts-Rennwagen',
};
const BOATS = { 'boat-speed-a': 'Motorboot', 'boat-sail-a': 'Segelboot', 'boat-fishing-small': 'Fischerboot', 'boat-row-large': 'Ruderboot' };
// Häufigkeit beim Verteilen (Traktoren auf dem Land, Rennwagen selten)
const CAR_POOL = ['sedan', 'sedan', 'suv', 'hatchback-sports', 'van', 'truck', 'tractor', 'tractor', 'taxi', 'police', 'delivery',
  'ambulance', 'firetruck', 'suv-luxury', 'garbage-truck', 'race', 'race-future', 'sedan-sports'];

const CAR = { length: 4.4, maxSpeed: 28, maxReverse: 7, accel: 7, brake: 16, wheelbase: 2.7, steerMax: 0.6, camDist: 7.5, camHeight: 2.4 };
const BOAT = { length: 5.0, maxSpeed: 13, maxReverse: 4, accel: 4, brake: 6, wheelbase: 3.5, steerMax: 0.55, camDist: 9, camHeight: 3 };
const HORSE = { walk: 3.2, gallop: 10, turn: 1.9, camDist: 6, camHeight: 2.6 };

export class VehicleManager {
  constructor({ scene, terrain, chunks, seed, loader, worldCollides, animals }) {
    Object.assign(this, { scene, terrain, chunks, seed, loader, worldCollides, animals });
    this.protos = {};          // Modellname → { scene, scale, name }
    this.byChunk = new Map();  // Chunk-Key → [vehicle]
    this.all = new Set();
    this.taken = new Set();    // IDs, die der Spieler weggefahren hat (werden nicht neu gespawnt)
    this.active = null;        // aktuell gefahrenes Fahrzeug
    this.prompt = '';
    this._v = new THREE.Vector3();
  }

  async init() {
    const load = async (dir, name, label, length) => {
      const g = await this.loader.loadAsync(`models/${dir}/${name}.glb`);
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const scale = length / Math.max(size.z, 0.001);
      g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.protos[name] = { scene: g.scene, scale, label, minY: box.min.y * scale };
    };
    await Promise.all([
      ...Object.entries(CARS).map(([n, l]) => load('fahrzeuge', n, l, n === 'tractor' ? 3.6 : n.includes('truck') || n === 'firetruck' ? 5.5 : CAR.length)),
      ...Object.entries(BOATS).map(([n, l]) => load('boote', n, l, BOAT.length)),
    ]);
    this.spawnStart();
  }

  make(kind, model, x, z, heading, id) {
    const p = this.protos[model];
    const root = new THREE.Group();
    const body = p.scene.clone(true);
    body.scale.setScalar(p.scale);
    body.position.y = -p.minY;
    root.add(body);
    root.rotation.order = 'YXZ';
    const wheels = [];
    body.traverse((o) => { if (o.name?.startsWith('wheel-')) wheels.push({ obj: o, front: o.name.includes('front') }); });
    wheels.forEach((w) => { w.obj.rotation.order = 'YXZ'; });
    const v = { id, kind, model, label: p.label, root, wheels, heading, speed: 0, steer: 0, spin: 0, x, z, cfg: kind === 'boat' ? BOAT : CAR };
    this.place(v);
    this.scene.add(root);
    this.all.add(v);
    return v;
  }

  /** Höhe und Neigung aus dem Gelände (Auto) bzw. Wasser (Boot). */
  place(v, t = 0) {
    const { terrain } = this;
    const s = Math.sin(v.heading), c = Math.cos(v.heading);
    if (v.kind === 'boat') {
      const bob = Math.sin(t * 1.7 + v.x * 0.3) * 0.06;
      v.root.position.set(v.x, SEA_LEVEL - 0.35 + bob, v.z);
      v.root.rotation.set(Math.sin(t * 1.3 + v.z) * 0.03 - v.speed * 0.004, v.heading, Math.sin(t * 1.1 + v.x) * 0.04);
      return;
    }
    const L = v.cfg.wheelbase / 2, W = 0.8;
    const hf = terrain.height(v.x + s * L, v.z + c * L), hb = terrain.height(v.x - s * L, v.z - c * L);
    const hl = terrain.height(v.x + c * W, v.z - s * W), hr = terrain.height(v.x - c * W, v.z + s * W);
    v.root.position.set(v.x, Math.max((hf + hb) / 2, (hl + hr) / 2), v.z);
    v.root.rotation.set(Math.atan2(hb - hf, L * 2), v.heading, Math.atan2(hr - hl, W * 2) * 0.8);
  }

  spawnStart() {
    // Zwei Autos am Rand des Start-Dorfs (flache Ebene, ausserhalb der Häuser/Zäune)
    const a = this.make('car', 'sedan', 12, 14, Math.PI * 0.85, 'start-1');
    const b = this.make('car', 'tractor', -13, 17, Math.PI * 1.2, 'start-2');
    this.byChunk.set('start', [a, b]);
  }

  /** Fahrzeuge pro geladenem Chunk: Autos am Dorfrand und auf Wiesen, Boote auf Seen. */
  spawnChunk(cx, cz) {
    const { terrain } = this;
    const rand = mulberry32(hash2(cx, cz, this.seed ^ 0xcafe));
    const list = [];
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const free = (x, z, r) => !this.worldCollides(x, z, -Infinity, r) && Math.hypot(x, z) > 40;
    const village = this.chunks.villageAt(cx, cz);
    if (village) {
      const n = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < n; i++) {
        for (let t = 0; t < 8; t++) {
          const a = rand() * Math.PI * 2, r = 19 + rand() * 6;
          const x = village.x + Math.cos(a) * r, z = village.z + Math.sin(a) * r;
          const slope = 1 - terrain.normal(x, z).y;
          if (slope < 0.12 && terrain.height(x, z) > SEA_LEVEL + 0.5 && free(x, z, 3)) {
            list.push(this.make('car', CAR_POOL[Math.floor(rand() * CAR_POOL.length)], x, z, rand() * Math.PI * 2, `${cx},${cz},c${i}`));
            break;
          }
        }
      }
    } else if (rand() < 0.12) {
      // vereinzelt ein Fahrzeug auf flacher Wiese (Traktor, Geländewagen)
      for (let t = 0; t < 6; t++) {
        const x = x0 + rand() * CHUNK_SIZE, z = z0 + rand() * CHUNK_SIZE;
        const h = terrain.height(x, z);
        if (h > SEA_LEVEL + 1 && h < 22 && 1 - terrain.normal(x, z).y < 0.1 && free(x, z, 3)) {
          list.push(this.make('car', rand() < 0.6 ? 'tractor' : 'suv', x, z, rand() * Math.PI * 2, `${cx},${cz},w`));
          break;
        }
      }
    }
    // Boot: nahe am Ufer im Wasser
    if (rand() < 0.5) {
      for (let t = 0; t < 14; t++) {
        const x = x0 + rand() * CHUNK_SIZE, z = z0 + rand() * CHUNK_SIZE;
        if (terrain.height(x, z) > SEA_LEVEL - 1.2) continue;
        let shore = false;
        for (let k = 0; k < 8 && !shore; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (terrain.height(x + Math.cos(a) * 7, z + Math.sin(a) * 7) > SEA_LEVEL + 0.2) shore = true;
        }
        if (shore && Math.hypot(x, z) > 40) {
          const names = Object.keys(BOATS);
          list.push(this.make('boat', names[Math.floor(rand() * names.length)], x, z, rand() * Math.PI * 2, `${cx},${cz},b`));
          break;
        }
      }
    }
    return list.filter((v) => {
      if (this.taken.has(v.id)) { this.remove(v); return false; }
      return true;
    });
  }

  remove(v) {
    this.scene.remove(v.root);
    this.all.delete(v);
  }

  sync() {
    for (const [key, chunk] of this.chunks.chunks) {
      if (!this.byChunk.has(key)) this.byChunk.set(key, this.spawnChunk(chunk.cx, chunk.cz));
    }
    for (const [key, list] of this.byChunk) {
      if (key === 'start' || this.chunks.chunks.has(key)) continue;
      list.forEach((v) => { if (v !== this.active?.vehicle && !this.taken.has(v.id)) this.remove(v); });
      this.byChunk.delete(key);
    }
  }

  /** Geparkte Fahrzeuge blockieren den Spieler (OBB). */
  collides(x, z, r) {
    for (const v of this.all) {
      if (this.active?.vehicle === v) continue;
      const dx = x - v.x, dz = z - v.z;
      if (dx * dx + dz * dz > 49) continue;
      const s = Math.sin(v.heading), c = Math.cos(v.heading);
      const lx = dx * c - dz * s, lz = dx * s + dz * c;   // in Fahrzeug-Koordinaten
      const hw = v.kind === 'boat' ? 1.3 : 1.0, hl = v.cfg.length / 2;
      if (Math.abs(lx) < hw + r && Math.abs(lz) < hl + r) return true;
    }
    return false;
  }

  /** Nächstes Fahrzeug/Pferd zum Einsteigen. */
  nearest(pos, max = 3.2) {
    let best = null, bd = max;
    for (const v of this.all) {
      const d = Math.hypot(pos.x - v.x, pos.z - v.z) - (v.kind === 'boat' ? 1.5 : 1.2);
      if (d < bd) { bd = d; best = { type: v.kind, vehicle: v, label: v.label }; }
    }
    const horse = this.animals?.findRideable?.(pos, max);
    if (horse) {
      const p = horse.object3d.position;
      const d = Math.hypot(pos.x - p.x, pos.z - p.z) - 0.6;
      if (d < bd) best = { type: 'horse', horse, label: 'Pferd' };
    }
    return best;
  }

  tryEnter(pos) {
    const n = this.nearest(pos);
    if (!n) return false;
    if (n.type === 'horse') {
      this.animals.setRidden(n.horse.animal, true);
      const o = n.horse.object3d;
      // Sattelhöhe aus der echten Modellgrösse (Rücken ≈ 72 % der Gesamthöhe inkl. Kopf)
      const box = new THREE.Box3().setFromObject(o, true);
      const saddle = (box.max.y - box.min.y) * 0.72;
      this.active = { type: 'horse', horse: n.horse, x: o.position.x, z: o.position.z, heading: o.rotation.y, speed: 0, label: 'Pferd', saddle };
    } else {
      n.vehicle.speed = 0;
      this.taken.add(n.vehicle.id);
      this.active = { type: n.type, vehicle: n.vehicle, label: n.vehicle.label };
    }
    return true;
  }

  /** Aussteigen: freien Platz neben dem Fahrzeug suchen. Gibt {x,z} zurück oder null. */
  exit() {
    const a = this.active;
    if (!a) return null;
    const x = a.vehicle ? a.vehicle.x : a.x, z = a.vehicle ? a.vehicle.z : a.z;
    const heading = a.vehicle ? a.vehicle.heading : a.heading;
    const s = Math.sin(heading), c = Math.cos(heading);
    // links, rechts, hinten, vorne – an Land
    for (const [lx, lz] of [[2.2, 0], [-2.2, 0], [0, -3.2], [0, 3.2], [3, 1.5], [-3, 1.5]]) {
      const wx = x + lx * c + lz * s, wz = z - lx * s + lz * c;
      if (this.terrain.height(wx, wz) > SEA_LEVEL - 0.6 && !this.worldCollides(wx, wz, -Infinity, 0.35)) {
        if (a.type === 'horse') this.animals.setRidden(a.horse.animal, false);
        if (a.vehicle) a.vehicle.speed = 0;
        this.active = null;
        return { x: wx, z: wz };
      }
    }
    return null;   // kein Platz (z. B. Boot mitten im See)
  }

  /**
   * Fahren. input = { throttle (-1..1), steer (-1..1), brake (bool), boost (bool) }
   * Gibt die Fahrer-Position zurück (für Kamera & Spielfigur).
   */
  drive(dt, input, t) {
    const a = this.active;
    if (!a) return null;
    if (a.type === 'horse') return this.ride(dt, input);
    const v = a.vehicle, cfg = v.cfg;
    const { terrain } = this;
    // Gas / Bremse / Rückwärts
    const th = input.throttle;
    if (th > 0) v.speed += (v.speed < 0 ? cfg.brake : cfg.accel) * th * dt;
    else if (th < 0) v.speed += (v.speed > 0 ? cfg.brake : cfg.accel * 0.7) * th * dt;
    else v.speed -= Math.sign(v.speed) * Math.min(Math.abs(v.speed), (1.2 + Math.abs(v.speed) * 0.25) * dt);
    if (input.brake) v.speed *= Math.max(0, 1 - 3 * dt);
    // Steigung: bergauf langsamer, bergab schneller (nur Auto)
    if (v.kind === 'car') v.speed -= 9.81 * Math.sin(-v.root.rotation.x) * dt * 0.6;
    v.speed = THREE.MathUtils.clamp(v.speed, -cfg.maxReverse, cfg.maxSpeed);
    // Lenkung (Fahrradmodell): bei Tempo weniger Einschlag
    const target = input.steer * cfg.steerMax / (1 + Math.abs(v.speed) * 0.05);
    v.steer += (target - v.steer) * (1 - Math.exp(-6 * dt));
    v.heading += (v.speed / cfg.wheelbase) * Math.tan(v.steer) * dt;
    // Bewegen mit Kollision
    const s = Math.sin(v.heading), c = Math.cos(v.heading);
    const nx = v.x + s * v.speed * dt, nz = v.z + c * v.speed * dt;
    const dir = Math.sign(v.speed) || 1, L = cfg.length / 2;
    const fx = nx + s * L * dir, fz = nz + c * L * dir;
    let blocked = this.worldCollides(fx, fz, -Infinity, 0.9) || this.animals?.collides?.(fx, fz, 1.0);
    const hFront = terrain.height(fx, fz);
    if (v.kind === 'car' && hFront < SEA_LEVEL - 0.5) blocked = true;          // nicht ins tiefe Wasser
    if (v.kind === 'boat' && hFront > SEA_LEVEL - 0.4) blocked = true;         // Boot läuft am Ufer auf
    if (blocked) {
      v.speed = -v.speed * 0.25;
    } else {
      v.x = nx; v.z = nz;
    }
    // Räder drehen und lenken
    v.spin += (v.speed * dt) / 0.33;
    for (const w of v.wheels) { w.obj.rotation.x = v.spin; w.obj.rotation.y = w.front ? v.steer : 0; }
    this.place(v, t);
    const p = v.root.position;
    return { x: p.x, y: p.y + (v.kind === 'boat' ? 0.45 : 0.3), z: p.z, heading: v.heading, speed: v.speed, cfg, hidePlayer: v.kind === 'car' };
  }

  ride(dt, input) {
    const a = this.active, o = a.horse.object3d, { terrain } = this;
    const target = input.throttle > 0 ? (input.boost ? HORSE.gallop : HORSE.walk) : input.throttle < 0 ? -1.5 : 0;
    a.speed += (target - a.speed) * (1 - Math.exp(-3 * dt));
    a.heading += input.steer * HORSE.turn * dt * (a.speed >= 0 ? 1 : -1);
    const s = Math.sin(a.heading), c = Math.cos(a.heading);
    const nx = a.x + s * a.speed * dt, nz = a.z + c * a.speed * dt;
    const h0 = terrain.height(a.x, a.z), h1 = terrain.height(nx, nz);
    const step = Math.hypot(nx - a.x, nz - a.z) || 1e-6;
    const ok = h1 > SEA_LEVEL - 0.8 && (h1 - h0) / step < 1.0 && !this.worldCollides(nx + s, nz + c, -Infinity, 0.6);
    if (ok) { a.x = nx; a.z = nz; } else a.speed *= 0.3;
    o.position.set(a.x, terrain.height(a.x, a.z), a.z);
    o.rotation.y = a.heading + (a.horse.yawOffset || 0);
    // Pferde-Animation passend zum Tempo (Stehen / Schritt / Galopp)
    const sp = Math.abs(a.speed), anim = sp > 5.5 ? 'run' : sp > 0.3 ? 'walk' : 'idle';
    a.horse.animal.play?.(anim, anim === 'run' ? sp / 9 : anim === 'walk' ? Math.max(sp / 2.5, 0.6) : 1);
    return { x: a.x, y: o.position.y + a.saddle, z: a.z, heading: a.heading, speed: a.speed, cfg: HORSE, riding: true };
  }

  update(dt, playerPos, t) {
    this.sync();
    if (!this.active) {
      const n = this.nearest(playerPos);
      this.prompt = n ? `E – einsteigen: ${n.label}` : '';
      for (const v of this.all) if (v.kind === 'boat') this.place(v, t);   // Boote schaukeln
    } else {
      this.prompt = `E – aussteigen · W/S Gas/Bremse · A/D lenken · Leertaste Handbremse${this.active.type === 'horse' ? ' · Shift Galopp' : ''}`;
    }
  }
}
