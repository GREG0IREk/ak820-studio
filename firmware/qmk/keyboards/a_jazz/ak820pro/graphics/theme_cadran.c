// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Interface « Cadran » : fond sombre, anneau orange autour de l'écran.
//   - accueil : heure, date, connexion, batterie, Verr. Maj, anneau des secondes ;
//   - menu : carrousel d'icônes, nom et valeur de l'entrée, points de position ;
//   - réglage : l'anneau montre la valeur.
// Maquette : « 2 · Cadran » du canevas Écran AK820 v2.

#include <stdio.h>
#include <string.h>

#include "graphics/ui.h"

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
#include "res_cadran/ic_ecran_26.qgf.h"
#include "res_cadran/ic_ecran_18.qgf.h"

// Couleurs (TSV 0-255, celles de la maquette)
static const col_t BG     = {0, 0, 20};      // #141414 fond (gris : voir ui_text dans ui.h)
static const col_t TRACK  = {150, 77, 43};   // #1E242B anneau vide
static const col_t TEXT   = {0, 0, 242};     // #F2F2F0 texte
static const col_t GREY   = {153, 32, 158};  // #8A929E texte secondaire
static const col_t DIM    = {152, 37, 96};   // icônes voisines du carrousel
static const col_t DOTOFF = {151, 60, 76};   // #3A424C points, Maj éteinte
static const col_t ACCENT = {17, 194, 255};  // #FF8A3D orange

static const char *const LABEL_UP[IT_COUNT] = {"EFFET", "LUMINOSITÉ", "VITESSE", "COULEUR", "VEILLE", "ÉCRAN"};

static const uint8_t *const ICON26[IT_COUNT] = {gfx_ic_effet_26, gfx_ic_lumiere_26, gfx_ic_vitesse_26, gfx_ic_couleur_26, gfx_ic_veille_26, gfx_ic_ecran_26};
static const uint8_t *const ICON18[IT_COUNT] = {gfx_ic_effet_18, gfx_ic_lumiere_18, gfx_ic_vitesse_18, gfx_ic_couleur_18, gfx_ic_veille_18, gfx_ic_ecran_18};

static painter_font_handle_t  f_big, f_mid, f_small;
static painter_image_handle_t ic26[IT_COUNT], ic18[IT_COUNT];

// Ce qui est affiché, pour ne redessiner que ce qui change.
static char     shown_conn[16], shown_time[8], shown_date[20], shown_value[20];
static uint8_t  shown_bat;
static int8_t   shown_caps;
static int16_t  shown_sec_angle;
static uint8_t  shown_menu_sel;
static painter_font_handle_t shown_edit_font;
static bool     need_full_clear = true;   // premier dessin de l'interface : tout l'écran
static uint16_t shown_edit_angle;
static col_t    shown_edit_col;

// Efface avant un redessin complet. Tout ce qui change d'un écran à l'autre est dans
// le carré de 108 px au centre (l'anneau est repeint ensuite) : inutile de renvoyer
// les coins. Après un changement d'interface, tout l'écran est effacé.
static void clear_all(void) {
    if (need_full_clear) {
        ui_fill(0, 0, UI_W - 1, UI_H - 1, BG);
        need_full_clear = false;
    } else {
        ui_fill(10, 10, UI_W - 11, UI_H - 11, BG);
    }
}

// ---------------------------------------------------------------------------
// Anneau

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
                ui_fill(run, y, x - 1, y, c);
                run = -1;
            }
        }
        if (run >= 0) ui_fill(run, y, 64 + 58, y, c);
    }
}

// ---------------------------------------------------------------------------
// Accueil

#define HOME_CONN_Y 24
#define HOME_TIME_Y 39
#define HOME_DATE_Y 69
#define HOME_ROW_Y  89

static void conn_text(const ui_status_t *st, char *buf, size_t n) {
    switch (st->mode) {
        case CONN_USB: snprintf(buf, n, "USB"); break;
        case CONN_24G: snprintf(buf, n, st->connected ? "2,4 GHZ" : "2,4 GHZ ..."); break;
        default: snprintf(buf, n, st->connected ? "BT %u" : "BT %u ...", (unsigned)st->slot); break;
    }
}

static void home_seconds(bool full, uint8_t sec) {
    int16_t a = (int16_t)((uint32_t)sec * 3600 / 59);
    if (a > 3600) a = 3600;
    if (full || a < shown_sec_angle) {
        ring_paint(0, (uint16_t)a, ACCENT);
        ring_paint((uint16_t)a, 3600, TRACK);
    } else if (a > shown_sec_angle) {
        ring_paint((uint16_t)shown_sec_angle, (uint16_t)a, ACCENT);
    }
    shown_sec_angle = a;
}

