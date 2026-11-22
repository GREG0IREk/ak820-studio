// Interface d'AK820 Studio.
import {
  VENDOR_ID, PAGE_FEATURE, PAGE_TFT_A, PAGE_TFT_B, CONTROL_USAGE_PAGES, FAMILY_A,
  MODES, supportedDirections, classify, Keyboard, TFT_SIZE, LEGACY_MAX_FRAMES, parseHex,
  defaultKeymap, macroUsage, encodeMacro,
} from './protocol.js';
import { LAYOUTS } from './layouts.js';
import { EXTRA_KEYS, CONSUMER, MOUSE, actionLabel, sameAction } from './keycodes.js';
import { decodeFile, renderFrame, toPixels } from './image.js';
import { mockFamilyA, mockFamilyB, mockFamilyQ } from './mock.js';
import { SCREEN_PREVIEWS } from './ecrans.js';
import { FAMILY_Q, PAGE_RAW, QMK_MEDIA, QMK_LIGHTING, QMK_KEYBOARD, KC_TRNS, SLOT_MATRIX, isBasicHid, colorName, QK_MACRO } from './qmk.js';

// ------------------------------------------------------------ outils

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => Array.from(root.querySelectorAll(s));
const store = {
  get(k, d) { try { const v = localStorage.getItem('ak820.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('ak820.' + k, JSON.stringify(v)); } catch { /* stockage indisponible */ } },
};
const ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>';
const ICON_PLUS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const PALETTE = ['#ffffff', '#ff2d2d', '#ff8a00', '#ffd500', '#2ee86b', '#00d5ff', '#2f6bff', '#8b5cff', '#ff3db8'];

let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('err', err);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), err ? 6000 : 2600);
}

function confirmDialog(title, text, ok = 'Continuer') {
  const d = $('#confirm');
  $('h2', d).textContent = title;
  $('p', d).textContent = text;
  $('button[value=ok]', d).textContent = ok;
  return new Promise((resolve) => {
    const done = (e) => { const v = e.target.value; if (!v) return; d.close(); d.removeEventListener('click', done); resolve(v === 'ok'); };
    d.addEventListener('click', done);
    d.showModal();
  });
}

/** Lance une opération clavier : bouton occupé, erreurs affichées. */
async function run(btn, fn, okMsg) {
  if (!state.kb) { toast('Connectez d\'abord le clavier.', true); return; }
  btn && btn.classList.add('busy');
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (e) {
    console.error(e);
    toast(e.message || String(e), true);
  } finally {
    btn && btn.classList.remove('busy');
  }
}

function seg(container, items, value, onChange) {
  container.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = it.label;
    b.dataset.v = it.value;
    b.setAttribute('aria-pressed', String(it.value === value));
    b.onclick = () => {
      $$('button', container).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(it.value);
    };
    container.appendChild(b);
  }
}
function segBind(container, value, onChange) {
  $$('button', container).forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.v === String(value)));
    b.onclick = () => {
      $$('button', container).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      onChange(b.dataset.v);
    };
  });
}

/** Rangée de pastilles de couleur + sélecteur libre. */
function colorRow(container, value, onChange, palette = PALETTE) {
  container.innerHTML = '';
  const sync = (v) => {
    $$('.swatch', container).forEach((s) => s.setAttribute('aria-pressed', String(s.dataset.c === v)));
    hex.textContent = colorName(v);
    hex.title = v.toUpperCase();
    input.value = v;
  };
  for (const c of palette) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.style.background = c;
    s.dataset.c = c;
    s.title = colorName(c);
    s.onclick = () => { sync(c); onChange(c); };
    container.appendChild(s);
  }
  const pick = document.createElement('label');
  pick.className = 'picker';
  pick.title = 'Autre couleur';
  pick.innerHTML = ICON_PLUS;
  const input = document.createElement('input');
  input.type = 'color';
  input.oninput = () => { sync(input.value); onChange(input.value); };
  pick.appendChild(input);
  container.appendChild(pick);
  const hex = document.createElement('span');
  hex.className = 'hex';
  container.appendChild(hex);
  sync(value);
  return sync;
}

const hexToRgb = (h) => parseHex(h) || [0, 0, 0];
const rgbToHex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
function hsv(h, s = 1, v = 1) {
  const f = (n) => { const k = (n + h * 6) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)].map((x) => Math.round(x * 255));
}
const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// ------------------------------------------------------------ état

const params = new URLSearchParams(location.search);
const state = {
  kb: null,
  demo: params.get('demo'),
  view: store.get('view', 'lighting'),
  layoutId: store.get('layout', 'iso-fr'),
  light: store.get('light', { mode: 1, color: '#8b5cff', colorMode: 0, brightness: 4, speed: 3, direction: 'left' }),
  pk: store.get('perkey', null),
  pkColor: store.get('pkColor', '#ff2d2d'),
  pkBrightness: store.get('pkBrightness', 5),
  tft: { frames: [], fileName: '', opts: store.get('tftOpts', { fit: 'cover', zoom: 1, offsetX: 0, offsetY: 0, background: '#000000', speed: 1 }), encoded: [] },
  km: { layer: 'base', device: {}, draft: {}, factory: {}, selected: null, testing: false },
  mc: { loaded: false, list: [], sel: 0, mods: 0, dirty: false },
  logOn: false,
  log: [],
};
const layout = () => LAYOUTS[state.layoutId] || LAYOUTS['iso-fr'];
const isQ = () => !!state.kb && state.kb.family === FAMILY_Q;
const lightKey = () => (isQ() ? 'lightQ' : 'light');
const modes = () => (state.kb ? state.kb.caps.modes : MODES.map((m) => ({ ...m, noSpeed: m.id <= 1 })));
const modeInfo = (id) => modes().find((m) => m.id === id) || {};
if (!state.pk || state.pk.length !== 128) state.pk = Array.from({ length: 128 }, () => [0, 0, 0]);

// ------------------------------------------------------------ navigation

