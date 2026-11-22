// Tests du protocole : valeurs reprises des tests Rust de wsclx/ak820pro-modder,
// puis séquences complètes contre les faux claviers de src/mock.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/protocol.js';
import { mockFamilyA, mockFamilyB, mockFamilyQ } from '../src/mock.js';
import * as Q from '../src/qmk.js';
import { actionLabel } from '../src/keycodes.js';
import { LAYOUTS } from '../src/layouts.js';

const arr = (u8, a, b) => Array.from(u8.slice(a, b));

test('buildFrame : en-tête et bourrage', () => {
  const p = P.buildFrame(35, 16, 0, [0xde, 0xad], true);
  assert.deepEqual(arr(p, 0, 10), [0xaa, 35, 16, 0, 0, 0, 1, 0, 0xde, 0xad]);
  assert.ok(p.slice(10).every((b) => b === 0));
  const q = P.buildFrame(34, 8, 0x1234, [], false);
  assert.deepEqual(arr(q, 3, 7), [0x34, 0x12, 0, 0]);
});

test('SET_LED_EFFECT : disposition officielle et bornes', () => {
  const p = P.ledEffectPayload({ mode: 1, color: 'FF0000', brightness: 3, speed: 5, direction: 'left', colorMode: 0 });
  assert.deepEqual(Array.from(p), [1, 255, 0, 0, 0xff, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0xaa, 0x55], 'Fixe : vitesse forcée à 0');
  assert.equal(P.ledEffectPayload({ mode: 7, color: 'FF0000', brightness: 3, speed: 5 })[10], 5);
  const q = P.ledEffectPayload({ mode: 4, color: '#FFFFFF', brightness: 99, speed: 99, direction: 'up' });
  assert.equal(q[9], 5); assert.equal(q[10], 5); assert.equal(q[11], 2);
});

test('GET_DEVICE_INFO', () => {
  const b = new Uint8Array(48);
  b[0] = 64; b[3] = 2; b[4] = 0x45; b[5] = 0x0c; b[6] = 0x09; b[7] = 0x80; b[8] = 0x07; b[9] = 0x01; b[17] = 100; b[18] = 1;
  const i = P.parseDeviceInfo(b);
  assert.equal(i.macroSpaceSize, 512); assert.equal(i.vid, 0x0c45); assert.equal(i.pid, 0x8009);
  assert.equal(i.firmware, '1.07'); assert.equal(i.batteryLevel, 100); assert.equal(i.chargeStatus, 1);
});

test('horloge : charge utile famille A et paquet famille B', () => {
  const d = new Date(2026, 8, 12, 19, 7, 45); // samedi
  assert.deepEqual(Array.from(P.clockPayload(d)), [0x5a, 1, 0x5a, 26, 9, 12, 19, 7, 45, 6]);
  const p = P.legacyClockPacket(new Date(2026, 9, 20, 15, 26, 37));
  assert.deepEqual(arr(p, 0, 11), [0, 1, 0x5a, 26, 10, 20, 15, 26, 37, 0, 4]);
  assert.deepEqual(arr(p, 62, 64), [0xaa, 0x55]);
  assert.equal(P.clockPayload(new Date(2026, 9, 11)).at(-1), 0); // dimanche
  assert.throws(() => P.clockPayload(new Date(2100, 0, 1)));
});

test('RGB565', () => {
  assert.equal(P.rgb565(0, 0, 0), 0);
  assert.equal(P.rgb565(255, 255, 255), 0xffff);
  assert.equal(P.rgb565(255, 0, 0), 0xf800);
  assert.equal(P.rgb565(0, 255, 0), 0x07e0);
  assert.equal(P.rgb565(0, 0, 255), 0x001f);
});

const solid = (lo, hi, delayMs) => {
  const px = new Uint8Array(P.FRAME_BYTES);
  for (let i = 0; i < px.length; i += 2) { px[i] = lo; px[i + 1] = hi; }
  return { pixels: px, delayMs };
};

test('animation famille A : en-tête, délais en 5 ms, terminateur', () => {
  const one = P.encodeAnimationA([solid(0x00, 0xf8, 0)]);
  assert.equal(one.length, 256 + P.FRAME_BYTES);
  assert.deepEqual(arr(one, 0, 2), [1, 0]);
  assert.equal(one[255], 0xff);
  assert.deepEqual(arr(one, 256, 258), [0x00, 0xf8]);
  const three = P.encodeAnimationA([solid(0, 0, 100), solid(0, 0, 200), solid(0, 0, 1275)]);
  assert.deepEqual(arr(three, 0, 5), [3, 20, 40, 0, 0xff]);
  assert.deepEqual(Array.from(P.tftChunkHeader(0, 1)), [0xaa, 80, 0, 0, 1, 0, 0x50, 0x06]);
  assert.deepEqual(Array.from(P.tftChunkHeader(0x1234, 5)), [0xaa, 80, 0x34, 0x12, 5, 0, 0x50, 0x06]);
});