// Ligne « batterie • MAJ ». Les cases à gauche et à droite s'arrêtent à 28 et 100 :
// au-delà, les coins de la bande mordraient sur l'anneau. Textes écrits en place.
#define ROW_X0 28
#define ROW_X1 100

static void home_row(bool full, const ui_status_t *st) {
    int8_t caps = st->caps ? 1 : 0;
    if (!full && st->battery == shown_bat && caps == shown_caps) return;
    shown_bat  = st->battery;
    shown_caps = caps;

    char bat[8];
    if (st->battery == 0xFF) snprintf(bat, sizeof(bat), "-- %%");
    else snprintf(bat, sizeof(bat), "%u %%", (unsigned)st->battery);
    int16_t wb = ui_text_width(f_small, bat), wm = ui_text_width(f_small, "MAJ");
    int16_t total = wb + 5 + 3 + 5 + wm;
    int16_t x     = (UI_W - total) / 2;
    int16_t y     = HOME_ROW_Y, yb = y + f_small->line_height - 1;
    if (x > ROW_X0) ui_fill(ROW_X0, y, x - 1, yb, BG);
    ui_text(f_small, x, y, bat, TEXT, BG);
    ui_fill(x + wb, y, x + wb + 12, yb, BG);
    int16_t dot_y = y + f_small->line_height / 2;
    ui_fill(x + wb + 5, dot_y - 1, x + wb + 7, dot_y + 1, DOTOFF);
    ui_text(f_small, x + wb + 13, y, "MAJ", caps ? ACCENT : DOTOFF, BG);
    if (x + total <= ROW_X1) ui_fill(x + total, y, ROW_X1, yb, BG);
}

static void home_draw(bool full) {
    rtc_time_t  t;
    ui_status_t st;
    ui_time(&t);
    ui_status(&st);

    if (full) {
        clear_all();
        shown_conn[0] = shown_time[0] = shown_date[0] = 0;
    }
    home_seconds(full, t.seconds);

    char buf[20];
    conn_text(&st, buf, sizeof(buf));
    if (strcmp(buf, shown_conn) != 0) {
        strcpy(shown_conn, buf);
        ui_text_center(f_small, HOME_CONN_Y, 30, 98, buf, GREY, BG);
    }

    snprintf(buf, sizeof(buf), "%02u:%02u", (unsigned)t.hours, (unsigned)t.minutes);
    if (strcmp(buf, shown_time) != 0) {
        strcpy(shown_time, buf);
        ui_text_center(f_big, HOME_TIME_Y, 17, 111, buf, TEXT, BG);
    }

    uint8_t wd = t.weekday % 7, mo = (t.month >= 1 && t.month <= 12) ? t.month - 1 : 0;
    snprintf(buf, sizeof(buf), "%s %u %s", UI_JOURS[wd], (unsigned)t.day, UI_MOIS[mo]);
    if (strcmp(buf, shown_date) != 0) {
        strcpy(shown_date, buf);
        ui_text_center(f_small, HOME_DATE_Y, 18, 110, buf, GREY, BG);
    }

    home_row(full, &st);
}

// Valeur en texte : le nom complet s'il tient dans `max_w` avec la police `f`, sinon
// le nom court (les noms d'effets longs ne tiennent pas dans l'anneau).
static void value_fit(uint8_t item, char *buf, size_t n, painter_font_handle_t f, int16_t max_w) {
    ui_value_text(item, buf, n, false);
    if (ui_text_width(f, buf) > max_w) ui_value_text(item, buf, n, true);
}

// ---------------------------------------------------------------------------
// Menu (carrousel)

#define MENU_LABEL_Y 77
#define MENU_VALUE_Y 94
#define MENU_DOTS_Y  110

static void menu_draw(bool full) {
    if (full) {
        clear_all();
        ring_paint(0, 3600, TRACK);
    }
    uint8_t sel = ui.sel, prev = (sel + IT_COUNT - 1) % IT_COUNT, next = (sel + 1) % IT_COUNT;
    ui_image(ic26[sel], 51, 39, ACCENT, BG);
    ui_image(ic18[prev], 15, 43, DIM, BG);
    ui_image(ic18[next], 95, 43, DIM, BG);

    ui_text_center(f_mid, MENU_LABEL_Y, 19, 109, UI_ITEM_LABEL[sel], TEXT, BG);

    char buf[20];
    value_fit(sel, buf, sizeof(buf), f_small, 68);
    ui_text_center(f_small, MENU_VALUE_Y, 30, 98, buf, GREY, BG);

    int16_t x0 = (UI_W - (IT_COUNT * 4 + (IT_COUNT - 1) * 3)) / 2;
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        if (!full && i != sel && i != shown_menu_sel) continue;   // seuls les deux points concernés changent
        int16_t x = x0 + i * 7;
        ui_fill(x, MENU_DOTS_Y, x + 3, MENU_DOTS_Y + 3, i == sel ? ACCENT : DOTOFF);
    }
    shown_menu_sel = sel;
}