function show(view) {
  if (!state.kb && view !== 'welcome') view = 'welcome';
  $$('section.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + view));
  $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (view !== 'welcome') { state.view = view; store.set('view', view); }
  if (view === 'keymap') ensureKeymap();
  if (view === 'macros') ensureMacros();
  previewLoop(view === 'lighting');
}
$$('#nav button').forEach((b) => (b.onclick = () => show(b.dataset.view)));

// ------------------------------------------------------------ clavier dessiné

function buildKb(container, onKey) {
  container.innerHTML = '';
  const W = 16.25, H = 6;
  const els = new Map();
  for (const k of layout().keys) {
    const d = document.createElement('div');
    d.className = 'key ' + k.cap + (k.iso ? ' iso' : '');
    d.style.left = (k.x / W) * 100 + '%';
    d.style.top = (k.y / H) * 100 + '%';
    d.style.width = (k.w / W) * 100 + '%';
    d.style.height = (k.h / H) * 100 + '%';
    d.dataset.slot = k.slot;
    d.innerHTML = '<span></span>';
    container.appendChild(d);
    els.set(k.slot, d);
  }
  for (const k of layout().decor || []) {
    const d = document.createElement('div');
    d.className = 'deco deco-' + k.kind;
    d.setAttribute('aria-hidden', 'true');
    d.style.left = (k.x / W) * 100 + '%';
    d.style.top = (k.y / H) * 100 + '%';
    d.style.width = (k.w / W) * 100 + '%';
    d.style.height = (k.h / H) * 100 + '%';
    container.appendChild(d);
  }
  if (onKey) {
    let down = false;
    const hit = (e) => {
      const t = document.elementFromPoint(e.clientX, e.clientY);
      const key = t && t.closest('.key');
      if (key && container.contains(key)) onKey(+key.dataset.slot, e);
    };
    container.addEventListener('pointerdown', (e) => { down = true; hit(e); e.preventDefault(); });
    window.addEventListener('pointermove', (e) => { if (down && container.classList.contains('paint')) hit(e); });
    window.addEventListener('pointerup', () => { down = false; });
  }
  return els;
}

// ------------------------------------------------------------ éclairage

const previews = [];
function initLighting() {
  const box = $('#effects');
  box.innerHTML = '';
  previews.length = 0;
  for (const m of modes()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'effect';
    b.dataset.mode = m.id;
    const c = document.createElement('canvas');
    c.width = 64; c.height = 16;
    b.appendChild(c);
    b.appendChild(document.createTextNode(m.name));
    b.onclick = () => { state.light.mode = m.id; lightingChanged(); };
    box.appendChild(b);
    previews.push({ mode: m.key, rainbow: m.rainbow, ctx: c.getContext('2d') });
  }
  const levels = [0, 1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) }));
  seg($('#light-brightness'), levels, state.light.brightness, (v) => { state.light.brightness = v; lightingChanged(); });
  seg($('#light-speed'), levels, state.light.speed, (v) => { state.light.speed = v; lightingChanged(); });
  colorRow($('#light-colors'), state.light.color, (c) => { state.light.color = c; lightingChanged(); });
  $('#light-rainbow').checked = !!state.light.colorMode;
  $('#light-rainbow').onchange = (e) => { state.light.colorMode = e.target.checked ? 1 : 0; lightingChanged(); };
  $('#light-apply').onclick = (e) => applyLighting(e.currentTarget);
  refreshLightingUi();
}

function refreshLightingUi() {
  const L = state.light;
  $$('#effects .effect').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.mode === L.mode)));
  const dirs = isQ() ? [] : supportedDirections(L.mode);
  const info = modeInfo(L.mode);
  const caps = state.kb ? state.kb.caps : { rainbowOption: true };
  $('#light-rainbow').closest('.field').classList.toggle('hidden', !caps.rainbowOption);
  $('#light-colors').closest('.field').classList.toggle('off', !!info.noColor || (caps.rainbowOption && !!L.colorMode));
  const labels = { left: 'Gauche', right: 'Droite', up: 'Haut', down: 'Bas' };
  if (dirs.length && !dirs.includes(L.direction)) L.direction = dirs[0];
  seg($('#light-direction'), dirs.map((d) => ({ value: d, label: labels[d] })), L.direction, (v) => { L.direction = v; lightingChanged(); });
  $('#dir-reveal').classList.toggle('open', dirs.length > 0);
  $$('#light-speed button').forEach((b) => (b.disabled = !!info.noSpeed)); // Éteint, Fixe : pas d'animation
  const live = state.kb && state.kb.caps.liveLighting;
  $('#light-apply-row').classList.toggle('hidden', !!live);
  $('#lighting-lead').textContent = live
    ? 'Effet appliqué à tout le clavier. Chaque changement est envoyé aussitôt.'
    : 'Effet appliqué à tout le clavier. Ce firmware enregistre chaque envoi dans sa mémoire flash : réglez, puis appliquez.';
}

let lightTimer;
function lightingChanged() {
  store.set(lightKey(), state.light);
  refreshLightingUi();
  if (state.kb && state.kb.caps.liveLighting) {
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => applyLighting(null, true), 220);
  } else {
    $('#light-note').textContent = state.kb ? 'Modifié, pas encore envoyé' : '';
  }
}
async function applyLighting(btn, quiet) {
  await run(btn, () => state.kb.setLighting(state.light), quiet ? null : 'Éclairage appliqué');
  $('#light-note').textContent = '';
}

