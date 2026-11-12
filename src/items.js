import * as THREE from 'three/webgpu';
import { mulberry32, hash2 } from './world/noise.js';
import { CHUNK_SIZE, SEA_LEVEL } from './world/terrain.js';

/*
 * Gegenstände: Waffen, Werkzeuge, Essen, Schätze – liegen in der Welt, lassen sich aufheben,
 * in der Schnellleiste (Hotbar) tragen, in der Hand halten, essen, trinken und schwingen.
 * Modelle: Kenney / Quaternius (CC0) unter public/models/items/ und public/models/survival/.
 *
 * Tasten (nur zu Fuss, nicht beim Tippen in Eingabefeldern):
 *   F = aufheben / Truhe öffnen · 1–9 = Fach wählen · Q = nächstes Fach
 *   G = ausgewählten Gegenstand fallen lassen · R = benutzen (essen, trinken, schwingen, zielen)
 *
 * Alles in der Welt ist deterministisch pro Chunk (Seed, cx, cz, eigenes Salz). Aufgehobene
 * Gegenstände merken wir uns per ID (auch im localStorage) → sie tauchen nie wieder auf.
 */

const SALT = 0x17e5a1;            // eigenes Salz für hash2 (unabhängig von Deko/NPCs)
const PICK_DIST = 2.0;            // Reichweite zum Aufheben (m)
const ACTIVE_DIST = 80;           // weiter weg: unsichtbar, keine Animation
const MAX_PER_CHUNK = 25;         // höchstens so viele lose Gegenstände pro Chunk
const STACK_MAX = 20;             // Essen, Münzen, Tränke, Pfeile stapeln bis 20
const SLOTS = 9;
const STORE_KEY = 'spiel-inventar-v1';
const START_CLEAR = 60;           // Wildnis-Regeln erst ausserhalb des Startdorfs
const ENERGY_DECAY = 0.08;        // Energie pro Sekunde (100 → 0 in ~21 min)
const IDLE_MAX = 0.45;            // kleinere Gegenstände drehen sich langsam und wippen 2 cm

const TAU = Math.PI * 2;

/*
 * ---------- Katalog ----------
 * f: Datei unter /models/ · n: Name · s: Kurzname (Hotbar) · c: Kategorie · size: längste Kante (m)
 * pick: aufhebbar · stack: stapelbar · lie: 'x' | 'z' → zum Hinlegen um diese Achse kippen
 * hold: Griff-Art ('blade' | 'palm' | 'bow' | 'shield') · grip: Griffhöhe im Modell (rohe Y-Koordinate)
 * flip: Klinge/Kopf zeigt im Modell nach −X · e: Energie beim Essen · drink: wird getrunken
 * gives: [Schlüssel, Anzahl] – z. B. Münzhaufen → Münzen
 *
 * Griffhöhen per Node-Skript aus den GLB-Vertices gemessen (Breite der Klinge entlang Y:
 * schmal = Griff, breit = Parierstange/Kopf).
 */
