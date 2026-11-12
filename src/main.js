import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createTerrain, SEA_LEVEL } from './world/terrain.js';
import { createProps } from './world/props.js';
import { ChunkManager } from './world/chunks.js';
import { NpcManager } from './npc.js';
import { createSkeletonView } from './skeletonView.js';
import { prepareFigure } from './figure.js';
import { loadData, normalizeData, blendSettings, createPoseApplier, settingsChannel } from './poseSettings.js';
import { createSituations } from './situations.js';
import { VehicleManager } from './vehicles.js';
import { AnimalManager } from './animals.js';
import { DecorManager } from './world/decor.js';
import { ItemManager, addPoseOffsets } from './items.js';
import { Combat } from './combat.js';
import { Crafting } from './crafting.js';
import { Business } from './business.js';

// ---------- Einstellungen ----------
const WALK_SPEED = 1.7;      // Gehen mit W (m/s)
const SPRINT_SPEED = 5.2;    // Sprinten mit Shift + W (m/s)
const ACCEL = 8;             // wie schnell das Tempo wechselt
// Tempo, bei dem die Blender-Animationen ohne Fussrutschen laufen (in Blender gemessen)
// Motion Capture (CMU): Gehen 35_01, Rennen 35_22, Sprung 13_39 – auf unser Skelett übertragen
const ANIM_WALK_SPEED = 1.33, ANIM_RUN_SPEED = 3.68;
// Sprung-Clip: Absprung bei 0.12 s, Landung bei 0.57 s → 0.45 s Flug in der Aufnahme
const JUMP_TAKEOFF = 0.12, JUMP_CLIP_AIR = 0.45;
const FOV_WALK = 55, FOV_SPRINT = 63;
const WATER_SPEED = 0.45;    // Faktor im seichten Wasser
const JUMP_SPEED = 6.5;      // Startgeschwindigkeit beim Sprung
const GRAVITY = 18;          // Erdanziehung
const PLAYER_RADIUS = 0.3;
const MAX_SLOPE = 1.1;       // max. Steigung (Höhe pro Meter) – steiler = Wand
const MOUSE_SENS = 0.0025;   // Maus-Empfindlichkeit (Radiant pro Pixel)
const CAM_DISTANCE = 5.5;    // Abstand der Kamera hinter der Figur
const PITCH_MIN = -0.15, PITCH_MAX = 1.1;
const VIEW_RADIUS = 4;       // Sichtweite in Chunks (à 64 m)

// Seed aus der Adresse: ?seed=42 (Zahl oder beliebiger Text)
const seedParam = new URLSearchParams(location.search).get('seed') ?? '1337';
const SEED = /^\d+$/.test(seedParam) ? Number(seedParam)
  : [...seedParam].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;

// ---------- Renderer & Szene ----------
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);

const SKY = 0xa9cdea;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 90, 245);

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 600);

const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a6b35, 1.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.03;
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 160 });
scene.add(sun, sun.target);

// ---------- Welt ----------
const terrain = createTerrain(SEED);
const props = createProps(SEED);
const chunks = new ChunkManager({ scene, terrain, props, seed: SEED, radius: VIEW_RADIUS });

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x3f8fc2, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }),
);
water.position.y = SEA_LEVEL;
water.receiveShadow = true;
scene.add(water);

// Tageszeit & Wetter (N = Wetter wechseln, T = +2 Stunden)
const situations = createSituations({ scene, sun, hemi, water });

// ---------- Modelle laden (aus Blender exportiert) ----------
const loadingEl = document.getElementById('backend');
const infoEl = document.getElementById('info');
loadingEl.textContent = 'Lade Figur und Dorf …';
const loader = new GLTFLoader();
const [figurGltf, dorfGltf, frauGltf] = await Promise.all([
  loader.loadAsync('models/figur.glb'),
  loader.loadAsync('models/dorf.glb'),
  loader.loadAsync('models/frau.glb'),    // weibliche Figur (MPFB) für NPCs
]);
prepareFigure(frauGltf.scene);
const frauFootOffset = -new THREE.Box3().setFromObject(frauGltf.scene).min.y;

function enableShadows(root, cast = true) {
  root.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = true; } });
}