/** Aperçu approximatif de chaque effet sur une bande de 16 × 4 touches. */
function effectColor(mode, x, y, t, base, rainbow) {
  const col = (h) => (rainbow ? hsv(((h % 1) + 1) % 1) : base);
  const dim = (c, k) => c.map((v) => Math.round(v * Math.max(0, Math.min(1, k))));
  const rnd = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const cx = x - 0.5, cy = (y - 0.5) * 0.4, r = Math.hypot(cx, cy);
  switch (mode) {
    case 'off': return [0, 0, 0];
    case 'static': return col(x);
    case 'single-on': { const p = rnd(Math.floor(x * 16), Math.floor(y * 4)); return dim(col(x), 1 - ((t * 0.7 + p * 5) % 3)); }
    case 'single-off': { const p = rnd(Math.floor(x * 16), Math.floor(y * 4)); return dim(col(x), Math.min(1, (t * 0.7 + p * 5) % 3)); }
    case 'glittering': { const p = rnd(Math.floor(x * 16), Math.floor(y * 4)); return dim(col(p), 0.5 + 0.5 * Math.sin(t * 4 + p * 40)); }
    case 'falling': { const p = rnd(Math.floor(x * 16), 7); return dim(col(x), 1 - Math.abs(((t * 0.8 + p) % 1.4) - y) * 3); }
    case 'colourful': return hsv((x + t * 0.2) % 1);
    case 'breath': return dim(col(x), 0.5 + 0.5 * Math.sin(t * 2));
    case 'spectrum': return rainbow ? hsv((t * 0.15) % 1) : dim(base, 0.6 + 0.4 * Math.sin(t));
    case 'outward': return dim(col(r - t * 0.3), 0.5 + 0.5 * Math.sin(r * 18 - t * 4));
    case 'scrolling': return dim(col(y - t * 0.3), 0.5 + 0.5 * Math.sin(y * 7 - t * 4));
    case 'rolling': return rainbow ? hsv((x - t * 0.25 + 1) % 1) : dim(base, 0.5 + 0.5 * Math.sin(x * 9 - t * 4));
    case 'rotating': return hsv(((Math.atan2(cy, cx) / (2 * Math.PI) + t * 0.2) % 1 + 1) % 1);
    case 'explode': { const k = (t * 0.5) % 1; return dim(col(r), 1 - Math.abs(r - k * 0.7) * 8); }
    case 'launch': { const k = (t * 0.6) % 1; return dim(col(x), 1 - Math.abs(1 - y - k) * 4); }
    case 'ripples': return dim(col(r), 0.5 + 0.5 * Math.cos(r * 30 - t * 6));
    case 'flowing': return hsv(((x + y * 0.3 - t * 0.2) % 1 + 1) % 1);
    case 'pulsating': return dim(col(x), Math.abs(Math.sin(t * 3)));
    case 'tilt': return dim(col(x + y), 0.5 + 0.5 * Math.sin((x + y) * 8 - t * 3));
    case 'shuttle': { const k = 0.5 + 0.5 * Math.sin(t * 1.5); return dim(col(x), 1 - Math.abs(x - k) * 6); }
    case 'heat': { const p = rnd(Math.floor(x * 16), Math.floor(y * 4)); const k = Math.max(0, Math.sin(t * 1.3 + p * 9)); return hsv(0.66 - 0.66 * k, 1, 0.3 + 0.7 * k); }
    case 'custom': return state.pk[Math.floor(y * 3) * 16 + Math.floor(x * 12)] || [0, 0, 0];
    default: return base;
  }
}
let rafId = 0;
function previewLoop(on) {
  cancelAnimationFrame(rafId);
  if (!on) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const draw = (now) => {
    const t = reduce ? 1 : now / 1000;
    const base = hexToRgb(state.light.color);
    const k = state.light.brightness / 5;
    for (const p of previews) {
      for (let y = 0; y < 4; y++) {
        for (let x = 0; x < 16; x++) {
          const c = effectColor(p.mode, x / 15, y / 3, t, base, p.rainbow ?? !!state.light.colorMode).map((v) => Math.round(v * (0.25 + 0.75 * k)));
          p.ctx.fillStyle = `rgb(${c})`;
          p.ctx.fillRect(x * 4, y * 4, 3, 3);
        }
      }
    }
    if (!reduce) rafId = requestAnimationFrame(draw);
  };
  rafId = requestAnimationFrame(draw);
}

// ------------------------------------------------------------ touche par touche

let pkEls;
function initPerKey() {
  pkEls = buildKb($('#pk-kb'), (slot) => {
    state.pk[slot] = hexToRgb(state.pkColor);
    paintPerKey();
    store.set('perkey', state.pk);
  });
  colorRow($('#pk-colors'), state.pkColor, (c) => { state.pkColor = c; store.set('pkColor', c); }, [...PALETTE, '#000000']);
  seg($('#pk-brightness'), [1, 2, 3, 4, 5].map((v) => ({ value: v, label: String(v) })), state.pkBrightness, (v) => { state.pkBrightness = v; store.set('pkBrightness', v); });
  $('#pk-fill').onclick = () => { layout().keys.forEach((k) => (state.pk[k.slot] = hexToRgb(state.pkColor))); pkSave(); };
  $('#pk-clear').onclick = () => { state.pk = state.pk.map(() => [0, 0, 0]); pkSave(); };
  $$('[data-preset]').forEach((b) => (b.onclick = () => preset(b.dataset.preset)));
  $('#pk-send').onclick = (e) => run(e.currentTarget, () => state.kb.setPerKey(state.pk, state.pkBrightness), 'Couleurs envoyées');
  $('#pk-read').onclick = (e) => run(e.currentTarget, async () => { state.pk = await state.kb.getPerKey(); pkSave(); }, 'Couleurs lues');
  paintPerKey();
}
function pkSave() { paintPerKey(); store.set('perkey', state.pk); }
function preset(name) {
  const keys = layout().keys;
  if (name === 'rainbow') keys.forEach((k) => (state.pk[k.slot] = hsv((k.x + k.w / 2) / 16.25 * 0.85)));
  if (name === 'rows') keys.forEach((k) => (state.pk[k.slot] = hsv(k.y / 6 * 0.8 + 0.5)));
  if (name === 'gaming') {
    const hot = state.layoutId === 'iso-fr' ? [34, 49, 50, 51] : [34, 49, 50, 51]; // mêmes emplacements physiques (Z/W, Q/A, S, D)
    const arrows = [90, 88, 89, 91];
    keys.forEach((k) => (state.pk[k.slot] = [20, 20, 40]));
    [...hot, ...arrows].forEach((s) => (state.pk[s] = [255, 40, 40]));
    [80, 64, 83, 32].forEach((s) => (state.pk[s] = [255, 140, 0]));
  }
  pkSave();
}
function paintPerKey() {
  if (!pkEls) return;
  const slots = state.kb && state.kb.caps.perKeySlots;
  for (const k of layout().keys) {
    const el = pkEls.get(k.slot);
    const c = state.pk[k.slot] || [0, 0, 0];
    const span = el.firstChild;
    span.textContent = k.label;
    const off = c[0] + c[1] + c[2] === 0;
    span.style.background = off ? '' : rgbToHex(c);
    span.style.color = off ? '' : lum(c) > 140 ? '#111' : '#fff';
    span.style.borderColor = off ? '' : 'transparent';
    el.classList.toggle('na', !!slots && !slots.has(k.slot));
  }
}

// ------------------------------------------------------------ écran

