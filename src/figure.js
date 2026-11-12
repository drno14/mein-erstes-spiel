import * as THREE from 'three/webgpu';

/**
 * MPFB exportiert alle Materialien als "transparent" → Sortierfehler & falsche Schatten.
 * Haare/Brauen/Wimpern: Alpha-Kante (alphaTest), alles andere: undurchsichtig.
 */
const ALPHA_CUT = { Haare: 0.45, Brauen: 0.3, Wimpern: 0.3 };

export function prepareFigure(figur) {
  figur.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    m.transparent = false;
    m.depthWrite = true;
    const base = m.name.split('.')[0];   // "Haare.Frau" → "Haare"
    m.alphaTest = ALPHA_CUT[base] ?? 0;
    if (ALPHA_CUT[base]) { m.side = THREE.DoubleSide; o.castShadow = base === 'Haare'; }
    m.needsUpdate = true;
  });
  return figur;
}
