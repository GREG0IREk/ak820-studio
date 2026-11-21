// Copyright 2026 Fernando Birra (pilote d'écran, init GC9107, veille)
// Copyright 2026 Grégoire Kuhn (interface « Cadran »)
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Interface « Cadran » de l'écran 128x128 :
//   - accueil : heure, date, connexion, batterie, Verr. Maj, anneau des secondes ;
//   - menu (appui long sur la molette) : carrousel d'icônes Effet, Luminosité,
//     Vitesse, Couleur, Veille, Retour ;
//   - réglage : la molette change la valeur en direct, l'anneau la montre,
//     un appui valide et l'enregistre.
// L'écran est dessiné directement (pas de tampon : la RAM du MCU est trop
// petite pour 32 Ko) et seules les zones qui changent sont redessinées.

#include <stdio.h>
#include <string.h>

#include "quantum.h"
#include "graphics/display.h"
#include "qp_comms.h"      // qp_comms_command : INVERT_ON pour LCD_PANEL_V2
#include "rgb_matrix.h"
#include "rtc/rtc.h"

#include "res_cadran/cadran_big.qff.h"
#include "res_cadran/cadran_mid.qff.h"
#include "res_cadran/cadran_small.qff.h"
#include "res_cadran/ic_effet_26.qgf.h"
#include "res_cadran/ic_effet_18.qgf.h"
#include "res_cadran/ic_lumiere_26.qgf.h"
#include "res_cadran/ic_lumiere_18.qgf.h"
#include "res_cadran/ic_vitesse_26.qgf.h"
#include "res_cadran/ic_vitesse_18.qgf.h"
#include "res_cadran/ic_couleur_26.qgf.h"
#include "res_cadran/ic_couleur_18.qgf.h"
#include "res_cadran/ic_veille_26.qgf.h"
#include "res_cadran/ic_veille_18.qgf.h"
#include "res_cadran/ic_retour_26.qgf.h"
#include "res_cadran/ic_retour_18.qgf.h"

#define PANEL_DC     D14
#define PANEL_CS     B8
#define PANEL_RST    A17
#define PANEL_BKL    A16
#define PANEL_WIDTH  128
#define PANEL_HEIGHT 128
#define LCD_OFFSET_X 1
#define LCD_OFFSET_Y 2

// Sans réglage pendant ce délai, le menu se referme (le réglage en cours est gardé).
#ifndef CADRAN_MENU_TIMEOUT_MS
#    define CADRAN_MENU_TIMEOUT_MS 15000
#endif

// ---------------------------------------------------------------------------
// Couleurs (TSV 0-255, celles de la maquette)

typedef struct {
    uint8_t h, s, v;
} col_t;
#define COL(c) (c).h, (c).s, (c).v

static const col_t COL_BG     = {149, 76, 20};   // #0E1114 fond
static const col_t COL_TRACK  = {150, 77, 43};   // #1E242B anneau vide
static const col_t COL_TEXT   = {0, 0, 242};     // #F2F2F0 texte
static const col_t COL_GREY   = {153, 32, 158};  // #8A929E texte secondaire
static const col_t COL_DIM    = {152, 37, 96};   // icônes voisines du carrousel
static const col_t COL_DOTOFF = {151, 60, 76};   // #3A424C points, Maj éteinte
static const col_t COL_ACCENT = {17, 194, 255};  // #FF8A3D orange

// ---------------------------------------------------------------------------
// Ressources

static painter_device_t      dev;
static painter_font_handle_t f_big, f_mid, f_small;

enum { IT_EFFECT, IT_BRIGHT, IT_SPEED, IT_HUE, IT_SLEEP, IT_BACK, IT_COUNT };

static const char *const ITEM_LABEL[IT_COUNT]    = {"Effet", "Luminosité", "Vitesse", "Couleur", "Veille", "Retour"};
static const char *const ITEM_LABEL_UP[IT_COUNT] = {"EFFET", "LUMINOSITÉ", "VITESSE", "COULEUR", "VEILLE", "RETOUR"};

