// Protocole de la souris Ajazz AJ139 V2 MC (puce « YJX », famille Nordic du logiciel Ajazz 1.2.9).
// Établi par analyse du logiciel Windows (DeviceDriver.exe) et vérifié sur la souris le 26/11/2026.
//
// Interface HID n° 2 (page 0xFF01, usage 0x10), rapport 0, 64 octets dans chaque sens.
//   requête : 55 cmd drapeau somme long 00 00 profil données[8..63]
//   réponse : AA cmd ...       (même disposition, données à partir de l'octet 8)
//   somme   : octet 3 = somme(octets 4..63) & 0xFF
// Le drapeau vaut A5 ou AE selon la commande (copié du logiciel, sens non établi).

export const USB_FILTERS = [
  { vendorId: 0xa8a5, productId: 0x2255, usagePage: 0xff01 }, // dongle 2,4 GHz
  { vendorId: 0xa8a4, productId: 0x2255, usagePage: 0xff01 }, // câble
];

export const CMD = {
  INFO: 0x03, // identité du firmware (ASCII)
  KEYS_READ: 0x08, // 9 boutons × 4 octets
  KEYS_WRITE: 0x09,
  MACRO_DATA: 0x0d, // non utilisé ici
  SETTINGS_READ: 0x0e, // bloc de réglages
  SETTINGS_WRITE: 0x0f,
  LIGHT_LIVE: 0x21,
  DPI_LIVE: 0x22,
  RATE_LIVE: 0x23,
  BATTERY: 0x30,
};

export function frame(cmd, flag, len, body = [], profile = 0) {
  const d = new Uint8Array(64);
  d[0] = 0x55;
  d[1] = cmd;
  d[2] = flag;
  d[4] = len;
  d[7] = profile;
  d.set(body.slice(0, 56), 8);
  d[3] = checksum(d);
  return d;
}

export function checksum(d) {
  let s = 0;
  for (let i = 4; i < 64; i++) s += d[i];
  return s & 0xff;
}

export function isReply(r, cmd) {
  return r && r.length >= 8 && r[0] === 0xaa && r[1] === cmd;
}

// ---------- requêtes

export const readInfo = () => frame(CMD.INFO, 0x00, 0);
export const readBattery = () => frame(CMD.BATTERY, 0xa5, 0x2e);
export const readSettings = (p = 0) => frame(CMD.SETTINGS_READ, 0xa5, 0x30, [], p);
export const readKeys = (p = 0) => frame(CMD.KEYS_READ, 0xa5, 0x20, [], p);

// ---------- identité : « YJX.co.mouse2712 20Nov 12 2025 18:49:27 Feb 20 2024 20:18:19 »

export function parseInfo(r) {
  const txt = String.fromCharCode(...r.slice(8).filter((b) => b >= 0x20 && b < 0x7f));
  const m = txt.match(/^(.*?mouse)(\d{4})(\d{2})([A-Z][a-z]{2} +\d{1,2} \d{4})(\d{2}:\d{2}:\d{2})([A-Z][a-z]{2} +\d{1,2} \d{4})?(\d{2}:\d{2}:\d{2})?/);
  if (!m) return { raw: txt };
  return { raw: txt, vendor: m[1], model: m[2], version: m[3], mouseBuild: `${m[4]} ${m[5]}`, dongleBuild: m[6] ? `${m[6]} ${m[7]}` : '' };
}

export function parseBattery(r) {
  return { level: r[8], charging: r[9] !== 0 };
}

// ---------- réglages (commande 0x0E / 0x0F)

export const RATES = [125, 250, 500, 1000, 2000, 4000, 8000]; // index envoyé
export const SLEEP_MIN = [1, 3, 5, 10, 20, 30, 60]; // index envoyé
export const LIGHT_MODES = ['Vague', 'Néon', 'Flash cyclique', 'Balle yoyo', 'Flash simple', 'Respiration', 'Éteint'];
export const DPI_MIN = 50;
export const DPI_MAX = 26000;
export const DEBOUNCE_MAX = 20;

// bits de l'octet capteur
export const SENSOR = { ANGLE_SNAP: 0x01, RIPPLE: 0x10, MOTION_SYNC: 0x20 };

export function parseSettings(r) {
  const dpi = [];
  const colors = [];
  for (let i = 0; i < 6; i++) {
    dpi.push(r[13 + 2 * i] | (r[14 + 2 * i] << 8));
    colors.push([r[25 + 3 * i], r[26 + 3 * i], r[27 + 3 * i]]);
  }
  return {
    lightMode: r[9],
    rate: r[10],
    dpiCount: r[11],
    dpiIndex: Math.max(0, Math.min(5, r[12] - 1)),
    dpi,
    colors,
    scrollReverse: r[48] === 1,
    lod: r[49], // 1 = 1 mm, 2 = 2 mm, 0xFF = jamais réglé
    sensor: r[50],
    debounce: r[51],
    sleep: r[52],
    esports: r[53] === 1, // 0xFF = jamais réglé
    battery: r[54], // rempli par la souris
    wakeOnMove: r[55] === 1,
    raw: Array.from(r.slice(0, 64)),
  };
}

