// Copyright 2026 Fernando Birra (pilote d'écran, init GC9107, veille)
// Copyright 2026 Grégoire Kuhn (menu de la molette, interfaces)
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Socle de l'écran 128x128 : état de l'interface, menu de la molette, réglages,
// veille. Le dessin est délégué à l'interface choisie (theme_*.c, contrat dans
// ui.h). Explication complète : firmware/ECRAN.md du dépôt ak820-studio.
//
//   - accueil : heure, date, connexion, batterie, Verr. Maj ;
//   - menu (appui long sur la molette) : Effet, Luminosité, Vitesse, Couleur,
//     Veille, Écran ;
//   - réglage : la molette change la valeur en direct, un appui valide et
//     l'enregistre, un appui long ou 15 s sans geste valide et revient à l'accueil.

#include <stdio.h>
#include <string.h>

#include "quantum.h"
#include "graphics/display.h"
#include "graphics/ui.h"
#include "qp_comms.h"      // qp_comms_command : INVERT_ON pour LCD_PANEL_V2
#include "rgb_matrix.h"
#include "rtc/rtc.h"

#define PANEL_DC     D14
#define PANEL_CS     B8
#define PANEL_RST    A17
#define PANEL_BKL    A16
#define LCD_OFFSET_X 1
#define LCD_OFFSET_Y 2

// Sans geste pendant ce délai, le menu se referme (le réglage en cours est gardé).
#ifndef CADRAN_MENU_TIMEOUT_MS
#    define CADRAN_MENU_TIMEOUT_MS 15000
#endif

// ---------------------------------------------------------------------------
// Données partagées avec les interfaces

ui_state_t       ui;
painter_device_t ui_dev;

const char *const UI_ITEM_LABEL[IT_COUNT] = {"Effet", "Luminosité", "Vitesse", "Couleur", "Veille", "Écran"};
const char *const UI_JOURS[7]             = {"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."};
const char *const UI_MOIS[12]             = {"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."};

// Effets proposés dans le menu. mode 0 = éclairage éteint (toujours en dernier).
typedef struct {
    uint8_t     mode;
    const char *name;
    const char *brief;
} effect_t;
static const effect_t EFFECTS[] = {
    {RGB_MATRIX_SOLID_COLOR, "Fixe", "Fixe"},
    {RGB_MATRIX_BREATHING, "Respiration", "Respir."},
    {RGB_MATRIX_CYCLE_LEFT_RIGHT, "Vague", "Vague"},
    {RGB_MATRIX_CYCLE_ALL, "Arc-en-ciel", "Arc-ciel"},
    {RGB_MATRIX_CYCLE_PINWHEEL, "Spirale", "Spirale"},
#ifdef ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE
    {RGB_MATRIX_SOLID_REACTIVE_SIMPLE, "Réactif", "Réactif"},
#endif
    {RGB_MATRIX_JELLYBEAN_RAINDROPS, "Pluie", "Pluie"},
    {RGB_MATRIX_TYPING_HEATMAP, "Chaleur", "Chaleur"},
#ifdef AK820_STUDIO_PERKEY
    {RGB_MATRIX_CUSTOM_perso, "Personnalisé", "Perso"},
#endif
    {0, "Éteint", "Éteint"},
};
#define EFFECT_COUNT ((uint8_t)(sizeof(EFFECTS) / sizeof(EFFECTS[0])))
#define EFFECT_OFF   (EFFECT_COUNT - 1)

static const ui_theme_t *const THEMES[] = {&theme_cadran, &theme_terminal, &theme_tuiles};
#define THEME_COUNT ((uint8_t)(sizeof(THEMES) / sizeof(THEMES[0])))

uint8_t ui_effect_count(void) {
    return EFFECT_COUNT;
}
const char *ui_effect_name(uint8_t i) {
    return i < EFFECT_COUNT ? EFFECTS[i].name : "";
}
const char *ui_effect_short(uint8_t i) {
    return i < EFFECT_COUNT ? EFFECTS[i].brief : "";
}
bool ui_effect_is_off(uint8_t i) {
    return i == EFFECT_OFF;
}
uint8_t ui_theme_count(void) {
    return THEME_COUNT;
}
const char *ui_theme_name(uint8_t i) {
    return i < THEME_COUNT ? THEMES[i]->name : "";
}
uint8_t ui_sleep_count(void) {
    return AK820_SLEEP_CHOICES;
}
uint8_t ui_sleep_minutes(uint8_t i) {
    return ak820_sleep_minutes(i);
}

