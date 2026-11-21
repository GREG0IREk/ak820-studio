// Protocole HID de l'Ajazz / Epomaker AK820 Pro.
//
// Porté depuis wsclx/ak820pro-modder (MIT), crates/ak820-protocol :
// protocol.rs, commands/*.rs, legacy.rs, legacy_tft.rs, legacy_rgb.rs.
// Deux familles de firmware incompatibles, reconnues par leurs interfaces HID :
//   A : contrôle 0xFF68 (rapports de sortie 64 o, trames AA/55), écran 0xFF67 (4104 o)
//   B : contrôle 0xFF13 (rapports feature 64 o, préfixe 04), écran 0xFF68 (4096 o)
//   Q : firmware QMK « Cadran » de ce dépôt, HID brut 0xFF60 (voir qmk.js)
// Ce module ne touche pas au DOM : il est testé sous Node (test/protocol.test.mjs).
import {
  FAMILY_Q, PAGE_RAW, USAGE_RAW, Q_REPORT, Q_REFUSED, CH_CLOCK, CH_SYS, CH_STUDIO, QC, SYS_VERSION,
  Q_KEYMAP_CHUNK, Q_PERKEY_CHUNK, Q_LAYERS, SLOT_MATRIX, SLOT_LED, qFrame, qClockArgs, qParseInfo, qString,
  qDecodeLayer, qEffectInfo, rgbToHsv8, hsv8ToRgb,
} from './qmk.js';

export const VENDOR_ID = 0x0c45;
export const PRODUCT_IDS = [0x8009, 0x800a, 0xfefe];
export const CONTROL_USAGE_PAGES = [0xff68, 0xff80, 0xff60, 0xff00, 0xff01, 0xff1b];
export const PAGE_FEATURE = 0xff13;
export const PAGE_TFT_A = 0xff67;
export const PAGE_TFT_B = 0xff68;

export const FAMILY_A = 'A';
export const FAMILY_B = 'B';

// ---------------------------------------------------------------- famille A

export const PACKET_LEN = 64;
export const HEADER_LEN = 8;
export const PAYLOAD_PER_PACKET = PACKET_LEN - HEADER_LEN; // 56

export const CMD = {
  COMMUNICATION_START: 1,
  COMMUNICATION_END: 2,
  SET_FACTORY_RESET: 15,
  GET_DEVICE_INFO: 16,
  GET_GAME_MODE: 17,
  GET_KEY: 18,
  GET_LED_EFFECT: 19,
  GET_CUSTOM_LED_DATA: 20,
  GET_MACRO: 21,
  GET_FN_KEY: 22,
  GET_DEFAULT_FN_KEY_MATRIX: 28,
  GET_DEFAULT_KEY_MATRIX: 31,
  SET_GAME_MODE: 33,
  SET_KEY: 34,
  SET_LED_EFFECT: 35,
  SET_CUSTOM_LED_DATA: 36,
  SET_MACRO: 37,
  SET_FN_KEY: 38,
  SET_TEMPORARY_COMMAND_DATA: 52,
  SET_LED_BOOT_ANIMATION: 64,
  SET_LED_USER_ANIMATION: 65,
  SET_TFT_USER_ANIMATION: 80,
  SET_TFT_BUILT_IN_INDEX: 81,
};

/** Trame sortante de 64 octets : [AA, cmd, len, addrLo, addrHi, 0, last, 0, payload…]. */
export function buildFrame(cmd, lenOrType, addr, payload = [], lastPacket = true) {
  const p = new Uint8Array(PACKET_LEN);
  p[0] = 0xaa;
  p[1] = cmd;
  p[2] = lenOrType & 0xff;
  p[3] = addr & 0xff;
  p[4] = (addr >> 8) & 0xff;
  p[6] = lastPacket ? 1 : 0;
  p.set(Array.from(payload).slice(0, PAYLOAD_PER_PACKET), HEADER_LEN);
  return p;
}

// Effets : même numérotation sur les deux familles.
export const MODES = [
  { id: 0x00, key: 'off', name: 'Éteint' },
  { id: 0x01, key: 'static', name: 'Fixe' },
  { id: 0x02, key: 'single-on', name: 'Allumage à la frappe' },
  { id: 0x03, key: 'single-off', name: 'Extinction à la frappe' },
  { id: 0x04, key: 'glittering', name: 'Scintillement' },
  { id: 0x05, key: 'falling', name: 'Pluie' },
  { id: 0x06, key: 'colourful', name: 'Multicolore' },
  { id: 0x07, key: 'breath', name: 'Respiration' },
  { id: 0x08, key: 'spectrum', name: 'Spectre' },
  { id: 0x09, key: 'outward', name: 'Vague centrale' },
  { id: 0x0a, key: 'scrolling', name: 'Défilement' },
  { id: 0x0b, key: 'rolling', name: 'Roulement' },
  { id: 0x0c, key: 'rotating', name: 'Rotation' },
  { id: 0x0d, key: 'explode', name: 'Explosion' },
  { id: 0x0e, key: 'launch', name: 'Lancement' },
  { id: 0x0f, key: 'ripples', name: 'Ondulations' },
  { id: 0x10, key: 'flowing', name: 'Flux' },
  { id: 0x11, key: 'pulsating', name: 'Pulsation' },
  { id: 0x12, key: 'tilt', name: 'Bascule' },
  { id: 0x13, key: 'shuttle', name: 'Navette' },
];
export const MODE_CUSTOM = 0x80;

export const DIRECTION = { left: 0, down: 1, up: 2, right: 3 };

/** Directions qu'un effet accepte (vide : aucune). */
export function supportedDirections(mode) {
  if (mode === 0x0a) return ['up', 'down'];
  if (mode === 0x0b || mode === 0x10 || mode === 0x12) return ['left', 'right'];
  return [];
}

export function parseHex(hex) {
  const s = String(hex || '').trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v | 0));

