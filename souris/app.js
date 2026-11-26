import * as P from './protocol.js';

const $ = (s) => document.querySelector(s);
const ICON_INFO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>';
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(' ');

const state = { dev: null, demo: new URLSearchParams(location.search).has('demo'), settings: null, keys: null, info: null, battery: null };

// ---------- journal

const logLines = [];
function log(msg) {
  const t = new Date().toLocaleTimeString('fr-FR');
  logLines.push(`${t}  ${msg}`);
  if (logLines.length > 200) logLines.shift();
  const el = $('#log');
  el.textContent = logLines.join('\n');
  el.scrollTop = el.scrollHeight;
}

// ---------- transport WebHID

class HidLink {
  constructor(device) {
    this.device = device;
    this.waiters = [];
    this.queue = Promise.resolve();
    device.addEventListener('inputreport', (e) => {
      const r = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength);
      const w = this.waiters.findIndex((x) => P.isReply(r, x.cmd));
      if (w >= 0) this.waiters.splice(w, 1)[0].resolve(Uint8Array.from(r));
    });
  }

  // Une commande à la fois ; jusqu'à 3 essais (la souris sans fil peut dormir).
  send(f) {
    const run = async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const reply = new Promise((resolve, reject) => {
          const w = { cmd: f[1], resolve };
          this.waiters.push(w);
          setTimeout(() => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) { this.waiters.splice(i, 1); reject(new Error('pas de réponse')); }
          }, 700);
        });
        await this.device.sendReport(0, f);
        log(`→ ${hex(f.slice(0, 16))}`);
        try {
          const r = await reply;
          log(`← ${hex(r.slice(0, 16))}`);
          return r;
        } catch {
          log(`  pas de réponse (essai ${attempt + 1}/3)`);
        }
      }
      throw new Error('La souris ne répond pas. Bouge-la pour la réveiller, puis réessaie.');
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

// Fausse souris pour ?demo : répond avec les trames relevées sur la vraie le 26/11/2026.
class DemoLink {
  constructor() {
    const pad = (s) => { const d = new Uint8Array(64); d.set(s.split(' ').map((x) => parseInt(x, 16))); return d; };
    this.mem = {
      [P.CMD.INFO]: pad('AA 03 00 2A 38 00 00 00 59 4A 58 2E 63 6F 2E 6D 6F 75 73 65 32 37 31 32 32 30 4E 6F 76 20 31 32 20 32 30 32 35 31 38 3A 34 39 3A 32 37 46 65 62 20 32 30 20 32 30 32 34 32 30 3A 31 38 3A 31 39'),
      [P.CMD.SETTINGS_READ]: pad('AA 0E A5 BD 2F 00 00 00 00 06 04 06 03 90 01 20 03 B0 04 40 06 60 09 C6 5C 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 FF 01 0A 03 FF 36 00'),
      [P.CMD.KEYS_READ]: pad('AA 08 A5 07 20 00 00 00 20 01 00 00 20 02 00 00 20 04 00 00 20 08 00 00 20 10 00 00 21 55 00 00 21 38 01 00 21 38 FF 00'),
      [P.CMD.BATTERY]: pad('AA 30 A5 2E 0A 00 00 00 36 00'),
    };
  }
  async send(f) {
    await new Promise((r) => setTimeout(r, 40));
    log(`→ ${hex(f.slice(0, 16))}`);
    const cmd = f[1];
    let r;
    if (cmd === P.CMD.SETTINGS_WRITE || cmd === P.CMD.KEYS_WRITE) {
      const target = cmd === P.CMD.SETTINGS_WRITE ? P.CMD.SETTINGS_READ : P.CMD.KEYS_READ;
      const m = Uint8Array.from(f); m[0] = 0xaa; m[1] = target;
      if (target === P.CMD.SETTINGS_READ) m[54] = 0x36;
      this.mem[target] = m;
      r = Uint8Array.from(f); r[0] = 0xaa;
    } else {
      r = this.mem[cmd] || Uint8Array.from(f).fill(0, 8);
      r[0] = 0xaa;
    }
    log(`← ${hex(r.slice(0, 16))}`);
    return Uint8Array.from(r);
  }
}

// ---------- connexion