const tftCanvas = $('#tft-preview');
let tftPlay = 0;
function initScreen() {
  const drop = $('#drop'), input = $('#tft-file');
  input.onchange = () => input.files[0] && loadImage(input.files[0]);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && loadImage(e.dataTransfer.files[0]); });
  const o = state.tft.opts;
  segBind($('#tft-fit'), o.fit, (v) => { o.fit = v; tftChanged(); });
  segBind($('#tft-speed'), String(o.speed), (v) => { o.speed = +v; tftChanged(); });
  for (const [id, k] of [['#tft-zoom', 'zoom'], ['#tft-x', 'offsetX'], ['#tft-y', 'offsetY']]) {
    $(id).value = o[k];
    $(id).oninput = (e) => { o[k] = +e.target.value; tftChanged(); };
  }
  colorRow($('#tft-bg'), o.background, (c) => { o.background = c; tftChanged(); }, ['#000000', '#ffffff', '#1a1a2e', '#5b4cdb']);
  $('#tft-send').onclick = (e) => sendScreen(e.currentTarget);
  const syncClock = (e) => run(e.currentTarget, () => state.kb.syncClock(new Date()), 'Horloge réglée sur ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
  $('#tft-clock').onclick = syncClock;
  $('#tft-clock-q').onclick = syncClock;
  $('#tft-factory').onclick = (e) => run(e.currentTarget, () => state.kb.tftFactory(), 'Animation d\'origine rétablie');
  const ctx = tftCanvas.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, TFT_SIZE, TFT_SIZE);
}
function maxFrames() {
  if (state.kb && state.kb.family !== FAMILY_A) return LEGACY_MAX_FRAMES;
  return Math.min(255, (state.info && state.info.tftMaxFrames) || 30);
}
async function loadImage(file) {
  try {
    const { frames, sourceCount } = await decodeFile(file, maxFrames());
    state.tft.frames.forEach((f) => f.bitmap.close && f.bitmap.close());
    state.tft.frames = frames;
    state.tft.sourceCount = sourceCount;
    state.tft.fileName = file.name;
    $('#tft-opts').classList.remove('hidden');
    tftChanged();
  } catch (e) {
    toast('Image illisible : ' + (e.message || e), true);
  }
}
function tftChanged() {
  store.set('tftOpts', state.tft.opts);
  const { frames, opts } = state.tft;
  if (!frames.length) return;
  const work = document.createElement('canvas');
  state.tft.encoded = frames.map((f) => {
    renderFrame(f.bitmap, opts, work);
    const { pixels, preview } = toPixels(work);
    return { pixels, preview, delayMs: Math.max(frames.length > 1 ? 20 : 0, Math.round(f.delayMs / opts.speed)) };
  });
  const n = frames.length, total = state.tft.encoded.reduce((a, f) => a + f.delayMs, 0);
  const cut = state.tft.sourceCount > n ? ` (sur ${state.tft.sourceCount}, limite du clavier)` : '';
  $('#tft-meta').textContent = n > 1 ? `${n} images${cut}, ${(total / 1000).toFixed(1).replace('.', ',')} s` : 'Image fixe';
  $('#tft-send').disabled = !state.kb;
  $('#tft-speed').closest('.field').classList.toggle('hidden', n < 2);
  playPreview();
}
function playPreview() {
  clearTimeout(tftPlay);
  const enc = state.tft.encoded;
  const ctx = tftCanvas.getContext('2d');
  let i = 0;
  const step = () => {
    ctx.putImageData(enc[i].preview, 0, 0);
    if (enc.length > 1) { const d = enc[i].delayMs || 100; i = (i + 1) % enc.length; tftPlay = setTimeout(step, d); }
  };
  if (enc.length) step();
}
async function sendScreen(btn) {
  const enc = state.tft.encoded;
  if (!enc.length) return;
  if (state.kb && state.kb.family !== FAMILY_A) {
    const ok = await confirmDialog('Remplacer l\'animation ?', 'Ce firmware efface l\'animation enregistrée avant de recevoir la nouvelle. Si le transfert est interrompu, il faudra le relancer.', 'Remplacer');
    if (!ok) return;
  }
  const bar = $('#tft-progress');
  bar.classList.remove('hidden');
  bar.firstElementChild.style.width = '0';
  const rep = await run(btn, () => state.kb.uploadTft(enc.map((f) => ({ pixels: f.pixels, delayMs: f.delayMs })), (d, t) => { bar.firstElementChild.style.width = (d / t) * 100 + '%'; }));
  setTimeout(() => bar.classList.add('hidden'), 800);
  if (rep) {
    const s = (rep.ms / 1000).toFixed(1).replace('.', ',');
    toast(rep.paced ? `Envoyé en ${s} s (${rep.acknowledged}/${rep.chunks} blocs confirmés). Si rien ne s'affiche : Fn + Suppr.` : `Image envoyée en ${s} s`);
    logLine(`écran : ${rep.chunks} blocs, ${rep.acknowledged} acquittés, ${rep.paced ? 'cadencé' : 'acquitté'}, ${rep.ms} ms`);
  }
}

// ------------------------------------------------------------ touches

let kmEls;
function hidLabels() {
  const m = new Map();
  for (const k of layout().keys) if (k.label && !m.has(k.hid) && (!isQ() || isBasicHid(k.hid))) m.set(k.hid, k.label.replace(/\n/g, ' '));
  m.set(44, 'Espace');
  return m;
}
/** Libellés pour l'affichage : en ISO, « \\ » (0x31, keymap QMK ANSI) donne le même caractère que « * µ » (0x32). */
function displayLabels() {
  const m = hidLabels();
  if (!m.has(0x31) && m.has(0x32)) m.set(0x31, m.get(0x32));
  return m;
}
function initKeymap() {
  kmEls = buildKb($('#km-kb'), (slot) => {
    if (!keyRemappable(slot)) { toast('Cette touche n\'est pas réaffectable sur ce firmware.'); return; }
    state.km.selected = slot; renderKeymap(); renderPicker();
  });
  bindLayers();
  $('#km-search').oninput = renderPicker;
  $('#km-revert').onclick = () => { const L = state.km.layer; state.km.draft[L] = state.km.device[L].map((a) => ({ ...a })); renderKeymap(); renderPicker(); };
  $('#km-factory').onclick = (e) => run(e.currentTarget, async () => {
    state.km.draft[state.km.layer] = await state.kb.getKeymap(state.km.layer, true);
    renderKeymap(); renderPicker();
  }, 'Valeurs d\'usine chargées : vérifiez puis écrivez sur le clavier');
  $('#km-test').onclick = () => keyTest(!state.km.testing);
  $('#km-write').onclick = (e) => run(e.currentTarget, async () => {
    const L = state.km.layer;
    await state.kb.setKeymap(L, state.km.draft[L], state.km.device[L]);
    if (state.kb.caps.keymapRead) state.km.device[L] = await state.kb.getKeymap(L);
    else { state.km.device[L] = state.km.draft[L].map((a) => ({ ...a })); store.set('keymapB.' + L, state.km.device[L]); }
    state.km.draft[L] = state.km.device[L].map((a) => ({ ...a }));
    renderKeymap();
  }, 'Touches enregistrées sur le clavier');
}
function bindLayers() {
  const layers = state.kb ? state.kb.caps.layers : [{ id: 'base', label: 'Couche normale' }, { id: 'fn', label: 'Couche Fn' }];
  if (!layers.some((l) => l.id === state.km.layer)) state.km.layer = 'base';
  $('#km-layer').innerHTML = layers.map((l) => `<button type="button" data-v="${l.id}">${l.label}</button>`).join('');
  segBind($('#km-layer'), state.km.layer, (v) => { state.km.layer = v; state.km.selected = null; ensureKeymap(); renderKeymap(); renderPicker(); });
}
const keyRemappable = (slot) => { const s = state.kb && state.kb.caps.remapSlots; return !s || s.has(slot); };

