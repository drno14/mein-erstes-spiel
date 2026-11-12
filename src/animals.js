import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mulberry32, hash2 } from './world/noise.js';
import { SEA_LEVEL, CHUNK_SIZE } from './world/terrain.js';

// ---------- Einstellungen ----------
const ACTIVE_DIST = 120;        // weiter weg: keine KI/Animation
const VISIBLE_DIST = 250;       // weiter weg: unsichtbar (Nebel endet bei 245 m)
const MAX_ANIMALS = 120;        // Obergrenze für alle Tiere zusammen
const START_CLEAR = 45;         // Startdorf: nur Haustiere
const MAX_SLOPE = 0.9;          // Steigung (Höhe pro Meter), die Landtiere noch gehen
const SYNC_INTERVAL = 0.25;     // so oft wird mit den geladenen Chunks abgeglichen (s)
const WATER_Y = SEA_LEVEL - 0.6;
const SEED_SALT = 0x7a1e5;
const TAU = Math.PI * 2;

/*
 * Arten. Die Quaternius-Modelle kommen in beliebiger Grösse und Richtung:
 *  - len  = echte Körperlänge in m (gemessen entlang der Vorwärtsachse, inkl. Schwanz)
 *  - span = Flügelspannweite in m (statt len, für Vögel)
 *  - yaw  = Drehung, damit der Kopf nach lokal +Z zeigt (Spiel-Konvention: vorwärts = (sin y, cos y)).
 *    Bestimmt per Skript (Bind-Pose mit Skinning ausgewertet): Lage der Kopf-/Schwanz-Knochen
 *    ("Head_end", "Tail1…4"), Richtung der Zehen-Knochen (zeigen nach vorne) und die Querschnitte
 *    des Meshes (Schwanzflosse/Fluke = flach und breit bzw. dünn und hoch, Kopf = viele Vertices):
 *      +Z vorne (yaw 0):      cow, horse, zebra, llama, pig, pug, sheep, bird, fish, piranha, whale
 *      +X vorne (yaw −π/2):   cat, dog, wolf, chick
 *      −Z vorne (yaw π):      red_fox, eagle
 *  - medium: land | water | air
 *  - walk/run: Tempo in m/s, flee: Fluchtdistanz zum Spieler (0 = keine Flucht)
 *  - clips: Vorlieben für die Animations-Rollen (Teilstring, Gross/Klein egal)
 */
const SPECIES = {
  cow:     { len: 2.2, yaw: 0, medium: 'land', big: true, herd: true, walk: 0.9, run: 4.5, flee: 6, turn: 2.5 },
  horse:   { len: 2.3, yaw: 0, medium: 'land', big: true, herd: true, walk: 1.3, run: 7, flee: 6, turn: 3 },
  zebra:   { len: 2.2, yaw: 0, medium: 'land', big: true, herd: true, walk: 1.3, run: 7, flee: 6, turn: 3 },
  // Llama, Schwein, Schaf haben nur Idle + Jump: gemächlich gleiten mit Idle, flüchten mit Jump (Hüpf-Galopp)
  llama:   { len: 1.8, yaw: 0, medium: 'land', big: true, herd: true, walk: 0.6, run: 4.5, flee: 6, turn: 2.5,
             clips: { walk: ['idle'], run: ['jump'] } },
  pig:     { len: 1.4, yaw: 0, medium: 'land', big: true, herd: true, walk: 0.5, run: 3.5, flee: 6, turn: 3,
             clips: { walk: ['idle'], run: ['jump'] } },
  sheep:   { len: 1.3, yaw: 0, medium: 'land', big: true, herd: true, walk: 0.5, run: 4, flee: 6, turn: 3,
             clips: { walk: ['idle'], run: ['jump'] } },
  pug:     { len: 0.45, yaw: 0, medium: 'land', walk: 0.8, run: 2, flee: 0, turn: 5,
             clips: { walk: ['jump'], run: ['jump'] } },       // kleiner Hund hüpft
  cat:     { len: 0.5, yaw: -Math.PI / 2, medium: 'land', walk: 0.6, run: 2.8, flee: 2.5, turn: 5 },
  dog:     { len: 0.9, yaw: -Math.PI / 2, medium: 'land', walk: 1.0, run: 3.5, flee: 0, turn: 5 },
  chick:   { len: 0.25, yaw: -Math.PI / 2, medium: 'land', walk: 0.35, run: 1.4, flee: 1.8, turn: 6 },
  wolf:    { len: 1.4, yaw: -Math.PI / 2, medium: 'land', walk: 1.3, run: 5, flee: 0, turn: 4, wolf: true },
  red_fox: { len: 0.9, yaw: Math.PI, medium: 'land', walk: 1.2, run: 5, flee: 11, turn: 5 },
  fish:    { len: 0.4, yaw: 0, medium: 'water', depth: 1, walk: 0.9, run: 2.5, flee: 3, turn: 4 },
  piranha: { len: 0.35, yaw: 0, medium: 'water', depth: 1, walk: 1.1, run: 3, flee: 3, turn: 4 },
  whale:   { len: 12, yaw: 0, medium: 'water', depth: 3.5, walk: 1.6, run: 1.6, flee: 0, turn: 0.4 },
  bird:    { span: 0.5, yaw: 0, medium: 'air', speed: 6 },
  eagle:   { span: 1.8, yaw: Math.PI, medium: 'air', speed: 9 },
};

