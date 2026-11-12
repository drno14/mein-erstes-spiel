import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CONTROLS, PROFILES, loadData, normalizeSettings, emptySettings, createPoseApplier, settingsChannel } from './poseSettings.js';
import { prepareFigure } from './figure.js';
import { createSkeletonView } from './skeletonView.js';

const $ = (id) => document.getElementById(id);
const view = $('view');

// ---------- 3D-Ansicht ----------
const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xb9cde0);
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.4;
controls.maxDistance = 12;

scene.add(new THREE.HemisphereLight(0xeaf3ff, 0x6b7a5a, 1.5));
const sun = new THREE.DirectionalLight(0xfff3e0, 2.4);
sun.position.set(-3, 6, 4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
scene.add(sun);
const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 64).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0x9fb48a, roughness: 0.95 }));
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(8, 16, 0x5d6f4c, 0x7d9068);
grid.position.y = 0.002;
scene.add(grid);

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);

// Kamera-Positionen (Figur schaut nach +Z)
const CAMS = {
  front: [[0, 1.15, 4.2], [0, 0.95, 0]], back: [[0, 1.15, -4.2], [0, 0.95, 0]],
  side: [[4.2, 1.1, 0], [0, 0.95, 0]], three: [[2.8, 1.5, 3.2], [0, 0.95, 0]],
  hands: [[1.1, 1.0, 1.3], [0.15, 0.95, 0]], feet: [[1.0, 0.45, 1.4], [0, 0.12, 0]],
};
let camTween = null;
function setCam(key) {
  const [p, t] = CAMS[key];
  camTween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: new THREE.Vector3(...p), t1: new THREE.Vector3(...t), k: 0 };
  document.querySelectorAll('#cams [data-cam]').forEach((b) => b.classList.toggle('active', b.dataset.cam === key));
}
camera.position.set(...CAMS.three[0]);
controls.target.set(...CAMS.three[1]);

// ---------- Figur ----------
const gltf = await new GLTFLoader().loadAsync('models/figur.glb');
const figur = prepareFigure(gltf.scene);
const box = new THREE.Box3().setFromObject(figur);
figur.position.y = -box.min.y;
scene.add(figur);
const applyPose = createPoseApplier(figur);
const skeleton = createSkeletonView(scene, figur);

const mixer = new THREE.AnimationMixer(figur);
const ANIMS = [['Stehen', 'Stehen'], ['Laufen', 'Gehen'], ['Rennen', 'Rennen'], ['Springen', 'Springen']];
const actions = {};
for (const [clipName, label] of ANIMS) {
  const clip = THREE.AnimationClip.findByName(gltf.animations, clipName);
  if (!clip) continue;
  actions[clipName] = mixer.clipAction(clip);
  const b = document.createElement('button');
  b.textContent = label;
  b.dataset.anim = clipName;
  b.onclick = () => playClip(clipName);
  $('anims').append(b);
}
let current = null;
let playing = true;
function playClip(name) {
  if (current) current.stop();
  current = actions[name];
  current.reset().play();
  $('time').max = current.getClip().duration;
  document.querySelectorAll('#anims button').forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}
playClip('Laufen');

$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '⏸' : '▶'; };
addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); $('play').click(); }
});
$('speed').oninput = () => { $('speedVal').textContent = `${(+$('speed').value).toFixed(1)}×`; };
$('time').oninput = () => {
  playing = false; $('play').textContent = '▶';
  current.time = +$('time').value;
  mixer.update(0);
};
document.querySelectorAll('#cams [data-cam]').forEach((b) => { b.onclick = () => setCam(b.dataset.cam); });
$('skel').onclick = () => $('skel').classList.toggle('on', skeleton.toggle());

// ---------- Einstellungen (ein Profil pro Bewegung) ----------
let saved = await loadData();
let data = structuredClone(saved);
let profileId = 'gehen';
let settings = data.profiles[profileId];
const rows = {};   // id → { sliders, vals }

for (const p of PROFILES) {
  const b = document.createElement('button');
  b.textContent = p.label;
  b.dataset.profile = p.id;
  b.onclick = () => setProfile(p.id);
  $('profiles').append(b);
}
function setProfile(id) {
  profileId = id;
  settings = data.profiles[id];
  $('sym').checked = settings.symmetric;
  document.querySelectorAll('#profiles button').forEach((b) => b.classList.toggle('active', b.dataset.profile === id));
  playClip(PROFILES.find((p) => p.id === id).clip);   // passende Bewegung zeigen
  buildControls();
  changed();
}

function sideKeys(c) { return c.side ? (settings.symmetric ? ['both'] : ['l', 'r']) : ['center']; }
function getVal(c, k) {
  const v = settings.values[c.id];
  if (k === 'center') return v;
  if (k === 'both') return v.l;
  return v[k];
}
function setVal(c, k, x) {
  if (k === 'center') settings.values[c.id] = x;
  else if (k === 'both') settings.values[c.id] = { l: x, r: x };
  else settings.values[c.id][k] = x;
}

