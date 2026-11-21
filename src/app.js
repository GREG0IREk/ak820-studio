// Interface d'AK820 Studio.
import {
  VENDOR_ID, PAGE_FEATURE, PAGE_TFT_A, PAGE_TFT_B, CONTROL_USAGE_PAGES, FAMILY_A,
  MODES, supportedDirections, classify, Keyboard, TFT_SIZE, LEGACY_MAX_FRAMES, parseHex,
} from './protocol.js';
import { LAYOUTS } from './layouts.js';
import { EXTRA_KEYS, CONSUMER, MOUSE, actionLabel, sameAction } from './keycodes.js';
import { decodeFile, renderFrame, toPixels } from './image.js';
import { mockFamilyA, mockFamilyB } from './mock.js';

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
    hex.textContent = v.toUpperCase();
    input.value = v;
  };
  for (const c of palette) {
    const s = document.createElement('button');
    s.type = 'button';
    s.className = 'swatch';
    s.style.background = c;
    s.dataset.c = c;
    s.title = c;
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
  km: { layer: 'base', device: { base: null, fn: null }, draft: { base: null, fn: null }, selected: null },
  logOn: false,
  log: [],
};
const layout = () => LAYOUTS[state.layoutId] || LAYOUTS['iso-fr'];
if (!state.pk || state.pk.length !== 128) state.pk = Array.from({ length: 128 }, () => [0, 0, 0]);

// ------------------------------------------------------------ navigation

function show(view) {
  if (!state.kb && view !== 'welcome') view = 'welcome';
  $$('section.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + view));
  $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.view === view ? 'page' : 'false'));
  if (view !== 'welcome') { state.view = view; store.set('view', view); }
  if (view === 'keymap') ensureKeymap();
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
    d.className = 'key' + (k.iso ? ' iso' : '');
    d.style.left = (k.x / W) * 100 + '%';
    d.style.top = (k.y / H) * 100 + '%';
    d.style.width = (k.w / W) * 100 + '%';
    d.style.height = (k.h / H) * 100 + '%';
    d.dataset.slot = k.slot;
    d.innerHTML = '<span></span>';
    container.appendChild(d);
    els.set(k.slot, d);
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
  for (const m of MODES) {
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
    previews.push({ mode: m.key, ctx: c.getContext('2d') });
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
  const dirs = supportedDirections(L.mode);
  const labels = { left: 'Gauche', right: 'Droite', up: 'Haut', down: 'Bas' };
  if (dirs.length && !dirs.includes(L.direction)) L.direction = dirs[0];
  seg($('#light-direction'), dirs.map((d) => ({ value: d, label: labels[d] })), L.direction, (v) => { L.direction = v; lightingChanged(); });
  $('#dir-reveal').classList.toggle('open', dirs.length > 0);
  $$('#light-speed button').forEach((b) => (b.disabled = L.mode <= 1)); // Éteint, Fixe : pas d'animation
  const live = state.kb && state.kb.caps.liveLighting;
  $('#light-apply-row').classList.toggle('hidden', !!live);
  $('#lighting-lead').textContent = live
    ? 'Effet appliqué à tout le clavier. Chaque changement est envoyé aussitôt.'
    : 'Effet appliqué à tout le clavier. Ce firmware enregistre chaque envoi dans sa mémoire flash : réglez, puis appliquez.';
}