async function connect() {
  if (state.demo) return start(new DemoLink(), 'Souris de démonstration');
  if (!('hid' in navigator)) return banner('Ce navigateur ne gère pas WebHID. Ouvre la page dans Chrome ou Edge sur ordinateur.', true);
  let devices = (await navigator.hid.getDevices()).filter(isOurs);
  if (!devices.length) {
    try { devices = await navigator.hid.requestDevice({ filters: P.USB_FILTERS }); } catch { return; }
  }
  const device = devices.find(isOurs);
  if (!device) return;
  try {
    if (!device.opened) await device.open();
  } catch (e) {
    return banner(`Impossible d'ouvrir la souris (${e.message}). Ferme le logiciel Ajazz s'il est ouvert, puis réessaie.`, true);
  }
  state.dev = device;
  start(new HidLink(device), device.vendorId === 0xa8a4 ? 'AJ139 V2 MC · câble' : 'AJ139 V2 MC · 2,4 GHz');
}

function isOurs(d) {
  return d.collections.some((c) => c.usagePage === 0xff01) && P.USB_FILTERS.some((f) => f.vendorId === d.vendorId && f.productId === d.productId);
}

let link = null;
let linkName = '';

async function start(l, name) {
  link = l;
  linkName = name;
  log(`Connectée : ${name}`);
  try {
    await readAll();
    banner(state.demo ? `Mode démo : une fausse souris répond aux commandes. <a href="?">Quitter la démo</a>` : '');
  } catch (e) {
    banner(e.message, true);
  }
  if (!state.batteryTimer) state.batteryTimer = setInterval(refreshBattery, 60000);
}

async function readAll() {
  state.info = P.parseInfo(await link.send(P.readInfo()));
  state.battery = P.parseBattery(await link.send(P.readBattery()));
  state.settings = P.parseSettings(await link.send(P.readSettings()));
  state.keys = P.parseKeys(await link.send(P.readKeys()));
  render();
}

async function refreshBattery() {
  if (!link) return;
  try {
    state.battery = P.parseBattery(await link.send(P.readBattery()));
    renderStatus();
    renderInfo();
  } catch { /* souris endormie : on réessaiera */ }
}

// ---------- enregistrement

let saveTimer = null;
function saveSettings(delay = 350) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const r = await link.send(P.writeSettings(state.settings));
      if (!P.isReply(r, P.CMD.SETTINGS_WRITE)) throw new Error('réponse inattendue');
      const back = P.parseSettings(await link.send(P.readSettings()));
      const same = back.dpi.every((v, i) => v === P.clampDpi(state.settings.dpi[i])) && back.rate === state.settings.rate && back.sensor === state.settings.sensor;
      state.settings = back;
      render();
      flash(same ? 'Enregistré dans la souris' : 'La souris a corrigé certaines valeurs');
    } catch (e) {
      banner(`Échec de l'enregistrement : ${e.message}`, true);
    }
  }, delay);
}

async function saveKeys() {
  try {
    await link.send(P.writeKeys(state.keys));
    state.keys = P.parseKeys(await link.send(P.readKeys()));
    renderButtons();
    flash('Boutons enregistrés');
  } catch (e) {
    banner(`Échec de l'enregistrement : ${e.message}`, true);
  }
}

// ---------- rendu

function render() {
  renderStatus();
  renderLevels();
  renderRate();
  renderSensor();
  renderButtons();
  renderSettings();
  renderInfo();
}

const BATTERY_SVG = (lvl, charging) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2"/>${charging ? '<path d="m11 8-3 4h4l-3 4"/>' : `<rect x="4.5" y="9.5" width="${Math.max(1, Math.round(12 * lvl / 100))}" height="5" rx="1" fill="currentColor" stroke="none"/>`}</svg>`;

function renderStatus() {
  const st = $('#status');
  st.classList.toggle('on', !!link);
  const b = state.battery;
  st.innerHTML = `<i class="dot"></i><span>${link ? linkName : 'Non connectée'}</span>` + (b ? `<span class="battery">${BATTERY_SVG(b.level, b.charging)}${b.level} %</span>` : '');
  $('#connect').style.display = link ? 'none' : '';
}

