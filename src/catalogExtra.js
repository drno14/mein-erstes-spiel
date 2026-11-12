/*
 * Zusätzliche Gegenstände (alle CC0): Kenney Food Kit, Quaternius Ultimate RPG Items Pack,
 * Quaternius Fantasy Props MEGAKIT, Kenney Survival Kit. Modelle unter public/models/items/extra/
 * (Kenney-Food-GLBs referenzieren extra/Textures/colormap.png relativ).
 * Schema wie CATALOG in src/items.js:
 *   f: Datei unter /models/ (ohne .glb) · n: Name · s: Kurzname · c: Kategorie · size: längste Kante (m)
 *   pick · stack · lie ('x' | 'z') · hold ('palm' | 'blade') · grip · e: Energie · drink · msg · p: Preis
 * Modellausrichtung gemessen per GLTFLoader (Box3): Kenney-Food steht aufrecht (+Y), Ringe/Münzen/
 * Pergament stehen in der XY-Ebene (→ lie 'x'), RPG-Bücher stehen hochkant (→ lie 'z').
 * Goldene Waffen haben exakt die Geometrie der normalen Varianten → gleiche Griffhöhen.
 */
const W = 'Waffe', T = 'Werkzeug', E = 'Essen', S = 'Schatz', R = 'Rohstoff';
const X = 'items/extra/';