static const uint8_t *const ICON26[IT_COUNT] = {gfx_ic_effet_26, gfx_ic_lumiere_26, gfx_ic_vitesse_26, gfx_ic_couleur_26, gfx_ic_veille_26, gfx_ic_retour_26};
static const uint8_t *const ICON18[IT_COUNT] = {gfx_ic_effet_18, gfx_ic_lumiere_18, gfx_ic_vitesse_18, gfx_ic_couleur_18, gfx_ic_veille_18, gfx_ic_retour_18};
static painter_image_handle_t ic26[IT_COUNT], ic18[IT_COUNT];

// Effets proposés dans le menu. mode 0 = éclairage éteint.
typedef struct {
    uint8_t     mode;
    const char *name;
} effect_t;
static const effect_t EFFECTS[] = {
    {RGB_MATRIX_SOLID_COLOR, "Fixe"},
    {RGB_MATRIX_BREATHING, "Respiration"},
    {RGB_MATRIX_CYCLE_LEFT_RIGHT, "Vague"},
    {RGB_MATRIX_CYCLE_ALL, "Arc-en-ciel"},
    {RGB_MATRIX_CYCLE_PINWHEEL, "Spirale"},
#ifdef ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE
    {RGB_MATRIX_SOLID_REACTIVE_SIMPLE, "Réactif"},
#endif
    {RGB_MATRIX_JELLYBEAN_RAINDROPS, "Pluie"},
    {RGB_MATRIX_TYPING_HEATMAP, "Chaleur"},
    {0, "Éteint"},
};
#define EFFECT_COUNT ((uint8_t)(sizeof(EFFECTS) / sizeof(EFFECTS[0])))
#define EFFECT_OFF   (EFFECT_COUNT - 1)

// ---------------------------------------------------------------------------
// État

static bool display_powered = true;
static bool ui_ready        = false;   // premier dessin fait
static bool display_paused  = false;   // écran en veille

enum { CONN_USB = 0, CONN_BT, CONN_24G };
static uint8_t connection_mode = CONN_USB;

typedef enum { SCR_HOME, SCR_MENU, SCR_EDIT } screen_t;
static screen_t screen     = SCR_HOME;
static uint8_t  sel        = 0;   // entrée du menu
static uint32_t last_input = 0;   // pour la fermeture automatique

// Valeurs en cours de réglage (appliquées en direct, enregistrées à la validation).
static uint8_t eff_idx, bright_pct, speed_lvl, sleep_idx;
static uint16_t hue_deg;

// Ce qui est affiché, pour ne redessiner que ce qui change.
static char     shown_conn[16], shown_time[8], shown_date[20], shown_value[20];
static uint8_t  shown_bat;
static int8_t   shown_caps;
static int16_t  shown_sec_angle;
static uint16_t shown_edit_angle;
static col_t    shown_edit_col;

extern bool    ch582_is_connected(void);
extern bool    ch582_is_24g(void);
extern bool    ch582_is_usb(void);
extern uint8_t ch582_get_slot(void);
extern uint8_t ch582_get_battery(void);

// ---------------------------------------------------------------------------
// Primitives

static void fill(int16_t x0, int16_t y0, int16_t x1, int16_t y1, col_t c) {
    qp_rect(dev, x0, y0, x1, y1, COL(c), true);
}

static void clear_all(void) {
    fill(0, 0, PANEL_WIDTH - 1, PANEL_HEIGHT - 1, COL_BG);
}

// Texte centré horizontalement sur l'écran, après effacement de sa zone.
static void text_center(painter_font_handle_t f, int16_t y, int16_t clear_x0, int16_t clear_x1, const char *s, col_t fg) {
    fill(clear_x0, y, clear_x1, y + f->line_height - 1, COL_BG);
    int16_t w = qp_textwidth(f, s);
    qp_drawtext_recolor(dev, (PANEL_WIDTH - w) / 2, y, f, s, COL(fg), COL(COL_BG));
}

