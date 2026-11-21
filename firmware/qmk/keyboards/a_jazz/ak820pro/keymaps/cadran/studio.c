// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Canal HID 0x14 d'AK820 Studio (application web WebHID du dépôt ak820-studio).
// Même cadre que l'horloge (0x10) et les commandes système (0x13) :
//   requête [0x07, 0x14, commande, arguments…] sur le HID brut (page 0xFF60), 32 octets ;
//   la réponse reprend le paquet, données à partir de data[3] ; data[0] = 0xFF si refusé.
//
//   0x01 INFO            -> [3] version du protocole, [4] nb d'effets, [5] nb de couches,
//                           [6] lignes, [7] colonnes, [8] nb de LED, [9] nb de délais de veille,
//                           [10] délai actuel, [11] effet « Personnalisé » (0xFF : absent),
//                           [12] couche de base active, [13] batterie (0xFF : inconnue),
//                           [14..18] délais de veille en minutes (0 = jamais),
//                           [19] nb d'interfaces d'écran, [20] interface active (protocole 2)
//   0x02 EFFECT_NAME i   -> nom de l'effet i en UTF-8 à partir de data[4]
//   0x03 LIGHT_GET       -> [3] effet, [4] teinte, [5] saturation, [6] luminosité, [7] vitesse,
//                           [8] luminosité maximale
//   0x04 LIGHT_SET       e, h, s, v, vitesse, options (bit 0 : enregistrer en EEPROM)
//   0x05 SLEEP_SET       index du délai
//   0x06 KEYMAP_GET      off_hi, off_lo, taille (<= 26) -> keymap en EEPROM (2 o par touche,
//                           poids fort d'abord, ordre couche/ligne/colonne) à partir de data[6]
//   0x07 KEY_SET         couche, ligne, colonne, code_hi, code_lo
//   0x08 KEYMAP_DEFAULT  comme 0x06, keymap d'origine compilée dans le firmware
//   0x09 MATRIX          -> état des touches, 2 o par ligne (poids faible d'abord) à partir de data[3]
//   0x0A PERKEY_GET      première LED, nombre (<= 9) -> r, g, b à partir de data[5]
//   0x0B PERKEY_SET      première LED, nombre (<= 9), r, g, b… (en mémoire vive)
//   0x0C PERKEY_SAVE     choisir l'effet (0/1), luminosité (0xFF : inchangée) -> EEPROM
//   0x0D THEME_NAME i    -> nom de l'interface i en UTF-8 à partir de data[4]
//   0x0E THEME_SET i     interface de l'écran (appliquée et enregistrée)

#include QMK_KEYBOARD_H

#include <string.h>
#include "graphics/display.h"
#include "bluetooth/ch582f_ajazz.h"
#include "keymap_introspection.h"

enum {
    ST_SET_VALUE = 0x07,
    ST_UNHANDLED = 0xFF,
    ST_CHANNEL   = 0x14,
    ST_PROTOCOL  = 2,
};

enum {
    ST_INFO           = 0x01,
    ST_EFFECT_NAME    = 0x02,
    ST_LIGHT_GET      = 0x03,
    ST_LIGHT_SET      = 0x04,
    ST_SLEEP_SET      = 0x05,
    ST_KEYMAP_GET     = 0x06,
    ST_KEY_SET        = 0x07,
    ST_KEYMAP_DEFAULT = 0x08,
    ST_MATRIX         = 0x09,
    ST_PERKEY_GET     = 0x0A,
    ST_PERKEY_SET     = 0x0B,
    ST_PERKEY_SAVE    = 0x0C,
    ST_THEME_NAME     = 0x0D,
    ST_THEME_SET      = 0x0E,
};

// Position des champs d'interface dans la réponse INFO (après les 5 délais de veille).
#define INFO_THEMES 16
_Static_assert(11 + AK820_SLEEP_CHOICES <= INFO_THEMES, "INFO : délais de veille et interfaces se chevauchent");

#define KEYMAP_BYTES ((uint16_t)DYNAMIC_KEYMAP_LAYER_COUNT * MATRIX_ROWS * MATRIX_COLS * 2)

