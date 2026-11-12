import * as THREE from 'three/webgpu';
import { SEA_LEVEL } from './world/terrain.js';

/*
 * Echtes Leben:
 *  - Gesundheit (0–100) und Verletzungen: Blutung, Beinbruch, Kopfverletzung, Verbrennung.
 *    Ursachen: Stürze aus der Höhe, Feuer, Schüsse der Polizei, Wolfsbisse.
 *    Bei 0 → Ambulanz bringt dich ins Spital (Rechnung). Im Spital (H an der Tür) wirst du behandelt.
 *  - Pistole (R): Schuss mit Mündungsfeuer, trifft Menschen, Tiere, Gegenstände; braucht Munition.
 *  - Polizei: Angriffe auf Menschen und Schüsse in bewohnter Gegend → Fahndung (★). Polizisten rennen
 *    zu dir und verhaften dich (Busse); ab ★★★ schiessen sie. Wegrennen und Verstecken senkt die Fahndung.
 *  - Feuer: Die Fackel zündet Holz, Büsche, Stoff an. Feuer breitet sich aus, verletzt, und die
 *    Feuerwehr rückt mit Löschfahrzeug aus.
 *  - Bank: Geld einzahlen (sicher bei Unfall/Verhaftung), abheben, Zinsen – oder überfallen.
 */

const STORE_KEY = 'spiel-leben-v1';
const INJ = {
  blutung: { name: 'Blutung', icon: '🩸', cost: 40 },
  bein: { name: 'Beinbruch', icon: '🦴', cost: 120 },
  kopf: { name: 'Kopfverletzung', icon: '🤕', cost: 150 },
  brand: { name: 'Verbrennung', icon: '🔥', cost: 60 },
};
const GUN_RANGE = 45;
const GUN_DAMAGE = { mensch: 34, tier: 40, holz: 8, pflanze: 20, stein: 2, metall: 3, stoff: 25 };
const COP_SPEED = 4.3;          // langsamer als Sprinten (5.2) → wer rennt, kann entkommen
const BURNABLE = new Set(['holz', 'pflanze', 'stoff']);

