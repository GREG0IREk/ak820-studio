// Copyright 2026 Fernando Birra <fernando.birra@gmail.com>
// Copyright 2026 Grégoire Kuhn (molette : menu de l'interface Cadran)
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Keymap « cadran » : celui de fpb (default) + la molette pilote le menu de l'écran.
//   - accueil : tourner = volume, appui court = sourdine, appui long = menu ;
//   - menu    : tourner = choisir, appui = entrer / valider, appui long = accueil.

#include QMK_KEYBOARD_H

#include "ak820pro.h"
#include "graphics/display.h"

// Position de l'appui molette dans la matrice (KC_MUTE en [0][14]).
#define KNOB_ROW     0
#define KNOB_COL     14
#define KNOB_HOLD_MS 500

enum layer_names {
    WINBASE,
    WINFN,
    MACBASE,
    MACFN
};

#define KC_TASK LGUI(KC_TAB)        // Task viewer
#define KC_FLXP LGUI(KC_E)          // Windows file explorer
#define KC_MCTL KC_MISSION_CONTROL  // Mission Control
#define KC_LPAD KC_LAUNCHPAD        // Launchpad

const uint16_t PROGMEM keymaps[][MATRIX_ROWS][MATRIX_COLS] = {
    /* Windows Base
     * ┌───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬┬───┐
     * │Esc││F1 │F2 │F3 │F4 ││F5 │F6 │F7 │F8 ││F9 │F10│F11│F12││DEL││VOL│
     * ├───┼┴──┬┴──┬┴──┬┴──┬┴┴─┬─┴─┬─┴─┬─┴─┬─┴┴┬──┴┬──┴┬──┴┬──┴┴──┬┴┼───┤
     * │ ~ │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │ 0 │ - │ = │Backsp│ │HOM│
     * ├───┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬────┼─┼───┤
     * │ Tab │ Q │ W │ E │ R │ T │ Y │ U │ I │ O │ P │ [ │ ] │  \ │ │PGU│
     * ├─────┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴────┼─┼───┤
     * │ Caps │ A │ S │ D │ F │ G │ H │ J │ K │ L │ ; │ ' │ Enter │ │PGD│
     * ├──────┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴────┬┬─┴─┼───┤
     * │ Shift  │ Z │ X │ C │ V │ B │ N │ M │ , │ . │ / │ Shift││ ↑ │   │
     * ├────┬───┴┬──┴─┬─┴───┴───┴───┴───┴───┴──┬┴──┬┴──┬┴──┬┬──┴┼───┼───┤
     * │Ctrl│GUI │Alt │         Space          │Alt│Fn │Ctl││ ← │ ↓ │ → │
     * └────┴────┴────┴────────────────────────┴───┴───┴───┴┴───┴───┴───┘
     */
    [WINBASE] = LAYOUT_82_ansi(
        KC_ESC,     KC_F1,      KC_F2,      KC_F3,      KC_F4,      KC_F5,      KC_F6,      KC_F7,      KC_F8,      KC_F9,      KC_F10,     KC_F11,      KC_F12,     KC_DEL,     KC_MUTE,
        KC_GRV,     KC_1,       KC_2,       KC_3,       KC_4,       KC_5,       KC_6,       KC_7,       KC_8,       KC_9,       KC_0,       KC_MINS,     KC_EQL,     KC_BSPC,    KC_HOME,
        KC_TAB,     KC_Q,       KC_W,       KC_E,       KC_R,       KC_T,       KC_Y,       KC_U,       KC_I,       KC_O,       KC_P,       KC_LBRC,     KC_RBRC,    KC_BSLS,    KC_PGUP,
        KC_CAPS,    KC_A,       KC_S,       KC_D,       KC_F,       KC_G,       KC_H,       KC_J,       KC_K,       KC_L,       KC_SCLN,    KC_QUOT,                 KC_ENT,     KC_PGDN,
        KC_LSFT,                KC_Z,       KC_X,       KC_C,       KC_V,       KC_B,       KC_N,       KC_M,       KC_COMM,    KC_DOT,     KC_SLSH,     KC_RSFT,    KC_UP,
        KC_LCTL,    KC_LGUI,    KC_LALT,                                        KC_SPC,                             KC_RALT,    MO(WINFN),  KC_RCTL,     KC_LEFT,    KC_DOWN,    KC_RGHT
    ),
    /* Windows FN
     * ┌───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬┬───┐
     * │Esc││BRU│BRD│TSK│FLX││VAD│VAI│PRV│PLY││NXT│MTE│VLD│VLU││   ││   │
     * ├───┼┴──┬┴──┬┴──┬┴──┬┴┴─┬─┴─┬─┴─┬─┴─┬─┴┴┬──┴┬──┴┬──┴┬──┴┴──┬┴┼───┤
     * │   │   │   │   │   │   │   │   │   │   │   │   │   │      │ │   │
     * ├───┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬────┼─┼───┤
     * │     │   │   │   │   │   │   │   │   │   │   │   │   │    │ │   │
     * ├─────┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴────┼─┼───┤
     * │      │   │   │   │   │   │   │   │   │   │   │   │       │ │   │
     * ├──────┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴────┬┬─┴─┼───┤
     * │        │   │   │   │   │   │   │   │   │   │   │      ││   │   │
     * ├────┬───┴┬──┴─┬─┴───┴───┴───┴───┴───┴──┬┴──┬┴──┬┴──┬┬──┴┼───┼───┤
     * │    │    │    │                        │   │   │   ││   │   │   │
     * └────┴────┴────┴────────────────────────┴───┴───┴───┴┴───┴───┴───┘
     */
    [WINFN] = LAYOUT_82_ansi(
        QK_BOOT,    KC_BRID,    KC_BRIU,    KC_TASK,    KC_FLXP,    _______,    _______,    KC_MPRV,    KC_MPLY,    KC_MNXT,    KC_MUTE,    KC_VOLD,     KC_VOLU,    SCR_TOG,    KC_MUTE,
        _______,    _______,    _______,    _______,    _______,    _______,    RM_SATU,    RM_SATD,    _______,    _______,    _______,    RM_SPDD,     RM_SPDU,    _______,    _______,
        _______,    BT1,        BT2,        BT3,        BT24G,      _______,    _______,    _______,    _______,    _______,    BT_PAIR,    _______,     _______,    RM_NEXT,    _______,
        _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,                 _______,    _______,
        _______,                _______,    RM_TOGG,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,     _______,    RM_VALU,
        _______,    GU_TOGG,    _______,                                        _______,                            _______,    _______,    _______,     RM_HUED,    RM_VALD,    RM_HUEU
    ),
    /* Mac Base
     * ┌───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬┬───┐
     * │Esc││F1 │F2 │F3 │F4 ││F5 │F6 │F7 │F8 ││F9 │F10│F11│F12││DEL││VOL│
     * ├───┼┴──┬┴──┬┴──┬┴──┬┴┴─┬─┴─┬─┴─┬─┴─┬─┴┴┬──┴┬──┴┬──┴┬──┴┴──┬┴┼───┤
     * │ ~ │ 1 │ 2 │ 3 │ 4 │ 5 │ 6 │ 7 │ 8 │ 9 │ 0 │ - │ = │Backsp│ │HOM│
     * ├───┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬────┼─┼───┤
     * │ Tab │ Q │ W │ E │ R │ T │ Y │ U │ I │ O │ P │ [ │ ] │  \ │ │PGU│e
     * ├─────┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴────┼─┼───┤
     * │ Caps │ A │ S │ D │ F │ G │ H │ J │ K │ L │ ; │ ' │ Enter │ │PGD│
     * ├──────┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴────┬┬─┴─┼───┤
     * │ Shift  │ Z │ X │ C │ V │ B │ N │ M │ , │ . │ / │ Shift││ ↑ │   │
     * ├────┬───┴┬──┴─┬─┴───┴───┴───┴───┴───┴──┬┴──┬┴──┬┴──┬┬──┴┼───┼───┤
     * │Ctrl│Alt │GUI │         Space          │GUI│Fn │Ctl││ ← │ ↓ │ → │
     * └────┴────┴────┴────────────────────────┴───┴───┴───┴┴───┴───┴───┘
     */
    [MACBASE] = LAYOUT_82_ansi(
        KC_ESC,     KC_BRID,    KC_BRIU,    KC_MCTL,    KC_F4,      KC_F5,      KC_F6,      KC_MPRV,    KC_MPLY,    KC_MNXT,    KC_MUTE,    KC_VOLD,     KC_VOLU,    KC_DEL,     KC_MUTE,
        KC_GRV,     KC_1,       KC_2,       KC_3,       KC_4,       KC_5,       KC_6,       KC_7,       KC_8,       KC_9,       KC_0,       KC_MINS,     KC_EQL,     KC_BSPC,    KC_HOME,
        KC_TAB,     KC_Q,       KC_W,       KC_E,       KC_R,       KC_T,       KC_Y,       KC_U,       KC_I,       KC_O,       KC_P,       KC_LBRC,     KC_RBRC,    KC_BSLS,    KC_PGUP,
        KC_CAPS,    KC_A,       KC_S,       KC_D,       KC_F,       KC_G,       KC_H,       KC_J,       KC_K,       KC_L,       KC_SCLN,    KC_QUOT,                 KC_ENT,     KC_PGDN,
        KC_LSFT,                KC_Z,       KC_X,       KC_C,       KC_V,       KC_B,       KC_N,       KC_M,       KC_COMM,    KC_DOT,     KC_SLSH,     KC_RSFT,    KC_UP,
        KC_LCTL,    KC_LALT,    KC_LGUI,                                        KC_SPC,                             KC_RGUI,    MO(MACFN),  KC_RCTL,     KC_LEFT,    KC_DOWN,    KC_RGHT
    ),
    /* Mac FN
     * ┌───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬───┬───┬───┬┬───┬┬───┐
     * │Esc││BRU│BRD│TSK│FLX││VAD│VAI│PRV│PLY││NXT│MTE│VLD│VLU││   ││   │
     * ├───┼┴──┬┴──┬┴──┬┴──┬┴┴─┬─┴─┬─┴─┬─┴─┬─┴┴┬──┴┬──┴┬──┴┬──┴┴──┬┴┼───┤
     * │   │   │   │   │   │   │   │   │   │   │   │   │   │      │ │   │
     * ├───┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬────┼─┼───┤
     * │     │   │   │   │   │   │   │   │   │   │   │   │   │    │ │   │
     * ├─────┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴┬──┴────┼─┼───┤
     * │      │   │   │   │   │   │   │   │   │   │   │   │       │ │   │
     * ├──────┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴─┬─┴────┬┬─┴─┼───┤
     * │        │   │   │   │   │   │   │   │   │   │   │      ││   │   │
     * ├────┬───┴┬──┴─┬─┴───┴───┴───┴───┴───┴──┬┴──┬┴──┬┴──┬┬──┴┼───┼───┤
     * │    │    │    │                        │   │   │   ││   │   │   │
     * └────┴────┴────┴────────────────────────┴───┴───┴───┴┴───┴───┴───┘
     */
    [MACFN] = LAYOUT_82_ansi(
        QK_BOOT,    KC_F1,      KC_F2,      KC_F3,      KC_F4,      KC_F5,      KC_F6,      KC_F7,      KC_F8,      KC_F9,      KC_F10,     KC_F11,     KC_F12,      SCR_TOG,    KC_MUTE,
        _______,    _______,    _______,    _______,    _______,    _______,    RM_SATU,    RM_SATD,    _______,    _______,    _______,    RM_SPDD,     RM_SPDU,    _______,    _______,
        _______,    BT1,        BT2,        BT3,        BT24G,      _______,    _______,    _______,    _______,    _______,    BT_PAIR,    _______,     _______,    RM_NEXT,    _______,
        _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,                 _______,    _______,
        _______,                _______,    RM_TOGG,    _______,    _______,    _______,    _______,    _______,    _______,    _______,    _______,     _______,    RM_VALU,
        _______,    _______,    _______,                                        _______,                            _______,    _______,    _______,     RM_HUED,    RM_VALD,    RM_HUEU
    )
};