let lightTimer;
function lightingChanged() {
  store.set('light', state.light);
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
          const c = effectColor(p.mode, x / 15, y / 3, t, base, !!state.light.colorMode).map((v) => Math.round(v * (0.25 + 0.75 * k)));
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
  const b = state.kb && state.kb.family !== FAMILY_A;
  for (const k of layout().keys) {
    const el = pkEls.get(k.slot);
    const c = state.pk[k.slot] || [0, 0, 0];
    const span = el.firstChild;
    span.textContent = k.label;
    const off = c[0] + c[1] + c[2] === 0;
    span.style.background = off ? '' : rgbToHex(c);
    span.style.color = off ? '' : lum(c) > 140 ? '#111' : '#fff';
    span.style.borderColor = off ? '' : 'transparent';
    el.classList.toggle('na', b && k.slot === 98);
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
  $('#tft-clock').onclick = (e) => run(e.currentTarget, () => state.kb.syncClock(new Date()), 'Horloge réglée sur ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
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
  for (const k of layout().keys) if (k.label && !m.has(k.hid)) m.set(k.hid, k.label.replace(/\n/g, ' '));
  m.set(44, 'Espace');
  return m;
}
function initKeymap() {
  kmEls = buildKb($('#km-kb'), (slot) => { state.km.selected = slot; renderKeymap(); renderPicker(); });
  segBind($('#km-layer'), state.km.layer, (v) => { state.km.layer = v; state.km.selected = null; ensureKeymap(); renderKeymap(); renderPicker(); });
  $('#km-search').oninput = renderPicker;
  $('#km-revert').onclick = () => { const L = state.km.layer; state.km.draft[L] = state.km.device[L].map((a) => ({ ...a })); renderKeymap(); renderPicker(); };
  $('#km-factory').onclick = (e) => run(e.currentTarget, async () => {
    state.km.draft[state.km.layer] = await state.kb.getKeymap(state.km.layer, true);
    renderKeymap(); renderPicker();
  }, 'Valeurs d\'usine chargées : vérifiez puis écrivez sur le clavier');
  $('#km-write').onclick = (e) => run(e.currentTarget, async () => {
    const L = state.km.layer;
    await state.kb.setKeymap(L, state.km.draft[L]);
    state.km.device[L] = await state.kb.getKeymap(L);
    state.km.draft[L] = state.km.device[L].map((a) => ({ ...a }));
    renderKeymap();
  }, 'Touches enregistrées sur le clavier');
}
async function ensureKeymap() {
  if (!state.kb || !state.kb.caps.keymap) return;
  const L = state.km.layer;
  if (state.km.device[L]) return renderKeymap();
  await run(null, async () => {
    state.km.device[L] = await state.kb.getKeymap(L);
    state.km.draft[L] = state.km.device[L].map((a) => ({ ...a }));
  });
  renderKeymap();
}
function renderKeymap() {
  if (!kmEls) return;
  const L = state.km.layer, draft = state.km.draft[L], dev = state.km.device[L];
  const labels = hidLabels();
  let changed = 0;
  for (const k of layout().keys) {
    const el = kmEls.get(k.slot);
    const a = draft && draft[k.slot];
    const isDefault = !a || a.kind === 'default' || (a.kind === 'keyboard' && a.usage === k.hid);
    const diff = draft && dev && !sameAction(a, dev[k.slot]);
    if (diff) changed++;
    el.firstChild.textContent = isDefault ? k.label : actionLabel(a, labels);
    el.classList.toggle('mod', !isDefault);
    el.classList.toggle('sel', state.km.selected === k.slot);
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
  $('#km-title').textContent = `Touche « ${key.label || 'Espace'} »${L === 'fn' ? ' avec Fn' : ''}`;
  const q = $('#km-search').value.trim().toLowerCase();
  const cur = state.km.draft[L][slot];
  const labels = hidLabels();
  const groups = [
    ['Origine', [[{ kind: 'keyboard', usage: key.hid }, `${key.label || 'Espace'} (origine)`]]],
    ['Touches du clavier', [...labels].map(([u, l]) => [{ kind: 'keyboard', usage: u }, l])],
    ['Autres touches', EXTRA_KEYS.map(([u, l]) => [{ kind: 'keyboard', usage: u }, l])],
    ['Multimédia', CONSUMER.map(([v, l]) => [{ kind: 'consumer', value: v }, l])],
    ['Souris', MOUSE.map(([b, l]) => [{ kind: 'mouse', button: b, value: 0 }, l])],
  ];
  box.innerHTML = '';
  for (const [title, items] of groups) {
    const shown = items.filter(([, l]) => !q || l.toLowerCase().includes(q));
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
    ['Firmware', kb.family === FAMILY_A ? `famille A (0xFF68)${info.firmware ? ', version ' + info.firmware : ''}` : 'famille B (0xFF13)']];
  if (info.error) rows.push(['Lecture', info.error]);
  if (info.batteryLevel !== undefined && info.batteryLevel !== null) rows.push(['Batterie', `${info.batteryLevel} %${info.chargeStatus ? ', en charge' : ''}`]);
  else if (info.wiredFull) rows.push(['Batterie', 'pleine ou alimenté par câble']);
  rows.push(['Écran', kb.tft ? 'accessible' : 'interface non autorisée']);
  if (info.tftMaxFrames) rows.push(['Images par animation', String(info.tftMaxFrames)]);
  $('#sys-info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${String(v).replace(/</g, '&lt;')}</dd>`).join('');

  const opts = kb.caps.sleep;
  const cur = await kb.getSleep().catch(() => null);
  seg($('#sys-sleep'), opts, cur ?? -1, (v) => run(null, () => kb.setSleep(v), 'Mise en veille réglée'));
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

const FILTERS = [...CONTROL_USAGE_PAGES.slice(0, 1), PAGE_TFT_A, PAGE_FEATURE].map((usagePage) => ({ vendorId: VENDOR_ID, usagePage }));

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
    toast('Le clavier refuse la connexion : fermez le logiciel Ajazz ou un autre onglet qui l\'utilise. (' + e.message + ')', true);
    return false;
  }
  state.kb = kb;
  state.km = { layer: state.km.layer, device: { base: null, fn: null }, draft: { base: null, fn: null }, selected: null };
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
  $('#keymap-unsupported').classList.toggle('hidden', kb.caps.keymap);
  $('#keymap-body').classList.toggle('hidden', !kb.caps.keymap);
  $('#tft-factory').classList.toggle('hidden', !kb.caps.tftBuiltIn);
  $('#pk-read').classList.toggle('hidden', kb.family !== FAMILY_A);
  $('#pk-iso-note').classList.toggle('hidden', kb.family === FAMILY_A || state.layoutId === 'ansi');
  const banner = $('#banner');
  banner.innerHTML = '';
  if (state.demo) banner.innerHTML = `<div class="banner">${ICON_INFO}<span>Mode démo : un faux clavier (famille ${kb.family}) répond aux commandes. <a href="?">Quitter la démo</a></span></div>`;
  else if (!kb.tft) {
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
  const cur = await kb.getLighting();
  if (cur && MODES.some((m) => m.id === cur.mode)) { state.light = { ...state.light, ...cur }; initLighting(); }
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
  initSystem();
  $('#connect').onclick = requestConnect;
  $('#welcome-connect').onclick = requestConnect;
  $$('#nav button').forEach((b) => (b.disabled = true));

  if (state.demo) {
    const devs = state.demo === 'b' ? mockFamilyB().devices : mockFamilyA(LAYOUTS['iso-fr'].keys.map((k) => [k.slot, k.hid])).devices;
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