// Essen & Getränke: pick/stack/hold werden unten automatisch gesetzt
const food = {
  // ---- Obst & Gemüse ----
  avocado:        { f: X + 'avocado', n: 'Avocado', size: 0.12, e: 12 },
  beet:           { f: X + 'beet', n: 'Rande', size: 0.2, e: 8 },
  broccoli:       { f: X + 'broccoli', n: 'Broccoli', size: 0.2, e: 8 },
  cabbage:        { f: X + 'cabbage', n: 'Kohlkopf', size: 0.25, e: 12 },
  cauliflower:    { f: X + 'cauliflower', n: 'Blumenkohl', s: 'Blumen­kohl', size: 0.22, e: 12 },
  celery:         { f: X + 'celery-stick', n: 'Stangensellerie', s: 'Sellerie', size: 0.3, e: 5, lie: 'z' },
  cherries:       { f: X + 'cherries', n: 'Kirschen', size: 0.08, e: 6 },
  coconut:        { f: X + 'coconut', n: 'Kokosnuss', s: 'Kokos­nuss', size: 0.15, e: 18 },
  eggplant:       { f: X + 'eggplant', n: 'Aubergine', size: 0.22, e: 10 },
  leek:           { f: X + 'leek', n: 'Lauch', size: 0.45, e: 8, lie: 'z' },
  lemon:          { f: X + 'lemon', n: 'Zitrone', size: 0.09, e: 5, msg: 'Sauer!' },
  onion:          { f: X + 'onion', n: 'Zwiebel', size: 0.09, e: 5, msg: 'Da kommen einem die Tränen …' },
  paprika:        { f: X + 'paprika', n: 'Peperoni', size: 0.12, e: 8 },
  chili:          { f: X + 'pepper', n: 'Chili', size: 0.12, e: 5, msg: 'Scharf! Wasser!' },
  pineapple:      { f: X + 'pineapple', n: 'Ananas', size: 0.3, e: 20 },
  radish:         { f: X + 'radish', n: 'Radieschen', s: 'Radies­chen', size: 0.1, e: 5 },
  tomato:         { f: X + 'tomato', n: 'Tomate', size: 0.08, e: 6 },
  // ---- Brot, Fleisch & Hauptgerichte ----
  loaf:           { f: X + 'loaf', n: 'Zopf', size: 0.35, e: 25 },
  loaf_round:     { f: X + 'loaf-round', n: 'Bauernbrot', s: 'Bauern­brot', size: 0.3, e: 28 },
  bacon:          { f: X + 'bacon', n: 'Speck', size: 0.2, e: 15, lie: 'z' },
  meat_raw:       { f: X + 'meat-raw', n: 'Rohes Steak', s: 'Steak', size: 0.2, e: 12, msg: 'Lieber braten …' },
  turkey:         { f: X + 'turkey', n: 'Truthahn', size: 0.45, e: 40 },
  meat_skewer:    { f: X + 'skewer', n: 'Fleischspiess', s: 'Fleisch­spiess', size: 0.3, e: 22 },
  veg_skewer:     { f: X + 'skewer-vegetables', n: 'Gemüsespiess', s: 'Gemüse­spiess', size: 0.3, e: 15 },
  cheeseburger:   { f: X + 'burger-cheese', n: 'Cheeseburger', s: 'Cheese­burger', size: 0.13, e: 32 },
  sub:            { f: X + 'sub', n: 'Sandwich lang', s: 'Sub', size: 0.3, e: 28 },
  corn_dog:       { f: X + 'corn-dog', n: 'Corndog', size: 0.25, e: 18 },
  frikandel:      { f: X + 'frikandel-speciaal', n: 'Frikandel', size: 0.25, e: 20 },
  fries:          { f: X + 'fries', n: 'Pommes', size: 0.18, e: 20 },
  noodles:        { f: X + 'chinese', n: 'Nudelbox', size: 0.15, e: 25 },
  soup:           { f: X + 'bowl-soup', n: 'Suppe', size: 0.18, e: 20, msg: 'Schön warm!' },
  cereal:         { f: X + 'bowl-cereal', n: 'Müesli', size: 0.18, e: 18 },
  salad:          { f: X + 'salad', n: 'Salat', size: 0.2, e: 12 },
  stew:           { f: X + 'pan-stew', n: 'Eintopf', size: 0.4, e: 35 },
  sauerkraut:     { f: X + 'plate-sauerkraut', n: 'Sauerkraut', s: 'Sauer­kraut', size: 0.3, e: 25 },
  fried_egg:      { f: X + 'egg-cooked', n: 'Spiegelei', size: 0.15, e: 12 },
  pancakes:       { f: X + 'pancakes', n: 'Pfannkuchen', s: 'Pfann­kuchen', size: 0.2, e: 25 },
  waffle:         { f: X + 'waffle', n: 'Waffel', size: 0.15, e: 15 },
  mince_pie:      { f: X + 'mincemeat-pie', n: 'Fleischpastete', s: 'Pastete', size: 0.25, e: 30 },
  canned:         { f: X + 'can', n: 'Konservendose', s: 'Konserve', size: 0.12, e: 20 },
  fish_large:     { f: 'survival/fish-large', n: 'Lachs', size: 0.5, e: 28, lie: 'x' },
  mussel:         { f: X + 'mussel', n: 'Muschel', size: 0.08, e: 5 },
  // ---- Sushi & Asiatisch ----
  maki_salmon:    { f: X + 'maki-salmon', n: 'Lachs-Maki', size: 0.04, e: 6 },
  maki_veg:       { f: X + 'maki-vegetable', n: 'Gemüse-Maki', size: 0.04, e: 5 },
  maki_roe:       { f: X + 'maki-roe', n: 'Rogen-Maki', size: 0.04, e: 6 },
  sushi_salmon:   { f: X + 'sushi-salmon', n: 'Lachs-Sushi', size: 0.07, e: 7 },
  sushi_egg:      { f: X + 'sushi-egg', n: 'Ei-Sushi', size: 0.07, e: 6 },
  rice_ball:      { f: X + 'rice-ball', n: 'Reisbällchen', s: 'Reis­bällchen', size: 0.08, e: 10 },
  dim_sum:        { f: X + 'dim-sum', n: 'Dim Sum', size: 0.06, e: 8 },
  // ---- Süsses ----
  birthday_cake:  { f: X + 'cake-birthday', n: 'Geburtstagstorte', s: 'Torte', size: 0.3, e: 40, msg: 'Happy Birthday!' },
  cupcake:        { f: X + 'cupcake', n: 'Cupcake', size: 0.09, e: 14 },
  muffin:         { f: X + 'muffin', n: 'Muffin', size: 0.09, e: 14 },
  donut_choc:     { f: X + 'donut-chocolate', n: 'Schoko-Donut', s: 'Schoko­donut', size: 0.12, e: 15 },
  choc_cookie:    { f: X + 'cookie-chocolate', n: 'Schoko-Guetzli', s: 'Schoko­guetzli', size: 0.07, e: 9 },
  gingerbread:    { f: X + 'ginger-bread', n: 'Lebkuchen', size: 0.15, e: 12 },
  chocolate:      { f: X + 'chocolate', n: 'Schokolade', s: 'Schoggi', size: 0.16, e: 15, msg: 'Feine Schoggi!' },
  candy_bar:      { f: X + 'candy-bar', n: 'Schokoriegel', s: 'Riegel', size: 0.13, e: 12 },
  lollipop:       { f: X + 'lollypop', n: 'Lutscher', size: 0.15, e: 5, lie: 'z' },
  popsicle:       { f: X + 'popsicle', n: 'Glace am Stiel', s: 'Glacestängel', size: 0.15, e: 8, lie: 'z' },
  popsicle_choc:  { f: X + 'popsicle-chocolate', n: 'Schoko-Glace', s: 'Schokoglace', size: 0.15, e: 9, lie: 'z' },
  ice_cone:       { f: X + 'ice-cream-cne', n: 'Glace im Cornet', s: 'Cornet', size: 0.15, e: 12 },
  ice_cup:        { f: X + 'ice-cream-cup', n: 'Glacebecher', s: 'Glace­becher', size: 0.1, e: 12 },
  sundae:         { f: X + 'sundae', n: 'Coupe', size: 0.2, e: 18 },
  pudding:        { f: X + 'pudding', n: 'Pudding', size: 0.09, e: 12 },
  honey:          { f: X + 'honey', n: 'Honigtopf', size: 0.12, e: 15, msg: 'Mmh, süss!' },
  peanut_butter:  { f: X + 'peanut-butter', n: 'Erdnussbutter', s: 'Erdnuss­butter', size: 0.1, e: 18 },
  ketchup:        { f: X + 'bottle-ketchup', n: 'Ketchup', size: 0.2, e: 5 },
  mustard:        { f: X + 'bottle-musterd', n: 'Senf', size: 0.2, e: 5 },
  // ---- Getränke ----
  milk:           { f: X + 'carton', n: 'Milch', size: 0.22, e: 12, drink: true },
  coffee:         { f: X + 'cup-coffee', n: 'Kaffee', size: 0.1, e: 6, drink: true, msg: 'Jetzt bist du hellwach!' },
  frappe:         { f: X + 'frappe', n: 'Frappé', size: 0.18, e: 10, drink: true },
  cocktail:       { f: X + 'cocktail', n: 'Fruchtcocktail', s: 'Frucht­cocktail', size: 0.18, e: 10, drink: true },
  soda_bottle:    { f: X + 'soda-bottle', n: 'Cola', size: 0.3, e: 8, drink: true },
  soda_glass:     { f: X + 'soda-glass', n: 'Eistee', size: 0.16, e: 8, drink: true },
  water_glass:    { f: X + 'glass', n: 'Glas Wasser', s: 'Wasser', size: 0.12, e: 5, drink: true, msg: 'Erfrischend!' },
  apple_juice:    { f: X + 'wine-white', n: 'Apfelsaft', size: 0.3, e: 8, drink: true },
  water_bottle:   { f: 'survival/bottle', n: 'Wasserflasche', s: 'Wasser­flasche', size: 0.25, e: 5, drink: true, msg: 'Erfrischend!' },
};
for (const d of Object.values(food)) { d.c = E; d.pick = true; d.stack = true; d.hold = 'palm'; }