// ---------------------------------------------------------------------------
// Réglage

#define EDIT_ICON_Y  22
#define EDIT_LABEL_Y 43
#define EDIT_VALUE_Y 58
#define EDIT_HINT_Y  88

static uint16_t edit_angle(void) {
    uint32_t a = (uint32_t)ui_value_permille(ui.sel) * 36 / 10;
    if (a < 72) a = 72;   // toujours un petit bout d'arc visible
    if (a > 3600) a = 3600;
    return (uint16_t)a;
}

static col_t edit_color(void) {
    return ui.sel == IT_HUE ? ui_hue_color() : ACCENT;
}

static void edit_ring(bool full) {
    uint16_t a       = edit_angle();
    col_t    c       = edit_color();
    bool     recolor = c.h != shown_edit_col.h || c.s != shown_edit_col.s || c.v != shown_edit_col.v;
    if (full || recolor) {
        ring_paint(0, a, c);
        ring_paint(a, 3600, TRACK);
    } else if (a > shown_edit_angle) {
        ring_paint(shown_edit_angle, a, c);
    } else if (a < shown_edit_angle) {
        ring_paint(a, shown_edit_angle, TRACK);
    }
    shown_edit_angle = a;
    shown_edit_col   = c;
}

#define EDIT_MAX_W 92   // largeur de l'intérieur de l'anneau à cette hauteur

static void edit_value(bool full) {
    char buf[20];
    ui_value_text(ui.sel, buf, sizeof(buf), false);
    // Chiffres en grand ; noms en police moyenne, puis petite si trop larges, puis nom court.
    painter_font_handle_t f = f_big;
    if (ui.sel == IT_EFFECT || ui.sel == IT_THEME || ui.sel == IT_HUE || ui_text_width(f_big, buf) > EDIT_MAX_W) f = f_mid;
    if (f == f_mid && ui_text_width(f_mid, buf) > EDIT_MAX_W) f = f_small;
    if (ui_text_width(f, buf) > EDIT_MAX_W) ui_value_text(ui.sel, buf, sizeof(buf), true);
    if (!full && strcmp(buf, shown_value) == 0) return;
    strcpy(shown_value, buf);

    int16_t y = EDIT_VALUE_Y + (f_big->line_height - f->line_height) / 2;
    // La bande n'est effacée que si la police change (le texte se pose sinon par-dessus l'ancien).
    if (f != shown_edit_font) {
        ui_fill(17, EDIT_VALUE_Y, 110, EDIT_VALUE_Y + f_big->line_height - 1, BG);
        shown_edit_font = f;
    }
    ui_text_center(f, y, 17, 110, buf, TEXT, BG);
}

static void edit_draw(bool full) {
    if (full) {
        clear_all();
        shown_edit_font = NULL;
        col_t c = edit_color();
        ui_image(ic18[ui.sel], 55, EDIT_ICON_Y, c, BG);
        ui_text_center(f_small, EDIT_LABEL_Y, 22, 106, LABEL_UP[ui.sel], GREY, BG);
        ui_text_center(f_small, EDIT_HINT_Y, 28, 100, "appui : valider", GREY, BG);
    } else if (ui.sel == IT_HUE) {
        col_t c = edit_color();
        ui_image(ic18[ui.sel], 55, EDIT_ICON_Y, c, BG);
    }
    edit_ring(full);
    edit_value(full);
}

// ---------------------------------------------------------------------------

static void enter(void) {
    need_full_clear = true;
    f_big   = qp_load_font_mem(font_cadran_big);
    f_mid   = qp_load_font_mem(font_cadran_mid);
    f_small = qp_load_font_mem(font_cadran_small);
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        ic26[i] = qp_load_image_mem(ICON26[i]);
        ic18[i] = qp_load_image_mem(ICON18[i]);
    }
}

static void leave(void) {
    qp_close_font(f_big);
    qp_close_font(f_mid);
    qp_close_font(f_small);
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        qp_close_image(ic26[i]);
        qp_close_image(ic18[i]);
    }
}

static void draw(ui_screen_t screen, bool full) {
    switch (screen) {
        case SCR_HOME: home_draw(full); break;
        case SCR_MENU: menu_draw(full); break;
        case SCR_EDIT: edit_draw(full); break;
    }
}

const ui_theme_t theme_cadran = {"Cadran", enter, leave, draw};