// ---------------------------------------------------------------------------
// État

static bool display_powered = true;
static bool ui_ready        = false;   // premier dessin fait
static bool display_paused  = false;   // écran en veille

static ui_conn_t        connection_mode = CONN_USB;
static uint32_t         last_input      = 0;   // pour la fermeture automatique
static const ui_theme_t *theme          = NULL;

extern bool    ch582_is_connected(void);
extern uint8_t ch582_get_slot(void);
extern uint8_t ch582_get_battery(void);

void ui_status(ui_status_t *st) {
    memset(st, 0, sizeof(*st));   // octets de bourrage à zéro : la tâche compare par memcmp
    st->mode      = connection_mode;
    st->connected = connection_mode == CONN_USB || ch582_is_connected();
    st->slot      = ch582_get_slot();
    if (st->slot < 1 || st->slot > 3) st->slot = 1;
    st->battery = ch582_get_battery();
    if (st->battery > 100) st->battery = 0xFF;
    st->caps = host_keyboard_led_state().caps_lock;
}

bool ui_time(rtc_time_t *t) {
    if (rtc_get_time(t)) return true;
    memset(t, 0, sizeof(*t));
    return false;
}

// ---------------------------------------------------------------------------
// Primitives de dessin

void ui_fill(int16_t x0, int16_t y0, int16_t x1, int16_t y1, col_t c) {
    if (x1 < x0 || y1 < y0) return;
    qp_rect(ui_dev, x0, y0, x1, y1, COL(c), true);
}

int16_t ui_text_width(painter_font_handle_t f, const char *s) {
    return qp_textwidth(f, s);
}

// Une couleur grise (saturation 0) n'a pas de teinte : lui donner celle de
// l'autre ne change pas son rendu, mais évite que le lissage traverse tout le
// cercle des teintes (bords roses entre orange et bleu).
static void match_hues(col_t *fg, col_t *bg) {
    if (bg->s == 0) bg->h = fg->h;
    else if (fg->s == 0) fg->h = bg->h;
}

void ui_text(painter_font_handle_t f, int16_t x, int16_t y, const char *s, col_t fg, col_t bg) {
    match_hues(&fg, &bg);
    qp_drawtext_recolor(ui_dev, x, y, f, s, COL(fg), COL(bg));
}

void ui_image(painter_image_handle_t img, int16_t x, int16_t y, col_t fg, col_t bg) {
    match_hues(&fg, &bg);
    qp_drawimage_recolor(ui_dev, x, y, img, COL(fg), COL(bg));
}

void ui_text_center(painter_font_handle_t f, int16_t y, int16_t clear_x0, int16_t clear_x1, const char *s, col_t fg, col_t bg) {
    ui_fill(clear_x0, y, clear_x1, y + f->line_height - 1, bg);
    ui_text(f, (UI_W - ui_text_width(f, s)) / 2, y, s, fg, bg);
}

void ui_text_right(painter_font_handle_t f, int16_t x_right, int16_t y, const char *s, col_t fg, col_t bg) {
    ui_text(f, x_right + 1 - ui_text_width(f, s), y, s, fg, bg);
}

// ---------------------------------------------------------------------------
// Valeurs

static uint8_t effect_index_now(void) {
    if (!rgb_matrix_is_enabled()) return EFFECT_OFF;
    uint8_t m = rgb_matrix_get_mode();
    for (uint8_t i = 0; i < EFFECT_OFF; i++)
        if (EFFECTS[i].mode == m) return i;
    return 0;
}

static void load_values(void) {
    ui.eff_idx    = effect_index_now();
    ui.bright_pct = (uint8_t)(((uint16_t)rgb_matrix_get_val() * 10 + RGB_MATRIX_MAXIMUM_BRIGHTNESS / 2) / RGB_MATRIX_MAXIMUM_BRIGHTNESS) * 10;
    ui.speed_lvl  = (uint8_t)((rgb_matrix_get_speed() + 25) / 51);
    if (ui.speed_lvl < 1) ui.speed_lvl = 1;
    if (ui.speed_lvl > 5) ui.speed_lvl = 5;
    ui.hue_deg   = (uint16_t)((((uint32_t)rgb_matrix_get_hue() * 360 / 255) + 10) / 20 * 20) % 360;
    ui.sleep_idx = ak820_get_sleep_index();
    ui.theme_idx = ak820_get_theme_index();
    if (ui.theme_idx >= THEME_COUNT) ui.theme_idx = 0;
}

