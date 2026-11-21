// Tests du protocole : valeurs reprises des tests Rust de wsclx/ak820pro-modder,
// puis séquences complètes contre les faux claviers de src/mock.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from '../src/protocol.js';
import { mockFamilyA, mockFamilyB } from '../src/mock.js';
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
  assert.deepEqual(Array.from(p), [1, 255, 0, 0, 0xff, 0, 0, 0, 0, 3, 5, 0, 0, 0, 0xaa, 0x55]);
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
  assert.deepEqual(arr(p, 0, 4), [7, 0x12, 0x34, 0x56]);
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
  assert.deepEqual(ops, [[4, 0x18, 1], [4, 0x13, 1], [7, 0x12, 0], [4, 0x02, 0], [4, 0xf0, 1]]);

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
