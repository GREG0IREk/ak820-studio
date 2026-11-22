// Firmware QMK « Cadran » (dossier firmware/ du dépôt) : canal HID d'AK820 Studio.
//
// Le firmware QMK expose une seule interface de contrôle : le HID brut de QMK
// (page 0xFF60, usage 0x61, rapports de 32 octets). Les commandes reprennent le cadre
// des valeurs personnalisées de VIA : [0x07, canal, commande, arguments…] ; la réponse
// reprend le paquet, avec data[0] = 0xFF si la commande est refusée.
//   canal 0x10 : horloge     canal 0x13 : système (version)     canal 0x14 : AK820 Studio
// Détail des commandes du canal 0x14 : firmware/qmk/…/keymaps/cadran/studio.c.

export const FAMILY_Q = 'Q';
export const PAGE_RAW = 0xff60;
export const USAGE_RAW = 0x61;
export const Q_REPORT = 32;

export const Q_SET = 0x07;
export const Q_REFUSED = 0xff;
export const CH_CLOCK = 0x10;
export const CH_SYS = 0x13;
export const CH_STUDIO = 0x14;

export const QC = {
  INFO: 0x01, EFFECT_NAME: 0x02, LIGHT_GET: 0x03, LIGHT_SET: 0x04, SLEEP_SET: 0x05,
  KEYMAP_GET: 0x06, KEY_SET: 0x07, KEYMAP_DEFAULT: 0x08, MATRIX: 0x09,
  PERKEY_GET: 0x0a, PERKEY_SET: 0x0b, PERKEY_SAVE: 0x0c, THEME_NAME: 0x0d, THEME_SET: 0x0e,
  MACRO_INFO: 0x0f, MACRO_GET: 0x10, MACRO_SET: 0x11,
};
export const SYS_VERSION = 0x02;
export const Q_KEYMAP_CHUNK = 26;
export const Q_PERKEY_CHUNK = 9;
export const Q_MACRO_CHUNK = 26;
/** Codes QMK des macros : QK_MACRO (0x7700) + numéro de macro (0 à 7). */
export const QK_MACRO = 0x7700;
export const Q_MACRO_COUNT = 8;

/** Paquet de 32 octets [0x07, canal, commande, arguments…]. */
export function qFrame(channel, cmd, args = []) {
  const p = new Uint8Array(Q_REPORT);
  p[0] = Q_SET;
  p[1] = channel;
  p[2] = cmd;
  p.set(Array.from(args).slice(0, Q_REPORT - 3), 3);
  return p;
}

/** Horloge : [année-2000, mois, jour, jour de la semaine (dim = 0), h, min, s]. */
export function qClockArgs(d) {
  const y = d.getFullYear();
  if (y < 2000 || y > 2099) throw new Error('Année hors plage 2000-2099');
  return [0x01, y - 2000, d.getMonth() + 1, d.getDate(), d.getDay(), d.getHours(), d.getMinutes(), d.getSeconds()];
}

export function qParseInfo(r) {
  const a = r.slice(3);
  const n = a[6];
  return {
    protocol: a[0], effectCount: a[1], layers: a[2], rows: a[3], cols: a[4], leds: a[5],
    sleepIndex: a[7], perkeyEffect: a[8] === 0xff ? null : a[8], defaultLayer: a[9],
    battery: a[10] === 0xff ? null : a[10],
    sleepMinutes: Array.from(a.slice(11, 11 + n)),
    // Protocole 2 (Cadran 1.2) : interfaces de l'écran.
    themeCount: a[0] >= 2 ? a[16] : 0, theme: a[0] >= 2 ? a[17] : null,
  };
}

export function qString(bytes) {
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? bytes.slice(0, end) : bytes);
}

// ---------------------------------------------------------------- disposition

export const Q_LAYERS = [
  { id: 'base', label: 'Windows' },
  { id: 'fn', label: 'Windows + Fn' },
  { id: 'mac', label: 'Mac' },
  { id: 'macfn', label: 'Mac + Fn' },
];
export const Q_ROWS = 6;
export const Q_COLS = 15;

/**
 * Emplacement de l'application (layouts.js) -> [ligne, colonne] de la matrice QMK
 * (keyboard.json du portage fpb, LAYOUT_82_ansi). « * µ » (ISO) partage l'emplacement 97
 * avec « \ » (ANSI) dans le firmware Ajazz, donc la même position. « < > » (98) est absent
 * du portage fpb : position [4, 1] supposée, à confirmer avec le test des touches.
 */