test('animation famille B : délais en 2 ms, bourrage FF, 30 images au plus', () => {
  const d = P.encodeAnimationB([solid(0x12, 0x12, 100), solid(0x34, 0x34, 200)]);
  assert.deepEqual(arr(d, 0, 4), [2, 50, 100, 0xff]);
  assert.equal(d.length, 17 * 4096);
  assert.ok(d.slice(256, 256 + P.FRAME_BYTES).every((b) => b === 0x12));
  assert.ok(d.slice(256 + 2 * P.FRAME_BYTES).every((b) => b === 0xff));
  assert.throws(() => P.encodeAnimationB(Array(31).fill(solid(0, 0, 100))));
  assert.throws(() => P.encodeAnimationB([]));
});

test('famille B : paquets effet, veille, mode personnalisé', () => {
  const p = P.legacyLightingPacket({ mode: 1, color: '123456', brightness: 3, speed: 5, direction: 'left', colorMode: 0 });
  assert.deepEqual(arr(p, 0, 4), [1, 0x12, 0x34, 0x56], 'Fixe = vrai mode 0x01');
  assert.deepEqual(arr(p, 8, 16), [0, 3, 0, 0, 0, 0, 0x55, 0xaa]);
  assert.deepEqual(arr(P.legacyLightingPacket({ mode: 0, color: '123456', brightness: 3, speed: 5 }), 8, 11), [0, 0, 0]);
  assert.throws(() => P.legacyLightingPacket({ mode: 0x80 }));
  assert.equal(P.legacySleepPacket(30)[8], 3);
  assert.equal(P.legacySleepPacket(5)[8], 2);
  assert.throws(() => P.legacySleepPacket(10));
  const m = P.legacyCustomModePacket(5);
  assert.equal(m[0], 0x80); assert.equal(m[9], 5); assert.deepEqual(arr(m, 14, 16), [0xaa, 0x55]);
  const cfg = P.controlPacket(0x72, 1, 257);
  assert.deepEqual(arr(cfg, 0, 10), [4, 0x72, 1, 0, 0, 0, 0, 0, 1, 1]);
});

test('famille B : banque de couleurs ANSI', () => {
  const colors = Array.from({ length: 128 }, () => [124, 92, 255]);
  colors[34] = [255, 0, 0]; colors[49] = [0, 255, 0]; colors[50] = [0, 0, 255]; colors[51] = [255, 255, 0];
  const p = P.legacyEncodeBank(colors);
  for (const [id, rgb] of [[39, [255, 0, 0]], [56, [0, 255, 0]], [57, [0, 0, 255]], [58, [255, 255, 0]], [94, [124, 92, 255]], [85, [124, 92, 255]]]) {
    assert.deepEqual(arr(p, id * 4, id * 4 + 4), [id, ...rgb]);
  }
  assert.ok(p.slice(512, 574).every((b) => b === 0));
  assert.deepEqual(arr(p, 574, 576), [0xaa, 0x55]);
  assert.equal(new Set(P.ANSI_LED_SLOTS.map(([s]) => s)).size, 81);
});

test('touches : encodage aller-retour', () => {
  assert.deepEqual(P.encodeKeyAction({ kind: 'keyboard', usage: 0x29 }), [2, 0, 0x29, 0]);
  assert.deepEqual(P.decodeKeyAction(2, 0, 0x29, 0), { kind: 'keyboard', usage: 0x29 });
  assert.deepEqual(P.encodeKeyAction({ kind: 'consumer', value: 0x0192 }), [3, 0x92, 0x01, 0]);
  assert.deepEqual(P.decodeKeyAction(3, 0x92, 0x01, 0), { kind: 'consumer', value: 0x0192 });
  const raw = P.decodeKeyAction(6, 3, 0, 0);
  assert.deepEqual(P.encodeKeyAction(raw), [6, 3, 0, 0]);
  const slots = P.decodeKeymap(new Uint8Array(512));
  assert.equal(slots.length, 128);
});