// Construit la trame 0x0F à partir des réglages lus (les octets non gérés sont recopiés).
export function writeSettings(s, p = 0) {
  const base = s.raw ? s.raw.slice(8, 56) : new Array(48).fill(0);
  const b = base.slice();
  b[0] = p;
  b[1] = s.lightMode & 0xff;
  b[2] = s.rate & 0xff;
  b[3] = s.dpiCount || 6;
  b[4] = (s.dpiIndex + 1) & 0xff;
  for (let i = 0; i < 6; i++) {
    const v = clampDpi(s.dpi[i]);
    b[5 + 2 * i] = v & 0xff;
    b[6 + 2 * i] = v >> 8;
    const c = s.colors[i] || [0, 0, 0];
    b[17 + 3 * i] = c[0];
    b[18 + 3 * i] = c[1];
    b[19 + 3 * i] = c[2];
  }
  b[40] = s.scrollReverse ? 1 : 0;
  b[41] = s.lod;
  b[42] = s.sensor & 0xff;
  b[43] = Math.max(0, Math.min(DEBOUNCE_MAX, s.debounce | 0));
  b[44] = s.sleep & 0xff;
  // 0xFF = jamais réglé (sortie d'usine) : conservé tant que l'option reste désactivée.
  b[45] = s.esports ? 1 : base[45] === 0xff ? 0xff : 0;
  // Le logiciel Ajazz écrit « réveil au mouvement » en 54 et le relit en 55 ; on remplit les deux.
  b[46] = s.wakeOnMove ? 1 : 0;
  b[47] = s.wakeOnMove ? 1 : 0;
  return frame(CMD.SETTINGS_WRITE, 0xae, 0x30, b, p);
}

export function clampDpi(v) {
  v = Math.round((v || DPI_MIN) / 50) * 50;
  return Math.max(DPI_MIN, Math.min(DPI_MAX, v));
}

// Réglages appliqués sans réécrire le bloc (utilisés par le logiciel pour les boutons DPI / taux).
export const liveDpi = (index, value, p = 0) => frame(CMD.DPI_LIVE, 0xae, 3, [0, 0, index + 1, value & 0xff, value >> 8], p);
export const liveRate = (rate, p = 0) => frame(CMD.RATE_LIVE, 0xae, 3, [0, 0, rate], p);
// Le mode écrit par 0x0F n'est appliqué qu'au prochain démarrage : 0x21 le change tout de suite.
export const liveLight = (mode, p = 0) => frame(CMD.LIGHT_LIVE, 0xa5, 3, [0, 0, mode], p);

// ---------- boutons (commande 0x08 / 0x09) : 9 emplacements de 4 octets

export const SLOTS = [
  { name: 'Clic gauche', locked: true },
  { name: 'Clic droit' },
  { name: 'Clic molette' },
  { name: 'Latéral arrière' },
  { name: 'Latéral avant' },
  { name: 'Bouton DPI' },
  { name: 'Molette vers le haut' },
  { name: 'Molette vers le bas' },
  { name: 'Emplacement 9', hidden: true },
];

export const DEFAULT_KEYS = [
  [0x20, 0x01, 0, 0],
  [0x20, 0x02, 0, 0],
  [0x20, 0x04, 0, 0],
  [0x20, 0x08, 0, 0],
  [0x20, 0x10, 0, 0],
  [0x21, 0x55, 0, 0],
  [0x21, 0x38, 0x01, 0],
  [0x21, 0x38, 0xff, 0],
  [0, 0, 0, 0],
];

