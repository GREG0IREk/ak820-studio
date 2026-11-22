// Faux clavier pour la démo (?demo=a ou ?demo=b) et les tests Node.
// Imite les interfaces WebHID et les réponses observées : rien n'est envoyé à un vrai appareil.
import { VENDOR_ID, CMD, HEADER_LEN, buildMacroBuffer } from './protocol.js';
import { PAGE_RAW, USAGE_RAW, Q_REPORT, CH_CLOCK, CH_SYS, CH_STUDIO, QC, SLOT_MATRIX, Q_ROWS, Q_COLS, Q_LED_COUNT, Q_MACRO_COUNT } from './qmk.js';

const MACRO_SIZE = 512;
/** Macros de démonstration : Ctrl+C, délai 50 ms, Ctrl+V ; puis 1, 2, 3 espacés de 100 ms. */
const DEMO_MACROS = [
  { steps: [{ mods: 1, key: 0x06, delay: 50 }, { mods: 1, key: 0x19, delay: 0 }], tail: [] },
  { steps: [{ mods: 0, key: 0x1e, delay: 100 }, { mods: 0, key: 0x1f, delay: 100 }, { mods: 0, key: 0x20, delay: 0 }], tail: [] },
];

class FakeDevice extends EventTarget {
  constructor({ productId, productName, collections, onReport, onFeature, getFeature }) {
    super();
    Object.assign(this, { vendorId: VENDOR_ID, productId, productName, collections, opened: false });
    this.onReport = onReport;
    this.onFeature = onFeature;
    this.getFeature = getFeature;
    this.sent = [];
  }
  async open() { this.opened = true; }
  async close() { this.opened = false; }
  async sendReport(id, data) {
    const d = new Uint8Array(data);
    this.sent.push({ type: 'out', data: d });
    this.onReport && this.onReport(d, this);
  }
  async sendFeatureReport(id, data) {
    const d = new Uint8Array(data);
    this.sent.push({ type: 'feature', data: d });
    this.onFeature && this.onFeature(d, this);
  }
  async receiveFeatureReport() {
    const r = this.getFeature ? this.getFeature(this) : new Uint8Array(64);
    return new DataView(r.buffer);
  }
  emit(bytes) {
    const ev = new Event('inputreport');
    const buf = new Uint8Array(bytes);
    ev.data = new DataView(buf.buffer);
    ev.device = this;
    ev.reportId = 0;
    setTimeout(() => this.dispatchEvent(ev), 2);
  }
}

const col = (usagePage, outBytes, featBytes = 0, usage = 1, inBytes = 64) => ({
  usagePage,
  usage,
  outputReports: outBytes ? [{ reportId: 0, items: [{ reportSize: 8, reportCount: outBytes }] }] : [],
  featureReports: featBytes ? [{ reportId: 0, items: [{ reportSize: 8, reportCount: featBytes }] }] : [],
  inputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: inBytes }] }],
});