/** Test des touches (firmware QMK) : surligne les touches enfoncées et donne leur position. */
let testTimer = 0;
function keyTest(on) {
  state.km.testing = on && !!state.kb && state.kb.caps.matrixTest;
  $('#km-test').setAttribute('aria-pressed', String(state.km.testing));
  clearTimeout(testTimer);
  const note = $('#km-test-note');
  if (!state.km.testing) { note.textContent = ''; kmEls && kmEls.forEach((el) => el.classList.remove('down')); return; }
  note.textContent = 'Appuyez sur des touches du clavier.';
  const bySlot = new Map([...SLOT_MATRIX].map(([slot, [r, c]]) => [`${r},${c}`, slot]));
  const tick = async () => {
    if (!state.km.testing || !state.kb || state.view !== 'keymap') { keyTest(false); return; }
    try {
      const down = await state.kb.matrix();
      const slots = new Set(down.map(([r, c]) => bySlot.get(`${r},${c}`)).filter((x) => x !== undefined));
      kmEls.forEach((el, slot) => el.classList.toggle('down', slots.has(slot)));
      if (down.length) {
        note.textContent = down.map(([r, c]) => {
          const key = layout().keys.find((k) => k.slot === bySlot.get(`${r},${c}`));
          return `ligne ${r}, colonne ${c}${key ? ` (${key.label || 'Espace'})` : ' (hors du plan)'}`;
        }).join(' ; ');
      }
    } catch (e) { note.textContent = e.message; }
    testTimer = setTimeout(tick, 80);
  };
  tick();
}
async function ensureKeymap() {
  if (!state.kb || !state.kb.caps.keymap) return;
  const L = state.km.layer;
  if (state.km.device[L]) return renderKeymap();
  if (isQ() && !state.km.factory[L]) {
    await run(null, async () => { state.km.factory[L] = await state.kb.getKeymap(L, true); });
  }
  if (!state.kb.caps.keymapRead) {
    // Pas de relecture : on repart de ce qui a été écrit depuis ce navigateur.
    const saved = store.get('keymapB.' + L, null);
    state.km.device[L] = saved && saved.length === 128 ? saved : defaultKeymap();
    state.km.draft[L] = state.km.device[L].map((a) => ({ ...a }));
    return renderKeymap();
  }
  await run(null, async () => {
    state.km.device[L] = await state.kb.getKeymap(L);
    state.km.draft[L] = state.km.device[L].map((a) => ({ ...a }));
  });
  renderKeymap();
}
function renderKeymap() {
  if (!kmEls) return;
  const L = state.km.layer, draft = state.km.draft[L], dev = state.km.device[L];
  const labels = displayLabels();
  let changed = 0;
  for (const k of layout().keys) {
    const el = kmEls.get(k.slot);
    const a = draft && draft[k.slot];
    const fac = state.km.factory[L];
    const isDefault = isQ() ? !a || !fac || sameAction(a, fac[k.slot]) : !a || a.kind === 'default' || (a.kind === 'keyboard' && a.usage === k.hid);
    const diff = draft && dev && !sameAction(a, dev[k.slot]);
    if (diff) changed++;
    if (isQ()) el.firstChild.textContent = !a ? k.label : a.code === KC_TRNS ? '' : actionLabel(a, labels);
    else el.firstChild.textContent = isDefault ? k.label : actionLabel(a, labels);
    el.classList.toggle('mod', !isDefault);
    el.classList.toggle('sel', state.km.selected === k.slot);
    el.classList.toggle('na', !keyRemappable(k.slot));
  }
  $('#km-count').textContent = changed ? `${changed} modification${changed > 1 ? 's' : ''} à écrire` : '';
  $('#km-write').disabled = !changed;
  $('#km-revert').disabled = !changed;
}
function renderPicker() {
  const box = $('#km-actions');
  const slot = state.km.selected;
  const L = state.km.layer;
  const key = layout().keys.find((k) => k.slot === slot);
  $('#km-search').disabled = !key;
  if (!key || !state.km.draft[L]) { box.innerHTML = ''; $('#km-title').textContent = 'Aucune touche choisie'; return; }
  const layerName = (state.kb.caps.layers.find((l) => l.id === L) || {}).label || '';
  $('#km-title').textContent = `Touche « ${key.label || 'Espace'} »${L === 'base' ? '' : ` (${layerName})`}`;
  const search = $('#km-search').value.trim().toLowerCase();
  const cur = state.km.draft[L][slot];
  const labels = hidLabels();
  const fac = state.km.factory[L];
  const q = (list) => list.map(([c, l]) => [{ kind: 'qmk', code: c }, l]);
  const groups = isQ() ? [
    ['Origine', fac && fac[slot] ? [[fac[slot], `${fac[slot].code === KC_TRNS ? 'Transparent' : actionLabel(fac[slot], labels)} (origine)`]] : []],
    ['Touches du clavier', q([...labels])],
    ['Autres touches', q(EXTRA_KEYS)],
    ['Multimédia', q(QMK_MEDIA)],
    ['Macros', state.kb.caps.macros ? q(Array.from({ length: state.kb.caps.macros.count }, (_, n) => [QK_MACRO + n, `Macro ${n + 1}`])) : []],
    ['Éclairage', q(QMK_LIGHTING)],
    ['Clavier', q(QMK_KEYBOARD)],
  ] : [
    ['Origine', [[state.kb.caps.keymapRead ? { kind: 'keyboard', usage: key.hid } : { kind: 'default' }, `${key.label || 'Espace'} (origine)`]]],
    ['Touches du clavier', [...labels].map(([u, l]) => [{ kind: 'keyboard', usage: u }, l])],
    ['Autres touches', EXTRA_KEYS.map(([u, l]) => [{ kind: 'keyboard', usage: u }, l])],
    ['Multimédia', CONSUMER.map(([v, l]) => [{ kind: 'consumer', value: v }, l])],
    ['Souris', MOUSE.map(([b, l]) => [{ kind: 'mouse', button: b, value: 0 }, l])],
  ];
  box.innerHTML = '';
  for (const [title, items] of groups) {
    const shown = items.filter(([, l]) => !search || l.toLowerCase().includes(search));
    if (!shown.length) continue;
    const h = document.createElement('h3'); h.textContent = title; box.appendChild(h);
    const list = document.createElement('div'); list.className = 'list';
    for (const [action, label] of shown) {
      const c = document.createElement('button');
      c.type = 'button'; c.className = 'chip'; c.textContent = label;
      c.setAttribute('aria-pressed', String(sameAction(action, cur)));
      c.onclick = () => { state.km.draft[L][slot] = action; renderKeymap(); renderPicker(); };
      list.appendChild(c);
    }
    box.appendChild(list);
  }
}

// ------------------------------------------------------------ macros