// Standard-Vorlieben pro Rolle (exakter Name zuerst, dann Teilstring)
const CLIP_PREFS = {
  idle: ['idle', 'flying', 'swimming'],
  walk: ['walkslow', 'walking', 'walk', 'flying', 'swimming'],
  run: ['run', 'walk', 'walking', 'flying', 'swimming'],
};
const HERD_TYPES = [['cow', 3], ['sheep', 3], ['horse', 2], ['pig', 2], ['llama', 1.5], ['zebra', 0.7]];
const PETS = ['dog', 'cat', 'chick', 'pug', 'chick', 'cat'];

const clipBase = (c) => c.name.split('|').pop().toLowerCase();

function findClip(clips, prefs) {
  for (const p of prefs) { const c = clips.find((k) => clipBase(k) === p); if (c) return c; }
  for (const p of prefs) { const c = clips.find((k) => clipBase(k).includes(p)); if (c) return c; }
  return null;
}

/** Hauptclip als Rückfallebene: längster Clip, der kein Tod/Biss/Einzelbild ist. */
function mainClip(clips) {
  const ok = clips.filter((c) => !/death|bite/.test(clipBase(c)));
  const list = ok.length ? ok : clips;
  return list.reduce((a, b) => (b.duration > a.duration ? b : a), list[0]);
}