function renderLevels() {
  const s = state.settings;
  const box = $('#levels');
  box.innerHTML = '';
  s.dpi.forEach((v, i) => {
    const row = document.createElement('div');
    row.className = 'level' + (i === s.dpiIndex ? ' active' : '');
    const c = s.colors[i];
    const col = '#' + c.map((x) => x.toString(16).padStart(2, '0')).join('');
    const unset = c.every((x) => x === 0); // 000000 = couleur d'origine du firmware
    row.innerHTML = `<button class="pick" aria-label="Utiliser le palier ${i + 1}" aria-pressed="${i === s.dpiIndex}"><i></i></button>
      <span class="n">Palier ${i + 1}</span>
      <input type="range" min="${P.DPI_MIN}" max="${P.DPI_MAX}" step="50" value="${v}" aria-label="DPI du palier ${i + 1}">
      <div class="dpi-val"><span class="led${unset ? ' unset' : ''}" style="${unset ? '' : 'background:' + col}" title="${unset ? 'Couleur d\'origine' : col}"><input type="color" value="${unset ? '#ffffff' : col}" aria-label="Couleur du témoin, palier ${i + 1}"></span><input type="number" min="${P.DPI_MIN}" max="${P.DPI_MAX}" step="50" value="${v}" aria-label="DPI du palier ${i + 1}"></div>`;
    const [range, num] = row.querySelectorAll('input[type=range], input[type=number]');
    range.addEventListener('input', () => { num.value = range.value; });
    range.addEventListener('change', () => { s.dpi[i] = P.clampDpi(+range.value); saveSettings(); });
    num.addEventListener('change', () => { s.dpi[i] = P.clampDpi(+num.value); num.value = s.dpi[i]; range.value = s.dpi[i]; saveSettings(); });
    row.querySelector('.pick').addEventListener('click', () => {
      s.dpiIndex = i;
      box.querySelectorAll('.level').forEach((el, j) => { el.classList.toggle('active', j === i); el.querySelector('.pick').setAttribute('aria-pressed', j === i); });
      saveSettings(0);
    });
    const color = row.querySelector('input[type=color]');
    color.addEventListener('input', () => { color.parentElement.classList.remove('unset'); color.parentElement.style.background = color.value; });
    color.addEventListener('change', () => {
      const h = color.value.slice(1);
      s.colors[i] = [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16));
      saveSettings();
    });
    box.appendChild(row);
  });
}

function seg(el, options, current, onPick) {
  el.innerHTML = '';
  options.forEach(([label, value]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('aria-pressed', value === current);
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
      onPick(value);
    });
    el.appendChild(b);
  });
}

function renderRate() {
  const s = state.settings;
  seg($('#rate'), P.RATES.map((r, i) => [r >= 1000 ? `${r / 1000} k` : String(r), i]), s.rate, (v) => { s.rate = v; saveSettings(0); });
  $('#rate').querySelectorAll('button').forEach((b, i) => { b.title = `${P.RATES[i]} Hz`; });
}

function renderSensor() {
  const s = state.settings;
  seg($('#lod'), [['1 mm', 1], ['2 mm', 2]], s.lod, (v) => { s.lod = v; saveSettings(0); });
  const bind = (id, bit) => {
    const el = $(id);
    el.checked = !!(s.sensor & bit);
    el.onchange = () => { s.sensor = el.checked ? s.sensor | bit : s.sensor & ~bit; saveSettings(0); };
  };
  bind('#motion-sync', P.SENSOR.MOTION_SYNC);
  bind('#angle-snap', P.SENSOR.ANGLE_SNAP);
  bind('#ripple', P.SENSOR.RIPPLE);
}

function renderSettings() {
  const s = state.settings;
  const deb = $('#debounce');
  deb.value = s.debounce;
  $('#debounce-v').textContent = `${s.debounce} ms`;
  deb.oninput = () => { $('#debounce-v').textContent = `${deb.value} ms`; };
  deb.onchange = () => { s.debounce = +deb.value; saveSettings(); };
  seg($('#sleep'), P.SLEEP_MIN.map((m, i) => [m === 60 ? '1 h' : `${m} min`, i]), s.sleep, (v) => { s.sleep = v; saveSettings(0); });
  const sw = (id, key) => { const el = $(id); el.checked = !!s[key]; el.onchange = () => { s[key] = el.checked; saveSettings(0); }; };
  sw('#esports', 'esports');
  sw('#wake', 'wakeOnMove');
  sw('#scroll', 'scrollReverse');
  const light = $('#light');
  light.innerHTML = P.LIGHT_MODES.map((m, i) => `<option value="${i}">${m}</option>`).join('');
  light.value = s.lightMode;
  light.onchange = () => { s.lightMode = +light.value; saveSettings(0); };
}

