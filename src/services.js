import * as THREE from 'three/webgpu';
import { placeBuilding, buildStraightRoad } from './world/modern.js';

/*
 * Stadtzentrum beim Startdorf: Spital, Polizei, Feuerwehr, Bank – an einer Strasse (z = −30).
 * H an der Tür öffnet das jeweilige Fenster (Behandlung, Busse, Konto/Überfall).
 */

const ROAD_Z = -30;
const BUILDINGS = [
  { id: 'spital', name: 'Spital', model: 'commercial/building-n', scale: 5, x: 20, side: 1, color: '#d42b2b', sign: '✚ SPITAL' },
  { id: 'polizei', name: 'Polizei', model: 'commercial/building-k', scale: 6, x: 37, side: 1, color: '#1f4fa8', sign: 'POLIZEI' },
  { id: 'feuerwehr', name: 'Feuerwehr', model: 'commercial/building-e', scale: 7, x: 20, side: -1, color: '#c8321e', sign: 'FEUERWEHR' },
  { id: 'bank', name: 'Bank', model: 'commercial/building-j', scale: 5, x: 37, side: -1, color: '#1d6b4a', sign: '🏦 BANK' },
];
const PARKED = { spital: ['ambulance', 5.2], polizei: ['police', 4.7], feuerwehr: ['firetruck', 7.5] };

function signTexture(text, color) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = color; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#ffffff'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 116);
  g.fillStyle = '#ffffff'; g.font = 'bold 72px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Services {
  constructor({ scene, terrain, loader, modern, player }) {
    Object.assign(this, { scene, terrain, loader, modern, player });
    this.obstacles = [];
    this.doors = {};          // id → { x, z, rot, name }
    this.reserved = { x0: 8, x1: 50, z0: -48, z1: -14 };   // hier keine generierten Bäume
  }

  async build() {
    const { terrain, scene } = this;
    scene.add(buildStraightRoad(terrain, -1.5, ROAD_Z, 48, ROAD_Z, 6));
    const find = (f) => [...this.modern.shop, ...this.modern.tower].find((p) => p.f === f);
    for (const b of BUILDINGS) {
      const proto = find(b.model);
      if (!proto) continue;
      const d = proto.d * b.scale, w = proto.w * b.scale, h = proto.h * b.scale;
      const z = ROAD_Z + b.side * (3 + 1.5 + d / 2);
      const rot = b.side > 0 ? Math.PI : 0;              // Vorderseite (+Z) zur Strasse
      const pb = placeBuilding(proto, terrain, b.x, z, rot, b.scale);
      scene.add(pb.obj);
      this.obstacles.push(pb.obstacle);
      // Schild über der Tür
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.05), new THREE.MeshBasicMaterial({ map: signTexture(b.sign, b.color) }));
      const fy = terrain.height(b.x, z - b.side * d / 2);
      sign.position.set(b.x, fy + Math.min(h * 0.55, 4.6), z - b.side * (d / 2 + 0.12));
      sign.rotation.y = rot;
      scene.add(sign);
      const doorZ = z - b.side * (d / 2 + 1.6);
      this.doors[b.id] = { x: b.x, z: doorZ, name: b.name, w };
    }
    // Einsatzfahrzeuge vor den Gebäuden
    await Promise.all(Object.entries(PARKED).map(async ([id, [file, len]]) => {
      const door = this.doors[id];
      if (!door) return;
      try {
        const g = await this.loader.loadAsync(`models/fahrzeuge/${file}.glb`);
        const car = g.scene;
        const box = new THREE.Box3().setFromObject(car);
        const size = box.getSize(new THREE.Vector3());
        car.scale.setScalar(len / Math.max(size.x, size.z));
        car.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        const x = door.x + door.w / 2 + 2.2, z = door.z;
        car.position.set(x, terrain.height(x, z), z);
        car.rotation.y = Math.PI / 2 * (size.x > size.z ? 0 : 1);
        scene.add(car);
        this.obstacles.push({ type: 'obb', x, z, cos: Math.cos(car.rotation.y), sin: Math.sin(car.rotation.y), hw: len / 2 * (size.x > size.z ? 1 : 0.42), hd: len / 2 * (size.x > size.z ? 0.42 : 1), top: Infinity });
        this.vehicleModels ??= {};
        this.vehicleModels[file] = g.scene;
      } catch (err) { console.warn('[Services] Fahrzeug fehlt', file, err); }
    }));
  }

  /** Nächste Tür in Reichweite → id oder null. */
  doorNear(x, z, d = 5) {
    let best = null, bd = d;
    for (const [id, door] of Object.entries(this.doors)) {
      const dist = Math.hypot(door.x - x, door.z - z);
      if (dist < bd) { bd = dist; best = id; }
    }
    return best;
  }

  *obstaclesNear(x, z) {
    if (x < this.reserved.x0 - 10 || x > this.reserved.x1 + 10 || z < this.reserved.z0 - 10 || z > this.reserved.z1 + 10) return;
    yield* this.obstacles;
  }
}