test('LED par touche : aller-retour', () => {
  const c = Array.from({ length: 128 }, () => [0, 0, 0]);
  c[0] = [255, 0, 0]; c[12] = [0, 255, 0]; c[83] = [0, 0, 255];
  const e = P.encodeCustomLeds(c);
  assert.deepEqual(arr(e, 0, 4), [0, 255, 0, 0]);
  assert.deepEqual(arr(e, 48, 52), [12, 0, 255, 0]);
  assert.deepEqual(arr(e, 332, 336), [83, 0, 0, 255]);
  assert.deepEqual(P.decodeCustomLeds(e)[83], [0, 0, 255]);
});

const defaults = LAYOUTS['iso-fr'].keys.map((k) => [k.slot, k.hid]);

test('détection des familles', () => {
  const a = P.classify(mockFamilyA(defaults).devices);
  assert.equal(a.family, 'A'); assert.equal(a.control.collections[0].usagePage, 0xff68);
  const b = P.classify(mockFamilyB().devices);
  assert.equal(b.family, 'B'); assert.equal(b.tft.collections[0].usagePage, 0xff68);
  const other = mockFamilyB().devices;
  other.forEach((d) => { d.productName = 'EA75MAX'; });
  assert.ok(P.classify(other).error);
  assert.ok(P.classify([]).error);
});

test('famille A : séquences complètes contre le faux clavier', async () => {
  const { devices, state } = mockFamilyA(defaults);
  const kb = new P.Keyboard(P.classify(devices));
  await kb.open();
  const info = await kb.info();
  assert.equal(info.firmware, '1.07'); assert.equal(info.batteryLevel, 87);

  assert.deepEqual(await kb.getLighting(), { mode: 7, color: '#8b5cff', colorMode: 0, brightness: 4, speed: 2, direction: 'left' });
  await kb.setLighting({ mode: 8, color: '#00ff80', brightness: 4, speed: 2, direction: 'left', colorMode: 1 });
  assert.equal((await kb.getLighting()).mode, 8);
  state.effect = new Uint8Array(16);
  assert.equal(await kb.getLighting(), null, 'réponse sans AA 55 ignorée');
  const last = devices[0].sent.filter((s) => s.data[1] === 35).at(-1).data;
  assert.deepEqual(arr(last, 0, 3), [0xaa, 35, 16]);
  assert.deepEqual(arr(last, 8, 12), [8, 0, 255, 0x80]);

  const km = await kb.getKeymap('base');
  assert.deepEqual(km[33], { kind: 'keyboard', usage: 20 });
  km[48] = { kind: 'keyboard', usage: 41 }; // Verr Maj → Échap
  await kb.setKeymap('base', km);
  assert.deepEqual(arr(state.keymap, 48 * 4, 48 * 4 + 4), [2, 0, 41, 0]);
  const frames = devices[0].sent.slice(-10).map((s) => s.data);
  assert.equal(frames.at(-1)[6], 1, 'dernier paquet marqué');
  assert.equal(frames.at(-2)[6], 0);

  await kb.setSleep(2);
  assert.equal(state.game[3], 2);
  assert.equal(await kb.getSleep(), 2);

  const colors = Array.from({ length: 128 }, (_, i) => [i, 255 - i, 7]);
  await kb.setPerKey(colors, 3);
  assert.deepEqual((await kb.getPerKey())[100], [100, 155, 7]);
  const mode = devices[0].sent.filter((s) => s.data[1] === 35).at(-1).data;
  assert.equal(mode[8], 0x80); assert.equal(mode[17], 3);

  await kb.syncClock(new Date(2026, 10, 21, 12, 0, 0));
  assert.deepEqual(arr(devices[0].sent.at(-1).data, 0, 3), [0xaa, 52, 10]);

  let progress = 0;
  const rep = await kb.uploadTft([solid(0, 0xf8, 100), solid(0x1f, 0, 100)], (d) => { progress = d; });
  assert.equal(rep.chunks, Math.ceil((256 + 2 * P.FRAME_BYTES) / 4096));
  assert.equal(rep.acknowledged, rep.chunks);
  assert.equal(progress, rep.chunks);
  const chunk0 = devices[1].sent[0].data;
  assert.equal(chunk0.length, 4104);
  assert.deepEqual(arr(chunk0, 0, 8), [0xaa, 80, 0, 0, rep.chunks, 0, 0x50, 0x06]);
  assert.deepEqual(arr(chunk0, 8, 11), [2, 20, 0]);
});