// Küche & Haushalt (Werkzeuge) – liegen im Modell flach → Handfläche
const tools = {
  frying_pan:     { f: X + 'frying-pan', n: 'Bratpfanne', s: 'Brat­pfanne', size: 0.5 },
  kitchen_knife:  { f: X + 'cooking-knife', n: 'Küchenmesser', s: 'Küchen­messer', size: 0.3 },
  rolling_pin:    { f: X + 'rollingPin', n: 'Wallholz', size: 0.45 },
  whisk:          { f: X + 'whisk', n: 'Schwingbesen', s: 'Schwing­besen', size: 0.3 },
  spatula:        { f: X + 'cooking-spatula', n: 'Bratschaufel', s: 'Brat­schaufel', size: 0.32 },
  cooking_spoon:  { f: X + 'cooking-spoon', n: 'Kochlöffel', s: 'Koch­löffel', size: 0.32 },
  pepper_mill:    { f: X + 'pepper-mill', n: 'Pfeffermühle', s: 'Pfeffer­mühle', size: 0.22 },
  salt_shaker:    { f: X + 'shaker-salt', n: 'Salzstreuer', s: 'Salz­streuer', size: 0.09 },
  mortar:         { f: X + 'mortar-pestle', n: 'Mörser', size: 0.15 },
  cutting_board:  { f: X + 'cutting-board', n: 'Schneidebrett', s: 'Schneide­brett', size: 0.4 },
  pizza_cutter:   { f: X + 'pizza-cutter', n: 'Pizzaschneider', s: 'Pizza­schneider', size: 0.2 },
  meat_mallet:    { f: X + 'meat-tenderizer', n: 'Fleischklopfer', s: 'Fleisch­klopfer', size: 0.28 },
  plate:          { f: X + 'mk_table_plate', n: 'Teller', size: 0.26 },
  fork:           { f: X + 'mk_table_fork', n: 'Gabel', size: 0.19 },
  knife:          { f: X + 'mk_table_knife', n: 'Messer', size: 0.21 },
  spoon:          { f: X + 'mk_table_spoon', n: 'Löffel', size: 0.18 },
  pot:            { f: X + 'mk_pot_1', n: 'Kochtopf', size: 0.35 },
  tankard:        { f: X + 'mk_mug', n: 'Holzkrug', size: 0.15 },
  bottle:         { f: X + 'mk_bottle_1', n: 'Flasche', size: 0.3 },
  vial:           { f: X + 'mk_smallbottle', n: 'Fläschchen', size: 0.1 },
  vase:           { f: X + 'mk_vase_4', n: 'Vase', size: 0.4 },
  amphora:        { f: X + 'mk_vase_2', n: 'Tonkrug', size: 0.55 },
  bucket_metal:   { f: X + 'mk_bucket_metal', n: 'Blecheimer', size: 0.35 },
  candle:         { f: X + 'mk_candle_1', n: 'Kerze', size: 0.1 },
  candle_long:    { f: X + 'mk_candle_2', n: 'Lange Kerze', s: 'Kerze', size: 0.2 },
  candlestick:    { f: X + 'mk_candlestick', n: 'Kerzenhalter', s: 'Kerzen­halter', size: 0.2 },
  candelabra:     { f: X + 'mk_candlestick_triple', n: 'Kerzenleuchter', s: 'Leuchter', size: 0.4 },
  chain:          { f: X + 'mk_chain_coil', n: 'Kette', size: 0.6 },
  key_iron:       { f: X + 'mk_key_metal', n: 'Eisenschlüssel', s: 'Eisen­schlüssel', size: 0.11 },
  sack:           { f: X + 'mk_bag', n: 'Sack', size: 0.7 },
  padlock:        { f: X + 'rpg_padlock', n: 'Vorhängeschloss', s: 'Schloss', size: 0.1, msg: 'Fest verschlossen.' },
  glove:          { f: X + 'rpg_glove', n: 'Lederhandschuh', s: 'Handschuh', size: 0.25 },
  backpack:       { f: X + 'rpg_backpack', n: 'Rucksack', size: 0.5, msg: 'Da passt viel hinein.' },
  bag:            { f: X + 'rpg_bag', n: 'Tasche', size: 0.4 },
  potion_empty:   { f: X + 'rpg_potion1_empty', n: 'Leere Flasche', s: 'Leer­flasche', size: 0.2 },
};
for (const d of Object.values(tools)) { d.c = T; d.pick = true; d.hold = 'palm'; }

