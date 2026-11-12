/*
 * Crafting: mit C öffnen. Rezepte verbrauchen Rohstoffe aus dem Inventar (items.js)
 * und legen das Ergebnis ins Inventar (oder vor die Füsse, wenn es voll ist).
 * Manche Rezepte brauchen eine Station in der Nähe (Lagerfeuer, Amboss, Werkbank).
 */

// { out, n, in: [[key, anzahl], …], at?: 'feuer' | 'amboss' | 'werkbank' }
const RECIPES = [
  { out: 'planken', n: 2, in: [['holz', 1]] },
  { out: 'torch_metal', n: 1, in: [['holz', 2]] },
  { out: 'tool_axe', n: 1, in: [['holz', 2], ['stein', 2]] },
  { out: 'tool_pickaxe', n: 1, in: [['holz', 2], ['stein', 3]] },
  { out: 'tool_shovel', n: 1, in: [['holz', 2], ['stein', 1]] },
  { out: 'tool_hammer', n: 1, in: [['holz', 1], ['stein', 2]] },
  { out: 'tool_hoe', n: 1, in: [['holz', 2], ['stein', 1]] },
  { out: 'arrow', n: 5, in: [['holz', 1], ['stein', 1]] },
  { out: 'verkaufsstand', n: 1, in: [['planken', 4], ['holz', 2]] },
  { out: 'bucket_wooden_1', n: 1, in: [['planken', 3]] },
  { out: 'shield_wooden', n: 1, in: [['planken', 4]] },
  { out: 'bow_wooden', n: 1, in: [['holz', 3], ['rope_1', 1]] },
  { out: 'axe_small', n: 1, in: [['holz', 2], ['stein', 3]], at: 'werkbank' },
  { out: 'pickaxe_bronze', n: 1, in: [['holz', 2], ['stein', 4]], at: 'werkbank' },
  { out: 'sword', n: 1, in: [['holz', 1], ['stein', 5]], at: 'amboss' },
  { out: 'dagger', n: 1, in: [['holz', 1], ['stein', 2]], at: 'amboss' },
  { out: 'hammer_double', n: 1, in: [['holz', 2], ['stein', 6]], at: 'amboss' },
  { out: 'meat_cooked', n: 1, in: [['rohfleisch', 1]], at: 'feuer' },
  { out: 'meat_ribs', n: 1, in: [['rohfleisch', 1], ['holz', 1]] },
  { out: 'bread', n: 1, in: [['corn', 2]], at: 'feuer' },
];
const STATION_NAME = { feuer: 'Lagerfeuer oder Fackel', amboss: 'Amboss', werkbank: 'Werkbank oder Amboss' };
const STATION_DIST = 6;

