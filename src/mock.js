// Faux clavier pour la démo (?demo=a ou ?demo=b) et les tests Node.
// Imite les interfaces WebHID et les réponses observées : rien n'est envoyé à un vrai appareil.
import { VENDOR_ID, CMD, HEADER_LEN } from './protocol.js';

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

const col = (usagePage, outBytes, featBytes = 0) => ({
  usagePage,
  usage: 1,
  outputReports: outBytes ? [{ reportId: 0, items: [{ reportSize: 8, reportCount: outBytes }] }] : [],
  featureReports: featBytes ? [{ reportId: 0, items: [{ reportSize: 8, reportCount: featBytes }] }] : [],
  inputReports: [{ reportId: 0, items: [{ reportSize: 8, reportCount: 64 }] }],
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