const treasure = {
  // ---- Ringe & Schmuck ----
  ring_gold:      { f: X + 'rpg_ring2', n: 'Goldring', size: 0.03, p: 15 },
  ring_ruby:      { f: X + 'rpg_ring3', n: 'Rubinring', size: 0.03, p: 25, msg: 'Ein funkelnder Rubin!' },
  ring_turquoise: { f: X + 'rpg_ring4', n: 'Türkisring', size: 0.03, p: 22 },
  ring_amethyst:  { f: X + 'rpg_ring5', n: 'Amethystring', s: 'Amethyst­ring', size: 0.03, p: 22 },
  ring_emerald:   { f: X + 'rpg_ring6', n: 'Smaragdring', s: 'Smaragd­ring', size: 0.03, p: 28 },
  ring_dark:      { f: X + 'rpg_ring7', n: 'Dunkler Ring', size: 0.03, p: 18, msg: 'Der Ring fühlt sich kalt an …' },
  necklace_ruby:  { f: X + 'rpg_necklace2', n: 'Rubinkette', size: 0.15, p: 35 },
  necklace_jade:  { f: X + 'rpg_necklace3', n: 'Jadekette', size: 0.15, p: 35 },
  crown_ruby:     { f: X + 'rpg_crown2', n: 'Rubinkrone', size: 0.25, p: 120, msg: 'Eine Krone mit Rubinen!' },
  chalice:        { f: X + 'rpg_chalice', n: 'Goldkelch', size: 0.2, p: 40, msg: 'Ein Kelch aus purem Gold.' },
  coin_skull:     { f: X + 'rpg_coin_skull', n: 'Piratenmünze', s: 'Piraten­münze', size: 0.04, p: 8, stack: true },
  coin_star:      { f: X + 'rpg_coin_star', n: 'Sternmünze', s: 'Stern­münze', size: 0.04, p: 8, stack: true },
  star:           { f: X + 'rpg_star', n: 'Goldstern', size: 0.2, p: 30, msg: 'Ein Stern ist vom Himmel gefallen!' },
  heart:          { f: X + 'rpg_heart', n: 'Rubinherz', size: 0.15, p: 30 },
  pouch:          { f: X + 'rpg_pouch', n: 'Münzbeutel', size: 0.15, p: 12, msg: 'Es klimpert darin.' },
  pouch_large:    { f: X + 'mk_pouch_large', n: 'Grosser Beutel', s: 'Beutel', size: 0.22, p: 10 },
  // ---- Kristalle & Mineralien ----
  crystal_pink:   { f: X + 'rpg_crystal2', n: 'Rosa Kristall', s: 'Kristall', size: 0.22, p: 25, msg: 'Der Kristall glitzert rosa.' },
  crystal_green:  { f: X + 'rpg_crystal3', n: 'Grüner Kristall', s: 'Kristall', size: 0.2, p: 25 },
  crystal_red:    { f: X + 'rpg_crystal4', n: 'Roter Kristall', s: 'Kristall', size: 0.15, p: 25 },
  crystal_cyan:   { f: X + 'rpg_crystal5', n: 'Türkiser Kristall', s: 'Kristall', size: 0.15, p: 25 },
  mineral:        { f: X + 'rpg_mineral', n: 'Erzbrocken', s: 'Erz', size: 0.2, p: 10, msg: 'Da steckt etwas Wertvolles drin.' },
  // ---- Schlüssel, Bücher, Schriften ----
  key_wood:       { f: X + 'rpg_key2', n: 'Alter Schlüssel', s: 'Schlüssel', size: 0.12, p: 6 },
  key_steel:      { f: X + 'rpg_key3', n: 'Stahlschlüssel', s: 'Stahl­schlüssel', size: 0.13, p: 8 },
  key_golden:     { f: X + 'rpg_key4', n: 'Goldener Schlüssel', s: 'Gold­schlüssel', size: 0.13, p: 20, msg: 'Wozu der wohl passt?' },
  book_red:       { f: X + 'rpg_book2_closed', n: 'Rotes Buch', size: 0.25, p: 15, lie: 'z', msg: 'Ein Buch voller Zaubersprüche.' },
  book_brown:     { f: X + 'rpg_book3_closed', n: 'Tagebuch', size: 0.25, p: 12, lie: 'z', msg: '«Der Schatz liegt unter dem grössten Baum.»' },
  book_teal:      { f: X + 'rpg_book4_closed', n: 'Altes Buch', size: 0.25, p: 15, lie: 'z', msg: 'Die Seiten sind voller Sterne.' },
  book_open:      { f: X + 'rpg_book1_open', n: 'Offenes Buch', s: 'Buch', size: 0.35, p: 12, msg: 'Jemand hat hier mitten im Satz aufgehört …' },
  book_leather:   { f: X + 'mk_book_5', n: 'Lederbuch', size: 0.25, p: 10 },
  book_clasp:     { f: X + 'mk_book_7', n: 'Buch mit Schloss', s: 'Buch', size: 0.28, p: 18, msg: 'Verschlossen – was da wohl drinsteht?' },
  parchment:      { f: X + 'rpg_parchment', n: 'Pergament', size: 0.3, p: 6, lie: 'x', msg: '«Folge dem Fluss nach Norden.»' },
  scroll_old:     { f: X + 'mk_scroll_2', n: 'Alte Schriftrolle', s: 'Schrift­rolle', size: 0.25, p: 8, msg: 'Eine alte Karte!' },
  // ---- Unheimliches ----
  skull:          { f: X + 'rpg_skull', n: 'Totenkopf', size: 0.2, p: 5, msg: 'Uuuh, gruselig!' },
  skull_horned:   { f: X + 'rpg_skull2', n: 'Gehörnter Schädel', s: 'Schädel', size: 0.3, p: 10, msg: 'Von welchem Tier der wohl ist?' },
  // ---- Rüstungen ----
  armor_leather:  { f: X + 'rpg_armor_leather', n: 'Lederrüstung', s: 'Leder­rüstung', size: 0.55, p: 30 },
  armor_iron:     { f: X + 'rpg_armor_metal', n: 'Eisenrüstung', s: 'Eisen­rüstung', size: 0.6, p: 50 },
  armor_steel:    { f: X + 'rpg_armor_metal2', n: 'Stahlrüstung', s: 'Stahl­rüstung', size: 0.6, p: 60 },
  armor_black:    { f: X + 'rpg_armor_black', n: 'Schwarze Rüstung', s: 'Schwarz­rüstung', size: 0.6, p: 70 },
  armor_golden:   { f: X + 'rpg_armor_golden', n: 'Goldrüstung', s: 'Gold­rüstung', size: 0.6, p: 150, msg: 'Eine Rüstung wie für einen König!' },
};
for (const d of Object.values(treasure)) { d.c = S; d.pick = true; d.hold = 'palm'; }
// Ringe und Münzen stehen im Modell aufrecht → zum Hinlegen kippen
for (const k of ['ring_gold', 'ring_ruby', 'ring_turquoise', 'ring_amethyst', 'ring_emerald', 'ring_dark', 'coin_skull', 'coin_star', 'star', 'heart']) treasure[k].lie = 'x';

