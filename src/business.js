import * as THREE from 'three/webgpu';
import { priceOf, tradableKeys, categoryOf, CAT_COLOR } from './items.js';

/*
 * Handel & eigenes Business.
 *  - Geldbeutel: Münzen, die man aufhebt, wandern automatisch hinein (oben rechts angezeigt).
 *  - Händler: an jedem Marktstand H drücken → alles kaufen, Inventar verkaufen (Händler zahlt die Hälfte).
 *  - Eigener Verkaufsstand (herstellen mit C, aufstellen mit R): Ware einlegen, Preis festlegen –
 *    Dorfbewohner kommen vorbei und kaufen ein. Je günstiger, desto mehr Kundschaft.
 */

const STORE_KEY = 'spiel-business-v1';
const SHOP_DIST = 4.5;          // so nah muss man am Marktstand sein
const OWN_DIST = 3.5;           // … am eigenen Stand
const CUSTOMER_RANGE = 45;      // aus diesem Umkreis kommen Kunden
const SELL_SHARE = 0.5;         // Händler zahlt die Hälfte des Kaufpreises
const STAND_W = 2.6;
const BUY_LINES = ['Ich nehme {x}!', 'Einmal {x}, bitte.', '{x}? Perfekt!', 'Sieht lecker aus: {x}!', 'Gib mir {x}.'];
const NO_LINES = ['Viel zu teuer!', 'Für den Preis? Nein danke.', 'Hm … zu teuer.', 'Wucher!'];
const CAT_ORDER = ['Essen', 'Rohstoff', 'Werkzeug', 'Waffe', 'Schatz'];

