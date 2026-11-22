# Micrologiciel « Cadran » pour l'AK820 Pro

Micrologiciel QMK pour l'écran et la molette de l'AK820 Pro. Il part du portage QMK de [fpb](https://github.com/fpb/qmk_firmware/tree/ak820pro-lcd-embedded) (branche `ak820pro-lcd-embedded`, commit `75d2d9b`) et remplace son interface d'écran par trois interfaces au choix : Cadran, Terminal et Tuiles.

Il remplace le micrologiciel Ajazz. Depuis la version 1.1, AK820 Studio (l'application web de ce dépôt) le règle par l'USB : éclairage, couleurs par touche, touches, veille, horloge (voir « AK820 Studio » plus bas). La version 1.0 n'était pas réglable par le site.

## Ce qu'il fait

**Écran (128 × 128)**, trois interfaces au choix (entrée Écran du menu ou page Écran d'AK820 Studio, depuis 1.2) :
- Cadran : fond sombre, anneau orange qui se remplit avec les secondes, menu en carrousel d'icônes ;
- Terminal : police pixel verte sur fond noir, menu en liste avec la ligne choisie en vidéo inversée ;
- Tuiles : fond clair et tuiles blanches, menu en grille de six cases.

Toutes affichent à l'accueil l'heure, la date, la connexion (USB, BT 1-3, 2,4 GHz), la batterie et Verr. Maj. Le menu propose Effet, Luminosité, Vitesse, Couleur, Veille et Écran. En réglage, le changement est appliqué en direct sur les touches. Fonctionnement et ajout d'une interface : [ECRAN.md](ECRAN.md).

**Molette**

| Où | Tourner | Appui court | Appui long (0,5 s) |
|---|---|---|---|
| Accueil | volume | sourdine | ouvre le menu |
| Menu | choisir une entrée | entrer dans le réglage | retour à l'accueil |
| Réglage | changer la valeur | valider et enregistrer | valider, retour à l'accueil |

Sans action pendant 15 s, le menu se referme et garde le réglage en cours.

**Réglages du menu**
- Effet : 21 effets (Fixe, Touche allumée, Touche éteinte, Scintillement, Pluie, Multicolore, Respiration, Spectre, Vague centrale, Défilement, Roulement, Rotation, Spirale, Explosion, Lancement, Ondulations, Flux, Pulsation, Bascule, Navette, Chaleur), Personnalisé (couleurs par touche envoyées depuis AK820 Studio) et Éteint. Les noms reprennent ceux de l'ancien logiciel Ajazz quand un effet équivalent existe.
- Luminosité : 0 à 100 %, par pas de 10.
- Vitesse : 1 à 5.
- Couleur : Rouge, Orange, Jaune, Lime, Vert, Menthe, Cyan, Azur, Bleu, Violet, Magenta, Rose, Blanc.
- Veille de l'écran et de l'éclairage : 1, 3, 5 ou 10 min, ou jamais.
- Écran : Cadran, Terminal ou Tuiles. Le changement est visible tout de suite. Depuis la 1.2, cette entrée remplace « Retour » : l'appui long revient à l'accueil.

Les réglages sont gardés en mémoire (EEPROM) et survivent au débranchement. Les raccourcis Fn du portage fpb restent actifs : Fn+Q/W/E pour le Bluetooth, Fn+R pour le 2,4 GHz, Fn+\ pour l'effet suivant, Fn+flèches pour la couleur et la luminosité, Fn+Échap pour le mode flash.

## Ce qu'il faut

- Pour compiler : Linux (ou WSL) avec Docker et git. Les outils QMK tournent dans un conteneur jetable.
- Pour flasher : Windows avec trois outils dans un dossier (`flash.ps1` les cherche à côté de lui ou dans `-Tools`) :
  - `ak820-maj.exe` : `sh firmware/tools/build-windows.sh` ;
  - `sonixflasher-hid.exe` : [SonixFlasherC 3.1.0](https://github.com/SonixQMK/SonixFlasherC) compilé avec le correctif `tools/sonixflasher/hidapi-windows.patch`. La version officielle pour Windows passe par libusb et ne voit pas le clavier, qui est un périphérique HID ;
  - `ak820ctl.exe` (facultatif, pour remettre l'heure) : [fpb/time-util-ak820pro](https://github.com/fpb/time-util-ak820pro).

## Étapes

### 1. Compiler

```sh
sh firmware/build.sh                  # écran v1
LCD_PANEL=v2 sh firmware/build.sh     # écran v2 (image à l'envers et couleurs inversées avec v1)
```

Le script récupère le portage fpb au commit figé, applique ses quatre correctifs ChibiOS, copie le dossier `qmk/` par-dessus, puis compile. Le résultat va dans `firmware/out/ak820pro-cadran-v1.bin` (environ 97 Ko).

### 2. Première installation

Il faut d'abord faire passer le clavier en mode flash (bootloader Sonix, USB `0c45:7140`). Le clavier ne tape plus tant qu'il est dans ce mode.

- **Depuis un QMK déjà installé** (portage fpb) : Fn+Échap, ou Échap enfoncé en branchant le câble.
- **Depuis le micrologiciel Ajazz** : soit les deux points de contact sous la barre d'espace (voir le [dépôt fpb](https://github.com/fpb/ajazz-ak820-pro) ; ils ne sont pas accessibles sur toutes les cartes), soit la commande de redémarrage HFD envoyée sur l'interface 3 :
  ```
  set SF_IFACE=8009:3
  sonixflasher-hid.exe -v 0c45/8009 -r hfd -f ak820pro-cadran-v1.bin
  ```

Ensuite, depuis Windows :

```
powershell -ExecutionPolicy Bypass -File flash.ps1 -Bin ak820pro-cadran-v1.bin
```

Le script attend le mode flash (2 min par défaut, `-WaitSeconds` pour changer), écrit, attend le redémarrage, affiche la version et remet l'heure.

**Après chaque mise à jour, éteindre et rallumer le clavier** (interrupteur ou câble). Le redémarrage automatique en fin de flash ne suffit pas : constaté sur mon clavier le 21/11, cause pas encore cherchée.

### 3. Mises à jour suivantes, sans toucher au clavier

Une fois Cadran installé, la même commande suffit : `flash.ps1` envoie d'abord `ak820-maj boot`, qui fait redémarrer le clavier en mode flash par l'USB. Le câble doit être branché.

```
ak820-maj version    # affiche la version installée (ex. cadran-1.1)
ak820-maj boot       # passe en mode flash
ak820-maj info       # état lu par le canal d'AK820 Studio (1.1 et plus), sans rien modifier
```

Ces deux commandes passent par le canal HID brut de QMK (page `0xFF60`), avec le cadre des commandes de VIA : `[0x07, 0x13, 0x01, "BOOT"]` pour le redémarrage, `[0x07, 0x13, 0x02]` pour la version.

### 4. Revenir au micrologiciel Ajazz

Passer en mode flash (Fn+Échap), puis écrire le micrologiciel d'origine : `AJAZZ_AK820PRO_PID_8009_V1.13_SN32F290.bin` dans le dossier `StockFWBinaries` du [dépôt fpb](https://github.com/fpb/ajazz-ak820-pro/tree/main/StockFWBinaries), avec `flash.ps1 -Bin <fichier>`.

### 5. Changer les polices ou les icônes

```sh
sh firmware/assets/generate.sh firmware/.build/qmk_firmware
```

Le script télécharge Space Grotesk, VT323 et Inter (Google Fonts) et dessine les icônes à partir des mêmes tracés SVG que les maquettes. Il convertit ensuite le tout au format Quantum Painter dans `qmk/keyboards/a_jazz/ak820pro/graphics/res_*/`. Il faut avoir lancé `build.sh` une fois avant. Détails dans [ECRAN.md](ECRAN.md).

## Fichiers

| Fichier | Rôle |
|---|---|
| `build.sh` | compilation reproductible (Docker) |
| `ECRAN.md` | fonctionnement de l'écran, ajout d'une interface, simulateur |
| `qmk/keyboards/a_jazz/ak820pro/graphics/display.c` | socle de l'écran : état, menu de la molette, réglages, veille, choix de l'interface |
| `qmk/keyboards/a_jazz/ak820pro/graphics/ui.h` | contrat entre le socle et les interfaces |
| `qmk/keyboards/a_jazz/ak820pro/graphics/theme_*.c` | interfaces Cadran, Terminal, Tuiles |
| `qmk/keyboards/a_jazz/ak820pro/ak820pro.c` | fichier du portage + délai de veille réglable + commandes système HID |
| `qmk/keyboards/a_jazz/ak820pro/keymaps/cadran/` | keymap : molette (volume, sourdine, menu), effets réactifs |
| `qmk/keyboards/a_jazz/ak820pro/keymaps/cadran/studio.c` | canal HID d'AK820 Studio (éclairage, touches, couleurs par touche, veille) |
| `qmk/keyboards/a_jazz/ak820pro/keymaps/cadran/rgb_matrix_user.inc` | effets « Personnalisé » et « Touche éteinte » |
| `qmk/keyboards/a_jazz/ak820pro/graphics/res_*/` | polices et icônes générées |
| `assets/` | génération des polices et icônes |
| `sim/` | simulateur de l'écran sur PC (captures PNG) |
| `maquettes/` | maquettes HTML des trois interfaces |
| `tools/ak820-maj.c` | outil PC : version, passage en mode flash |
| `tools/flash.ps1` | flash complet depuis Windows |
| `tools/sonixflasher/hidapi-windows.patch` | correctif de SonixFlasherC pour Windows |
| `tools/sonixflasher/partial-erase.patch` | correctif : n'efface que les pages du micrologiciel (garde l'EEPROM) |
| `tools/sonixflasher/build.sh` | compile `sonixflasher-hid.exe` avec les deux correctifs |

## Cadran 1.3 (22/11/2026)

- **Les réglages survivent aux mises à jour.** Deux causes les effaçaient : le flasheur Sonix efface les 256 pages de la puce, et l'image `.bin` fait 256 Ko complets (zéros jusqu'au bout, indicateur de validité dans les 4 derniers octets), donc elle réécrivait aussi la zone de l'EEPROM, tout en haut. `sonixflasher-hid.exe` est recompilé avec `partial-erase.patch` (`SF_ERASE_PAGES=n` : n'efface que les n premières pages, vérification d'écriture ignorée dans ce cas car la somme de la puce couvre aussi les pages gardées). `flash.ps1` coupe l'image après le dernier octet utile (arrondi au Ko), n'écrit que cela et laisse l'indicateur du flash précédent ; `-FullErase` remet l'ancien comportement (puce entière, EEPROM comprise). Un flasheur sans le correctif ignore la variable et efface tout. Vérifié le 22/11/2026 : teinte, saturation, luminosité, vitesse et délai de veille identiques avant et après deux flashs. Les numéros d'effets enregistrés par QMK suivent l'ordre de la liste des effets : la mise à jour vers 1.3 a changé l'effet affiché (le numéro enregistré désigne un autre effet), à choisir de nouveau une fois.
- **Effets** : 21 au lieu de 8, avec les noms de l'ancien logiciel.
- **Couleur** : noms de couleurs au lieu de degrés (menu de la molette). Le site garde son sélecteur libre.
- **Écran** : les textes sont écrits par-dessus l'ancien, sans effacer d'abord leur zone (plus de clignotement, bien moins de pixels envoyés). Mesures dans le simulateur (`sh firmware/sim/run.sh`) : pixels envoyés, fenêtres ouvertes et pixels écrits deux fois par scène.

## AK820 Studio (depuis 1.1)

Ouvrir AK820 Studio ([site](https://greg0irek.github.io/ak820-studio/) ou `dist/ak820-studio.html`) dans Chrome ou Edge, clavier branché en USB, puis « Connecter » et choisir « AK820 PRO ».

| Page | Sous Cadran |
|---|---|
| Éclairage | les effets du menu de l'écran, couleur, luminosité, vitesse ; envoi immédiat et enregistré |
| Touche par touche | couleurs par touche, lues et écrites ; l'envoi passe le clavier sur l'effet « Personnalisé » |
| Écran | choix de l'interface avec aperçu (1.2), mise à l'heure de l'horloge ; pas d'envoi d'image |
| Touches | 4 couches (Windows, Windows + Fn, Mac, Mac + Fn), lecture, écriture des seules touches modifiées, retour aux valeurs d'origine ; « Tester les touches » affiche la position de chaque touche enfoncée |
| Système | version, batterie, délai de veille |

Un changement fait depuis le site s'affiche aussi dans le menu de l'écran s'il est ouvert.

Le site passe par le HID brut de QMK (page `0xFF60`), canal `0x14`, avec le même cadre que l'horloge (`[0x07, 0x14, commande, …]`, 32 octets). Les commandes sont décrites en tête de `qmk/keyboards/a_jazz/ak820pro/keymaps/cadran/studio.c`.

Ce que la 1.1 change dans le firmware :
- keymap modifiable (`DYNAMIC_KEYMAP_ENABLE`) : la keymap compilée sert de valeurs d'origine, la keymap active est en EEPROM ;
- effet « Personnalisé » (`rgb_matrix_user.inc`), couleurs dans le bloc utilisateur de l'EEPROM ;
- EEPROM émulée portée de 1 à 2 Ko (4 Ko de flash) pour loger le tout.

Ce que la 1.2 change :
- l'écran est découpé en un socle (`display.c`) et une interface par fichier (`theme_*.c`) ;
- interfaces Terminal et Tuiles ;
- entrée Écran dans le menu ;
- commandes `0x0D` et `0x0E` du canal (protocole 2) ;
- fond de Cadran en gris neutre, ce qui supprime les bords roses des icônes.

L'interface choisie est enregistrée dans un octet libre du bloc EEPROM du clavier.

**Correction : le passage de 1.1 à 1.2 a bien effacé les réglages.** Ce paragraphe disait le contraire. Le flasheur Sonix efface les 256 pages de la puce avant d'écrire, et l'EEPROM émulée est tout en haut : toute mise à jour la remettait à zéro, quelle que soit la version.

**Passage de 1.0 à 1.1 : l'EEPROM repart de zéro.** L'EEPROM émulée change de taille et d'emplacement en flash : effet, couleur, luminosité, délai de veille et dernier profil Bluetooth reviennent aux valeurs par défaut au premier démarrage. Les appareils appairés en Bluetooth sont gardés par la puce radio, pas par ce firmware.

La touche ISO « < > » n'existe pas dans le portage fpb (clavier ANSI). Sa position est supposée en ligne 4, colonne 1 ; elle n'a pas d'action par défaut. Le test des touches du site confirme sa position, puis la page Touches permet de lui donner une action.

## Mise à jour sans fil (dongle 2,4 GHz ou Bluetooth)

Pas faisable pour l'instant sans risque. Le microcontrôleur du clavier (HFD80CP100, clone du Sonix SN32F299) ne parle à la radio que par une liaison série vers une puce WCH CH582F, qui garde son propre micrologiciel Ajazz. D'après le [protocole relevé par fpb](https://github.com/fpb/ajazz-ak820-pro/blob/main/docs/CH582F_PROTOCOL.md), cette puce ne remonte au clavier que trois informations venues de l'ordinateur : l'état des voyants (Verr. Maj), l'état de la connexion et la batterie. Il n'existe aucun canal pour faire passer des données arbitraires de l'ordinateur au clavier, donc pas de quoi transporter un micrologiciel.

Pour y arriver, il faudrait :
1. réécrire le micrologiciel du CH582F (pile Bluetooth HID + service de mise à jour), et celui du dongle pour le 2,4 GHz ;
2. trouver les points de programmation du CH582F sur la carte et y brancher une sonde WCH-Link ;
3. ajouter au clavier un chargeur capable de recevoir l'image par la liaison série et de la recopier en flash.

Une erreur à l'étape 1 coupe le sans-fil jusqu'à reprogrammation à la sonde. La mise à jour par le câble USB, sans toucher au clavier (étape 3 ci-dessus), couvre le besoin en attendant.

## Journal de l'installation sur mon clavier (21/11/2026)

- Clavier : Ajazz × Nacodex 2025, USB `0c45:8009`, micrologiciel Ajazz v1.13 (famille B). Pas de points de contact visibles sous la barre d'espace.
- Le SonixFlasherC officiel pour Windows ne trouvait pas le clavier (libusb). Recompilé avec hidapi natif et le choix d'interface (`hidapi-windows.patch`).
- Passage en mode flash depuis le micrologiciel Ajazz : commande HFD sur l'interface 3 (`SF_IFACE=8009:3 … -r hfd`). Le clavier est ensuite apparu en `0c45:7140` et le QMK `ak820pro-lcd-embedded` v1 de fpb a été écrit par un script de surveillance qui attendait ce mode. Le journal de ce script a été perdu : le moment exact du passage n'est pas documenté.
- Écran v1 confirmé (bon sens, bonnes couleurs).
- Cadran 1.0 : passage en mode flash par Fn+Échap (le QMK de fpb ne connaît pas `ak820-maj boot`), puis `flash.ps1`. Écriture vérifiée par le bootloader ; la dernière somme de contrôle échoue parce que le clavier a déjà redémarré. `flash.ps1` juge donc sur le redémarrage et la version (`cadran-1.0`). Il a fallu éteindre et rallumer le clavier après le flash.
- Cadran 1.1 (même jour) : passage en mode flash par `ak820-maj boot`, sans toucher au clavier. `flash.ps1` lancé avec sa sortie redirigée vers un journal s'est arrêté sur la première ligne d'erreur du flasheur, avant l'écriture : PowerShell 5 transforme la sortie d'erreur redirigée en erreur, et le script arrête tout à la première erreur. Le clavier est resté en mode flash, sans dommage, et le flasheur lancé directement a écrit et vérifié le firmware. `flash.ps1` passe désormais par `Invoke-Tool`, qui laisse passer la sortie d'erreur des outils. `ak820-maj info` : 10 effets, 4 couches, keymap active identique à la keymap d'origine ; l'EEPROM est repartie de zéro comme prévu.

## Licences

- `qmk/` : GPL-2.0 ou ultérieure, comme QMK et le portage fpb.
- Polices générées : Space Grotesk, VT323 et Inter, SIL Open Font License 1.1.
- `tools/sonixflasher/` : correctif de SonixFlasherC (GPL-3.0).
- Le reste du dépôt : MIT.