const potions = {
  potion_cyan:    { f: X + 'rpg_potion5_filled', n: 'Frosttrank', size: 0.25, e: 15, msg: 'Brrr, eiskalt!' },
  potion_fire:    { f: X + 'rpg_potion6_filled', n: 'Feuertrank', size: 0.25, e: 25, msg: 'Dir wird ganz warm!' },
  potion_gold:    { f: X + 'rpg_potion7_filled', n: 'Glückstrank', s: 'Glücks­trank', size: 0.25, e: 20, msg: 'Heute ist dein Glückstag!' },
  potion_pink:    { f: X + 'rpg_potion8_filled', n: 'Liebestrank', s: 'Liebes­trank', size: 0.15, e: 10, msg: 'Alles sieht so rosa aus …' },
  potion_poison:  { f: X + 'rpg_potion9_filled', n: 'Krötentrank', s: 'Kröten­trank', size: 0.2, e: 5, msg: 'Igitt! Schmeckt nach Sumpf.' },
  potion_mana:    { f: X + 'rpg_potion10_filled', n: 'Manatrank', size: 0.15, e: 20, msg: 'Du spürst Magie in dir.' },
  potion_big:     { f: X + 'rpg_potion11_filled', n: 'Grosser Trank', s: 'Gross­trank', size: 0.22, e: 40, msg: 'Was für ein Schluck!' },
};
for (const d of Object.values(potions)) { d.c = S; d.pick = true; d.stack = true; d.hold = 'palm'; d.drink = true; d.p = 12; }

