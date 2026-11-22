// Disposition physique de l'AK820 Pro (75 %, 81 touches).
// Numéros d'emplacement et codes HID repris de wsclx/ak820pro-modder (MIT),
// src/data/layouts/iso-fr.json et ansi.json. Géométrie en unités de touche (u).

const NAV_X = 15.25;

// [emplacement, libellé, code HID d'usine, largeur u]
// ['at', x, emplacement, libellé, HID] : touche placée à une abscisse donnée, largeur 1 u.
const ISO_FR = [
  [[0, 'Échap', 41], 'gap', [1, 'F1', 58], [2, 'F2', 59], [3, 'F3', 60], [4, 'F4', 61], 'gap', [5, 'F5', 62], [6, 'F6', 63], [7, 'F7', 64], [8, 'F8', 65], 'gap', [9, 'F9', 66], [10, 'F10', 67], [11, 'F11', 68], [12, 'F12', 69], ['at', 14, 106, 'Suppr', 76]],
  [[16, '²', 53], [17, '& 1', 30], [18, 'é 2', 31], [19, '" 3', 32], [20, "' 4", 33], [21, '( 5', 34], [22, '- 6', 35], [23, 'è 7', 36], [24, '_ 8', 37], [25, 'ç 9', 38], [26, 'à 0', 39], [27, ') °', 45], [28, '= +', 46], [92, 'Retour', 42, 2], ['nav', 107, 'Fin', 77]],
  [[32, 'Tab', 43, 1.5], [33, 'A', 20], [34, 'Z', 26], [35, 'E', 8], [36, 'R', 21], [37, 'T', 23], [38, 'Y', 28], [39, 'U', 24], [40, 'I', 12], [41, 'O', 18], [42, 'P', 19], [43, '^ ¨', 47], [44, '$ £', 48], ['isoEnter', 76, 'Entrée', 40], ['nav', 105, 'Pg ↑', 75]],
  [[48, 'Verr Maj', 57, 1.75], [49, 'Q', 4], [50, 'S', 22], [51, 'D', 7], [52, 'F', 9], [53, 'G', 10], [54, 'H', 11], [55, 'J', 13], [56, 'K', 14], [57, 'L', 15], [58, 'M', 51], [59, 'ù %', 52], [97, '* µ', 50], ['nav', 108, 'Pg ↓', 78]],
  [[64, 'Maj', 225, 1.25], [98, '< >', 100], [65, 'W', 29], [66, 'X', 27], [67, 'C', 6], [68, 'V', 25], [69, 'B', 5], [70, 'N', 17], [71, ', ?', 16], [72, '; .', 54], [73, ': /', 55], [74, '! §', 56], [75, 'Maj', 229, 1.75], ['at', 14.25, 90, '↑', 82]],
  [[80, 'Ctrl', 224, 1.25], [81, 'Win', 227, 1.25], [82, 'Alt', 226, 1.25], [83, '', 44, 6.25], [84, 'Alt Gr', 230], [85, 'Fn', 175], [87, 'Ctrl', 228], ['at', 13.25, 88, '←', 80], ['at', 14.25, 89, '↓', 81], ['at', 15.25, 91, '→', 79]],
];