static uint8_t hue8(void) {
    return (uint8_t)((uint32_t)ui.hue_deg * 255 / 360);
}

col_t ui_hue_color(void) {
    return (col_t){hue8(), 255, 255};
}

void ui_value_text(uint8_t item, char *buf, size_t n, bool brief) {
    switch (item) {
        case IT_EFFECT: snprintf(buf, n, "%s", brief ? EFFECTS[ui.eff_idx].brief : EFFECTS[ui.eff_idx].name); break;
        case IT_BRIGHT: snprintf(buf, n, "%u %%", (unsigned)ui.bright_pct); break;
        case IT_SPEED: snprintf(buf, n, "%u/5", (unsigned)ui.speed_lvl); break;
        case IT_HUE: snprintf(buf, n, "%u°", (unsigned)ui.hue_deg); break;
        case IT_SLEEP: {
            uint8_t m = ak820_sleep_minutes(ui.sleep_idx);
            if (m) snprintf(buf, n, "%u min", (unsigned)m);
            else snprintf(buf, n, "Jamais");
            break;
        }
        case IT_THEME: snprintf(buf, n, "%s", ui_theme_name(ui.theme_idx)); break;
        default: buf[0] = 0; break;
    }
}

uint16_t ui_value_permille(uint8_t item) {
    switch (item) {
        case IT_EFFECT: return (uint16_t)((uint32_t)ui.eff_idx * 1000 / (EFFECT_COUNT - 1));
        case IT_BRIGHT: return (uint16_t)ui.bright_pct * 10;
        case IT_SPEED: return (uint16_t)(ui.speed_lvl - 1) * 250;
        case IT_HUE: return (uint16_t)((uint32_t)ui.hue_deg * 1000 / 340);
        case IT_SLEEP: return (uint16_t)((uint32_t)ui.sleep_idx * 1000 / (AK820_SLEEP_CHOICES - 1));
        case IT_THEME: return THEME_COUNT > 1 ? (uint16_t)((uint32_t)ui.theme_idx * 1000 / (THEME_COUNT - 1)) : 1000;
        default: return 0;
    }
}

static void apply_live(void) {
    switch (ui.sel) {
        case IT_EFFECT:
            if (ui.eff_idx == EFFECT_OFF) {
                rgb_matrix_disable_noeeprom();
            } else {
                rgb_matrix_enable_noeeprom();
                rgb_matrix_mode_noeeprom(EFFECTS[ui.eff_idx].mode);
            }
            break;
        case IT_BRIGHT:
            rgb_matrix_sethsv_noeeprom(rgb_matrix_get_hue(), rgb_matrix_get_sat(), (uint8_t)((uint16_t)ui.bright_pct * RGB_MATRIX_MAXIMUM_BRIGHTNESS / 100));
            break;
        case IT_SPEED:
            rgb_matrix_set_speed_noeeprom(ui.speed_lvl * 51);
            break;
        case IT_HUE: {
            uint8_t sat = rgb_matrix_get_sat();
            if (sat < 128) sat = 255;   // sur du blanc, la teinte ne se verrait pas
            rgb_matrix_sethsv_noeeprom(hue8(), sat, rgb_matrix_get_val());
            break;
        }
        default:
            break;
    }
}

static void commit_values(void) {
    switch (ui.sel) {
        case IT_EFFECT:
            if (ui.eff_idx == EFFECT_OFF) {
                rgb_matrix_disable();
            } else {
                rgb_matrix_enable();
                rgb_matrix_mode(EFFECTS[ui.eff_idx].mode);
            }
            break;
        case IT_BRIGHT:
        case IT_HUE:
            rgb_matrix_sethsv(rgb_matrix_get_hue(), rgb_matrix_get_sat(), rgb_matrix_get_val());
            break;
        case IT_SPEED:
            rgb_matrix_set_speed(rgb_matrix_get_speed());
            break;
        case IT_SLEEP:
            ak820_set_sleep_index(ui.sleep_idx);
            break;
        case IT_THEME:
            ak820_set_theme_index(ui.theme_idx);
            break;
        default:
            break;
    }
}