/**
 * Charge utile SET_LED_EFFECT (16 octets).
 * cfg = { mode, color:'#rrggbb', secondary?, colorMode (0 mono, 1 arc-en-ciel),
 *         brightness 0-5, speed 0-5, direction 'left'|'down'|'up'|'right', effectModeType? }
 */
export function ledEffectPayload(cfg) {
  const [r, g, b] = parseHex(cfg.color) || [255, 255, 255];
  const [sr, sg, sb] = parseHex(cfg.secondary) || [0, 0, 0];
  const p = new Uint8Array(16);
  p[0] = cfg.mode;
  p[1] = r; p[2] = g; p[3] = b;
  p[4] = 0xff; // driverSetting, fixé par le pilote officiel
  p[5] = sr; p[6] = sg; p[7] = sb;
  p[8] = cfg.colorMode | 0;
  p[9] = clamp(cfg.brightness, 0, 5);
  p[10] = cfg.mode === 0x01 || cfg.mode === 0x00 ? 0 : clamp(cfg.speed, 0, 5); // Fixe : aucune animation
  p[11] = DIRECTION[cfg.direction] ?? 0;
  p[12] = cfg.effectModeType | 0;
  p[14] = 0xaa;
  p[15] = 0x55;
  return p;
}

/** GET_DEVICE_INFO (48 octets). */
export function parseDeviceInfo(b) {
  const g = (i) => b[i] ?? 0;
  const w = (i) => g(i) | (g(i + 1) << 8);
  const v8 = g(8);
  const raw = (v8 & 0x0f) + ((v8 & 0xf0) >> 4) * 10 + g(9) * 100;
  return {
    romSize: g(0),
    macroSpaceSize: w(2),
    vid: w(4),
    pid: w(6),
    firmware: (raw / 100).toFixed(2),
    workMode: g(16),
    batteryLevel: g(17),
    chargeStatus: g(18),
    currentProfile: g(19),
    tftMaxFrames: w(22),
    gifMaxFrames: w(24),
    tftDirection: g(28),
  };
}

/** GET_GAME_MODE / SET_GAME_MODE (56 octets). On ne modifie que l'octet 3 (veille). */
export const SLEEP_A = [
  { value: 0, label: 'Jamais' },
  { value: 1, label: '1 min' },
  { value: 2, label: '5 min' },
  { value: 3, label: '10 min' },
  { value: 4, label: '15 min' },
  { value: 5, label: '30 min' },
];
export const SLEEP_B = [
  { value: 0, label: 'Jamais' },
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 30, label: '30 min' },
];

/** Horloge de l'écran : [5A, 01, 5A, AA, MM, JJ, hh, mm, ss, jour (dim = 0)]. */
export function clockPayload(d) {
  const y = d.getFullYear();
  if (y < 2000 || y > 2099) throw new Error('Année hors plage 2000-2099');
  return new Uint8Array([
    0x5a, 0x01, 0x5a, y % 100, d.getMonth() + 1, d.getDate(),
    d.getHours(), d.getMinutes(), d.getSeconds(), d.getDay(),
  ]);
}

// Touche par touche (A) : 128 LED × [index, r, g, b].
export const LED_COUNT = 128;
export function encodeCustomLeds(colors) {
  const out = new Uint8Array(LED_COUNT * 4);
  for (let i = 0; i < LED_COUNT; i++) {
    const c = colors[i] || [0, 0, 0];
    out.set([i, c[0], c[1], c[2]], i * 4);
  }
  return out;
}
export function decodeCustomLeds(bytes) {
  const colors = [];
  for (let i = 0; i < LED_COUNT; i++) {
    const o = i * 4;
    colors.push(o + 4 <= bytes.length ? [bytes[o + 1], bytes[o + 2], bytes[o + 3]] : [0, 0, 0]);
  }
  return colors;
}

// Réaffectation des touches (A) : 128 emplacements × 4 octets.
export const KEYMAP_BYTES = 512;
export const PAGE = { DEFAULT: 0, MOUSE: 1, KEYBOARD: 2, CONSUMER: 3, SYSTEM: 4, MACRO: 6 };

export function decodeKeyAction(b0, b1, b2, b3) {
  if (b0 === 0) return { kind: 'default' };
  if (b0 === 2) return { kind: 'keyboard', usage: b2 };
  if (b0 === 3) return { kind: 'consumer', value: b1 | (b2 << 8) };
  if (b0 === 1) return { kind: 'mouse', button: b1, value: b2 };
  return { kind: 'raw', bytes: [b0, b1, b2, b3] };
}
export function encodeKeyAction(a) {
  switch (a.kind) {
    case 'default': return [0, 0, 0, 0];
    case 'keyboard': return [2, 0, a.usage & 0xff, 0];
    case 'consumer': return [3, a.value & 0xff, (a.value >> 8) & 0xff, 0];
    case 'mouse': return [1, a.button & 0xff, (a.value ?? 0) & 0xff, 0];
    default: return a.bytes.slice(0, 4);
  }
}
export function decodeKeymap(bytes) {
  const slots = [];
  for (let i = 0; i < 128; i++) {
    const o = i * 4;
    slots.push(decodeKeyAction(bytes[o] ?? 0, bytes[o + 1] ?? 0, bytes[o + 2] ?? 0, bytes[o + 3] ?? 0));
  }
  return slots;
}
export function encodeKeymap(slots) {
  const out = new Uint8Array(KEYMAP_BYTES);
  slots.slice(0, 128).forEach((a, i) => out.set(encodeKeyAction(a), i * 4));
  return out;
}

// ---------------------------------------------------------------- écran

export const TFT_SIZE = 128;
export const FRAME_BYTES = TFT_SIZE * TFT_SIZE * 2;
export const TFT_HEADER_BYTES = 256;

export function rgb565(r, g, b) {
  return ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3);
}