export class Crafting {
  /** stations(x, z) → Set der Stationen in der Nähe ('feuer', 'amboss', 'werkbank') */
  constructor({ items, player, stations = () => new Set(), onOpen = () => {} }) {
    Object.assign(this, { items, player, stations, onOpen });
    this.open = false;
    this._buildUi();
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyC') this.toggle();
      else if (e.code === 'Escape' && this.open) this.toggle(false);
    });
  }

  toggle(on = !this.open) {
    this.open = on;
    this.el.style.display = on ? 'block' : 'none';
    if (on) { this.onOpen(); this.render(); }
  }

  count(key) {
    let n = 0;
    for (const s of this.items.slots) if (s && s.key === key) n += s.n;
    return n;
  }

  take(key, n) {
    const slots = this.items.slots;
    for (let i = slots.length - 1; i >= 0 && n > 0; i--) {
      const s = slots[i];
      if (!s || s.key !== key) continue;
      const k = Math.min(n, s.n); s.n -= k; n -= k;
      if (s.n <= 0) slots[i] = null;
    }
  }

  nearStations() {
    const p = this.player.position;
    const set = new Set(this.stations(p.x, p.z, STATION_DIST));
    if (this.count('torch_metal') > 0) set.add('feuer');   // Fackel in der Tasche reicht zum Braten
    if (set.has('amboss')) set.add('werkbank');
    return set;
  }

  canMake(r, st = this.nearStations()) {
    return r.in.every(([k, n]) => this.count(k) >= n) && (!r.at || st.has(r.at));
  }

  make(i) {
    const r = RECIPES[i];
    if (!r) return;
    const st = this.nearStations();
    if (r.at && !st.has(r.at)) { this.items.say(`Dafür brauchst du: ${STATION_NAME[r.at]} in der Nähe.`); return; }
    const missing = r.in.filter(([k, n]) => this.count(k) < n);
    if (missing.length) {
      this.items.say(`Es fehlt: ${missing.map(([k, n]) => `${n - this.count(k)}× ${this.items.nameOf(k)}`).join(', ')}`);
      return;
    }
    for (const [k, n] of r.in) this.take(k, n);
    const rest = this.items._addToInventory(r.out, r.n);
    if (rest > 0) {
      const p = this.player.position;
      this.items.spawnDrop(r.out, rest, p.x + 0.8, p.z);
      this.items.say(`${this.items.nameOf(r.out)} hergestellt – Inventar voll, liegt am Boden.`);
    } else {
      this.items.say(`${r.n > 1 ? r.n + '× ' : ''}${this.items.nameOf(r.out)} hergestellt!`);
    }
    this.items._refreshHeld?.();
    this.items._renderUi?.();
    this.items._save?.();
    this.render();
  }

  _buildUi() {
    const css = document.createElement('style');
    css.textContent = `
#craft { position: fixed; right: 16px; top: 50%; transform: translateY(-50%); width: 340px; max-width: calc(100vw - 32px); box-sizing: border-box; max-height: 80vh; overflow: auto;
  background: rgba(20,22,28,.88); color: #eee; border: 1px solid rgba(255,255,255,.15); border-radius: 10px;
  font: 13px system-ui, sans-serif; padding: 10px 12px; z-index: 30; display: none; backdrop-filter: blur(6px); }
#craft h3 { margin: 0 0 4px; font-size: 15px; display: flex; justify-content: space-between; }
#craft h3 small { font-weight: 400; color: #aaa; }
#craft .cr-st { color: #aaa; font-size: 11px; margin-bottom: 8px; }
#craft .cr { display: flex; gap: 8px; align-items: center; padding: 6px 8px; margin: 3px 0; border-radius: 6px;
  background: rgba(255,255,255,.05); cursor: pointer; border: 1px solid transparent; }
#craft .cr:hover { border-color: rgba(255,255,255,.3); }
#craft .cr.ok { background: rgba(110,190,90,.18); }
#craft .cr.no { opacity: .55; }
#craft .cr b { min-width: 118px; }
#craft .cr span { color: #ccc; font-size: 12px; }
#craft .cr .miss { color: #ff9a8a; }
#craft .cr i { color: #ffd65c; font-style: normal; font-size: 11px; }`;
    document.head.appendChild(css);
    this.el = document.createElement('div');
    this.el.id = 'craft';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => {
      const row = e.target.closest('.cr');
      if (row) this.make(+row.dataset.i);
    });
  }

  render() {
    if (!this.open) return;
    const st = this.nearStations();
    const name = (k) => this.items.nameOf(k);
    const stTxt = st.size ? [...st].map((s) => ({ feuer: '🔥 Feuer', amboss: '⚒ Amboss', werkbank: '🪚 Werkbank' }[s])).join(' · ') : 'keine Station in der Nähe';
    const rows = RECIPES.map((r, i) => {
      const ok = this.canMake(r, st);
      const parts = r.in.map(([k, n]) => {
        const have = this.count(k);
        return `<span class="${have < n ? 'miss' : ''}">${n}× ${name(k)} (${have})</span>`;
      }).join(' + ');
      const at = r.at ? ` <i>@ ${STATION_NAME[r.at]}</i>` : '';
      return `<div class="cr ${ok ? 'ok' : 'no'}" data-i="${i}"><b>${r.n > 1 ? r.n + '× ' : ''}${name(r.out)}</b><div>${parts}${at}</div></div>`;
    }).join('');
    this.el.innerHTML = `<h3>Herstellen <small>C schliessen</small></h3><div class="cr-st">${stTxt}</div>${rows}`;
  }

  update() {
    if (!this.open) return;
    // nur neu zeichnen, wenn sich Inventar oder Stationen geändert haben (sonst flackert der Hover)
    const sig = this.items.slots.map((s) => s ? s.key + s.n : '-').join() + [...this.nearStations()].join();
    if (sig !== this._sig) { this._sig = sig; this.render(); }
  }
}