/** Famille A : état conservé (effet, LED, touches) pour que la relecture soit cohérente. */
export function mockFamilyA(defaultHids) {
  const state = {
    keymap: new Uint8Array(512),
    fnmap: new Uint8Array(512),
    leds: new Uint8Array(512),
    game: new Uint8Array(56),
  };
  for (const [slot, hid] of defaultHids) state.keymap.set([2, 0, hid, 0], slot * 4);
  state.game[3] = 5;
  state.effect = new Uint8Array([0x07, 0x8b, 0x5c, 0xff, 0xff, 0, 0, 0, 0, 4, 2, 0, 0, 0, 0xaa, 0x55]);
  const respond = (dev, cmd, payload, addr = 0) => {
    const r = new Uint8Array(64);
    r[0] = 0x55; r[1] = cmd; r[3] = addr & 0xff; r[4] = addr >> 8;
    r.set(payload.slice(0, 56), HEADER_LEN);
    dev.emit(r);
  };
  const tables = {
    [CMD.GET_KEY]: 'keymap', [CMD.SET_KEY]: 'keymap', [CMD.GET_DEFAULT_KEY_MATRIX]: 'keymapDefault',
    [CMD.GET_FN_KEY]: 'fnmap', [CMD.SET_FN_KEY]: 'fnmap', [CMD.GET_DEFAULT_FN_KEY_MATRIX]: 'fnmap',
    [CMD.GET_CUSTOM_LED_DATA]: 'leds', [CMD.SET_CUSTOM_LED_DATA]: 'leds',
  };
  state.keymapDefault = state.keymap.slice();
  const control = new FakeDevice({
    productId: 0x8009,
    productName: 'AK820 Pro',
    collections: [col(0xff68, 64)],
    onReport(d, dev) {
      const cmd = d[1], len = d[2], addr = d[3] | (d[4] << 8);
      if (cmd === CMD.GET_DEVICE_INFO) {
        const info = new Uint8Array(48);
        info.set([0, 0, 0x00, 0x0c, 0x45, 0x0c, 0x09, 0x80, 0x07, 0x01], 0);
        info[17] = 87; info[18] = 0; info[22] = 30;
        return respond(dev, cmd, info);
      }
      if (cmd === CMD.GET_GAME_MODE) return respond(dev, cmd, state.game);
      if (cmd === CMD.GET_LED_EFFECT) return respond(dev, cmd, state.effect);
      if (cmd === CMD.SET_LED_EFFECT) { state.effect = d.slice(8, 24); return respond(dev, cmd, []); }
      if (cmd === CMD.SET_GAME_MODE) { state.game.set(d.slice(8, 8 + 56)); return respond(dev, cmd, []); }
      const t = tables[cmd];
      if (t && cmd < 33) return respond(dev, cmd, state[t].slice(addr, addr + len), addr);
      if (t) { state[t].set(d.slice(8, 8 + len), addr); return respond(dev, cmd, [], addr); }
      respond(dev, cmd, []);
    },
  });
  const tft = new FakeDevice({
    productId: 0x8009,
    productName: 'AK820 Pro',
    collections: [col(0xff67, 4104)],
    onReport(d, dev) {
      const r = new Uint8Array(64); r[0] = 0x55; r[1] = CMD.SET_LED_USER_ANIMATION;
      dev.emit(r);
    },
  });
  return { devices: [control, tft], state };
}

/** Famille B : accuse réception de chaque échange feature (octet 3 = 1). */
export function mockFamilyB() {
  let last = new Uint8Array(64);
  const control = new FakeDevice({
    productId: 0x800a,
    productName: 'AK820',
    collections: [col(0xff13, 64, 64)],
    onFeature(d) { last = d.slice(); },
    getFeature() {
      const r = last.slice();
      if (r[0] === 0x20 && r[1] === 1) { r[3] = 255; return r; }
      if (r[0] === 4) r[3] = 1;
      return r;
    },
  });
  const tft = new FakeDevice({
    productId: 0x800a,
    productName: 'AK820',
    collections: [col(0xff68, 4096)],
    onReport(d, dev) { dev.emit(new Uint8Array(64)); },
  });
  return { devices: [control, tft] };
}

/**
 * Firmware QMK « Cadran » : imite le canal 0x14 de keymaps/cadran/studio.c.
 * defaultHids = [[emplacement, code HID]] (disposition ANSI) pour la keymap d'origine.
 */