const weapons = {
  // gleiche Geometrie wie axe_small / axe_double / hammer_double / arrow / dart in items.js
  axe_small_golden:     { f: X + 'rpg_axe_small_golden', n: 'Goldaxt', size: 0.8, lie: 'x', hold: 'blade', grip: -0.45, p: 60 },
  axe_double_golden:    { f: X + 'rpg_axe_double_golden', n: 'Goldene Doppelaxt', s: 'Gold-Doppelaxt', size: 1.0, lie: 'x', hold: 'blade', grip: -0.45, p: 90 },
  hammer_double_golden: { f: X + 'rpg_hammer_double_golden', n: 'Goldener Kriegshammer', s: 'Goldhammer', size: 1.1, lie: 'x', hold: 'blade', grip: -0.55, p: 100 },
  arrow_golden:         { f: X + 'rpg_arrow_golden', n: 'Goldpfeil', size: 0.75, stack: true, lie: 'x', hold: 'blade', grip: -0.1, p: 5 },
  dart_golden:          { f: X + 'rpg_dart_golden', n: 'Goldener Wurfpfeil', s: 'Gold-Wurfpfeil', size: 0.3, stack: true, lie: 'x', hold: 'blade', grip: -0.05, p: 4 },
};
for (const d of Object.values(weapons)) { d.c = W; d.pick = true; }

