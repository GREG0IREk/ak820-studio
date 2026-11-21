# Écran de l'AK820 Pro : fonctionnement et ajout d'une interface

Ce document explique comment le firmware Cadran dessine l'écran 128 × 128, comment une interface (Cadran, Terminal, Tuiles) est écrite et comment la vérifier sans clavier, avec le simulateur.

## Les fichiers

Tout se trouve dans `qmk/keyboards/a_jazz/ak820pro/graphics/` :

| Fichier | Rôle |
|---|---|
| `ui.h` | Contrat entre le socle et les interfaces : état, données, fonctions de dessin. **À lire en entier.** |
| `display.c` | Le socle : initialisation de l'écran, état, menu de la molette, réglages appliqués et enregistrés, veille, choix de l'interface, fonctions `ui_*`. |
| `theme_cadran.c` | Interface Cadran : fond sombre, anneau orange. Sert d'exemple complet. |
| `theme_terminal.c` | Interface Terminal : police pixel verte sur fond noir. |
| `theme_tuiles.c` | Interface Tuiles : fond clair, tuiles blanches. |
| `res_cadran/`, `res_terminal/`, `res_tuiles/` | Polices (`.qff.c`) et icônes (`.qgf.c`) au format Quantum Painter, générées par `firmware/assets/generate.sh`. Ne pas les modifier à la main. |

Autres fichiers utiles :
- `firmware/maquettes/*.dc.html` : maquettes HTML des trois interfaces. Le contenu de l'écran y est dessiné à sa taille réelle, 128 × 128 px, puis agrandi trois fois par `transform: scale(3)`. Les tailles en px de la maquette sont donc des pixels de l'écran.
- `firmware/sim/` : simulateur (voir plus bas).
- `firmware/assets/` : génération des polices et des icônes.
- `../rules.mk` : liste des fichiers compilés, ressources comprises.
- `keymaps/cadran/config.h` : limites de Quantum Painter (`QUANTUM_PAINTER_NUM_FONTS 5`, `QUANTUM_PAINTER_NUM_IMAGES 12`).

## Le matériel et ses contraintes

- Écran GC9107 de 128 × 128 px, piloté par Quantum Painter (QMK) en SPI. Origine (0, 0) en haut à gauche.
- **Pas de tampon d'image.** Le microcontrôleur n'a que 32 Ko de mémoire vive, et une image complète en prendrait 32 Ko. On dessine donc directement sur l'écran : pour changer un texte, on efface sa zone avec la couleur de fond puis on écrit le nouveau texte par-dessus.
- **Ne redessiner que ce qui change.** Chaque dessin passe par le SPI et prend du temps. Une interface garde ce qu'elle affiche (variables `shown_*` dans `theme_cadran.c`) et ne redessine une zone que si sa valeur a changé.
- **Couleurs en TSV 0-255** (`col_t {h, s, v}`), le format de Quantum Painter. Pour convertir une couleur web, par exemple #FF8A3D :
  - v = max(r, g, b) ;
  - s = 255 × (max − min) / max ;
  - h = teinte en degrés × 255 / 360.
- **Rectangles : bornes incluses.** `ui_fill(0, 0, 127, 127, c)` remplit tout l'écran.
- **Rien en dehors de l'écran.** Le simulateur compte les pixels écrits hors des 128 × 128 et le signale.
- **Mémoire.** Pas de `malloc` ni de grands tableaux sur la pile. `snprintf` est disponible. Éviter les nombres à virgule (`float`) : le processeur n'a pas d'unité de calcul flottant.
- **Fichiers en UTF-8.** Les textes accentués s'écrivent tels quels dans le code (`"Luminosité"`).

## Le cycle de vie

1. **Démarrage.**
   - `display_init_kb()` initialise l'écran, lit les réglages et l'interface enregistrée (`ak820_get_theme_index()`), puis appelle `enter()` de l'interface ;
   - 300 ms plus tard, un premier `draw(SCR_HOME, true)`.
2. **Accueil.** La tâche périodique (10 Hz) appelle `draw(SCR_HOME, false)` à chaque nouvelle seconde, et quand la connexion, la batterie ou Verr. Maj changent. L'interface compare avec ce qu'elle affiche et ne redessine que ce qui a changé.
3. **Menu.**
   - Un appui long sur la molette ouvre le menu : `draw(SCR_MENU, true)`.
   - Chaque cran de molette change `ui.sel` : `draw(SCR_MENU, false)`.