export function mockFamilyQ(defaultHids = []) {
  const effects = ['Fixe', 'Touche allumée', 'Touche éteinte', 'Scintillement', 'Pluie', 'Multicolore', 'Respiration', 'Spectre', 'Vague centrale', 'Défilement', 'Roulement', 'Rotation', 'Spirale', 'Explosion', 'Lancement', 'Ondulations', 'Flux', 'Pulsation', 'Bascule', 'Navette', 'Chaleur', 'Personnalisé', 'Éteint'];
  const layerBytes = Q_ROWS * Q_COLS * 2;
  const factory = new Uint8Array(4 * layerBytes);
  const put = (map, layer, slot, code) => {
    const m = SLOT_MATRIX.get(slot);
    if (!m) return;
    const o = layer * layerBytes + (m[0] * Q_COLS + m[1]) * 2;
    map[o] = code >> 8; map[o + 1] = code & 0xff;
  };
  for (let l = 1; l < 4; l += 2) for (const slot of SLOT_MATRIX.keys()) put(factory, l, slot, 0x0001);
  for (const [slot, hid] of defaultHids) {
    const code = hid === 175 ? 0x5221 : hid;
    put(factory, 0, slot, code);
    put(factory, 2, slot, hid === 175 ? 0x5223 : code);
  }
  put(factory, 1, 0, 0x7c00); put(factory, 3, 0, 0x7c00);
  const state = {
    keymap: factory.slice(), factory, light: [0, 20, 255, 160, 128], max: 200, sleep: 1, minutes: [1, 3, 5, 10, 0],
    perkey: new Uint8Array(Q_LED_COUNT * 3).fill(255), clock: null,
    themes: ['Cadran', 'Terminal', 'Tuiles'], theme: 0,
    macros: buildMacroBuffer([...DEMO_MACROS, ...Array(Q_MACRO_COUNT - DEMO_MACROS.length).fill({ steps: [], tail: [] })], MACRO_SIZE).buffer,
  };
  const device = new FakeDevice({
    productId: 0x8009,
    productName: 'AK820 PRO',
    collections: [col(PAGE_RAW, Q_REPORT, 0, USAGE_RAW, Q_REPORT)],
    onReport(d, dev) {
      const r = d.slice(0, Q_REPORT), a = (i) => d[3 + i];
      const refuse = () => { r[0] = 0xff; };
      if (d[0] !== 0x07) refuse();
      else if (d[1] === CH_CLOCK && d[2] === 1) state.clock = Array.from(d.slice(3, 10));
      else if (d[1] === CH_SYS && d[2] === 2) { r.fill(0, 3); r.set(new TextEncoder().encode('cadran-1.3 (démo)'), 3); }
      else if (d[1] !== CH_STUDIO) refuse();
      else {
        switch (d[2]) {
          case QC.INFO: r.fill(0, 3); r.set([2, effects.length, 4, Q_ROWS, Q_COLS, Q_LED_COUNT, 5, state.sleep, effects.indexOf('Personnalisé'), 0, 87, ...state.minutes, state.themes.length, state.theme], 3); break;
          case QC.EFFECT_NAME: r.fill(0, 4); if (a(0) < effects.length) r.set(new TextEncoder().encode(effects[a(0)]), 4); else refuse(); break;
          case QC.LIGHT_GET: r.set([...state.light, state.max], 3); break;
          case QC.LIGHT_SET: state.light = [a(0), a(1), a(2), Math.min(a(3), state.max), a(4)]; break;
          case QC.SLEEP_SET: if (a(0) < 5) state.sleep = a(0); else refuse(); break;
          case QC.KEYMAP_GET: case QC.KEYMAP_DEFAULT: {
            const off = (a(0) << 8) | a(1), src = d[2] === QC.KEYMAP_GET ? state.keymap : state.factory;
            r.set(src.slice(off, off + a(2)), 6); break;
          }
          case QC.KEY_SET: { const o = a(0) * layerBytes + (a(1) * Q_COLS + a(2)) * 2; state.keymap[o] = a(3); state.keymap[o + 1] = a(4); break; }
          case QC.MATRIX: r.fill(0, 3); break;
          case QC.PERKEY_GET: r.set(state.perkey.slice(a(0) * 3, (a(0) + a(1)) * 3), 5); break;
          case QC.PERKEY_SET: state.perkey.set(d.slice(5, 5 + a(1) * 3), a(0) * 3); break;
          case QC.PERKEY_SAVE: if (a(0)) state.light[0] = 8; if (a(1) !== 0xff) state.light[3] = a(1); break;
          case QC.THEME_NAME: r.fill(0, 4); if (a(0) < state.themes.length) r.set(new TextEncoder().encode(state.themes[a(0)]), 4); else refuse(); break;
          case QC.THEME_SET: if (a(0) < state.themes.length) state.theme = a(0); else refuse(); break;
          case QC.MACRO_INFO: r.fill(0, 3); r.set([Q_MACRO_COUNT, MACRO_SIZE >> 8, MACRO_SIZE & 0xff], 3); break;
          case QC.MACRO_GET: { const off = (a(0) << 8) | a(1), n = a(2); if (off + n > MACRO_SIZE) refuse(); else r.set(state.macros.slice(off, off + n), 6); break; }
          case QC.MACRO_SET: { const off = (a(0) << 8) | a(1), n = a(2); if (off + n > MACRO_SIZE) refuse(); else state.macros.set(d.slice(6, 6 + n), off); break; }
          default: refuse();
        }
      }
      dev.emit(r);
    },
  });
  return { devices: [device], state };
}