const materials = {
  bone:           { f: X + 'rpg_bone', n: 'Knochen', size: 0.3, msg: 'Ein Hund würde sich freuen.' },
  fish_bone:      { f: X + 'rpg_fishbone', n: 'Fischgräte', s: 'Gräte', size: 0.25 },
};
for (const d of Object.values(materials)) { d.c = R; d.pick = true; d.stack = true; d.hold = 'palm'; }

export const EXTRA = { ...food, ...tools, ...treasure, ...potions, ...weapons, ...materials };

export const EXTRA_SPAWN = {
  market: ['avocado', 'beet', 'broccoli', 'cabbage', 'cauliflower', 'celery', 'cherries', 'coconut', 'eggplant', 'leek', 'lemon',
    'onion', 'paprika', 'chili', 'pineapple', 'radish', 'tomato', 'loaf', 'loaf_round', 'bacon', 'meat_raw', 'turkey', 'fish_large',
    'mussel', 'honey', 'milk', 'apple_juice', 'gingerbread', 'chocolate', 'muffin', 'cupcake', 'birthday_cake', 'peanut_butter',
    'canned', 'ketchup', 'mustard', 'maki_salmon', 'sushi_salmon', 'rice_ball', 'pudding', 'waffle'],
  camp: ['meat_skewer', 'veg_skewer', 'stew', 'soup', 'fried_egg', 'canned', 'coffee', 'water_bottle', 'loaf_round', 'bacon',
    'fish_large', 'corn_dog', 'pancakes', 'frying_pan', 'pot', 'tankard', 'candle', 'chain', 'sack', 'backpack', 'bone', 'fish_bone'],
  treasure: ['ring_gold', 'ring_ruby', 'ring_turquoise', 'ring_amethyst', 'ring_emerald', 'ring_dark', 'necklace_ruby', 'necklace_jade',
    'chalice', 'coin_skull', 'coin_star', 'star', 'heart', 'pouch', 'crystal_pink', 'crystal_green', 'crystal_red', 'crystal_cyan',
    'mineral', 'pouch_large', 'key_wood', 'key_steel', 'key_golden', 'book_red', 'book_brown', 'book_teal', 'book_clasp', 'parchment', 'scroll_old',
    'skull', 'potion_cyan', 'potion_fire', 'potion_gold', 'potion_pink', 'potion_poison', 'potion_mana', 'potion_big', 'arrow_golden',
    'dart_golden', 'padlock'],
  rare: ['crown_ruby', 'armor_golden', 'axe_double_golden', 'hammer_double_golden', 'axe_small_golden', 'armor_black'],
  village: ['frying_pan', 'kitchen_knife', 'rolling_pin', 'whisk', 'spatula', 'cooking_spoon', 'pepper_mill', 'salt_shaker', 'mortar',
    'cutting_board', 'pizza_cutter', 'meat_mallet', 'plate', 'fork', 'knife', 'spoon', 'pot', 'tankard', 'bottle', 'vial', 'vase',
    'amphora', 'bucket_metal', 'candle', 'candle_long', 'candlestick', 'candelabra', 'key_iron', 'sack', 'glove', 'bag', 'potion_empty',
    'book_leather', 'book_open', 'armor_leather', 'armor_iron', 'armor_steel', 'skull_horned'],
  // Strassenstand / Imbiss (Fast Food, Süsses, Getränke)
  snack: ['cheeseburger', 'sub', 'corn_dog', 'frikandel', 'fries', 'noodles', 'salad', 'sauerkraut', 'mince_pie', 'maki_veg', 'maki_roe',
    'sushi_egg', 'dim_sum', 'donut_choc', 'choc_cookie', 'candy_bar', 'lollipop', 'popsicle', 'popsicle_choc', 'ice_cone', 'ice_cup',
    'sundae', 'cereal', 'frappe', 'cocktail', 'soda_bottle', 'soda_glass', 'water_glass'],
};