const MOD_LABELS = [[0x01, 'Ctrl'], [0x02, 'Maj'], [0x04, 'Alt'], [0x08, 'Win']];
const ICON_UP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 15 6-6 6 6"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
const ICON_REMOVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>';

function initMacros() {
  $$('#mc-mods button').forEach((b) => (b.onclick = () => { state.mc.mods ^= +b.dataset.mod; renderMacros(); }));
  $('#mc-search').oninput = renderMacroKeys;
  $('#mc-delay-apply').onclick = () => {
    const v = clampDelay($('#mc-delay-all').value);
    if (v === null) return toast('Indiquez un délai entre 0 et 9999 ms.', true);
    mcEdit((all) => { all[state.mc.sel].steps.forEach((s) => (s.delay = v)); });
  };
  $('#mc-send').onclick = (e) => run(e.currentTarget, async () => {
    await state.kb.setMacros(state.mc.list);
    state.mc.dirty = false;
    renderMacros();
  }, 'Macros envoyées au clavier');
}

/** Délai saisi -> entier entre 0 et 9999 ms ; null si la saisie est vide ou non numérique. */
function clampDelay(v) {
  if (String(v).trim() === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(9999, Math.max(0, n)) : null;
}

async function ensureMacros() {
  if (!state.kb || !state.kb.caps.macros || state.mc.loaded) return renderMacros();
  await run(null, async () => {
    state.mc.list = await state.kb.getMacros();
    state.mc.loaded = true;
    state.mc.dirty = false;
  });
  renderMacros();
}

/** Applique une modification à une copie de la liste ; refusée si elle dépasse la mémoire. */
function mcEdit(fn) {
  const next = JSON.parse(JSON.stringify(state.mc.list));
  fn(next);
  const used = macroUsage(next), size = state.kb.caps.macros.size;
  if (used > size) { toast(`Plus de place : ${used} octets sur ${size}.`, true); renderMacros(); return; }
  state.mc.list = next;
  state.mc.dirty = true;
  renderMacros();
}

function stepLabel(s) {
  const mods = MOD_LABELS.filter(([bit]) => s.mods & bit).map(([, n]) => n);
  return [...mods, actionLabel({ kind: 'keyboard', usage: s.key }, hidLabels())].join('+');
}

function macroTool(html, label, disabled, fn) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = html;
  b.disabled = disabled;
  b.onclick = fn;
  return b;
}

function renderMacros() {
  const kb = state.kb;
  const sup = !!(kb && kb.caps.macros);
  $('#macros-unsupported').classList.toggle('hidden', sup);
  $('#macros-body').classList.toggle('hidden', !sup);
  if (!sup) {
    $('#macros-unsupported-text').textContent = kb && isQ()
      ? 'Ce firmware ne gère pas les macros. Elles demandent le firmware QMK Cadran à jour (dossier firmware du dépôt).'
      : 'Les macros ne sont disponibles que sur le firmware QMK Cadran.';
    return;
  }
  if (!state.mc.loaded) return;
  const { list, sel } = state.mc;
  const size = kb.caps.macros.size, used = macroUsage(list);

  // Liste des macros
  const box = $('#mc-list');
  box.innerHTML = '';
  list.forEach((m, n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mc-item';
    b.setAttribute('aria-pressed', String(n === sel));
    const name = document.createElement('span');
    name.className = 'mc-name';
    name.textContent = `Macro ${n + 1}`;
    const info = document.createElement('span');
    info.className = 'note';
    const count = m.steps.length;
    info.textContent = !count && !m.tail.length ? 'vide' : `${count} étape${count > 1 ? 's' : ''}, ${encodeMacro(m).length} octets${m.tail.length ? ', non éditable' : ''}`;
    b.append(name, info);
    b.onclick = () => { state.mc.sel = n; renderMacros(); };
    box.appendChild(b);
  });

  // Mémoire
  const meter = $('#mc-meter');
  meter.style.width = `${Math.min(100, (used / size) * 100)}%`;
  meter.classList.toggle('over', used > size);
  $('#mc-usage').textContent = `${used} / ${size} octets utilisés`;
  $('#mc-usage').classList.toggle('warn', used > size);
  $('#mc-send').disabled = used > size;
  $('#mc-note').textContent = state.mc.dirty ? 'Modifié, pas encore envoyé' : '';

  // Étapes de la macro choisie
  const m = list[sel];
  $('#mc-title').textContent = `Macro ${sel + 1}`;
  $('#mc-count').textContent = `${m.steps.length} étape${m.steps.length > 1 ? 's' : ''}`;
  const steps = $('#mc-steps');
  steps.innerHTML = '';
  if (!m.steps.length && !m.tail.length) {
    const li = document.createElement('li');
    li.className = 'step empty';
    li.textContent = 'Aucune étape. Choisissez une touche ci-dessous.';
    steps.appendChild(li);
  }
  m.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step';
    const n = document.createElement('span');
    n.className = 'step-n note';
    n.textContent = String(i + 1);
    const key = document.createElement('span');
    key.className = 'step-key';
    key.textContent = stepLabel(s);
    const delay = document.createElement('input');
    delay.type = 'number';
    delay.min = '0'; delay.max = '9999'; delay.step = '1';
    delay.value = String(s.delay);
    delay.setAttribute('aria-label', `Délai après l'étape ${i + 1}, en ms`);
    delay.onchange = () => {
      const v = clampDelay(delay.value);
      if (v === null) return renderMacros();
      mcEdit((all) => { all[sel].steps[i].delay = v; });
    };
    const ms = document.createElement('span');
    ms.className = 'note';
    ms.textContent = 'ms';
    const tools = document.createElement('span');
    tools.className = 'step-tools';
    tools.append(
      macroTool(ICON_UP, `Monter l'étape ${i + 1}`, i === 0, () => mcEdit((all) => { const a = all[sel].steps; [a[i - 1], a[i]] = [a[i], a[i - 1]]; })),
      macroTool(ICON_DOWN, `Descendre l'étape ${i + 1}`, i === m.steps.length - 1, () => mcEdit((all) => { const a = all[sel].steps; [a[i + 1], a[i]] = [a[i], a[i + 1]]; })),
      macroTool(ICON_REMOVE, `Supprimer l'étape ${i + 1}`, false, () => mcEdit((all) => { all[sel].steps.splice(i, 1); })),
    );
    li.append(n, key, delay, ms, tools);
    steps.appendChild(li);
  });
  if (m.tail.length) {
    const li = document.createElement('li');
    li.className = 'step na';
    li.textContent = `Séquence non éditable : ${m.tail.length} octets, conservés en fin de macro.`;
    steps.appendChild(li);
  }

  $$('#mc-mods button').forEach((b) => b.setAttribute('aria-pressed', String(!!(state.mc.mods & +b.dataset.mod))));
  renderMacroKeys();
}