// Start-Dorf aus Blender – steht in der flachen Mitte der Welt (Höhe 0)
const dorf = dorfGltf.scene;
enableShadows(dorf);
const wiese = dorf.getObjectByName('Wiese');
if (wiese) wiese.visible = false;   // das Gelände übernimmt den Boden
dorf.getObjectByName('Weg')?.traverse((o) => { if (o.isMesh) o.castShadow = false; });
scene.add(dorf);

// Spieler
const player = new THREE.Group();
const figur = prepareFigure(figurGltf.scene);

// Bewegungs-Einstellungen aus dem Editor (editor.html): gespeichert in public/figur-settings.json,
// Änderungen im offenen Editor kommen live über den BroadcastChannel an.
// Pro Bewegung ein eigenes Profil (Gehen & Stehen, Sprinten, Springen); poseSettings = aktuell
// angewendete Werte, die weich zum Profil der laufenden Animation hinüberblenden.
let poseData = await loadData();
settingsChannel?.addEventListener('message', (e) => { if (e.data?.data) poseData = normalizeData(e.data.data); });
let poseSettings = structuredClone(poseData.profiles.gehen);
const applyPose = createPoseApplier(figur);
const figBox = new THREE.Box3().setFromObject(figur);
figur.position.y = -figBox.min.y;
player.add(figur);
scene.add(player);

// Skelett-Ansicht: Taste K zeigt die Gelenkpunkte (Hand, Ellbogen, Schulter, Hüfte, Wirbelsäule, Hals, Knie, Fussgelenk)
const skeletonView = createSkeletonView(scene, figur);
addEventListener('keydown', (e) => { if (e.code === 'KeyK' && !e.repeat) skeletonView.toggle(); });

// ---------- Animationen aus Blender ----------
const mixer = new THREE.AnimationMixer(figur);
const clip = (name) => {
  const c = THREE.AnimationClip.findByName(figurGltf.animations, name);
  if (!c) throw new Error(`Animation "${name}" fehlt in figur.glb`);
  return mixer.clipAction(c);
};
const anim = { stehen: clip('Stehen'), laufen: clip('Laufen'), rennen: clip('Rennen'), springen: clip('Springen') };
anim.laufen.timeScale = WALK_SPEED / ANIM_WALK_SPEED;
anim.rennen.timeScale = SPRINT_SPEED / ANIM_RUN_SPEED;
anim.springen.setLoop(THREE.LoopOnce, 1);
anim.springen.clampWhenFinished = true;
let currentAnim = anim.stehen;
currentAnim.play();

function playAnim(next, fade = 0.2) {
  if (next === currentAnim) return;
  next.reset().setEffectiveWeight(1).play();
  currentAnim.crossFadeTo(next, fade, false);
  currentAnim = next;
}

// ---------- Hindernisse ----------
// Format: { type: 'circle', x, z, r, top } oder { type: 'obb', x, z, cos, sin, hw, hd, top }
dorf.updateMatrixWorld(true);
const dorfObstacles = [];
const tmpBox = new THREE.Box3();
const seen = new Set();
dorf.traverse((o) => {
  if (!o.name || !(o.isMesh || o.children.length)) return;
  // three.js entfernt Punkte aus Namen: "Stamm.001" → "Stamm001"
  const base = o.name.replace(/[._]?\d+$/, '');
  if (!base.endsWith('_Haus') && base !== 'Latte' && base !== 'Stamm') return;
  tmpBox.setFromObject(o);
  const key = tmpBox.min.toArray().concat(tmpBox.max.toArray()).map((v) => v.toFixed(2)).join();
  if (seen.has(key)) return;
  seen.add(key);
  const c = tmpBox.getCenter(new THREE.Vector3());
  const sx = (tmpBox.max.x - tmpBox.min.x) / 2, sz = (tmpBox.max.z - tmpBox.min.z) / 2;
  if (base === 'Stamm') dorfObstacles.push({ type: 'circle', x: c.x, z: c.z, r: Math.max(sx, sz), top: Infinity });
  else dorfObstacles.push({ type: 'obb', x: c.x, z: c.z, cos: 1, sin: 0, hw: sx, hd: sz, top: base === 'Latte' ? 0.68 : Infinity });
});

