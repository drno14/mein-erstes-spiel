import * as THREE from 'three/webgpu';

/*
 * Bewegungs-Einstellungen der Figur.
 * Jeder Regler dreht ein oder mehrere Gelenke zusätzlich zur Animation – jeden Frame neu,
 * daher addiert sich nichts auf. Werte in Grad. Gespeichert in /public/figur-settings.json.
 *
 * Achsen im Figur-Raum (three.js): +X = linke Körperseite, +Y = oben, +Z = vorne.
 * 'twist' = Drehung um die Längsachse des Knochens.
 * Für die rechte Seite wird der Winkel gespiegelt (ausser bei Achse 'x'), damit derselbe
 * Wert links und rechts die gleiche (spiegelbildliche) Bewegung macht.
 */
export const CONTROLS = [
  // ---- Arme ----
  { id: 'handTwist', group: 'Arme & Hände', label: 'Handflächen drehen', hint: 'innen ↔ aussen', side: true, min: -90, max: 90,
    parts: [['lowerarm', -0.6, 'twist'], ['hand', -0.4, 'twist']] },   // negativ: + = Daumen nach aussen
  { id: 'wristBend', group: 'Arme & Hände', label: 'Handgelenk beugen', hint: 'nach hinten ↔ nach vorne', side: true, min: -60, max: 60,
    parts: [['hand', 1, 'x-']] },
  { id: 'elbowBend', group: 'Arme & Hände', label: 'Ellbogen beugen', hint: 'strecken ↔ beugen', side: true, min: -20, max: 100,
    parts: [['lowerarm', 1, 'x-']] },
  { id: 'elbowOut', group: 'Arme & Hände', label: 'Ellbogen / Arm nach aussen', hint: 'innen ↔ aussen', side: true, min: -20, max: 60,
    parts: [['upperarm', 1, 'z']] },
  { id: 'armForward', group: 'Arme & Hände', label: 'Arme vor / zurück', hint: 'zurück ↔ vor', side: true, min: -45, max: 45,
    parts: [['upperarm', 1, 'x-']] },
  { id: 'shoulderUp', group: 'Arme & Hände', label: 'Schultern heben', hint: 'runter ↔ hoch', side: true, min: -20, max: 30,
    parts: [['clavicle', 1, 'z']] },
  // ---- Beine ----
  { id: 'legTwist', group: 'Beine & Füsse', label: 'Beine / Knie drehen', hint: 'innen ↔ aussen', side: true, min: -45, max: 45,
    parts: [['thigh', -1, 'twist']] },   // negativ: + = Knie/Zehen nach aussen
  { id: 'legForward', group: 'Beine & Füsse', label: 'Beine vor / zurück', hint: 'zurück ↔ vor (Sitzen)', side: true, min: -30, max: 100,
    parts: [['thigh', 1, 'x-']] },
  { id: 'legSpread', group: 'Beine & Füsse', label: 'Beine spreizen', hint: 'zusammen ↔ auseinander', side: true, min: -10, max: 30,
    parts: [['thigh', 1, 'z']] },
  { id: 'kneeBend', group: 'Beine & Füsse', label: 'Knie beugen', hint: 'strecken ↔ beugen', side: true, min: -10, max: 60,
    parts: [['calf', 1, 'x']] },
  { id: 'footOut', group: 'Beine & Füsse', label: 'Füsse drehen', hint: 'innen ↔ aussen', side: true, min: -40, max: 40,
    parts: [['foot', 1, 'y']] },
  { id: 'footPitch', group: 'Beine & Füsse', label: 'Fussspitze', hint: 'hoch ↔ runter', side: true, min: -30, max: 30,
    parts: [['foot', 1, 'x']] },
  { id: 'footRoll', group: 'Beine & Füsse', label: 'Füsse kippen', hint: 'Innenkante ↔ Aussenkante', side: true, min: -25, max: 25,
    parts: [['foot', 1, 'z-']] },
  // ---- Körper ----
  { id: 'lean', group: 'Körper & Kopf', label: 'Oberkörper neigen', hint: 'zurück ↔ vor', side: false, min: -25, max: 35,
    parts: [['spine_01', 0.5, 'x'], ['spine_02', 0.5, 'x']] },
  { id: 'bodyTurn', group: 'Körper & Kopf', label: 'Oberkörper drehen', hint: 'rechts ↔ links', side: false, min: -30, max: 30,
    parts: [['spine_02', 0.5, 'y'], ['spine_03', 0.5, 'y']] },
  { id: 'headNod', group: 'Körper & Kopf', label: 'Kopf neigen', hint: 'hoch ↔ runter', side: false, min: -30, max: 40,
    parts: [['neck_01', 0.4, 'x'], ['head', 0.6, 'x']] },
  { id: 'headTurn', group: 'Körper & Kopf', label: 'Kopf drehen', hint: 'rechts ↔ links', side: false, min: -60, max: 60,
    parts: [['neck_01', 0.4, 'y'], ['head', 0.6, 'y']] },
];