// ---------------------------------------------------------------------------
// Interface active

static void theme_use(uint8_t idx) {
    if (idx >= THEME_COUNT) idx = 0;
    if (theme == THEMES[idx]) return;
    if (theme && theme->leave) theme->leave();
    theme = THEMES[idx];
    if (theme->enter) theme->enter();
}

static void redraw(bool full) {
    if (!ui_ready || display_paused || !theme) return;
    theme->draw(ui.screen, full);
    qp_flush(ui_dev);
}

static void go(ui_screen_t s) {
    ui.screen = s;
    redraw(true);
}

// ---------------------------------------------------------------------------
// Menu : API pour le keymap

bool display_menu_active(void) {
    return ui.screen != SCR_HOME;
}

void display_menu_open(void) {
    if (display_paused) return;
    last_input = timer_read32();
    load_values();
    ui.sel = 0;
    go(SCR_MENU);
}

void display_menu_close(void) {
    if (ui.screen == SCR_EDIT) commit_values();
    go(SCR_HOME);
}

void display_menu_rotate(bool clockwise) {
    last_input = timer_read32();
    int8_t d   = clockwise ? 1 : -1;
    if (ui.screen == SCR_MENU) {
        ui.sel = (uint8_t)((ui.sel + IT_COUNT + d) % IT_COUNT);
        redraw(false);
    } else if (ui.screen == SCR_EDIT) {
        switch (ui.sel) {
            case IT_EFFECT: ui.eff_idx = (uint8_t)((ui.eff_idx + EFFECT_COUNT + d) % EFFECT_COUNT); break;
            case IT_BRIGHT:
                if (d > 0 && ui.bright_pct < 100) ui.bright_pct += 10;
                if (d < 0 && ui.bright_pct > 0) ui.bright_pct -= 10;
                break;
            case IT_SPEED:
                if (d > 0 && ui.speed_lvl < 5) ui.speed_lvl++;
                if (d < 0 && ui.speed_lvl > 1) ui.speed_lvl--;
                break;
            case IT_HUE: ui.hue_deg = (uint16_t)((ui.hue_deg + 360 + d * 20) % 360); break;
            case IT_SLEEP: ui.sleep_idx = (uint8_t)((ui.sleep_idx + AK820_SLEEP_CHOICES + d) % AK820_SLEEP_CHOICES); break;
            case IT_THEME:
                // Aperçu immédiat : l'écran de réglage est redessiné dans la nouvelle interface.
                ui.theme_idx = (uint8_t)((ui.theme_idx + THEME_COUNT + d) % THEME_COUNT);
                theme_use(ui.theme_idx);
                redraw(true);
                return;
        }
        apply_live();
        redraw(false);
    }
}

void display_menu_press(void) {
    last_input = timer_read32();
    if (ui.screen == SCR_MENU) {
        load_values();
        go(SCR_EDIT);
    } else if (ui.screen == SCR_EDIT) {
        commit_values();
        go(SCR_MENU);
    }
}

// ---------------------------------------------------------------------------
// Effets et interfaces : API pour le canal HID d'AK820 Studio

uint8_t display_effect_count(void) {
    return EFFECT_COUNT;
}

const char *display_effect_name(uint8_t index) {
    return ui_effect_name(index);
}

uint8_t display_effect_current(void) {
    return effect_index_now();
}

void display_effect_apply(uint8_t index, bool save) {
    if (index >= EFFECT_COUNT) return;
    if (index == EFFECT_OFF) {
        if (save) rgb_matrix_disable(); else rgb_matrix_disable_noeeprom();
        return;
    }
    if (save) {
        rgb_matrix_enable();
        rgb_matrix_mode(EFFECTS[index].mode);
    } else {
        rgb_matrix_enable_noeeprom();
        rgb_matrix_mode_noeeprom(EFFECTS[index].mode);
    }
}

int8_t display_effect_perkey(void) {
#ifdef AK820_STUDIO_PERKEY
    for (uint8_t i = 0; i < EFFECT_OFF; i++)
        if (EFFECTS[i].mode == RGB_MATRIX_CUSTOM_perso) return (int8_t)i;
#endif
    return -1;
}

uint8_t display_theme_count(void) {
    return THEME_COUNT;
}

const char *display_theme_name(uint8_t index) {
    return ui_theme_name(index);
}

uint8_t display_theme_current(void) {
    uint8_t i = ak820_get_theme_index();
    return i < THEME_COUNT ? i : 0;
}