export const SLOT_MATRIX = new Map([
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => [c, [0, c]]), [106, [0, 13]],
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => [16 + c, [1, c]]), [92, [1, 13]], [107, [1, 14]],
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((c) => [32 + c, [2, c]]), [97, [2, 13]], [105, [2, 14]],
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => [48 + c, [3, c]]), [76, [3, 13]], [108, [3, 14]],
  [64, [4, 0]], [98, [4, 1]], ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((c) => [63 + c, [4, c]]), [75, [4, 12]], [90, [4, 13]],
  [80, [5, 0]], [81, [5, 1]], [82, [5, 2]], [83, [5, 6]], [84, [5, 9]], [85, [5, 10]], [87, [5, 11]],
  [88, [5, 12]], [89, [5, 13]], [91, [5, 14]],
]);

/** Positions de matrice dans l'ordre des LED (rgb_matrix du portage fpb, 81 LED). */
const LED_ORDER = [
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9], [0, 10], [0, 11], [0, 12], [0, 13],
  [1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [1, 7], [1, 8], [1, 9], [1, 10], [1, 11], [1, 12], [1, 13], [1, 14],
  [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [2, 7], [2, 8], [2, 9], [2, 10], [2, 11], [2, 12], [2, 13], [2, 14],
  [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7], [3, 8], [3, 9], [3, 10], [3, 11], [3, 13], [3, 14],
  [4, 0], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [4, 7], [4, 8], [4, 9], [4, 10], [4, 11], [4, 12], [4, 13],
  [5, 0], [5, 1], [5, 2], [5, 6], [5, 9], [5, 10], [5, 11], [5, 12], [5, 13], [5, 14],
];
export const Q_LED_COUNT = LED_ORDER.length;

/** Emplacement de l'application -> index de LED (absent : pas de LED connue). */
export const SLOT_LED = new Map();
for (const [slot, [r, c]] of SLOT_MATRIX) {
  const i = LED_ORDER.findIndex(([lr, lc]) => lr === r && lc === c);
  if (i >= 0) SLOT_LED.set(slot, i);
}

/** Décode une couche (MATRIX_ROWS × MATRIX_COLS × 2 octets) en actions par emplacement. */
export function qDecodeLayer(bytes, cols = Q_COLS) {
  const slots = Array.from({ length: 128 }, () => null);
  for (const [slot, [r, c]] of SLOT_MATRIX) {
    const o = (r * cols + c) * 2;
    slots[slot] = { kind: 'qmk', code: (bytes[o] << 8) | bytes[o + 1] };
  }
  return slots;
}

// ---------------------------------------------------------------- couleurs

export function rgbToHsv8([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  h = Math.round(((h * 60 + 360) % 360) / 360 * 255) & 0xff;
  return [h, max ? Math.round((d / max) * 255) : 0, max];
}

export function hsv8ToRgb(h, s, v = 255) {
  const H = (h / 255) * 6, S = s / 255, V = v / 255;
  const f = (n) => { const k = (n + H) % 6; return V - V * S * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}

const HUE_NAMES = ['Rouge', 'Orange', 'Jaune', 'Lime', 'Vert', 'Menthe', 'Cyan', 'Azur', 'Bleu', 'Violet', 'Magenta', 'Rose'];
/** Nom d'une couleur « #rrggbb » : les mêmes noms que le menu de l'écran du clavier. */
export function colorName(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return '';
  const rgb = [1, 2, 3].map((i) => parseInt(m[i], 16));
  const [h, s, v] = rgbToHsv8(rgb);
  if (v < 40) return 'Noir';
  if (s < 50) return v > 200 ? 'Blanc' : 'Gris';
  return HUE_NAMES[Math.round((h / 255) * 12) % 12];
}

/** Aperçu des effets du firmware, par nom (voir EFFECTS dans graphics/display.c). */
const PREVIEW = {
  'Fixe': { key: 'static', noSpeed: true },
  'Touche allumée': { key: 'single-on' },
  'Touche éteinte': { key: 'single-off' },
  'Scintillement': { key: 'glittering' },
  'Pluie': { key: 'falling' },
  'Multicolore': { key: 'colourful', rainbow: true, noColor: true },
  'Respiration': { key: 'breath' },
  'Spectre': { key: 'spectrum', rainbow: true, noColor: true },
  'Vague centrale': { key: 'outward', rainbow: true, noColor: true },
  'Défilement': { key: 'scrolling', rainbow: true, noColor: true },
  'Roulement': { key: 'rolling', rainbow: true, noColor: true },
  'Rotation': { key: 'rotating', rainbow: true, noColor: true },
  'Spirale': { key: 'rotating', rainbow: true, noColor: true },
  'Explosion': { key: 'explode', rainbow: true, noColor: true },
  'Lancement': { key: 'launch' },
  'Ondulations': { key: 'ripples' },
  'Flux': { key: 'flowing', rainbow: true, noColor: true },
  'Pulsation': { key: 'pulsating' },
  'Bascule': { key: 'tilt' },
  'Navette': { key: 'shuttle' },
  'Chaleur': { key: 'heat', noColor: true },
  'Personnalisé': { key: 'custom', noSpeed: true, noColor: true },
  'Éteint': { key: 'off', noSpeed: true, noColor: true },
};
export function qEffectInfo(name, id) {
  return { id, name, key: 'static', ...(PREVIEW[name] || {}) };
}

// ---------------------------------------------------------------- codes de touche QMK

export const KC_NO = 0x0000;
export const KC_TRNS = 0x0001;

export const QMK_MEDIA = [
  [0x00ae, 'Lecture / pause'], [0x00ab, 'Piste suivante'], [0x00ac, 'Piste précédente'], [0x00ad, 'Stop'],
  [0x00a9, 'Volume +'], [0x00aa, 'Volume -'], [0x00a8, 'Muet'],
  [0x00bd, 'Luminosité écran +'], [0x00be, 'Luminosité écran -'],
  [0x00b2, 'Calculatrice'], [0x00b1, 'Courrier'], [0x00b3, 'Explorateur de fichiers'],
  [0x00b5, 'Navigateur : accueil'], [0x00b4, 'Recherche'], [0x00b6, 'Navigateur : précédent'], [0x00b7, 'Navigateur : suivant'],
  [0x00b9, 'Navigateur : actualiser'], [0x00c1, 'Mission Control'], [0x00c2, 'Launchpad'],
  [0x00a6, 'Veille de l\'ordinateur'],
];

export const QMK_LIGHTING = [
  [0x7842, 'Éclairage marche / arrêt'], [0x7843, 'Effet suivant'], [0x7844, 'Effet précédent'],
  [0x7849, 'Luminosité +'], [0x784a, 'Luminosité -'], [0x784b, 'Vitesse +'], [0x784c, 'Vitesse -'],
  [0x7845, 'Teinte +'], [0x7846, 'Teinte -'], [0x7847, 'Saturation +'], [0x7848, 'Saturation -'],
];

/** Touches propres au clavier (ak820pro.h, à partir de QK_KB_0 = 0x7E00) et touches QMK utiles. */
export const QMK_KEYBOARD = [
  [0x5221, 'Fn'], [0x5223, 'Fn (Mac)'],
  [0x7e00, 'Écran marche / arrêt'], [0x7e01, 'Bluetooth 1'], [0x7e02, 'Bluetooth 2'], [0x7e03, 'Bluetooth 3'],
  [0x7e04, '2,4 GHz'], [0x7e05, 'Appairage (appui long)'], [0x700b, 'Verrou touche Windows'],
  [0x7c00, 'Mode flash'], [KC_TRNS, 'Transparent (couche du dessous)'], [KC_NO, 'Aucune action'],
];

const MOD_NAMES = [[0x01, 'Ctrl'], [0x02, 'Maj'], [0x04, 'Alt'], [0x08, 'Win']];
/** Code de base HID (0x04-0xA4, modificateurs 0xE0-0xE7) : même valeur que l'usage HID. */
export const isBasicHid = (code) => (code >= 0x04 && code <= 0xa4) || (code >= 0xe0 && code <= 0xe7);

/** Libellé d'un code QMK ; hidLabel(code) donne le nom d'une touche de base dans la disposition choisie. */
export function qmkKeyLabel(code, hidLabel) {
  if (isBasicHid(code)) return hidLabel(code) || `HID 0x${code.toString(16)}`;
  const named = [...QMK_MEDIA, ...QMK_LIGHTING, ...QMK_KEYBOARD].find(([c]) => c === code);
  if (named) return named[1];
  if (code >= 0x0100 && code <= 0x1fff) {
    const mods = (code >> 8) & 0x1f, base = code & 0xff;
    const names = MOD_NAMES.filter(([m]) => mods & m).map(([, n]) => (mods & 0x10 ? n + ' d.' : n));
    return [...names, qmkKeyLabel(base, hidLabel)].join('+');
  }
  if (code >= QK_MACRO && code < QK_MACRO + Q_MACRO_COUNT) return `Macro ${code - QK_MACRO + 1}`;
  if (code >= 0x5220 && code <= 0x523f) return `Couche ${code & 0x1f} (maintenue)`;
  if (code >= 0x5260 && code <= 0x527f) return `Couche ${code & 0x1f} (bascule)`;
  return `Code 0x${code.toString(16).padStart(4, '0')}`;
}