// ---------- Zerstörbares im Startdorf (Blender-Modell): Bäume, Büsche, Steine, Blumen, Zaun ----------
const dorfTargets = [];
{
  const KINDS = ['Stamm', 'Krone', 'Busch', 'Stein', 'Latte', 'Pfosten', 'Blume'];
  const baseOf = (n) => (n || '').replace(/[._]?\d+$/, '');
  const found = {};
  dorf.traverse((o) => {
    const b = baseOf(o.name);
    if (!KINDS.includes(b) || baseOf(o.parent?.name) === b) return;   // nur oberstes Objekt je Teil
    const box = new THREE.Box3().setFromObject(o);
    (found[b] ??= []).push({ o, c: box.getCenter(new THREE.Vector3()), box });
  });
  const removeObstacle = (ob) => { const i = dorfObstacles.indexOf(ob); if (i >= 0) dorfObstacles.splice(i, 1); };
  const nearestObstacle = (x, z, pred) => {
    let best = null, bd = Infinity;
    for (const ob of dorfObstacles) { if (!pred(ob)) continue; const d = Math.hypot(ob.x - x, ob.z - z); if (d < bd) { bd = d; best = ob; } }
    return bd < 1.5 ? best : null;
  };
  const add = (name, material, hp, objs, c, r, height, obstacles, drops) => {
    dorfTargets.push({ name, material, hp, maxHp: hp, x: c.x, z: c.z, y: 0, r, height, shakeObj: objs[0].o,
      destroy() {
        this.dead = true;
        for (const { o } of objs) o.visible = false;
        for (const ob of obstacles) if (ob) removeObstacle(ob);
        return drops;
      } });
  };
  // Bäume: Stamm + Kronen darüber
  for (const s of found.Stamm ?? []) {
    const crowns = (found.Krone ?? []).filter((k) => Math.hypot(k.c.x - s.c.x, k.c.z - s.c.z) < 1.8);
    const top = Math.max(s.box.max.y, ...crowns.map((k) => k.box.max.y));
    add('Baum', 'holz', 90, [s, ...crowns], s.c, 0.35, top,
      [nearestObstacle(s.c.x, s.c.z, (ob) => ob.type === 'circle')], [['holz', 4]]);
  }
  for (const b of found.Busch ?? []) add('Busch', 'pflanze', 25, [b], b.c, 0.5, b.box.max.y, [], []);
  for (const s of found.Stein ?? []) add('Stein', 'stein', 30, [s], s.c, 0.3, s.box.max.y, [], [['stein', 1]]);
  for (const f of found.Blume ?? []) add('Blume', 'pflanze', 4, [f], f.c, 0.15, 0.3, [], []);
  // Zaun: pro Seite (x < 0 / x > 0) ein Ziel aus Latten und Pfosten; Trefferpunkt = nächste Stelle am Zaun
  for (const side of [-1, 1]) {
    const parts = [...(found.Latte ?? []), ...(found.Pfosten ?? [])].filter((p) => Math.sign(p.c.x) === side);
    if (!parts.length) continue;
    const zs = parts.map((p) => p.c.z), z0 = Math.min(...zs) - 0.5, z1 = Math.max(...zs) + 0.5, fx = parts[0].c.x;
    const obs = dorfObstacles.filter((ob) => ob.top === 0.68 && Math.sign(ob.x) === side);
    const t = { name: 'Zaun', material: 'holz', hp: 60, maxHp: 60, x: fx, z: (z0 + z1) / 2, y: 0, r: 0.15, height: 0.8, shakeObj: null,
      get zNear() { return THREE.MathUtils.clamp(player.position.z, z0, z1); },
      destroy() { this.dead = true; for (const { o } of parts) o.visible = false; for (const ob of obs) removeObstacle(ob); return [['planken', 3]]; } };
    Object.defineProperty(t, 'z', { get: () => THREE.MathUtils.clamp(player.position.z, z0, z1) });
    dorfTargets.push(t);
  }
}

