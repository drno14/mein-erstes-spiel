// Situationen: Tageszeit (Sonne/Mond, Himmel, Sterne) und Wetter (Sonnig, Bewölkt, Regen, Gewitter, Nebel).
// Wird von main.js jeden Frame mit update(dt, playerPos, camera) aufgerufen.
import * as THREE from 'three/webgpu';

const WETTER = ['Sonnig', 'Bewölkt', 'Regen', 'Gewitter', 'Nebel'];

// Zielwerte je Wetterlage (werden über ~3 s weich angeglichen)
const WETTER_PARAM = {
  Sonnig:   { grau: 0.0,  sonne: 1.0,  hemi: 1.0,  near: 90, far: 245, regen: 0, blitz: 0, nebel: 0, sterne: 1 },
  Bewölkt:  { grau: 0.55, sonne: 0.45, hemi: 0.85, near: 70, far: 210, regen: 0, blitz: 0, nebel: 0, sterne: 0.15 },
  Regen:    { grau: 0.75, sonne: 0.25, hemi: 0.7,  near: 40, far: 160, regen: 1, blitz: 0, nebel: 0, sterne: 0 },
  Gewitter: { grau: 0.9,  sonne: 0.12, hemi: 0.55, near: 35, far: 140, regen: 1, blitz: 1, nebel: 0, sterne: 0 },
  Nebel:    { grau: 0.4,  sonne: 0.35, hemi: 0.8,  near: 10, far: 70,  regen: 0, blitz: 0, nebel: 1, sterne: 0 },
};

// Farben
const C_NACHT = new THREE.Color(0x0b1530);
const C_TAG = new THREE.Color(0xa9cdea);
const C_DAEMMER = new THREE.Color(0xf09a7a);   // orange-rosa
const C_GRAU = new THREE.Color(0x8a939c);
const C_NEBEL = new THREE.Color(0xc4c9ce);
const C_BLITZ = new THREE.Color(0xe8eeff);

const C_SONNE = new THREE.Color(0xfff1dc);
const C_SONNE_TIEF = new THREE.Color(0xffa060);
const C_MOND = new THREE.Color(0x9fb4ff);

const C_HEMI_HIMMEL_TAG = new THREE.Color(0xdfefff);
const C_HEMI_HIMMEL_NACHT = new THREE.Color(0x2a3a66);
const C_HEMI_BODEN_TAG = new THREE.Color(0x4a6b35);
const C_HEMI_BODEN_NACHT = new THREE.Color(0x141c18);

const C_WASSER_TAG = new THREE.Color(0x3f8fc2);
const C_WASSER_NACHT = new THREE.Color(0x0d2236);
const C_WASSER_GRAU = new THREE.Color(0x4f6d80);

const SONNE_INT = 2.6;
const MOND_INT = 0.25;
const HEMI_TAG = 1.4;
const HEMI_NACHT = 0.35;
const LICHT_ABSTAND = 65;

const REGEN_ANZAHL = 3000;
const REGEN_BOX = 40;          // Kantenlänge der Regenbox in m
const REGEN_HALB = REGEN_BOX / 2;
const REGEN_TEMPO = 22;        // m/s
const REGEN_LAENGE = 0.55;     // Länge eines Tropfens
const WIND_X = 0.12;           // leichte Schräglage

const STERNE_ANZAHL = 1400;
const STERNE_RADIUS = 400;

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

