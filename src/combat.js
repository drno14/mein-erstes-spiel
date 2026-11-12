import * as THREE from 'three/webgpu';

/*
 * Zerstören: Bäume, Büsche, Felsen, Kisten, Fässer, Zäune, Tiere …
 * Jeder Schlag (R) trifft das nächste Ziel vor der Figur. Der Schaden hängt vom Werkzeug und vom
 * Material des Ziels ab: Axt → Holz, Spitzhacke → Stein, Schwert → Tiere, Schaufel → Pflanzen …
 *
 * Ziele kommen aus mehreren Quellen (Gelände, Deko, Gegenstände, Tiere, Startdorf). Jede Quelle liefert
 * Objekte mit { x, z, y, r, height, material, name, hp, maxHp, destroy() → Beute [[Schlüssel, Anzahl]] }
 * und optional { im, index, base } (Instanz zum Wackeln), shakeObj (Object3D zum Wackeln), onHit().
 */

// Werkzeug-Art je Gegenstand (Schlüssel aus items.js); leere Hand = 'hand'
const TOOL_OF = {
  axe_small: 'axt', axe_double: 'axt', axe_bronze: 'axt', tool_axe: 'axt',
  pickaxe_bronze: 'spitzhacke', tool_pickaxe: 'spitzhacke',
  tool_hammer: 'hammer', hammer_double: 'hammer',
  tool_shovel: 'schaufel', tool_hoe: 'hacke',
  sword: 'klinge', sword_golden: 'klinge', sword_big: 'klinge', sword_big_golden: 'klinge', sword_bronze: 'klinge',
  dagger: 'klinge', dagger_golden: 'klinge', torch_metal: 'fackel',
};
const TOOL_NAME = { axt: 'Axt', spitzhacke: 'Spitzhacke', hammer: 'Hammer', schaufel: 'Schaufel', hacke: 'Hacke', klinge: 'Klinge', fackel: 'Fackel', hand: 'Faust' };

// Schaden pro Schlag: Werkzeug × Material
const DAMAGE = {
  //            holz pflanze stein metall tier stoff mensch
  hand:       { holz: 4,  pflanze: 7,  stein: 1,  metall: 1,  tier: 5,  stoff: 6, mensch: 8 },
  axt:        { holz: 34, pflanze: 24, stein: 3,  metall: 3,  tier: 20, stoff: 22, mensch: 22 },
  spitzhacke: { holz: 9,  pflanze: 8,  stein: 34, metall: 20, tier: 12, stoff: 8, mensch: 14 },
  hammer:     { holz: 22, pflanze: 8,  stein: 18, metall: 16, tier: 14, stoff: 8, mensch: 18 },
  schaufel:   { holz: 8,  pflanze: 32, stein: 10, metall: 2,  tier: 8,  stoff: 10, mensch: 10 },
  hacke:      { holz: 10, pflanze: 28, stein: 8,  metall: 2,  tier: 8,  stoff: 10, mensch: 10 },
  klinge:     { holz: 7,  pflanze: 20, stein: 2,  metall: 2,  tier: 30, stoff: 30, mensch: 28 },
  fackel:     { holz: 18, pflanze: 34, stein: 1,  metall: 1,  tier: 8,  stoff: 34, mensch: 12 },
};
// Bestes Werkzeug je Material (für Hinweise)
const BEST = { holz: 'eine Axt', pflanze: 'eine Schaufel oder Axt', stein: 'eine Spitzhacke', metall: 'eine Spitzhacke oder einen Hammer', tier: 'eine Klinge', stoff: 'eine Klinge', mensch: 'eine Klinge' };
// Farbe der Splitter je Material
const CHIP = { holz: 0x8a5a2b, pflanze: 0x4f9a3a, stein: 0x8c8a84, metall: 0xb8bcc4, tier: 0xf1f1f1, stoff: 0xd9c9a6, mensch: 0xc94a3a };

const REACH = 1.7;          // m vom Körperrand zur Figur
const HIT_DELAY = 0.16;     // s nach Beginn des Schwungs (Ausholen)
const MAX_CHIPS = 160;