test('famille B : START, préambule, données, COMMIT, FINISH', async () => {
  const { devices } = mockFamilyB();
  const kb = new P.Keyboard(P.classify(devices));
  await kb.open();
  await kb.setLighting({ mode: 1, color: '#123456', brightness: 3, speed: 5, direction: 'left' });
  const ops = devices[0].sent.map((s) => [s.data[0], s.data[1], s.data[8]]);
  assert.deepEqual(ops, [[4, 0x18, 1], [4, 0x13, 1], [1, 0x12, 0], [4, 0x02, 0], [4, 0xf0, 1]]);

  devices[0].sent.length = 0;
  await kb.setPerKey(Array.from({ length: 128 }, () => [1, 2, 3]), 5);
  const s = devices[0].sent.map((x) => x.data);
  assert.equal(s.length, 13 + 5);
  assert.deepEqual(arr(s[0], 0, 9), arr(P.controlPacket(0x18, 0, 0), 0, 9));
  assert.deepEqual(arr(s[1], 0, 9), arr(P.controlPacket(0x23, 0, 9), 0, 9));
  assert.deepEqual(arr(s[12], 0, 9), arr(P.controlPacket(0xf0, 0, 0), 0, 9));
  assert.equal(s[15][0], 0x80);

  const info = await kb.info();
  assert.equal(info.wiredFull, true);

  devices[0].sent.length = 0;
  const rep = await kb.uploadTft([solid(0, 0, 0)]);
  assert.equal(rep.chunks, 9);
  assert.equal(devices[1].sent.length, 9);
  assert.equal(devices[1].sent[0].data.length, 4096);
  const ctl = devices[0].sent.map((x) => [x.data[1], x.data[2], x.data[8]]);
  assert.deepEqual(ctl, [[0x18, 0, 0], [0x72, 1, 9], [0x02, 0, 0]]);
});

test('famille B : table des touches (pilote Windows 1.0.0.5)', async () => {
  const slots = P.defaultKeymap();
  slots[48] = { kind: 'keyboard', usage: 0x29 };   // Verr Maj → Échap (index 55)
  slots[87] = { kind: 'keyboard', usage: 0xe3 };   // Ctrl droit → Win gauche : masque 0x08 (index 98)
  slots[1] = { kind: 'consumer', value: 0x00cd };  // F1 → lecture/pause (index 2)
  slots[12] = { kind: 'mouse', button: 4, value: 0 }; // F12 → clic milieu (index 13)
  slots[98] = { kind: 'keyboard', usage: 0x04 };   // « < > » ISO : pas d'index connu, ignorée
  const t = P.legacyEncodeKeymap(slots);
  assert.equal(t.length, 576);
  assert.deepEqual(arr(t, 55 * 4, 56 * 4), [2, 0, 0x29, 0]);
  assert.deepEqual(arr(t, 98 * 4, 99 * 4), [2, 0x08, 0, 0]);
  assert.deepEqual(arr(t, 2 * 4, 3 * 4), [3, 0xcd, 0, 0]);
  assert.deepEqual(arr(t, 13 * 4, 14 * 4), [1, 1, 4, 0]);
  assert.deepEqual(arr(t, 574, 576), [0xaa, 0x55]);
  const nonZero = [];
  for (let i = 0; i < 143; i++) if (t.slice(i * 4, i * 4 + 4).some((b) => b)) nonZero.push(i);
  assert.deepEqual(nonZero, [2, 13, 55, 98, 143].filter((i) => i < 143), 'le reste à 0 = comportement d\'origine');

  const { devices } = mockFamilyB();
  const kb = new P.Keyboard(P.classify(devices));
  await kb.open();
  await kb.setKeymap('fn', slots);
  const s = devices[0].sent.map((x) => x.data);
  assert.equal(s.length, 13);
  assert.deepEqual([s[0][1], s[0][8]], [0x18, 0]);
  assert.deepEqual([s[1][0], s[1][1], s[1][8]], [4, 0x27, 9]);
  assert.deepEqual(Array.from(s.slice(2, 11).flatMap((b) => Array.from(b))), Array.from(t));
  assert.deepEqual([s[11][1], s[12][1], s[12][8]], [0x02, 0xf0, 0]);
  devices[0].sent.length = 0;
  await kb.setKeymap('base', slots);
  assert.equal(devices[0].sent[1].data[1], 0x11);
  assert.equal((await kb.getKeymap('base', true)).every((a) => a.kind === 'default'), true);
  await assert.rejects(kb.getKeymap('base'));
});

test('famille B : FINISH envoyé même après un refus', async () => {
  const { devices } = mockFamilyB();
  const orig = devices[0].getFeature;
  devices[0].getFeature = (dev) => { const r = orig(dev); if (r[1] === 0x13) r[3] = 0xff; return r; };
  const kb = new P.Keyboard(P.classify(devices));
  await kb.open();
  await assert.rejects(kb.setLighting({ mode: 4, color: '#ffffff', brightness: 5, speed: 3 }));
  const cmds = devices[0].sent.map((s) => s.data[1]);
  assert.deepEqual(cmds, [0x18, 0x13, 0xf0]);
});

