// Tests du protocole AJ139 sur des trames relevées sur la vraie souris le 26/11/2026.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as P from './protocol.js';

const hex = (s) => Uint8Array.from(s.trim().split(/\s+/).map((x) => parseInt(x, 16)));
const pad = (a) => { const d = new Uint8Array(64); d.set(a); return d; };

const INFO = pad(hex(`AA 03 00 2A 38 00 00 00 59 4A 58 2E 63 6F 2E 6D 6F 75 73 65 32 37 31 32 32 30 4E 6F 76 20 31 32
  20 32 30 32 35 31 38 3A 34 39 3A 32 37 46 65 62 20 32 30 20 32 30 32 34 32 30 3A 31 38 3A 31 39`));
const SETTINGS = pad(hex(`AA 0E A5 BD 2F 00 00 00 00 06 04 06 03 90 01 20 03 B0 04 40 06 60 09 C6 5C 00 00 00 00 00 00 00
  00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 FF 01 0A 03 FF 36 00`));
const KEYS = pad(hex(`AA 08 A5 07 20 00 00 00 20 01 00 00 20 02 00 00 20 04 00 00 20 08 00 00 20 10 00 00 21 55 00 00
  21 38 01 00 21 38 FF 00`));

test('somme de contrôle : trames envoyées qui ont reçu une réponse', () => {
  assert.equal(P.readInfo()[3], 0x00);
  assert.deepEqual(Array.from(P.readSettings().slice(0, 8)), [0x55, 0x0e, 0xa5, 0x30, 0x30, 0, 0, 0]);
  assert.equal(P.readKeys()[3], 0x20);
});

test('somme de contrôle des réponses de la souris', () => {
  assert.equal(P.checksum(INFO), 0x2a);
  assert.equal(P.checksum(KEYS), 0x07);
});

test('identité du firmware', () => {
  const i = P.parseInfo(INFO);
  assert.equal(i.vendor, 'YJX.co.mouse');
  assert.equal(i.model, '2712');
  assert.equal(i.mouseBuild, 'Nov 12 2025 18:49:27');
  assert.equal(i.dongleBuild, 'Feb 20 2024 20:18:19');
});

test('lecture des réglages', () => {
  const s = P.parseSettings(SETTINGS);
  assert.deepEqual(s.dpi, [400, 800, 1200, 1600, 2400, 23750]);
  assert.equal(s.dpiIndex, 2);
  assert.equal(P.RATES[s.rate], 2000);
  assert.equal(s.debounce, 10);
  assert.equal(P.SLEEP_MIN[s.sleep], 10);
  assert.equal(s.sensor & P.SENSOR.ANGLE_SNAP, 1);
  assert.equal(s.battery, 0x36);
});

test('écriture des réglages = trame vérifiée sur la souris (hors octets 54-55)', () => {
  const sent = hex(`55 0F AE 00 30 00 00 00 00 06 04 06 03 90 01 20 03 B0 04 40 06 60 09 C6 5C 00 00 00 00 00 00 00
    00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 FF 01 0A 03 FF 00 00`);
  const f = P.writeSettings(P.parseSettings(SETTINGS));
  const ref = pad(sent); ref[3] = P.checksum(ref);
  assert.deepEqual(Array.from(f), Array.from(ref));
});

test('modification puis relecture', () => {
  const s = P.parseSettings(SETTINGS);
  s.dpi[0] = 1234; s.rate = 3; s.esports = true; s.scrollReverse = true; s.debounce = 99;
  const r = P.writeSettings(s); r[0] = 0xaa; r[1] = 0x0e;
  const t = P.parseSettings(r);
  assert.equal(t.dpi[0], 1250);
  assert.equal(t.rate, 3);
  assert.equal(t.esports, true);
  assert.equal(t.scrollReverse, true);
  assert.equal(t.debounce, 20);
});

test('boutons : lecture, noms et réécriture à l\'identique', () => {
  const k = P.parseKeys(KEYS);
  assert.deepEqual(k, P.DEFAULT_KEYS);
  assert.equal(P.describe(k[5]), 'DPI suivant (bouton DPI)');
  assert.equal(P.describe([0x10, 0x03, 0x04, 0]), 'Ctrl+Maj+A');
  const w = P.writeKeys(k);
  assert.deepEqual(Array.from(w.slice(8, 44)), Array.from(KEYS.slice(8, 44)));
  assert.equal(w[1], 0x09);
});

test('éclairage immédiat : trame acceptée par la souris le 26/11/2026', () => {
  assert.deepEqual(Array.from(P.liveLight(0).slice(0, 11)), [0x55, 0x21, 0xa5, 0x03, 0x03, 0, 0, 0, 0, 0, 0]);
  assert.equal(P.liveLight(6)[10], 6);
  assert.equal(P.liveLight(6)[3], 9);
});

test('éclairage : octets 43-47 conservés et réécrits', () => {
  const s = P.parseSettings(SETTINGS);
  assert.deepEqual(s.lightExtra, [0, 0, 0, 0, 0]);
  s.lightExtra = [1, 2, 3, 4, 5];
  const r = P.writeSettings(s); r[0] = 0xaa; r[1] = 0x0e;
  assert.deepEqual(P.parseSettings(r).lightExtra, [1, 2, 3, 4, 5]);
  assert.equal(r[48], 0); // molette inchangée
  const f = P.liveLight(2, 0, [10, 20, 30, 255, 0, 0]);
  assert.deepEqual(Array.from(f.slice(8, 17)), [0, 0, 2, 10, 20, 30, 255, 0, 0]);
  assert.equal(f[4], 9);
});