export class Life {
  constructor(o) {
    Object.assign(this, o);   // scene, camera, player, items, business, terrain, npcs, combat, animals, services, getYaw, getPitch, situations, inVehicle, teleport
    this.health = 100;
    this.injuries = {};       // typ → Restdauer (s) oder Infinity
    this.bank = 0;
    this.wanted = 0;          // 0 … 5 Sterne
    this.crimeT = 0;          // Sekunden seit letzter Straftat
    this.down = false;        // bewusstlos (Ambulanz unterwegs)
    this.cops = [];
    this.fires = [];
    this.brigade = null;
    this.panel = null;
    this.interestT = 0;
    this._load();
    this._buildHud();
    this._buildFx();

    // Gegenstände
    this.items.onShoot = () => this.shoot();
    this.items.onUseItem = (key) => key === 'verband' && this.bandage();
    this.items.onConsume = (key, def) => { if (def.heal) this.heal(def.heal, `${def.n}: +${def.heal} Gesundheit`); };
    // Kampf: Angriffe auf Menschen sind Straftaten; Feuer mit der Fackel
    this.combat.onHitTarget = (t, cause, killed) => {
      if (t.material !== 'mensch' || cause === 'feuer') return;
      if (t.npc?.cop) this.crime(killed ? 2 : 1, 'Angriff auf die Polizei');
      else this.crime(killed ? 1 : 0.5, killed ? 'Körperverletzung' : 'Angriff');
    };
    this.combat.onIgnite = (t) => this.ignite(t.x, t.z, t);

    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'Escape' && this.panel) { this.closePanel(); return; }
      if (e.code !== 'KeyH') return;
      if (this.panel) { this.closePanel(); e.stopImmediatePropagation(); return; }
      const p = this.player.position;
      const id = this.services.doorNear(p.x, p.z);
      if (id) { this.openPanel(id); e.stopImmediatePropagation(); }
    }, true);   // vor dem Handel (business.js)
  }

  // ======================= Gesundheit =======================

  get speedFactor() { return this.down ? 0 : this.injuries.bein ? 0.55 : this.health < 25 ? 0.8 : 1; }
  get canSprint() { return !this.down && !this.injuries.bein && this.health >= 15; }

  damage(n, cause, injury = null, injuryTime = Infinity) {
    if (this.down || n <= 0) return;
    this.health = Math.max(0, this.health - n);
    if (injury && !this.injuries[injury]) {
      this.injuries[injury] = injuryTime;
      this.items.say(`${INJ[injury].icon} ${INJ[injury].name}! (${cause})`, 3);
    }
    this._flash(Math.min(0.6, 0.15 + n / 60));
    if (this.health <= 0) this._collapse(cause);
    this._renderHud(); this._save();
  }

  heal(n, msg) {
    this.health = Math.min(100, this.health + n);
    if (msg) this.items.say(msg);
    this._renderHud(); this._save();
  }

  bandage() {
    const had = this.injuries.blutung || this.injuries.brand;
    if (!had && this.health >= 100) { this.items.say('Du bist nicht verletzt.'); return false; }
    delete this.injuries.blutung; delete this.injuries.brand;
    this.heal(30, had ? 'Verband angelegt – die Blutung ist gestillt. +30 Gesundheit' : 'Verband angelegt. +30 Gesundheit');
    if (this.injuries.bein || this.injuries.kopf) this.items.say('Verband angelegt. Für Bruch/Kopfverletzung musst du ins Spital!', 3.5);
    return true;
  }

  /** Aufprall nach einem Fall (m/s nach unten). */
  fall(vy) {
    if (vy < 11.5) return;
    const dmg = Math.round((vy - 11) * 7);
    if (vy > 17) this.damage(dmg, 'Sturz', Math.random() < 0.5 ? 'bein' : 'kopf');
    else if (vy > 14) this.damage(dmg, 'Sturz', 'bein');
    else this.damage(dmg, 'Sturz');
  }

  _collapse(cause) {
    this.down = true;
    this.injuries = {};
    this.items.say(`Du bist bewusstlos (${cause}). Die Ambulanz bringt dich ins Spital …`, 4);
    this._siren(1.6, 600, 900);
    this.fade.style.opacity = '1';
    setTimeout(() => {
      const door = this.services.doors.spital;
      if (door) this.teleport(door.x, door.z);
      this.health = 60;
      const bill = 150;
      this.pay(bill);
      // bei einem Unfall verliert man die Hälfte des Bargelds
      const lost = Math.floor(this.business.money / 2);
      this.business.money -= lost; this.business._renderMoney(); this.business._save();
      this.wanted = 0; this._dismissCops();
      this.down = false;
      this.fade.style.opacity = '0';
      this.items.say(`Du bist im Spital aufgewacht. Rechnung: ${bill} Münzen${lost ? `, ${lost} Münzen Bargeld verloren` : ''}.`, 5);
      this._renderHud(); this._save();
    }, 2600);
  }

  /** Bezahlen: erst Bargeld, dann Bankkonto (darf ins Minus). */
  pay(n) {
    const cash = Math.min(this.business.money, n);
    this.business.money -= cash;
    this.bank -= n - cash;
    this.business._renderMoney(); this.business._save(); this._save();
  }

  // ======================= Waffen =======================

  shoot() {
    if (this.down) return;
    if (this.items._countOf('munition') <= 0) { this.items.say('Keine Munition! (Händler: Munition)'); this._click(); return; }
    this._take('munition', 1);
    const p = this.player.position;
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const yaw = this.getYaw();
    // horizontal immer in Blickrichtung der Figur, Höhe von der Kamera
    const h = Math.hypot(dir.x, dir.z) || 1;
    dir.set(Math.sin(yaw) * h, dir.y + 0.08, Math.cos(yaw) * h).normalize();
    const from = new THREE.Vector3(p.x + Math.sin(yaw) * 0.45, p.y + 1.35, p.z + Math.cos(yaw) * 0.45);
    // Ziele entlang des Strahls sammeln
    let best = null, bestT = GUN_RANGE;
    const seen = new Set();
    for (let d = 0; d <= GUN_RANGE; d += 8) {
      const sx = from.x + dir.x * d, sz = from.z + dir.z * d;
      for (const src of this.combat.sources) for (const t of src(sx, sz)) {
        if (seen.has(t) || t.dead || t.hp <= 0) continue;
        seen.add(t);
        const tt = this._rayHit(from, dir, t);
        if (tt !== null && tt < bestT) { bestT = tt; best = t; }
      }
    }
    // Gelände stoppt die Kugel
    for (let d = 1; d < bestT; d += 1) {
      const x = from.x + dir.x * d, y = from.y + dir.y * d, z = from.z + dir.z * d;
      if (y < this.terrain.height(x, z)) { bestT = d; best = null; break; }
    }
    const to = from.clone().addScaledVector(dir, bestT);
    this._tracer(from, to);
    this._bang();
    if (best) {
      const dmg = GUN_DAMAGE[best.material] ?? 10;
      this.combat.applyDamage(best, Math.round(dmg * (0.85 + Math.random() * 0.3)), { tool: 'pistole', base: dmg, quiet: true, cause: 'schuss' });
    } else {
      this.combat.burst(to.x, to.y, to.z, 0x8c8a84, 5);
    }
    // Schüsse in bewohnter Gegend: Leute fliehen, Polizei wird gerufen
    let witnesses = 0;
    for (const n of this.npcs.all) {
      if (n.ko || n.cop || n.fireman) continue;
      const d = Math.hypot(n.root.position.x - p.x, n.root.position.z - p.z);
      if (d < 30) { witnesses++; n.hurt?.(p.x, p.z); }
    }
    if (witnesses) this.crime(best?.material === 'mensch' ? 1 : 0.5, 'Schüsse');
  }

  /** Strahl gegen aufrechten Zylinder (Ziel) → Abstand oder null. */
  _rayHit(o, d, t) {
    const r = (t.r ?? 0.5) + 0.12;
    const ox = o.x - t.x, oz = o.z - t.z;
    const a = d.x * d.x + d.z * d.z, b = 2 * (ox * d.x + oz * d.z), c = ox * ox + oz * oz - r * r;
    const disc = b * b - 4 * a * c;
    if (disc < 0 || a < 1e-6) return null;
    const s = Math.sqrt(disc);
    for (const tt of [(-b - s) / (2 * a), (-b + s) / (2 * a)]) {
      if (tt < 0) continue;
      const y = o.y + d.y * tt, y0 = t.y ?? 0;
      if (y >= y0 - 0.1 && y <= y0 + (t.height ?? 1.5) + 0.1) return tt;
    }
    return null;
  }

  _take(key, n) {
    const slots = this.items.slots;
    for (let i = slots.length - 1; i >= 0 && n > 0; i--) {
      const s = slots[i];
      if (!s || s.key !== key) continue;
      const k = Math.min(n, s.n); s.n -= k; n -= k;
      if (s.n <= 0) slots[i] = null;
    }
    this.items._refreshHeld(); this.items._renderUi(); this.items._save();
  }

  // ======================= Polizei =======================

  crime(level, what) {
    const before = Math.floor(this.wanted);
    this.wanted = Math.min(5, this.wanted + level);
    this.crimeT = 0;
    if (Math.floor(this.wanted) > before) {
      this.items.say(`🚨 ${what}! Die Polizei sucht dich (${'★'.repeat(Math.floor(this.wanted))}).`, 3);
      this._siren(1.2, 700, 1000);
    }
    this._renderHud();
  }

  _spawnCop() {
    const p = this.player.position;
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = 32 + Math.random() * 10;
      const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
      if (this.terrain.height(x, z) < SEA_LEVEL + 0.4 || this.blocked(x, z)) continue;
      const cop = this.npcs.spawnSpecial(x, z, { tint: 0x203a7a, name: 'Polizist' });
      cop.cop = true;
      cop.shootT = 1 + Math.random();
      cop.brain = (n, dt, pp, blocked) => this._copBrain(n, dt, pp, blocked);
      this.cops.push(cop);
      return;
    }
  }

  _copBrain(n, dt, pp, blocked) {
    const p = n.root.position;
    const d = Math.hypot(pp.x - p.x, pp.z - p.z);
    if (this.wanted < 1) {   // Feierabend: weglaufen und verschwinden
      n.moveTo(p.x + (p.x - pp.x), p.z + (p.z - pp.z), 1.6, dt, blocked);
      n.leaveT = (n.leaveT ?? 0) + dt;
      return;
    }
    if (d > 1.5) n.moveTo(pp.x, pp.z, COP_SPEED, dt, blocked, 1.4);
    else { n.play('stehen'); n.turnTo(Math.atan2(pp.x - p.x, pp.z - p.z), dt, 8); }
    if (!this.down && !this.inVehicle() && d < 1.7) { this._arrest(); return; }
    if (d < 9 && !n.shoutT) n.say(this.wanted >= 3 ? 'Waffe weg! Hände hoch!' : 'Halt! Polizei!', 2.5);
    // ab drei Sternen wird geschossen
    if (this.wanted >= 3 && d < 22 && d > 2) {
      n.shootT -= dt;
      if (n.shootT <= 0) {
        n.shootT = 1.4 + Math.random();
        const from = new THREE.Vector3(p.x, p.y + 1.35, p.z), to = new THREE.Vector3(pp.x, pp.y + 1.1, pp.z);
        if (Math.random() < 0.45) {
          to.x += (Math.random() - 0.5) * 0.3;
          this.damage(12, 'Schuss', Math.random() < 0.35 ? 'blutung' : null);
        } else { to.x += (Math.random() - 0.5) * 2.5; to.z += (Math.random() - 0.5) * 2.5; }
        this._tracer(from, to, 0xffe08a);
        this._bang(0.5);
      }
    }
  }

  _arrest() {
    if (this.down) return;
    const fine = Math.round(60 * Math.max(1, this.wanted));
    this.down = true;
    this.fade.style.opacity = '1';
    this.items.say(`🚔 Verhaftet! Busse: ${fine} Münzen.`, 4);
    setTimeout(() => {
      this.pay(fine);
      const door = this.services.doors.polizei;
      if (door) this.teleport(door.x, door.z);
      // Waffen werden beschlagnahmt
      const slots = this.items.slots;
      let took = 0;
      for (let i = 0; i < slots.length; i++) if (slots[i] && (slots[i].key === 'pistol' || slots[i].key === 'munition')) { slots[i] = null; took++; }
      this.items._refreshHeld(); this.items._renderUi(); this.items._save();
      this.wanted = 0; this._dismissCops();
      this.down = false;
      this.fade.style.opacity = '0';
      this.items.say(`Du kommst aus der Polizeiwache. ${fine} Münzen Busse bezahlt${took ? ', Pistole beschlagnahmt' : ''}.`, 5);
      this._renderHud(); this._save();
    }, 2400);
  }

  _dismissCops() { for (const c of this.cops) { c.leaveT = 0; } }

  _updatePolice(dt) {
    this.crimeT += dt;
    const p = this.player.position;
    // Fahndung sinkt, wenn kein Polizist dich sieht
    const seen = this.cops.some((c) => !c.ko && Math.hypot(c.root.position.x - p.x, c.root.position.z - p.z) < 28);
    if (this.wanted > 0 && this.crimeT > 25 && !seen) {
      this.wanted = Math.max(0, this.wanted - dt / 15);
      if (this.wanted < 0.05) { this.wanted = 0; this.items.say('Die Polizei hat die Suche eingestellt.'); }
      this._renderHud();
    }
    // genug Polizisten unterwegs?
    const active = this.cops.filter((c) => !c.leaveT);
    const want = this.wanted >= 1 ? Math.min(4, Math.ceil(this.wanted)) : 0;
    this._copT = (this._copT ?? 0) - dt;
    if (active.length < want && this._copT <= 0) { this._spawnCop(); this._copT = 4; }
    // abziehende/zu ferne Polizisten entfernen
    for (const c of [...this.cops]) {
      const d = Math.hypot(c.root.position.x - p.x, c.root.position.z - p.z);
      if ((c.leaveT && (c.leaveT > 12 || d > 60)) || d > 140) {
        this.npcs.removeSpecial(c);
        this.cops.splice(this.cops.indexOf(c), 1);
      }
    }
  }

  // ======================= Feuer =======================

  ignite(x, z, target = null) {
    if (target && this.fires.some((f) => f.target === target)) return;
    if (this.fires.length > 24) return;
    const y = target?.y ?? this.terrain.height(x, z);
    const size = target ? Math.min(2.2, Math.max(0.6, (target.height ?? 1) * 0.5)) : 0.8;
    const g = new THREE.Group();
    g.position.set(x, y, z);
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.flameGeo, i === 2 ? this.flameInner : this.flameOuter);
      m.position.set((Math.random() - 0.5) * size * 0.6, 0, (Math.random() - 0.5) * size * 0.6);
      g.add(m);
    }
    this.scene.add(g);
    this.fires.push({ x, z, y, size, target, obj: g, life: target ? 40 : 20, power: 1, t: 0, spreadT: 2 + Math.random() * 2, burnT: 0 });
    if (this.fires.length === 1) this.items.say('🔥 Es brennt!', 2.5);
  }

  _updateFire(dt, time) {
    const p = this.player.position;
    const rain = /regen|gewitter/i.test(this.situations?.weather ?? '') ? 3 : 1;
    let nearest = null, nd = Infinity;
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      f.life -= dt * rain;
      if (f.life <= 0 || f.power <= 0.02) f.power -= dt * 0.5;
      if (f.power <= 0) { this.scene.remove(f.obj); this.fires.splice(i, 1); continue; }
      const pw = Math.min(1, f.power) * Math.min(1, f.t * 1.5);
      f.obj.children.forEach((m, k) => {
        const flick = 0.8 + Math.sin(time * (9 + k * 3) + k) * 0.15 + Math.random() * 0.1;
        m.scale.set(f.size * pw * flick, f.size * 1.6 * pw * flick, f.size * pw * flick);
      });
      // brennendes Ziel nimmt Schaden
      if (f.target && !f.target.dead && f.target.hp > 0) {
        f.burnT -= dt;
        if (f.burnT <= 0) {
          f.burnT = 1;
          this.combat.applyDamage(f.target, f.target.material === 'mensch' || f.target.material === 'tier' ? 6 : 8, { quiet: true, cause: 'feuer' });
        }
      } else if (f.target && f.life > 6) f.life = 6;
      // Ausbreitung auf Brennbares in der Nähe
      f.spreadT -= dt;
      if (f.spreadT <= 0 && f.power > 0.5) {
        f.spreadT = 2.5 + Math.random() * 2;
        if (Math.random() < 0.4 / rain) {
          for (const src of this.combat.sources) for (const t of src(f.x, f.z)) {
            if (t.dead || t.hp <= 0 || !BURNABLE.has(t.material) || t === f.target) continue;
            if (Math.hypot(t.x - f.x, t.z - f.z) < 4.5 && !this.fires.some((q) => q.target === t) && Math.random() < 0.5) { this.ignite(t.x, t.z, t); break; }
          }
        }
      }
      // Spieler zu nah → Verbrennung
      const d = Math.hypot(p.x - f.x, p.z - f.z);
      if (d < f.size * 0.7 + 0.5 && Math.abs(p.y - f.y) < 2.5 && pw > 0.3) {
        this._burnT = (this._burnT ?? 0) - dt;
        if (this._burnT <= 0) { this._burnT = 0.7; this.damage(6, 'Feuer', 'brand', 25); }
      }
      if (d < nd) { nd = d; nearest = f; }
    }
    // ein Licht beim nächsten Feuer
    if (nearest && nd < 60) {
      this.fireLight.position.set(nearest.x, nearest.y + 1.2, nearest.z);
      this.fireLight.intensity = 25 * Math.min(1, nearest.power) * (0.85 + Math.random() * 0.3);
    } else this.fireLight.intensity = 0;
    this._updateBrigade(dt, nearest, nd);
  }

  /** Feuerwehr: kommt, wenn es länger brennt; löscht alle Feuer in der Umgebung. */
  _updateBrigade(dt, nearest, nd) {
    const b = this.brigade;
    if (!b) {
      if (nearest && nearest.t > 5 && nd < 120) {
        const fx = nearest.x, fz = nearest.z;
        let sx = fx, sz = fz;
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const x = fx + Math.cos(a) * 14, z = fz + Math.sin(a) * 14;
          if (this.terrain.height(x, z) > SEA_LEVEL + 0.4 && !this.blocked(x, z)) { sx = x; sz = z; break; }
        }
        const men = [0, 1].map((i) => {
          const n = this.npcs.spawnSpecial(sx + i * 1.2, sz + 1.5, { tint: 0xb3261e, name: 'Feuerwehr' });
          n.fireman = true;
          n.brain = (nn, dt2, pp, blocked) => this._firemanBrain(nn, dt2, blocked);
          return n;
        });
        let truck = null;
        const model = this.services.vehicleModels?.firetruck;
        if (model) {
          truck = model.clone();
          truck.position.set(sx, this.terrain.height(sx, sz), sz);
          truck.rotation.y = Math.atan2(fx - sx, fz - sz) + Math.PI / 2;
          this.scene.add(truck);
        }
        this.brigade = { men, truck, t: 0, x: sx, z: sz };
        this.items.say('🚒 Die Feuerwehr ist da!', 3);
        this._siren(2.2, 520, 760);
      }
      return;
    }
    b.t += dt;
    const near = this.fires.filter((f) => Math.hypot(f.x - b.x, f.z - b.z) < 50);
    if ((!near.length && b.t > 6) || b.t > 120) {
      b.leaveT = (b.leaveT ?? 0) + dt;
      if (b.leaveT > 6) {
        for (const n of b.men) this.npcs.removeSpecial(n);
        if (b.truck) this.scene.remove(b.truck);
        this.brigade = null;
      }
    }
  }

  _firemanBrain(n, dt, blocked) {
    const p = n.root.position;
    let target = null, td = Infinity;
    for (const f of this.fires) {
      const d = Math.hypot(f.x - p.x, f.z - p.z);
      if (d < td && d < 60) { td = d; target = f; }
    }
    if (!target) { n.play('stehen'); n.shout = ''; return; }
    if (td > 3.2) { n.moveTo(target.x, target.z, 3.6, dt, blocked, 3); return; }
    // löschen
    n.play('stehen');
    n.turnTo(Math.atan2(target.x - p.x, target.z - p.z), dt, 8);
    if (!n.shoutT) n.say('Wasser marsch!', 2);
    target.power -= dt * 0.35;
    target.life = Math.min(target.life, 30);
    this._spray(p, target);
  }

  // ======================= Bank & Gebäude =======================

  openPanel(id) {
    this.panel = id;
    document.exitPointerLock?.();
    this.el.style.display = 'block';
    this._renderPanel();
  }

  closePanel() { this.panel = null; this.el.style.display = 'none'; }

  _renderPanel() {
    const id = this.panel, m = this.business.money;
    const btn = (act, label, dis = false) => `<button class="lf-btn" data-act="${act}" ${dis ? 'disabled' : ''}>${label}</button>`;
    let html = '';
    if (id === 'spital') {
      const inj = Object.keys(this.injuries);
      const cost = 30 + inj.reduce((a, k) => a + INJ[k].cost, 0) + Math.round((100 - this.health) * 0.6);
      html = `<h3>✚ Spital</h3><p>Gesundheit: <b>${Math.round(this.health)} / 100</b></p>
        <p>${inj.length ? inj.map((k) => `${INJ[k].icon} ${INJ[k].name}`).join(' · ') : 'Keine Verletzungen.'}</p>
        ${this.health >= 100 && !inj.length ? '<p>Du bist gesund – gute Besserung brauchst du keine! 😊</p>' : btn('treat', `Behandeln lassen (${cost} 🪙)`)}
        <p class="lf-hint">Kleine Wunden: Verbandskasten (Händler). Beinbruch und Kopfverletzung heilen nur hier.</p>`;
      this._treatCost = cost;
    } else if (id === 'polizei') {
      const fine = Math.round(60 * Math.max(1, this.wanted));
      html = `<h3>🚔 Polizei</h3><p>Fahndung: <b>${this.wanted >= 1 ? '★'.repeat(Math.floor(this.wanted)) : 'keine'}</b></p>
        ${this.wanted >= 1 ? btn('surrender', `Stellen und Busse zahlen (${fine} 🪙)`) : '<p>Alles ruhig. Bleib anständig!</p>'}
        <p class="lf-hint">Angriffe auf Menschen und Schüsse im Dorf rufen die Polizei. Ab ★★★ wird scharf geschossen.</p>`;
    } else if (id === 'feuerwehr') {
      html = `<h3>🚒 Feuerwehr</h3><p>${this.fires.length ? `Es brennt an ${this.fires.length} Stellen!` : 'Keine Brände gemeldet.'}</p>
        <p class="lf-hint">Wenn es irgendwo länger brennt, rückt die Feuerwehr automatisch aus und löscht. Regen hilft auch.</p>`;
    } else if (id === 'bank') {
      const armed = this._armed();
      html = `<h3>🏦 Bank</h3><p>Konto: <b>${this.bank} 🪙</b> · Bargeld: <b>${m} 🪙</b></p>
        <div class="lf-row">Einzahlen: ${btn('dep10', '10', m < 10)} ${btn('dep100', '100', m < 100)} ${btn('depAll', 'alles', m <= 0)}</div>
        <div class="lf-row">Abheben: ${btn('wd10', '10', this.bank < 10)} ${btn('wd100', '100', this.bank < 100)} ${btn('wdAll', 'alles', this.bank <= 0)}</div>
        <p class="lf-hint">Geld auf der Bank ist sicher – bei einem Unfall oder einer Verhaftung verlierst du nur Bargeld. Zins: 1 % alle 2 Minuten.</p>
        ${armed ? `<div class="lf-row">${btn('rob', '🔫 Bank überfallen!')}</div>` : ''}`;
    }
    this.el.innerHTML = html + '<p class="lf-hint">H oder Esc schliessen</p>';
  }

  _armed() {
    const s = this.items.slots[this.items.selected];
    return !!s && (s.key === 'pistol' || this.items.nameOf && /Schwert|Axt|Dolch|Hammer|Pistole/.test(this.items.nameOf(s.key)));
  }

  _onPanelClick(act) {
    const b = this.business;
    const move = (toBank, n) => {
      n = Math.max(0, Math.floor(n));
      if (toBank) { n = Math.min(n, b.money); b.money -= n; this.bank += n; }
      else { n = Math.min(n, this.bank); this.bank -= n; b.money += n; }
      b._renderMoney(true); b._save(); this._save();
    };
    switch (act) {
      case 'dep10': move(true, 10); break;
      case 'dep100': move(true, 100); break;
      case 'depAll': move(true, b.money); break;
      case 'wd10': move(false, 10); break;
      case 'wd100': move(false, 100); break;
      case 'wdAll': move(false, this.bank); break;
      case 'treat':
        this.pay(this._treatCost);
        this.health = 100; this.injuries = {};
        this.items.say(`Behandelt! Du bist wieder gesund (−${this._treatCost} Münzen).`, 3);
        this._renderHud(); this._save();
        break;
      case 'surrender': {
        const fine = Math.round(60 * Math.max(1, this.wanted));
        this.pay(fine); this.wanted = 0; this._dismissCops();
        this.items.say(`Busse von ${fine} Münzen bezahlt. Die Fahndung ist aufgehoben.`, 3);
        this._renderHud();
        break;
      }
      case 'rob': {
        const loot = 150 + Math.floor(Math.random() * 250);
        b.money += loot; b._renderMoney(true); b._save();
        this.crime(3, 'Banküberfall');
        this.items.say(`💰 ${loot} Münzen erbeutet! Lauf!!!`, 4);
        this._siren(3, 650, 1000);
        this.closePanel();
        return;
      }
    }
    this._renderPanel();
  }

  // ======================= HUD & Effekte =======================

  _buildHud() {
    const css = document.createElement('style');
    css.textContent = `
#life-hud { position: fixed; right: 16px; top: 52px; text-align: right; z-index: 24; font: 600 12px system-ui, sans-serif; color: #fff; pointer-events: none; }
#life-hud .hp { width: 180px; height: 12px; background: rgba(0,0,0,.45); border-radius: 6px; overflow: hidden; border: 1px solid rgba(255,255,255,.25); }
#life-hud .hp i { display: block; height: 100%; background: linear-gradient(90deg,#e0413a,#f37b5a); transition: width .2s; }
#life-hud .row { display: flex; justify-content: flex-end; gap: 6px; align-items: center; margin-top: 4px; text-shadow: 0 1px 2px #000; }
#life-hud .stars { color: #ffd65c; font-size: 16px; letter-spacing: 1px; }
#life-flash { position: fixed; inset: 0; pointer-events: none; z-index: 23; background: radial-gradient(ellipse at center, transparent 40%, rgba(200,0,0,.75)); opacity: 0; transition: opacity .35s; }
#life-fade { position: fixed; inset: 0; pointer-events: none; z-index: 40; background: #000; opacity: 0; transition: opacity .8s; }
#life-head { position: fixed; inset: 0; pointer-events: none; z-index: 22; backdrop-filter: blur(0px); }
#life-panel { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 420px; max-width: calc(100vw - 32px); box-sizing: border-box;
  background: rgba(20,22,28,.93); color: #eee; border: 1px solid rgba(255,255,255,.15); border-radius: 12px; font: 14px system-ui, sans-serif; padding: 14px 16px; z-index: 32; display: none; }
#life-panel h3 { margin: 0 0 8px; font-size: 18px; }
#life-panel p { margin: 6px 0; }
#life-panel .lf-hint { color: #aaa; font-size: 12px; }
#life-panel .lf-row { margin: 6px 0; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
#life-panel .lf-btn { background: #2f6b3a; color: #fff; border: 1px solid #4fa05e; border-radius: 6px; padding: 6px 12px; cursor: pointer; font: inherit; }
#life-panel .lf-btn:disabled { opacity: .4; cursor: default; }
#life-panel .lf-btn[data-act=rob] { background: #8a1f1f; border-color: #d24a4a; }`;
    document.head.appendChild(css);
    const mk = (id) => { const d = document.createElement('div'); d.id = id; document.body.appendChild(d); return d; };
    this.hud = mk('life-hud');
    this.hud.innerHTML = '<div class="hp"><i></i></div><div class="row"><span class="hpv"></span><span class="inj"></span><span class="stars"></span></div>';
    this.flashEl = mk('life-flash');
    this.headEl = mk('life-head');
    this.fade = mk('life-fade');
    this.el = mk('life-panel');
    this.el.addEventListener('click', (e) => { const a = e.target.closest('[data-act]'); if (a && !a.disabled) this._onPanelClick(a.dataset.act); });
    this._renderHud();
  }

  _renderHud() {
    this.hud.querySelector('.hp i').style.width = `${this.health}%`;
    this.hud.querySelector('.hpv').textContent = `❤ ${Math.round(this.health)}`;
    this.hud.querySelector('.inj').textContent = Object.keys(this.injuries).map((k) => INJ[k].icon).join(' ');
    this.hud.querySelector('.stars').textContent = this.wanted >= 1 ? '★'.repeat(Math.floor(this.wanted)) : '';
    if (this.panel) this._renderPanel();
  }

  _flash(a) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = String(a);
    requestAnimationFrame(() => { this.flashEl.style.transition = 'opacity .6s'; this.flashEl.style.opacity = '0'; });
  }

  _buildFx() {
    this.flameGeo = new THREE.ConeGeometry(0.35, 1, 7).translate(0, 0.5, 0);
    this.flameOuter = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false });
    this.flameInner = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true, opacity: 0.9, depthWrite: false });
    this.fireLight = new THREE.PointLight(0xff8a3a, 0, 14, 1.6);
    this.scene.add(this.fireLight);
    this.tracers = [];
    this.tracerMat = new THREE.LineBasicMaterial({ color: 0xfff2b0, transparent: true });
    this.flashLight = new THREE.PointLight(0xffd27a, 0, 8, 2);
    this.scene.add(this.flashLight);
    this.sprayGeo = new THREE.SphereGeometry(0.06, 5, 4);
    this.sprayMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.8 });
    this.drops = [];
  }

  _tracer(a, b, color = 0xfff2b0) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const mat = this.tracerMat.clone(); mat.color.setHex(color);
    const line = new THREE.Line(g, mat);
    this.scene.add(line);
    this.tracers.push({ line, t: 0.09 });
    this.flashLight.position.copy(a);
    this.flashLight.intensity = 30;
  }

  _spray(p, f) {
    if (this.drops.length > 120 || Math.random() < 0.4) return;
    const m = new THREE.Mesh(this.sprayGeo, this.sprayMat);
    m.position.set(p.x, p.y + 1.2, p.z);
    const dx = f.x - p.x, dz = f.z - p.z, d = Math.hypot(dx, dz) || 1;
    this.scene.add(m);
    this.drops.push({ m, v: new THREE.Vector3(dx / d * 6 + (Math.random() - 0.5), 2 + Math.random(), dz / d * 6 + (Math.random() - 0.5)), t: 0.7 });
  }

  _audio() { return (this._ac ??= new (window.AudioContext || window.webkitAudioContext)()); }

  _bang(vol = 1) {
    try {
      const ac = this._audio(), len = 0.25 * ac.sampleRate;
      const buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
      const src = ac.createBufferSource(); src.buffer = buf;
      const gain = ac.createGain(); gain.gain.value = 0.5 * vol;
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2200;
      src.connect(lp).connect(gain).connect(ac.destination); src.start();
    } catch { /* kein Ton */ }
  }

  _click() {
    try {
      const ac = this._audio(), o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 1800; g.gain.value = 0.05; o.connect(g).connect(ac.destination); o.start(); o.stop(ac.currentTime + 0.03);
    } catch { /* kein Ton */ }
  }

  _siren(sec, lo, hi) {
    try {
      const ac = this._audio(), o = ac.createOscillator(), g = ac.createGain();
      o.type = 'sawtooth'; g.gain.value = 0.04;
      const t0 = ac.currentTime;
      for (let t = 0; t < sec; t += 0.6) { o.frequency.setValueAtTime(lo, t0 + t); o.frequency.linearRampToValueAtTime(hi, t0 + t + 0.3); o.frequency.linearRampToValueAtTime(lo, t0 + t + 0.6); }
      g.gain.setValueAtTime(0.04, t0 + sec - 0.2); g.gain.linearRampToValueAtTime(0, t0 + sec);
      o.connect(g).connect(ac.destination); o.start(); o.stop(t0 + sec);
    } catch { /* kein Ton */ }
  }

  // ======================= pro Frame =======================

  update(dt, time) {
    // Verletzungen wirken
    if (!this.down) {
      if (this.injuries.blutung) this._tick(dt, 0.7, 'Blutung');
      if (this.injuries.brand) {
        this._tick(dt, 0.3, 'Verbrennung');
        this.injuries.brand -= dt;
        if (this.injuries.brand <= 0) { delete this.injuries.brand; this._renderHud(); }
      }
      if (!Object.keys(this.injuries).length && this.health < 100 && this.items.energy > 30) this.health = Math.min(100, this.health + dt * 0.15);   // langsame Erholung
    }
    // Kopfverletzung: unscharf und schwankend
    const k = this.injuries.kopf ? 0.5 + Math.sin(time * 1.3) * 0.5 : 0;
    this.headEl.style.backdropFilter = k > 0.05 ? `blur(${(k * 2.5).toFixed(2)}px)` : '';
    if (this.injuries.kopf) this.camera.rotation.z += Math.sin(time * 0.9) * 0.03;
    // Wölfe beissen
    this._biteT = (this._biteT ?? 0) - dt;
    if (this._biteT <= 0 && !this.down && !this.inVehicle()) {
      this._biteT = 1.2;
      const p = this.player.position;
      for (const a of this.animals.all ?? []) {
        if (a.dead || a.name !== 'wolf') continue;
        if (Math.hypot(a.root.position.x - p.x, a.root.position.z - p.z) < 1.6 && Math.random() < 0.35) {
          this.damage(9, 'Wolfsbiss', Math.random() < 0.4 ? 'blutung' : null);
          break;
        }
      }
    }
    this._updatePolice(dt);
    this._updateFire(dt, time);
    // Effekte
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i]; t.t -= dt;
      t.line.material.opacity = Math.max(0, t.t / 0.09);
      if (t.t <= 0) { this.scene.remove(t.line); t.line.geometry.dispose(); this.tracers.splice(i, 1); }
    }
    this.flashLight.intensity *= Math.exp(-dt * 30);
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i]; d.t -= dt;
      d.v.y -= 9.8 * dt; d.m.position.addScaledVector(d.v, dt);
      if (d.t <= 0) { this.scene.remove(d.m); this.drops.splice(i, 1); }
    }
    // Zinsen
    this.interestT += dt;
    if (this.interestT > 120) {
      this.interestT = 0;
      if (this.bank > 0) { const z = Math.max(1, Math.floor(this.bank * 0.01)); this.bank += z; this._save(); if (this.panel === 'bank') this._renderPanel(); }
    }
    this._hudT = (this._hudT ?? 0) - dt;
    if (this._hudT <= 0) { this._hudT = 0.25; this._renderHud(); }
  }

  _tick(dt, rate, cause) {
    this.health = Math.max(0, this.health - rate * dt);
    if (this.health <= 0) this._collapse(cause);
  }

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (!d) return;
      this.health = Math.max(20, Math.min(100, d.health ?? 100));
      this.injuries = d.injuries ?? {};
      for (const k of Object.keys(this.injuries)) if (!INJ[k]) delete this.injuries[k]; else if (this.injuries[k] === null) this.injuries[k] = Infinity;
      this.bank = d.bank | 0;
    } catch { /* neu anfangen */ }
  }

  _save() {
    try {
      const inj = {};
      for (const [k, v] of Object.entries(this.injuries)) inj[k] = Number.isFinite(v) ? v : null;
      localStorage.setItem(STORE_KEY, JSON.stringify({ health: Math.round(this.health), injuries: inj, bank: this.bank }));
    } catch { /* privat */ }
  }
}