// Angle d'un point par rapport au centre, en dixièmes de degré, sens horaire
// depuis midi (0..3599). Table : atan(i/64) en dixièmes de degré.
static const uint16_t ATAN_TAB[65] = {0, 9, 18, 27, 36, 45, 54, 62, 71, 80, 89, 98, 106, 115, 123, 132, 140, 149, 157, 165, 174, 182, 190, 198, 206, 213, 221, 229, 236, 244, 251, 258, 266, 273, 280, 287, 294, 300, 307, 314, 320, 326, 333, 339, 345, 351, 357, 363, 369, 374, 380, 386, 391, 396, 402, 407, 412, 417, 422, 427, 432, 436, 441, 445, 450};

static uint16_t atan_ratio(int32_t num, int32_t den) {   // num <= den
    if (den == 0) return 0;
    return ATAN_TAB[(num * 64 + den / 2) / den];
}

static uint16_t angle10(int32_t dx, int32_t dy) {
    int32_t  u = dx, v = -dy;   // v vers le haut
    int32_t  au = u < 0 ? -u : u, av = v < 0 ? -v : v;
    uint16_t t = (av >= au) ? atan_ratio(au, av) : 900 - atan_ratio(av, au);
    if (u >= 0 && v >= 0) return t;
    if (u >= 0) return 1800 - t;
    if (v < 0) return 1800 + t;
    return t == 0 ? 0 : 3600 - t;
}

// Anneau : rayon intérieur 54, extérieur 58, centré (64,64). Les calculs se font
// en coordonnées doublées pour viser le centre des pixels.
#define RING_IN2  (108L * 108L)
#define RING_OUT2 (116L * 116L)

// Peint les pixels de l'anneau dont l'angle est dans [a0, a1).
static void ring_paint(uint16_t a0, uint16_t a1, col_t c) {
    if (a1 <= a0) return;
    for (int16_t y = 64 - 58; y < 64 + 58; y++) {
        int32_t dy  = 2 * y + 1 - 128;
        int16_t run = -1;
        for (int16_t x = 64 - 58; x <= 64 + 58; x++) {
            int32_t dx = 2 * x + 1 - 128;
            int32_t r2 = dx * dx + dy * dy;
            bool    in = false;
            if (r2 >= RING_IN2 && r2 < RING_OUT2) {
                uint16_t a = angle10(dx, dy);
                in         = a >= a0 && a < a1;
            }
            if (in) {
                if (run < 0) run = x;
            } else if (run >= 0) {
                fill(run, y, x - 1, y, c);
                run = -1;
            }
        }
        if (run >= 0) fill(run, y, 64 + 58, y, c);
    }
}

// ---------------------------------------------------------------------------
// Lecture / application des réglages

static uint8_t effect_index_now(void) {
    if (!rgb_matrix_is_enabled()) return EFFECT_OFF;
    uint8_t m = rgb_matrix_get_mode();
    for (uint8_t i = 0; i < EFFECT_OFF; i++)
        if (EFFECTS[i].mode == m) return i;
    return 0;
}

static void load_values(void) {
    eff_idx    = effect_index_now();
    bright_pct = (uint8_t)(((uint16_t)rgb_matrix_get_val() * 10 + RGB_MATRIX_MAXIMUM_BRIGHTNESS / 2) / RGB_MATRIX_MAXIMUM_BRIGHTNESS) * 10;
    speed_lvl  = (uint8_t)((rgb_matrix_get_speed() + 25) / 51);
    if (speed_lvl < 1) speed_lvl = 1;
    if (speed_lvl > 5) speed_lvl = 5;
    hue_deg = (uint16_t)((((uint32_t)rgb_matrix_get_hue() * 360 / 255) + 10) / 20 * 20) % 360;
    sleep_idx = ak820_get_sleep_index();
}