function pickWeighted(list, r) {
  const total = list.reduce((s, [, w]) => s + w, 0);
  let x = r * total;
  for (const [k, w] of list) { if ((x -= w) <= 0) return k; }
  return list[list.length - 1][0];
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function hitsObstacle(o, x, z, r) {
  const dx = x - o.x, dz = z - o.z;
  if (o.type === 'circle') return dx * dx + dz * dz < (o.r + r) * (o.r + r);
  const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
  return Math.abs(lx) < o.hw + r && Math.abs(lz) < o.hd + r;
}

// ---------- Ein Tier ----------
class Animal {
  constructor(tpl, x, z, herd, rand, chunkKey, id) {
    this.sp = tpl.sp;
    this.name = tpl.name;
    this.tpl = tpl;
    this.herd = herd;            // { x, z, r, panicUntil } – geteilt von Herde/Schwarm/Dorf
    this.rand = rand;
    this.chunkKey = chunkKey;
    this.id = id;
    this.ridden = false;
    this.startPet = false;

    this.root = new THREE.Group();
    this.root.name = `Tier ${tpl.name}`;
    this.root.rotation.order = 'YXZ';   // erst Richtung, dann Neigung am Hang
    this.model = cloneSkinned(tpl.pivot);
    // Skinned Meshes: die Begrenzungskugel stammt von der Vorlage am Ursprung → weit entfernte Tiere
    // würden fälschlich weggeschnitten. Sichtweite regelt VISIBLE_DIST selbst.
    this.model.traverse((m) => { if (m.isMesh) m.frustumCulled = false; });
    this.root.add(this.model);
    this.root.position.set(x, 0, z);
    this.heading = rand() * TAU;
    this.root.rotation.y = this.heading;
    this.fx = Math.sin(this.heading); this.fz = Math.cos(this.heading);

    this.mixer = new THREE.AnimationMixer(this.model);
    const c = tpl.clips;
    // gleicher Clip für mehrere Rollen → gleiche Action (clipAction cached)
    this.actions = {
      idle: this.mixer.clipAction(c.idle),
      walk: this.mixer.clipAction(c.walk),
      run: this.mixer.clipAction(c.run),
    };
    this.current = this.actions.idle;
    this.current.time = rand() * c.idle.duration;   // nicht alle im Gleichtakt
    this.current.play();

    this.state = 'idle';
    this.timer = 0.5 + rand() * 4;
    this.tx = x; this.tz = z;
    this.speed = 0;
    this.avoid = 0; this.avoidT = 0;
    this.checkT = 0; this.pathOk = true;
    this.pitch = 0;
    this.circleDir = rand() < 0.5 ? -1 : 1;
    this.obsLists = [];          // Hindernislisten der umliegenden Chunks (zwischengespeichert)
    this.obsCx = NaN; this.obsCz = NaN; this.obsT = 0;
    this.bob = rand() * TAU;
  }

  /** Animation abspielen: 'idle' | 'walk' | 'run' (auch von aussen nutzbar, z. B. beim Reiten). */
  play(role, timeScale = 1, fade = 0.35) {
    const next = this.actions[role];
    if (next !== this.current) {
      next.reset().play();
      this.current.crossFadeTo(next, fade, false);
      this.current = next;
    }
    next.timeScale = timeScale;
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    // Geometrien und Materialien gehören der Vorlage (geteilt) → nicht freigeben
  }
}

/**
 * Tiere in der offenen Welt: Herden auf Wiesen, Füchse/Wölfe im Wald, Haustiere in Dörfern,
 * Fische und Wale im Wasser, Vögel am Himmel. Pro Chunk deterministisch (Seed), werden mit
 * dem Chunk geladen und entfernt.
 *
 * Optional: `blocked(x, z)` – zusätzliche Kollisionsprüfung (z. B. Häuser des Blender-Startdorfs,
 * die nicht in den Chunk-Hindernissen stehen). Wird nur für die Haustiere im Startdorf benutzt.
 */
export class AnimalManager {
  constructor({ scene, terrain, chunks, seed, loader, blocked = null }) {
    Object.assign(this, { scene, terrain, chunks, seed, blocked });
    this.loader = loader ?? new GLTFLoader();
    this.templates = {};        // Art → { name, sp, pivot, clips, ... }
    this.all = [];
    this.spawned = new Set();   // Chunk-Keys, für die schon Tiere erzeugt wurden
    this.liveIds = new Set();   // verhindert Doppelte (z. B. gerittenes Pferd, Chunk lädt neu)
    this.time = 0;
    this.syncT = 0;
    this.px = 0; this.pz = 0;
  }

  get count() { return this.all.length; }

  // ---------- Laden & Normalisieren ----------
  async init() {
    const names = Object.keys(SPECIES);
    const results = await Promise.allSettled(names.map((n) => this.loader.loadAsync(`models/tiere/${n}.glb`)));
    results.forEach((res, i) => {
      if (res.status === 'fulfilled') this.templates[names[i]] = this.makeTemplate(names[i], res.value);
      else console.warn(`[Tiere] ${names[i]}.glb konnte nicht geladen werden`, res.reason);
    });
    console.info(`[Tiere] ${Object.keys(this.templates).length} Arten geladen`);
  }

  makeTemplate(name, gltf) {
    const sp = SPECIES[name];
    const inner = gltf.scene;
    // Kamera/Lichter aus dem Export entfernen
    const junk = [];
    inner.traverse((o) => { if (o.isLight || o.isCamera) junk.push(o); });
    junk.forEach((o) => o.removeFromParent());

    // Material einmal pro Vorlage umwandeln (Physical → Standard, günstiger) und teilen
    const matCache = new Map();
    const convert = (m) => {
      if (!matCache.has(m)) {
        let s = m;
        if (m.isMeshPhysicalMaterial) { s = new THREE.MeshStandardMaterial(); s.copy(m); m.dispose(); }
        // Quaternius-FBX bringt teils Deckkraft 0 + Alpha-Maske mit → Tier wäre unsichtbar (nur Schatten)
        s.opacity = 1; s.transparent = false; s.alphaTest = 0; s.alphaMap = null;
        s.needsUpdate = true;
        matCache.set(m, s);
      }
      return matCache.get(m);
    };
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
      o.castShadow = sp.medium !== 'water';
      o.receiveShadow = true;
    });

    // Ausrichten: Kopf nach +Z, dann auf echte Grösse skalieren und zentrieren
    const pivot = new THREE.Group();
    pivot.add(inner);
    inner.rotation.y += sp.yaw;
    pivot.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot, true);   // genau: mit Skinning
    const size = box.getSize(new THREE.Vector3());
    const s = sp.span ? sp.span / size.x : sp.len / size.z;
    inner.scale.multiplyScalar(s);
    pivot.updateMatrixWorld(true);
    box.setFromObject(pivot, true);
    const center = box.getCenter(new THREE.Vector3());
    inner.position.x -= center.x;
    inner.position.z -= center.z;
    inner.position.y -= sp.medium === 'land' ? box.min.y : center.y;   // Landtiere: Füsse auf y = 0
    pivot.updateMatrixWorld(true);
    box.setFromObject(pivot, true);
    box.getSize(size);

    // Geteilte, grosszügige Bounding-Sphere (Animation bewegt Gliedmassen) → Frustum-Culling bleibt aktiv
    inner.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      o.computeBoundingSphere();
      o.boundingSphere.radius *= 1.5;
    });

    const clips = gltf.animations;
    const fallback = mainClip(clips);
    const pick = (role) => findClip(clips, sp.clips?.[role] ?? CLIP_PREFS[role]) ?? fallback;
    let idle = pick('idle'), walk = pick('walk'), run = pick('run');
    if (sp.medium !== 'land') { walk = run = fallback; idle = findClip(clips, ['flying', 'swimming']) ?? fallback; }
    if (name === 'eagle' || name === 'bird') idle = walk = run = findClip(clips, ['flying']) ?? fallback;

    const len = size.z, width = size.x;
    return {
      name, sp, pivot, clips: { idle, walk, run },
      len, width, height: size.y,
      radius: Math.min(width / 2, 0.45),                      // Fussabdruck für Hindernisse
      seg: Math.max(0, len / 2 - width / 2),                   // Kapsel für Spieler-Kollision
      idleSlow: idle === walk ? 0.3 : 1,                       // nur ein Clip → im Stehen langsam abspielen
    };
  }

  // ---------- Erzeugen/Entfernen mit den Chunks ----------
  sync() {
    const loaded = this.chunks.chunks;
    // Tiere entladener Chunks entfernen (gerittene bleiben)
    for (let i = this.all.length - 1; i >= 0; i--) {
      const a = this.all[i];
      if (a.ridden || loaded.has(a.chunkKey)) continue;
      this.removeAt(i);
    }
    for (const key of this.spawned) if (!loaded.has(key)) this.spawned.delete(key);
    // Neue Chunks bevölkern
    for (const [key, chunk] of loaded) {
      if (this.spawned.has(key)) continue;
      if (this.all.length >= MAX_ANIMALS) break;   // später nochmals versuchen
      this.spawned.add(key);
      this.spawnChunk(key, chunk.cx, chunk.cz);
    }
  }

  removeAt(i) {
    const a = this.all[i];
    a.dispose(this.scene);
    this.liveIds.delete(a.id);
    this.all[i] = this.all[this.all.length - 1];
    this.all.pop();
  }

  spawnChunk(key, cx, cz) {
    const r = mulberry32(hash2(cx, cz, this.seed ^ SEED_SALT));
    const T = this.terrain;
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const plan = [];   // [art, x, z, herde, startPet]
    const herdAt = (x, z, rad) => ({ x, z, r: rad, panicUntil: 0 });

    // Startdorf: ein paar Haustiere auf den Wegen (am Chunk 0,0 aufgehängt)
    if (cx === 0 && cz === 0) {
      for (const [n, x, z] of [['chick', -2.5, 6], ['chick', -1.5, 7.5], ['dog', 2.5, 8], ['cat', 1, 16]]) {
        plan.push([n, x, z, herdAt(x, z, 5), true]);
      }
    }

    // Dorf: Hunde, Katzen, Küken, Möpse rund ums Zentrum
    const v = this.chunks.villageAt(cx, cz);
    if (v) {
      const n = 2 + Math.floor(r() * 3);
      const herd = herdAt(v.x, v.z, 13);
      for (let i = 0; i < n; i++) {
        const a = r() * TAU, d = 4 + r() * 8;
        plan.push([PETS[Math.floor(r() * PETS.length)], v.x + Math.cos(a) * d, v.z + Math.sin(a) * d, herd, false]);
      }
    }

    // Probepunkte (immer gleich viele Zufallszahlen → deterministisch)
    const P = [];
    for (let i = 0; i < 4; i++) P.push([x0 + 6 + r() * 52, z0 + 6 + r() * 52]);
    const rollA = r(), rollB = r(), rollW = r(), rollS = r(), rollWhale = r();
    const sx = x0 + 8 + r() * 48, sz = z0 + 8 + r() * 48;
    const sub = mulberry32(hash2(cx, cz, this.seed ^ (SEED_SALT * 3)));
    const far = (x, z) => Math.hypot(x, z) > START_CLEAR + 10;

    // Wiese → Herde
    const meadow = P.find(([x, z]) => {
      const h = T.height(x, z);
      return h > SEA_LEVEL + 1 && h < 25 && far(x, z) && 1 - T.normal(x, z).y < 0.15 && T.forest(x, z) < 0.4
        && !this.chunks.nearVillage?.(x, z, cx, cz);
    });
    if (meadow && rollA < 0.25) {
      const [ax, az] = meadow;
      const type = pickWeighted(HERD_TYPES, sub());
      const n = 2 + Math.floor(sub() * 5);
      const herd = herdAt(ax, az, 9);
      for (let i = 0; i < n; i++) {
        const a = sub() * TAU, d = 1.5 + sub() * 5;
        plan.push([type, ax + Math.cos(a) * d, az + Math.sin(a) * d, herd, false]);
      }
    }

    // Wald → Fuchs- oder Wolfspaar
    const forest = P.find(([x, z]) => {
      const h = T.height(x, z);
      return T.forest(x, z) > 0.5 && h > SEA_LEVEL + 1 && h < 38 && far(x, z) && 1 - T.normal(x, z).y < 0.3;
    });
    if (forest && rollB < 0.22) {
      const [bx, bz] = forest;
      const type = sub() < 0.6 ? 'red_fox' : 'wolf';
      const herd = herdAt(bx, bz, 14);
      plan.push([type, bx, bz, herd, false], [type, bx + 1.5, bz + 1, herd, false]);
    }

    // Wasser → Fischschwarm, sehr selten ein Wal in grossen, tiefen Seen
    const water = P.find(([x, z]) => T.height(x, z) < SEA_LEVEL - 1.2);
    if (water && rollW < 0.45) {
      const [wx, wz] = water;
      const type = sub() < 0.3 ? 'piranha' : 'fish';
      const n = 3 + Math.floor(sub() * 4);
      const herd = herdAt(wx, wz, 8);
      for (let i = 0; i < n; i++) plan.push([type, wx + (sub() - 0.5) * 3, wz + (sub() - 0.5) * 3, herd, false]);
    }
    if (water && rollWhale < 0.06 && this.isDeepLake(water[0], water[1])) {
      plan.push(['whale', water[0], water[1], herdAt(water[0], water[1], 30), false]);
    }

    // Himmel → Vögel, die kreisen
    if (rollS < 0.15) {
      const eagle = sub() < 0.35;
      const n = eagle ? 1 : 1 + Math.floor(sub() * 3);
      for (let i = 0; i < n; i++) plan.push([eagle ? 'eagle' : 'bird', sx, sz, null, false]);
    }

    // Umsetzen
    plan.forEach(([name, x, z, herd, startPet], i) => {
      const tpl = this.templates[name];
      const id = `${key}#${i}`;
      if (!tpl || this.liveIds.has(id) || this.all.length >= MAX_ANIMALS) return;
      const rand = mulberry32(hash2(cx * 31 + i, cz, this.seed ^ 0xa11));
      if (tpl.sp.medium === 'air') return this.spawnBird(tpl, x, z, rand, key, id);
      if (!startPet && !this.validSpot(tpl, x, z, false, null)) return;
      const a = new Animal(tpl, x, z, herd, rand, key, id);
      a.startPet = startPet;
      this.placeOnGround(a);
      this.add(a);
    });
  }

  isDeepLake(x, z) {
    const T = this.terrain;
    if (T.height(x, z) > SEA_LEVEL - 4.5) return false;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      for (const d of [20, 35]) if (T.height(x + Math.cos(a) * d, z + Math.sin(a) * d) > SEA_LEVEL - 3) return false;
    }
    return true;
  }

  spawnBird(tpl, x, z, rand, key, id) {
    const a = new Animal(tpl, x, z, null, rand, key, id);
    a.cx = x; a.cz = z;
    a.R = (tpl.name === 'eagle' ? 18 : 8) + rand() * 14;
    a.ang = rand() * TAU;
    a.angSpeed = (tpl.sp.speed / a.R) * (rand() < 0.5 ? -1 : 1);
    a.baseY = Math.max(this.terrain.height(x, z), SEA_LEVEL) + 15 + rand() * 25;
    a.root.position.y = a.baseY;
    this.updateAir(a, 0);
    this.add(a);
  }

  add(a) {
    this.scene.add(a.root);
    this.all.push(a);
    this.liveIds.add(a.id);
  }

  placeOnGround(a) {
    const p = a.root.position;
    if (a.sp.medium === 'water') p.y = this.waterY(a, p.x, p.z);
    else p.y = this.terrain.height(p.x, p.z);
  }

  waterY(a, x, z) {
    if (a.name === 'whale') return Math.min(SEA_LEVEL - 1.3, Math.max(SEA_LEVEL - 2, this.terrain.height(x, z) + a.tpl.height / 2 + 0.3));
    return WATER_Y;
  }

  // ---------- Gültige Orte & Hindernisse ----------
  refreshObstacles(a) {
    const p = a.root.position;
    const cx = Math.floor(p.x / CHUNK_SIZE), cz = Math.floor(p.z / CHUNK_SIZE);
    a.obsT -= 1;
    if (cx === a.obsCx && cz === a.obsCz && a.obsT > 0) return;
    a.obsCx = cx; a.obsCz = cz; a.obsT = 40;   // Zähler in Prüfungen (~6 s), dann neu (Nachbarn könnten nachgeladen sein)
    a.obsLists.length = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.chunks.chunks.get(`${cx + dx},${cz + dz}`);
      if (c && c.obstacles.length) a.obsLists.push(c.obstacles);
    }
  }

  blockedAt(a, x, z) {
    const r = a.tpl.radius;
    for (let i = 0; i < a.obsLists.length; i++) {
      const list = a.obsLists[i];
      for (let j = 0; j < list.length; j++) if (hitsObstacle(list[j], x, z, r)) return true;
    }
    if (a.startPet && this.blocked && this.blocked(x, z)) return true;
    return false;
  }

  /** Taugt (x,z) als Ziel/Spawnpunkt? (a = null beim Spawnen: Hindernisse über obstaclesNear) */
  validSpot(tpl, x, z, startPet, a) {
    const T = this.terrain, sp = tpl.sp;
    const h = T.height(x, z);
    if (sp.medium === 'water') return h < SEA_LEVEL - sp.depth;
    if (!startPet && x * x + z * z < START_CLEAR * START_CLEAR) return false;
    if (h < SEA_LEVEL + 0.5) return false;
    if (T.normal(x, z).y < 0.75) return false;
    if (a) return !this.blockedAt(a, x, z);
    for (const o of this.chunks.obstaclesNear(x, z)) if (hitsObstacle(o, x, z, tpl.radius)) return false;
    return true;
  }

  /** Kann das Tier in Blickrichtung weitergehen? Prüft einen Punkt etwas voraus. */
  canMove(a) {
    const T = this.terrain, sp = a.sp, p = a.root.position;
    const look = Math.max(0.6, a.tpl.len * 0.55, a.speed * 0.25);
    const x = p.x + a.fx * look, z = p.z + a.fz * look;
    const h = T.height(x, z);
    if (sp.medium === 'water') {
      if (h > SEA_LEVEL - sp.depth) return false;
      if (a.name === 'whale') {   // Wal: auch etwas seitlich genug tief
        const sx = a.fz * 3, sz = -a.fx * 3;
        if (T.height(x + sx, z + sz) > SEA_LEVEL - sp.depth || T.height(x - sx, z - sz) > SEA_LEVEL - sp.depth) return false;
      }
      return true;
    }
    if (!a.startPet && x * x + z * z < START_CLEAR * START_CLEAR) return false;
    if (h < SEA_LEVEL + 0.3) return false;                                  // Landtiere meiden Wasser
    if (Math.abs(h - T.height(p.x, p.z)) / look > MAX_SLOPE) return false;  // zu steil
    if (a.state !== 'flee') {                                               // nicht in den Spieler laufen
      const dx = x - this.px, dz = z - this.pz;
      if (dx * dx + dz * dz < (0.5 + a.tpl.radius) ** 2) return false;
    }
    this.refreshObstacles(a);
    return !this.blockedAt(a, x, z);
  }

  pickTarget(a) {
    const herd = a.herd;
    if (a.sp.herd && a.rand() < 0.12) {   // Herde zieht langsam weiter
      const ang = a.rand() * TAU, d = 3 + a.rand() * 5;
      const nx = herd.x + Math.cos(ang) * d, nz = herd.z + Math.sin(ang) * d;
      if (this.validSpot(a.tpl, nx, nz, a.startPet, a)) { herd.x = nx; herd.z = nz; }
    }
    for (let i = 0; i < 6; i++) {
      const ang = a.rand() * TAU, d = Math.sqrt(a.rand()) * herd.r;
      const x = herd.x + Math.cos(ang) * d, z = herd.z + Math.sin(ang) * d;
      if (this.validSpot(a.tpl, x, z, a.startPet, a)) { a.tx = x; a.tz = z; return true; }
    }
    return false;
  }

  // ---------- KI ----------
  update(dt, playerPos) {
    this.time += dt;
    this.px = playerPos.x; this.pz = playerPos.z;
    this.syncT -= dt;
    if (this.syncT <= 0) { this.syncT = SYNC_INTERVAL; this.sync(); }

    for (let i = 0; i < this.all.length; i++) {
      const a = this.all[i];
      const p = a.root.position;
      if (a.dead) {   // umgefallen: kippen, kurz liegen, dann versinken und verschwinden
        a.deadT += dt;
        a.root.rotation.z = Math.min(1, a.deadT / 0.5) * (Math.PI / 2) * a.fallSide;
        if (a.deadT > 3) p.y -= dt * 0.4;
        if (a.deadT > 5) { this.removeAt(i); i--; }
        continue;
      }
      const dist = Math.hypot(p.x - this.px, p.z - this.pz);
      a.root.visible = a.ridden || dist < VISIBLE_DIST;
      if (a.ridden) {   // Reiter steuert root; wir spielen nur die Animation weiter
        a.heading = a.root.rotation.y; a.fx = Math.sin(a.heading); a.fz = Math.cos(a.heading);
        a.mixer.update(dt);
        continue;
      }
      if (dist > ACTIVE_DIST) continue;
      if (a.sp.medium === 'air') this.updateAir(a, dt);
      else this.updateGround(a, dt, dist);
      a.mixer.update(dt);
    }
  }

  updateGround(a, dt, dist) {
    const sp = a.sp, p = a.root.position, herd = a.herd;
    const px = this.px, pz = this.pz;
    let desired = a.heading, want = 0;

    // Gefahr: Spieler zu nah (Herde: Panik steckt an)
    if (sp.flee > 0) {
      const panic = herd.panicUntil > this.time;
      if (dist < (panic ? sp.flee * 2 : sp.flee)) {
        a.state = 'flee';
        a.timer = 2 + a.rand() * 2;
        if (sp.herd) herd.panicUntil = this.time + 2.5;
      }
    }
    // Wolf: hält Abstand und umkreist den Spieler
    if (sp.wolf && a.state !== 'circle' && dist < 22) a.state = 'circle';

    switch (a.state) {
      case 'flee': {
        desired = Math.atan2(p.x - px, p.z - pz);
        want = sp.run;
        a.timer -= dt;
        if (a.timer <= 0 && dist > sp.flee * 1.6 && herd.panicUntil <= this.time) {
          a.state = 'idle'; a.timer = 1 + a.rand() * 2;
          herd.x += (p.x - herd.x) * 0.5; herd.z += (p.z - herd.z) * 0.5;   // Herde sammelt sich am neuen Ort
        }
        break;
      }
      case 'circle': {
        if (dist > 30) { a.state = 'idle'; a.timer = 1 + a.rand() * 3; herd.x = p.x; herd.z = p.z; break; }
        const toPlayer = Math.atan2(px - p.x, pz - p.z);
        if (dist < 9) { desired = toPlayer + Math.PI; want = sp.run * 0.7; }
        else {
          // tangential laufen, bei zu grossem/kleinem Abstand leicht nach innen/aussen
          const bend = Math.max(-0.6, Math.min(0.6, (dist - 14) * 0.12));
          desired = toPlayer + a.circleDir * (Math.PI / 2 - bend);
          want = sp.walk * 1.4;
        }
        break;
      }
      case 'walk': {
        const dx = a.tx - p.x, dz = a.tz - p.z;
        if (dx * dx + dz * dz < 0.5) {
          a.state = 'idle';
          a.timer = sp.medium === 'water' ? 0.3 + a.rand() * 1.5 : sp.herd ? 3 + a.rand() * 9 : 1 + a.rand() * 4;
        } else { desired = Math.atan2(dx, dz); want = sp.walk; }
        break;
      }
      default: {   // idle: grasen, schnuppern, treiben
        a.timer -= dt;
        if (a.timer <= 0) {
          if (this.pickTarget(a)) a.state = 'walk';
          else a.timer = 1.5;
        }
      }
    }

    if (a.avoidT > 0) { a.avoidT -= dt; desired += a.avoid; }

    // Weich drehen; erst ausrichten, dann losgehen (bei Flucht sofort)
    const diff = wrapAngle(desired - a.heading);
    a.heading += diff * (1 - Math.exp(-sp.turn * dt));
    a.fx = Math.sin(a.heading); a.fz = Math.cos(a.heading);
    a.root.rotation.y = a.heading;
    const align = Math.cos(diff);
    const minAlign = a.state === 'flee' || a.state === 'circle' ? 0.35 : 0;
    a.speed += (want * Math.max(align, minAlign) - a.speed) * (1 - Math.exp(-3 * dt));
    if (want === 0 && a.speed < 0.03) a.speed = 0;

    if (a.speed > 0.03) {
      a.checkT -= dt;
      if (a.checkT <= 0) { a.checkT = 0.15; a.pathOk = this.canMove(a); }
      if (a.pathOk) {
        const step = a.speed * dt;
        p.x += a.fx * step; p.z += a.fz * step;
        this.placeOnGround(a);
      } else {
        a.speed *= 0.3;
        a.checkT = 0;
        if (a.state === 'walk') { a.state = 'idle'; a.timer = 0.4 + a.rand(); }
        else if (a.avoidT <= 0) { a.avoid = (a.rand() < 0.5 ? -1 : 1) * (0.9 + a.rand() * 0.9); a.avoidT = 0.8; }
      }
    }

    if (sp.medium === 'water') {
      a.bob += dt * 2;
      p.y = this.waterY(a, p.x, p.z) + Math.sin(a.bob) * (a.name === 'whale' ? 0.15 : 0.06);
    } else if (a.tpl.len > 0.8 && dist < 60) {
      // Am Hang neigen (vorne höher → Nase hoch)
      const half = a.tpl.len * 0.4;
      const hf = this.terrain.height(p.x + a.fx * half, p.z + a.fz * half);
      const hb = this.terrain.height(p.x - a.fx * half, p.z - a.fz * half);
      const target = Math.atan2(hb - hf, half * 2);
      a.pitch += (target - a.pitch) * (1 - Math.exp(-6 * dt));
      a.root.rotation.x = a.pitch;
    }

    // Animation passend zum Tempo
    if (a.speed > (sp.walk + sp.run) * 0.5) a.play('run', Math.max(0.6, Math.min(1.5, a.speed / sp.run)));
    else if (a.speed > 0.12) a.play('walk', Math.max(0.5, Math.min(1.6, a.speed / sp.walk)));
    else a.play('idle', a.tpl.idleSlow);
  }

  updateAir(a, dt) {
    const p = a.root.position;
    a.ang += a.angSpeed * dt;
    const c = Math.cos(a.ang), s = Math.sin(a.ang);
    p.x = a.cx + c * a.R;
    p.z = a.cz + s * a.R;
    const sgn = a.angSpeed > 0 ? 1 : -1;
    a.heading = Math.atan2(-s * sgn, c * sgn);   // Tangente der Kreisbahn
    a.root.rotation.y = a.heading;
    a.root.rotation.z = -sgn * 0.22;             // in die Kurve legen
    const minY = Math.max(this.terrain.height(p.x, p.z), SEA_LEVEL) + 10;
    const ty = Math.max(a.baseY, minY);
    p.y += (ty - p.y) * (dt > 0 ? 1 - Math.exp(-1.5 * dt) : 1);
  }

  // ---------- Schnittstellen für Spieler/Reiten ----------
  /** true, wenn ein grosses Tier (Kuh, Pferd, Zebra, Llama, Schwein, Schaf) den Punkt blockiert. */
  collides(x, z, radius) {
    for (let i = 0; i < this.all.length; i++) {
      const a = this.all[i];
      if (!a.sp.big || a.ridden || a.dead) continue;
      const p = a.root.position, t = a.tpl;
      const ex = x - p.x, ez = z - p.z;
      const reach = t.len / 2 + radius;
      if (ex * ex + ez * ez > reach * reach) continue;
      // Kapsel entlang der Körperachse
      const k = Math.max(-t.seg, Math.min(t.seg, ex * a.fx + ez * a.fz));
      const qx = ex - a.fx * k, qz = ez - a.fz * k;
      const rr = t.width / 2 + radius;
      if (qx * qx + qz * qz < rr * rr) return true;
    }
    return false;
  }

  // ---------- Schnittstelle für das Zerstörungs-System (combat.js) ----------

  /** Treffbare Tiere in der Nähe (nur an Land; gerittene nicht). */
  *targetsNear(x, z) {
    for (const a of this.all) {
      if (a.dead || a.ridden || a.sp.medium !== 'land') continue;
      const p = a.root.position;
      const ex = p.x - x, ez = p.z - z;
      if (ex * ex + ez * ez > 49) continue;
      yield (a.target ??= this._makeTarget(a));
    }
  }

  _makeTarget(a) {
    const NAME = { cow: 'Kuh', horse: 'Pferd', zebra: 'Zebra', llama: 'Lama', pig: 'Schwein', sheep: 'Schaf', pug: 'Mops',
      cat: 'Katze', dog: 'Hund', wolf: 'Wolf', red_fox: 'Fuchs', chick: 'Küken' };
    const len = a.tpl.len ?? 1;
    const hp = Math.round(15 + len * 30);
    const mgr = this;
    return {
      animal: a, material: 'tier', name: NAME[a.name] ?? 'Tier', hp, maxHp: hp,
      get x() { return a.root.position.x; }, get z() { return a.root.position.z; }, get y() { return a.root.position.y; },
      r: (a.tpl.width ?? 0.6) / 2 + 0.2, height: Math.max(0.3, len * 0.6), shakeObj: a.root,
      onHit(fromX, fromZ) {   // erschrecken → wegrennen
        a.state = 'flee'; a.timer = 3;
        if (a.herd) a.herd.panicUntil = mgr.time + 4;
      },
      destroy() {
        a.dead = true; a.deadT = 0; a.fallSide = Math.random() < 0.5 ? -1 : 1;
        a.mixer.stopAllAction();
        const n = len > 1.6 ? 3 : len > 0.8 ? 2 : 1;
        return a.name === 'chick' ? [['chickenleg', 1]] : [['rohfleisch', n]];
      },
    };
  }

  /** Nächstes Pferd innerhalb maxDist → { animal, object3d } oder null. */
  findRideable(pos, maxDist) {
    let best = null, bestD = maxDist * maxDist;
    for (const a of this.all) {
      if (a.name !== 'horse' || a.dead) continue;
      const p = a.root.position;
      const d = (p.x - pos.x) ** 2 + (p.z - pos.z) ** 2;
      if (d <= bestD) { bestD = d; best = a; }
    }
    return best ? { animal: best, object3d: best.root } : null;
  }

  /** Während geritten: keine KI, wird nicht mit dem Chunk entfernt. */
  setRidden(animal, ridden) {
    animal.ridden = !!ridden;
    if (ridden) {
      animal.state = 'ridden';
      animal.speed = 0;
      animal.root.rotation.x = 0; animal.pitch = 0;
      return;
    }
    // Absteigen: gehört jetzt zum Chunk, in dem es steht, und bildet eine eigene kleine "Herde"
    const p = animal.root.position;
    animal.chunkKey = `${Math.floor(p.x / CHUNK_SIZE)},${Math.floor(p.z / CHUNK_SIZE)}`;
    animal.herd = { x: p.x, z: p.z, r: 8, panicUntil: 0 };
    animal.heading = animal.root.rotation.y;
    animal.state = 'idle'; animal.timer = 2;
    animal.obsT = 0;
  }
}