4. **Réglage.**
   - Un appui court ouvre le réglage de l'entrée choisie : `draw(SCR_EDIT, true)`.
   - Chaque cran change la valeur (déjà appliquée à l'éclairage par le socle) : `draw(SCR_EDIT, false)`.
   - Un appui court valide et revient au menu. Un appui long, ou 15 s sans geste, valide et revient à l'accueil.
5. **Entrée Écran.** Tourner la molette change d'interface tout de suite :
   - `leave()` de l'ancienne interface ;
   - `enter()` de la nouvelle ;
   - `draw(SCR_EDIT, true)`.
   Le choix est enregistré à la validation.
6. **Veille.** L'écran s'éteint. Au réveil : `draw(SCR_HOME, true)`.

`draw(…, true)` doit tout redessiner, fond compris, et remettre à jour les variables `shown_*`. `draw(…, false)` suppose que l'écran montre déjà le même écran, dessiné par cette interface.

## Ce qu'une interface peut lire (ui.h)

- `ui.screen`, `ui.sel` (`IT_EFFECT`, `IT_BRIGHT`, `IT_SPEED`, `IT_HUE`, `IT_SLEEP`, `IT_THEME`), et les valeurs en cours :
  - `ui.eff_idx` ;
  - `ui.bright_pct` (0 à 100, par pas de 10) ;
  - `ui.speed_lvl` (1 à 5) ;
  - `ui.hue_deg` (0 à 340, par pas de 20) ;
  - `ui.sleep_idx` ;
  - `ui.theme_idx`.
- `ui_status(&st)` : connexion (`CONN_USB`, `CONN_BT`, `CONN_24G`), liaison établie, profil Bluetooth 1 à 3, batterie (0xFF si inconnue), Verr. Maj.
- `ui_time(&t)` : heure, minute, seconde, jour, jour de la semaine (dimanche = 0), mois 1 à 12. Renvoie `false` si l'horloge n'est pas réglée.
- Textes :
  - `UI_ITEM_LABEL[i]` (« Effet », « Luminosité », « Vitesse », « Couleur », « Veille », « Écran ») ;
  - `UI_JOURS[]`, `UI_MOIS[]` (« sam. », « nov. ») ;
  - `ui_effect_name(i)`, `ui_effect_short(i)` (8 caractères au plus), `ui_effect_is_off(i)` ;
  - `ui_theme_name(i)`, `ui_sleep_minutes(i)`.
- `ui_value_text(item, buf, n, brief)` : la valeur affichable (« 80 % », « 3/5 », « 200° », « 5 min », « Jamais », nom de l'effet, nom de l'interface).
- `ui_value_permille(item)` : la position de la valeur dans sa plage, de 0 à 1000, pour une jauge.
- `ui_hue_color()` : la couleur choisie, en saturation et luminosité pleines.

Une interface ne modifie jamais `ui` et n'appelle aucune fonction de réglage. Elle ne fait que dessiner.

## Les fonctions de dessin

- `ui_fill(x0, y0, x1, y1, c)` : rectangle plein, bornes incluses.
- `ui_text(f, x, y, s, fg, bg)` : texte dont le coin haut gauche est en (x, y), sur une hauteur de `f->line_height`. Il ne s'efface pas tout seul : effacer la zone d'abord.
- `ui_text_width(f, s)` : largeur en pixels.
- `ui_text_center(f, y, x0, x1, s, fg, bg)` : efface la bande [x0, x1] sur la hauteur de la police, puis centre le texte sur l'écran.
- `ui_text_right(f, x_droite, y, s, fg, bg)` : aligné à droite (x_droite = dernier pixel du texte).
- `ui_image(img, x, y, fg, bg)` : icône mono4 recolorée.
- `qp_*` sur `ui_dev` pour le reste (`qp_line`, `qp_circle`…), sauf `qp_drawtext_recolor` et `qp_drawimage_recolor` : passer par `ui_text` et `ui_image`.

**Lissage et teintes.** Texte et icônes sont lissés : chaque pixel du bord est un mélange de `fg` et `bg` calculé en TSV, teinte comprise. Entre deux teintes éloignées, par exemple de l'orange sur du bleu nuit, le mélange passe par des teintes parasites et donne des bords roses. `ui_text` et `ui_image` évitent le problème quand l'une des deux couleurs est grise (`s = 0`). D'où la règle :
- derrière un texte ou une icône de couleur, prendre un fond gris (s = 0) ;
- sinon, des couleurs de teintes voisines.

## Polices et icônes disponibles

Une police ne contient que les caractères listés ci-dessous. **Un caractère absent n'est pas dessiné.** Les petites polices contiennent l'ASCII et `éèêëàâçùûôîïÉÈÊÀÇÛÔÎ°`.

**Cadran** (Space Grotesk), `res_cadran/` :

| Symbole | Taille | Caractères |
|---|---|---|
| `font_cadran_big` | 30, SemiBold | `0123456789:-%/ minJas°` |
| `font_cadran_mid` | 14, SemiBold | ASCII + accents |
| `font_cadran_small` | 11, Regular | ASCII + accents |

Icônes `gfx_ic_<nom>_26` et `gfx_ic_<nom>_18`, avec pour noms `effet`, `lumiere`, `vitesse`, `couleur`, `veille`, `ecran`.

**Terminal** (VT323, police pixel), `res_terminal/` :

| Symbole | Taille | Caractères |
|---|---|---|
| `font_term_huge` | 42 | `0123456789:-` (heure) |
| `font_term_big` | 30 | `0123456789:-%/ minJas°` (valeur réglée) |
| `font_term_mid` | 22 | ASCII + accents (nom d'effet ou d'interface réglé) |
| `font_term_text` | 13 | ASCII + accents (lignes du menu, barre `[####......]`) |
| `font_term_small` | 11 | ASCII + accents (en-tête, date, pied de page) |

**Tuiles** (Inter), `res_tuiles/` :

| Symbole | Taille | Caractères |
|---|---|---|
| `font_tui_time` | 30, ExtraBold | `0123456789:-` (heure) |
| `font_tui_value` | 26, ExtraBold | `0123456789:%/ minJas°-` (valeur réglée) |
| `font_tui_mid` | 17, ExtraBold | ASCII + accents (nom d'effet ou d'interface réglé) |
| `font_tui_bold` | 9, Bold | ASCII + accents (noms, valeurs des tuiles) |
| `font_tui_small` | 8, Regular | ASCII + accents (libellés gris, date, aide) |

Icônes `gfx_ic_<nom>_12` (`res_tuiles/`), plus celles en 18 px de `res_cadran/`.

Pour les inclure :
```c
#include "res_tuiles/tui_time.qff.h"
#include "res_cadran/ic_effet_18.qgf.h"
```
Les chemins sont relatifs au dossier `graphics/`.

Dans `enter()`, charger avec `qp_load_font_mem(font_x)` et `qp_load_image_mem(gfx_x)`. Dans `leave()`, libérer avec `qp_close_font` et `qp_close_image`. Une interface charge au plus 5 polices et 12 icônes.

Pour une autre taille, un autre caractère ou une autre icône, modifier `firmware/assets/generate.sh` (et `make_sources.py` pour les icônes), puis le relancer sur la VM :

```sh
rsync -a --delete --exclude .build --exclude out firmware/ greg@192.168.0.174:ak820-build/firmware/
ssh greg@192.168.0.174 'cd ~/ak820-build && sh firmware/assets/generate.sh ~/ak820-build/qmk_firmware'
```

Rapatrier ensuite les dossiers `res_*`, et mettre à jour `../rules.mk` si des fichiers ont été ajoutés ou retirés.

## Écrire une interface

Partir de `theme_cadran.c`, qui fait tout ce qu'il faut :
- une fonction de dessin par écran (`home_draw`, `menu_draw`, `edit_draw`) ;
- des variables `shown_*` pour ne redessiner que ce qui change ;
- `enter()` et `leave()` pour les ressources.

Le fichier se termine par :

```c
const ui_theme_t theme_terminal = {"Terminal", enter, leave, draw};
```

Le nom affiché vient de ce champ. L'ordre des interfaces est fixé par `THEMES[]` dans `display.c`, et cet ordre est celui enregistré en EEPROM : ne pas le changer.

Points d'attention :
- **Accueil, dessin partiel.** Comparer chaque zone avec sa valeur affichée : heure, date, secondes, connexion, batterie, Verr. Maj, effet.
- **Menu, dessin partiel.** Seules deux lignes ou deux tuiles changent : l'ancienne entrée choisie et la nouvelle. Garder l'entrée affichée (`shown_sel`) pour ne redessiner que celles-là. Tout redessiner fonctionne aussi, mais l'écran clignote.
- **Valeurs dans le menu.** Elles ne changent pas pendant qu'on navigue : seul `ui.sel` change.
- **Réglage, dessin partiel.** La valeur et la jauge changent. Pour Couleur, la couleur de la jauge suit `ui_hue_color()`.
- **Texte trop long.** « Personnalisé », « Arc-en-ciel » et les noms d'interface doivent tenir dans la largeur. Mesurer avec `ui_text_width` et prendre une police plus petite si besoin. C'est ce que fait `edit_value()` dans Cadran.

## Le simulateur

`firmware/sim/run.sh` compile pour le PC :
- le vrai `display.c` ;
- les vraies interfaces ;
- le vrai Quantum Painter de QMK.

Le faux pilote d'écran dessine en mémoire. Chaque scène est enregistrée en PNG, agrandie trois fois. La compilation et l'exécution ont lieu sur la VM, dans le conteneur QMK, et les images reviennent dans `firmware/sim/out/<interface>/`.

```sh
sh firmware/sim/run.sh                       # les trois interfaces
sh firmware/sim/run.sh terminal              # une seule
SIM_NAME=terminal sh firmware/sim/run.sh terminal   # dossier de travail à part sur la VM
```

Deux agents qui travaillent en même temps doivent chacun prendre un `SIM_NAME` différent. Le dossier `firmware/sim/out/` local est aussi partagé : copier ses images ailleurs si besoin.

Scènes produites, dans l'ordre de la planche :
- **Accueil :**
  - `accueil` : USB, 14:37:42, sam. 21 nov., 87 % ;
  - `accueil-seconde` : une seconde de plus ;
  - `accueil-bt-maj` : BT 2, Verr. Maj, 15 %, mar. 1 déc. 09:05 ;
  - `accueil-24g-attente` : 2,4 GHz non connecté, batterie inconnue, lun. 31 août 23:59 ;
  - `accueil-retour` : retour à USB et 100 %.
- **Menu :** `menu-effet`, `menu-luminosite`, `menu-vitesse`, `menu-couleur`, `menu-veille`, `menu-ecran`, puis `menu-retour-debut`.
- **Réglages :** pour chaque entrée, `reglage-<entrée>` (ouverture), `-2` (deux crans en avant) et `-moins` (trois crans en arrière). Pour `reglage-ecran`, seulement l'ouverture.
- **`planche.png` :** toutes les scènes sur une seule image.

Ce que vérifie le simulateur :
- **ÉCART :** après chaque dessin partiel, la scène est redessinée en entier et les deux images sont comparées. Toute différence est signalée, avec `<scène>-ecart.png` où les pixels différents sont en rouge. Cela veut dire que l'interface a oublié d'effacer ou de redessiner une zone.
- **HORS ÉCRAN :** des pixels ont été écrits en dehors des 128 × 128.
- **Code de sortie :** 0 s'il n'y a aucun problème. Les images sont rapatriées dans tous les cas.

Le simulateur ne reproduit pas la vitesse du SPI ni les couleurs exactes de la dalle. Il montre le placement, les textes, les couleurs relatives et les oublis de redessin.

## Compiler et installer

- **Compiler :** `sh firmware/build.sh`, sur la VM, dans `~/ak820-build` (voir `firmware/README.md`). Une seule compilation à la fois dans ce dossier.
- **Installer :** `flash.ps1` sur le PC fixe, voir `firmware/README.md`.

## Pièges connus

- **Le type `char`** est non signé sur le microcontrôleur (ARM) et signé sur PC. Le simulateur compile avec `-funsigned-char`, sinon les caractères accentués disparaissent.
- **Un caractère absent de la police** n'est pas dessiné, sans erreur. Exemples : une lettre dans `font_term_huge`, ou le « ° » dans une police qui ne l'a pas.
- **Hauteur réelle du texte.** `f->line_height` est la hauteur de la ligne, pas celle des chiffres. Les grands chiffres ont souvent quelques pixels vides au-dessus. Ajuster `y` d'après la planche.
- **Changer de police au dessin partiel.** Si une valeur peut passer d'une police à l'autre (texte court puis texte long), effacer la zone la plus grande des deux.