// Fonctions proposées (codes relevés dans le décodeur du logiciel, fonction 0x411730).
export const ACTIONS = [
  { group: 'Souris', items: [
    ['Clic gauche', [0x20, 0x01, 0, 0]],
    ['Clic droit', [0x20, 0x02, 0, 0]],
    ['Clic molette', [0x20, 0x04, 0, 0]],
    ['Précédent', [0x20, 0x08, 0, 0]],
    ['Suivant', [0x20, 0x10, 0, 0]],
    ['Double-clic', [0x20, 0x01, 0x02, 0]],
    ['Molette vers le haut', [0x21, 0x38, 0x01, 0]],
    ['Molette vers le bas', [0x21, 0x38, 0xff, 0]],
  ] },
  { group: 'DPI et taux', items: [
    ['DPI suivant (bouton DPI)', [0x21, 0x55, 0, 0]],
    ['DPI +', [0xf0, 0x01, 0x01, 0]],
    ['DPI −', [0xf0, 0x01, 0x02, 0]],
    ['DPI en boucle', [0xf0, 0x01, 0x03, 0]],
    ['Taux de rapport +', [0xf0, 0x02, 0x01, 0]],
    ['Taux de rapport −', [0xf0, 0x02, 0x02, 0]],
    ['Taux de rapport en boucle', [0xf0, 0x02, 0x03, 0]],
    ['Changer l\'éclairage', [0x21, 0xaa, 0, 0]],
  ] },
  { group: 'Multimédia', items: [
    ['Volume +', [0x30, 0xe9, 0x00, 0]],
    ['Volume −', [0x30, 0xea, 0x00, 0]],
    ['Muet', [0x30, 0xe2, 0x00, 0]],
    ['Lecture / pause', [0x30, 0xcd, 0x00, 0]],
    ['Piste suivante', [0x30, 0xb5, 0x00, 0]],
    ['Piste précédente', [0x30, 0xb6, 0x00, 0]],
    ['Arrêt', [0x30, 0xb7, 0x00, 0]],
    ['Luminosité écran +', [0x30, 0x6f, 0x00, 0]],
    ['Luminosité écran −', [0x30, 0x70, 0x00, 0]],
    ['Calculatrice', [0x30, 0x92, 0x01, 0]],
    ['Courrier', [0x30, 0x8a, 0x01, 0]],
  ] },
  { group: 'Raccourcis Windows', items: [
    ['Copier (Ctrl+C)', [0x10, 0x01, 0x06, 0]],
    ['Coller (Ctrl+V)', [0x10, 0x01, 0x19, 0]],
    ['Couper (Ctrl+X)', [0x10, 0x01, 0x1b, 0]],
    ['Bureau (Win+D)', [0x10, 0x08, 0x07, 0]],
    ['Explorateur (Win+E)', [0x10, 0x08, 0x08, 0]],
    ['Changer d\'appli (Alt+Tab)', [0x10, 0x04, 0x2b, 0]],
    ['Actualiser (F5)', [0x10, 0x00, 0x3e, 0]],
  ] },
  { group: 'Autre', items: [
    ['Désactivé', [0x00, 0x00, 0x00, 0x01]],
  ] },
];

// Modificateurs HID (octet 1 des actions clavier).
export const MODS = [
  ['Ctrl', 0x01],
  ['Maj', 0x02],
  ['Alt', 0x04],
  ['Win', 0x08],
];

export function sameCode(a, b) {
  return a.length === 4 && b.length === 4 && a.every((v, i) => v === b[i]);
}

export function describe(code) {
  for (const g of ACTIONS) for (const [label, c] of g.items) if (sameCode(c, code)) return label;
  if (code[0] === 0x10) {
    const mods = MODS.filter(([, m]) => code[1] & m).map(([n]) => n);
    return [...mods, hidName(code[2])].join('+');
  }
  if (code[0] === 0) return 'Désactivé';
  return 'Code ' + code.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

export function parseKeys(r) {
  const keys = [];
  for (let i = 0; i < 9; i++) keys.push(Array.from(r.slice(8 + 4 * i, 12 + 4 * i)));
  return keys;
}

export function writeKeys(keys, p = 0) {
  const b = [];
  for (let i = 0; i < 9; i++) b.push(...(keys[i] || [0, 0, 0, 0]));
  return frame(CMD.KEYS_WRITE, 0xa5, 0x20, b, p);
}

// ---------- codes clavier HID ↔ KeyboardEvent.code

const HID = {};
'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((c, i) => { HID['Key' + c] = 0x04 + i; });
'1234567890'.split('').forEach((c, i) => { HID['Digit' + c] = 0x1e + i; });
Object.assign(HID, {
  Enter: 0x28, Escape: 0x29, Backspace: 0x2a, Tab: 0x2b, Space: 0x2c, Minus: 0x2d, Equal: 0x2e,
  BracketLeft: 0x2f, BracketRight: 0x30, Backslash: 0x31, Semicolon: 0x33, Quote: 0x34, Backquote: 0x35,
  Comma: 0x36, Period: 0x37, Slash: 0x38, CapsLock: 0x39, PrintScreen: 0x46, ScrollLock: 0x47, Pause: 0x48,
  Insert: 0x49, Home: 0x4a, PageUp: 0x4b, Delete: 0x4c, End: 0x4d, PageDown: 0x4e,
  ArrowRight: 0x4f, ArrowLeft: 0x50, ArrowDown: 0x51, ArrowUp: 0x52, IntlBackslash: 0x64, ContextMenu: 0x65,
});
for (let i = 1; i <= 12; i++) HID['F' + i] = 0x39 + i;

const NAMES = { 0x28: 'Entrée', 0x29: 'Échap', 0x2a: 'Retour arrière', 0x2b: 'Tab', 0x2c: 'Espace', 0x46: 'Impr. écran', 0x4c: 'Suppr', 0x4f: '→', 0x50: '←', 0x51: '↓', 0x52: '↑' };

export function hidFromCode(code) {
  return HID[code];
}

export function hidName(h) {
  if (NAMES[h]) return NAMES[h];
  const k = Object.keys(HID).find((c) => HID[c] === h);
  if (!k) return '0x' + h.toString(16);
  return k.replace(/^Key|^Digit/, '');
}