function buildControls() {
  const box = $('controls');
  box.innerHTML = '';
  let group = null;
  for (const c of CONTROLS) {
    if (c.group !== group) {
      group = c.group;
      const h = document.createElement('h2');
      h.textContent = group;
      box.append(h);
    }
    const el = document.createElement('div');
    el.className = 'ctl';
    el.innerHTML = `<div class="top"><span class="name">${c.label}</span><span class="hint">${c.hint}</span></div>`;
    rows[c.id] = {};
    for (const k of sideKeys(c)) {
      const row = document.createElement('div');
      row.className = 'row';
      const tag = { l: 'L', r: 'R', both: 'L+R', center: '' }[k];
      row.innerHTML = `<span class="sd">${tag}</span>
        <input type="range" min="${c.min}" max="${c.max}" step="1">
        <span class="val"></span><button class="zero" title="Auf 0">↺</button>`;
      const slider = row.querySelector('input');
      const val = row.querySelector('.val');
      slider.value = getVal(c, k);
      const show = () => { const x = +slider.value; val.textContent = `${x}°`; val.classList.toggle('nonzero', x !== 0); };
      show();
      slider.oninput = () => { setVal(c, k, +slider.value); show(); changed(); };
      slider.ondblclick = () => { slider.value = 0; slider.oninput(); };
      row.querySelector('.zero').onclick = () => { slider.value = 0; slider.oninput(); };
      rows[c.id][k] = { slider, show };
      el.append(row);
    }
    box.append(el);
  }
}

$('sym').checked = settings.symmetric;
$('sym').onchange = () => {
  settings.symmetric = $('sym').checked;
  if (settings.symmetric) {
    // beim Zusammenlegen gilt der linke Wert für beide Seiten
    for (const c of CONTROLS) if (c.side) settings.values[c.id] = { l: settings.values[c.id].l, r: settings.values[c.id].l };
  }
  buildControls();
  changed();
};

let broadcastQueued = false;
function changed() {
  const open = PROFILES.filter((p) => JSON.stringify(data.profiles[p.id]) !== JSON.stringify(saved.profiles[p.id]));
  const dirty = open.length > 0;
  $('dirty').textContent = dirty
    ? `Nicht gespeichert (${open.map((p) => p.label).join(', ')}) – im Spiel aber schon live sichtbar`
    : 'Alles gespeichert';
  $('dirty').classList.toggle('unsaved', dirty);
  document.querySelectorAll('#profiles button').forEach((b) => b.classList.toggle('changed', open.some((p) => p.id === b.dataset.profile)));
  if (!broadcastQueued) {
    broadcastQueued = true;
    requestAnimationFrame(() => { broadcastQueued = false; settingsChannel?.postMessage({ type: 'live', data }); });
  }
}

$('save').onclick = async () => {
  $('save').disabled = true;
  try {
    const res = await fetch('api/figur-settings', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
    });
    const out = await res.json();
    if (!out.ok) throw new Error(out.error);
    saved = structuredClone(data);
    settingsChannel?.postMessage({ type: 'saved', data });
    changed();
    $('dirty').textContent = `Gespeichert ✓ (${new Date().toLocaleTimeString('de-CH')}) – gilt ab jetzt im Spiel`;
  } catch (e) {
    $('dirty').textContent = `Speichern fehlgeschlagen: ${e.message}`;
    $('dirty').classList.add('unsaved');
  } finally {
    $('save').disabled = false;
  }
};
// Verwerfen / Alles auf 0 gelten nur für das gewählte Profil
$('revert').onclick = () => {
  data.profiles[profileId] = structuredClone(saved.profiles[profileId]);
  setProfile(profileId);
};
$('reset0').onclick = () => {
  const e = emptySettings(); e.symmetric = settings.symmetric;
  data.profiles[profileId] = e;
  setProfile(profileId);
};
addEventListener('beforeunload', (e) => {
  if (JSON.stringify(data) !== JSON.stringify(saved)) { e.preventDefault(); e.returnValue = ''; }
});

setProfile('gehen');

// ---------- Schleife ----------
await renderer.init();
resize();
$('status').textContent = renderer.backend.isWebGPUBackend ? 'WebGPU ✓' : 'WebGL2 (Fallback)';
let last = performance.now();
renderer.setAnimationLoop((now) => {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (playing) {
    mixer.update(dt * +$('speed').value);
    $('time').value = current.time % current.getClip().duration;
  } else {
    mixer.update(0);
  }
  applyPose(settings);
  skeleton.update();
  if (camTween) {
    camTween.k = Math.min(1, camTween.k + dt * 2.5);
    const e = 1 - (1 - camTween.k) ** 3;
    camera.position.lerpVectors(camTween.p0, camTween.p1, e);
    controls.target.lerpVectors(camTween.t0, camTween.t1, e);
    if (camTween.k >= 1) camTween = null;
  }
  controls.update();
  renderer.render(scene, camera);
});

// Für Tests
window.__editor = { settings: () => settings, figur, actions, setCam, normalizeSettings };