export class Business {
  constructor({ scene, items, player, terrain, loader, npcs, shopsNear, getYaw }) {
    Object.assign(this, { scene, items, player, terrain, loader, npcs, shopsNear, getYaw });
    this.money = 0;
    this.earned = 0;              // Umsatz am eigenen Stand (gesamt)
    this.stands = [];             // { x, z, yaw, stock: [{ key, n, price }], cash, group, goods, spot }
    this.panel = null;            // 'shop' | 'stand'
    this.tab = 'kaufen';
    this.filter = '';
    this.customerT = 4;
    this._load();
    this._buildUi();
    items.onPlace = (key) => key === 'verkaufsstand' && this.placeStand();
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target?.tagName === 'INPUT') { if (e.code === 'Escape') this.close(); return; }
      if (e.code === 'KeyH') this.toggle();
      else if (e.code === 'Escape' && this.panel) this.close();
    });
  }

  async init() {
    try {
      const g = await this.loader.loadAsync('models/stadt/stall-green.glb');
      const raw = g.scene;
      raw.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      const box = new THREE.Box3().setFromObject(raw);
      const size = box.getSize(new THREE.Vector3());
      const s = STAND_W / Math.max(size.x, size.z);
      const c = box.getCenter(new THREE.Vector3());
      raw.scale.setScalar(s);
      raw.position.set(-c.x * s, -box.min.y * s, -c.z * s);
      this.standModel = raw;
      this.standH = size.y * s;
    } catch (err) {
      console.warn('[Business] Standmodell fehlt', err);
    }
    for (const st of this.stands) this._buildStand(st);
  }

  // ---------- Geld ----------

  addMoney(n) { this.money += n; this._renderMoney(); this._save(); }

  _absorbCoins() {
    // aufgehobene Münzen in den Geldbeutel
    let got = 0;
    const slots = this.items.slots;
    for (let i = 0; i < slots.length; i++) {
      if (slots[i]?.key === 'coin') { got += slots[i].n; slots[i] = null; }
    }
    if (got) {
      this.money += got;
      this.items._refreshHeld?.(); this.items._renderUi?.(); this.items._save?.();
      this._renderMoney(true); this._save();
    }
  }

  // ---------- eigener Stand ----------

  placeStand() {
    const p = this.player.position, yaw = this.getYaw();
    const x = p.x + Math.sin(yaw) * 2.4, z = p.z + Math.cos(yaw) * 2.4;
    if (this.stands.some((s) => Math.hypot(s.x - x, s.z - z) < 4)) { this.items.say('Hier steht schon ein Stand.'); return false; }
    // Kunden stehen auf der Seite des Spielers → Stand schaut zum Spieler
    const st = { x, z, yaw: yaw + Math.PI, stock: [], cash: 0 };
    this.stands.push(st);
    this._buildStand(st);
    this._save();
    this.items.say('Verkaufsstand aufgestellt! Stell dich davor und drück H, um Ware einzulegen.', 4);
    return true;
  }

  _buildStand(st) {
    const y = this.terrain.height(st.x, st.z);
    st.group = new THREE.Group();
    st.group.position.set(st.x, y, st.z);
    st.group.rotation.y = st.yaw;
    if (this.standModel) st.group.add(this.standModel.clone());
    else {
      const m = new THREE.Mesh(new THREE.BoxGeometry(STAND_W, 0.9, 1.1), new THREE.MeshStandardMaterial({ color: 0x9a6a3a }));
      m.position.y = 0.45; st.group.add(m);
    }
    st.goods = new THREE.Group();
    st.group.add(st.goods);
    // Schild mit Preis
    st.sign = document.createElement('div');
    st.sign.className = 'biz-sign';
    document.getElementById('labels')?.appendChild(st.sign);
    // Kundenplatz: 1.7 m vor dem Stand (Richtung, aus der der Spieler kam)
    st.spot = { x: st.x + Math.sin(st.yaw + Math.PI) * 1.7, z: st.z + Math.cos(st.yaw + Math.PI) * 1.7 };
    this.scene.add(st.group);
    this._refreshGoods(st);
  }

  _refreshGoods(st) {
    st.goods.clear();
    const keys = st.stock.filter((s) => s.n > 0).slice(0, 6);
    st.group.updateMatrixWorld(true);
    const ray = this._ray ??= new THREE.Raycaster();
    const model = st.group.children[0];
    keys.forEach((s, i) => {
      const proto = this.items.protos?.get(s.key);
      if (!proto) return;
      const lx = -0.8 + (i % 3) * 0.8, lz = i < 3 ? 0.1 : -0.25;
      // Tischhöhe per Strahl von oben (unter dem Dach) bestimmen
      const from = new THREE.Vector3(lx, 1.7, lz).applyMatrix4(st.group.matrixWorld);
      ray.set(from, new THREE.Vector3(0, -1, 0)); ray.far = 1.7;
      const hit = model ? ray.intersectObject(model, true)[0] : null;
      const y = hit ? hit.point.y - st.group.position.y : 0.9;
      // gut sichtbar: kleine Dinge auf ~25 cm vergrössern, grosse auf 50 cm verkleinern
      const big = Math.max(proto.hw * 2, proto.hd * 2, proto.h, 0.01);
      const k = Math.min(0.5, Math.max(0.25, big)) / big;
      const copies = Math.min(3, s.n);
      for (let c = 0; c < copies; c++) {
        const o = proto.ground.clone();
        o.scale.setScalar(k);
        o.position.set(lx + (c - (copies - 1) / 2) * 0.18, y + 0.01, lz + (c % 2) * 0.08);
        o.rotation.y = c * 1.3;
        st.goods.add(o);
      }
    });
  }

  _removeStand(st) {
    this.scene.remove(st.group);
    st.sign?.remove();
    this.stands.splice(this.stands.indexOf(st), 1);
    for (const s of st.stock) if (s.n > 0) {
      const rest = this.items._addToInventory(s.key, s.n);
      if (rest > 0) this.items.spawnDrop(s.key, rest, this.player.position.x + 0.6, this.player.position.z);
    }
    if (st.cash) this.addMoney(st.cash);
    const rest = this.items._addToInventory('verkaufsstand', 1);
    if (rest) this.items.spawnDrop('verkaufsstand', 1, st.x, st.z);
    this.items._refreshHeld?.(); this.items._renderUi?.(); this.items._save?.();
    this._save();
  }

  obstacles = function* (x, z) {
    for (const st of this.stands) {
      if (Math.abs(st.x - x) > 20 || Math.abs(st.z - z) > 20) continue;
      yield { type: 'obb', x: st.x, z: st.z, cos: Math.cos(st.yaw), sin: Math.sin(st.yaw), hw: STAND_W / 2 * 0.85, hd: 0.5, top: 2.5 };
    }
  };

  _nearStand() {
    const p = this.player.position;
    let best = null, bd = OWN_DIST;
    for (const st of this.stands) { const d = Math.hypot(st.x - p.x, st.z - p.z); if (d < bd) { bd = d; best = st; } }
    return best;
  }

  /** Kundschaft: freie Dorfbewohner in der Nähe laufen zum Stand und kaufen. */
  _customers(dt) {
    this.customerT -= dt;
    if (this.customerT > 0) return;
    this.customerT = 4 + Math.random() * 4;
    for (const st of this.stands) {
      const goods = st.stock.filter((s) => s.n > 0);
      if (!goods.length || st.waiting >= 2) continue;
      const free = this.npcs.all.filter((n) => !n.ko && !n.errand && n.state !== 'flee' &&
        Math.hypot(n.root.position.x - st.x, n.root.position.z - st.z) < CUSTOMER_RANGE);
      if (!free.length) continue;
      const npc = free[Math.floor(Math.random() * free.length)];
      st.waiting = (st.waiting ?? 0) + 1;
      const jitter = (Math.random() - 0.5) * 1.2;
      const side = { x: Math.cos(st.yaw) * jitter, z: -Math.sin(st.yaw) * jitter };
      npc.errand = {
        x: st.spot.x + side.x, z: st.spot.z + side.z, face: { x: st.x, z: st.z },
        arrive: (n) => { st.waiting--; this._sale(st, n); },
        cancel: () => { st.waiting--; },
      };
    }
  }

  _sale(st, npc) {
    const goods = st.stock.filter((s) => s.n > 0);
    if (!goods.length) { npc.say('Schon ausverkauft?'); return; }
    const s = goods[Math.floor(Math.random() * goods.length)];
    const base = priceOf(s.key), ratio = s.price / Math.max(1, base);
    const chance = ratio <= 1 ? 0.95 : Math.max(0.05, 1.55 - 0.6 * ratio);   // 1× → 95 %, 2× → 35 %, 2.5× → 5 %
    if (Math.random() > chance) { npc.say(NO_LINES[Math.floor(Math.random() * NO_LINES.length)]); return; }
    const amount = ratio < 0.8 && s.n > 1 && Math.random() < 0.5 ? 2 : 1;   // Schnäppchen → gleich zwei
    const n = Math.min(amount, s.n);
    s.n -= n;
    st.cash += s.price * n;
    this.earned += s.price * n;
    const name = this.items.nameOf(s.key);
    npc.say(BUY_LINES[Math.floor(Math.random() * BUY_LINES.length)].replace('{x}', n > 1 ? `${n}× ${name}` : name));
    const p = this.player.position;
    if (Math.hypot(p.x - st.x, p.z - st.z) < 30) this.items.say(`${npc.name} kauft ${n}× ${name} für ${s.price * n} Münzen.`);
    st.stock = st.stock.filter((q) => q.n > 0);
    this._refreshGoods(st);
    this._save();
    if (this.panel === 'stand') this.render();
  }

  // ---------- Panels ----------

  toggle() {
    if (this.panel) { this.close(); return; }
    const own = this._nearStand();
    if (own) { this.open('stand', own); return; }
    const p = this.player.position;
    if (this.shopsNear(p.x, p.z, SHOP_DIST)) { this.open('shop'); return; }
    this.items.say('Kein Händler hier – geh zu einem Marktstand (oder stell deinen eigenen Verkaufsstand auf).', 3);
  }

  open(kind, stand) {
    this.panel = kind; this.stand = stand ?? null;
    document.exitPointerLock?.();
    this.el.style.display = 'block';
    this.render();
  }

  close() { this.panel = null; this.el.style.display = 'none'; }

  _buildUi() {
    const css = document.createElement('style');
    css.textContent = `
#biz-money { position: fixed; right: 16px; top: 14px; z-index: 25; background: rgba(20,22,28,.75); color: #ffd65c;
  font: 700 15px system-ui, sans-serif; padding: 6px 12px; border-radius: 999px; transition: transform .15s; }
#biz-money.pop { transform: scale(1.2); }
#biz { position: fixed; left: 50%; top: 50%; transform: translate(-50%,-50%); width: 560px; max-width: calc(100vw - 32px);
  max-height: 82vh; overflow: auto; box-sizing: border-box; background: rgba(20,22,28,.92); color: #eee; z-index: 31;
  border: 1px solid rgba(255,255,255,.15); border-radius: 12px; font: 13px system-ui, sans-serif; padding: 12px 14px; display: none; }
#biz h3 { margin: 0 0 6px; font-size: 16px; display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
#biz h3 small { font-weight: 400; color: #aaa; font-size: 12px; }
#biz .tabs { display: flex; gap: 6px; margin: 6px 0 8px; }
#biz .tabs button, #biz .btn { background: rgba(255,255,255,.08); color: #eee; border: 1px solid rgba(255,255,255,.15);
  border-radius: 6px; padding: 5px 10px; cursor: pointer; font: inherit; }
#biz .tabs button.on { background: #3d7a3a; border-color: #5fb25a; }
#biz .btn:hover, #biz .tabs button:hover { border-color: rgba(255,255,255,.4); }
#biz input { width: 100%; box-sizing: border-box; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,.2);
  background: rgba(0,0,0,.3); color: #eee; font: inherit; margin-bottom: 6px; }
#biz .cat { margin: 8px 0 3px; font-weight: 700; font-size: 12px; }
#biz .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 4px; }
#biz .it { display: flex; justify-content: space-between; gap: 6px; padding: 5px 8px; border-radius: 6px; cursor: pointer;
  background: rgba(255,255,255,.05); border: 1px solid transparent; }
#biz .it:hover { border-color: rgba(255,255,255,.3); }
#biz .it.no { opacity: .45; }
#biz .it b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#biz .it span { color: #ffd65c; white-space: nowrap; }
#biz .row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; margin: 3px 0; border-radius: 6px; background: rgba(255,255,255,.05); }
#biz .row .nm { flex: 1; }
#biz .hint { color: #aaa; font-size: 12px; margin: 6px 0; }
.biz-sign { position: absolute; left: 0; top: 0; pointer-events: none; background: rgba(255,255,255,.9); color: #333;
  font: 700 11px system-ui, sans-serif; padding: 2px 7px; border-radius: 4px; white-space: nowrap; display: none; }`;
    document.head.appendChild(css);
    this.moneyEl = document.createElement('div');
    this.moneyEl.id = 'biz-money';
    document.body.appendChild(this.moneyEl);
    this._renderMoney();
    this.el = document.createElement('div');
    this.el.id = 'biz';
    document.body.appendChild(this.el);
    this.el.addEventListener('click', (e) => this._onClick(e));
    this.el.addEventListener('input', (e) => {
      if (e.target.id === 'biz-find') { this.filter = e.target.value.toLowerCase(); this._renderList(); }
    });
  }

  _renderMoney(pop) {
    this.moneyEl.textContent = `🪙 ${this.money}`;
    if (pop) { this.moneyEl.classList.add('pop'); setTimeout(() => this.moneyEl.classList.remove('pop'), 160); }
  }

  render() {
    if (!this.panel) return;
    if (this.panel === 'shop') {
      this.el.innerHTML = `<h3>Händler <small>🪙 ${this.money} · Klick = 1 · Shift+Klick = 5 · H/Esc schliessen</small></h3>
        <div class="tabs"><button data-tab="kaufen" class="${this.tab === 'kaufen' ? 'on' : ''}">Kaufen</button>
        <button data-tab="verkaufen" class="${this.tab === 'verkaufen' ? 'on' : ''}">Verkaufen</button></div>
        ${this.tab === 'kaufen' ? `<input id="biz-find" placeholder="Suchen … (z. B. Apfel, Schwert, Trank)" value="${this.filter}">` : ''}
        <div id="biz-list"></div>`;
      this._renderList();
      if (this.tab === 'kaufen') { const f = this.el.querySelector('#biz-find'); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
    } else {
      const st = this.stand;
      const stock = st.stock.map((s, i) => `<div class="row"><span class="nm">${s.n}× ${this.items.nameOf(s.key)}
          <small style="color:#aaa">(Richtpreis ${priceOf(s.key)})</small></span>
          <button class="btn" data-price="${i}" data-d="-1">−</button><b style="color:#ffd65c;min-width:52px;text-align:center">${s.price} 🪙</b>
          <button class="btn" data-price="${i}" data-d="1">+</button><button class="btn" data-back="${i}">zurück</button></div>`).join('')
        || '<div class="hint">Noch keine Ware. Klick unten auf etwas aus deinem Inventar, um es in den Stand zu legen.</div>';
      const inv = this.items.slots.map((s, i) => s && s.key !== 'verkaufsstand'
        ? `<div class="it" data-put="${i}"><b>${s.n}× ${this.items.nameOf(s.key)}</b><span>${priceOf(s.key)} 🪙</span></div>` : '').join('');
      this.el.innerHTML = `<h3>Mein Verkaufsstand <small>Umsatz gesamt: ${this.earned} 🪙 · H/Esc schliessen</small></h3>
        <div class="row"><span class="nm">Kasse: <b style="color:#ffd65c">${st.cash} 🪙</b></span>
          <button class="btn" data-cash="1">Kasse leeren</button><button class="btn" data-remove="1">Stand abbauen</button></div>
        <div class="cat">Im Angebot</div>${stock}
        <div class="hint">Dorfbewohner in der Nähe kommen vorbei und kaufen. Richtpreis oder günstiger → fast alle kaufen; doppelter Preis → nur wenige.</div>
        <div class="cat">Ware einlegen (ganzer Stapel)</div><div class="grid">${inv || '<div class="hint">Inventar leer.</div>'}</div>`;
    }
  }

  _renderList() {
    const list = this.el.querySelector('#biz-list');
    if (!list) return;
    if (this.tab === 'kaufen') {
      const keys = tradableKeys().filter((k) => !this.filter || this.items.nameOf(k).toLowerCase().includes(this.filter));
      const byCat = {};
      for (const k of keys) (byCat[categoryOf(k)] ??= []).push(k);
      list.innerHTML = CAT_ORDER.filter((c) => byCat[c]).map((c) => `<div class="cat" style="color:${CAT_COLOR[c]}">${c} (${byCat[c].length})</div>
        <div class="grid">${byCat[c].map((k) => `<div class="it ${priceOf(k) > this.money ? 'no' : ''}" data-buy="${k}">
          <b>${this.items.nameOf(k)}</b><span>${priceOf(k)} 🪙</span></div>`).join('')}</div>`).join('')
        || '<div class="hint">Nichts gefunden.</div>';
    } else {
      const inv = this.items.slots.map((s, i) => s
        ? `<div class="it" data-sell="${i}"><b>${s.n}× ${this.items.nameOf(s.key)}</b><span>+${Math.max(1, Math.floor(priceOf(s.key) * SELL_SHARE))} 🪙</span></div>` : '').join('');
      list.innerHTML = `<div class="hint">Der Händler zahlt die Hälfte. Mit einem eigenen Verkaufsstand verdienst du mehr!</div>
        <div class="grid">${inv || '<div class="hint">Inventar leer.</div>'}</div>`;
    }
  }

  _invChanged() {
    this.items._refreshHeld?.(); this.items._renderUi?.(); this.items._save?.();
    this._renderMoney(true); this._save();
  }

  _onClick(e) {
    const d = e.target.closest('[data-tab],[data-buy],[data-sell],[data-put],[data-price],[data-back],[data-cash],[data-remove]')?.dataset;
    if (!d) return;
    if (d.tab) { this.tab = d.tab; this.render(); return; }
    if (d.buy) {
      const want = e.shiftKey ? 5 : 1, price = priceOf(d.buy);
      const n = Math.min(want, Math.floor(this.money / price));
      if (n <= 0) { this.items.say(`Zu wenig Geld – ${this.items.nameOf(d.buy)} kostet ${price} Münzen.`); return; }
      const rest = this.items._addToInventory(d.buy, n);
      const got = n - rest;
      if (!got) { this.items.say('Dein Inventar ist voll.'); return; }
      this.money -= got * price;
      this.items.say(`${got}× ${this.items.nameOf(d.buy)} gekauft (−${got * price} Münzen).`);
      this._invChanged(); this._renderList(); this._updateHeader();
      return;
    }
    if (d.sell) {
      const s = this.items.slots[+d.sell];
      if (!s) return;
      const n = e.shiftKey ? s.n : 1, each = Math.max(1, Math.floor(priceOf(s.key) * SELL_SHARE));
      s.n -= n; if (s.n <= 0) this.items.slots[+d.sell] = null;
      this.money += n * each;
      this.items.say(`${n}× ${this.items.nameOf(s.key)} verkauft (+${n * each} Münzen).`);
      this._invChanged(); this.render();
      return;
    }
    const st = this.stand;
    if (!st) return;
    if (d.put) {
      const s = this.items.slots[+d.put];
      if (!s) return;
      const have = st.stock.find((q) => q.key === s.key);
      if (have) have.n += s.n; else st.stock.push({ key: s.key, n: s.n, price: priceOf(s.key) });
      this.items.slots[+d.put] = null;
      this._refreshGoods(st); this._invChanged(); this.render();
    } else if (d.price) {
      const s = st.stock[+d.price];
      s.price = Math.max(1, s.price + (+d.d) * (e.shiftKey ? 5 : 1));
      this._save(); this.render();
    } else if (d.back) {
      const s = st.stock[+d.back];
      const rest = this.items._addToInventory(s.key, s.n);
      s.n = rest;
      st.stock = st.stock.filter((q) => q.n > 0);
      this._refreshGoods(st); this._invChanged(); this.render();
    } else if (d.cash) {
      if (!st.cash) return;
      this.items.say(`+${st.cash} Münzen aus der Kasse.`);
      this.money += st.cash; st.cash = 0;
      this._invChanged(); this.render();
    } else if (d.remove) {
      this._removeStand(st); this.close();
      this.items.say('Stand abgebaut – Ware und Kasse sind bei dir.');
      this._renderMoney(true);
    }
  }

  _updateHeader() {
    const h = this.el.querySelector('h3 small');
    if (h) h.textContent = `🪙 ${this.money} · Klick = 1 · Shift+Klick = 5 · H/Esc schliessen`;
  }

  // ---------- Speicher ----------

  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
      if (!d) return;
      this.money = d.money | 0; this.earned = d.earned | 0;
      this.stands = (d.stands ?? []).map((s) => ({ x: s.x, z: s.z, yaw: s.yaw, cash: s.cash | 0, stock: s.stock ?? [] }));
    } catch { /* leer anfangen */ }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        money: this.money, earned: this.earned,
        stands: this.stands.map((s) => ({ x: s.x, z: s.z, yaw: s.yaw, cash: s.cash, stock: s.stock })),
      }));
    } catch { /* privat-Modus */ }
  }

  // ---------- pro Frame ----------

  update(dt, camera) {
    this._absorbCoins();
    this._customers(dt);
    // Preisschilder über den Ständen
    const p = this.player.position, w = innerWidth, h = innerHeight;
    for (const st of this.stands) {
      const d = Math.hypot(p.x - st.x, p.z - st.z);
      if (d > 18 || !st.sign) { if (st.sign) st.sign.style.display = 'none'; continue; }
      const v = this._v ??= new THREE.Vector3();
      v.set(st.x, st.group.position.y + (this.standH ?? 2.2) + 0.25, st.z).project(camera);
      if (v.z > 1) { st.sign.style.display = 'none'; continue; }
      const n = st.stock.reduce((a, s) => a + s.n, 0);
      st.sign.textContent = n ? `Mein Stand · ${n} Waren · Kasse ${st.cash} 🪙` : `Mein Stand · leer${st.cash ? ` · Kasse ${st.cash} 🪙` : ''}`;
      st.sign.style.display = 'block';
      st.sign.style.transform = `translate(-50%, -100%) translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px)`;
    }
  }
}