// ---------------------------------------------------------------- firmware QMK Cadran

const ansiHids = () => LAYOUTS.ansi.keys.map((k) => [k.slot, k.hid]);
async function openQ() {
  const mock = mockFamilyQ(ansiHids());
  const kb = new P.Keyboard(P.classify(mock.devices));
  await kb.open();
  return { kb, mock, sent: mock.devices[0].sent };
}

test('QMK : détection par le HID brut 0xFF60 en 32 octets', () => {
  const { devices } = mockFamilyQ();
  const cls = P.classify(devices);
  assert.equal(cls.family, 'Q');
  devices[0].productName = 'Autre clavier';
  assert.match(P.classify(devices).error, /pas un AK820/);
});

test('QMK : cadre des paquets et horloge', () => {
  assert.deepEqual(arr(Q.qFrame(0x14, 0x07, [1, 2, 3]), 0, 7), [7, 0x14, 7, 1, 2, 3, 0]);
  assert.equal(Q.qFrame(0x14, 1).length, 32);
  assert.deepEqual(Q.qClockArgs(new Date(2026, 10, 21, 16, 40, 41)), [1, 26, 11, 21, 6, 16, 40, 41]);
});

test('QMK : correspondances emplacement / matrice / LED', () => {
  assert.equal(Q.SLOT_MATRIX.size, 82);
  const seen = new Set([...Q.SLOT_MATRIX.values()].map(([r, c]) => r * 16 + c));
  assert.equal(seen.size, 82, 'positions uniques');
  for (const k of LAYOUTS.ansi.keys) assert.ok(Q.SLOT_MATRIX.has(k.slot), `ANSI ${k.label}`);
  assert.equal(Q.SLOT_LED.size, 81, 'toutes les touches ANSI ont une LED');
  assert.equal(Q.SLOT_LED.has(98), false, '« < > » sans LED connue');
  assert.equal(Q.SLOT_LED.get(0), 0);
  assert.equal(Q.SLOT_LED.get(91), 80);
});

test('QMK : couleurs HSV', () => {
  assert.deepEqual(Q.rgbToHsv8([255, 0, 0]), [0, 255, 255]);
  assert.deepEqual(Q.hsv8ToRgb(0, 255), [255, 0, 0]);
  const [h, s] = Q.rgbToHsv8([0x8b, 0x5c, 0xff]);
  const back = Q.hsv8ToRgb(h, s);
  assert.ok(back.every((v, i) => Math.abs(v - [0x8b, 0x5c, 0xff][i]) <= 3), back.join());
});

test('QMK : métadonnées, effets et version', async () => {
  const { kb } = await openQ();
  assert.equal(kb.caps.modes.length, 23);
  assert.equal(kb.caps.modes[21].name, 'Personnalisé');
  assert.equal(kb.caps.modes[0].noSpeed, true);
  assert.deepEqual(kb.caps.sleep.map((o) => o.label), ['1 min', '3 min', '5 min', '10 min', 'Jamais']);
  assert.equal(kb.caps.layers.length, 4);
  const info = await kb.info();
  assert.equal(info.firmware, 'cadran-1.3 (démo)');
  assert.equal(info.batteryLevel, 87);
});

test('QMK : éclairage lu puis écrit', async () => {
  const { kb, mock } = await openQ();
  const cur = await kb.getLighting();
  assert.equal(cur.mode, 0);
  assert.equal(cur.brightness, 4);
  await kb.setLighting({ mode: 1, color: '#ff0000', brightness: 5, speed: 2 });
  assert.deepEqual(mock.state.light, [1, 0, 255, 200, 102]);
  await kb.setLighting({ mode: 1, color: '#ff0000', brightness: 0, speed: 0 });
  assert.equal(mock.state.light[3], 0);
});