// Couleurs par touche, dans le bloc utilisateur de l'EEPROM.
typedef struct __attribute__((packed)) {
    uint8_t rgb[RGB_MATRIX_LED_COUNT][3];
    uint8_t _pad[EECONFIG_USER_DATA_SIZE - RGB_MATRIX_LED_COUNT * 3];
} perkey_t;
_Static_assert(sizeof(perkey_t) == EECONFIG_USER_DATA_SIZE, "EECONFIG_USER_DATA_SIZE");
static perkey_t perkey;

const uint8_t *ak820_perkey_color(uint8_t led) {
    static const uint8_t black[3] = {0, 0, 0};
    return led < RGB_MATRIX_LED_COUNT ? perkey.rgb[led] : black;
}

// Remise à zéro de l'EEPROM (QMK appelle aussi cette fonction) : toutes les touches en blanc.
void eeconfig_init_user_datablock(void) {
    memset(&perkey, 0xFF, sizeof(perkey));
    eeconfig_update_user_datablock(&perkey, 0, sizeof(perkey));
}

void keyboard_post_init_user(void) {
    if (!eeconfig_is_user_datablock_valid()) {
        // Première mise en route de cette version sans remise à zéro de l'EEPROM : le bloc
        // n'existait pas, donc la keymap en EEPROM n'a jamais été écrite. On y recopie
        // la keymap d'origine.
        dynamic_keymap_reset();
        eeconfig_init_user_datablock();
    } else {
        eeconfig_read_user_datablock(&perkey, 0, sizeof(perkey));
    }
}

// Lit `size` octets d'une keymap (EEPROM ou d'origine) à partir de `offset`.
static void keymap_read(bool factory, uint16_t offset, uint8_t size, uint8_t *out) {
    if (!factory) {
        dynamic_keymap_get_buffer(offset, size, out);
        return;
    }
    for (uint8_t i = 0; i < size; i++) {
        uint16_t pos = offset + i;
        if (pos >= KEYMAP_BYTES) {
            out[i] = 0;
            continue;
        }
        uint16_t key   = pos / 2;
        uint8_t  layer = key / (MATRIX_ROWS * MATRIX_COLS);
        uint8_t  row   = (key / MATRIX_COLS) % MATRIX_ROWS;
        uint8_t  col   = key % MATRIX_COLS;
        uint16_t kc    = layer < keymap_layer_count() ? keycode_at_keymap_location_raw(layer, row, col) : KC_TRNS;
        out[i]         = (pos & 1) ? (uint8_t)(kc & 0xFF) : (uint8_t)(kc >> 8);
    }
}