export class Combat {
  constructor({ scene, camera, items, player, getYaw }) {
    Object.assign(this, { scene, camera, items, player, getYaw });
    this.sources = [];       // Funktionen (x, z) → iterierbare Ziele
    this.pending = [];       // geplante Treffer
    this.shakes = [];        // wackelnde Ziele
    this.bar = null;         // { target, t }
    this._v = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();

    // Splitter: eine InstancedMesh mit Instanz-Farben
    const geo = new THREE.BoxGeometry(0.07, 0.07, 0.07);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
    this.chips = new THREE.InstancedMesh(geo, mat, MAX_CHIPS);
    this.chips.frustumCulled = false;
    this.chipData = [];
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), white = new THREE.Color(1, 1, 1);
    for (let i = 0; i < MAX_CHIPS; i++) {
      this.chips.setMatrixAt(i, zero);
      this.chips.setColorAt(i, white);
      this.chipData.push({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), rot: new THREE.Euler() });
    }
    this.chipNext = 0;
    scene.add(this.chips);

    this._buildBar();
    items.onSwing = (key) => this.swing(key);
  }

  addSource(fn) { this.sources.push(fn); }

  swing(key) {
    this.pending.push({ t: HIT_DELAY, tool: TOOL_OF[key] ?? 'hand' });
  }

  /** Nächstes Ziel vor der Figur (Kegel ±60°, Reichweite bis zum Körperrand). */
  findTarget() {
    const p = this.player.position, yaw = this.getYaw();
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = null, bestScore = Infinity;
    for (const src of this.sources) {
      for (const t of src(p.x, p.z)) {
        if (t.dead || t.hp <= 0) continue;
        const dx = t.x - p.x, dz = t.z - p.z;
        const d = Math.hypot(dx, dz);
        const edge = d - (t.r ?? 0.5);
        if (edge > REACH) continue;
        if (Math.abs((t.y ?? p.y) - p.y) > 2.5) continue;
        const cos = d < 1e-3 ? 1 : (dx * fx + dz * fz) / d;
        if (cos < 0.45 && edge > 0.3) continue;            // nicht vor uns (ausser direkt am Körper)
        const score = edge - cos * 0.6;
        if (score < bestScore) { bestScore = score; best = t; }
      }
    }
    return best;
  }

  hit(tool) {
    const t = this.findTarget();
    if (!t) return;
    const table = DAMAGE[tool] ?? DAMAGE.hand;
    const base = table[t.material] ?? 5;
    const dmg = Math.max(1, Math.round(base * (0.9 + Math.random() * 0.2)));
    // Fackel: Brennbares fängt Feuer
    if (tool === 'fackel' && (t.material === 'holz' || t.material === 'pflanze' || t.material === 'stoff') && Math.random() < 0.6) this.onIgnite?.(t);
    this.applyDamage(t, dmg, { tool, base });
  }

  /** Schaden an einem Ziel (Schlag, Schuss, Feuer). Gibt true zurück, wenn es dabei kaputtging. */
  applyDamage(t, dmg, { tool = 'hand', base = dmg, quiet = false, cause = 'schlag' } = {}) {
    if (t.dead || t.hp <= 0) return false;
    t.hp = Math.max(0, t.hp - dmg);
    this.onHitTarget?.(t, cause, t.hp <= 0);
    t.onHit?.(this.player.position.x, this.player.position.z);

    // Effekte: Splitter + Wackeln + Lebensbalken
    const y = (t.y ?? this.player.position.y) + Math.min(t.height ?? 1, 1.6) * 0.55;
    this.burst(t.x, y, t.z, CHIP[t.material] ?? 0xffffff, t.hp <= 0 ? 22 : 8);
    this.shakes.push({ t, time: 0 });
    this.bar = { target: t, time: 2.5 };

    if (t.hp <= 0) {
      const drops = t.destroy() ?? [];
      this.burst(t.x, y, t.z, CHIP[t.material] ?? 0xffffff, 18);
      let k = 0;
      for (const [key, n] of drops) {
        const a = (k++ / Math.max(1, drops.length)) * Math.PI * 2 + Math.random();
        this.items.spawnDrop(key, n, t.x + Math.cos(a) * 0.7, t.z + Math.sin(a) * 0.7);
      }
      const what = drops.length ? ` – ${drops.map(([key, n]) => `${n}× ${this.items.nameOf?.(key) ?? key}`).join(', ')}` : '';
      this.items.say(`${t.name} ${t.doneVerb ?? (t.material === 'tier' ? 'erlegt' : 'zerstört')}${what}`, 2.5);
      this.bar = null;
      return true;
    } else if (quiet) {
      return false;
    } else if (base <= 5 && tool !== 'hand') {
      this.items.say(`Mit ${TOOL_NAME[tool] === 'Faust' ? 'der Faust' : `dieser ${TOOL_NAME[tool]}`} geht das kaum – nimm ${BEST[t.material]}!`, 2.5);
    } else if (tool === 'hand' && t.maxHp > 20 && t.hp > t.maxHp - 6) {
      this.items.say(`Mit der Faust dauert das ewig – nimm ${BEST[t.material]}!`, 2.5);
    }
  }

  burst(x, y, z, color, n) {
    const c = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      const k = this.chipNext; this.chipNext = (this.chipNext + 1) % MAX_CHIPS;
      const d = this.chipData[k];
      d.life = 0.7 + Math.random() * 0.5;
      d.p.set(x + (Math.random() - 0.5) * 0.3, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.3);
      d.v.set((Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, (Math.random() - 0.5) * 4);
      d.rot.set(Math.random() * 6, Math.random() * 6, 0);
      c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.1);
      this.chips.setColorAt(k, c);
    }
    this.chips.instanceColor.needsUpdate = true;
  }

  // ---------- Lebensbalken (HTML über dem Ziel) ----------
  _buildBar() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;left:0;top:0;display:none;pointer-events:none;transform:translate(-50%,-100%);' +
      'background:rgba(0,0,0,.55);color:#fff;font:12px system-ui,sans-serif;padding:4px 8px;border-radius:8px;text-align:center;min-width:90px';
    el.innerHTML = '<div class="n"></div><div style="height:6px;background:rgba(255,255,255,.2);border-radius:3px;margin-top:3px;overflow:hidden">' +
      '<div class="f" style="height:100%;width:100%;border-radius:3px;background:#7ad35a;transition:width .15s"></div></div>';
    document.body.appendChild(el);
    this.barEl = el; this.barName = el.querySelector('.n'); this.barFill = el.querySelector('.f');
  }

  _updateBar(dt) {
    const b = this.bar;
    if (!b || b.target.dead || b.target.hp <= 0) { this.barEl.style.display = 'none'; return; }
    b.time -= dt;
    if (b.time <= 0) { this.bar = null; this.barEl.style.display = 'none'; return; }
    const t = b.target;
    const v = this._v.set(t.x, (t.y ?? 0) + Math.min(t.height ?? 1, 2.4) + 0.3, t.z).project(this.camera);
    if (v.z > 1) { this.barEl.style.display = 'none'; return; }
    this.barEl.style.display = 'block';
    this.barEl.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    this.barEl.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    this.barName.textContent = `${t.name} · ${Math.ceil(t.hp)}/${t.maxHp}`;
    const f = t.hp / t.maxHp;
    this.barFill.style.width = `${f * 100}%`;
    this.barFill.style.background = f > 0.5 ? '#7ad35a' : f > 0.25 ? '#e8c341' : '#e2573f';
  }

  update(dt) {
    // geplante Treffer
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const h = this.pending[i];
      h.t -= dt;
      if (h.t <= 0) { this.pending.splice(i, 1); this.hit(h.tool); }
    }
    // Splitter
    let any = false;
    for (let i = 0; i < MAX_CHIPS; i++) {
      const d = this.chipData[i];
      if (d.life <= 0) continue;
      any = true;
      d.life -= dt;
      d.v.y -= 9.81 * dt;
      d.p.addScaledVector(d.v, dt);
      d.rot.x += dt * 8; d.rot.y += dt * 6;
      const s = d.life > 0 ? Math.min(1, d.life * 3) : 0;
      this._m.compose(d.p, this._q.setFromEuler(d.rot), this._v.setScalar(s));
      this.chips.setMatrixAt(i, this._m);
    }
    if (any) this.chips.instanceMatrix.needsUpdate = true;
    // Wackeln (0.25 s)
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i];
      s.time += dt;
      const k = s.time < 0.25 && !s.t.dead ? Math.sin(s.time * 60) * (1 - s.time / 0.25) * 0.06 : 0;
      if (s.t.shakeObj) {
        if (s.base === undefined) s.base = s.t.shakeObj.rotation.z;
        if (!s.t.dead) {
          s.t.shakeObj.rotation.z = s.base + k;
          if (!s.t.shakeObj.matrixAutoUpdate) s.t.shakeObj.updateMatrix();
        }
      } else if (s.t.im && s.t.base && !s.t.dead) {
        this._m.makeRotationZ(k).premultiply(s.t.base);   // um die eigene Basis kippen
        s.t.im.setMatrixAt(s.t.index, k ? this._m : s.t.base);
        s.t.im.instanceMatrix.needsUpdate = true;
      }
      if (s.time >= 0.25) this.shakes.splice(i, 1);
    }
    this._updateBar(dt);
  }
}