static uint8_t hue8(void) {
    return (uint8_t)((uint32_t)hue_deg * 255 / 360);
}

static void apply_live(void) {
    switch (sel) {
        case IT_EFFECT:
            if (eff_idx == EFFECT_OFF) {
                rgb_matrix_disable_noeeprom();
            } else {
                rgb_matrix_enable_noeeprom();
                rgb_matrix_mode_noeeprom(EFFECTS[eff_idx].mode);
            }
            break;
        case IT_BRIGHT:
            rgb_matrix_sethsv_noeeprom(rgb_matrix_get_hue(), rgb_matrix_get_sat(), (uint8_t)((uint16_t)bright_pct * RGB_MATRIX_MAXIMUM_BRIGHTNESS / 100));
            break;
        case IT_SPEED:
            rgb_matrix_set_speed_noeeprom(speed_lvl * 51);
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
    switch (sel) {
        case IT_EFFECT:
            if (eff_idx == EFFECT_OFF) {
                rgb_matrix_disable();
            } else {
                rgb_matrix_enable();
                rgb_matrix_mode(EFFECTS[eff_idx].mode);
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
            ak820_set_sleep_index(sleep_idx);
            break;
        default:
            break;
    }
}

static void value_text(uint8_t item, char *buf, size_t n) {
    switch (item) {
        case IT_EFFECT: snprintf(buf, n, "%s", EFFECTS[eff_idx].name); break;
        case IT_BRIGHT: snprintf(buf, n, "%u %%", (unsigned)bright_pct); break;
        case IT_SPEED: snprintf(buf, n, "%u/5", (unsigned)speed_lvl); break;
        case IT_HUE: snprintf(buf, n, "%u°", (unsigned)hue_deg); break;
        case IT_SLEEP: {
            uint8_t m = ak820_sleep_minutes(sleep_idx);
            if (m) snprintf(buf, n, "%u min", (unsigned)m);
            else snprintf(buf, n, "Jamais");
            break;
        }
        default: snprintf(buf, n, "Accueil"); break;
    }
}

static uint16_t edit_angle(void) {
    uint32_t a = 0;
    switch (sel) {
        case IT_EFFECT: a = (uint32_t)eff_idx * 3600 / (EFFECT_COUNT - 1); break;
        case IT_BRIGHT: a = (uint32_t)bright_pct * 36; break;
        case IT_SPEED: a = (uint32_t)(speed_lvl - 1) * 900; break;
        case IT_HUE: a = (uint32_t)hue_deg * 3600 / 340; break;
        case IT_SLEEP: a = (uint32_t)sleep_idx * 3600 / (AK820_SLEEP_CHOICES - 1); break;
    }
    if (a < 72) a = 72;   // toujours un petit bout d'arc visible
    if (a > 3600) a = 3600;
    return (uint16_t)a;
}

static col_t edit_color(void) {
    if (sel == IT_HUE) return (col_t){hue8(), 255, 255};
    return COL_ACCENT;
}

// ---------------------------------------------------------------------------
// Accueil

#define HOME_CONN_Y 24
#define HOME_TIME_Y 39
#define HOME_DATE_Y 69
#define HOME_ROW_Y  89

static const char *const JOURS[7]  = {"dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."};
static const char *const MOIS[12] = {"janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."};

static void conn_text(char *buf, size_t n) {
    if (connection_mode == CONN_USB) {
        snprintf(buf, n, "USB");
        return;
    }
    bool up = ch582_is_connected();
    if (connection_mode == CONN_24G) {
        snprintf(buf, n, up ? "2,4 GHZ" : "2,4 GHZ ...");
        return;
    }
    uint8_t slot = ch582_get_slot();
    if (slot < 1 || slot > 3) slot = 1;
    snprintf(buf, n, up ? "BT %u" : "BT %u ...", (unsigned)slot);
}

static void home_seconds(bool full, uint8_t sec) {
    int16_t a = (int16_t)((uint32_t)sec * 3600 / 59);
    if (a > 3600) a = 3600;
    if (full || a < shown_sec_angle) {
        ring_paint(0, (uint16_t)a, COL_ACCENT);
        ring_paint((uint16_t)a, 3600, COL_TRACK);
    } else if (a > shown_sec_angle) {
        ring_paint((uint16_t)shown_sec_angle, (uint16_t)a, COL_ACCENT);
    }
    shown_sec_angle = a;
}

static void home_row(bool full) {
    uint8_t b = ch582_get_battery();
    if (b > 100) b = 0xFF;
    int8_t caps = host_keyboard_led_state().caps_lock ? 1 : 0;
    if (!full && b == shown_bat && caps == shown_caps) return;
    shown_bat  = b;
    shown_caps = caps;

    char bat[8];
    if (b == 0xFF) snprintf(bat, sizeof(bat), "-- %%");
    else snprintf(bat, sizeof(bat), "%u %%", (unsigned)b);
    int16_t wb = qp_textwidth(f_small, bat), wm = qp_textwidth(f_small, "MAJ");
    int16_t total = wb + 5 + 3 + 5 + wm;
    int16_t x     = (PANEL_WIDTH - total) / 2;
    int16_t y     = HOME_ROW_Y;
    fill(26, y, 102, y + f_small->line_height - 1, COL_BG);
    qp_drawtext_recolor(dev, x, y, f_small, bat, COL(COL_TEXT), COL(COL_BG));
    int16_t dot_y = y + f_small->line_height / 2;
    fill(x + wb + 5, dot_y - 1, x + wb + 7, dot_y + 1, COL_DOTOFF);
    qp_drawtext_recolor(dev, x + wb + 13, y, f_small, "MAJ", COL(caps ? COL_ACCENT : COL_DOTOFF), COL(COL_BG));
}

static void home_draw(bool full) {
    rtc_time_t t;
    if (!rtc_get_time(&t)) memset(&t, 0, sizeof(t));

    if (full) {
        clear_all();
        shown_conn[0] = shown_time[0] = shown_date[0] = 0;
    }
    home_seconds(full, t.seconds);

    char buf[20];
    conn_text(buf, sizeof(buf));
    if (strcmp(buf, shown_conn) != 0) {
        strcpy(shown_conn, buf);
        text_center(f_small, HOME_CONN_Y, 30, 98, buf, COL_GREY);
    }

    snprintf(buf, sizeof(buf), "%02u:%02u", (unsigned)t.hours, (unsigned)t.minutes);
    if (strcmp(buf, shown_time) != 0) {
        strcpy(shown_time, buf);
        text_center(f_big, HOME_TIME_Y, 17, 111, buf, COL_TEXT);
    }

    uint8_t wd = t.weekday % 7, mo = (t.month >= 1 && t.month <= 12) ? t.month - 1 : 0;
    snprintf(buf, sizeof(buf), "%s %u %s", JOURS[wd], (unsigned)t.day, MOIS[mo]);
    if (strcmp(buf, shown_date) != 0) {
        strcpy(shown_date, buf);
        text_center(f_small, HOME_DATE_Y, 18, 110, buf, COL_GREY);
    }

    home_row(full);
}

// ---------------------------------------------------------------------------
// Menu (carrousel)

#define MENU_LABEL_Y 77
#define MENU_VALUE_Y 94
#define MENU_DOTS_Y  110

static void menu_draw(bool full) {
    if (full) {
        clear_all();
        ring_paint(0, 3600, COL_TRACK);
    }
    uint8_t prev = (sel + IT_COUNT - 1) % IT_COUNT, next = (sel + 1) % IT_COUNT;
    qp_drawimage_recolor(dev, 51, 39, ic26[sel], COL(COL_ACCENT), COL(COL_BG));
    qp_drawimage_recolor(dev, 15, 43, ic18[prev], COL(COL_DIM), COL(COL_BG));
    qp_drawimage_recolor(dev, 95, 43, ic18[next], COL(COL_DIM), COL(COL_BG));

    text_center(f_mid, MENU_LABEL_Y, 19, 109, ITEM_LABEL[sel], COL_TEXT);

    char buf[20];
    value_text(sel, buf, sizeof(buf));
    text_center(f_small, MENU_VALUE_Y, 30, 98, buf, COL_GREY);

    int16_t x0 = (PANEL_WIDTH - (IT_COUNT * 4 + (IT_COUNT - 1) * 3)) / 2;
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        int16_t x = x0 + i * 7;
        fill(x, MENU_DOTS_Y, x + 3, MENU_DOTS_Y + 3, i == sel ? COL_ACCENT : COL_DOTOFF);
    }
}

// ---------------------------------------------------------------------------
// Réglage

#define EDIT_ICON_Y  22
#define EDIT_LABEL_Y 43
#define EDIT_VALUE_Y 58
#define EDIT_HINT_Y  90

static void edit_ring(bool full) {
    uint16_t a = edit_angle();
    col_t    c = edit_color();
    bool     recolor = c.h != shown_edit_col.h || c.s != shown_edit_col.s || c.v != shown_edit_col.v;
    if (full || recolor) {
        ring_paint(0, a, c);
        ring_paint(a, 3600, COL_TRACK);
    } else if (a > shown_edit_angle) {
        ring_paint(shown_edit_angle, a, c);
    } else if (a < shown_edit_angle) {
        ring_paint(a, shown_edit_angle, COL_TRACK);
    }
    shown_edit_angle = a;
    shown_edit_col   = c;
}

static void edit_value(bool full) {
    char buf[20];
    value_text(sel, buf, sizeof(buf));
    if (!full && strcmp(buf, shown_value) == 0) return;
    strcpy(shown_value, buf);

    fill(15, EDIT_VALUE_Y, 113, EDIT_VALUE_Y + f_big->line_height - 1, COL_BG);
    bool big = sel != IT_EFFECT && qp_textwidth(f_big, buf) <= 96;
    painter_font_handle_t f = big ? f_big : f_mid;
    int16_t y = big ? EDIT_VALUE_Y : EDIT_VALUE_Y + (f_big->line_height - f_mid->line_height) / 2;
    int16_t w = qp_textwidth(f, buf);
    qp_drawtext_recolor(dev, (PANEL_WIDTH - w) / 2, y, f, buf, COL(COL_TEXT), COL(COL_BG));
}

static void edit_draw(bool full) {
    if (full) {
        clear_all();
        col_t c = edit_color();
        qp_drawimage_recolor(dev, 55, EDIT_ICON_Y, ic18[sel], COL(c), COL(COL_BG));
        text_center(f_small, EDIT_LABEL_Y, 22, 106, ITEM_LABEL_UP[sel], COL_GREY);
        text_center(f_small, EDIT_HINT_Y, 28, 100, "appui : valider", COL_GREY);
    } else if (sel == IT_HUE) {
        col_t c = edit_color();
        qp_drawimage_recolor(dev, 55, EDIT_ICON_Y, ic18[sel], COL(c), COL(COL_BG));
    }
    edit_ring(full);
    edit_value(full);
}

// ---------------------------------------------------------------------------
// Dessin général

static void redraw(bool full) {
    if (!ui_ready || display_paused) return;
    switch (screen) {
        case SCR_HOME: home_draw(full); break;
        case SCR_MENU: menu_draw(full); break;
        case SCR_EDIT: edit_draw(full); break;
    }
    qp_flush(dev);
}

static void go(screen_t s) {
    screen = s;
    redraw(true);
}

// ---------------------------------------------------------------------------
// Menu : API pour le keymap

bool display_menu_active(void) {
    return screen != SCR_HOME;
}

void display_menu_open(void) {
    if (display_paused) return;
    last_input = timer_read32();
    load_values();
    sel = 0;
    go(SCR_MENU);
}

void display_menu_close(void) {
    if (screen == SCR_EDIT) commit_values();
    go(SCR_HOME);
}

void display_menu_rotate(bool clockwise) {
    last_input = timer_read32();
    int8_t d   = clockwise ? 1 : -1;
    if (screen == SCR_MENU) {
        sel = (uint8_t)((sel + IT_COUNT + d) % IT_COUNT);
        redraw(false);
    } else if (screen == SCR_EDIT) {
        switch (sel) {
            case IT_EFFECT: eff_idx = (uint8_t)((eff_idx + EFFECT_COUNT + d) % EFFECT_COUNT); break;
            case IT_BRIGHT:
                if (d > 0 && bright_pct < 100) bright_pct += 10;
                if (d < 0 && bright_pct > 0) bright_pct -= 10;
                break;
            case IT_SPEED:
                if (d > 0 && speed_lvl < 5) speed_lvl++;
                if (d < 0 && speed_lvl > 1) speed_lvl--;
                break;
            case IT_HUE: hue_deg = (uint16_t)((hue_deg + 360 + d * 20) % 360); break;
            case IT_SLEEP: sleep_idx = (uint8_t)((sleep_idx + AK820_SLEEP_CHOICES + d) % AK820_SLEEP_CHOICES); break;
        }
        apply_live();
        redraw(false);
    }
}

void display_menu_press(void) {
    last_input = timer_read32();
    if (screen == SCR_MENU) {
        if (sel == IT_BACK) {
            go(SCR_HOME);
        } else {
            load_values();
            go(SCR_EDIT);
        }
    } else if (screen == SCR_EDIT) {
        commit_values();
        go(SCR_MENU);
    }
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
    if (screen == SCR_EDIT) commit_values();
    screen         = SCR_HOME;
    s_slept        = true;
    display_paused = true;
    qp_power(dev, false);
    display_set_power(false);
}

void display_exit_sleep(void) {
    if (!s_slept) return;
    s_slept = false;
    qp_power(dev, true);
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
    dev = qp_gc9107_make_spi_device(PANEL_WIDTH, PANEL_HEIGHT, PANEL_CS, PANEL_DC, PANEL_RST, 2, 3);
    qp_set_viewport_offsets(dev, LCD_OFFSET_X, LCD_OFFSET_Y);
    // Deux révisions d'écran existent (voir le dépôt fpb/qmk_firmware) :
    // v1 = rotation 270 sans inversion, v2 = rotation 90 avec inversion.
#if defined(LCD_PANEL_V2)
    qp_init(dev, QP_ROTATION_90);
    qp_comms_start(dev);
    qp_comms_command(dev, 0x21);   // GC9XXX_CMD_INVERT_ON
    qp_comms_stop(dev);
#else
    qp_init(dev, QP_ROTATION_270);
#endif

    f_big   = qp_load_font_mem(font_cadran_big);
    f_mid   = qp_load_font_mem(font_cadran_mid);
    f_small = qp_load_font_mem(font_cadran_small);
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        ic26[i] = qp_load_image_mem(ICON26[i]);
        ic18[i] = qp_load_image_mem(ICON18[i]);
    }

    clear_all();
    qp_flush(dev);
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

    if (screen != SCR_HOME) {
        if (timer_elapsed32(last_input) >= CADRAN_MENU_TIMEOUT_MS) display_menu_close();
        return;
    }

    static uint32_t last_sec = UINT32_MAX;
    uint32_t        sec      = rtc_get_seconds();
    char            buf[16];
    conn_text(buf, sizeof(buf));
    bool conn_changed = strcmp(buf, shown_conn) != 0;
    uint8_t b = ch582_get_battery();
    if (b > 100) b = 0xFF;
    bool row_changed = b != shown_bat || (host_keyboard_led_state().caps_lock ? 1 : 0) != shown_caps;

    if (sec != last_sec || conn_changed || row_changed) {
        last_sec = sec;
        home_draw(false);
        qp_flush(dev);
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