const AXES = {
  x: new THREE.Vector3(1, 0, 0), 'x-': new THREE.Vector3(-1, 0, 0),
  y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1), 'z-': new THREE.Vector3(0, 0, -1),
};
// Für die Längsachse: zu welchem Kind-Knochen zeigt der Knochen?
const TWIST_CHILD = { lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', upperarm: 'lowerarm' };

/** Leere Einstellungen: alle Regler auf 0, Symmetrie an. */
export function emptySettings() {
  const values = {};
  for (const c of CONTROLS) values[c.id] = c.side ? { l: 0, r: 0 } : 0;
  return { version: 1, symmetric: true, values };
}

/** Fehlende Einträge ergänzen (z. B. wenn später neue Regler dazukommen). */
export function normalizeSettings(s) {
  const base = emptySettings();
  if (!s || typeof s !== 'object') return base;
  base.symmetric = s.symmetric !== false;
  for (const c of CONTROLS) {
    const v = s.values?.[c.id];
    if (c.side) {
      if (typeof v === 'number') base.values[c.id] = { l: v, r: v };
      else if (v && typeof v === 'object') base.values[c.id] = { l: +v.l || 0, r: +v.r || 0 };
    } else if (typeof v === 'number') base.values[c.id] = v;
  }
  return base;
}

/**
 * Eigene Einstellungen pro Bewegung. Im Spiel wird je nach Animation das passende Profil benutzt
 * (mit weichem Übergang). clip = Animation, die der Editor dazu abspielt.
 */
export const PROFILES = [
  { id: 'gehen', label: 'Gehen & Stehen', clip: 'Laufen' },
  { id: 'sprint', label: 'Sprinten', clip: 'Rennen' },
  { id: 'springen', label: 'Springen', clip: 'Springen' },
];

/**
 * Gesamte Datei (alle Profile). Ältere Dateien (version 1, nur ein Satz Werte) werden übernommen:
 * die alten Werte gelten für "Gehen & Stehen" und dienen als Startwerte für die anderen Profile.
 */
export function normalizeData(d) {
  const profiles = {};
  const legacy = d && !d.profiles && d.values ? normalizeSettings(d) : null;
  for (const p of PROFILES) {
    const src = d?.profiles?.[p.id] ?? d?.profiles?.gehen ?? legacy;
    profiles[p.id] = normalizeSettings(src);
  }
  return { version: 2, profiles };
}

export async function loadData() {
  try {
    const res = await fetch(`figur-settings.json?t=${Date.now()}`);
    if (res.ok) return normalizeData(await res.json());
  } catch { /* Datei fehlt → Standardwerte */ }
  return normalizeData(null);
}

/** Nur das Profil "Gehen & Stehen" (z. B. für NPCs). */
export async function loadSettings() {
  return (await loadData()).profiles.gehen;
}

/**
 * Weicher Übergang zwischen Profilen: bewegt die Werte von `live` pro Frame Richtung `target`.
 * `live` wird verändert und kann direkt an den Pose-Applier gegeben werden.
 */
export function blendSettings(live, target, k) {
  for (const c of CONTROLS) {
    const t = target.values[c.id];
    if (c.side) {
      const v = live.values[c.id];
      v.l += (t.l - v.l) * k;
      v.r += (t.r - v.r) * k;
    } else {
      live.values[c.id] += (t - live.values[c.id]) * k;
    }
  }
  return live;
}

/** Live-Kanal zwischen Editor und Spiel (gleicher Browser). */
export const settingsChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('figur-settings') : null;

/**
 * Erzeugt eine Funktion, die die Einstellungen auf eine animierte Figur anwendet.
 * Aufrufen jeden Frame NACH mixer.update().
 */
export function createPoseApplier(figureRoot) {
  const bones = {};
  figureRoot.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const depth = (b) => { let d = 0; for (let p = b.parent; p; p = p.parent) d++; return d; };

  const qOff = new THREE.Quaternion(), qBone = new THREE.Quaternion(), qPar = new THREE.Quaternion(), qRoot = new THREE.Quaternion();
  const axis = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  // Merker: Animationspose (base) und von uns gesetzter Wert (set) je Knochen.
  // Schreibt der Mixer nicht neu (z. B. pausiert), stellen wir die Animationspose wieder her,
  // damit sich die Drehungen nicht von Bild zu Bild aufaddieren.
  const memo = new Map();

  return function apply(settings) {
    if (!settings) return;
    for (const [bone, m] of memo) {
      if (bone.quaternion.equals(m.set)) bone.quaternion.copy(m.base);   // Mixer hat nichts Neues geschrieben
    }
    memo.clear();
    // Pro Knochen alle Drehungen sammeln
    const jobs = new Map();
    for (const c of CONTROLS) {
      const v = settings.values[c.id];
      const sides = c.side ? [['l', v.l], ['r', v.r]] : [[null, v]];
      for (const [sd, deg] of sides) {
        if (!deg) continue;
        for (const [base, weight, ax] of c.parts) {
          const name = sd ? `${base}_${sd}` : base;
          const bone = bones[name];
          if (!bone) continue;
          const mirror = sd === 'r' && ax !== 'x' && ax !== 'x-' ? -1 : 1;
          const rad = THREE.MathUtils.degToRad(deg) * weight * mirror;
          const childName = TWIST_CHILD[base] ? `${TWIST_CHILD[base]}${sd ? '_' + sd : ''}` : null;
          if (!jobs.has(bone)) jobs.set(bone, []);
          jobs.get(bone).push({ ax, rad, child: childName && bones[childName] });
        }
      }
    }
    if (!jobs.size) return;
    figureRoot.updateMatrixWorld(true);
    figureRoot.getWorldQuaternion(qRoot);
    const ordered = [...jobs.keys()].sort((x, y) => depth(x) - depth(y));
    for (const bone of ordered) {
      const base = bone.quaternion.clone();
      for (const j of jobs.get(bone)) {
        if (j.ax === 'twist') {
          bone.getWorldPosition(a);
          if (j.child) j.child.getWorldPosition(b); else b.copy(a).add(new THREE.Vector3(0, -1, 0));
          axis.subVectors(b, a).normalize();
        } else {
          axis.copy(AXES[j.ax]).applyQuaternion(qRoot);
        }
        qOff.setFromAxisAngle(axis, j.rad);
        bone.getWorldQuaternion(qBone);
        bone.parent.getWorldQuaternion(qPar);
        bone.quaternion.copy(qPar.invert().multiply(qOff.multiply(qBone)));
        bone.updateMatrixWorld(true);
      }
      memo.set(bone, { base, set: bone.quaternion.clone() });
    }
  };
}