test('QMK : keymap lue, origine, écriture des seules différences', async () => {
  const { kb, mock, sent } = await openQ();
  const base = await kb.getKeymap('base');
  assert.equal(base[33].code, 0x14, 'Q');
  assert.equal(base[85].code, 0x5221, 'Fn = MO(1)');
  const fn = await kb.getKeymap('fn', true);
  assert.equal(fn[0].code, 0x7c00);
  assert.equal(fn[33].code, Q.KC_TRNS);
  const draft = base.map((a) => a && { ...a });
  draft[48] = { kind: 'qmk', code: 0x29 };    // Verr Maj -> Échap
  sent.length = 0;
  await kb.setKeymap('base', draft, base);
  assert.equal(sent.length, 1);
  assert.deepEqual(arr(sent[0].data, 0, 8), [7, 0x14, 0x07, 0, 3, 0, 0, 0x29]);
  assert.equal((await kb.getKeymap('base'))[48].code, 0x29);
  assert.equal((await kb.getKeymap('base', true))[48].code, 0x39, 'origine inchangée');
  await assert.rejects(kb.getKeymap('autre'));
});

test('QMK : couleurs par touche', async () => {
  const { kb, mock } = await openQ();
  const colors = Array.from({ length: 128 }, (_, i) => [i, 255 - i, 7]);
  await kb.setPerKey(colors, 5);
  assert.deepEqual(Array.from(mock.state.perkey.slice(0, 3)), [0, 255, 7]);
  assert.deepEqual(Array.from(mock.state.perkey.slice(80 * 3, 81 * 3)), [91, 164, 7]);
  assert.equal(mock.state.light[0], 8, 'effet Personnalisé choisi');
  const back = await kb.getPerKey();
  assert.deepEqual(back[91], [91, 164, 7]);
  assert.deepEqual(back[98], [0, 0, 0]);
});

test('QMK : veille, horloge, test des touches, refus', async () => {
  const { kb, mock } = await openQ();
  await kb.setSleep(4);
  assert.equal(await kb.getSleep(), 4);
  await kb.syncClock(new Date(2026, 10, 21, 16, 40, 41));
  assert.deepEqual(mock.state.clock, [26, 11, 21, 6, 16, 40, 41]);
  assert.deepEqual(await kb.matrix(), []);
  await assert.rejects(kb.setSleep(9), /refusée/);
});

test('QMK : interfaces de l\'écran (protocole 2)', async () => {
  const { kb, mock } = await openQ();
  assert.deepEqual(kb.caps.screenThemes.map((t) => t.label), ['Cadran', 'Terminal', 'Tuiles']);
  assert.equal(await kb.getScreenTheme(), 0);
  await kb.setScreenTheme(2);
  assert.equal(mock.state.theme, 2);
  assert.equal(await kb.getScreenTheme(), 2);
  await assert.rejects(kb.setScreenTheme(3), /refusée/);
});

test('QMK : protocole 1 (Cadran 1.1) sans interfaces', () => {
  const r = new Uint8Array(32);
  r.set([7, 0x14, 1, 1, 10, 4, 6, 15, 81, 5, 1, 8, 0, 100, 1, 3, 5, 10, 0, 3, 1]);
  const info = Q.qParseInfo(r);
  assert.equal(info.themeCount, 0);
  assert.equal(info.theme, null);
  assert.deepEqual(info.sleepMinutes, [1, 3, 5, 10, 0]);
});

test('QMK : firmware sans canal Studio', async () => {
  const mock = mockFamilyQ();
  const orig = mock.devices[0].onReport;
  mock.devices[0].onReport = (d, dev) => { if (d[1] === 0x14) { const r = d.slice(); r[0] = 0xff; dev.emit(r); } else orig(d, dev); };
  const kb = new P.Keyboard(P.classify(mock.devices));
  await assert.rejects(kb.open(), /Cadran 1\.1/);
});

test('QMK : libellés des codes', () => {
  const labels = new Map([[0x04, 'Q'], [0x2b, 'Tab']]);
  const l = (code) => actionLabel({ kind: 'qmk', code }, labels);
  assert.equal(l(0x04), 'Q');
  assert.equal(l(0x00a9), 'Volume +');
  assert.equal(l(0x082b), 'Win+Tab');
  assert.equal(l(0x5221), 'Fn');
  assert.equal(l(0x5222), 'Couche 2 (maintenue)');
  assert.equal(l(0x7e00), 'Écran marche / arrêt');
  assert.equal(l(0x00af), 'Code 0x00af');
});

test('noms de couleurs, comme sur l\'écran du clavier', async () => {
  const { colorName } = await import('../src/qmk.js');
  assert.equal(colorName('#ff0000'), 'Rouge');
  assert.equal(colorName('#ff7800'), 'Orange');
  assert.equal(colorName('#ffffff'), 'Blanc');
  assert.equal(colorName('#1a1aff'), 'Bleu');
  assert.equal(colorName('#ff3399'), 'Rose');
  assert.equal(colorName('#000000'), 'Noir');
  assert.equal(colorName('zz'), '');
});