bool dip_switch_update_user(uint8_t index, bool active) {
    // Mac/Windows layer switch. The wireless slider (index 1/2) and dashboard
    // icons are handled at keyboard level in ak820pro.c (dip_switch_update_kb).
    if (index == 0) {
        if (active) {
            set_single_persistent_default_layer(WINBASE);
        } else {
            set_single_persistent_default_layer(MACBASE);
            keymap_config.no_gui = false;
        }
    }
    return true;
}


static bool     knob_down = false;
static bool     knob_long = false;
static uint16_t knob_timer;

bool process_record_user(uint16_t keycode, keyrecord_t *record) {
    if (IS_KEYEVENT(record->event) && record->event.key.row == KNOB_ROW && record->event.key.col == KNOB_COL) {
        if (record->event.pressed) {
            knob_down  = true;
            knob_long  = false;
            knob_timer = timer_read();
        } else {
            knob_down = false;
            if (!knob_long) {
                if (display_menu_active()) display_menu_press();
                else tap_code_delay(KC_MUTE, 10);
            }
        }
        return false;
    }

    // Only Mac-specific media keys live here; SCR_TOG and the BT* keycodes are
    // handled at keyboard level in ak820pro.c (process_record_kb).
    switch (keycode) {
        case KC_MISSION_CONTROL:
            if (record->event.pressed) {
                host_consumer_send(0x29F);
            } else {
                host_consumer_send(0);
            }
            return false;  // Skip all further processing of this key
        case KC_LAUNCHPAD:
            if (record->event.pressed) {
                host_consumer_send(0x2A0);
            } else {
                host_consumer_send(0);
            }
            return false;  // Skip all further processing of this key
        default:
            return true;  // Process all other keycodes normally
    }
}


// L'appui long se déclenche sans attendre le relâchement.
void housekeeping_task_user(void) {
    if (knob_down && !knob_long && timer_elapsed(knob_timer) >= KNOB_HOLD_MS) {
        knob_long = true;
        if (display_menu_active()) display_menu_close();
        else display_menu_open();
    }
}

bool encoder_update_user(uint8_t index, bool clockwise) {
    if (display_menu_active()) {
        display_menu_rotate(clockwise);
    } else {
        tap_code_delay(clockwise ? KC_VOLU : KC_VOLD, 10);
    }
    return false;   // pas de traitement par défaut (sinon le volume changerait deux fois)
}
