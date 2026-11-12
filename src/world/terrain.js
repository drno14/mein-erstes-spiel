import * as THREE from 'three/webgpu';
import { createNoise2D, fbm, smoothstep } from './noise.js';

export const CHUNK_SIZE = 64;    // Meter pro Chunk
export const CHUNK_RES = 32;     // Unterteilungen pro Chunk (→ 2 m Raster)
export const SEA_LEVEL = -4;     // Wasserhöhe
const START_FLAT_INNER = 34;     // Radius der flachen Start-Ebene (Blender-Dorf)
const START_FLAT_OUTER = 80;     // ab hier volles Gelände

/**
 * Gelände mit Seed. height(x, z) ist die einzige Wahrheit für die Bodenhöhe –
 * sie wird für Mesh, Physik und Platzierung von Objekten benutzt.
 */
export function createTerrain(seed) {
  const nBase = createNoise2D(seed);
  const nDetail = createNoise2D(seed + 1);
  const nRidge = createNoise2D(seed + 2);
  const nColor = createNoise2D(seed + 3);
  const nForest = createNoise2D(seed + 4);

  function rawHeight(x, z) {
    const base = fbm(nBase, x / 420, z / 420, 4);              // Kontinente: Täler, Ebenen, Seen
    const detail = fbm(nDetail, x / 70, z / 70, 4);            // Hügel
    const mountainMask = smoothstep(0.15, 0.6, base);
    const r = 1 - Math.abs(fbm(nRidge, x / 170, z / 170, 4)); // Grate
    const ridged = r * r;
    return base * 16 + detail * 3.5 + mountainMask * ridged * 55 + 2;
  }

  function height(x, z) {
    // Rund um den Ursprung flach (dort steht das Blender-Dorf auf Höhe 0)
    const d = Math.hypot(x, z);
    const f = smoothstep(START_FLAT_INNER, START_FLAT_OUTER, d);
    return f === 0 ? 0 : rawHeight(x, z) * f;
  }

  const _n = new THREE.Vector3();
  function normal(x, z, out = _n) {
    const e = 0.8;
    const hx = height(x + e, z) - height(x - e, z);
    const hz = height(x, z + e) - height(x, z - e);
    return out.set(-hx, 2 * e, -hz).normalize();
  }

  /** Waldmenge 0..1 (für Baumdichte). */
  const forest = (x, z) => smoothstep(-0.1, 0.45, fbm(nForest, x / 160, z / 160, 3));

  // Farbpalette
  const C = {
    sand: new THREE.Color(0xd9c58e),
    grassA: new THREE.Color(0x5fa33d),
    grassB: new THREE.Color(0x3e7d2c),
    meadow: new THREE.Color(0x76b84f),
    forest: new THREE.Color(0x2f6a28),
    rock: new THREE.Color(0x7e7870),
    rockDark: new THREE.Color(0x5c5852),
    snow: new THREE.Color(0xf3f5f8),
  };
  const tmp = new THREE.Color();
  const tmp2 = new THREE.Color();

  function colorAt(x, z, h, slope, out) {
    // Gras: zwei Grüntöne, gemischt per Rauschen, im Wald dunkler, nahe Start heller
    const n = fbm(nColor, x / 45, z / 45, 2) * 0.5 + 0.5;
    out.copy(C.grassA).lerp(C.grassB, n);
    out.lerp(C.forest, forest(x, z) * 0.55);
    out.lerp(C.meadow, 1 - smoothstep(START_FLAT_INNER, START_FLAT_OUTER + 20, Math.hypot(x, z)));
    // Strand
    out.lerp(C.sand, 1 - smoothstep(SEA_LEVEL + 0.4, SEA_LEVEL + 1.6, h));
    // Fels an Steilhängen und in der Höhe
    tmp.copy(C.rock).lerp(C.rockDark, n);
    const rockW = Math.max(smoothstep(0.32, 0.5, slope), smoothstep(26, 34, h + n * 4));
    out.lerp(tmp, rockW);
    // Schnee auf Gipfeln (nicht an ganz steilen Wänden)
    const snowW = smoothstep(40, 46, h + n * 5) * (1 - smoothstep(0.45, 0.65, slope));
    out.lerp(tmp2.copy(C.snow), snowW);
    return out;
  }

  /** Baut die Geometrie eines Chunks (Positionen relativ zur Chunk-Ecke). */
  function buildChunkGeometry(cx, cz) {
    const n = CHUNK_RES + 1;
    const step = CHUNK_SIZE / CHUNK_RES;
    const x0 = cx * CHUNK_SIZE, z0 = cz * CHUNK_SIZE;
    const pos = new Float32Array(n * n * 3);
    const nor = new Float32Array(n * n * 3);
    const col = new Float32Array(n * n * 3);
    const c = new THREE.Color();
    let minH = Infinity, maxH = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const lx = i * step, lz = j * step;
        const wx = x0 + lx, wz = z0 + lz;
        const h = height(wx, wz);
        const nv = normal(wx, wz);
        const k = (j * n + i) * 3;
        pos[k] = lx; pos[k + 1] = h; pos[k + 2] = lz;
        nor[k] = nv.x; nor[k + 1] = nv.y; nor[k + 2] = nv.z;
        colorAt(wx, wz, h, 1 - nv.y, c);
        col[k] = c.r; col[k + 1] = c.g; col[k + 2] = c.b;
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
      }
    }
    const idx = new Uint32Array(CHUNK_RES * CHUNK_RES * 6);
    let t = 0;
    for (let j = 0; j < CHUNK_RES; j++) {
      for (let i = 0; i < CHUNK_RES; i++) {
        const a = j * n + i, b = a + 1, d = a + n, e = d + 1;
        idx[t++] = a; idx[t++] = d; idx[t++] = b;
        idx[t++] = b; idx[t++] = d; idx[t++] = e;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, minH, 0), new THREE.Vector3(CHUNK_SIZE, maxH, CHUNK_SIZE));
    geo.boundingSphere = geo.boundingBox.getBoundingSphere(new THREE.Sphere());
    return geo;
  }

  return { height, normal, forest, buildChunkGeometry };
}
