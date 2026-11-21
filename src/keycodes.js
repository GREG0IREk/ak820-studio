// Actions proposées dans la réaffectation des touches.
import { qmkKeyLabel } from './qmk.js';

/** Touches absentes du clavier mais utiles (codes HID, page clavier 0x07). */
export const EXTRA_KEYS = [
  [0x46, 'Impr. écran'], [0x47, 'Arrêt défil.'], [0x48, 'Pause'], [0x49, 'Inser'], [0x4a, 'Début'],
  [0x65, 'Menu'], [0x53, 'Verr Num'],
  [0x68, 'F13'], [0x69, 'F14'], [0x6a, 'F15'], [0x6b, 'F16'], [0x6c, 'F17'], [0x6d, 'F18'],
  [0x6e, 'F19'], [0x6f, 'F20'], [0x70, 'F21'], [0x71, 'F22'], [0x72, 'F23'], [0x73, 'F24'],
  [0x54, 'Pavé /'], [0x55, 'Pavé *'], [0x56, 'Pavé -'], [0x57, 'Pavé +'], [0x58, 'Pavé Entrée'],
  [0x59, 'Pavé 1'], [0x5a, 'Pavé 2'], [0x5b, 'Pavé 3'], [0x5c, 'Pavé 4'], [0x5d, 'Pavé 5'],
  [0x5e, 'Pavé 6'], [0x5f, 'Pavé 7'], [0x60, 'Pavé 8'], [0x61, 'Pavé 9'], [0x62, 'Pavé 0'], [0x63, 'Pavé .'],
];

/** Touches multimédia (page Consumer 0x0C). */
export const CONSUMER = [
  [0x00cd, 'Lecture / pause'], [0x00b5, 'Piste suivante'], [0x00b6, 'Piste précédente'], [0x00b7, 'Stop'],
  [0x00e9, 'Volume +'], [0x00ea, 'Volume -'], [0x00e2, 'Muet'],
  [0x006f, 'Luminosité écran +'], [0x0070, 'Luminosité écran -'],
  [0x0192, 'Calculatrice'], [0x018a, 'Courrier'], [0x0194, 'Explorateur de fichiers'],
  [0x0223, 'Navigateur : accueil'], [0x0221, 'Recherche'], [0x0224, 'Navigateur : précédent'], [0x0225, 'Navigateur : suivant'],
];

export const MOUSE = [
  [1, 'Clic gauche'], [2, 'Clic droit'], [4, 'Clic milieu'], [8, 'Bouton 4 (précédent)'], [16, 'Bouton 5 (suivant)'],
];

/** Libellé lisible d'une action, selon la disposition choisie. */
export function actionLabel(a, hidLabels) {
  if (!a) return '';
  switch (a.kind) {
    case 'default': return 'Par défaut';
    case 'keyboard': {
      const extra = EXTRA_KEYS.find(([u]) => u === a.usage);
      return hidLabels.get(a.usage) || (extra && extra[1]) || `HID 0x${a.usage.toString(16)}`;
    }
    case 'consumer': {
      const c = CONSUMER.find(([u]) => u === a.value);
      return c ? c[1] : `Média 0x${a.value.toString(16)}`;
    }
    case 'mouse': {
      const m = MOUSE.find(([u]) => u === a.button);
      return m ? m[1] : `Souris ${a.button}`;
    }
    case 'qmk': return qmkKeyLabel(a.code, (u) => hidLabels.get(u) || (EXTRA_KEYS.find(([x]) => x === u) || [])[1]);
    default: return `Code ${a.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}`;
  }
}

export function sameAction(a, b) {
  if (!a || !b || a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'default': return true;
    case 'keyboard': return a.usage === b.usage;
    case 'consumer': return a.value === b.value;
    case 'mouse': return a.button === b.button && (a.value ?? 0) === (b.value ?? 0);
    case 'qmk': return a.code === b.code;
    default: return a.bytes.join() === b.bytes.join();
  }
}