/** RGBA 128×128 (ImageData.data) vers RGB565 petit-boutiste, fond noir sous la transparence. */
export function rgbaToRgb565(rgba) {
  const out = new Uint8Array(FRAME_BYTES);
  for (let i = 0, o = 0; i < rgba.length; i += 4, o += 2) {
    const a = rgba[i + 3] / 255;
    const v = rgb565(Math.round(rgba[i] * a), Math.round(rgba[i + 1] * a), Math.round(rgba[i + 2] * a));
    out[o] = v & 0xff;
    out[o + 1] = v >> 8;
  }
  return out;
}

/**
 * Famille A : en-tête de 256 o (nb d'images, N-1 délais en unités de 5 ms, terminateur 0,
 * bourrage FF) puis les images RGB565. frames = [{ pixels: Uint8Array(32768), delayMs }].
 */
export function encodeAnimationA(frames) {
  if (!frames.length) throw new Error('Aucune image');
  if (frames.length > 255) throw new Error('255 images au plus');
  const n = frames.length;
  const out = new Uint8Array(TFT_HEADER_BYTES + n * FRAME_BYTES);
  out.fill(0xff, 0, TFT_HEADER_BYTES);
  out[0] = n;
  for (let i = 0; i < n - 1; i++) out[i + 1] = Math.min(255, Math.floor(frames[i].delayMs / 5));
  out[n] = 0;
  frames.forEach((f, i) => out.set(f.pixels, TFT_HEADER_BYTES + i * FRAME_BYTES));
  return out;
}

/** En-tête de bloc famille A : [AA, 50, idxLo, idxHi, totLo, totHi, 50, 06]. */
export function tftChunkHeader(index, total) {
  return new Uint8Array([0xaa, CMD.SET_TFT_USER_ANIMATION, index & 0xff, index >> 8, total & 0xff, total >> 8, 0x50, 0x06]);
}

export const LEGACY_CHUNK = 4096;
export const LEGACY_MAX_FRAMES = 30;

/** Famille B : tous les délais en unités de 2 ms, pas d'en-tête par bloc, bourrage FF au multiple de 4096. */
export function encodeAnimationB(frames) {
  if (!frames.length) throw new Error('Aucune image');
  if (frames.length > LEGACY_MAX_FRAMES) throw new Error(`${LEGACY_MAX_FRAMES} images au plus`);
  const n = frames.length;
  const len = TFT_HEADER_BYTES + n * FRAME_BYTES;
  const out = new Uint8Array(Math.ceil(len / LEGACY_CHUNK) * LEGACY_CHUNK).fill(0xff);
  out[0] = n;
  if (n === 1) out[1] = 0;
  else frames.forEach((f, i) => { out[i + 1] = Math.max(1, Math.min(255, Math.floor(f.delayMs / 2))); });
  frames.forEach((f, i) => out.set(f.pixels, TFT_HEADER_BYTES + i * FRAME_BYTES));
  return out;
}

// ---------------------------------------------------------------- famille B

export const B = { START: 0x18, COMMIT: 0x02, FINISH: 0xf0, LIGHTING: 0x13, CUSTOM_BANK: 0x23, SLEEP: 0x17, CLOCK: 0x28, IMAGE_CFG: 0x72, KEYMAP: 0x11, KEYMAP_FN: 0x27 };

export function controlPacket(command, sub, value) {
  const p = new Uint8Array(64);
  p[0] = 4;
  p[1] = command;
  p[2] = sub;
  p[8] = value & 0xff;
  p[9] = (value >> 8) & 0xff;
  return p;
}

/**
 * Effet famille B. Éteint = SingleOn luminosité 0. Fixe = vrai mode 0x01 à vitesse 0,
 * comme gohv/EPOMAKER-Ajazz-AK820-Pro : « Respiration vitesse 0 » (vespovios) respire
 * encore sur certains claviers (constaté sur celui de Grégoire le 21/11/2026).
 */
export function legacyLightingPacket(cfg) {
  if (cfg.mode === MODE_CUSTOM) throw new Error('Le mode personnalisé passe par legacySelectCustom');
  let mode = cfg.mode, speed = clamp(cfg.speed, 0, 5), brightness = clamp(cfg.brightness, 0, 5);
  if (mode === 0x00) { mode = 0x02; speed = 0; brightness = 0; }
  else if (mode === 0x01) speed = 0;
  const [r, g, b] = parseHex(cfg.color) || [255, 255, 255];
  const p = new Uint8Array(64);
  p[0] = mode;
  p[1] = r; p[2] = g; p[3] = b;
  p[8] = cfg.colorMode ? 1 : 0;
  p[9] = brightness;
  p[10] = speed;
  p[11] = DIRECTION[cfg.direction] ?? 0;
  p[14] = 0x55;
  p[15] = 0xaa;
  return p;
}

export function legacySleepPacket(minutes) {
  const code = { 0: 0, 1: 1, 5: 2, 30: 3 }[minutes];
  if (code === undefined) throw new Error('Veille : 0, 1, 5 ou 30 minutes');
  const p = new Uint8Array(64);
  p[8] = code;
  p[62] = 0xaa; p[63] = 0x55;
  return p;
}

export function legacyClockPacket(d) {
  const web = clockPayload(d);
  const p = new Uint8Array(64);
  p.set(web.slice(1, 9), 1);
  p[10] = 4;
  p[62] = 0xaa; p[63] = 0x55;
  return p;
}

