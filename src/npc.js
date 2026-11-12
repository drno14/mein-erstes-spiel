import * as THREE from 'three/webgpu';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mulberry32, hash2 } from './world/noise.js';
import { SEA_LEVEL } from './world/terrain.js';
import { createPoseApplier } from './poseSettings.js';

const NPC_SPEED = 1.3;          // gemütliches Schlendern (m/s)
const NPC_RADIUS = 0.35;
const WANDER_RADIUS = 13;       // so weit entfernen sie sich von ihrem Zuhause
const GREET_DIST = 4;           // ab hier bleiben sie stehen und reden
const NAME_DIST = 14;           // ab hier sieht man den Namen
const ACTIVE_DIST = 110;        // weiter weg: keine Animation (spart Leistung)

const NAMES_M = ['Ben', 'David', 'Finn', 'Hugo', 'Jonas', 'Max', 'Paul', 'Tom', 'Luca', 'Emil', 'Oskar', 'Theo', 'Nico', 'Elias', 'Levin', 'Samuel'];
const NAMES_F = ['Anna', 'Clara', 'Elif', 'Greta', 'Ida', 'Lea', 'Mia', 'Rosa', 'Yara', 'Nina', 'Lina', 'Zoe', 'Sara', 'Lara', 'Julia', 'Emma'];
const LINES = [
  'Grüezi! Schönes Wetter heute.',
  'Pass auf in den Bergen – da wird es steil!',
  'Hast du den See hinter dem Wald gesehen?',
  'Willkommen in unserem Dorf!',
  'Ich suche meine Katze … hast du sie gesehen?',
  'Die Tannen da oben sind uralt.',
  'Auf den Gipfeln liegt das ganze Jahr Schnee.',
  'Hinter den Hügeln soll es noch mehr Dörfer geben.',
  'Ich war heute schon am Strand baden.',
  'Mit der Leertaste kommst du über jeden Zaun!',
  'Na, auch auf Wanderschaft?',
  'Mein Haus ist das mit dem roten Dach.',
];
// Das Modell hat echte Texturen (MPFB/MakeHuman) → Farben werden mit der Textur multipliziert.
// Weiss = Original, dunklere/farbige Werte tönen ab.
const PALETTE = {
  Haut: [0xffffff, 0xf2dccb, 0xdcb59a, 0xb08060, 0x82593f, 0x5e3f2c],
  Kleidung: [0xffffff, 0xbfd4ff, 0xffcfc0, 0xc8f0c8, 0xe2d6ff, 0xfff0b0, 0xa8a8a8, 0x9fc8d8],
  Haare: [0xffffff, 0x6a4a35, 0x3a2a1e, 0xe8c890, 0xa0a0a0, 0x8a4a2a],
  Schuhe: [0xffffff, 0x8a6a50, 0x505050, 0xc0a080],
};
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