function hits(o, x, z, feetY, r = PLAYER_RADIUS) {
  if (feetY >= o.top) return false;                  // drübergesprungen
  const dx = x - o.x, dz = z - o.z;
  if (o.type === 'circle') return dx * dx + dz * dz < (o.r + r) ** 2;
  const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
  return Math.abs(lx) < o.hw + r && Math.abs(lz) < o.hd + r;
}

const extraObstacleSources = [];   // weitere Module (z. B. Deko) hängen hier ihre obstaclesNear(x,z) an

/** Häuser, Bäume, Zäune, Felsen, Deko (für Spieler, NPCs und Fahrzeuge). */
function worldCollides(x, z, feetY, r = PLAYER_RADIUS) {
  if (Math.hypot(x, z) < 60) for (const o of dorfObstacles) if (hits(o, x, z, feetY, r)) return true;
  for (const o of chunks.obstaclesNear(x, z)) if (hits(o, x, z, feetY, r)) return true;
  for (const src of extraObstacleSources) for (const o of src(x, z)) if (hits(o, x, z, feetY, r)) return true;
  return false;
}

// ---------- Fahrzeuge (E = ein-/aussteigen) ----------
// ---------- Gegenstände in Dörfern und Wildnis (Kenney, CC0) ----------
const decor = new DecorManager({ scene, terrain, chunks, seed: SEED, loader });
extraObstacleSources.push((x, z) => decor.obstaclesNear(x, z));

// ---------- Tiere (Quaternius, CC0) ----------
const animals = new AnimalManager({ scene, terrain, chunks, seed: SEED, loader,
  blocked: (x, z) => worldCollides(x, z, terrain.height(x, z)) });
const vehicles = new VehicleManager({ scene, terrain, chunks, seed: SEED, loader, worldCollides, animals });
// ---------- Gegenstände: Waffen, Essen, Werkzeuge, Schätze (F aufheben, 1–9/Q Fach, R benutzen, G ablegen) ----------
const items = new ItemManager({ scene, terrain, chunks, seed: SEED, loader, figureRoot: figur,
  canAct: () => !vehicles.active, worldCollides });
items.setDecor(decor);
extraObstacleSources.push((x, z) => items.obstaclesNear(x, z));
const itemPose = { values: {} };

// ---------- Zerstören (R = schlagen): Werkzeug × Material bestimmt den Schaden ----------
const combat = new Combat({ scene, camera, items, player, getYaw: () => yaw });
combat.addSource((x, z) => chunks.targetsNear(x, z));      // Bäume, Büsche, Felsen
combat.addSource((x, z) => decor.targetsNear(x, z));       // Kisten, Fässer, Karren, Stände …
combat.addSource((x, z) => items.targetsNear(x, z));       // Waffenständer, Obstkisten, Truhen
combat.addSource((x, z) => animals.targetsNear(x, z));     // Tiere
combat.addSource((x, z) => npcs.targetsNear(x, z));        // andere Figuren (werden k.o. geschlagen)
const crafting = new Crafting({
  items, player,
  onOpen: () => document.exitPointerLock?.(),
  stations: (x, z, d) => {
    const st = [], near = (t) => Math.hypot(t.x - x, t.z - z) < d;
    if (decor.campfires.some(near)) st.push('feuer');
    for (const t of [...decor.targetsNear(x, z), ...items.targetsNear(x, z)]) {
      if (t.dead || !near(t)) continue;
      if (t.name === 'Amboss') st.push('amboss');
      if (t.name === 'Werkbank') st.push('werkbank');
    }
    return st;
  },
});
combat.addSource((x, z) => dorfTargets.filter((t) => !t.dead && Math.hypot(t.x - x, t.z - z) < 7));   // Startdorf

// Reithaltung: wird beim Reiten zu den Editor-Einstellungen addiert
const RIDE_POSE = { legForward: 70, legSpread: 22, kneeBend: 75, armForward: 20, elbowBend: 40, lean: 8 };
function withRidePose(s) {
  const out = structuredClone(s);
  for (const [k, v] of Object.entries(RIDE_POSE)) {
    const cur = out.values[k];
    out.values[k] = typeof cur === 'object' ? { l: cur.l + v, r: cur.r + v } : (cur || 0) + v;
  }
  return out;
}