/** (emplacement commun, index LED du firmware B), clavier ANSI, d'après le pilote 1.0.0.5. */
export const ANSI_LED_SLOTS = [
  [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13], [106, 119],
  [16, 19], [17, 20], [18, 21], [19, 22], [20, 23], [21, 24], [22, 25], [23, 26], [24, 27], [25, 28], [26, 29], [27, 30], [28, 31], [92, 103], [107, 117],
  [32, 37], [33, 38], [34, 39], [35, 40], [36, 41], [37, 42], [38, 43], [39, 44], [40, 45], [41, 46], [42, 47], [43, 48], [44, 49], [97, 67], [105, 118],
  [48, 55], [49, 56], [50, 57], [51, 58], [52, 59], [53, 60], [54, 61], [55, 62], [56, 63], [57, 64], [58, 65], [59, 66], [76, 85], [108, 121],
  [64, 73], [65, 74], [66, 75], [67, 76], [68, 77], [69, 78], [70, 79], [71, 80], [72, 81], [73, 82], [74, 83], [75, 84], [90, 101],
  [80, 91], [81, 92], [82, 93], [83, 94], [84, 95], [85, 96], [87, 98], [88, 99], [89, 100], [91, 102],
];

export function legacyEncodeBank(colors) {
  const data = new Uint8Array(576);
  for (const [slot, id] of ANSI_LED_SLOTS) {
    const c = colors[slot] || [0, 0, 0];
    data.set([id, c[0], c[1], c[2]], id * 4);
  }
  data[574] = 0xaa; data[575] = 0x55;
  return data;
}

/**
 * Action d'une touche, famille B (pilote Windows 1.0.0.5, fonction 0x418420) :
 * 0 = comportement d'origine ; [02, masque, hid, 00] clavier (Ctrl/Maj/Alt/Win E0-E7 en masque 1<<n) ;
 * [03, lo, hi, 00] multimédia ; [01, 01, masque, 00] boutons souris ; [06, macro, …] macro.
 */
export function encodeKeyActionB(a) {
  if (!a || a.kind === 'default') return [0, 0, 0, 0];
  if (a.kind === 'keyboard') {
    if (a.usage >= 0xe0 && a.usage <= 0xe7) return [2, 1 << (a.usage - 0xe0), 0, 0];
    return [2, 0, a.usage & 0xff, 0];
  }
  if (a.kind === 'consumer') return [3, a.value & 0xff, (a.value >> 8) & 0xff, 0];
  if (a.kind === 'mouse') return [1, 1, a.button & 0xff, 0];
  return a.bytes.slice(0, 4);
}

/** Table des touches famille B : 576 octets, 4 par index de touche (= index LED), fin AA 55. */
export function legacyEncodeKeymap(slots) {
  const data = new Uint8Array(576);
  for (const [slot, id] of ANSI_LED_SLOTS) data.set(encodeKeyActionB(slots[slot]), id * 4);
  data[574] = 0xaa; data[575] = 0x55;
  return data;
}
export const LEGACY_KEY_SLOTS = new Set(ANSI_LED_SLOTS.map(([s]) => s));
export const defaultKeymap = () => Array.from({ length: 128 }, () => ({ kind: 'default' }));

export function legacyCustomModePacket(brightness) {
  const p = new Uint8Array(64);
  p[0] = 0x80;
  p[9] = clamp(brightness, 0, 5);
  p[14] = 0xaa; p[15] = 0x55;
  return p;
}

export function parseLegacyBattery(r) {
  // r : 64 octets sans l'identifiant de rapport.
  const raw = r.length >= 4 && r[0] === 0x20 && r[1] === 1 ? r[3] : null;
  return { percent: raw !== null && raw <= 100 ? raw : null, wiredFull: raw === 255 };
}

// ---------------------------------------------------------------- détection

/** Taille (octets) du plus grand rapport d'un type ('outputReports', 'featureReports'…) d'une collection WebHID. */
export function reportBytes(collection, kind) {
  let max = 0;
  for (const rep of collection[kind] || []) {
    let bits = 0;
    for (const it of rep.items || []) bits += (it.reportSize || 0) * (it.reportCount || 0);
    max = Math.max(max, Math.ceil(bits / 8));
  }
  return max;
}

const pagesOf = (dev) => (dev.collections || []).map((c) => c.usagePage);

/**
 * Classe les HIDDevice WebHID d'un même clavier.
 * Renvoie { family, control, tft } ou { error }.
 */
export function classify(devices) {
  const ak = devices.filter((d) => d.vendorId === VENDOR_ID && PRODUCT_IDS.includes(d.productId));
  if (!ak.length) return { error: 'Aucun AK820 parmi les appareils autorisés.' };
  // Firmware QMK : HID brut 0xFF60 / 0x61 en rapports de 32 octets (Ajazz : 64 octets).
  const raw = ak.find((d) => (d.collections || []).some((c) => c.usagePage === PAGE_RAW && c.usage === USAGE_RAW && reportBytes(c, 'outputReports') === Q_REPORT));
  if (raw) {
    if (!/^AK820/i.test(raw.productName || '')) return { error: `Interface QMK trouvée sur « ${raw.productName || 'sans nom'} » : ce n'est pas un AK820, rien n'est envoyé.` };
    return { family: FAMILY_Q, control: raw, tft: null };
  }
  const has = (page) => ak.find((d) => pagesOf(d).includes(page));
  const feature = has(PAGE_FEATURE);
  const tftA = has(PAGE_TFT_A);
  if (feature && !tftA) {
    // Famille B : écritures en flash, on exige le nom de produit observé (Sonix réutilise ses identifiants).
    if (!/^AK820/i.test(feature.productName || '')) {
      return { error: `Interface 0xFF13 trouvée sur « ${feature.productName || 'sans nom'} » : ce n'est pas un AK820, rien n'est envoyé.` };
    }
    const tft = ak.find((d) => (d.collections || []).some((c) => c.usagePage === PAGE_TFT_B && reportBytes(c, 'outputReports') === 4096));
    return { family: FAMILY_B, control: feature, tft: tft || null };
  }
  for (const page of CONTROL_USAGE_PAGES) {
    const control = has(page);
    if (control) return { family: FAMILY_A, control, tft: tftA || null };
  }
  return { error: 'Interface de contrôle introuvable. Autorisez toutes les interfaces du clavier.' };
}