const ANSI = [
  [[0, 'Esc', 41], 'gap', [1, 'F1', 58], [2, 'F2', 59], [3, 'F3', 60], [4, 'F4', 61], 'gap', [5, 'F5', 62], [6, 'F6', 63], [7, 'F7', 64], [8, 'F8', 65], 'gap', [9, 'F9', 66], [10, 'F10', 67], [11, 'F11', 68], [12, 'F12', 69], ['at', 14, 106, 'Del', 76]],
  [[16, '` ~', 53], [17, '1 !', 30], [18, '2 @', 31], [19, '3 #', 32], [20, '4 $', 33], [21, '5 %', 34], [22, '6 ^', 35], [23, '7 &', 36], [24, '8 *', 37], [25, '9 (', 38], [26, '0 )', 39], [27, '- _', 45], [28, '= +', 46], [92, 'Back', 42, 2], ['nav', 107, 'End', 77]],
  [[32, 'Tab', 43, 1.5], [33, 'Q', 20], [34, 'W', 26], [35, 'E', 8], [36, 'R', 21], [37, 'T', 23], [38, 'Y', 28], [39, 'U', 24], [40, 'I', 12], [41, 'O', 18], [42, 'P', 19], [43, '[ {', 47], [44, '] }', 48], [97, '\\ |', 49, 1.5], ['nav', 105, 'PgUp', 75]],
  [[48, 'Caps', 57, 1.75], [49, 'A', 4], [50, 'S', 22], [51, 'D', 7], [52, 'F', 9], [53, 'G', 10], [54, 'H', 11], [55, 'J', 13], [56, 'K', 14], [57, 'L', 15], [58, '; :', 51], [59, "' \"", 52], [76, 'Enter', 40, 2.25], ['nav', 108, 'PgDn', 78]],
  [[64, 'Shift', 225, 2.25], [65, 'Z', 29], [66, 'X', 27], [67, 'C', 6], [68, 'V', 25], [69, 'B', 5], [70, 'N', 17], [71, 'M', 16], [72, ', <', 54], [73, '. >', 55], [74, '/ ?', 56], [75, 'Shift', 229, 1.75], ['at', 14.25, 90, '↑', 82]],
  [[80, 'Ctrl', 224, 1.25], [81, 'Win', 227, 1.25], [82, 'Alt', 226, 1.25], [83, '', 44, 6.25], [84, 'Alt', 230], [85, 'Fn', 175], [87, 'Ctrl', 228], ['at', 13.25, 88, '←', 80], ['at', 14.25, 89, '↓', 81], ['at', 15.25, 91, '→', 79]],
];

// Couleur de keycap d'après le code HID (dessin seulement : les LED par touche passent par-dessus).
const CAP_YELLOW = [41, 40, 44]; // Échap, Entrée, espace
const CAP_FN = [58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69]; // F1-F12
const CAP_DARK = [43, 57, 224, 225, 226, 227, 228, 229, 230, 175, 76, 77, 75, 78, 79, 80, 81, 82]; // modificateurs, navigation, flèches
function capOf(hid) {
  if (CAP_YELLOW.includes(hid)) return 'cap-yellow';
  if (CAP_FN.includes(hid)) return 'cap-fn';
  if (CAP_DARK.includes(hid)) return 'cap-dark';
  return 'cap-alpha';
}

function key({ slot, label, hid, x, y, w = 1, h = 1, iso = false }) {
  return { slot, label, hid, x, y, w, h, iso, cap: capOf(hid) };
}

/** Convertit les rangées en touches positionnées { slot, label, hid, x, y, w, h, iso?, cap }. */
function build(rows) {
  const keys = [];
  rows.forEach((row, y) => {
    let x = 0;
    for (const k of row) {
      if (k === 'gap') { x += 0.25; continue; }
      if (k[0] === 'nav') { keys.push(key({ slot: k[1], label: k[2], hid: k[3], x: NAV_X, y })); continue; }
      if (k[0] === 'at') { keys.push(key({ slot: k[2], label: k[3], hid: k[4], x: k[1], y })); continue; }
      if (k[0] === 'isoEnter') { keys.push(key({ slot: k[1], label: k[2], hid: k[3], x, y, w: 1.5, h: 2, iso: true })); x += 1.5; continue; }
      const [slot, label, hid, w = 1] = k;
      keys.push(key({ slot, label, hid, x, y, w }));
      x += w;
    }
  });
  return keys;
}

/** Éléments sans emplacement ni code HID : molette et petit écran de la colonne de droite. */
const DECOR = [
  { kind: 'knob', x: 15.325, y: 0.075, w: 0.85, h: 0.85 },
  { kind: 'screen', x: 15.27, y: 4.12, w: 0.92, h: 0.76 },
];

export const LAYOUTS = {
  'iso-fr': { id: 'iso-fr', name: 'AZERTY (ISO-FR)', keys: build(ISO_FR), decor: DECOR },
  ansi: { id: 'ansi', name: 'QWERTY (ANSI)', keys: build(ANSI), decor: DECOR },
};
export const LAYOUT_WIDTH = 16.25;
export const LAYOUT_HEIGHT = 6;