/** Choix de la touche d'une étape : mêmes listes que la réaffectation (touches du clavier, autres touches). */
function renderMacroKeys() {
  const box = $('#mc-keys');
  const search = $('#mc-search').value.trim().toLowerCase();
  const groups = [
    ['Touches du clavier', [...hidLabels()]],
    ['Autres touches', EXTRA_KEYS],
  ];
  box.innerHTML = '';
  for (const [title, items] of groups) {
    const shown = items.filter(([, l]) => !search || l.toLowerCase().includes(search));
    if (!shown.length) continue;
    const h = document.createElement('h3');
    h.textContent = title;
    box.appendChild(h);
    const list = document.createElement('div');
    list.className = 'list';
    for (const [usage, label] of shown) {
      const c = document.createElement('button');
      c.type = 'button';
      c.className = 'chip';
      c.textContent = label;
      c.onclick = () => {
        const mods = state.mc.mods;
        state.mc.mods = 0;
        mcEdit((all) => { all[state.mc.sel].steps.push({ mods, key: usage, delay: 0 }); });
      };
      list.appendChild(c);
    }
    box.appendChild(list);
  }
}

// ------------------------------------------------------------ système

function initSystem() {
  const sel = $('#sys-layout');
  sel.innerHTML = Object.values(LAYOUTS).map((l) => `<option value="${l.id}">${l.name}</option>`).join('');
  sel.value = state.layoutId;
  sel.onchange = () => {
    state.layoutId = sel.value; store.set('layout', sel.value);
    initPerKey(); initKeymap(); renderKeymap(); renderPicker();
  };
  $('#sys-refresh').onclick = (e) => run(e.currentTarget, loadInfo);
  $('#sys-log-on').onchange = (e) => { state.logOn = e.target.checked; $('#sys-log').classList.toggle('hidden', !state.logOn); };
  $('#sys-log-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(state.log.join('\n')); toast(`${state.log.length} lignes copiées`); }
    catch { toast('Copie refusée par le navigateur', true); }
  };
  $('#sys-export').onclick = () => {
    const data = { app: 'ak820-studio', version: 1, light: state.light, perKey: state.pk, perKeyBrightness: state.pkBrightness, layout: state.layoutId, keymap: state.km.draft };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = 'ak820-reglages.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#sys-import').onchange = async (e) => {
    try {
      const d = JSON.parse(await e.target.files[0].text());
      if (d.app !== 'ak820-studio') throw new Error('fichier inconnu');
      if (d.light) { state.light = d.light; store.set('light', d.light); }
      if (d.perKey && d.perKey.length === 128) { state.pk = d.perKey; store.set('perkey', d.perKey); }
      if (d.perKeyBrightness) state.pkBrightness = d.perKeyBrightness;
      if (d.keymap && state.km.device.base) for (const L of ['base', 'fn']) if (d.keymap[L]) state.km.draft[L] = d.keymap[L];
      initLighting(); paintPerKey(); renderKeymap();
      toast('Réglages importés. Envoyez-les au clavier depuis chaque section.');
    } catch (err) { toast('Import impossible : ' + err.message, true); }
    e.target.value = '';
  };
}

async function loadInfo() {
  const kb = state.kb;
  const info = await kb.info().catch((e) => ({ error: e.message }));
  state.info = info;
  const rows = [['Modèle', kb.name], ['Identifiant USB', `${VENDOR_ID.toString(16).padStart(4, '0')}:${kb.pid.toString(16).padStart(4, '0')}`],
    ['Firmware', kb.family === FAMILY_Q ? `QMK Cadran${info.firmware ? ' (' + info.firmware + ')' : ''}` : kb.family === FAMILY_A ? `famille A (0xFF68)${info.firmware ? ', version ' + info.firmware : ''}` : 'famille B (0xFF13)']];
  if (info.error) rows.push(['Lecture', info.error]);
  if (info.batteryLevel !== undefined && info.batteryLevel !== null) rows.push(['Batterie', `${info.batteryLevel} %${info.chargeStatus ? ', en charge' : ''}`]);
  else if (isQ()) rows.push(['Batterie', 'inconnue (connecté par câble)']);
  else if (info.wiredFull) rows.push(['Batterie', 'pleine ou alimenté par câble']);
  rows.push(['Écran', isQ() ? 'horloge et menu de la molette' : kb.tft ? 'accessible' : 'interface non autorisée']);
  if (info.tftMaxFrames) rows.push(['Images par animation', String(info.tftMaxFrames)]);
  $('#sys-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');

  const opts = kb.caps.sleep;
  const cur = await kb.getSleep().catch(() => null);
  seg($('#sys-sleep'), opts, cur ?? -1, (v) => run(null, () => kb.setSleep(v), 'Mise en veille réglée'));
}

/** Page Écran (firmware Cadran 1.2 et plus) : une vignette par interface. */
async function loadScreenThemes() {
  const kb = state.kb;
  const list = kb.caps.screenThemes || [];
  $('#screen-theme-field').classList.toggle('hidden', !list.length);
  $('#screen-theme-old').classList.toggle('hidden', !(isQ() && !list.length));
  if (!list.length) return;
  const cur = await kb.getScreenTheme().catch(() => null);
  const box = $('#screen-themes');
  box.innerHTML = '';
  for (const t of list) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(t.value === cur));
    const src = SCREEN_PREVIEWS[t.label.toLowerCase()];
    const pic = document.createElement(src ? 'img' : 'span');
    if (src) Object.assign(pic, { src, alt: '', width: 128, height: 128 });
    else pic.className = 'theme-blank';
    const name = document.createElement('span');
    name.textContent = t.label;
    b.append(pic, name);
    b.onclick = () => run(null, async () => {
      await kb.setScreenTheme(t.value);
      $$('.theme', box).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }, `Interface ${t.label} sur l'écran`);
    box.appendChild(b);
  }
}

function logLine(s) {
  state.log.push(s);
  if (state.log.length > 2000) state.log.shift();
  if (state.logOn) {
    const el = $('#sys-log');
    el.textContent = state.log.slice(-300).join('\n');
    el.scrollTop = el.scrollHeight;
  }
}
function hexLog(dir, bytes, ep) {
  const n = dir.startsWith('tx') ? 24 : 24;
  const hex = Array.from(bytes.slice(0, n), (b) => b.toString(16).padStart(2, '0')).join(' ');
  const t = new Date().toLocaleTimeString('fr-FR', { hour12: false }) + '.' + String(Date.now() % 1000).padStart(3, '0');
  logLine(`${t} ${ep || ''} ${dir.padEnd(3)} [${bytes.length}] ${hex}${bytes.length > n ? ' …' : ''}`);
}

// ------------------------------------------------------------ connexion