const W = 'Waffe', T = 'Werkzeug', E = 'Essen', S = 'Schatz', D = 'Deko', R = 'Rohstoff';
const IT = 'items/';
const CATALOG = {
  // ---- Waffen ----
  sword:            { f: IT + 'waffen/sword', n: 'Schwert', c: W, size: 1.0, pick: true, lie: 'x', hold: 'blade', grip: -0.08 },
  sword_golden:     { f: IT + 'waffen/sword_golden', n: 'Goldschwert', c: W, size: 1.0, pick: true, lie: 'x', hold: 'blade', grip: -0.08 },
  sword_big:        { f: IT + 'waffen/sword_big', n: 'Langschwert', c: W, size: 1.4, pick: true, lie: 'x', hold: 'blade', grip: 0.2 },
  sword_big_golden: { f: IT + 'waffen/sword_big_golden', n: 'Goldenes Langschwert', s: 'Gold-Lang­schwert', c: W, size: 1.4, pick: true, lie: 'x', hold: 'blade', grip: 0.2 },
  sword_bronze:     { f: IT + 'waffen/sword_bronze', n: 'Bronzeschwert', s: 'Bronze­schwert', c: W, size: 0.9, pick: true, lie: 'x', hold: 'blade', grip: -0.08 },
  dagger:           { f: IT + 'waffen/dagger', n: 'Dolch', c: W, size: 0.35, pick: true, lie: 'x', hold: 'blade', grip: -0.16 },
  dagger_golden:    { f: IT + 'waffen/dagger_golden', n: 'Goldener Dolch', s: 'Golddolch', c: W, size: 0.35, pick: true, lie: 'x', hold: 'blade', grip: -0.16 },
  axe_small:        { f: IT + 'waffen/axe_small', n: 'Axt', c: W, size: 0.8, pick: true, lie: 'x', hold: 'blade', grip: -0.45 },
  axe_double:       { f: IT + 'waffen/axe_double', n: 'Doppelaxt', c: W, size: 1.0, pick: true, lie: 'x', hold: 'blade', grip: -0.45 },
  axe_bronze:       { f: IT + 'waffen/axe_bronze', n: 'Bronzeaxt', c: W, size: 0.7, pick: true, lie: 'x', hold: 'blade', grip: -0.25, flip: true },
  hammer_double:    { f: IT + 'waffen/hammer_double', n: 'Kriegshammer', s: 'Kriegs­hammer', c: W, size: 1.1, pick: true, lie: 'x', hold: 'blade', grip: -0.55 },
  bow_wooden:       { f: IT + 'waffen/bow_wooden', n: 'Holzbogen', c: W, size: 1.2, pick: true, lie: 'x', hold: 'bow', grip: 0 },
  bow_golden:       { f: IT + 'waffen/bow_golden', n: 'Goldbogen', c: W, size: 1.3, pick: true, lie: 'x', hold: 'bow', grip: 0 },
  arrow:            { f: IT + 'waffen/arrow', n: 'Pfeil', c: W, size: 0.75, pick: true, stack: true, lie: 'x', hold: 'blade', grip: -0.1 },
  dart:             { f: IT + 'waffen/dart', n: 'Wurfpfeil', c: W, size: 0.3, pick: true, stack: true, lie: 'x', hold: 'blade', grip: -0.05 },
  shield_wooden:    { f: IT + 'waffen/shield_wooden', n: 'Holzschild', c: W, size: 0.6, pick: true, lie: 'x', hold: 'shield' },
  weaponstand:      { f: IT + 'waffen/weaponstand', n: 'Waffenständer', c: D, size: 1.6 },
  // ---- Werkzeuge ----
  pickaxe_bronze:   { f: IT + 'werkzeuge/pickaxe_bronze', n: 'Spitzhacke', s: 'Spitz­hacke', c: T, size: 0.8, pick: true, lie: 'x', hold: 'blade', grip: -0.35 },
  torch_metal:      { f: IT + 'werkzeuge/torch_metal', n: 'Fackel', c: T, size: 0.5, pick: true, lie: 'x', hold: 'blade', grip: -0.2 },
  bucket_wooden_1:  { f: IT + 'werkzeuge/bucket_wooden_1', n: 'Eimer', c: T, size: 0.35, pick: true, hold: 'palm' },
  rope_1:           { f: IT + 'werkzeuge/rope_1', n: 'Seil', c: T, size: 0.4, pick: true, hold: 'palm' },
  key_gold:         { f: IT + 'werkzeuge/key_gold', n: 'Goldschlüssel', s: 'Gold­schlüssel', c: T, size: 0.12, pick: true, hold: 'palm' },
  whetstone:        { f: IT + 'werkzeuge/whetstone', n: 'Schleifstein', c: D, size: 1.0 },
  anvil:            { f: IT + 'werkzeuge/anvil', n: 'Amboss', c: D, size: 0.7 },
  cauldron:         { f: IT + 'werkzeuge/cauldron', n: 'Kessel', c: D, size: 0.8 },
  tool_axe:         { f: 'survival/tool-axe', n: 'Handaxt', c: T, size: 0.6, pick: true, lie: 'x', hold: 'blade', grip: 0.08, flip: true },
  tool_hammer:      { f: 'survival/tool-hammer', n: 'Hammer', c: T, size: 0.35, pick: true, lie: 'x', hold: 'blade', grip: 0.045 },
  tool_pickaxe:     { f: 'survival/tool-pickaxe', n: 'Pickel', c: T, size: 0.7, pick: true, lie: 'x', hold: 'blade', grip: 0.07 },
  tool_shovel:      { f: 'survival/tool-shovel', n: 'Schaufel', c: T, size: 1.1, pick: true, lie: 'x', hold: 'blade', grip: 0.17 },
  tool_hoe:         { f: 'survival/tool-hoe', n: 'Hacke', c: T, size: 1.2, pick: true, lie: 'x', hold: 'blade', grip: 0.12, flip: true },
  // ---- Essen (Kenney) ----
  apple:            { f: IT + 'essen/apple', n: 'Apfel', c: E, size: 0.08, e: 10 },
  banana:           { f: IT + 'essen/banana', n: 'Banane', c: E, size: 0.2, e: 12 },
  bread:            { f: IT + 'essen/bread', n: 'Brot', c: E, size: 0.3, e: 25 },
  cheese:           { f: IT + 'essen/cheese', n: 'Käse', c: E, size: 0.25, e: 20 },
  carrot:           { f: IT + 'essen/carrot', n: 'Karotte', c: E, size: 0.2, e: 8, lie: 'z' },
  burger:           { f: IT + 'essen/burger', n: 'Burger', c: E, size: 0.12, e: 30 },
  pizza:            { f: IT + 'essen/pizza', n: 'Pizza', c: E, size: 0.35, e: 35 },
  fish:             { f: IT + 'essen/fish', n: 'Fisch', c: E, size: 0.3, e: 18 },
  meat_cooked:      { f: IT + 'essen/meat-cooked', n: 'Braten', c: E, size: 0.25, e: 30 },
  meat_ribs:        { f: IT + 'essen/meat-ribs', n: 'Rippchen', c: E, size: 0.25, e: 28 },
  whole_ham:        { f: IT + 'essen/whole-ham', n: 'Schinken', c: E, size: 0.35, e: 40 },
  cake:             { f: IT + 'essen/cake', n: 'Kuchen', c: E, size: 0.3, e: 30 },
  donut:            { f: IT + 'essen/donut-sprinkles', n: 'Donut', c: E, size: 0.12, e: 15 },
  croissant:        { f: IT + 'essen/croissant', n: 'Gipfeli', c: E, size: 0.15, e: 15 },
  grapes:           { f: IT + 'essen/grapes', n: 'Trauben', c: E, size: 0.15, e: 10 },
  watermelon:       { f: IT + 'essen/watermelon', n: 'Wassermelone', s: 'Wasser­melone', c: E, size: 0.35, e: 25 },
  pumpkin:          { f: IT + 'essen/pumpkin', n: 'Kürbis', c: E, size: 0.35, e: 20 },
  corn:             { f: IT + 'essen/corn', n: 'Maiskolben', s: 'Mais', c: E, size: 0.2, e: 12 },
  mushroom:         { f: IT + 'essen/mushroom', n: 'Pilz', c: E, size: 0.08, e: 6 },
  egg:              { f: IT + 'essen/egg', n: 'Ei', c: E, size: 0.06, e: 8 },
  sandwich:         { f: IT + 'essen/sandwich', n: 'Sandwich', c: E, size: 0.14, e: 22 },
  hot_dog:          { f: IT + 'essen/hot-dog', n: 'Hotdog', c: E, size: 0.18, e: 20 },
  ice_cream:        { f: IT + 'essen/ice-cream', n: 'Glace', c: E, size: 0.15, e: 12 },
  pear:             { f: IT + 'essen/pear', n: 'Birne', c: E, size: 0.1, e: 10 },
  strawberry:       { f: IT + 'essen/strawberry', n: 'Erdbeere', c: E, size: 0.04, e: 5 },
  orange:           { f: IT + 'essen/orange', n: 'Orange', c: E, size: 0.08, e: 10 },
  cookie:           { f: IT + 'essen/cookie', n: 'Guetzli', c: E, size: 0.07, e: 8 },
  pie:              { f: IT + 'essen/pie', n: 'Wähe', c: E, size: 0.3, e: 30 },
  juice:            { f: IT + 'essen/wine-red', n: 'Traubensaft', s: 'Trauben­saft', c: E, size: 0.3, e: 8, drink: true },
  soda:             { f: IT + 'essen/soda-can', n: 'Limonade', c: E, size: 0.12, e: 8, drink: true },
  mug:              { f: IT + 'essen/mug', n: 'Tee', c: E, size: 0.12, e: 6, drink: true },
  baguette:         { f: IT + 'essen/loaf-baguette', n: 'Baguette', c: E, size: 0.6, e: 25 },
  sausage:          { f: IT + 'essen/sausage', n: 'Wurst', c: E, size: 0.15, e: 18 },
  taco:             { f: IT + 'essen/taco', n: 'Taco', c: E, size: 0.15, e: 18 },
  // ---- Essen (Quaternius) ----
  chickenleg:       { f: IT + 'essen/chickenleg', n: 'Pouletschenkel', s: 'Poulet', c: E, size: 0.18, e: 22 },
  barrel_apples:    { f: IT + 'essen/barrel_apples', n: 'Apfelfass', c: D, size: 0.9 },
  farmcrate_apple:  { f: IT + 'essen/farmcrate_apple', n: 'Apfelkiste', c: D, size: 0.7 },
  farmcrate_carrot: { f: IT + 'essen/farmcrate_carrot', n: 'Karottenkiste', c: D, size: 0.7 },
  // ---- Schätze ----
  potion_red:       { f: IT + 'schaetze/potion1_filled', n: 'Heiltrank', c: S, size: 0.2, pick: true, stack: true, hold: 'palm', drink: true, e: 30, msg: 'Du fühlst dich wie neu!' },
  potion_blue:      { f: IT + 'schaetze/potion2_filled', n: 'Krafttrank', c: S, size: 0.22, pick: true, stack: true, hold: 'palm', drink: true, e: 20, msg: 'Du fühlst dich stark!' },
  potion_green:     { f: IT + 'schaetze/potion3_filled', n: 'Zaubertrank', s: 'Zauber­trank', c: S, size: 0.22, pick: true, stack: true, hold: 'palm', drink: true, e: 15, msg: 'Alles funkelt ein bisschen …' },
  potion_purple:    { f: IT + 'schaetze/potion4_filled', n: 'Ausdauertrank', s: 'Ausdauer­trank', c: S, size: 0.22, pick: true, stack: true, hold: 'palm', drink: true, e: 40, msg: 'Du könntest ewig laufen!' },
  coin:             { f: IT + 'schaetze/coin', n: 'Münze', c: S, size: 0.03, pick: true, stack: true, lie: 'x', hold: 'palm' },
  coin_pile:        { f: IT + 'schaetze/coin_pile', n: 'Münzhaufen', c: S, size: 0.15, pick: true, gives: 'coin', hold: 'palm' },
  gold_ingots:      { f: IT + 'schaetze/gold_ingots', n: 'Goldbarren', c: S, size: 0.3, pick: true, hold: 'palm', msg: 'Schwer und glänzend!' },
  crown:            { f: IT + 'schaetze/crown', n: 'Krone', c: S, size: 0.25, pick: true, hold: 'palm', msg: 'Eine Krone – wie für einen König!' },
  key1:             { f: IT + 'schaetze/key1', n: 'Schlüssel', c: S, size: 0.15, pick: true, hold: 'palm', msg: 'Welche Tür der wohl öffnet?' },
  scroll:           { f: IT + 'schaetze/scroll', n: 'Schriftrolle', s: 'Schrift­rolle', c: S, size: 0.3, pick: true, hold: 'palm', msg: '«Hinter den Hügeln liegt mehr Gold.»' },
  book:             { f: IT + 'schaetze/book1_closed', n: 'Buch', c: S, size: 0.25, pick: true, lie: 'z', hold: 'palm', msg: 'Ein altes Buch voller Karten.' },
  crystal:          { f: IT + 'schaetze/crystal1', n: 'Kristall', c: S, size: 0.2, pick: true, hold: 'palm', msg: 'Der Kristall leuchtet schwach.' },
  necklace:         { f: IT + 'schaetze/necklace1', n: 'Halskette', c: S, size: 0.15, pick: true, hold: 'palm', msg: 'Eine wertvolle Halskette.' },
  ring:             { f: IT + 'schaetze/ring1', n: 'Ring', c: S, size: 0.03, pick: true, lie: 'x', hold: 'palm', msg: 'Ein goldener Ring.' },
  // ---- Rohstoffe (fallen beim Zerstören heraus) ----
  holz:             { f: 'survival/resource-wood', n: 'Holz', c: R, size: 0.7, pick: true, stack: true, hold: 'palm', msg: 'Gutes Brennholz.' },
  planken:          { f: 'survival/resource-planks', n: 'Bretter', c: R, size: 1.0, pick: true, stack: true, hold: 'palm', msg: 'Damit liesse sich etwas bauen.' },
  stein:            { f: 'survival/resource-stone', n: 'Stein', c: R, size: 0.4, pick: true, stack: true, hold: 'palm', msg: 'Ein schwerer Stein.' },
  rohfleisch:       { f: IT + 'essen/meat-cooked', n: 'Fleisch', c: E, size: 0.25, e: 18 },
  chest_wood:       { f: IT + 'schaetze/chest_wood', n: 'Truhe', c: D, size: 0.9 },
  chest_open:       { f: IT + 'schaetze/chest_ingots', n: 'Offene Truhe', c: D, size: 0.85 },
};
// Essen und Getränke: immer aufhebbar, stapelbar, liegen in der Handfläche
for (const def of Object.values(CATALOG)) {
  if (def.c === E) { def.pick = true; def.stack = true; def.hold = 'palm'; }
  def.s ??= def.n;
}