export function createSituations({ scene, sun, hemi, water }) {
  // ---------- Zustand ----------
  let zeit = 10;                 // Stunden 0..24
  let wetterIndex = 0;
  let nacht = 0;
  let blitz = 0;                 // aktuelle Blitzhelligkeit 0..1
  let blitzTimer = 4 + Math.random() * 8;
  let blitzNachleuchten = 0;     // zweiter Flacker kurz nach dem ersten
  let labelCache = '';
  let labelMinute = -1;
  let labelWetter = -1;

  // aktuell geblendete Wetterwerte (Start = Sonnig)
  const w = { ...WETTER_PARAM.Sonnig };

  // Arbeitsobjekte (keine Allokationen pro Frame)
  const himmel = new THREE.Color();
  const tmpC = new THREE.Color();
  const richtung = new THREE.Vector3();
  const sunOffset = new THREE.Vector3(-30, 55, 22).setLength(LICHT_ABSTAND);

  if (!(scene.fog instanceof THREE.Fog)) scene.fog = new THREE.Fog(C_TAG.getHex(), 90, 245);
  if (!(scene.background instanceof THREE.Color)) scene.background = new THREE.Color(C_TAG);

  // ---------- Sterne: Instanzen kleiner Quadrate auf einer Kugel um die Kamera ----------
  const sterneMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide,
  });
  const sterne = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), sterneMat, STERNE_ANZAHL);
  {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const o = new THREE.Object3D();
    const c = new THREE.Color();
    for (let i = 0; i < STERNE_ANZAHL; i++) {
      // gleichmässig auf der oberen Halbkugel (etwas unter den Horizont)
      const y = -0.1 + Math.random() * 1.1;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const phi = Math.random() * Math.PI * 2;
      p.set(Math.cos(phi) * r, y, Math.sin(phi) * r).multiplyScalar(STERNE_RADIUS);
      o.position.copy(p);
      o.lookAt(0, 0, 0);
      q.copy(o.quaternion);
      const g = 0.6 + Math.random() * Math.random() * 1.6;
      s.set(g, g, 1);
      m.compose(p, q, s);
      sterne.setMatrixAt(i, m);
      const hell = 0.5 + Math.random() * 0.5;
      c.setRGB(hell, hell, hell * (0.9 + Math.random() * 0.2));
      sterne.setColorAt(i, c);
    }
    sterne.instanceMatrix.needsUpdate = true;
    if (sterne.instanceColor) sterne.instanceColor.needsUpdate = true;
  }
  sterne.frustumCulled = false;
  sterne.renderOrder = -10;
  sterne.visible = false;
  scene.add(sterne);

  // ---------- Regen: LineSegments, Tropfen in Weltkoordinaten, um die Kamera umbrechend ----------
  const tropfen = new Float32Array(REGEN_ANZAHL * 3);
  for (let i = 0; i < REGEN_ANZAHL; i++) {
    tropfen[i * 3] = (Math.random() - 0.5) * REGEN_BOX;
    tropfen[i * 3 + 1] = (Math.random() - 0.5) * REGEN_BOX;
    tropfen[i * 3 + 2] = (Math.random() - 0.5) * REGEN_BOX;
  }
  const regenPos = new Float32Array(REGEN_ANZAHL * 6);
  const regenGeo = new THREE.BufferGeometry();
  const regenAttr = new THREE.BufferAttribute(regenPos, 3);
  regenAttr.setUsage(THREE.DynamicDrawUsage);
  regenGeo.setAttribute('position', regenAttr);
  const regenMat = new THREE.LineBasicMaterial({
    color: 0xa9bccf, transparent: true, opacity: 0, depthWrite: false, fog: false,
  });
  const regen = new THREE.LineSegments(regenGeo, regenMat);
  regen.frustumCulled = false;
  regen.visible = false;
  scene.add(regen);

  const wrap = (v) => {
    if (v > REGEN_HALB) return v - REGEN_BOX;
    if (v < -REGEN_HALB) return v + REGEN_BOX;
    return v;
  };

  function updateRegen(dt, cam) {
    const fall = REGEN_TEMPO * dt;
    const cx = cam.x, cy = cam.y, cz = cam.z;
    const lx = WIND_X * REGEN_LAENGE, ly = REGEN_LAENGE;
    for (let i = 0; i < REGEN_ANZAHL; i++) {
      const k = i * 3;
      let x = tropfen[k] + fall * WIND_X;
      let y = tropfen[k + 1] - fall;
      let z = tropfen[k + 2];
      // relativ zur Kamera umbrechen
      x = wrap(x - cx) + cx;
      y = wrap(y - cy) + cy;
      z = wrap(z - cz) + cz;
      tropfen[k] = x; tropfen[k + 1] = y; tropfen[k + 2] = z;
      const j = i * 6;
      regenPos[j] = x; regenPos[j + 1] = y; regenPos[j + 2] = z;
      regenPos[j + 3] = x - lx; regenPos[j + 4] = y + ly; regenPos[j + 5] = z;
    }
    regenAttr.needsUpdate = true;
  }
  let regenInit = false;

  // ---------- Sonnenstand ----------
  // Tag 6..20 Uhr: Sonne läuft über den Himmel; Nacht 20..6 Uhr: Mond auf gleichem Bogen.
  function sonnenHoehe(h) {
    if (h >= 6 && h <= 20) return Math.sin(Math.PI * (h - 6) / 14);
    const n = h > 20 ? h - 20 : h + 4;          // 0..10 Stunden Nacht
    return -Math.sin(Math.PI * n / 10);
  }
  function bogenWinkel(h) {
    if (h >= 6 && h <= 20) return Math.PI * (h - 6) / 14;
    const n = h > 20 ? h - 20 : h + 4;
    return Math.PI * n / 10;
  }

  // ---------- Update ----------
  function update(dt, playerPos, camera) {
    dt = Math.min(dt, 0.1);
    zeit = (zeit + dt * api.timeSpeed) % 24;
    if (zeit < 0) zeit += 24;

    // Wetter weich angleichen (~3 s)
    const ziel = WETTER_PARAM[WETTER[wetterIndex]];
    const k = 1 - Math.exp(-dt * 1.5);
    for (const key in ziel) w[key] += (ziel[key] - w[key]) * k;

    // Sonne/Mond
    const hoehe = sonnenHoehe(zeit);
    const tag = smooth(-0.12, 0.25, hoehe);            // 0 Nacht .. 1 Tag
    nacht = 1 - tag;
    const daemmer = (1 - smooth(0.0, 0.4, Math.abs(hoehe + 0.03))) * (1 - w.grau * 0.8);

    // Lichtrichtung: Bogen von Osten nach Westen, Höhe für brauchbare Schatten begrenzt
    const a = bogenWinkel(zeit);
    richtung.set(-Math.cos(a) * 0.9, Math.max(Math.sin(a), 0.32), 0.38).normalize();
    sunOffset.copy(richtung).multiplyScalar(LICHT_ABSTAND);

    const istSonne = hoehe >= 0;
    if (istSonne) {
      const tief = 1 - smooth(0.05, 0.45, hoehe);
      sun.color.copy(C_SONNE).lerp(C_SONNE_TIEF, tief);
      sun.intensity = SONNE_INT * smooth(0.0, 0.2, hoehe) * w.sonne;
    } else {
      sun.color.copy(C_MOND);
      sun.intensity = MOND_INT * smooth(0.0, 0.15, -hoehe) * (0.4 + 0.6 * w.sonne);
    }

    // Blitz (nur bei Gewitter)
    if (w.blitz > 0.5) {
      blitzTimer -= dt;
      if (blitzTimer <= 0) {
        blitz = 1;
        blitzNachleuchten = 0.12 + Math.random() * 0.15;
        blitzTimer = 4 + Math.random() * 8;
      }
    }
    if (blitzNachleuchten > 0) {
      blitzNachleuchten -= dt;
      if (blitzNachleuchten <= 0) blitz = Math.max(blitz, 0.7);
    }
    blitz = Math.max(0, blitz - dt * 6);
    const blitzStark = blitz * w.blitz;

    // Himmelfarbe
    himmel.copy(C_NACHT).lerp(C_TAG, tag);
    himmel.lerp(C_DAEMMER, daemmer * 0.65);
    tmpC.copy(C_GRAU).multiplyScalar(0.25 + 0.75 * tag);
    himmel.lerp(tmpC, w.grau * 0.85);
    tmpC.copy(C_NEBEL).multiplyScalar(0.18 + 0.82 * tag);
    himmel.lerp(tmpC, w.nebel * 0.9);
    himmel.lerp(C_BLITZ, blitzStark * 0.8);
    scene.background.copy(himmel);
    scene.fog.color.copy(himmel);
    scene.fog.near = w.near;
    scene.fog.far = w.far;

    // Hemisphärenlicht
    if (hemi) {
      hemi.color.copy(C_HEMI_HIMMEL_NACHT).lerp(C_HEMI_HIMMEL_TAG, tag);
      hemi.color.lerp(C_DAEMMER, daemmer * 0.3);
      hemi.groundColor.copy(C_HEMI_BODEN_NACHT).lerp(C_HEMI_BODEN_TAG, tag);
      hemi.intensity = lerp(HEMI_NACHT, HEMI_TAG, tag) * w.hemi + blitzStark * 3;
      if (blitzStark > 0.01) hemi.color.lerp(C_BLITZ, blitzStark);
    }

    // Wasser
    if (water && water.material && water.material.color) {
      water.material.color.copy(C_WASSER_NACHT).lerp(C_WASSER_TAG, tag);
      water.material.color.lerp(C_WASSER_GRAU, w.grau * 0.5 * tag);
    }

    // Sterne
    const cam = camera ? camera.position : playerPos;
    const sternSicht = nacht * nacht * w.sterne;
    sterne.visible = sternSicht > 0.01;
    if (sterne.visible) {
      sterne.position.copy(cam);
      sterneMat.opacity = sternSicht;
    }

    // Regen
    const regenSicht = w.regen;
    regen.visible = regenSicht > 0.02;
    if (regen.visible) {
      if (!regenInit) {
        // Tropfen beim ersten Mal um die Kamera verteilen
        for (let i = 0; i < REGEN_ANZAHL * 3; i += 3) {
          tropfen[i] += cam.x; tropfen[i + 1] += cam.y; tropfen[i + 2] += cam.z;
        }
        regenInit = true;
      }
      updateRegen(dt, cam);
      regenMat.opacity = regenSicht * (0.35 + 0.25 * tag) + blitzStark * 0.3;
    }
  }

  function aktualisiereLabel() {
    const min = Math.floor(zeit * 60) % 1440;
    if (min === labelMinute && wetterIndex === labelWetter) return labelCache;
    labelMinute = min;
    labelWetter = wetterIndex;
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    labelCache = `${hh < 10 ? '0' : ''}${hh}:${mm < 10 ? '0' : ''}${mm} · ${WETTER[wetterIndex]}`;
    return labelCache;
  }

  const api = {
    update,
    sunOffset,
    timeSpeed: 1 / 60,
    get timeOfDay() { return zeit; },
    setTimeOfDay(h) { zeit = ((h % 24) + 24) % 24; },
    cycleWeather() {
      wetterIndex = (wetterIndex + 1) % WETTER.length;
      blitzTimer = 2 + Math.random() * 4;
      return WETTER[wetterIndex];
    },
    get weather() { return WETTER[wetterIndex]; },
    get night() { return nacht; },
    get label() { return aktualisiereLabel(); },
  };
  return api;
}