const FILTERS = [...CONTROL_USAGE_PAGES.slice(0, 1), PAGE_TFT_A, PAGE_FEATURE, PAGE_RAW].map((usagePage) => ({ vendorId: VENDOR_ID, usagePage }));

async function grantedDevices() {
  if (state.demo) return null;
  return (await navigator.hid.getDevices()).filter((d) => d.vendorId === VENDOR_ID);
}

async function connect(devices) {
  const cls = classify(devices);
  if (cls.error) { toast(cls.error, true); return false; }
  if (state.kb) await state.kb.close();
  const kb = new Keyboard(cls, (dir, bytes, ep) => hexLog(dir, bytes, ep));
  try { await kb.open(); }
  catch (e) {
    await kb.close();
    if (cls.family === FAMILY_Q) toast(e.message, true);
    else toast('Le clavier refuse la connexion : fermez le logiciel Ajazz ou un autre onglet qui l\'utilise. (' + e.message + ')', true);
    return false;
  }
  state.kb = kb;
  keyTest(false);
  state.km = { layer: state.km.layer, device: {}, draft: {}, factory: {}, selected: null, testing: false };
  state.mc = { loaded: false, list: [], sel: 0, mods: 0, dirty: false };
  onConnected();
  return true;
}

async function onConnected() {
  const kb = state.kb;
  const st = $('#status');
  st.classList.add('on');
  $('span', st).textContent = `${kb.name}${state.demo ? ' (démo)' : ''}`;
  $('#connect span').textContent = 'Changer';
  $$('#nav button').forEach((b) => (b.disabled = false));
  $('#keymap-unsupported').classList.toggle('hidden', kb.caps.keymapRead);
  $('#keymap-body').classList.toggle('hidden', !kb.caps.keymap);
  $('#tft-factory').classList.toggle('hidden', !kb.caps.tftBuiltIn);
  $('#pk-read').classList.toggle('hidden', !kb.caps.perKeyRead);
  $('#screen-upload').classList.toggle('hidden', !kb.caps.tftUpload);
  $('#screen-q').classList.toggle('hidden', kb.caps.tftUpload);
  $('#km-test-row').classList.toggle('hidden', !kb.caps.matrixTest);
  bindLayers();
  if (isQ()) state.light = { ...state.light, ...store.get('lightQ', {}) };
  initLighting();
  $('#pk-iso-note').classList.toggle('hidden', kb.family === FAMILY_A || state.layoutId === 'ansi');
  const banner = $('#banner');
  banner.innerHTML = '';
  if (state.demo) banner.innerHTML = `<div class="banner">${ICON_INFO}<span>Mode démo : un faux clavier (${kb.family === FAMILY_Q ? 'firmware Cadran' : 'famille ' + kb.family}) répond aux commandes. <a href="?">Quitter la démo</a></span></div>`;
  else if (!kb.tft && kb.caps.tftUpload) {
    banner.innerHTML = `<div class="banner warn">${ICON_INFO}<span>L'interface de l'écran n'a pas été autorisée. <button class="btn" id="grant-tft" style="margin-left:8px">Autoriser l'écran</button></span></div>`;
    $('#grant-tft').onclick = async () => {
      const extra = await navigator.hid.requestDevice({ filters: [PAGE_TFT_A, PAGE_TFT_B].map((usagePage) => ({ vendorId: VENDOR_ID, usagePage })) });
      if (extra.length) await connect([...(await grantedDevices()), ...extra]);
    };
  }
  show(state.view);
  refreshLightingUi();
  paintPerKey();
  if (state.tft.encoded.length) $('#tft-send').disabled = false;
  await loadInfo();
  await loadScreenThemes();
  const cur = await kb.getLighting().catch(() => null);
  if (cur && kb.caps.modes.some((m) => m.id === cur.mode)) { state.light = { ...state.light, ...cur }; store.set(lightKey(), state.light); initLighting(); }
  if (kb.caps.perKeyRead && isQ()) { const pk = await kb.getPerKey().catch(() => null); if (pk) { state.pk = pk; store.set('perkey', pk); paintPerKey(); } }
}

function onDisconnected() {
  state.kb = null;
  const st = $('#status');
  st.classList.remove('on');
  $('span', st).textContent = 'Non connecté';
  $('#connect span').textContent = 'Connecter';
  $('#tft-send').disabled = true;
  show('welcome');
}

async function requestConnect() {
  if (state.demo) return;
  if (!('hid' in navigator)) { toast('Ce navigateur ne permet pas l\'accès USB : utilisez Chrome ou Edge.', true); return; }
  try {
    const picked = await navigator.hid.requestDevice({ filters: FILTERS });
    if (!picked.length) return;
    // Le sélecteur peut ne rendre qu'une interface : on y ajoute les autres déjà autorisées.
    const all = await grantedDevices();
    const same = all.filter((d) => d.productId === picked[0].productId);
    await connect([...new Set([...picked, ...same])]);
  } catch (e) { toast(e.message, true); }
}

// ------------------------------------------------------------ démarrage

function boot() {
  initLighting();
  initPerKey();
  initScreen();
  initKeymap();
  initMacros();
  initSystem();
  $('#connect').onclick = requestConnect;
  $('#welcome-connect').onclick = requestConnect;
  $$('#nav button').forEach((b) => (b.disabled = true));

  if (state.demo) {
    const devs = state.demo === 'b' ? mockFamilyB().devices
      : state.demo === 'q' ? mockFamilyQ(LAYOUTS.ansi.keys.map((k) => [k.slot, k.hid])).devices
      : mockFamilyA(LAYOUTS['iso-fr'].keys.map((k) => [k.slot, k.hid])).devices;
    connect(devs);
    return;
  }
  show('welcome');
  if (!('hid' in navigator)) {
    const n = $('#no-webhid');
    n.classList.remove('hidden');
    n.textContent = window.isSecureContext
      ? 'Ce navigateur ne gère pas l\'USB (WebHID). Ouvrez cette page dans Chrome ou Edge sur ordinateur.'
      : 'Accès USB indisponible sur une adresse http:// du réseau. Ouvrez le fichier téléchargé (ak820-studio.html) directement dans Chrome ou Edge, ou une adresse https://.';
    $('#welcome-connect').disabled = true;
    $('#connect').disabled = true;
    return;
  }
  navigator.hid.addEventListener('disconnect', (e) => {
    if (state.kb && (e.device === state.kb.control.device || (state.kb.tft && e.device === state.kb.tft.device))) {
      onDisconnected();
      toast('Clavier débranché');
    }
  });
  navigator.hid.addEventListener('connect', async () => { if (!state.kb) tryAuto(); });
  tryAuto();
}

async function tryAuto() {
  const devs = await grantedDevices();
  if (devs && devs.length && classify(devs).family) connect(devs);
}

boot();