// ---------- NPCs ----------
const npcs = new NpcManager({
  scene, terrain, chunks, figurGltf, seed: SEED,
  getPoseSettings: () => poseData.profiles.gehen,   // NPCs gehen und stehen nur
  footOffset: -figBox.min.y,
  frauGltf, frauFootOffset,
  // NPCs meiden Hindernisse und laufen nicht in den Spieler hinein
  blocked: (x, z) => worldCollides(x, z, terrain.height(x, z)) ||
    Math.hypot(x - player.position.x, z - player.position.z) < 0.9,
});

/** Darf man von (x,z) nach (nx,nz) gehen? Hindernisse, NPCs, steile Hänge, tiefes Wasser. */
function canMove(x, z, nx, nz, feetY, grounded) {
  if (worldCollides(nx, nz, feetY) || npcs.collides(nx, nz, PLAYER_RADIUS) || vehicles.collides(nx, nz, PLAYER_RADIUS) || animals.collides(nx, nz, PLAYER_RADIUS)) return false;
  const hNew = terrain.height(nx, nz);
  if (hNew < SEA_LEVEL - 0.7) return false;                       // zu tief zum Waten
  if (grounded) {
    const rise = hNew - terrain.height(x, z);
    const dist = Math.hypot(nx - x, nz - z) || 1e-6;
    if (rise / dist > MAX_SLOPE) return false;                    // zu steil
  }
  return true;
}

// ---------- Eingabe: W = vorwärts, Leertaste = springen, Maus = Richtung ----------
const keys = new Set();
let jumpBuffer = 0;   // Sekunden, die ein Sprung-Tastendruck noch gilt
let coyote = 0;       // Gnadenzeit: kurz nach Verlassen des Bodens darf man noch springen
const GAME_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'];
addEventListener('keydown', (e) => {
  if (e.code === 'KeyE' && !e.repeat) { toggleVehicle(); return; }
  if (e.code === 'KeyN' && !e.repeat) { situations.cycleWeather(); return; }
  if (e.code === 'KeyT' && !e.repeat) { situations.setTimeOfDay((situations.timeOfDay + 2) % 24); return; }
  if (!GAME_KEYS.includes(e.code)) return;
  e.preventDefault();
  if (e.code === 'Space' && !e.repeat && !vehicles.active) jumpBuffer = 0.15;   // Sprungwunsch bleibt kurz gespeichert
  keys.add(e.code);
});

let camOrbit = 0;   // Maus-Umschauen beim Fahren (relativ zur Fahrtrichtung)
function toggleVehicle() {
  const p = player.position;
  if (vehicles.active) {
    const heading = vehicles.active.vehicle ? vehicles.active.vehicle.heading : vehicles.active.heading;
    const out = vehicles.exit();
    if (!out) return;                               // kein Platz zum Aussteigen (z. B. mitten im See)
    p.set(out.x, terrain.height(out.x, out.z), out.z);
    figur.visible = true;
    yaw = heading + camOrbit; camOrbit = 0;
    velocityY = 0; onGround = true; speed = 0;
  } else if (vehicles.tryEnter(p)) {
    camOrbit = 0;
    playAnim(anim.stehen, 0.2);
  }
}
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

let yaw = Math.PI;   // Blickrichtung: π = ins Dorf hinein (−Z)
let pitch = 0.35;
const canvas = renderer.domElement;
const hint = document.getElementById('hint');
canvas.addEventListener('click', () => canvas.requestPointerLock?.());
document.addEventListener('pointerlockchange', () => {
  hint.textContent = document.pointerLockElement === canvas
    ? 'W gehen · Shift sprinten · Leertaste springen · E einsteigen · F aufheben · 1–9/Q Fach · R benutzen · G ablegen · C herstellen · H handeln · N Wetter · T Uhrzeit · K Skelett · Esc'
    : 'Ins Bild klicken, um mit der Maus zu steuern';
});
let dragging = false;
canvas.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas && !dragging) return;
  if (vehicles.active) camOrbit -= e.movementX * MOUSE_SENS;
  else yaw -= e.movementX * MOUSE_SENS;
  pitch = THREE.MathUtils.clamp(pitch + e.movementY * MOUSE_SENS, PITCH_MIN, PITCH_MAX);
});