// ---------------------------------------------------------------- macros

const ESC = 1, TAP = 1, DOWN = 2, UP = 3, DELAY = 4, BAR = 0x7c;
const digits = (n) => Array.from(String(n), (d) => d.charCodeAt(0));
const M = (steps, tail = []) => ({ steps, tail });

test('macros : Ctrl+Maj+A avec délai 25 ms, octets exacts', () => {
  const b = P.encodeMacroStep({ mods: 0x03, key: 0x04, delay: 25 });
  assert.deepEqual(b, [ESC, DOWN, 0xe0, ESC, DOWN, 0xe1, ESC, TAP, 0x04, ESC, UP, 0xe0, ESC, UP, 0xe1, ESC, DELAY, ...digits(25), BAR]);
  assert.deepEqual(P.encodeMacroStep({ key: 0x1e }), [ESC, TAP, 0x1e], 'sans modificateur ni délai : une seule touche');
  assert.deepEqual(P.encodeMacroStep({ mods: 0x08, key: 0x2b }), [ESC, DOWN, 0xe3, ESC, TAP, 0x2b, ESC, UP, 0xe3]);
});

test('macros : aller-retour avec délais et modificateurs', () => {
  const steps = [
    { mods: 0, key: 0x04, delay: 0 },
    { mods: 0x01, key: 0x06, delay: 50 },
    { mods: 0x0f, key: 0x19, delay: 9999 },
    { mods: 0x0c, key: 0xe1, delay: 1 },
    { mods: 0x00, key: 0xa4, delay: 1234 },
  ];
  const bytes = P.encodeMacro(M(steps));
  const back = P.decodeMacro(bytes);
  assert.deepEqual(back.steps, steps);
  assert.deepEqual(back.tail, []);
  assert.deepEqual(P.encodeMacro(back), bytes);
});

test('macros : bornes des délais et des touches', () => {
  assert.deepEqual(P.encodeMacroStep({ key: 4, delay: 9999 }).slice(-7), [ESC, DELAY, ...digits(9999), BAR]);
  assert.deepEqual(P.encodeMacroStep({ key: 4, delay: 0 }), [ESC, TAP, 4], 'délai 0 : pas d\'octets de délai');
  assert.throws(() => P.encodeMacroStep({ key: 4, delay: 10000 }), /0 à 9999/);
  assert.throws(() => P.encodeMacroStep({ key: 4, delay: -1 }), /0 à 9999/);
  assert.throws(() => P.encodeMacroStep({ key: 4, delay: 1.5 }), /0 à 9999/);
  assert.throws(() => P.encodeMacroStep({ key: 0 }), /Touche hors plage/);
  assert.throws(() => P.encodeMacroStep({ key: 0x03 }), /Touche hors plage/);
  assert.throws(() => P.encodeMacroStep({ key: 0xa5 }), /Touche hors plage/);
  assert.throws(() => P.encodeMacroStep({ key: undefined }), /Touche hors plage/);
  assert.deepEqual(P.encodeMacroStep({ key: 0xe0 }), [ESC, TAP, 0xe0], 'modificateur utilisable comme touche');
});

test('macros : octets non éditables gardés en fin, sans perte', () => {
  const raw = [ESC, TAP, 4, 0x99, 0x12];
  const m = P.decodeMacro(raw);
  assert.deepEqual(m.steps, [{ mods: 0, key: 4, delay: 0 }]);
  assert.deepEqual(m.tail, [0x99, 0x12]);
  assert.deepEqual(P.encodeMacro(m), raw);
  // Délai écrit « 0 » : forme non canonique, donc non éditable.
  const zero = [ESC, TAP, 4, ESC, DELAY, 0x30, BAR];
  const z = P.decodeMacro(zero);
  assert.equal(z.steps.length, 1);
  assert.deepEqual(z.tail, [ESC, DELAY, 0x30, BAR]);
  assert.deepEqual(P.encodeMacro(z), zero);
  // Relâche sans appui : non éditable.
  const up = [ESC, TAP, 4, ESC, UP, 0xe0];
  assert.deepEqual(P.decodeMacro(up).tail, [ESC, UP, 0xe0]);
  // Macro entièrement inconnue.
  assert.deepEqual(P.decodeMacro([7, 7, 7]), M([], [7, 7, 7]));
  assert.deepEqual(P.decodeMacro([]), M([], []));
});