// ---------------------------------------------------------------- transport

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Enveloppe un HIDDevice (ou un faux appareil de test) :
 * file d'attente des rapports d'entrée et journal des échanges.
 */
export class Endpoint {
  constructor(device, log = () => {}) {
    this.device = device;
    this.log = log;
    this.queue = [];
    this.waiters = [];
    this.onInput = (e) => {
      const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
      this.log('rx', data);
      const w = this.waiters.findIndex((x) => x.match(data));
      if (w >= 0) { const [x] = this.waiters.splice(w, 1); x.resolve(data); }
      else { this.queue.push(data); if (this.queue.length > 64) this.queue.shift(); }
    };
  }
  async open() {
    if (!this.device.opened) await this.device.open();
    this.device.addEventListener('inputreport', this.onInput);
  }
  async close() {
    this.device.removeEventListener('inputreport', this.onInput);
    if (this.device.opened) await this.device.close();
  }
  drain() { this.queue.length = 0; }
  /** Attend un rapport d'entrée qui satisfait match ; null si délai dépassé. */
  waitInput(match, timeoutMs) {
    const i = this.queue.findIndex(match);
    if (i >= 0) return Promise.resolve(this.queue.splice(i, 1)[0]);
    return new Promise((resolve) => {
      const waiter = { match, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        const k = this.waiters.indexOf(waiter);
        if (k >= 0) { this.waiters.splice(k, 1); resolve(null); }
      }, timeoutMs);
    });
  }
  async send(data) {
    this.log('tx', data);
    await this.device.sendReport(0, data);
  }
  async sendFeature(data) {
    this.log('txf', data);
    await this.device.sendFeatureReport(0, data);
  }
  async receiveFeature() {
    const dv = await this.device.receiveFeatureReport(0);
    let r = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength).slice();
    // Selon la plateforme, l'identifiant de rapport 0 peut précéder les 64 octets.
    if (r.length === 65 && r[0] === 0) r = r.slice(1);
    this.log('rxf', r);
    return r;
  }
}

/** Sérialise les opérations : une seule transaction à la fois sur le clavier. */
class Mutex {
  constructor() { this.tail = Promise.resolve(); }
  run(fn) {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => {});
    return next;
  }
}

// ---------------------------------------------------------------- clavier

export class Keyboard {
  /** cls = résultat de classify(). */
  constructor(cls, log = () => {}) {
    this.family = cls.family;
    this.log = log;
    this.control = new Endpoint(cls.control, (d, b) => log(d, b, 'ctl'));
    this.tft = cls.tft && cls.tft !== cls.control ? new Endpoint(cls.tft, (d, b) => log(d, b, 'tft')) : (cls.tft ? this.control : null);
    this.mutex = new Mutex();
    this.name = cls.control.productName || 'AK820';
    this.pid = cls.control.productId;
    this.qmeta = null;
    const tftCol = cls.tft && (cls.tft.collections || []).find((c) => c.usagePage === (this.family === FAMILY_A ? PAGE_TFT_A : PAGE_TFT_B));
    this.tftReportLen = (tftCol && reportBytes(tftCol, 'outputReports')) || (this.family === FAMILY_A ? 4104 : 4096);
  }

  async open() {
    await this.control.open();
    if (this.tft && this.tft !== this.control) await this.tft.open();
    if (this.family === FAMILY_Q) await this.mutex.run(() => this.qLoadMeta());
  }
  async close() {
    await this.control.close().catch(() => {});
    if (this.tft && this.tft !== this.control) await this.tft.close().catch(() => {});
  }

  get caps() {
    if (this.family === FAMILY_Q) {
      const m = this.qmeta;
      return {
        info: true, keymap: true, keymapRead: true, perKey: m.perkeyEffect !== null, perKeyRead: true, perKeySlots: new Set(SLOT_LED.keys()),
        tft: false, tftUpload: false, tftBuiltIn: false, clock: true, liveLighting: true, secondary: false, rainbowOption: false,
        modes: m.effects, layers: Q_LAYERS.slice(0, m.layers), remapSlots: new Set(SLOT_MATRIX.keys()), matrixTest: true,
        sleep: m.sleepMinutes.map((min, i) => ({ value: i, label: min ? `${min} min` : 'Jamais' })),
      };
    }
    const a = this.family === FAMILY_A;
    const modes = MODES.map((m) => ({ ...m, noSpeed: m.id <= 1 }));
    const perKeySlots = a ? null : LEGACY_KEY_SLOTS;
    return {
      info: a, keymap: true, keymapRead: a, perKey: true, perKeyRead: a, perKeySlots, perKeyIsoComplete: a, tft: !!this.tft, tftUpload: true,
      tftBuiltIn: a, clock: true, liveLighting: a, secondary: a, rainbowOption: true, modes,
      layers: [{ id: 'base', label: 'Couche normale' }, { id: 'fn', label: 'Couche Fn' }], remapSlots: a ? null : LEGACY_KEY_SLOTS,
      matrixTest: false, sleep: a ? SLEEP_A : SLEEP_B,
    };
  }

  // ---- firmware QMK : primitives