// ---------- Spiellogik ----------
let velocityY = 0;
let onGround = true;
let speed = 0;          // aktuelles Bodentempo (m/s)
let debugCam = null;    // Test-Kamera (relativ zur Figur), sonst null
let sprinting = false;
const camTarget = new THREE.Vector3();
const lookAt = new THREE.Vector3();

let drive = null;   // Fahrdaten, solange man in einem Fahrzeug sitzt

function updateDriving(dt, now) {
  const p = player.position;
  const k = (c) => (keys.has(c) ? 1 : 0);
  drive = vehicles.drive(dt, {
    throttle: k('KeyW') - k('KeyS'), steer: k('KeyA') - k('KeyD'),
    brake: keys.has('Space'), boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
  }, now / 1000);
  p.set(drive.x, drive.riding ? drive.y - 0.95 : drive.y, drive.z);
  player.rotation.y = drive.heading;
  figur.visible = !drive.hidePlayer;
  if (Math.abs(drive.speed) > 1.5) camOrbit *= Math.exp(-1.5 * dt);   // Kamera dreht langsam hinter das Fahrzeug zurück
  playAnim(anim.stehen, 0.3);
  mixer.update(dt);
  blendSettings(poseSettings, poseData.profiles.gehen, 1 - Math.exp(-12 * dt));
  applyPose(drive.riding ? withRidePose(poseSettings) : poseSettings);
  skeletonView.update();
  // Kamera hinter dem Fahrzeug
  const camYaw = drive.heading + camOrbit, d = drive.cfg.camDist;
  const horiz = d * Math.cos(pitch * 0.6);
  camTarget.set(p.x - Math.sin(camYaw) * horiz, drive.y + drive.cfg.camHeight + d * Math.sin(pitch * 0.6), p.z - Math.cos(camYaw) * horiz);
  camTarget.y = Math.max(camTarget.y, terrain.height(camTarget.x, camTarget.z) + 0.8, SEA_LEVEL + 0.6);
  camera.position.lerp(camTarget, 1 - Math.exp(-8 * dt));
  lookAt.set(drive.x, drive.y + 1.2, drive.z);
  camera.lookAt(lookAt);
  const fov = THREE.MathUtils.lerp(camera.fov, FOV_WALK + Math.min(Math.abs(drive.speed) * 0.4, 12), 1 - Math.exp(-3 * dt));
  camera.fov = fov; camera.updateProjectionMatrix();
}