function renderButtons() {
  const box = $('#buttons');
  box.innerHTML = '';
  P.SLOTS.forEach((slot, i) => {
    if (slot.hidden) return;
    const code = state.keys[i];
    const row = document.createElement('div');
    row.className = 'bt';
    const origin = P.describe(P.DEFAULT_KEYS[i]);
    row.innerHTML = `<div class="name">${slot.name}<small>${P.sameCode(code, P.DEFAULT_KEYS[i]) ? 'd\'origine' : 'origine : ' + origin}</small></div><div></div>`;
    const cell = row.lastElementChild;
    if (slot.locked) {
      cell.innerHTML = '<span class="note">Clic gauche (verrouillé)</span>';
    } else {
      const sel = document.createElement('select');
      sel.setAttribute('aria-label', `Fonction : ${slot.name}`);
      let found = false;
      for (const g of P.ACTIONS) {
        const og = document.createElement('optgroup');
        og.label = g.group;
        for (const [label, c] of g.items) {
          const o = new Option(label, c.join(','));
          if (P.sameCode(c, code)) { o.selected = true; found = true; }
          og.appendChild(o);
        }
        sel.appendChild(og);
      }
      const kb = new Option('Touche du clavier…', 'kbd');
      sel.appendChild(kb);
      if (!found) {
        const o = new Option(P.describe(code), code.join(','));
        o.selected = true;
        sel.insertBefore(o, sel.firstChild);
      }
      sel.addEventListener('change', () => {
        if (sel.value === 'kbd') return capture(cell, i);
        state.keys[i] = sel.value.split(',').map(Number);
        saveKeys();
      });
      cell.appendChild(sel);
    }
    box.appendChild(row);
  });
}

function capture(cell, i) {
  const btn = document.createElement('button');
  btn.className = 'capture';
  btn.textContent = 'Appuie sur la touche ou le raccourci…';
  cell.appendChild(btn);
  btn.focus();
  const onKey = (e) => {
    if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) return;
    e.preventDefault();
    const h = P.hidFromCode(e.code);
    if (!h) { btn.textContent = `Touche non gérée (${e.code}), essaie une autre`; return; }
    const mods = (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0) | (e.metaKey ? 8 : 0);
    btn.removeEventListener('keydown', onKey);
    state.keys[i] = [0x10, mods, h, 0];
    saveKeys();
  };
  btn.addEventListener('keydown', onKey);
  btn.addEventListener('blur', () => setTimeout(renderButtons, 150));
}

function renderInfo() {
  const i = state.info || {};
  const b = state.battery;
  const rows = [
    ['Modèle', 'Ajazz AJ139 V2 MC'],
    ['Connexion', linkName],
    ['Batterie', b ? `${b.level} %${b.charging ? ', en charge' : ''}` : '–'],
    ['Firmware', i.model ? `${i.vendor} ${i.model}, version ${i.version}` : i.raw || '–'],
    ['Compilé (souris)', i.mouseBuild || '–'],
    ['Compilé (récepteur)', i.dongleBuild || '–'],
  ];
  $('#info').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function banner(html, warn = false) {
  $('#banner').innerHTML = html ? `<div class="banner${warn ? ' warn' : ''}">${ICON_INFO}<span>${html}</span></div>` : '';
}

let flashTimer = null;
function flash(msg) {
  banner(msg);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => banner(state.demo ? `Mode démo : une fausse souris répond aux commandes. <a href="?">Quitter la démo</a>` : ''), 1800);
}

// ---------- navigation et démarrage

function showView(name) {
  const b = document.querySelector(`#nav button[data-view="${name}"]`);
  if (!b) return;
  document.querySelectorAll('#nav button').forEach((x) => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  document.querySelectorAll('section.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  history.replaceState(null, '', '#' + name);
}
$('#nav').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) showView(b.dataset.view);
});
const startView = new URLSearchParams(location.search).get('vue') || location.hash.slice(1);
if (startView) showView(startView);

$('#connect').addEventListener('click', connect);
$('#reload').addEventListener('click', () => link && readAll().then(() => flash('Réglages relus')).catch((e) => banner(e.message, true)));
$('#keys-reset').addEventListener('click', () => { if (!link) return; state.keys = P.DEFAULT_KEYS.map((k) => k.slice()); saveKeys(); });
$('#export').addEventListener('click', () => {
  if (!state.settings) return;
  const data = { exported: new Date().toISOString(), info: state.info, settings: { ...state.settings, raw: hex(state.settings.raw) }, keys: state.keys.map(hex) };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  a.download = 'aj139-reglages.json';
  a.click();
});

if ('hid' in navigator) {
  navigator.hid.addEventListener('disconnect', (e) => {
    if (e.device === state.dev) { link = null; state.dev = null; state.battery = null; renderStatus(); banner('Souris déconnectée.', true); }
  });
}

renderStatus();
if (state.demo) connect();
else if (!('hid' in navigator)) banner('Ce navigateur ne gère pas WebHID. Ouvre la page dans Chrome ou Edge sur ordinateur.', true);
else {
  banner('Branche le récepteur 2,4 GHz (ou le câble), puis clique sur Connecter.');
  navigator.hid.getDevices().then((d) => { if (d.some(isOurs)) connect(); });
}