void display_theme_set(uint8_t index) {
    if (index >= THEME_COUNT) return;
    ak820_set_theme_index(index);
    ui.theme_idx = index;
    theme_use(index);
    redraw(true);
}

void display_settings_changed(void) {
    if (ui.screen == SCR_HOME || display_paused) return;
    load_values();
    redraw(true);
}

// ---------------------------------------------------------------------------
// Alimentation et veille

bool display_get_power(void) {
    return display_powered;
}

void display_set_power(bool on) {
    display_powered = on;
    gpio_write_pin(PANEL_BKL, on);
}

void display_toggle_power(void) {
    display_set_power(!display_powered);
}

void display_toggle_media(void) {}

static bool s_slept = false;

void display_enter_sleep(void) {
    if (s_slept) return;
    if (ui.screen == SCR_EDIT) commit_values();
    ui.screen      = SCR_HOME;
    s_slept        = true;
    display_paused = true;
    qp_power(ui_dev, false);
    display_set_power(false);
}

void display_exit_sleep(void) {
    if (!s_slept) return;
    s_slept = false;
    qp_power(ui_dev, true);
    display_set_power(true);
    display_paused = false;
    redraw(true);
}

// ---------------------------------------------------------------------------
// Initialisation et tâche périodique (10 Hz, appelée par ak820pro.c)

static uint32_t first_draw(uint32_t trigger_time, void *cb_arg) {
    ui_ready = true;
    redraw(true);
    return 0;
}

bool display_init_kb(void) {
    ui_dev = qp_gc9107_make_spi_device(UI_W, UI_H, PANEL_CS, PANEL_DC, PANEL_RST, 2, 3);
    qp_set_viewport_offsets(ui_dev, LCD_OFFSET_X, LCD_OFFSET_Y);
    // Deux révisions d'écran existent (voir le dépôt fpb/qmk_firmware) :
    // v1 = rotation 270 sans inversion, v2 = rotation 90 avec inversion.
#if defined(LCD_PANEL_V2)
    qp_init(ui_dev, QP_ROTATION_90);
    qp_comms_start(ui_dev);
    qp_comms_command(ui_dev, 0x21);   // GC9XXX_CMD_INVERT_ON
    qp_comms_stop(ui_dev);
#else
    qp_init(ui_dev, QP_ROTATION_270);
#endif

    load_values();
    ui.screen = SCR_HOME;
    theme_use(ui.theme_idx);

    qp_rect(ui_dev, 0, 0, UI_W - 1, UI_H - 1, 0, 0, 0, true);
    qp_flush(ui_dev);
    gpio_set_pin_output(PANEL_BKL);
    gpio_write_pin(PANEL_BKL, display_powered);

    if (display_init_user()) defer_exec(300, first_draw, NULL);
    return true;
}

__attribute__((weak)) bool display_init_user(void) {
    return true;
}

__attribute__((weak)) bool display_housekeeping_task_user(void) {
    return true;
}

void display_housekeeping_task(void) {
    if (display_paused || !ui_ready) return;
    if (!display_housekeeping_task_user()) return;

    if (ui.screen != SCR_HOME) {
        if (timer_elapsed32(last_input) >= CADRAN_MENU_TIMEOUT_MS) display_menu_close();
        return;
    }

    // Accueil : l'interface compare elle-même avec ce qu'elle affiche et ne
    // redessine que ce qui a changé. On l'appelle à chaque nouvelle seconde ou
    // changement d'état (connexion, batterie, Verr. Maj).
    static uint32_t    last_sec = UINT32_MAX;
    static ui_status_t last_st;
    ui_status_t        st;
    ui_status(&st);
    uint32_t sec = rtc_get_seconds();
    if (sec != last_sec || memcmp(&st, &last_st, sizeof(st)) != 0) {
        last_sec = sec;
        last_st  = st;
        redraw(false);
    }
}

// ---------------------------------------------------------------------------
// Changements d'état signalés par ak820pro.c

void display_draw_mac_logo(void) {}

void display_draw_windows_logo(void) {}

void display_draw_usb_logo(void) {
    connection_mode = CONN_USB;
}

void display_draw_bluetooth_logo(void) {
    connection_mode = CONN_BT;
}

void display_draw_2_4_g_logo(void) {
    connection_mode = CONN_24G;
}