  /** Envoie un paquet [0x07, canal, cmd, …] et attend sa réponse ; erreur si refusé ou muet. */
  async qCall(channel, cmd, args = [], timeout = 600) {
    this.control.drain();
    await this.control.send(qFrame(channel, cmd, args));
    const r = await this.control.waitInput((d) => d[1] === channel && d[2] === cmd, timeout);
    if (!r) throw new Error(`Pas de réponse du clavier (canal 0x${channel.toString(16)}, commande 0x${cmd.toString(16)})`);
    if (r[0] === Q_REFUSED) {
      if (channel === CH_STUDIO && cmd === QC.INFO) throw new Error('Ce firmware QMK ne connaît pas AK820 Studio : installez Cadran 1.1 ou plus récent (dossier firmware du dépôt).');
      throw new Error(`Commande refusée par le clavier (canal 0x${channel.toString(16)}, commande 0x${cmd.toString(16)})`);
    }
    return r;
  }
  async qLoadMeta() {
    const info = qParseInfo(await this.qCall(CH_STUDIO, QC.INFO));
    const effects = [];
    for (let i = 0; i < info.effectCount; i++) {
      const r = await this.qCall(CH_STUDIO, QC.EFFECT_NAME, [i]);
      effects.push(qEffectInfo(qString(r.slice(4)), i));
    }
    let version = '';
    try { version = qString((await this.qCall(CH_SYS, SYS_VERSION)).slice(3)); } catch { /* version facultative */ }
    const maxBrightness = (await this.qCall(CH_STUDIO, QC.LIGHT_GET))[8] || 255;
    this.qmeta = { ...info, effects, version, maxBrightness };
    return this.qmeta;
  }
  qLayerIndex(layer) {
    const i = Q_LAYERS.findIndex((l) => l.id === layer);
    if (i < 0 || i >= this.qmeta.layers) throw new Error(`Couche inconnue : ${layer}`);
    return i;
  }
  async qReadLayer(layer, factory) {
    const { rows, cols } = this.qmeta;
    const size = rows * cols * 2, base = this.qLayerIndex(layer) * size;
    const out = new Uint8Array(size);
    for (let off = 0; off < size; off += Q_KEYMAP_CHUNK) {
      const n = Math.min(Q_KEYMAP_CHUNK, size - off), at = base + off;
      const r = await this.qCall(CH_STUDIO, factory ? QC.KEYMAP_DEFAULT : QC.KEYMAP_GET, [at >> 8, at & 0xff, n]);
      out.set(r.slice(6, 6 + n), off);
    }
    return qDecodeLayer(out, cols);
  }

  /** Touches enfoncées : liste de [ligne, colonne] (test des touches). */
  matrix() {
    return this.mutex.run(async () => {
      if (this.family !== FAMILY_Q) return [];
      const r = await this.qCall(CH_STUDIO, QC.MATRIX, [], 300);
      const down = [];
      for (let row = 0; row < this.qmeta.rows; row++) {
        const bits = r[3 + 2 * row] | (r[4 + 2 * row] << 8);
        for (let col = 0; col < this.qmeta.cols; col++) if (bits & (1 << col)) down.push([row, col]);
      }
      return down;
    });
  }

  // ---- famille A : primitives

  async aResponse(cmd, timeout = 500) {
    return this.control.waitInput((d) => d[0] === 0x55 && d[1] === cmd, timeout);
  }
  async aSet(cmd, payload) {
    this.control.drain();
    await this.control.send(buildFrame(cmd, payload.length, 0, payload, true));
    await this.aResponse(cmd); // certains firmwares ne répondent pas aux SET : on n'échoue pas
  }
  async aGetMany(cmd, size, base = 0) {
    const out = new Uint8Array(size);
    const n = Math.max(1, Math.ceil(size / PAYLOAD_PER_PACKET));
    for (let i = 0; i < n; i++) {
      const len = Math.min(PAYLOAD_PER_PACKET, size - i * PAYLOAD_PER_PACKET);
      this.control.drain();
      await this.control.send(buildFrame(cmd, len, base + i * PAYLOAD_PER_PACKET, [], i === n - 1));
      const r = await this.aResponse(cmd);
      if (!r) throw new Error(`Pas de réponse à la commande 0x${cmd.toString(16)} (interface 0x${this.controlPage().toString(16)})`);
      out.set(r.slice(HEADER_LEN, HEADER_LEN + len), i * PAYLOAD_PER_PACKET);
    }
    return out;
  }
  async aSetMany(cmd, payload, base = 0, commit = true) {
    const n = Math.max(1, Math.ceil(payload.length / PAYLOAD_PER_PACKET));
    for (let i = 0; i < n; i++) {
      const start = i * PAYLOAD_PER_PACKET;
      const chunk = payload.slice(start, start + PAYLOAD_PER_PACKET);
      this.control.drain();
      await this.control.send(buildFrame(cmd, chunk.length, base + start, chunk, commit && i === n - 1));
      await this.aResponse(cmd);
    }
  }
  controlPage() {
    return (this.control.device.collections || [])[0]?.usagePage ?? 0;
  }

  // ---- famille B : primitives

  async bExchange(packet) {
    await sleep(35);
    await this.control.sendFeature(packet);
    await sleep(50);
    const r = await this.control.receiveFeature();
    if (r.length < 64) throw new Error('Réponse feature trop courte');
    return r;
  }
  bAck(reply, command) {
    if (reply[0] !== 4 || reply[1] !== command || reply[3] !== 1) {
      const hex = Array.from(reply.slice(0, 9), (b) => b.toString(16).padStart(2, '0')).join(' ');
      throw new Error(`Le clavier a refusé la commande 0x${command.toString(16)} (${hex})`);
    }
  }
  async bStart(flag) {
    for (let i = 1; i < 10; i++) {
      const r = await this.bExchange(controlPacket(B.START, 0, flag));
      const busy = r.every((b) => b === 0) || (r[0] === 4 && r[1] === B.START && r[2] === 0 && r[3] === 0xff);
      if (!busy) return this.bAck(r, B.START);
      await sleep(300);
    }
    this.bAck(await this.bExchange(controlPacket(B.START, 0, flag)), B.START);
  }
  /** START, préambule, données, COMMIT, puis FINISH (toujours envoyé, même après une erreur). */
  async bTransaction(flag, command, dataPackets) {
    let err = null;
    try {
      await this.bStart(flag);
      this.bAck(await this.bExchange(command), command[1]);
      for (const p of dataPackets) await this.bExchange(p);
      this.bAck(await this.bExchange(controlPacket(B.COMMIT, 0, 0)), B.COMMIT);
    } catch (e) { err = e; }
    try {
      this.bAck(await this.bExchange(controlPacket(B.FINISH, 0, flag)), B.FINISH);
    } catch (e) { err = err || e; }
    if (err) throw err;
  }