class Npc {
  constructor(template, home, rand, terrain) {
    const clips = template.clips;
    this.home = home;
    this.rand = rand;
    this.terrain = terrain;
    this.female = template.female;
    this.name = pick(template.female ? NAMES_F : NAMES_M, rand);
    this.line = pick(LINES, rand);

    // Modell klonen (inkl. Skelett) und einfärben
    this.root = new THREE.Group();
    this.model = cloneSkinned(template.scene);
    this.model.position.y = template.footOffset;
    const colors = Object.fromEntries(Object.entries(PALETTE).map(([k, v]) => [k, pick(v, rand)]));
    const own = new Map();
    this.model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      o.frustumCulled = false;   // Skinned Meshes: Bounding-Box passt nicht zur Animation
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const swapped = mats.map((m) => {
        const base = m.name.split('.')[0];   // "Haut.Frau" → "Haut"
        if (!(base in colors)) return m;
        if (!own.has(m)) { const c = m.clone(); c.color.setHex(colors[base]); own.set(m, c); }
        return own.get(m);
      });
      o.material = Array.isArray(o.material) ? swapped : swapped[0];
    });
    this.ownMaterials = [...own.values()];
    const s = 0.9 + rand() * 0.15;
    this.model.scale.setScalar(s);
    this.model.position.y *= s;
    this.root.add(this.model);

    this.root.position.set(home.x, terrain.height(home.x, home.z), home.z);
    this.root.rotation.y = rand() * Math.PI * 2;

    // Animationen
    this.mixer = new THREE.AnimationMixer(this.model);
    this.applyPose = createPoseApplier(this.model);
    this.actions = {
      stehen: this.mixer.clipAction(clips.stehen),
      laufen: this.mixer.clipAction(clips.laufen),
    };
    this.actions.laufen.timeScale = NPC_SPEED / 1.33;  // 1.33 m/s = natürliches Tempo der Geh-Animation (Mocap)
    this.actions.stehen.time = rand() * 2;  // nicht alle atmen im Gleichtakt
    this.current = this.actions.stehen;
    this.current.play();

    this.state = 'idle';
    this.timer = 1 + rand() * 4;
    this.target = null;

    // Namens-/Sprechblase (HTML über der Szene)
    this.label = document.createElement('div');
    this.label.className = 'npc-label';
    this.label.innerHTML = `<b>${this.name}</b><span></span>`;
    this.labelText = this.label.querySelector('span');
    document.getElementById('labels').appendChild(this.label);
  }

  play(name, fade = 0.3) {
    const next = this.actions[name];
    if (next === this.current) return;
    next.reset().play();
    this.current.crossFadeTo(next, fade, false);
    this.current = next;
  }

  pickTarget(blocked) {
    for (let i = 0; i < 8; i++) {
      const a = this.rand() * Math.PI * 2, r = 3 + this.rand() * WANDER_RADIUS;
      const x = this.home.x + Math.cos(a) * r, z = this.home.z + Math.sin(a) * r;
      if (this.terrain.height(x, z) > SEA_LEVEL + 0.3 && !blocked(x, z)) return { x, z };
    }
    return null;
  }

  update(dt, playerPos, blocked) {
    const p = this.root.position;
    const toPlayer = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
    if (toPlayer > ACTIVE_DIST) { this.label.style.display = 'none'; return; }

    if (toPlayer < GREET_DIST) {
      // Stehen bleiben und zum Spieler drehen
      this.state = 'talk';
      this.play('stehen');
      this.turnTo(Math.atan2(playerPos.x - p.x, playerPos.z - p.z), dt, 6);
    } else if (this.state === 'talk') {
      this.state = 'idle'; this.timer = 1 + this.rand() * 2;
    }

    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.target = this.pickTarget(blocked);
        if (this.target) { this.state = 'walk'; this.play('laufen'); } else this.timer = 2;
      }
    } else if (this.state === 'walk') {
      const dx = this.target.x - p.x, dz = this.target.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.5) {
        this.state = 'idle'; this.timer = 2 + this.rand() * 5; this.play('stehen');
      } else {
        this.turnTo(Math.atan2(dx, dz), dt, 5);
        const step = Math.min(NPC_SPEED * dt, dist);
        const fx = Math.sin(this.root.rotation.y), fz = Math.cos(this.root.rotation.y);
        const nx = p.x + fx * step, nz = p.z + fz * step;
        const hNow = this.terrain.height(p.x, p.z), hNew = this.terrain.height(nx, nz);
        const tooSteep = (hNew - hNow) / (step || 1e-6) > 0.9;
        if (blocked(nx, nz) || tooSteep || hNew < SEA_LEVEL + 0.2) {
          this.state = 'idle'; this.timer = 0.5 + this.rand(); this.play('stehen');   // neues Ziel suchen
        } else {
          p.x = nx; p.z = nz;
        }
      }
    }
    p.y = this.terrain.height(p.x, p.z);
    this.mixer.update(dt);
    if (Npc.getPoseSettings) this.applyPose(Npc.getPoseSettings());   // Einstellungen aus dem Bewegungs-Editor
  }

  turnTo(targetYaw, dt, speed) {
    const r = this.root.rotation;
    const d = Math.atan2(Math.sin(targetYaw - r.y), Math.cos(targetYaw - r.y));
    r.y += d * (1 - Math.exp(-speed * dt));
  }

  updateLabel(camera, playerPos, width, height) {
    const p = this.root.position;
    const dist = Math.hypot(playerPos.x - p.x, playerPos.z - p.z);
    if (dist > NAME_DIST) { this.label.style.display = 'none'; return; }
    const v = Npc._v.set(p.x, p.y + 2.05, p.z).project(camera);
    if (v.z > 1) { this.label.style.display = 'none'; return; }   // hinter der Kamera
    this.label.style.display = 'block';
    this.label.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * width}px, ${(-v.y * 0.5 + 0.5) * height}px)`;
    const talking = this.state === 'talk';
    this.labelText.textContent = talking ? this.line : '';
    this.label.classList.toggle('talking', talking);
    this.label.style.opacity = String(Math.min(1, (NAME_DIST - dist) / 4));
  }

  dispose(scene) {
    scene.remove(this.root);
    this.mixer.stopAllAction();
    this.ownMaterials.forEach((m) => m.dispose());
    this.label.remove();
  }
}
Npc._v = new THREE.Vector3();

/**
 * Verwaltet alle NPCs: Startdorf-Bewohner fest, Dorfbewohner pro geladenem Dorf-Chunk.
 * Gleicher Seed → gleiche Bewohner mit gleichen Namen und Farben.
 */
export class NpcManager {
  constructor({ scene, terrain, chunks, figurGltf, footOffset, frauGltf, frauFootOffset, seed, blocked, getPoseSettings }) {
    Object.assign(this, { scene, terrain, chunks, seed, blocked });
    Npc.getPoseSettings = getPoseSettings;
    const tpl = (gltf, foot, female) => {
      const find = (n) => THREE.AnimationClip.findByName(gltf.animations, n);
      return { scene: gltf.scene, footOffset: foot, female, clips: { stehen: find('Stehen'), laufen: find('Laufen') } };
    };
    // Männer und (falls geladen) Frauen – beide mit demselben Skelett und denselben Bewegungen
    this.templates = [tpl(figurGltf, footOffset, false)];
    if (frauGltf) this.templates.push(tpl(frauGltf, frauFootOffset, true));
    this.byChunk = new Map();   // Chunk-Key → NPC-Liste
    this.all = [];
  }

  spawnGroup(key, homes, rngSeed) {
    const rand = mulberry32(rngSeed);
    const list = homes.map((h) => {
      const template = this.templates[Math.floor(rand() * this.templates.length)];
      const npc = new Npc(template, h, rand, this.terrain);
      this.scene.add(npc.root);
      return npc;
    });
    this.byChunk.set(key, list);
    this.all.push(...list);
  }

  /** Startdorf (Blender) – fest am Ursprung. */
  spawnStartVillage() {
    const homes = [{ x: -3, z: 4 }, { x: 3.5, z: 9 }, { x: -2.5, z: 14 }, { x: 1.5, z: -3 }, { x: 0.5, z: 18 }];
    this.spawnGroup('start', homes, hash2(0, 0, this.seed ^ 0x4e5c));
  }

  /** Bewohner für geladene Dorf-Chunks erzeugen, für entladene entfernen. */
  sync() {
    for (const [key, chunk] of this.chunks.chunks) {
      if (this.byChunk.has(key)) continue;
      const v = this.chunks.villageAt(chunk.cx, chunk.cz);
      if (!v) { this.byChunk.set(key, []); continue; }
      const r = mulberry32(hash2(chunk.cx, chunk.cz, this.seed ^ 0x4e5c));
      const n = 2 + Math.floor(r() * 3);
      const homes = Array.from({ length: n }, () => ({ x: v.x + (r() - 0.5) * 8, z: v.z + (r() - 0.5) * 8 }));
      this.spawnGroup(key, homes, hash2(chunk.cx, chunk.cz, this.seed ^ 0x77));
    }
    for (const [key, list] of this.byChunk) {
      if (key === 'start' || this.chunks.chunks.has(key)) continue;
      list.forEach((n) => n.dispose(this.scene));
      this.all = this.all.filter((n) => !list.includes(n));
      this.byChunk.delete(key);
    }
  }

  update(dt, playerPos, camera) {
    this.sync();
    const w = innerWidth, h = innerHeight;
    for (const npc of this.all) {
      npc.update(dt, playerPos, this.blocked);
      npc.updateLabel(camera, playerPos, w, h);
    }
  }

  /** Kollision Spieler ↔ NPC. */
  collides(x, z, radius) {
    for (const n of this.all) {
      const p = n.root.position;
      if ((x - p.x) ** 2 + (z - p.z) ** 2 < (radius + NPC_RADIUS) ** 2) return true;
    }
    return false;
  }
}