// Gruppen für die Platzierung
const MARKET_FOOD = ['bread', 'cheese', 'fish', 'pumpkin', 'watermelon', 'sausage', 'baguette', 'pie', 'grapes', 'pear', 'corn', 'egg', 'orange', 'banana', 'strawberry', 'croissant', 'cake'];
const CAMP_FOOD = ['bread', 'fish', 'sausage', 'meat_cooked', 'meat_ribs', 'chickenleg', 'apple', 'mug', 'whole_ham', 'corn', 'hot_dog'];
const CAMP_TOOLS = ['torch_metal', 'tool_axe', 'rope_1', 'bucket_wooden_1', 'tool_hammer', 'tool_shovel'];
const VILLAGE_TOOLS = ['pickaxe_bronze', 'tool_hammer', 'tool_shovel', 'tool_hoe', 'tool_pickaxe', 'bucket_wooden_1', 'rope_1', 'torch_metal'];
const STAND_WEAPONS = ['sword', 'sword', 'axe_small', 'bow_wooden', 'sword_bronze', 'axe_double', 'dagger', 'hammer_double', 'axe_bronze', 'sword_big', 'shield_wooden'];
const TREASURE = ['coin_pile', 'coin_pile', 'potion_red', 'potion_blue', 'potion_green', 'potion_purple', 'gold_ingots', 'crystal', 'necklace', 'ring', 'key1', 'scroll', 'book', 'dagger_golden', 'sword_golden'];
const RARE_TREASURE = ['crown', 'sword_big_golden', 'bow_golden'];

/*
 * ---------- Griff an der Hand ----------
 * Achsen des Handknochens 'hand_r' (MPFB game_engine Rig), gemessen aus der Ruhepose in figur.glb
 * (Node-Skript: Weltpositionen der Fingerknochen in den lokalen Raum von hand_r umgerechnet):
 *   middle_01_r (0, 0.115, 0)          → +Y zeigt zu den Fingern (Knöchelrichtung der Faust)
 *   index_01 − pinky_01 ≈ (0.82, 0, 0.58) → Daumen-/Speichenseite
 *   middle_03 − middle_01 ≈ (−0.6, +, 0.8) → Finger krümmen sich dorthin = Handflächen-Normale
 * Linke Hand: gespiegelt (X-Komponente negiert).
 *
 * Griff-Arten (Modellachse → Handachse):
 *   blade:  Stiel/Klinge (+Y) → Daumenseite (leicht zu den Fingern gekippt), Schneide/Kopf (+X) → Knöchel,
 *           Griffpunkt (0, grip, 0) liegt in der Faust: Hand (0, 0.075, 0) + 2 cm Richtung Handfläche
 *   palm:   Modell-Oberseite (+Y) → Handflächen-Normale, Unterseite liegt 3.5 cm vor der Handfläche
 *   bow:    linke Hand, Bogen (+Y) → Daumenseite, Bogenrücken (−X) → Knöchel, Mitte in der Faust
 *   shield: linke Hand, Vorderseite (+Z) → Handrücken (nach aussen), Oberkante (+Y) → Daumenseite
 */
const HAND = {
  fingers: new THREE.Vector3(0, 1, 0),
  radial: new THREE.Vector3(0.82, 0, 0.58).normalize(),
  palm: new THREE.Vector3(-0.58, 0, 0.82).normalize(),
  fist: new THREE.Vector3(0, 0.075, 0),
};
const HOLD_SIDE = { blade: 'r', palm: 'r', bow: 'l', shield: 'l' };

// Pose-Zusätze in Grad (zu den Editor-Einstellungen addiert), je Griff-Art
const HOLD_POSE = {
  blade: { armForward: { l: 0, r: 10 }, elbowBend: { l: 0, r: 30 } },
  palm: { armForward: { l: 0, r: 10 }, elbowBend: { l: 0, r: 60 }, handTwist: { l: 0, r: 40 } },   // + = Daumen nach aussen → Handfläche nach oben
  bow: { armForward: { l: 10, r: 0 }, elbowBend: { l: 20, r: 0 } },
  shield: { armForward: { l: 8, r: 0 }, elbowBend: { l: 55, r: 0 }, elbowOut: { l: 8, r: 0 } },
};
// Zielen (R mit Bogen) / Schild heben (R mit Schild)
const AIM_POSE = {
  bow: { armForward: { l: 80, r: 70 }, elbowBend: { l: 5, r: 110 }, elbowOut: { l: 5, r: 25 }, shoulderUp: { l: 5, r: 8 } },
  shield: { armForward: { l: 40, r: 0 }, elbowBend: { l: 85, r: 0 }, elbowOut: { l: 20, r: 0 } },
};
// Kurze Bewegungen: Schlüsselbilder (Zeit 0…1) für die rechte Seite, zusätzlich zur Haltepose
const ACTIONS = {
  swing: { dur: 0.35, times: [0, 0.3, 0.65, 1],
    r: { armForward: [0, 35, -25, 0], elbowBend: [0, 65, -25, 0], elbowOut: [0, 20, 0, 0], shoulderUp: [0, 12, 0, 0] } },
  eat: { dur: 0.6, times: [0, 0.35, 0.75, 1],
    r: { armForward: [0, 20, 20, 0], elbowBend: [0, 70, 70, 0], wristBend: [0, 20, 20, 0] } },
};
const POSE_KEYS = ['armForward', 'elbowBend', 'elbowOut', 'handTwist', 'wristBend', 'shoulderUp'];

const CAT_COLOR = { Waffe: '#ff8f7d', Werkzeug: '#8ec5ff', Essen: '#9fe27f', Schatz: '#ffd65c', Deko: '#cccccc', Rohstoff: '#d9b38c' };

// Wiederverwendete Hilfsobjekte (keine Allokationen in heissen Pfaden)
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _box = new THREE.Box3();
const _mx = new THREE.Vector3(), _my = new THREE.Vector3(), _mz = new THREE.Vector3(), _mat = new THREE.Matrix4();