  // ---- opérations

  info() {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const m = await this.qLoadMeta();
        return { family: 'Q', firmware: m.version, batteryLevel: m.battery, sleepIndex: m.sleepIndex };
      }
      if (this.family === FAMILY_A) {
        const r = await this.aGetMany(CMD.GET_DEVICE_INFO, 48);
        return { family: 'A', ...parseDeviceInfo(r) };
      }
      await sleep(35);
      const q = new Uint8Array(64); q[0] = 0x20; q[1] = 1;
      await this.control.sendFeature(q);
      await sleep(50);
      const bat = parseLegacyBattery(await this.control.receiveFeature());
      return { family: 'B', batteryLevel: bat.percent, wiredFull: bat.wiredFull };
    });
  }

  /** Effet actuel (famille A, lecture seule). null si le firmware ne répond pas. */
  getLighting() {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const a = (await this.qCall(CH_STUDIO, QC.LIGHT_GET)).slice(3);
        const max = a[5] || 255;
        const hex = '#' + hsv8ToRgb(a[1], a[2]).map((v) => v.toString(16).padStart(2, '0')).join('');
        return { mode: a[0], color: hex, colorMode: 0, brightness: Math.round((a[3] / max) * 5), speed: Math.round(a[4] / 51), direction: 'left' };
      }
      if (this.family !== FAMILY_A) return null;
      try {
        const p = await this.aGetMany(CMD.GET_LED_EFFECT, 16);
        if (p[14] !== 0xaa || p[15] !== 0x55) return null; // format inattendu : on garde les réglages locaux
        const hex = (a, b, c) => '#' + [a, b, c].map((v) => v.toString(16).padStart(2, '0')).join('');
        const dir = Object.keys(DIRECTION).find((k) => DIRECTION[k] === p[11]) || 'left';
        return { mode: p[0], color: hex(p[1], p[2], p[3]), colorMode: p[8] ? 1 : 0, brightness: Math.min(5, p[9]), speed: Math.min(5, p[10]), direction: dir };
      } catch { return null; }
    });
  }

  setLighting(cfg) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const [h, s] = rgbToHsv8(parseHex(cfg.color) || [255, 255, 255]);
        const max = this.qmeta.maxBrightness;
        const v = Math.round((clamp(cfg.brightness, 0, 5) / 5) * max);
        await this.qCall(CH_STUDIO, QC.LIGHT_SET, [cfg.mode, h, s, v, clamp(cfg.speed, 0, 5) * 51, 1]);
        return;
      }
      if (this.family === FAMILY_A) return this.aSet(CMD.SET_LED_EFFECT, ledEffectPayload(cfg));
      return this.bTransaction(1, controlPacket(B.LIGHTING, 0, 1), [legacyLightingPacket(cfg)]);
    });
  }

  /** Écrit les couleurs par touche (tableau de 128 [r,g,b]) puis active le mode personnalisé. */
  setPerKey(colors, brightness = 5) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const leds = Array.from({ length: this.qmeta.leds }, () => [0, 0, 0]);
        for (const [slot, led] of SLOT_LED) if (led < leds.length) leds[led] = colors[slot] || [0, 0, 0];
        for (let i = 0; i < leds.length; i += Q_PERKEY_CHUNK) {
          const part = leds.slice(i, i + Q_PERKEY_CHUNK);
          await this.qCall(CH_STUDIO, QC.PERKEY_SET, [i, part.length, ...part.flat()]);
        }
        const max = this.qmeta.maxBrightness;
        await this.qCall(CH_STUDIO, QC.PERKEY_SAVE, [1, Math.round((clamp(brightness, 1, 5) / 5) * max)]);
        return;
      }
      if (this.family === FAMILY_A) {
        await this.aSetMany(CMD.SET_CUSTOM_LED_DATA, encodeCustomLeds(colors), 0, true);
        return this.aSet(CMD.SET_LED_EFFECT, ledEffectPayload({ mode: MODE_CUSTOM, color: '#ffffff', brightness, speed: 0, direction: 'left', colorMode: 0 }));
      }
      const bank = legacyEncodeBank(colors);
      const blocks = [];
      for (let i = 0; i < 9; i++) blocks.push(bank.slice(i * 64, i * 64 + 64));
      await this.bTransaction(0, controlPacket(B.CUSTOM_BANK, 0, 9), blocks);
      return this.bTransaction(0, controlPacket(B.LIGHTING, 0, 1), [legacyCustomModePacket(brightness)]);
    });
  }

  getPerKey() {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const leds = [];
        for (let i = 0; i < this.qmeta.leds; i += Q_PERKEY_CHUNK) {
          const n = Math.min(Q_PERKEY_CHUNK, this.qmeta.leds - i);
          const r = await this.qCall(CH_STUDIO, QC.PERKEY_GET, [i, n]);
          for (let k = 0; k < n; k++) leds.push(Array.from(r.slice(5 + 3 * k, 8 + 3 * k)));
        }
        const colors = Array.from({ length: 128 }, () => [0, 0, 0]);
        for (const [slot, led] of SLOT_LED) if (leds[led]) colors[slot] = leds[led];
        return colors;
      }
      if (this.family !== FAMILY_A) throw new Error('Lecture impossible sur ce firmware');
      return decodeCustomLeds(await this.aGetMany(CMD.GET_CUSTOM_LED_DATA, 512));
    });
  }

  syncClock(date = new Date()) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) { await this.qCall(CH_CLOCK, 0x01, qClockArgs(date).slice(1)); return; }
      if (this.family === FAMILY_A) return this.aSet(CMD.SET_TEMPORARY_COMMAND_DATA, clockPayload(date));
      return this.bTransaction(1, controlPacket(B.CLOCK, 0, 1), [legacyClockPacket(date)]);
    });
  }

  getSleep() {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) return qParseInfo(await this.qCall(CH_STUDIO, QC.INFO)).sleepIndex;
      if (this.family !== FAMILY_A) return null; // pas de relecture connue
      const gm = await this.aGetMany(CMD.GET_GAME_MODE, 56);
      return gm[3];
    });
  }

  setSleep(value) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) { await this.qCall(CH_STUDIO, QC.SLEEP_SET, [value]); return; }
      if (this.family === FAMILY_A) {
        const gm = await this.aGetMany(CMD.GET_GAME_MODE, 56); // on ne change que la veille
        gm[3] = value;
        return this.aSet(CMD.SET_GAME_MODE, gm);
      }
      return this.bTransaction(1, controlPacket(B.SLEEP, 1, 1), [legacySleepPacket(value)]);
    });
  }

  /** Famille B : aucune relecture connue ; les valeurs d'usine sont « tout à 0 ». */
  getKeymap(layer = 'base', factory = false) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) return this.qReadLayer(layer, factory);
      if (this.family !== FAMILY_A) {
        if (factory) return defaultKeymap();
        throw new Error('Ce firmware ne permet pas de relire les touches');
      }
      const cmd = layer === 'fn'
        ? (factory ? CMD.GET_DEFAULT_FN_KEY_MATRIX : CMD.GET_FN_KEY)
        : (factory ? CMD.GET_DEFAULT_KEY_MATRIX : CMD.GET_KEY);
      return decodeKeymap(await this.aGetMany(cmd, KEYMAP_BYTES));
    });
  }

  /** Firmware QMK : seules les touches qui diffèrent de `previous` sont écrites (si fourni). */
  setKeymap(layer, slots, previous = null) {
    return this.mutex.run(async () => {
      if (this.family === FAMILY_Q) {
        const L = this.qLayerIndex(layer);
        for (const [slot, [r, c]] of SLOT_MATRIX) {
          const a = slots[slot];
          if (!a || a.kind !== 'qmk') continue;
          if (previous && previous[slot] && previous[slot].code === a.code) continue;
          await this.qCall(CH_STUDIO, QC.KEY_SET, [L, r, c, a.code >> 8, a.code & 0xff]);
        }
        return;
      }
      if (this.family !== FAMILY_A) {
        const table = legacyEncodeKeymap(slots);
        const blocks = [];
        for (let i = 0; i < 9; i++) blocks.push(table.slice(i * 64, i * 64 + 64));
        return this.bTransaction(0, controlPacket(layer === 'fn' ? B.KEYMAP_FN : B.KEYMAP, 0, 9), blocks);
      }
      return this.aSetMany(layer === 'fn' ? CMD.SET_FN_KEY : CMD.SET_KEY, encodeKeymap(slots), 0, true);
    });
  }

  tftFactory() {
    return this.mutex.run(async () => {
      if (this.family !== FAMILY_A) throw new Error('Non vérifié sur ce firmware');
      return this.aSet(CMD.SET_TFT_BUILT_IN_INDEX, [0]);
    });
  }

  /** Envoie une animation. onProgress(fait, total). Renvoie un compte rendu. */
  uploadTft(frames, onProgress = () => {}, slot = 1) {
    return this.mutex.run(async () => {
      if (!this.tft) throw new Error('Interface écran non autorisée');
      const t0 = Date.now();
      if (this.family === FAMILY_A) {
        const payload = encodeAnimationA(frames);
        const chunkPayload = this.tftReportLen - 8;
        const total = Math.max(1, Math.ceil(payload.length / chunkPayload));
        const isAck = (d) => d[0] === 0x55 && (d[1] === CMD.SET_LED_USER_ANIMATION || d[1] === CMD.SET_TFT_USER_ANIMATION);
        let flow = 'probe', acked = 0;
        for (let i = 0; i < total; i++) {
          const report = new Uint8Array(this.tftReportLen);
          report.set(tftChunkHeader(i, total), 0);
          report.set(payload.slice(i * chunkPayload, (i + 1) * chunkPayload), 8);
          this.tft.drain();
          if (this.tft !== this.control) this.control.drain();
          await this.tft.send(report);
          const wait = flow === 'probe' ? 1000 : flow === 'acked' ? 1500 : 10;
          const ack = await Promise.race([
            this.tft.waitInput(isAck, wait),
            this.tft !== this.control ? this.control.waitInput(isAck, wait) : new Promise(() => {}),
          ]);
          if (ack) acked++;
          flow = ack && flow !== 'paced' ? 'acked' : 'paced';
          onProgress(i + 1, total);
        }
        return { chunks: total, acknowledged: acked, paced: flow === 'paced', ms: Date.now() - t0 };
      }
      // Famille B : START(0), IMAGE_CFG(emplacement, blocs), blocs de 4096 acquittés un par un, COMMIT.
      if (![1, 2, 3].includes(slot)) throw new Error('Emplacement 1 à 3');
      const payload = encodeAnimationB(frames);
      const total = payload.length / LEGACY_CHUNK;
      await this.bStart(0);
      try {
        this.bAck(await this.bExchange(controlPacket(B.IMAGE_CFG, slot, total)), B.IMAGE_CFG);
        for (let i = 0; i < total; i++) {
          this.tft.drain();
          await this.tft.send(payload.slice(i * LEGACY_CHUNK, (i + 1) * LEGACY_CHUNK));
          const ack = await this.tft.waitInput(() => true, 1000);
          if (!ack) throw new Error(`Bloc ${i + 1}/${total} non acquitté, transfert arrêté`);
          onProgress(i + 1, total);
        }
        this.bAck(await this.bExchange(controlPacket(B.COMMIT, 0, 0)), B.COMMIT);
      } catch (e) {
        await this.bExchange(controlPacket(B.FINISH, 0, 1)).catch(() => {});
        throw e;
      }
      await sleep(100);
      return { chunks: total, acknowledged: total, paced: false, ms: Date.now() - t0 };
    });
  }
}
