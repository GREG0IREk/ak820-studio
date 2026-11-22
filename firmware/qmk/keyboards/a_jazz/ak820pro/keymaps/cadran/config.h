// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

// Effets du menu en plus de ceux du portage (keyboard.json). Les effets réactifs
// (frappe) ont besoin de RGB_MATRIX_KEYPRESSES.
#define RGB_MATRIX_KEYPRESSES
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_CROSS
#define ENABLE_RGB_MATRIX_SOLID_SPLASH
#define ENABLE_RGB_MATRIX_MULTISPLASH
#define ENABLE_RGB_MATRIX_STARLIGHT_SMOOTH
#define ENABLE_RGB_MATRIX_DIGITAL_RAIN
#define ENABLE_RGB_MATRIX_RIVERFLOW
#define ENABLE_RGB_MATRIX_CYCLE_OUT_IN
#define ENABLE_RGB_MATRIX_CYCLE_SPIRAL
#define ENABLE_RGB_MATRIX_HUE_BREATHING
#define ENABLE_RGB_MATRIX_HUE_PENDULUM
#define ENABLE_RGB_MATRIX_DUAL_BEACON

// Version renvoyée par la commande système 0x13/0x02 (outil de mise à jour).
#define AK820_FW_VERSION "cadran-1.4"

// Ressources chargées par l'interface active (une seule à la fois) : 12 icônes
// au plus (6 entrées du menu x 2 tailles) et 5 polices. QMK prévoit 8 et 4 par défaut.
#define QUANTUM_PAINTER_NUM_IMAGES 12
#define QUANTUM_PAINTER_NUM_FONTS  5

// AK820 Studio (studio.c) : effet « Personnalisé » dans le menu et couleurs par touche
// dans le bloc utilisateur de l'EEPROM (81 LED x 3 octets + 1). La version du bloc sert
// aussi à repérer le premier démarrage de cette version (keymap EEPROM à initialiser).
#define AK820_STUDIO_PERKEY
#define EECONFIG_USER_DATA_SIZE    244
#define EECONFIG_USER_DATA_VERSION 0xCAD10001

// Macros (MC_0 à MC_7) : le tampon occupe ce qui reste de l'EEPROM après la keymap
// (taille = DYNAMIC_KEYMAP_MACRO_EEPROM_SIZE, voir nvm_dynamic_keymap.c). Rien d'existant n'est déplacé.
#define DYNAMIC_KEYMAP_MACRO_COUNT 8

// EEPROM émulée en flash : 1 Ko par défaut ne suffit pas pour la keymap modifiable
// (4 couches x 6 x 15 x 2 = 720 o) plus les couleurs par touche. 2 Ko logiques sur 4 Ko de flash.
#define WEAR_LEVELING_BACKING_SIZE 4096
#define WEAR_LEVELING_LOGICAL_SIZE 2048