function update(dt, now) {
  const p = player.position;
  if (vehicles.active) { updateDriving(dt, now); updateWorld(dt, p, now); return; }
  drive = null;
  player.rotation.y = yaw;
  const dirX = Math.sin(yaw), dirZ = Math.cos(yaw);

  const moving = keys.has('KeyW');
  const inWater = p.y < SEA_LEVEL - 0.25;
  sprinting = moving && !inWater && (keys.has('ShiftLeft') || keys.has('ShiftRight'));
  const targetSpeed = moving ? (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inWater ? WATER_SPEED : 1) : 0;
  speed += (targetSpeed - speed) * (1 - Math.exp(-ACCEL * dt));   // weich beschleunigen/bremsen
  if (speed > 0.05) {
    const step = speed * dt;
    const nx = p.x + dirX * step, nz = p.z + dirZ * step;
    // getrennt prüfen → an Wänden/Hängen entlanggleiten statt hängenbleiben
    if (canMove(p.x, p.z, nx, p.z, p.y, onGround)) p.x = nx;
    if (canMove(p.x, p.z, p.x, nz, p.y, onGround)) p.z = nz;
  }

  // Springen & Schwerkraft auf dem Gelände
  coyote = onGround ? 0.12 : coyote - dt;
  jumpBuffer -= dt;
  if (jumpBuffer > 0 && coyote > 0) {
    velocityY = JUMP_SPEED;
    onGround = false;
    jumpBuffer = 0; coyote = 0;
    playAnim(anim.springen, 0.08);
    // Clip beim Absprung starten und so abspielen, dass die Landung im Clip mit der Landung im Spiel zusammenfällt
    anim.springen.time = JUMP_TAKEOFF;
    anim.springen.timeScale = JUMP_CLIP_AIR / ((2 * JUMP_SPEED) / GRAVITY);
  }
  velocityY -= GRAVITY * dt;
  p.y += velocityY * dt;
  const ground = terrain.height(p.x, p.z);
  if (p.y <= ground) {
    p.y = ground; velocityY = 0; onGround = true;
  } else if (onGround && velocityY <= 0 && p.y - ground < 0.4 + speed * dt * 1.6) {
    p.y = ground; velocityY = 0;                // bergab am Boden bleiben
  } else {
    onGround = false;                           // fällt (Klippe) oder springt
  }

  if (onGround && currentAnim === anim.springen) anim.springen.timeScale = 1;   // Landung in Echtzeit abfedern
  if (onGround) {
    const jumpRunning = currentAnim === anim.springen && anim.springen.time < anim.springen.getClip().duration * 0.75;
    const next = !moving ? anim.stehen : sprinting ? anim.rennen : anim.laufen;
    if (!jumpRunning || moving) playAnim(next, currentAnim === anim.springen ? 0.15 : 0.3);
  }
  // Abspieltempo folgt dem tatsächlichen Tempo → keine rutschenden Füsse beim Beschleunigen
  if (currentAnim === anim.laufen) anim.laufen.timeScale = Math.max(speed, 0.6) / ANIM_WALK_SPEED;
  if (currentAnim === anim.rennen) anim.rennen.timeScale = Math.max(speed, 2.5) / ANIM_RUN_SPEED;
  // Sprint-Gefühl: Blickfeld weitet sich leicht
  const fov = THREE.MathUtils.lerp(camera.fov, sprinting ? FOV_SPRINT : FOV_WALK, 1 - Math.exp(-4 * dt));
  if (Math.abs(fov - camera.fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  mixer.update(dt);
  // Profil passend zur laufenden Bewegung, weich überblendet (≈ 0.2 s)
  const profile = currentAnim === anim.rennen ? 'sprint' : currentAnim === anim.springen ? 'springen' : 'gehen';
  blendSettings(poseSettings, poseData.profiles[profile], 1 - Math.exp(-12 * dt));
  applyPose(addPoseOffsets(poseSettings, items.getPoseOffsets(), itemPose));   // + Halten/Schwingen von Gegenständen
  skeletonView.update();

  // Kamera hinter der Figur, nie unter dem Gelände
  const horiz = CAM_DISTANCE * Math.cos(pitch);
  camTarget.set(p.x - dirX * horiz, p.y + 1.5 + CAM_DISTANCE * Math.sin(pitch), p.z - dirZ * horiz);
  camTarget.y = Math.max(camTarget.y, terrain.height(camTarget.x, camTarget.z) + 0.6, SEA_LEVEL + 0.4);
  camera.position.lerp(camTarget, 1 - Math.exp(-12 * dt));
  lookAt.set(p.x, p.y + 1.4, p.z);
  if (debugCam) {   // nur für Tests: Kamera seitlich neben die Figur
    camera.position.set(p.x + debugCam.x, p.y + debugCam.y, p.z + debugCam.z);
    lookAt.y = p.y + 0.95;
  }
  camera.lookAt(lookAt);
  updateWorld(dt, p, now);
}

/** Alles, was unabhängig davon läuft, ob man geht oder fährt. */
function updateWorld(dt, p, now) {
  // Tageszeit/Wetter; Sonne, Schatten und Wasser wandern mit
  situations.update(dt, p, camera);
  sun.position.copy(p).add(situations.sunOffset);
  sun.target.position.copy(p);
  water.position.x = Math.round(p.x / 50) * 50;
  water.position.z = Math.round(p.z / 50) * 50;

  chunks.update(p.x, p.z);
  camera.updateMatrixWorld();
  npcs.update(dt, p, camera);
  vehicles.update(dt, p, now / 1000);
  animals.update(dt, p);
  decor.update(dt, p, situations.night);
  items.update(dt, p, yaw);
  combat.update(dt);
  crafting.update();
  business.update(dt, camera);
  for (const u of worldUpdaters) u(dt, p, situations.night);
  const prompt = vehicles.prompt || items.prompt;
  if (prompt !== lastPrompt) { lastPrompt = prompt; promptEl.textContent = prompt; promptEl.style.display = prompt ? 'block' : 'none'; }
}
const worldUpdaters = [];   // weitere Module (Tiere, Deko) hängen hier ihr update an
const statsSources = [];    // weitere Module liefern Text für die Info-Zeile
let lastPrompt = null;
const promptEl = document.getElementById('prompt');

// ---------- Start ----------
camera.position.set(0, 4, 6);
loadingEl.textContent = 'Erzeuge Welt …';
await new Promise((r) => setTimeout(r));
const t0 = performance.now();
chunks.buildPerFrame = 999;
chunks.radius = 2;
chunks.update(0, 0);                 // nahe Chunks sofort, Rest streamt danach
chunks.radius = VIEW_RADIUS;
chunks.buildPerFrame = 2;
npcs.spawnStartVillage();
loadingEl.textContent = 'Lade Fahrzeuge, Tiere und Gegenstände …';
// ---------- Handel & Business (H): Händler an Marktständen, eigener Verkaufsstand ----------
const business = new Business({
  scene, items, player, terrain, loader, npcs, getYaw: () => yaw,
  shopsNear: (x, z, d) => [...decor.targetsNear(x, z)].some((t) => !t.dead && t.name === 'Marktstand' && Math.hypot(t.x - x, t.z - z) < d),
});
extraObstacleSources.push((x, z) => business.obstacles(x, z));
await Promise.all([vehicles.init(), animals.init(), decor.init(), items.init()]);
await business.init();
statsSources.push(() => ` · ${items.count} Gegenstände`);
statsSources.push(() => ` · ${animals.count} Tiere`);
const startMs = performance.now() - t0;

await renderer.init();
const isWebGPU = renderer.backend.isWebGPUBackend === true;
loadingEl.textContent = isWebGPU ? 'Renderer: WebGPU ✓' : 'Renderer: WebGL2 (Fallback – Browser ohne WebGPU)';
loadingEl.classList.toggle('warn', !isWebGPU);
console.info(`[Spiel] three.js r${THREE.REVISION}, Backend: ${isWebGPU ? 'WebGPU' : 'WebGL2'}, Seed ${SEED}, ` +
  `Startchunks in ${startMs.toFixed(0)} ms`);

let last = performance.now();
let fpsFrames = 0, fpsTime = 0, fps = 0;
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  update(dt, now);
  fpsFrames++; fpsTime += dt;
  if (fpsTime > 0.5) {
    fps = Math.round(fpsFrames / fpsTime); fpsFrames = 0; fpsTime = 0;
    const p = player.position;
    const kmh = drive ? ` · ${vehicles.active?.label ?? ''} ${Math.round(Math.abs(drive.speed) * 3.6)} km/h` : '';
    infoEl.textContent = `${situations.label}${kmh} · Seed ${seedParam} · x ${p.x.toFixed(0)} z ${p.z.toFixed(0)} · ` +
      `${npcs.all.length} NPCs${statsExtra()} · ${fps} FPS`;
  }
  if (innerWidth === 0 || innerHeight === 0) return;
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  if (innerWidth === 0 || innerHeight === 0) return;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

function statsExtra() { return statsSources.map((f) => f()).join(''); }

// Für Tests im Browser
window.__game = { crafting, business,
  player, terrain, chunks, npcs, isWebGPU, anim, camera, SEED, skeletonView, situations, vehicles, animals, decor, items, combat, dorfTargets,
  get drive() { return drive; },
  get poseSettings() { return poseSettings; },
  get yaw() { return yaw; }, set yaw(v) { yaw = v; },
  get pitch() { return pitch; }, set pitch(v) { pitch = v; },
  set debugCam(v) { debugCam = v; },
  get onGround() { return onGround; },
  get speed() { return speed; },
  get sprinting() { return sprinting; },
  get fps() { return fps; },
  get animation() { return Object.keys(anim).find((k) => anim[k] === currentAnim); },
};
