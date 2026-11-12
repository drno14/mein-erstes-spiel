import * as THREE from 'three/webgpu';
import { CHUNK_SIZE, SEA_LEVEL } from './terrain.js';
import { mulberry32, hash2 } from './noise.js';

// Dekoration der Welt: Marktstände, Laternen, Lagerfeuer, Zelte, Mühlen, Boote …
// Modelle: Kenney (CC0), Ordner public/models/{survival,stadt,boote}.
// Alles ist deterministisch pro Chunk (Seed, cx, cz) → beim Zurückkommen gleich.

const HOUSE_CLEAR = 3;           // Abstand zu Hauswänden (m)
const START_CLEAR = 60;          // Wildnis-Deko erst ausserhalb dieses Radius
const VILLAGE_KEEP_OUT = 45;     // Wildnis-Deko so weit weg von Dorfzentren
const BUILD_PER_FRAME = 1;       // neue Chunk-Dekos pro Frame
const FIRE_LIGHTS = 4;           // feste Anzahl Lichter (WebGPU: Lichtanzahl nie ändern → kein Shader-Neubau)
const LAMP_LIGHTS = 6;
const LIGHT_PICK_INTERVAL = 0.2; // wie oft die nächsten Lichtquellen gesucht werden (s)
const ZERO_M = new THREE.Matrix4().makeScale(0, 0, 0);

/**
 * Zerstörbare Deko: Name → [Material, Anzeigename, Lebenspunkte, Beute [[Gegenstand, Anzahl]]].
 * Material bestimmt, welches Werkzeug gut wirkt (combat.js). Laternen, Brunnen, Mühlen bleiben ganz.
 */
const DESTRUCT = {
  barrel: ['holz', 'Fass', 40, [['planken', 1]]], 'barrel-open': ['holz', 'Fass', 35, [['planken', 1]]],
  box: ['holz', 'Kiste', 30, [['planken', 1]]], 'box-large': ['holz', 'Grosse Kiste', 45, [['planken', 2]]],
  'box-open': ['holz', 'Kiste', 25, [['planken', 1]]], 'box-large-open': ['holz', 'Grosse Kiste', 40, [['planken', 2]]],
  cart: ['holz', 'Karren', 70, [['planken', 2], ['holz', 1]]], 'cart-high': ['holz', 'Karren', 75, [['planken', 2], ['holz', 1]]],
  chest: ['holz', 'Truhe', 60, [['coin', 5]]], wheel: ['holz', 'Rad', 30, [['planken', 1]]],
  'tree-log': ['holz', 'Baumstamm', 60, [['holz', 3]]], signpost: ['holz', 'Wegweiser', 25, [['planken', 1]]],
  'signpost-single': ['holz', 'Wegweiser', 25, [['planken', 1]]], bucket: ['holz', 'Eimer', 12, []],
  'stall-bench': ['holz', 'Bank', 35, [['planken', 1]]], 'stall-stool': ['holz', 'Hocker', 15, []],
  stall: ['holz', 'Marktstand', 90, [['planken', 3]]], 'stall-red': ['holz', 'Marktstand', 90, [['planken', 3]]],
  'stall-green': ['holz', 'Marktstand', 90, [['planken', 3]]], workbench: ['holz', 'Werkbank', 60, [['planken', 2]]],
  'workbench-anvil': ['metall', 'Amboss', 120, []], 'workbench-grind': ['stein', 'Schleifbank', 70, [['stein', 1]]],
  'resource-wood': ['holz', 'Holzstapel', 20, [['holz', 2]]], 'resource-planks': ['holz', 'Bretterstapel', 20, [['planken', 2]]],
  'resource-stone': ['stein', 'Steinhaufen', 40, [['stein', 2]]], tent: ['stoff', 'Zelt', 40, []], 'tent-canvas': ['stoff', 'Zelt', 40, []],
  bedroll: ['stoff', 'Schlafsack', 15, []], fence: ['holz', 'Zaun', 35, [['planken', 1]]], hedge: ['pflanze', 'Hecke', 40, []],
  'campfire-stand': ['holz', 'Feuergestell', 25, [['holz', 1]]],
};

/**
 * Massstab-Tabelle: Datei + Zielmass in Metern.
 * h = Höhe (y), w = Breite (x), l = Länge (z) der Bounding-Box.
 * flat: Modell liegend (um X gekippt), center: Ursprung = Mitte (für Drehteile),
 * keepY: y-Ursprung des Modells behalten (Bojen: Wasserlinie bei 0).
 */
const MODELS = {
  barrel: ['survival/barrel', { h: 0.9 }],
  'barrel-open': ['survival/barrel-open', { h: 0.9 }],
  box: ['survival/box', { h: 0.6 }],
  'box-large': ['survival/box-large', { h: 0.6 }],
  bucket: ['survival/bucket', { h: 0.35 }],
  bottle: ['survival/bottle', { h: 0.3 }],
  bedroll: ['survival/bedroll', { l: 1.9 }],
  'campfire-pit': ['survival/campfire-pit', { w: 1.2 }],
  'campfire-stand': ['survival/campfire-stand', { w: 1.4 }],
  chest: ['survival/chest', { w: 0.9 }],
  signpost: ['survival/signpost', { h: 2.0 }],
  tent: ['survival/tent', { w: 2.5 }],
  'tent-canvas': ['survival/tent-canvas', { w: 2.5 }],
  axe: ['survival/tool-axe', { l: 0.9, flat: true }],
  hammer: ['survival/tool-hammer', { l: 0.45, flat: true }],
  pickaxe: ['survival/tool-pickaxe', { l: 0.9, flat: true }],
  shovel: ['survival/tool-shovel', { l: 1.2, flat: true }],
  hoe: ['survival/tool-hoe', { l: 1.3, flat: true }],
  workbench: ['survival/workbench', { h: 0.9 }],
  anvil: ['survival/workbench-anvil', { h: 0.9 }],
  'resource-wood': ['survival/resource-wood', { w: 1.0 }],
  'resource-planks': ['survival/resource-planks', { l: 2.0 }],
  'resource-stone': ['survival/resource-stone', { w: 0.8 }],
  'tree-log': ['survival/tree-log', { l: 2.6 }],
  fish: ['survival/fish', { w: 0.45 }],
  'fish-large': ['survival/fish-large', { w: 0.75 }],
  cart: ['stadt/cart', { l: 2.2 }],
  'cart-high': ['stadt/cart-high', { l: 2.3 }],
  fountain: ['stadt/fountain-round', { w: 3.5 }],
  lantern: ['stadt/lantern', { h: 2.6 }],
  stall: ['stadt/stall', { l: 2.6 }],
  'stall-green': ['stadt/stall-green', { w: 2.6 }],
  'stall-red': ['stadt/stall-red', { w: 2.6 }],
  'stall-bench': ['stadt/stall-bench', { l: 1.6 }],
  'stall-stool': ['stadt/stall-stool', { h: 0.45 }],
  'banner-green': ['stadt/banner-green', { h: 1.8 }],
  'banner-red': ['stadt/banner-red', { h: 1.8 }],
  'mill-wheel': ['stadt/watermill', { h: 4.0, center: true }],   // nur das Wasserrad
  'mill-rotor': ['stadt/windmill', { h: 8.0, center: true }],    // nur die Flügel
  wheel: ['stadt/wheel', { h: 1.3 }],
  // ---- modern (Kenney City Kits, CC0) ----
  streetlight: ['modern/roads/light-curved', { h: 5.6, keepXZ: true }],
  'traffic-light': ['modern/roads/traffic-light', { h: 4.3, keepXZ: true }],
  'street-sign': ['modern/roads/road-sign-street', { h: 3.0, keepXZ: true }],
  'stop-sign': ['modern/roads/road-sign-stop', { h: 2.6, keepXZ: true }],
  dumpster: ['modern/roads/dumpster', { h: 1.5 }],
  cone: ['modern/roads/construction-cone', { h: 0.7 }],
  barrier: ['modern/roads/construction-barrier', { h: 1.0 }],
  planter: ['modern/suburban/planter', { w: 2.2 }],
  parasol: ['modern/commercial/detail-parasol-a', { h: 2.6 }],
  'parasol-b': ['modern/commercial/detail-parasol-b', { h: 2.6 }],
  'car-sedan': ['fahrzeuge/sedan', { l: 4.6 }],
  'car-suv': ['fahrzeuge/suv', { l: 4.8 }],
  'car-hatch': ['fahrzeuge/hatchback-sports', { l: 4.3 }],
  'car-taxi': ['fahrzeuge/taxi', { l: 4.6 }],
  'car-van': ['fahrzeuge/van', { l: 5.0 }],
  'car-police': ['fahrzeuge/police', { l: 4.7 }],
  'boat-row-small': ['boote/boat-row-small', { l: 3.2 }],
  'boat-row-large': ['boote/boat-row-large', { l: 4.2 }],
  'boat-sail-a': ['boote/boat-sail-a', { l: 6.0 }],
  'boat-sail-b': ['boote/boat-sail-b', { l: 6.4 }],
  'boat-fishing-small': ['boote/boat-fishing-small', { l: 6.5 }],
  buoy: ['boote/buoy', { h: 1.5, keepY: true }],
  'buoy-flag': ['boote/buoy-flag', { h: 2.2, keepY: true }],
};