test('macros : tampon, séparateurs 00 et dernier octet à 0', () => {
  const macros = [M([{ mods: 1, key: 6, delay: 50 }]), M([]), M([{ mods: 0, key: 0x1e, delay: 0 }])];
  for (let n = 0; n < 5; n++) macros.push(M([]));
  const { buffer, used } = P.buildMacroBuffer(macros, 64);
  assert.equal(buffer.length, 64);
  assert.equal(buffer[63], 0);
  assert.equal(used, P.macroUsage(macros));
  assert.deepEqual(Array.from(buffer.slice(0, used)), [
    ...P.encodeMacro(macros[0]), 0, 0, ...P.encodeMacro(macros[2]), 0, 0, 0, 0, 0, 0,
  ]);
  const back = P.parseMacroBuffer(buffer, 8);
  assert.deepEqual(back.map((m) => m.steps), macros.map((m) => m.steps));
});

test('macros : tampon plein, dépassement refusé', () => {
  // 18 étapes de 3 octets = 54, plus 8 séparateurs = 62 sur 64 : le dernier octet reste 00.
  const step = { key: 4, delay: 0 };
  const full = [M(Array.from({ length: 18 }, () => step)), M([]), M([]), M([]), M([]), M([]), M([]), M([])];
  assert.equal(P.macroUsage(full), 62);
  const { buffer } = P.buildMacroBuffer(full, 64);
  assert.equal(buffer[63], 0);
  assert.throws(() => P.buildMacroBuffer([M(Array.from({ length: 30 }, () => step))], 64), /trop longues/);
});

test('macros : lecture et écriture sur le faux clavier', async () => {
  const { kb, mock, sent } = await openQ();
  assert.deepEqual(kb.caps.macros, { count: 8, size: 512 });
  const macros = await kb.getMacros();
  assert.equal(macros.length, 8);
  assert.deepEqual(macros[0].steps, [{ mods: 1, key: 0x06, delay: 50 }, { mods: 1, key: 0x19, delay: 0 }]);
  assert.deepEqual(macros[7], M([]));

  const edited = macros.map((m) => ({ steps: m.steps.map((s) => ({ ...s })), tail: [...m.tail] }));
  edited[2] = M([{ mods: 2, key: 0x0b, delay: 9999 }, { mods: 0, key: 0x28, delay: 0 }]);
  sent.length = 0;
  await kb.setMacros(edited);
  const writes = sent.filter((p) => p.data[2] === Q.QC.MACRO_SET);
  assert.equal(writes.length, 1 + Math.ceil(512 / 26), 'garde (0xFF sur le dernier octet) puis tampon entier par morceaux de 26 octets');
  assert.deepEqual([writes[0].data[3] << 8 | writes[0].data[4], writes[0].data[5], writes[0].data[6]], [511, 1, 0xff]);
  assert.ok(writes.every((p) => p.data[5] <= 26));
  assert.equal(writes.at(-1).data[3] << 8 | writes.at(-1).data[4], 494, 'le dernier morceau vient en dernier');
  assert.equal(mock.state.macros[511], 0);
  assert.deepEqual(await kb.getMacros(), edited);
  await assert.rejects(kb.setMacros(edited.slice(0, 3)), /8 macros/);
});

test('macros : firmware sans MACRO_INFO, familles A et B', async () => {
  const mock = mockFamilyQ();
  const orig = mock.devices[0].onReport;
  mock.devices[0].onReport = (d, dev) => { if (d[1] === 0x14 && d[2] === Q.QC.MACRO_INFO) { const r = d.slice(0, 32); r[0] = 0xff; dev.emit(r); } else orig(d, dev); };
  const kb = new P.Keyboard(P.classify(mock.devices));
  await kb.open();
  assert.equal(kb.caps.macros, null);
  await assert.rejects(kb.getMacros(), /ne gère pas les macros/);
  assert.equal((await openQ()).kb.caps.macros.count, 8);
  const a = new P.Keyboard(P.classify(mockFamilyA(defaults).devices));
  assert.equal(a.caps.macros, null);
  const b = new P.Keyboard(P.classify(mockFamilyB().devices));
  assert.equal(b.caps.macros, null);
});

test('macros : affectation à une touche, libellés 0x7700 + n', () => {
  assert.equal(Q.QK_MACRO, 0x7700);
  assert.equal(actionLabel({ kind: 'qmk', code: 0x7700 }, new Map()), 'Macro 1');
  assert.equal(actionLabel({ kind: 'qmk', code: 0x7702 }, new Map()), 'Macro 3');
  assert.equal(actionLabel({ kind: 'qmk', code: 0x7707 }, new Map()), 'Macro 8');
  assert.equal(actionLabel({ kind: 'qmk', code: 0x7708 }, new Map()), 'Code 0x7708');
});
