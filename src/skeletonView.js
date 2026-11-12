import * as THREE from 'three/webgpu';

// Gelenkpunkte (Knochennamen des MPFB-"game_engine"-Skeletts) und ihre Verbindungen
const JOINTS = {
  pelvis: 'Beckenmitte', spine_01: 'Wirbelsäule unten', spine_02: 'Wirbelsäule Mitte', spine_03: 'Brust',
  neck_01: 'Hals', head: 'Kopf',
  upperarm_l: 'Schulter L', lowerarm_l: 'Ellbogen L', hand_l: 'Hand L',
  upperarm_r: 'Schulter R', lowerarm_r: 'Ellbogen R', hand_r: 'Hand R',
  thigh_l: 'Hüfte L', calf_l: 'Knie L', foot_l: 'Fussgelenk L', ball_l: 'Zehen L',
  thigh_r: 'Hüfte R', calf_r: 'Knie R', foot_r: 'Fussgelenk R', ball_r: 'Zehen R',
};
const LINKS = [
  ['pelvis', 'thigh_l'], ['thigh_l', 'calf_l'], ['calf_l', 'foot_l'], ['foot_l', 'ball_l'],
  ['pelvis', 'thigh_r'], ['thigh_r', 'calf_r'], ['calf_r', 'foot_r'], ['foot_r', 'ball_r'],
  ['pelvis', 'spine_01'], ['spine_01', 'spine_02'], ['spine_02', 'spine_03'], ['spine_03', 'neck_01'], ['neck_01', 'head'],
  ['spine_03', 'upperarm_l'], ['upperarm_l', 'lowerarm_l'], ['lowerarm_l', 'hand_l'],
  ['spine_03', 'upperarm_r'], ['upperarm_r', 'lowerarm_r'], ['lowerarm_r', 'hand_r'],
];
const COLORS = { l: 0x3ad1ff, r: 0xff6a3a, m: 0xffe14a };   // links blau, rechts orange, Mitte gelb
const side = (name) => (name.endsWith('_l') ? 'l' : name.endsWith('_r') ? 'r' : 'm');

/** Zeigt die Gelenke einer animierten Figur als Punkte + Linien (Taste K). */
export function createSkeletonView(scene, figureRoot) {
  const bones = {};
  figureRoot.traverse((o) => { if (o.isBone && o.name in JOINTS) bones[o.name] = o; });
  const names = Object.keys(JOINTS).filter((n) => bones[n]);

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 999;
  scene.add(group);

  const dotGeo = new THREE.SphereGeometry(0.03, 12, 8);
  const dots = names.map((n) => {
    const m = new THREE.Mesh(dotGeo, new THREE.MeshBasicMaterial({ color: COLORS[side(n)], depthTest: false, transparent: true }));
    m.renderOrder = 1000;
    group.add(m);
    return m;
  });

  const links = LINKS.filter(([a, b]) => bones[a] && bones[b]);
  const pos = new Float32Array(links.length * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const lines = new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.9 }));
  lines.renderOrder = 999;
  lines.frustumCulled = false;
  group.add(lines);

  const tmp = new THREE.Vector3();
  const world = {};
  return {
    get visible() { return group.visible; },
    toggle() { group.visible = !group.visible; return group.visible; },
    update() {
      if (!group.visible) return;
      figureRoot.updateMatrixWorld(true);
      names.forEach((n, i) => {
        world[n] = bones[n].getWorldPosition(world[n] || new THREE.Vector3());
        dots[i].position.copy(world[n]);
      });
      links.forEach(([a, b], i) => {
        tmp.copy(world[a]); pos.set([tmp.x, tmp.y, tmp.z], i * 6);
        tmp.copy(world[b]); pos.set([tmp.x, tmp.y, tmp.z], i * 6 + 3);
      });
      lineGeo.attributes.position.needsUpdate = true;
    },
    joints: JOINTS,
  };
}