// Wie tief Boote im Wasser liegen (m)
const BOAT_SINK = {
  'boat-row-small': 0.18, 'boat-row-large': 0.2, 'boat-sail-a': 0.3, 'boat-sail-b': 0.3, 'boat-fishing-small': 0.35,
};

// Animationsarten
const A_ROTOR = 0, A_WHEEL = 1, A_FLOAT = 2, A_FLAME = 3;

// Wiederverwendete Hilfsobjekte (keine Allokationen in heissen Pfaden)
const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _box = new THREE.Box3(), _box2 = new THREE.Box3();

const TAU = Math.PI * 2;

export class DecorManager {
  constructor({ scene, terrain, chunks, seed, loader }) {
    Object.assign(this, { scene, terrain, chunks, seed, loader });
    this.protos = new Map();        // Name → { parts:[{geo, mat, local, cast}], hw, hd, h }
    this.entries = new Map();       // Chunk-Key (String) → Eintrag
    this.grid = new Map();          // numerischer Key → Eintrag (für obstaclesNear ohne Strings)
    this.start = null;              // Startdorf-Eintrag
    this.destroyed = new Set();     // "Chunk-Key:n" – zerstörte Deko bleibt weg
    this.time = 0;
    this._syncTimer = 0;
    this._lastChunkCount = -1;
    this._pickTimer = 0;

    // Flache Listen über alle Einträge (neu gebaut bei Spawn/Despawn)
    this.anims = [];
    this.fires = [];                // { pos: Vector3, ph }
    this.lamps = [];                // Vector3 (Glaskörper)
    this._campfires = [];           // Vector3 (Boden der Feuerstelle)

    // Materialien für eigene Teile
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0x4a4436, emissive: 0xffc46a, emissiveIntensity: 0, roughness: 0.6 });
    this.flameOuter = new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.85, depthWrite: false });
    this.flameInner = new THREE.MeshBasicMaterial({ color: 0xffd25a, transparent: true, opacity: 0.95, depthWrite: false });
    this.flameGeoOuter = new THREE.ConeGeometry(0.26, 0.85, 7).translate(0, 0.425, 0);
    this.flameGeoInner = new THREE.ConeGeometry(0.15, 0.55, 6).translate(0, 0.275, 0);
    this.ownMaterials = [this.glowMat, this.flameOuter, this.flameInner];
    this.ownGeometries = [this.flameGeoOuter, this.flameGeoInner];

    // Fester Licht-Pool (Lichter nie hinzufügen/entfernen, nur Intensität ändern)
    this.fireLights = [];
    this.lampLights = [];
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = new THREE.PointLight(0xff8a3a, 0, 12, 1.6);
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      this.fireLights.push(l);
      scene.add(l);
    }
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffd29a, 0, 10, 1.8);
      l.castShadow = false;
      l.position.set(0, -1000, 0);
      this.lampLights.push(l);
      scene.add(l);
    }
    this._fireIdx = new Int32Array(FIRE_LIGHTS);
    this._fireD = new Float64Array(FIRE_LIGHTS);
    this._fireN = 0;
    this._lampIdx = new Int32Array(LAMP_LIGHTS);
    this._lampD = new Float64Array(LAMP_LIGHTS);
    this._lampN = 0;
  }

  /** Lagerfeuer-Positionen (Weltkoordinaten) – z. B. als Ziel für NPCs. */
  get campfires() { return this._campfires; }

  // ---------- Laden ----------

  async init() {
    const files = [...new Set(Object.values(MODELS).map(([f]) => f))];
    const scenes = new Map();
    await Promise.all(files.map(async (f) => {
      const gltf = await this.loader.loadAsync(`models/${f}.glb`);
      scenes.set(f, gltf.scene);
    }));
    for (const [name, [file, spec]] of Object.entries(MODELS)) {
      this.protos.set(name, this._protoFromScene(scenes.get(file), spec));
    }
    this._buildProceduralProtos();

    // Startdorf (fest am Ursprung)
    this.start = this._newEntry('start', NaN, NaN);
    this._buildStartVillage(this.start);
    this._finishEntry(this.start);
    this._rebuildLists();
  }

  /** Prototyp aus einer GLTF-Szene: Teile mit fertiger lokaler Matrix (Massstab + Verschiebung). */
  _protoFromScene(root, spec) {
    root.updateMatrixWorld(true);
    const pre = new THREE.Matrix4();
    if (spec.flat) pre.makeRotationX(Math.PI / 2);   // liegend: Oberseite zeigt nach +Z
    const parts = [];
    const box = new THREE.Box3();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const local = pre.clone().multiply(o.matrixWorld);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      box.union(_box.copy(o.geometry.boundingBox).applyMatrix4(local));
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const mat of mats) parts.push({ geo: o.geometry, mat, local, cast: true });
    });
    const size = box.getSize(new THREE.Vector3());
    const s = spec.h ? spec.h / size.y : spec.w ? spec.w / size.x : spec.l / size.z;
    const c = box.getCenter(new THREE.Vector3());
    if (spec.keepXZ) { c.x = 0; c.z = 0; }   // Ursprung (z. B. Mastfuss) behalten
    const ty = spec.center ? -c.y * s : spec.keepY ? 0 : -box.min.y * s;
    const norm = new THREE.Matrix4().makeTranslation(-c.x * s, ty, -c.z * s).multiply(new THREE.Matrix4().makeScale(s, s, s));
    for (const part of parts) part.local.premultiply(norm);
    return {
      parts, scale: s,
      hw: (size.x * s) / 2, hd: (size.z * s) / 2,
      h: spec.keepY ? box.max.y * s : size.y * s,
    };
  }

  _protoFromParts(list, castAll = true) {
    const parts = list.map(([geo, mat, cast = castAll]) => ({ geo, mat, local: new THREE.Matrix4(), cast }));
    const box = new THREE.Box3();
    for (const p of parts) {
      if (!p.geo.boundingBox) p.geo.computeBoundingBox();
      box.union(p.geo.boundingBox);
    }
    const size = box.getSize(new THREE.Vector3());
    return { parts, scale: 1, hw: Math.max(box.max.x, -box.min.x), hd: Math.max(box.max.z, -box.min.z), h: box.max.y, size };
  }

  /** Selbst gebaute Teile: Mühlenturm, Mühlenhaus, Bannerständer, Laternenlicht. */
  _buildProceduralProtos() {
    const mat = (color, rough = 0.9) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
      this.ownMaterials.push(m);
      return m;
    };
    const geo = (g) => { this.ownGeometries.push(g); return g; };
    const stone = mat(0xbdb3a2), roof = mat(0x7a3b2a), wood = mat(0x8a5a36), dark = mat(0x4b3020), plaster = mat(0xe6dcc4);

    // Laternen-Glaskörper (leuchtet nachts)
    this.protos.set('lantern-glow', this._protoFromParts([[geo(new THREE.BoxGeometry(0.24, 0.3, 0.24)), this.glowMat, false]]));

    // Windmühlen-Turm: Ursprung = Bodenmitte, Flügel sitzen vorne (+X)
    this.protos.set('windmill-tower', this._protoFromParts([
      [geo(new THREE.CylinderGeometry(1.7, 2.4, 8, 12).translate(0, 3, 0)), stone],          // y −1 … 7
      [geo(new THREE.ConeGeometry(2.15, 2.6, 12).translate(0, 8.3, 0)), roof],               // Dach
      [geo(new THREE.BoxGeometry(1.0, 0.9, 0.9).translate(2.0, 6.4, 0)), dark],             // Nabe
      [geo(new THREE.BoxGeometry(0.15, 1.8, 1.0).translate(-2.25, 0.9, 0)), dark],           // Tür
      [geo(new THREE.BoxGeometry(0.12, 0.7, 0.6).translate(1.95, 3.6, 0)), dark],            // Fenster
    ]));

    // Windkraftanlage: weisser Mast, Gondel vorne (+X), Rotor separat (dreht um X)
    const white = mat(0xf1f2f0, 0.6), grey = mat(0xc9ccd0, 0.6);
    this.protos.set('turbine-tower', this._protoFromParts([
      [geo(new THREE.CylinderGeometry(0.32, 0.6, 24, 12).translate(0, 11.5, 0)), white],     // y −0.5 … 23.5
      [geo(new THREE.BoxGeometry(3.2, 1.3, 1.3).translate(0.6, 24, 0)), white],               // Gondel
      [geo(new THREE.CylinderGeometry(1.6, 1.8, 0.4, 12).translate(0, 0, 0)), grey],          // Fundament
    ]));
    const blade = () => new THREE.BoxGeometry(0.18, 11, 0.7).translate(0, 5.6, 0);
    this.protos.set('turbine-rotor', this._protoFromParts([
      [geo(new THREE.SphereGeometry(0.75, 12, 8).scale(1.4, 1, 1)), white],
      [geo(blade()), white], [geo(blade().rotateX(TAU / 3)), white], [geo(blade().rotateX(-TAU / 3)), white],
    ]));

    // Mühlenhaus: 4.5 × 4 m, Wasserrad an der +X-Wand
    const roofGeo = new THREE.ConeGeometry(1, 1, 4, 1).rotateY(Math.PI / 4);
    roofGeo.scale((2.25 + 0.35) / Math.SQRT1_2, 1.9, (2.0 + 0.35) / Math.SQRT1_2).translate(0, 3 + 0.95, 0);
    this.protos.set('mill-hut', this._protoFromParts([
      [geo(new THREE.BoxGeometry(4.5, 4, 4).translate(0, 1, 0)), plaster],                  // y −1 … 3
      [geo(roofGeo), roof],
      [geo(new THREE.BoxGeometry(1.0, 1.9, 0.12).translate(0, 0.95, -2.03)), dark],          // Tür
      [geo(new THREE.CylinderGeometry(0.16, 0.16, 1.2, 8).rotateZ(Math.PI / 2).translate(2.8, 1.2, 0)), dark], // Achse
      [geo(new THREE.BoxGeometry(4.7, 0.25, 4.2).translate(0, 3, 0)), wood],                // Balken
    ]));

    // Bannerständer: zwei Pfosten + Querlatte, das Banner hängt dazwischen
    this.protos.set('banner-stand', this._protoFromParts([
      [geo(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6).translate(0, 1.6, -0.62)), wood],
      [geo(new THREE.CylinderGeometry(0.06, 0.07, 3.6, 6).translate(0, 1.6, 0.62)), wood],
      [geo(new THREE.BoxGeometry(0.1, 0.1, 1.5).translate(0, 3.15, 0)), wood],
    ]));
  }

  // ---------- Einträge (ein Eintrag pro Chunk) ----------

  _newEntry(key, cx, cz) {
    const group = new THREE.Group();
    group.name = `Deko ${key}`;
    return {
      key, cx, cz, group,
      inst: new Map(),     // Prototyp-Name → Matrix4[]
      obstacles: [],
      targets: [],         // zerstörbare Deko (combat.js)
      spots: [],           // belegte Kreise { x, z, r } (nur zum Platzieren)
      anims: [], fires: [], lamps: [], campfires: [],
    };
  }

  _finishEntry(e) {
    // Statische Teile → pro Prototyp-Teil eine InstancedMesh
    const imsOf = new Map();
    for (const [name, mats] of e.inst) {
      const proto = this.protos.get(name);
      const ims = [];
      for (const part of proto.parts) {
        const im = new THREE.InstancedMesh(part.geo, part.mat, mats.length);
        for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, _m2.multiplyMatrices(mats[i], part.local));
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.castShadow = part.cast;
        im.receiveShadow = true;
        e.group.add(im);
        ims.push({ im, local: part.local });
      }
      imsOf.set(name, ims);
    }
    // Zerstörbare Deko mit ihren Instanzen verbinden; früher Zerstörtes bleibt weg
    for (const t of e.targets) {
      t.ims = imsOf.get(t.proto) ?? [];
      t.base = e.inst.get(t.proto)?.[t.idx];
      t.maxHp = t.hp;
      t.destroy = () => this.destroyTarget(e, t);
      if (this.destroyed.has(`${e.key}:${t.n}`)) this.destroyTarget(e, t, true);
    }
    e.inst = null;
    e.spots = null;
    this.scene.add(e.group);
  }

  /** Deko zerstören: alle Instanz-Teile unsichtbar, Hindernis weg. Gibt die Beute zurück. */
  destroyTarget(e, t, silent = false) {
    t.dead = true;
    for (const { im } of t.ims) { im.setMatrixAt(t.idx, ZERO_M); im.instanceMatrix.needsUpdate = true; }
    if (t.obstacle) {
      const i = e.obstacles.indexOf(t.obstacle);
      if (i >= 0) e.obstacles.splice(i, 1);
    }
    this.destroyed.add(`${e.key}:${t.n}`);
    return silent ? [] : t.drops;
  }

  /** Zerstörbare Deko in der Nähe (Startdorf + 3×3 Chunks). */
  *targetsNear(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE), cz = Math.floor(z / CHUNK_SIZE);
    const lists = [this.start];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) lists.push(this.grid.get(this._gridKey(cx + dx, cz + dz)));
    for (const e of lists) {
      if (!e?.targets) continue;
      for (const t of e.targets) {
        if (t.dead || !t.ims) continue;
        const ex = t.x - x, ez = t.z - z;
        if (ex * ex + ez * ez < 49) yield t;
      }
    }
  }

  _disposeEntry(e) {
    this.scene.remove(e.group);
    // Geometrien/Materialien sind geteilt → nur Instanz-Puffer freigeben
    e.group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
  }

  _gridKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

  _rebuildLists() {
    this.anims.length = 0; this.fires.length = 0; this.lamps.length = 0; this._campfires.length = 0;
    const add = (e) => {
      for (const a of e.anims) this.anims.push(a);
      for (const f of e.fires) this.fires.push(f);
      for (const l of e.lamps) this.lamps.push(l);
      for (const c of e.campfires) this._campfires.push(c);
    };
    if (this.start) add(this.start);
    for (const e of this.entries.values()) add(e);
    this._pickTimer = 0;
  }

  // ---------- Platzieren ----------

  /** Bodenhöhe unter einem Objekt (tiefste Ecke, damit nichts schwebt). */
  _ground(x, z, hw, hd, rot) {
    const t = this.terrain;
    let h = t.height(x, z);
    if (hw > 0.45 || hd > 0.45) {
      const c = Math.cos(rot), s = Math.sin(rot);
      for (let sx = -1; sx <= 1; sx += 2) for (let sz = -1; sz <= 1; sz += 2) {
        const lx = sx * hw, lz = sz * hd;
        h = Math.min(h, t.height(x + lx * c + lz * s, z - lx * s + lz * c));
      }
    }
    return h - 0.03;
  }

  /**
   * Objekt platzieren. opt: y, scale, rx, rz, dynamic (eigenes Object3D statt Instanz),
   * solid ('circle' | 'obb'), shrink, r, top, noSpot.
   * Liefert die Bodenhöhe (statisch) oder das Object3D (dynamic).
   */
  _add(e, name, x, z, rot = 0, opt = {}) {
    const p = this.protos.get(name);
    const sc = opt.scale ?? 1;
    const y = opt.y ?? this._ground(x, z, p.hw * sc, p.hd * sc, rot);
    let out = y;
    if (opt.dynamic) {
      const obj = this._instantiate(p);
      obj.position.set(x, y, z);
      obj.rotation.order = 'YXZ';   // erst Gieren, dann Drehung/Kippen um die eigene Achse
      obj.rotation.set(opt.rx ?? 0, rot, opt.rz ?? 0);
      obj.scale.setScalar(sc);
      e.group.add(obj);
      out = obj;
    } else {
      _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(opt.rx ?? 0, rot, opt.rz ?? 0)), _s.setScalar(sc));
      let list = e.inst.get(name);
      if (!list) e.inst.set(name, (list = []));
      list.push(_m.clone());
    }
    const shrink = opt.shrink ?? 1;
    let ob = null;
    if (opt.solid) {
      const top = opt.top ?? (p.h * sc > 1.2 ? Infinity : y + p.h * sc);
      if (opt.solid === 'circle') {
        ob = { type: 'circle', x, z, r: opt.r ?? Math.max(p.hw, p.hd) * sc * shrink, top };
      } else {
        ob = { type: 'obb', x, z, cos: Math.cos(rot), sin: Math.sin(rot), hw: p.hw * sc * shrink, hd: p.hd * sc * shrink, top };
      }
      e.obstacles.push(ob);
    }
    // Zerstörbar? (nur statische, instanzierte Teile)
    const d = DESTRUCT[name];
    if (d && !opt.dynamic && e.targets) {
      e.targets.push({ proto: name, idx: e.inst.get(name).length - 1, n: e.targets.length, material: d[0], name: d[1], hp: d[2],
        drops: d[3], x, z, y, r: Math.max(p.hw, p.hd) * sc, height: p.h * sc, obstacle: ob });
    }
    if (!opt.noSpot && e.spots) e.spots.push({ x, z, r: opt.spotR ?? Math.max(p.hw, p.hd) * sc * 0.9 });
    return out;
  }

  /** Dynamisches Objekt: Gruppe aus Meshes, die Geometrie und Material teilen. */
  _instantiate(proto) {
    const g = new THREE.Group();
    for (const part of proto.parts) {
      const mesh = new THREE.Mesh(part.geo, part.mat);
      part.local.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.castShadow = part.cast;
      mesh.receiveShadow = true;
      g.add(mesh);
    }
    return g;
  }

  /** Ist der Kreis (x, z, r) frei? Prüft eigene Deko, Häuser (mit Abstand), Bäume, Felsen. */
  _free(e, x, z, r, clear = HOUSE_CLEAR) {
    for (const s of e.spots) {
      const dx = x - s.x, dz = z - s.z, rr = r + s.r + 0.25;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    for (const o of this.chunks.obstaclesNear(x, z)) {
      const dx = x - o.x, dz = z - o.z;
      if (o.type === 'circle') {
        const rr = o.r + r + 0.4;
        if (dx * dx + dz * dz < rr * rr) return false;
      } else {
        const lx = dx * o.cos - dz * o.sin, lz = dx * o.sin + dz * o.cos;
        const ex = Math.max(Math.abs(lx) - o.hw, 0), ez = Math.max(Math.abs(lz) - o.hd, 0);
        if (ex * ex + ez * ez < (r + clear) ** 2) return false;
      }
    }
    return true;
  }

  _slope(x, z) { return 1 - this.terrain.normal(x, z).y; }

  /** Lagerfeuer mit Flammen, Licht und optional Sitzbalken rundherum. */
  _campfire(e, x, z, rand, { stand = false, seats = 0, seatName = 'tree-log' } = {}) {
    const y = this._add(e, 'campfire-pit', x, z, rand() * TAU, { solid: 'circle', r: 0.6, spotR: 0.9 });
    e.obstacles[e.obstacles.length - 1].top = y + 0.4;
    if (stand) this._add(e, 'campfire-stand', x, z, rand() * TAU, { noSpot: true, y });
    // Flammen: 2 äussere + 1 innerer Kegel
    const flame = new THREE.Group();
    flame.position.set(x, y + 0.08, z);
    const specs = [[this.flameGeoOuter, this.flameOuter, 0.1, 0], [this.flameGeoOuter, this.flameOuter, -0.08, 0.07], [this.flameGeoInner, this.flameInner, 0, -0.02]];
    for (const [g, m, ox, oz] of specs) {
      const mesh = new THREE.Mesh(g, m);
      mesh.position.set(ox, 0, oz);
      flame.add(mesh);
    }
    e.group.add(flame);
    e.anims.push({ kind: A_FLAME, obj: flame, ph: rand() * 10, base: 0, speed: 0 });
    e.fires.push({ pos: new THREE.Vector3(x, y + 0.6, z), ph: rand() * 10 });
    e.campfires.push(new THREE.Vector3(x, y + 0.03, z));
    // Sitzbalken / Bänke tangential im Kreis
    const a0 = rand() * TAU;
    for (let i = 0; i < seats; i++) {
      const a = a0 + (i / seats) * TAU + (rand() - 0.5) * 0.4;
      const r = seatName === 'tree-log' ? 2.1 : 1.9;
      const sx = x + Math.cos(a) * r, sz = z + Math.sin(a) * r;
      if (!this._free(e, sx, sz, 0.9, HOUSE_CLEAR)) continue;
      this._add(e, seatName, sx, sz, -a, { solid: 'obb', shrink: 0.9, spotR: 1.0 });
    }
    return y;
  }

  /** Moderne Strassenlaterne; der Arm zeigt in Richtung `armDir` (Winkel in der XZ-Ebene, 0 = +X). */
  _lantern(e, x, z, armDir = 0) {
    // Kenney-Laterne: Mast im Ursprung, Arm entlang −Z → Drehung so, dass −Z nach armDir zeigt
    const rot = Math.atan2(-Math.cos(armDir), -Math.sin(armDir));
    const y = this._add(e, 'streetlight', x, z, rot, { solid: 'circle', r: 0.15, top: Infinity, spotR: 0.4 });
    const hx = x + Math.cos(armDir) * 1.45, hz = z + Math.sin(armDir) * 1.45;
    this._add(e, 'lantern-glow', hx, hz, 0, { y: y + 5.0, noSpot: true, scale: 0.8 });
    e.lamps.push(new THREE.Vector3(hx, y + 4.9, hz));
  }

  /** Geparktes Auto (Deko, nicht fahrbar). */
  _parkedCar(e, x, z, rot, rand) {
    const cars = ['car-sedan', 'car-suv', 'car-hatch', 'car-taxi', 'car-van', 'car-sedan', 'car-suv', 'car-police'];
    this._add(e, cars[Math.floor(rand() * cars.length)], x, z, rot, { solid: 'obb', shrink: 0.95, top: Infinity, spotR: 2.4 });
  }

  _banner(e, x, z, rot, red) {
    const y = this._add(e, 'banner-stand', x, z, rot, { solid: 'circle', r: 0.2, top: Infinity, spotR: 0.8 });
    // Banner-Tuch: Unterkante 1.2 m über dem Boden, hängt an der Querlatte
    this._add(e, red ? 'banner-red' : 'banner-green', x, z, rot, { y: y + 1.3, noSpot: true });
  }

  // ---------- Startdorf (Blender-Modell am Ursprung) ----------
  // Häuser bei z −4 … −21, Weg x −1.5 … 1.5, Zäune x ±1.7 (z −2 … 6), Baum bei (−2.1, 3.6),
  // Büsche/Steine bis z ≈ 5.5 → freie Flächen: x 3 … 6 / −3 … −6, z 6 … 16.
  _buildStartVillage(e) {
    const rand = mulberry32(hash2(0, 0, this.seed ^ 0xdec5));
    // Lagerfeuer links vom Weg mit zwei Sitzbalken
    this._campfire(e, -4.6, 10.6, rand, { stand: true, seats: 0 });
    this._add(e, 'tree-log', -4.6, 8.6, Math.PI / 2, { solid: 'obb', shrink: 0.9 });
    this._add(e, 'tree-log', -6.6, 10.9, 0, { solid: 'obb', shrink: 0.9 });
    this._add(e, 'resource-wood', -6.3, 13.4, 0.4, {});
    // Marktstand rechts vom Weg, Front zum Weg (−X)
    this._add(e, 'stall-red', 4.8, 11.0, -Math.PI / 2, { solid: 'obb', shrink: 0.85 });
    this._add(e, 'stall-stool', 3.0, 11.8, 0.3, {});
    this._add(e, 'barrel', 3.8, 13.5, 0.2, { solid: 'circle' });
    this._add(e, 'barrel-open', 4.5, 14.1, 1.1, { solid: 'circle' });
    this._add(e, 'barrel', 5.9, 13.7, 2.0, { solid: 'circle' });
    this._add(e, 'box-large', 5.3, 8.6, 0.3, { solid: 'obb' });
    this._add(e, 'box', 5.3, 8.6, 0.9, { y: this.terrain.height(5.3, 8.6) + 0.57, noSpot: true });   // gestapelt
    // Laternen beidseits des Weges
    this._lantern(e, 2.6, 6.4, Math.PI);
    this._lantern(e, -2.6, 6.9, 0);
    this._lantern(e, 2.6, 15.6, Math.PI);
    this._lantern(e, -2.6, 16.2, 0);
    this._lantern(e, 2.6, -3.0, Math.PI);
    this._lantern(e, -2.6, -11.0, 0);
    this._lantern(e, 2.6, -19.0, Math.PI);
    // Abfallcontainer und Pflanzkübel
    this._add(e, 'dumpster', 3.4, 1.8, Math.PI / 2, { solid: 'obb' });
    this._add(e, 'planter', -3.6, 4.0, 0, { solid: 'obb' });
  }

  // ---------- Generierte Dörfer ----------

  _buildVillage(e, v, rand) {
    const cx = v.x + (rand() - 0.5) * 1.5, cz = v.z + (rand() - 0.5) * 1.5;

    // Mitte: Brunnen oder Lagerfeuer mit Bänken
    if (rand() < 0.5) {
      if (this._free(e, cx, cz, 1.8)) this._add(e, 'fountain', cx, cz, rand() * TAU, { solid: 'circle', shrink: 0.98, spotR: 1.8 });
    } else if (this._free(e, cx, cz, 1.5)) {
      // Strassencafé: Sonnenschirm mit Bänken
      this._add(e, rand() < 0.5 ? 'parasol' : 'parasol-b', cx, cz, rand() * TAU, { solid: 'circle', r: 0.6, top: Infinity, spotR: 1.6 });
      for (let i = 0; i < 2; i++) {
        const ang = rand() * TAU + i * Math.PI;
        this._add(e, 'stall-bench', cx + Math.cos(ang) * 1.9, cz + Math.sin(ang) * 1.9, -ang, { solid: 'obb', shrink: 0.9, spotR: 1.0 });
      }
    }

    // Marktstände im Kreis um die Mitte, Front zur Mitte
    const stallNames = ['stall-red', 'stall-green', 'stall'];
    const nStalls = 2 + (rand() < 0.5 ? 1 : 0);
    const a0 = rand() * TAU;
    for (let i = 0; i < nStalls; i++) {
      const name = stallNames[(i + Math.floor(rand() * 3)) % 3];
      for (let t = 0; t < 12; t++) {
        const a = a0 + (i / nStalls) * TAU + (t ? (rand() - 0.5) * (1.2 + t * 0.15) : 0);
        const r = 4.2 + (t % 4) * 0.6;
        const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (!this._free(e, x, z, 1.7)) continue;
        this._add(e, name, x, z, Math.atan2(cx - x, cz - z), { solid: 'obb', shrink: 0.85, spotR: 1.75 });
        // Zubehör: Hocker vor dem Stand, Fässer/Kisten daneben
        const dx = (cx - x) / r, dz = (cz - z) / r, tx = -dz, tz = dx;
        const extras = [
          ['stall-stool', 1.9, 0.6, null],
          [rand() < 0.5 ? 'barrel' : 'barrel-open', 0.2, 1.95, 'circle'],
          [rand() < 0.5 ? 'box' : 'box-large', 0.0, -1.95, 'obb'],
          ['box', -0.9, -1.9, null],
        ];
        for (const [n, f, s, solid] of extras) {
          const px = x + dx * f + tx * s, pz = z + dz * f + tz * s;
          if (this._free(e, px, pz, 0.35)) this._add(e, n, px, pz, rand() * TAU, solid ? { solid } : {});
        }
        break;
      }
    }

    // Geparkte Autos am äusseren Strassenrand (Ringstrasse r = 12, 5 m breit)
    const spokes = v.spokes ?? [];
    const angDiff = (p, q) => Math.abs(Math.atan2(Math.sin(p - q), Math.cos(p - q)));
    const nCars = 2 + Math.floor(rand() * 3);
    for (let i = 0, placed = 0; i < 20 && placed < nCars; i++) {
      const a = rand() * TAU;
      if (spokes.some((sa) => angDiff(sa, a) < 0.45)) continue;
      const r = 13.6, x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (!this._free(e, x, z, 1.2, 0.3)) continue;
      this._parkedCar(e, x, z, -a + (rand() < 0.5 ? 0 : Math.PI), rand);   // tangential zur Strasse
      placed++;
    }

    // Ampeln und Strassenschilder an den Einmündungen der Ausfallstrassen
    for (const sa of spokes) {
      const tx = -Math.sin(sa), tz = Math.cos(sa);
      const bx = v.x + Math.cos(sa) * 15.5, bz = v.z + Math.sin(sa) * 15.5;
      const lx = bx + tx * 3.3, lz = bz + tz * 3.3;
      if (this._free(e, lx, lz, 0.3, 0.5)) this._add(e, 'traffic-light', lx, lz, Math.atan2(Math.cos(sa), Math.sin(sa)) + Math.PI, { solid: 'circle', r: 0.15, top: Infinity, spotR: 0.4 });
      const sx = bx - tx * 3.3, sz = bz - tz * 3.3;
      if (this._free(e, sx, sz, 0.3, 0.5)) this._add(e, 'street-sign', sx, sz, -sa, { solid: 'circle', r: 0.1, top: Infinity, spotR: 0.4 });
      // am Ende der Strasse: Stoppschild
      const ex = v.x + Math.cos(sa) * 33 + tx * 3.2, ez = v.z + Math.sin(sa) * 33 + tz * 3.2;
      if (this.terrain.height(ex, ez) > SEA_LEVEL + 0.5 && this._free(e, ex, ez, 0.3, 0.5)) this._add(e, 'stop-sign', ex, ez, -sa, { solid: 'circle', r: 0.1, top: Infinity, spotR: 0.4 });
    }

    // Strassenlaternen am Platzrand, Arm über die Ringstrasse
    const nLamps = 5 + Math.floor(rand() * 3);
    const l0 = rand() * TAU;
    for (let i = 0; i < nLamps; i++) {
      const a = l0 + (i / nLamps) * TAU;
      if (spokes.some((sa) => angDiff(sa, a) < 0.25)) continue;
      const x = v.x + Math.cos(a) * 9.0, z = v.z + Math.sin(a) * 9.0;
      if (!this._free(e, x, z, 0.3, 0.5)) continue;
      this._lantern(e, x, z, a);
    }

    // Abfallcontainer und Pflanzkübel zwischen den Häusern
    for (let i = 0, placed = 0; i < 12 && placed < 3; i++) {
      const a = rand() * TAU, r = 16.5 + rand() * 2;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (spokes.some((sa) => angDiff(sa, a) < 0.3) || !this._free(e, x, z, 0.9, 0.8)) continue;
      this._add(e, rand() < 0.5 ? 'dumpster' : 'planter', x, z, -a, { solid: 'obb' });
      placed++;
    }
  }

  // ---------- Wildnis ----------

  _nearVillage(x, z, cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const v = this.chunks.villageAt(cx + dx, cz + dz);
      if (v && Math.hypot(x - v.x, z - v.z) < VILLAGE_KEEP_OUT) return true;
    }
    return false;
  }

  /** Zufällige Stelle im Chunk (4 m Rand), die test() erfüllt, sonst null. */
  _pick(e, rand, tries, test) {
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cz * CHUNK_SIZE;
    for (let i = 0; i < tries; i++) {
      const x = x0 + 4 + rand() * (CHUNK_SIZE - 8), z = z0 + 4 + rand() * (CHUNK_SIZE - 8);
      if (Math.hypot(x, z) < START_CLEAR || this._nearVillage(x, z, e.cx, e.cz)) continue;
      const h = this.terrain.height(x, z);
      if (test(x, z, h)) return { x, z, h };
    }
    return null;
  }

  _buildWilderness(e, rand) {
    const t = this.terrain;
    const mx = (e.cx + 0.5) * CHUNK_SIZE, mz = (e.cz + 0.5) * CHUNK_SIZE;

    // Lager im Wald
    if (t.forest(mx, mz) > 0.3 && rand() < 0.22) {
      const s = this._pick(e, rand, 16, (x, z, h) => t.forest(x, z) > 0.3 && h > SEA_LEVEL + 2 && h < 32 &&
        this._slope(x, z) < 0.12 && this._free(e, x, z, 5.0, 1));
      if (s) this._camp(e, s.x, s.z, rand);
    }

    // Wiese: Karren, Rad, Wegweiser
    if (rand() < 0.16) {
      const s = this._pick(e, rand, 12, (x, z, h) => t.forest(x, z) < 0.2 && h > SEA_LEVEL + 1.5 && h < 30 &&
        this._slope(x, z) < 0.15 && this._free(e, x, z, 3.0, 1));
      if (s) this._meadowProps(e, s.x, s.z, rand);
    }

    // Baumstämme am Waldrand
    if (rand() < 0.35) {
      const n = 1 + (rand() < 0.4 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const s = this._pick(e, rand, 8, (x, z, h) => t.forest(x, z) > 0.15 && h > SEA_LEVEL + 1 &&
          this._slope(x, z) < 0.22 && this._free(e, x, z, 1.6, 1));
        if (s) this._add(e, 'tree-log', s.x, s.z, rand() * TAU, { solid: 'obb', shrink: 0.9 });
      }
    }

    // Windkraftanlage auf einer offenen Hügelkuppe
    if (rand() < 0.2) {
      const s = this._pick(e, rand, 24, (x, z, h) => {
        if (h < 8 || h > 25 || t.forest(x, z) > 0.25 || this._slope(x, z) > 0.12) return false;
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * TAU;
          if (t.height(x + Math.cos(a) * 10, z + Math.sin(a) * 10) > h + 0.5) return false;   // Kuppe
        }
        return this._free(e, x, z, 6, 1);
      });
      if (s) this._windmill(e, s.x, s.z, rand);
    }

    // Ufer: Wassermühle oder Ruderboote mit Bojen
    if (rand() < 0.25) {
      let dir = -1;
      const s = this._pick(e, rand, 24, (x, z, h) => {
        dir = -1;
        if (h < SEA_LEVEL + 0.3 || h > SEA_LEVEL + 1.6 || this._slope(x, z) > 0.2) return false;
        const a0 = rand() * TAU;
        for (let i = 0; i < 8; i++) {
          const a = a0 + (i / 8) * TAU;
          if (t.height(x + Math.cos(a) * 7, z + Math.sin(a) * 7) < SEA_LEVEL - 0.6) { dir = a; break; }
        }
        return dir >= 0 && this._free(e, x, z, 3.5, 1);
      });
      if (s) {
        if (rand() < 0.35) this._watermill(e, s.x, s.z, dir, rand);
        else this._shoreBoats(e, s.x, s.z, dir, rand);
      }
    }

    // Boote auf offenem Wasser
    if (rand() < 0.3) {
      const n = 1 + (rand() < 0.3 ? 1 : 0);
      const names = ['boat-sail-a', 'boat-sail-b', 'boat-fishing-small', 'boat-row-large', 'boat-row-small'];
      for (let i = 0; i < n; i++) {
        const s = this._pick(e, rand, 10, (x, z, h) => {
          if (h > SEA_LEVEL - 2.5) return false;
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * TAU;
            if (t.height(x + Math.cos(a) * 6, z + Math.sin(a) * 6) > SEA_LEVEL - 1) return false;
          }
          return this._free(e, x, z, 4, 0);
        });
        if (s) this._floating(e, names[Math.floor(rand() * names.length)], s.x, s.z, rand() * TAU, rand);
      }
    }
  }

  _camp(e, x, z, rand) {
    this._campfire(e, x, z, rand, { stand: rand() < 0.5, seats: 0 });
    const a = rand() * TAU;
    const at = (ang, r) => [x + Math.cos(a + ang) * r, z + Math.sin(a + ang) * r];
    // Zelt mit Öffnung zum Feuer
    let [px, pz] = at(0, 3.4);
    this._add(e, rand() < 0.5 ? 'tent' : 'tent-canvas', px, pz, Math.atan2(x - px, z - pz), { solid: 'obb', shrink: 0.9 });
    // Schlafsack, Sitzbalken
    [px, pz] = at(2.1, 2.2);
    this._add(e, 'bedroll', px, pz, -(a + 2.1), {});
    [px, pz] = at(-2.0, 2.1);
    this._add(e, 'tree-log', px, pz, -(a - 2.0), { solid: 'obb', shrink: 0.9 });
    // Holzstapel, Steine, Werkzeug
    [px, pz] = at(Math.PI, 3.0);
    this._add(e, 'resource-wood', px, pz, rand() * TAU, {});
    this._add(e, 'resource-wood', px + 0.3, pz + 0.2, rand() * TAU, { y: this.terrain.height(px, pz) + 0.22, noSpot: true });
    [px, pz] = at(Math.PI + 0.7, 3.2);
    this._add(e, 'resource-stone', px, pz, rand() * TAU, {});
    [px, pz] = at(0.9, 3.0);
    this._add(e, rand() < 0.5 ? 'axe' : 'pickaxe', px, pz, rand() * TAU, {});
    [px, pz] = at(-0.8, 3.3);
    if (rand() < 0.5) this._add(e, 'chest', px, pz, Math.atan2(x - px, z - pz), { solid: 'obb' });
    else this._add(e, 'bucket', px, pz, 0, {});
    if (rand() < 0.4) {
      [px, pz] = at(Math.PI - 0.8, 3.6);
      this._add(e, rand() < 0.5 ? 'workbench' : 'anvil', px, pz, Math.atan2(x - px, z - pz), { solid: 'obb' });
      this._add(e, 'resource-planks', px + 1.2, pz - 0.6, rand() * TAU, {});
    }
    if (rand() < 0.5) {
      [px, pz] = at(1.4, 2.9);
      this._add(e, rand() < 0.5 ? 'shovel' : 'hammer', px, pz, rand() * TAU, {});
    }
  }

  _meadowProps(e, x, z, rand) {
    const roll = rand();
    if (roll < 0.45) {
      // abgestelltes Auto (Ausflügler), manchmal mit Abfallcontainer
      const rot = rand() * TAU;
      this._parkedCar(e, x, z, rot, rand);
      if (rand() < 0.4) this._add(e, 'dumpster', x - Math.cos(rot) * 2.6, z + Math.sin(rot) * 2.6, rot, { solid: 'obb' });
    } else if (roll < 0.75) {
      this._add(e, 'street-sign', x, z, rand() * TAU, { solid: 'circle', r: 0.1, top: Infinity });
    } else {
      // Baustelle: Absperrung und Pylonen
      const rot = rand() * TAU;
      this._add(e, 'barrier', x, z, rot, { solid: 'obb' });
      for (let i = 0; i < 3; i++) this._add(e, 'cone', x + Math.cos(rot) * (1.4 + i * 0.7), z - Math.sin(rot) * (1.4 + i * 0.7), rand() * TAU, {});
      this._add(e, 'resource-planks', x - Math.cos(rot) * 1.6, z + Math.sin(rot) * 1.6, rand() * TAU, {});
    }
  }

  _windmill(e, x, z, rand) {
    const rot = rand() * TAU;
    // modern: Windkraftanlage statt Windmühle
    const ty = this._add(e, 'turbine-tower', x, z, rot, { solid: 'circle', r: 0.7, top: Infinity, spotR: 2.5 });
    const rx = x + Math.cos(rot) * 2.4, rz = z - Math.sin(rot) * 2.4;
    const rotor = this._add(e, 'turbine-rotor', rx, rz, rot, { dynamic: true, y: ty + 24, noSpot: true });
    e.anims.push({ kind: A_ROTOR, obj: rotor, ph: 0, base: 0, speed: 0.6 + rand() * 0.4 });
  }

  _watermill(e, x, z, dir, rand) {
    // Hütte etwas landeinwärts, lokale +X-Achse zeigt zum Wasser
    const dx = Math.cos(dir), dz = Math.sin(dir);
    const rot = Math.atan2(-dz, dx);
    const hx = x - dx * 1.0, hz = z - dz * 1.0;
    const y = this._add(e, 'mill-hut', hx, hz, rot, { solid: 'obb', top: Infinity, spotR: 3.2 });
    const wx = hx + dx * 3.3, wz = hz + dz * 3.3;
    const wheelY = Math.max(SEA_LEVEL + 0.9, y + 1.2);
    const wheel = this._add(e, 'mill-wheel', wx, wz, rot, { dynamic: true, y: wheelY, noSpot: true });
    e.obstacles.push({ type: 'obb', x: wx, z: wz, cos: Math.cos(rot), sin: Math.sin(rot), hw: 1.0, hd: 2.0, top: Infinity });
    e.anims.push({ kind: A_WHEEL, obj: wheel, ph: 0, base: 0, speed: -0.6 - rand() * 0.3 });
    // Säcke/Kisten vor der Tür (−Z lokal)
    const doorX = hx + Math.sin(rot) * -2.9, doorZ = hz + Math.cos(rot) * -2.9;
    if (this.terrain.height(doorX, doorZ) > SEA_LEVEL + 0.3) {
      this._add(e, 'box', doorX + 0.9, doorZ, rand() * TAU, {});
      this._add(e, 'barrel', doorX - 0.9, doorZ, rand() * TAU, { solid: 'circle' });
    }
  }

  _shoreBoats(e, x, z, dir, rand) {
    const t = this.terrain;
    const dx = Math.cos(dir), dz = Math.sin(dir);
    // Ruderboote im seichten Wasser, parallel zum Ufer
    const n = 1 + (rand() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = (i - (n - 1) / 2) * 3.4;
      for (const d of [5, 6.5, 8]) {
        const bx = x + dx * d - dz * side, bz = z + dz * d + dx * side;
        if (t.height(bx, bz) > SEA_LEVEL - 0.35) continue;
        const name = rand() < 0.6 ? 'boat-row-small' : 'boat-row-large';
        this._floating(e, name, bx, bz, Math.atan2(-dz, dx) + (rand() - 0.5) * 0.4, rand);
        break;
      }
    }
    // Bojen weiter draussen
    const nb = 1 + Math.floor(rand() * 2);
    for (let i = 0; i < nb; i++) {
      const d = 11 + rand() * 6, s = (rand() - 0.5) * 10;
      const bx = x + dx * d - dz * s, bz = z + dz * d + dx * s;
      if (t.height(bx, bz) > SEA_LEVEL - 0.8) continue;
      const obj = this._add(e, rand() < 0.5 ? 'buoy' : 'buoy-flag', bx, bz, rand() * TAU, { dynamic: true, y: SEA_LEVEL, noSpot: true });
      e.anims.push({ kind: A_FLOAT, obj, ph: rand() * 10, base: SEA_LEVEL, speed: 1.3 });
    }
    // Am Ufer: Fass, Kiste mit Fisch
    this._add(e, 'barrel', x - dz * 1.2, z + dx * 1.2, rand() * TAU, { solid: 'circle' });
    const y = this._add(e, 'box', x + dz * 1.0, z - dx * 1.0, rand() * TAU, {});
    this._add(e, rand() < 0.5 ? 'fish' : 'fish-large', x + dz * 1.0, z - dx * 1.0, rand() * TAU, { y: y + 0.6, noSpot: true });
  }

  /** Schwimmendes Boot, wippt auf der Wasseroberfläche. */
  _floating(e, name, x, z, rot, rand) {
    const base = SEA_LEVEL - (BOAT_SINK[name] ?? 0.2);
    const obj = this._add(e, name, x, z, rot, { dynamic: true, y: base, spotR: 3 });
    const p = this.protos.get(name);
    e.obstacles.push({ type: 'obb', x, z, cos: Math.cos(rot), sin: Math.sin(rot), hw: p.hw * 0.6, hd: p.hd * 0.9, top: Infinity });
    e.anims.push({ kind: A_FLOAT, obj, ph: rand() * 10, base, speed: 0.8 + rand() * 0.4 });
  }

  _buildChunk(key, chunk) {
    const e = this._newEntry(key, chunk.cx, chunk.cz);
    const v = this.chunks.villageAt(chunk.cx, chunk.cz);
    if (v) this._buildVillage(e, v, mulberry32(hash2(chunk.cx, chunk.cz, this.seed ^ 0xdec0)));
    else this._buildWilderness(e, mulberry32(hash2(chunk.cx, chunk.cz, this.seed ^ 0xdec1)));
    this._finishEntry(e);
    return e;
  }

  // ---------- Laufzeit ----------

  /** Mit geladenen Chunks abgleichen: neue Deko bauen (wenn alle Nachbarn da sind), ferne entfernen. */
  _sync() {
    const cm = this.chunks;
    let built = 0, pending = false, changed = false;
    for (const [key, chunk] of cm.chunks) {
      if (this.entries.has(key)) continue;
      // erst bauen, wenn die 8 Nachbarn geladen sind → Bäume ringsum bekannt, Ergebnis deterministisch
      let ok = true;
      for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!cm.chunks.has(cm.key(chunk.cx + dx, chunk.cz + dz))) { ok = false; break; }
      }
      if (!ok) continue;
      if (built >= BUILD_PER_FRAME) { pending = true; break; }
      const e = this._buildChunk(key, chunk);
      this.entries.set(key, e);
      this.grid.set(this._gridKey(chunk.cx, chunk.cz), e);
      built++; changed = true;
    }
    for (const [key, e] of this.entries) {
      if (cm.chunks.has(key)) continue;
      this._disposeEntry(e);
      this.entries.delete(key);
      this.grid.delete(this._gridKey(e.cx, e.cz));
      changed = true;
    }
    if (changed) this._rebuildLists();
    return pending;
  }

  /**
   * Jeden Frame aufrufen. night: 0 = Tag … 1 = Nacht.
   */
  update(dt, playerPos, night = 0) {
    this.time += dt;
    const time = this.time;

    // Abgleich nur bei Änderung der Chunk-Anzahl oder alle 0.3 s
    this._syncTimer -= dt;
    const n = this.chunks.chunks.size;
    if (n !== this._lastChunkCount || this._syncTimer <= 0) {
      this._lastChunkCount = n;
      this._syncTimer = this._sync() ? 0 : 0.3;
    }

    // Animationen
    for (let i = 0; i < this.anims.length; i++) {
      const a = this.anims[i];
      const o = a.obj;
      switch (a.kind) {
        case A_ROTOR:
        case A_WHEEL:
          o.rotation.x += dt * a.speed;
          break;
        case A_FLOAT:
          o.position.y = a.base + Math.sin(time * a.speed + a.ph) * 0.07;
          o.rotation.x = Math.sin(time * 0.9 * a.speed + a.ph) * 0.035;
          o.rotation.z = Math.sin(time * 0.7 * a.speed + a.ph * 1.3) * 0.045;
          break;
        case A_FLAME: {
          const c = o.children;
          for (let k = 0; k < c.length; k++) {
            const f = time * (8 + k * 1.7) + a.ph + k * 2.1;
            const sy = 0.8 + 0.25 * Math.sin(f) + 0.12 * Math.sin(f * 2.3);
            const sxz = 0.9 + 0.1 * Math.sin(f * 1.7);
            c[k].scale.set(sxz, sy, sxz);
            c[k].rotation.y = f * 0.3;
          }
          break;
        }
      }
    }

    // Nächste Lichtquellen wählen (nicht jeden Frame)
    this._pickTimer -= dt;
    if (this._pickTimer <= 0) {
      this._pickTimer = LIGHT_PICK_INTERVAL;
      this._fireN = nearest(this.fires, true, playerPos, this._fireIdx, this._fireD);
      this._lampN = nearest(this.lamps, false, playerPos, this._lampIdx, this._lampD);
    }

    // Lagerfeuer: immer an, nachts heller, flackernd
    for (let i = 0; i < FIRE_LIGHTS; i++) {
      const l = this.fireLights[i];
      if (i >= this._fireN) { l.intensity = 0; continue; }
      const f = this.fires[this._fireIdx[i]];
      const fl = 0.82 + 0.12 * Math.sin(time * 13 + f.ph) * Math.sin(time * 7.3 + f.ph * 2) + 0.06 * Math.sin(time * 23 + f.ph);
      l.position.set(f.pos.x + Math.sin(time * 9 + f.ph) * 0.05, f.pos.y, f.pos.z + Math.cos(time * 11 + f.ph) * 0.05);
      l.intensity = (4 + 26 * night) * fl;
    }
    // Laternen: nur nachts
    for (let i = 0; i < LAMP_LIGHTS; i++) {
      const l = this.lampLights[i];
      if (i >= this._lampN || night <= 0.01) { l.intensity = 0; continue; }
      l.position.copy(this.lamps[this._lampIdx[i]]);
      l.intensity = 12 * night;
    }
    this.glowMat.emissiveIntensity = night * 3;
  }

  /** Hindernisse (gleiches Format wie chunks.js) aus dem Chunk am Punkt und den 8 Nachbarn. */
  *obstaclesNear(x, z) {
    if (this.start && x * x + z * z < START_CLEAR * START_CLEAR) yield* this.start.obstacles;
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const e = this.grid.get(this._gridKey(pcx + dx, pcz + dz));
      if (e) yield* e.obstacles;
    }
  }

  /** Alles entfernen (z. B. beim Neustart mit anderem Seed). */
  dispose() {
    for (const e of this.entries.values()) this._disposeEntry(e);
    if (this.start) this._disposeEntry(this.start);
    this.entries.clear(); this.grid.clear(); this.start = null;
    for (const l of [...this.fireLights, ...this.lampLights]) this.scene.remove(l);
    this.ownMaterials.forEach((m) => m.dispose());
    this.ownGeometries.forEach((g) => g.dispose());
    this._rebuildLists();
  }
}

/** Die K nächsten Einträge (sortiert) in idx/dist schreiben, ohne Allokation. Liefert die Anzahl. */
function nearest(list, hasPos, p, idx, dist) {
  const K = idx.length;
  let n = 0;
  for (let i = 0; i < list.length; i++) {
    const v = hasPos ? list[i].pos : list[i];
    const dx = v.x - p.x, dz = v.z - p.z;
    const d = dx * dx + dz * dz;
    if (n === K && d >= dist[K - 1]) continue;
    let j = n < K ? n++ : K - 1;
    while (j > 0 && dist[j - 1] > d) { dist[j] = dist[j - 1]; idx[j] = idx[j - 1]; j--; }
    dist[j] = d; idx[j] = i;
  }
  return n;
}