bool ak820_studio_command(uint8_t *data, uint8_t length) {
    if (length < 32 || data[0] != ST_SET_VALUE || data[1] != ST_CHANNEL) return false;
    uint8_t *a = &data[3];

    switch (data[2]) {
        case ST_INFO: {
            int8_t  pk  = display_effect_perkey();
            uint8_t bat = ch582_get_battery();
            memset(a, 0, length - 3);
            a[0]  = ST_PROTOCOL;
            a[1]  = display_effect_count();
            a[2]  = DYNAMIC_KEYMAP_LAYER_COUNT;
            a[3]  = MATRIX_ROWS;
            a[4]  = MATRIX_COLS;
            a[5]  = RGB_MATRIX_LED_COUNT;
            a[6]  = AK820_SLEEP_CHOICES;
            a[7]  = ak820_get_sleep_index();
            a[8]  = pk < 0 ? 0xFF : (uint8_t)pk;
            a[9]  = get_highest_layer(default_layer_state);
            a[10] = bat > 100 ? 0xFF : bat;
            for (uint8_t i = 0; i < AK820_SLEEP_CHOICES && 11 + i < length - 3; i++) a[11 + i] = ak820_sleep_minutes(i);
            a[INFO_THEMES]     = display_theme_count();
            a[INFO_THEMES + 1] = display_theme_current();
            break;
        }
        case ST_EFFECT_NAME: {
            uint8_t i = a[0];
            if (i >= display_effect_count()) goto refuse;
            memset(&data[4], 0, length - 4);
            strncpy((char *)&data[4], display_effect_name(i), length - 5);
            break;
        }
        case ST_LIGHT_GET:
            a[0] = display_effect_current();
            a[1] = rgb_matrix_get_hue();
            a[2] = rgb_matrix_get_sat();
            a[3] = rgb_matrix_get_val();
            a[4] = rgb_matrix_get_speed();
            a[5] = RGB_MATRIX_MAXIMUM_BRIGHTNESS;
            break;
        case ST_LIGHT_SET: {
            bool    save = a[5] & 1;
            uint8_t v    = a[3] > RGB_MATRIX_MAXIMUM_BRIGHTNESS ? RGB_MATRIX_MAXIMUM_BRIGHTNESS : a[3];
            if (a[0] >= display_effect_count()) goto refuse;
            display_effect_apply(a[0], save);
            if (save) {
                rgb_matrix_sethsv(a[1], a[2], v);
                rgb_matrix_set_speed(a[4]);
            } else {
                rgb_matrix_sethsv_noeeprom(a[1], a[2], v);
                rgb_matrix_set_speed_noeeprom(a[4]);
            }
            display_settings_changed();
            break;
        }
        case ST_SLEEP_SET:
            if (a[0] >= AK820_SLEEP_CHOICES) goto refuse;
            ak820_set_sleep_index(a[0]);
            display_settings_changed();
            break;
        case ST_KEYMAP_GET:
        case ST_KEYMAP_DEFAULT: {
            uint16_t off  = ((uint16_t)a[0] << 8) | a[1];
            uint8_t  size = a[2];
            if (size > length - 6) goto refuse;
            keymap_read(data[2] == ST_KEYMAP_DEFAULT, off, size, &data[6]);
            break;
        }
        case ST_KEY_SET:
            if (a[0] >= DYNAMIC_KEYMAP_LAYER_COUNT || a[1] >= MATRIX_ROWS || a[2] >= MATRIX_COLS) goto refuse;
            dynamic_keymap_set_keycode(a[0], a[1], a[2], ((uint16_t)a[3] << 8) | a[4]);
            break;
        case ST_MATRIX:
            memset(a, 0, length - 3);
            for (uint8_t r = 0; r < MATRIX_ROWS && 2 * r + 1 < length - 3; r++) {
                matrix_row_t row = matrix_get_row(r);
                a[2 * r]         = (uint8_t)(row & 0xFF);
                a[2 * r + 1]     = (uint8_t)((row >> 8) & 0xFF);
            }
            break;
        case ST_PERKEY_GET:
        case ST_PERKEY_SET: {
            uint8_t first = a[0], n = a[1];
            if (n > 9 || first >= RGB_MATRIX_LED_COUNT || first + n > RGB_MATRIX_LED_COUNT) goto refuse;
            for (uint8_t i = 0; i < n; i++) {
                if (data[2] == ST_PERKEY_SET)
                    memcpy(perkey.rgb[first + i], &a[2 + 3 * i], 3);
                else
                    memcpy(&a[2 + 3 * i], perkey.rgb[first + i], 3);
            }
            break;
        }
        case ST_PERKEY_SAVE: {
            eeconfig_update_user_datablock(&perkey, 0, sizeof(perkey));
            int8_t pk = display_effect_perkey();
            if (a[0] && pk >= 0) display_effect_apply((uint8_t)pk, true);
            if (a[1] != 0xFF) {
                uint8_t v = a[1] > RGB_MATRIX_MAXIMUM_BRIGHTNESS ? RGB_MATRIX_MAXIMUM_BRIGHTNESS : a[1];
                rgb_matrix_sethsv(rgb_matrix_get_hue(), rgb_matrix_get_sat(), v);
            }
            display_settings_changed();
            break;
        }
        case ST_THEME_NAME: {
            uint8_t i = a[0];
            if (i >= display_theme_count()) goto refuse;
            memset(&data[4], 0, length - 4);
            strncpy((char *)&data[4], display_theme_name(i), length - 5);
            break;
        }
        case ST_THEME_SET:
            if (a[0] >= display_theme_count()) goto refuse;
            display_theme_set(a[0]);
            break;
        default:
            goto refuse;
    }
    return true;

refuse:
    data[0] = ST_UNHANDLED;
    return true;
}