/** Einfacher String-Hash (für Zufall pro Truhe). */
function hashStr(s, seed) {
  let h = seed | 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Weiche Interpolation zwischen Schlüsselbildern. */
function keyed(times, vals, t) {
  for (let i = 0; i < times.length - 1; i++) {
    if (t <= times[i + 1]) {
      let u = (t - times[i]) / (times[i + 1] - times[i]);
      u = u * u * (3 - 2 * u);
      return vals[i] + (vals[i + 1] - vals[i]) * u;
    }
  }
  return vals[vals.length - 1];
}

/**
 * Pose-Zusätze zu den Editor-Einstellungen addieren (wie withRidePose in main.js).
 * out wird wiederverwendet → keine Allokation pro Bild. Ohne Zusätze kommt settings zurück.
 */
export function addPoseOffsets(settings, offsets, out = { values: {} }) {
  if (!offsets || !settings) return settings;
  out.version = settings.version; out.symmetric = settings.symmetric;
  for (const k in settings.values) {
    const cur = settings.values[k], add = offsets[k];
    if (typeof cur === 'object') {
      let o = out.values[k];
      if (!o || typeof o !== 'object') o = out.values[k] = { l: 0, r: 0 };
      o.l = cur.l + (add ? add.l : 0); o.r = cur.r + (add ? add.r : 0);
    } else out.values[k] = cur + (typeof add === 'number' ? add : 0);
  }
  return out;
}

export class ItemManager {
  constructor({ scene, terrain, chunks, seed, loader, figureRoot, canAct = () => true, worldCollides = () => false }) {
    Object.assign(this, { scene, terrain, chunks, seed, loader, figureRoot, canAct, worldCollides });
    this.decor = null;
    this.protos = new Map();        // Schlüssel → { ground, stand, held, h, hw, def }
    this.entries = new Map();       // Chunk-Key → Eintrag
    this.grid = new Map();          // numerischer Key → Eintrag (für obstaclesNear)
    this.start = null;              // Startdorf-Eintrag
    this.loose = [];                // alle losen (aufhebbaren) Gegenstände
    this.chests = [];               // alle Truhen (geschlossen/offen)
    this.dropped = [];              // vom Spieler fallen gelassene Gegenstände
    this.time = 0;
    this.ready = false;
    this._syncTimer = 0;
    this._lastChunkCount = -1;
    this._dropSeq = 0;

    // Inventar
    this.slots = new Array(SLOTS).fill(null);   // { key, n } | null
    this.selected = 0;
    this.energy = 80;
    this.picked = new Set();
    this.opened = new Set();
    this.aiming = false;
    this.act = null;                // laufende Bewegung { kind, t, dur, slot }

    // Spieler (aus update)
    this._pp = new THREE.Vector3();
    this._yaw = 0;
    this._target = null;            // nächster Gegenstand / nächste Truhe
    this._prompt = '';

    // Haltepose (wiederverwendet)
    this._pose = {};
    for (const k of POSE_KEYS) this._pose[k] = { l: 0, r: 0 };

    // Hand
    this.hands = { r: figureRoot?.getObjectByName('hand_r') ?? null, l: figureRoot?.getObjectByName('hand_l') ?? null };
    if (!this.hands.r) console.warn('[Items] Handknochen hand_r nicht gefunden');
    this._held = null;              // Object3D an der Hand
    this._heldKey = null;

    this._load();
    this._buildUi();
    this._onKey = this._onKey.bind(this);
    addEventListener('keydown', this._onKey);
  }

  /** Deko-Manager (Lagerfeuer, Marktstände) – wird nach dem Erzeugen von main.js gesetzt. */
  setDecor(decor) { this.decor = decor; }

  get prompt() { return this._prompt; }
  get count() { return this.loose.length; }

  // ---------- Laden ----------

  async init() {
    const files = [...new Set(Object.values(CATALOG).map((d) => d.f))];
    const scenes = new Map();
    await Promise.all(files.map(async (f) => {
      try {
        const gltf = await this.loader.loadAsync(`models/${f}.glb`);
        scenes.set(f, gltf.scene);
      } catch (err) {
        console.warn(`[Items] Modell fehlt: /models/${f}.glb`, err);
      }
    }));
    for (const [key, def] of Object.entries(CATALOG)) {
      const raw = scenes.get(def.f);
      if (raw) this.protos.set(key, this._makeProto(raw, def));
    }
    // Fallen gelassene Gegenstände aus dem Speicher wiederherstellen
    for (const d of this._savedDropped ?? []) this._spawnDropped(d.key, d.n, d.x, d.z, d.yaw);
    this._savedDropped = null;
    this.ready = true;
    this._refreshHeld();
    this._renderUi();
  }

  /**
   * Prototypen aus einer GLTF-Szene: liegend (Welt), stehend (an Ständer gelehnt), in der Hand.
   * Massstab: längste Kante der Bounding-Box = def.size. Einmal gemessen.
   */
  _makeProto(raw, def) {
    raw.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    raw.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(raw, true);
    const size = rawBox.getSize(new THREE.Vector3());
    const s = def.size / Math.max(size.x, size.y, size.z, 1e-6);

    // liegend / auf dem Boden: Mitte über (0,0), Unterseite auf y = 0
    const build = (lie) => {
      const root = new THREE.Group();
      const pivot = new THREE.Group();
      pivot.add(raw.clone());
      if (lie === 'x') pivot.rotation.x = -Math.PI / 2;    // +Y → −Z, flache Seite (Z) nach oben
      if (lie === 'z') pivot.rotation.z = Math.PI / 2;     // +Y → −X, dünne X-Seite nach oben
      pivot.scale.setScalar(s);
      root.add(pivot);
      root.updateMatrixWorld(true);
      _box.setFromObject(root, true);
      const c = _box.getCenter(_v);
      pivot.position.set(-c.x, -_box.min.y, -c.z);
      const sz = _box.getSize(_v2);
      return { root, h: sz.y, hw: sz.x / 2, hd: sz.z / 2 };
    };
    const ground = build(def.lie);
    const stand = def.c === W ? build(null) : null;

    // in der Hand: Modell so verschoben, dass der Griffpunkt im Ursprung liegt
    let held = null;
    if (def.pick && def.hold) {
      const inner = raw.clone();
      inner.scale.setScalar(s);
      if (def.hold === 'palm') {
        const c = rawBox.getCenter(_v);
        inner.position.set(-c.x * s, -rawBox.min.y * s, -c.z * s);   // Unterseite auf der Handfläche
      } else if (def.hold === 'shield') {
        const c = rawBox.getCenter(_v);
        inner.position.set(-c.x * s, -c.y * s, -rawBox.min.z * s);   // Rückseite am Unterarm
      } else {
        inner.position.set(0, -(def.grip ?? 0) * s, 0);               // Stiel im Ursprung
      }
      held = new THREE.Group();
      held.add(inner);
    }
    return { ground: ground.root, h: ground.h, hw: ground.hw, hd: ground.hd, stand: stand?.root ?? null, standH: stand?.h ?? 0, held, def };
  }

  // ---------- Speicher ----------

  _load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.slots)) {
        for (let i = 0; i < SLOTS; i++) {
          const s = d.slots[i];
          this.slots[i] = s && CATALOG[s.key]?.pick ? { key: s.key, n: Math.max(1, Math.min(STACK_MAX, s.n | 0)) } : null;
        }
      }
      if (Number.isInteger(d.selected)) this.selected = Math.min(SLOTS - 1, Math.max(0, d.selected));
      if (typeof d.energy === 'number') this.energy = Math.min(100, Math.max(0, d.energy));
      if (Array.isArray(d.picked)) for (const id of d.picked) this.picked.add(String(id));
      if (Array.isArray(d.opened)) for (const id of d.opened) this.opened.add(String(id));
      if (Array.isArray(d.dropped)) this._savedDropped = d.dropped.filter((x) => x && CATALOG[x.key]?.pick && Number.isFinite(x.x) && Number.isFinite(x.z));
    } catch (err) {
      console.warn('[Items] Inventar konnte nicht geladen werden', err);
    }
  }

  _save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        v: 1,
        seed: this.seed,
        slots: this.slots,
        selected: this.selected,
        energy: Math.round(this.energy * 10) / 10,
        picked: [...this.picked],
        opened: [...this.opened],
        dropped: this.dropped.map((r) => ({ key: r.key, n: r.n, x: +r.x.toFixed(2), z: +r.z.toFixed(2), yaw: +r.yaw.toFixed(2) })),
      }));
    } catch { /* privater Modus / Speicher voll → egal */ }
  }

  // ---------- Benutzeroberfläche ----------

  _buildUi() {
    if (typeof document === 'undefined') return;
    if (!document.getElementById('inv-style')) {
      const style = document.createElement('style');
      style.id = 'inv-style';
      style.textContent = `
.inv-root { position: fixed; left: 50%; bottom: 70px; transform: translateX(-50%); z-index: 5;
  display: flex; flex-direction: column; align-items: center; gap: 6px;
  pointer-events: none; user-select: none; color: #fff; font-family: system-ui, sans-serif; }
.inv-msg { padding: 5px 14px; border-radius: 10px; background: rgba(0, 0, 0, .55); font-size: 14px;
  white-space: nowrap; opacity: 0; transform: translateY(4px); transition: opacity .25s, transform .25s; }
.inv-msg.inv-show { opacity: 1; transform: none; }
.inv-row { display: flex; align-items: stretch; gap: 8px; }
.inv-bar { display: flex; gap: 4px; padding: 4px; border-radius: 11px; background: rgba(0, 0, 0, .32);
  box-shadow: 0 2px 10px rgba(0, 0, 0, .18); }
.inv-slot { position: relative; box-sizing: border-box; width: 62px; height: 48px; padding: 11px 4px 4px;
  border-radius: 8px; border: 2px solid rgba(255, 255, 255, .1); background: rgba(0, 0, 0, .38);
  display: flex; align-items: center; justify-content: center; text-align: center;
  font-size: 11px; line-height: 1.12; overflow: hidden; hyphens: manual; transition: background .15s, border-color .15s; }
.inv-slot.inv-sel { border-color: rgba(255, 255, 255, .92); background: rgba(255, 255, 255, .2);
  box-shadow: 0 0 10px rgba(255, 255, 255, .22); }
.inv-key { position: absolute; left: 5px; top: 2px; font-size: 10px; opacity: .5; }
.inv-dot { position: absolute; right: 5px; top: 5px; width: 6px; height: 6px; border-radius: 50%; }
.inv-count { position: absolute; right: 5px; bottom: 2px; font-size: 11px; font-weight: 700;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .7); }
.inv-name { text-shadow: 0 1px 2px rgba(0, 0, 0, .6); }
.inv-energy { box-sizing: border-box; width: 112px; padding: 7px 10px; border-radius: 11px;
  background: rgba(0, 0, 0, .32); font-size: 11px; display: flex; flex-direction: column; justify-content: center; }
.inv-elabel { display: flex; justify-content: space-between; opacity: .85; }
.inv-etrack { height: 8px; margin-top: 5px; border-radius: 4px; background: rgba(255, 255, 255, .16); overflow: hidden; }
.inv-efill { height: 100%; width: 80%; border-radius: 4px; background: linear-gradient(90deg, #6fcf5f, #c6ef7c);
  transition: width .4s; }
.inv-efill.inv-low { background: linear-gradient(90deg, #e45b48, #f2a65a); }
@media (max-width: 760px) {
  .inv-slot { width: 44px; height: 42px; font-size: 9px; padding-top: 10px; }
  .inv-energy { width: 72px; padding: 6px; }
}`;
      document.head.appendChild(style);
    }
    const root = document.createElement('div');
    root.className = 'inv-root';
    root.innerHTML = `<div class="inv-msg"></div><div class="inv-row"><div class="inv-bar"></div>
      <div class="inv-energy"><div class="inv-elabel"><span>Energie</span><span class="inv-eval"></span></div>
      <div class="inv-etrack"><div class="inv-efill"></div></div></div></div>`;
    const bar = root.querySelector('.inv-bar');
    this.ui = { root, msg: root.querySelector('.inv-msg'), fill: root.querySelector('.inv-efill'), eval: root.querySelector('.inv-eval'), slots: [] };
    for (let i = 0; i < SLOTS; i++) {
      const el = document.createElement('div');
      el.className = 'inv-slot';
      el.innerHTML = `<span class="inv-key">${i + 1}</span><span class="inv-dot"></span><span class="inv-name"></span><span class="inv-count"></span>`;
      bar.appendChild(el);
      this.ui.slots.push({ el, name: el.querySelector('.inv-name'), count: el.querySelector('.inv-count'), dot: el.querySelector('.inv-dot') });
    }
    this._msgTime = 0;
    this._shownEnergy = -1;
    document.body.appendChild(root);
    this._renderUi();
  }

  _renderUi() {
    if (!this.ui) return;
    for (let i = 0; i < SLOTS; i++) {
      const s = this.slots[i], u = this.ui.slots[i];
      const def = s && CATALOG[s.key];
      u.el.classList.toggle('inv-sel', i === this.selected);
      u.name.textContent = def ? def.s : '';
      u.count.textContent = s && (def.stack || s.n > 1) ? String(s.n) : '';
      u.dot.style.background = def ? CAT_COLOR[def.c] : 'transparent';
      u.el.title = def ? def.n : '';
    }
    this._renderEnergy();
  }

  _renderEnergy() {
    if (!this.ui) return;
    const e = Math.round(this.energy);
    if (e === this._shownEnergy) return;
    this._shownEnergy = e;
    this.ui.fill.style.width = `${e}%`;
    this.ui.fill.classList.toggle('inv-low', e < 25);
    this.ui.eval.textContent = String(e);
  }

  _say(text, sec = 2.2) {
    if (!this.ui) return;
    this.ui.msg.textContent = text;
    this.ui.msg.classList.add('inv-show');
    this._msgTime = sec;
  }

  // ---------- Eingabe ----------

  _onKey(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (!this.canAct()) return;
    const code = e.code;
    if (code.startsWith('Digit')) {
      const d = code.charCodeAt(5) - 49;   // 'Digit1' → 0
      if (d >= 0 && d < SLOTS) this._select(d);
      return;
    }
    switch (code) {
      case 'KeyF': this._interact(); break;
      case 'KeyG': this._drop(); break;
      case 'KeyR': this._use(); break;
      case 'KeyQ': this._select((this.selected + 1) % SLOTS); break;
      default: return;
    }
  }

  _select(i) {
    if (i === this.selected) return;
    this.selected = i;
    this.aiming = false;
    if (this.act && this.act.slot !== i) this.act = null;
    this._refreshHeld();
    this._renderUi();
    this._save();
  }

  /** Gegenstand ins Inventar legen. Liefert die Anzahl, die nicht mehr Platz hatte. */
  _addToInventory(key, n) {
    const def = CATALOG[key];
    if (def.stack) {
      for (let i = 0; i < SLOTS && n > 0; i++) {
        const s = this.slots[i];
        if (s && s.key === key && s.n < STACK_MAX) { const k = Math.min(n, STACK_MAX - s.n); s.n += k; n -= k; }
      }
    }
    // leere Fächer: zuerst das ausgewählte, dann von links
    for (let j = -1; j < SLOTS && n > 0; j++) {
      const i = j < 0 ? this.selected : j;
      if (this.slots[i]) continue;
      const k = def.stack ? Math.min(n, STACK_MAX) : 1;
      this.slots[i] = { key, n: k };
      n -= k;
    }
    return n;
  }

  _interact() {
    const t = this._target;
    if (!t) return;
    if (t.chest) { this._openChest(t); return; }
    const def = CATALOG[t.key];
    const invKey = def.gives ?? t.key;
    const before = t.n;
    const left = this._addToInventory(invKey, t.n);
    if (left === before) { this._say('Inventar voll!'); return; }
    const got = before - left;
    const invDef = CATALOG[invKey];
    this._say(got > 1 ? `+${got} ${invKey === 'coin' ? 'Münzen' : invDef.n}` : `${invDef.n} aufgehoben`);
    if (left > 0) {
      t.n = left;
    } else {
      this._removeLoose(t);
      if (t.dropped) this.dropped.splice(this.dropped.indexOf(t), 1);
      else this.picked.add(t.id);
    }
    this._target = null;
    this._refreshHeld();
    this._renderUi();
    this._save();
  }

  _drop() {
    const s = this.slots[this.selected];
    if (!s) return;
    const p = this._pp;
    const fx = Math.sin(this._yaw), fz = Math.cos(this._yaw);
    let x = p.x, z = p.z;
    for (const d of [1.0, 0.7, 0.45]) {
      const tx = p.x + fx * d, tz = p.z + fz * d;
      if (!this.worldCollides(tx, tz, -Infinity, 0.1)) { x = tx; z = tz; break; }
    }
    if (this.terrain.height(x, z) < SEA_LEVEL - 0.2) { this._say('Hier würde es versinken.'); return; }
    const n = 1;
    const rec = this._spawnDropped(s.key, n, x, z, this._yaw + (Math.random() - 0.5));
    if (!rec) return;
    s.n -= n;
    if (s.n <= 0) this.slots[this.selected] = null;
    this.aiming = false;
    this._say(`${CATALOG[s.key].n} abgelegt`, 1.5);
    this._refreshHeld();
    this._renderUi();
    this._save();
  }

  _use() {
    const s = this.slots[this.selected];
    if (this.act) return;
    if (!s) {   // leere Hand → Faustschlag (wirkt schwach auf alles)
      this.act = { kind: 'swing', t: 0, dur: ACTIONS.swing.dur, slot: this.selected, key: null };
      this.onSwing?.(null);
      return;
    }
    const def = CATALOG[s.key];
    if (def.c === E || def.drink) {
      this.act = { kind: 'eat', t: 0, dur: ACTIONS.eat.dur, slot: this.selected, key: s.key };
    } else if (def.hold === 'bow' || def.hold === 'shield') {
      this.aiming = !this.aiming;
    } else if (def.c === W || def.c === T || def.c === R) {
      this.act = { kind: 'swing', t: 0, dur: ACTIONS.swing.dur, slot: this.selected, key: s.key };
      this.onSwing?.(s.key);   // Zerstörungs-System: Treffer prüfen
    } else if (s.key === 'coin') {
      this._say(`Du hast ${this._countOf('coin')} Münzen.`);
    } else if (def.msg) {
      this._say(def.msg);
    }
  }

  _countOf(key) {
    let n = 0;
    for (const s of this.slots) if (s && s.key === key) n += s.n;
    return n;
  }

  /** Ende einer Ess-/Trinkbewegung: Gegenstand verbrauchen. */
  _finishEat(act) {
    const s = this.slots[act.slot];
    if (!s || s.key !== act.key) return;
    const def = CATALOG[s.key];
    s.n -= 1;
    if (s.n <= 0) this.slots[act.slot] = null;
    this.energy = Math.min(100, this.energy + (def.e ?? 5));
    this._say(def.msg ?? (def.drink ? `Ah, erfrischend – ${def.n}!` : `Mmh, ${def.n}!`));
    this._refreshHeld();
    this._renderUi();
    this._save();
  }

  // ---------- Gegenstand in der Hand ----------

  _refreshHeld() {
    const s = this.slots[this.selected];
    const key = s ? s.key : null;
    if (key === this._heldKey && (this._held || !key)) return;
    if (this._held) { this._held.removeFromParent(); this._held = null; }
    this._heldKey = key;
    if (!key) return;
    const proto = this.protos.get(key);
    const def = CATALOG[key];
    if (!proto?.held) return;
    const side = HOLD_SIDE[def.hold] ?? 'r';
    const bone = this.hands[side] ?? this.hands.r;
    if (!bone) return;
    const obj = proto.held.clone();
    this._gripTransform(def, side, obj);
    // Welt-Massstab des Knochens ausgleichen (Figur ist im Moment 1:1, aber sicher ist sicher)
    bone.updateWorldMatrix(true, false);
    bone.getWorldScale(_v);
    obj.scale.multiplyScalar(1 / Math.max(_v.x, 1e-6));
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    bone.add(obj);
    this._held = obj;
  }

  /** Lage des Gegenstands im lokalen Raum des Handknochens (siehe Kommentar bei HAND). */
  _gripTransform(def, side, obj) {
    const m = side === 'l' ? -1 : 1;
    const f = _v.copy(HAND.fingers);
    const r = _v2.set(HAND.radial.x * m, HAND.radial.y, HAND.radial.z);
    const n = new THREE.Vector3(HAND.palm.x * m, HAND.palm.y, HAND.palm.z);
    const pos = new THREE.Vector3(HAND.fist.x * m, HAND.fist.y, HAND.fist.z);
    switch (def.hold) {
      case 'palm':
        _mx.copy(f); _my.copy(n); _mz.crossVectors(_mx, _my);
        pos.addScaledVector(n, 0.035);
        break;
      case 'bow':
        _my.copy(r); _mx.copy(f).negate(); _mz.crossVectors(_mx, _my);
        pos.addScaledVector(n, 0.02);
        break;
      case 'shield':
        _mz.copy(n).negate(); _my.copy(r); _mx.crossVectors(_my, _mz);
        pos.addScaledVector(n, -0.05);
        break;
      default: {   // blade: Stiel durch die Faust, leicht zu den Fingern gekippt
        _my.copy(r).addScaledVector(f, 0.2).normalize();
        _mx.copy(f).addScaledVector(_my, -f.dot(_my)).normalize();
        if (def.flip) _mx.negate();
        _mz.crossVectors(_mx, _my);
        pos.addScaledVector(n, 0.02);
      }
    }
    _mat.makeBasis(_mx, _my, _mz);
    obj.quaternion.setFromRotationMatrix(_mat);
    obj.position.copy(pos);
  }

  /**
   * Zusätzliche Pose (Grad) für Arme, solange etwas gehalten/geschwungen wird.
   * Mit addPoseOffsets() zu den Editor-Einstellungen addieren. null = nichts zu tun.
   */
  getPoseOffsets() {
    if (!this.canAct()) return null;
    const key = this._heldKey, act = this.act;
    if (!key && !act) return null;
    const pose = this._pose;
    for (const k of POSE_KEYS) { pose[k].l = 0; pose[k].r = 0; }
    const def = key && CATALOG[key];
    if (def?.hold) {
      const base = (this.aiming && AIM_POSE[def.hold]) || HOLD_POSE[def.hold];
      for (const k in base) { pose[k].l += base[k].l; pose[k].r += base[k].r; }
    }
    if (act) {
      const a = ACTIONS[act.kind];
      const t = Math.min(act.t / act.dur, 1);
      for (const k in a.r) pose[k].r += keyed(a.times, a.r[k], t);
    }
    return pose;
  }

  // ---------- Platzieren ----------

  _newEntry(key, cx, cz) {
    return { key, cx, cz, seq: 0, items: [], furn: [], obstacles: [] };
  }

  /** Ist der Kreis frei? Welt-Hindernisse, eigene Möbel, Wasser, steile Hänge. */
  _free(e, x, z, r) {
    const h = this.terrain.height(x, z);
    if (h < SEA_LEVEL + 0.3) return false;
    if (this.worldCollides(x, z, -Infinity, r)) return false;
    for (const o of e.obstacles) {
      const dx = x - o.x, dz = z - o.z, rr = o.r + r + 0.1;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    return true;
  }

  /** Freie Stelle nahe (x, z) suchen (Spirale nach aussen), sonst null. */
  _spot(e, x, z, r, rand, tries = 10) {
    if (this._free(e, x, z, r)) return [x, z];
    for (let k = 1; k <= tries; k++) {
      const a = rand() * TAU, d = 0.3 * k;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (this._free(e, px, pz, r)) return [px, pz];
    }
    return null;
  }

  /** Mehrere gleiche Gegenstände im Häufchen um (x, z). */
  _cluster(e, key, x, z, count, rand, spread = 0.35) {
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU, d = spread * Math.sqrt(rand());
      this._item(e, key, x + Math.cos(a) * d, z + Math.sin(a) * d, rand);
    }
  }

  /**
   * Losen Gegenstand erzeugen. Die ID zählt immer hoch (auch wenn schon aufgehoben),
   * damit die IDs bei jedem Neuaufbau gleich bleiben.
   */
  _item(e, key, x, z, rand, opt = {}) {
    const proto = this.protos.get(key);
    const id = opt.id ?? `${e.key}:${e.seq}`;
    if (!opt.id) {
      if (e.seq >= MAX_PER_CHUNK) return null;
      e.seq++;
    }
    // Zufall immer gleich verbrauchen – auch für schon aufgehobene Gegenstände –,
    // sonst verschieben sich die übrigen Gegenstände des Chunks nach dem Aufheben.
    const yaw = opt.yaw ?? rand() * TAU;
    const n = opt.n ?? (key === 'coin_pile' ? 6 + Math.floor(rand() * 10) : 1);
    if (!opt.lean) {
      const spot = this._spot(e, x, z, 0.08, rand, 4);
      if (!spot) return null;
      [x, z] = spot;
    }
    if (!proto || this.picked.has(id)) return null;
    const rec = this._makeLoose(key, id, n, x, z, yaw, opt.lean);
    rec.entry = e;
    e.items.push(rec);
    this.loose.push(rec);
    return rec;
  }

  _makeLoose(key, id, n, x, z, yaw, lean = 0) {
    const proto = this.protos.get(key);
    const y = this.terrain.height(x, z);
    let obj;
    if (lean && proto.stand) {
      obj = proto.stand.clone();
      obj.rotation.order = 'YXZ';
      obj.rotation.set(-lean, yaw, 0);   // oben Richtung −Z (zum Ständer)
    } else {
      obj = proto.ground.clone();
      obj.rotation.y = yaw;
    }
    obj.position.set(x, y + 0.005, z);
    const idle = !lean && proto.def.size <= IDLE_MAX;
    obj.updateMatrix();
    obj.traverse((o) => { if (o !== obj) { o.updateMatrix(); o.matrixAutoUpdate = false; } });
    obj.matrixAutoUpdate = idle;
    this.scene.add(obj);
    return { key, id, n, x, y, z, yaw, obj, idle, ph: (x * 7.13 + z * 3.71) % TAU, entry: null, dropped: false, chest: false };
  }

  _spawnDropped(key, n, x, z, yaw) {
    if (!this.protos.has(key)) return null;
    const rec = this._makeLoose(key, `d${this._dropSeq++}`, n, x, z, yaw);
    rec.dropped = true;
    this.dropped.push(rec);
    this.loose.push(rec);
    return rec;
  }

  _removeLoose(rec) {
    this.scene.remove(rec.obj);
    const i = this.loose.indexOf(rec);
    if (i >= 0) { this.loose[i] = this.loose[this.loose.length - 1]; this.loose.pop(); }
    if (rec.entry) {
      const j = rec.entry.items.indexOf(rec);
      if (j >= 0) rec.entry.items.splice(j, 1);
    }
  }

  /** Möbel / Behälter (nicht aufhebbar, mit Hindernis). */
  _furniture(e, key, x, z, yaw, opt = {}) {
    const proto = this.protos.get(key);
    if (!proto) return null;
    const y = this.terrain.height(x, z) - 0.02;
    const obj = proto.ground.clone();
    obj.position.set(x, y, z);
    obj.rotation.y = yaw;
    obj.updateMatrix();
    obj.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
    this.scene.add(obj);
    const r = Math.max(proto.hw, proto.hd) * (opt.shrink ?? 0.8);
    const ob = { type: 'circle', x, z, r, top: y + proto.h };
    e.obstacles.push(ob);
    const rec = { key, x, z, y, yaw, obj, r, entry: e };
    e.furn.push(rec);
    return rec;
  }

  /** Lokaler Versatz (lx, lz) eines Möbels mit Drehung yaw → Weltposition. */
  _local(f, lx, lz) {
    const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
    return [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
  }

  /** Waffenständer mit 2–3 angelehnten Waffen. Vorderseite (+Z) zeigt nach yaw. */
  _weaponStand(e, x, z, yaw, rand, weapons) {
    const f = this._furniture(e, 'weaponstand', x, z, yaw, { shrink: 0.7 });
    if (!f) return;
    const hd = this.protos.get('weaponstand').hd;
    const n = weapons.length;
    for (let i = 0; i < n; i++) {
      const lx = (i - (n - 1) / 2) * 0.5;
      const [wx, wz] = this._local(f, lx, hd + 0.12);
      this._item(e, weapons[i], wx, wz, rand, { lean: 0.22 + rand() * 0.08, yaw: yaw + (rand() - 0.5) * 0.2 });
    }
  }

  /** Truhe (geschlossen; F öffnet sie, dann liegen Schätze davor). */
  _chest(e, x, z, yaw, rand) {
    const id = `${e.key}:truhe${e.furn.length}`;
    const f = this._furniture(e, 'chest_wood', x, z, yaw, { shrink: 0.75 });
    if (!f) return;
    // Inhalt jetzt festlegen (deterministisch)
    const r = mulberry32(hashStr(id, this.seed ^ SALT));
    const loot = [];
    const nLoot = 2 + Math.floor(r() * 3);
    for (let i = 0; i < nLoot; i++) loot.push(TREASURE[Math.floor(r() * TREASURE.length)]);
    if (r() < 0.2) loot.push(RARE_TREASURE[Math.floor(r() * RARE_TREASURE.length)]);
    Object.assign(f, { chest: true, id, loot, opened: false });
    this.chests.push(f);
    if (this.opened.has(id)) this._showChestOpen(f);
  }

  _openChest(f) {
    if (f.opened) return;
    this.opened.add(f.id);
    this._showChestOpen(f);
    this._say(`Truhe geöffnet: ${f.loot.map((k) => CATALOG[k].n).join(', ')}`, 3.2);
    this._target = null;
    this._save();
  }

  _showChestOpen(f) {
    f.opened = true;
    const open = this.protos.get('chest_open');
    if (open) {
      this.scene.remove(f.obj);
      const obj = open.ground.clone();
      obj.position.set(f.x, f.y, f.z);
      obj.rotation.y = f.yaw;
      obj.updateMatrix();
      obj.traverse((o) => { o.updateMatrix(); o.matrixAutoUpdate = false; });
      this.scene.add(obj);
      f.obj = obj;
    }
    // Schätze vor der Truhe auslegen
    const e = f.entry;
    const rand = mulberry32(hashStr(f.id + '/aus', this.seed));
    for (let i = 0; i < f.loot.length; i++) {
      const lx = (i - (f.loot.length - 1) / 2) * 0.35 + (rand() - 0.5) * 0.1;
      const [x, z] = this._local(f, lx, 0.75 + rand() * 0.25);
      this._item(e, f.loot[i], x, z, rand, { id: `${f.id}/${i}` });
    }
  }

  // ---------- Startdorf ----------
  // Weg x −1.5 … 1.5, Häuser bei z −4 … −21, roter Marktstand bei (4.8, 11) mit Front zum Weg,
  // Lagerfeuer bei (−4.6, 10.6), Laternen bei (±3, 6.4 … 16.2).
  _buildStart(e) {
    const rand = mulberry32(hash2(0, 0, this.seed ^ SALT));
    // Am roten Marktstand: Apfelkiste mit Äpfeln, Brot, Käse
    const crate = this._spot(e, 3.7, 9.0, 0.4, rand);
    if (crate) {
      this._furniture(e, 'farmcrate_apple', crate[0], crate[1], Math.PI / 2 + (rand() - 0.5) * 0.3);
      this._cluster(e, 'apple', crate[0] - 0.6, crate[1] + 0.1, 3, rand, 0.25);
    } else {
      this._cluster(e, 'apple', 3.4, 10.0, 3, rand, 0.25);
    }
    this._item(e, 'bread', 3.4, 10.9, rand);
    this._item(e, 'cheese', 3.5, 11.4, rand);
    // Waffenständer mit Schwert, Axt und Bogen, Front zum Weg (−X)
    for (const [x, z] of [[6.5, 7.5], [6.9, 6.9], [7.2, 8.2], [6.8, 5.6]]) {
      if (!this._free(e, x, z, 0.85)) continue;
      this._weaponStand(e, x, z, -Math.PI / 2, rand, ['sword', 'axe_small', 'bow_wooden']);
      break;
    }
    // Beim Lagerfeuer: Spitzhacke und Fackel
    this._item(e, 'pickaxe_bronze', -3.3, 11.8, rand);
    this._item(e, 'torch_metal', -4.3, 12.5, rand);
    // Münzen auf dem Weg
    this._item(e, 'coin', 0.3, -2.5, rand, { n: 3 });
    this._item(e, 'coin', -0.4, 3.5, rand, { n: 2 });
    this._item(e, 'coin', 0.2, 9.5, rand, { n: 3 });
    this._item(e, 'coin', -0.3, 14.5, rand, { n: 5 });
  }

  // ---------- Generierte Dörfer ----------

  _buildVillage(e, v, rand, de) {
    // Marktstände aus der Deko suchen (lange Quader 3.5–6.8 m von der Mitte)
    const stalls = [];
    if (de) {
      for (const o of de.obstacles) {
        if (o.type !== 'obb' || Math.max(o.hw, o.hd) < 0.9) continue;
        const d = Math.hypot(o.x - v.x, o.z - v.z);
        if (d > 3.5 && d < 6.8) stalls.push(o);
      }
    }
    if (!stalls.length) {   // ohne Deko: gedachte Stände im Kreis
      const a0 = rand() * TAU;
      for (let i = 0; i < 2; i++) stalls.push({ x: v.x + Math.cos(a0 + i * Math.PI) * 5, z: v.z + Math.sin(a0 + i * Math.PI) * 5 });
    }
    // Essen bei den Ständen: Kiste/Fass mit Obst, dazu Marktware vor dem Stand
    for (let i = 0; i < Math.min(3, stalls.length); i++) {
      const st = stalls[i];
      const d = Math.hypot(v.x - st.x, v.z - st.z) || 1;
      const dx = (v.x - st.x) / d, dz = (v.z - st.z) / d, tx = -dz, tz = dx;
      const side = rand() < 0.5 ? 1 : -1;
      const roll = rand();
      const cont = roll < 0.4 ? 'farmcrate_apple' : roll < 0.7 ? 'farmcrate_carrot' : 'barrel_apples';
      const fruit = cont === 'farmcrate_carrot' ? 'carrot' : 'apple';
      const p = this._spot(e, st.x + dx * 1.5 + tx * 1.7 * side, st.z + dz * 1.5 + tz * 1.7 * side, 0.45, rand);
      if (p) {
        this._furniture(e, cont, p[0], p[1], rand() * TAU);
        this._cluster(e, fruit, p[0] + dx * 0.7, p[1] + dz * 0.7, 2 + Math.floor(rand() * 2), rand, 0.25);
      }
      const nFood = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < nFood; k++) {
        const s = (rand() - 0.5) * 1.6;
        this._item(e, MARKET_FOOD[Math.floor(rand() * MARKET_FOOD.length)], st.x + dx * 1.7 + tx * s, st.z + dz * 1.7 + tz * s, rand);
      }
    }
    // Waffenständer am Platzrand, Front zur Mitte
    for (let t = 0; t < 12; t++) {
      const a = rand() * TAU, r = 7 + rand() * 2.5;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (!this._free(e, x, z, 0.9) || this._slope(x, z) > 0.2) continue;
      const nW = 2 + (rand() < 0.5 ? 1 : 0);
      const ws = [];
      for (let k = 0; k < nW; k++) ws.push(STAND_WEAPONS[Math.floor(rand() * STAND_WEAPONS.length)]);
      this._weaponStand(e, x, z, Math.atan2(v.x - x, v.z - z), rand, ws);
      break;
    }
    // Schmiede-Ecke: Amboss oder Kessel mit Werkzeugen
    for (let t = 0; t < 10; t++) {
      const a = rand() * TAU, r = 7.5 + rand() * 3;
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (!this._free(e, x, z, 0.6) || this._slope(x, z) > 0.2) continue;
      const roll = rand();
      this._furniture(e, roll < 0.5 ? 'anvil' : roll < 0.8 ? 'cauldron' : 'whetstone', x, z, rand() * TAU);
      const nT = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < nT; k++) {
        const b = rand() * TAU;
        this._item(e, VILLAGE_TOOLS[Math.floor(rand() * VILLAGE_TOOLS.length)], x + Math.cos(b) * 0.9, z + Math.sin(b) * 0.9, rand);
      }
      break;
    }
    // Manchmal eine Truhe mit Schatz bei den Häusern
    if (rand() < 0.3) {
      for (let t = 0; t < 10; t++) {
        const a = rand() * TAU, r = 8 + rand() * 4;
        const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
        if (!this._free(e, x, z, 0.6) || this._slope(x, z) > 0.2) continue;
        this._chest(e, x, z, Math.atan2(v.x - x, v.z - z), rand);
        break;
      }
    }
  }

  // ---------- Wildnis ----------

  _slope(x, z) { return 1 - this.terrain.normal(x, z).y; }

  _buildWilderness(e, chunk, rand, de) {
    const x0 = e.cx * CHUNK_SIZE, z0 = e.cz * CHUNK_SIZE;
    // Bei Lagerfeuern: Proviant und Werkzeug
    if (de?.campfires) {
      for (const c of de.campfires) {
        if (Math.hypot(c.x, c.z) < START_CLEAR || rand() > 0.7) continue;
        const n = 1 + Math.floor(rand() * 3);
        for (let k = 0; k < n; k++) {
          const a = rand() * TAU, r = 1.4 + rand() * 1.0;
          const list = rand() < 0.65 ? CAMP_FOOD : CAMP_TOOLS;
          this._item(e, list[Math.floor(rand() * list.length)], c.x + Math.cos(a) * r, c.z + Math.sin(a) * r, rand);
        }
      }
    }
    // Unter Bäumen: Pilze im Wald, sonst Äpfel/Birnen
    const trees = chunk.obstacles.filter((o) => o.type === 'circle' && o.top === Infinity);
    if (trees.length && rand() < 0.55) {
      const n = 1 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        const t = trees[Math.floor(rand() * trees.length)];
        const a = rand() * TAU, r = t.r + 0.5 + rand() * 0.6;
        const x = t.x + Math.cos(a) * r, z = t.z + Math.sin(a) * r;
        if (Math.hypot(x, z) < START_CLEAR) continue;
        if (this.terrain.forest(x, z) > 0.45) this._cluster(e, 'mushroom', x, z, 1 + Math.floor(rand() * 3), rand, 0.3);
        else this._cluster(e, rand() < 0.6 ? 'apple' : 'pear', x, z, 1 + Math.floor(rand() * 2), rand, 0.4);
      }
    }
    // Selten: Schatztruhe im Wald oder auf einer Hügelkuppe
    if (rand() < 0.1) {
      for (let t = 0; t < 25; t++) {
        const x = x0 + 4 + rand() * (CHUNK_SIZE - 8), z = z0 + 4 + rand() * (CHUNK_SIZE - 8);
        if (Math.hypot(x, z) < START_CLEAR) continue;
        const h = this.terrain.height(x, z);
        if (h < SEA_LEVEL + 1.5 || this._slope(x, z) > 0.25) continue;
        const forest = this.terrain.forest(x, z) > 0.55;
        let hill = false;
        if (!forest && h > SEA_LEVEL + 6) {
          const th = this.terrain;
          const avg = (th.height(x + 8, z) + th.height(x - 8, z) + th.height(x, z + 8) + th.height(x, z - 8)) / 4;
          hill = h - avg > 1.2;
        }
        if (!forest && !hill) continue;
        if (!this._free(e, x, z, 0.7)) continue;
        this._chest(e, x, z, rand() * TAU, rand);
        break;
      }
    }
  }

  // ---------- Chunks abgleichen ----------

  _gridKey(cx, cz) { return (cx + 32768) * 65536 + (cz + 32768); }

  _buildEntry(key, chunk) {
    const e = this._newEntry(key, chunk.cx, chunk.cz);
    this.entries.set(key, e);
    this.grid.set(this._gridKey(chunk.cx, chunk.cz), e);
    const de = this.decor?.entries?.get(key) ?? null;
    const v = this.chunks.villageAt(chunk.cx, chunk.cz);
    if (v) this._buildVillage(e, v, mulberry32(hash2(chunk.cx, chunk.cz, this.seed ^ SALT)), de);
    else this._buildWilderness(e, chunk, mulberry32(hash2(chunk.cx, chunk.cz, this.seed ^ (SALT + 1))), de);
    return e;
  }

  _disposeEntry(e) {
    for (const rec of e.items) {
      this.scene.remove(rec.obj);
      const i = this.loose.indexOf(rec);
      if (i >= 0) { this.loose[i] = this.loose[this.loose.length - 1]; this.loose.pop(); }
    }
    for (const f of e.furn) {
      this.scene.remove(f.obj);
      if (f.chest) { const i = this.chests.indexOf(f); if (i >= 0) this.chests.splice(i, 1); }
    }
    e.items.length = 0; e.furn.length = 0;
  }

  _sync() {
    const decorReady = !!this.decor || this.time > 3;   // ohne Deko nach 3 s trotzdem bauen
    if (!decorReady) return false;
    if (!this.start && (!this.decor || this.decor.start)) {
      this.start = this._newEntry('start', 0, 0);
      this._buildStart(this.start);
    }
    const cm = this.chunks;
    let built = 0, pending = false;
    for (const [key, chunk] of cm.chunks) {
      if (this.entries.has(key)) continue;
      // erst bauen, wenn die Deko des Chunks steht (Stände, Lagerfeuer, Hindernisse sind dann bekannt)
      if (this.decor && !this.decor.entries?.has(key)) continue;
      if (built >= 1) { pending = true; break; }
      this._buildEntry(key, chunk);
      built++;
    }
    for (const [key, e] of this.entries) {
      if (cm.chunks.has(key)) continue;
      this._disposeEntry(e);
      this.entries.delete(key);
      this.grid.delete(this._gridKey(e.cx, e.cz));
    }
    return pending;
  }

  /** Hindernisse der Möbel (Waffenständer, Kisten, Truhen) – für worldCollides in main.js. */
  *obstaclesNear(x, z) {
    if (this.start && x * x + z * z < START_CLEAR * START_CLEAR) yield* this.start.obstacles;
    const pcx = Math.floor(x / CHUNK_SIZE), pcz = Math.floor(z / CHUNK_SIZE);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const e = this.grid.get(this._gridKey(pcx + dx, pcz + dz));
      if (e) yield* e.obstacles;
    }
  }

  // ---------- Laufzeit ----------

  update(dt, playerPos, playerYaw = 0) {
    this.time += dt;
    this._pp.copy(playerPos);
    this._yaw = playerYaw;
    if (!this.ready) return;

    // Abgleich mit den Chunks: bei Änderung der Chunk-Anzahl oder alle 0.3 s
    this._syncTimer -= dt;
    const nChunks = this.chunks.chunks.size;
    if (nChunks !== this._lastChunkCount || this._syncTimer <= 0) {
      this._lastChunkCount = nChunks;
      this._syncTimer = this._sync() ? 0.05 : 0.3;
    }

    // Lose Gegenstände: Sichtbarkeit, leichtes Drehen/Wippen, nächster in Reichweite
    const px = playerPos.x, pz = playerPos.z, py = playerPos.y;
    const act2 = ACTIVE_DIST * ACTIVE_DIST;
    const time = this.time;
    let best = null, bestD = PICK_DIST * PICK_DIST;
    for (let i = 0; i < this.loose.length; i++) {
      const it = this.loose[i];
      const dx = it.x - px, dz = it.z - pz, d2 = dx * dx + dz * dz;
      const vis = d2 < act2;
      if (it.obj.visible !== vis) it.obj.visible = vis;
      if (!vis) continue;
      if (it.idle) {
        it.obj.rotation.y = it.yaw + time * 0.45;
        it.obj.position.y = it.y + 0.015 + Math.sin(time * 1.8 + it.ph) * 0.01;   // 2 cm auf und ab
      }
      if (d2 < bestD && Math.abs(it.y - py) < 1.8) { bestD = d2; best = it; }
    }
    // Geschlossene Truhen
    const reach = (PICK_DIST + 0.4) ** 2;
    for (let i = 0; i < this.chests.length; i++) {
      const c = this.chests[i];
      if (c.opened) continue;
      const dx = c.x - px, dz = c.z - pz, d2 = dx * dx + dz * dz;
      if (d2 < reach && (!best || d2 < bestD)) { bestD = d2; best = c; }
    }
    const can = this.canAct();
    const target = can ? best : null;
    const n = target && !target.chest ? target.n : 0;
    if (target !== this._target || n !== this._targetN) {
      this._target = target; this._targetN = n;
      if (!target) this._prompt = '';
      else if (target.chest) this._prompt = 'F – öffnen: Truhe';
      else {
        const def = CATALOG[target.key];
        const label = def.gives === 'coin' || target.key === 'coin' ? (target.n > 1 ? 'Münzen' : 'Münze') : def.n;
        this._prompt = `F – aufheben: ${label}${target.n > 1 ? ` (${target.n})` : ''}`;
      }
    }

    // Laufende Bewegung (Schwingen, Essen)
    if (this.act) {
      this.act.t += dt;
      if (this.act.t >= this.act.dur) {
        const a = this.act;
        this.act = null;
        if (a.kind === 'eat') this._finishEat(a);
      }
    }
    if (!can && this.aiming) this.aiming = false;

    // Energie
    const before = this.energy;
    this.energy = Math.max(0, this.energy - ENERGY_DECAY * dt);
    if (before >= 15 && this.energy < 15) this._say('Du hast Hunger – iss etwas! (R)', 3);
    this._renderEnergy();
    if (Math.floor(before / 5) !== Math.floor(this.energy / 5)) this._save();   // ab und zu speichern

    // Meldung ausblenden
    if (this._msgTime > 0) {
      this._msgTime -= dt;
      if (this._msgTime <= 0 && this.ui) this.ui.msg.classList.remove('inv-show');
    }
  }

  // ---------- Schnittstelle für das Zerstörungs-System ----------

  /** Beute in die Welt legen (z. B. Holz aus einem gefällten Baum). */
  spawnDrop(key, n, x, z) {
    const rec = this._spawnDropped(key, n, x, z, Math.random() * Math.PI * 2);
    if (rec) this._save();
    return rec;
  }

  /** Kurze Meldung in der Leiste anzeigen. */
  say(text, sec) { this._say(text, sec); }

  /** Zerstörbare Möbel (Waffenständer, Obstkisten, Fässer, Truhen) in der Nähe. */
  *targetsNear(x, z) {
    const MAT = {
      weaponstand: ['holz', 'Waffenständer', 50], barrel_apples: ['holz', 'Apfelfass', 45], farmcrate_apple: ['holz', 'Obstkiste', 30],
      farmcrate_carrot: ['holz', 'Gemüsekiste', 30], chest_wood: ['holz', 'Truhe', 60], chest_open: ['holz', 'Truhe', 40],
      anvil: ['metall', 'Amboss', 120], cauldron: ['metall', 'Kessel', 80], whetstone: ['stein', 'Schleifstein', 70],
    };
    const lists = [this.start, ...this.entries.values()];
    for (const e of lists) {
      if (!e?.furn) continue;
      for (const f of e.furn) {
        if (f.destroyed) continue;
        const dx = f.x - x, dz = f.z - z;
        if (dx * dx + dz * dz > 36) continue;
        const m = MAT[f.key] ?? ['holz', CATALOG[f.key]?.n ?? 'Kiste', 40];
        if (f.hp === undefined) { f.hp = m[2]; f.maxHp = m[2]; f.material = m[0]; f.name = m[1]; }
        if (!f.destroy) {
          f.height = this.protos.get(f.key)?.h ?? 1;
          f.destroy = () => this._destroyFurniture(f);
          f.shakeObj = f.obj;
        }
        yield f;
      }
    }
  }

  _destroyFurniture(f) {
    f.destroyed = true;
    this.scene.remove(f.obj);
    const e = f.entry;
    const i = e.obstacles.findIndex((o) => Math.abs(o.x - f.x) < 1e-6 && Math.abs(o.z - f.z) < 1e-6);
    if (i >= 0) e.obstacles.splice(i, 1);
    // Inhalt fällt heraus
    const drops = { barrel_apples: [['apple', 4]], farmcrate_apple: [['apple', 3]], farmcrate_carrot: [['carrot', 3]],
      chest_wood: [['coin', 6]], weaponstand: [['planken', 1]] }[f.key] ?? [['planken', 1]];
    if (f.material === 'metall') return [];
    return drops;
  }

  /** Alles entfernen (z. B. beim Neustart). */
  dispose() {
    removeEventListener('keydown', this._onKey);
    for (const e of this.entries.values()) this._disposeEntry(e);
    if (this.start) this._disposeEntry(this.start);
    for (const r of this.dropped) this.scene.remove(r.obj);
    this.entries.clear(); this.grid.clear(); this.loose.length = 0; this.dropped.length = 0;
    if (this._held) this._held.removeFromParent();
    this.ui?.root.remove();
  }
}
