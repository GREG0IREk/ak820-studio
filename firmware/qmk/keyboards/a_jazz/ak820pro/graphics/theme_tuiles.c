// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Interface « Tuiles » : fond clair, tuiles blanches aux coins arrondis.
//   - accueil : heure, date, Verr. Maj, batterie, connexion, effet ;
//   - menu : grille de 3 × 2 tuiles, la tuile choisie en bleu ;
//   - réglage : grande tuile, valeur, barre de 10 segments.
// Maquette : firmware/maquettes/tuiles.dc.html (voir firmware/ECRAN.md).

#include <stdio.h>
#include <string.h>

#include "graphics/ui.h"

#include "res_tuiles/tui_time.qff.h"
#include "res_tuiles/tui_value.qff.h"
#include "res_tuiles/tui_mid.qff.h"
#include "res_tuiles/tui_bold.qff.h"
#include "res_tuiles/tui_small.qff.h"
#include "res_tuiles/ic_effet_12.qgf.h"
#include "res_tuiles/ic_lumiere_12.qgf.h"
#include "res_tuiles/ic_vitesse_12.qgf.h"
#include "res_tuiles/ic_couleur_12.qgf.h"
#include "res_tuiles/ic_veille_12.qgf.h"
#include "res_tuiles/ic_ecran_12.qgf.h"
#include "res_cadran/ic_effet_18.qgf.h"
#include "res_cadran/ic_lumiere_18.qgf.h"
#include "res_cadran/ic_vitesse_18.qgf.h"
#include "res_cadran/ic_couleur_18.qgf.h"
#include "res_cadran/ic_veille_18.qgf.h"
#include "res_cadran/ic_ecran_18.qgf.h"

// Couleurs (TSV 0-255, celles de la maquette). Les fonds des textes et des
// icônes sont blancs (s = 0) : voir ui_text dans ui.h.
static const col_t BG         = {154, 9, 235};    // #E3E6EB fond
static const col_t TILE       = {0, 0, 255};      // #FFFFFF tuiles
static const col_t TEXT       = {159, 73, 28};    // #14161C texte
static const col_t SUB        = {155, 41, 107};   // #5A606B texte secondaire
static const col_t ACCENT     = {162, 205, 240}; // #2F55F0 bleu
static const col_t ACCENT_SUB = {162, 27, 255};   // #E4E9FF valeur sur fond bleu
static const col_t GREEN      = {103, 205, 157}; // #1F9D55 batterie
static const col_t TRACK      = {156, 10, 234};  // #E1E4EA piste vide
static const col_t OFF_DOT    = {155, 18, 198};  // #B8BDC6 effet éteint
static const col_t ORANGE     = {15, 242, 232};  // #E8590C arc-en-ciel

static const char *const NOM_COURT[IT_COUNT] = {"Effet", "Lumière", "Vitesse", "Couleur", "Veille", "Écran"};

static const uint8_t *const ICON12[IT_COUNT] = {gfx_ic_effet_12, gfx_ic_lumiere_12, gfx_ic_vitesse_12, gfx_ic_couleur_12, gfx_ic_veille_12, gfx_ic_ecran_12};
static const uint8_t *const ICON18[IT_COUNT] = {gfx_ic_effet_18, gfx_ic_lumiere_18, gfx_ic_vitesse_18, gfx_ic_couleur_18, gfx_ic_veille_18, gfx_ic_ecran_18};

// Grille du menu : colonnes et lignes (bornes incluses).
static const int16_t MENU_X0[3] = {4, 45, 86};
static const int16_t MENU_X1[3] = {40, 81, 123};
static const int16_t MENU_Y0[2] = {4, 66};
static const int16_t MENU_Y1[2] = {61, 123};

static painter_font_handle_t  f_time, f_value, f_mid, f_bold, f_small;
static painter_image_handle_t ic12[IT_COUNT], ic18[IT_COUNT];

// Ce qui est affiché, pour ne redessiner que ce qui change.
static char     shown_time[8], shown_date[24], shown_conn[24];
static uint8_t  shown_bat;
static int8_t   shown_caps;
static uint8_t  shown_eff;
static col_t    shown_dot;
static uint8_t  shown_sel;
static char     shown_val[20];
static col_t    shown_val_col;
static uint8_t  shown_n;
static col_t    shown_seg_col;

static bool same(col_t a, col_t b) {
    return a.h == b.h && a.s == b.s && a.v == b.v;
}

// ---------------------------------------------------------------------------
// Tuiles

// Quantum Painter ne sait pas dessiner de rectangle arrondi. On repeint en
// fond les pixels d'angle situés hors d'un quart de cercle de rayon 4 : trois
// pixels par angle, soit un arrondi de 2 à 3 px.
#define CORNER 4

static void round_corners(int16_t x0, int16_t y0, int16_t x1, int16_t y1, col_t bg) {
    for (int16_t j = 0; j < CORNER; j++) {
        for (int16_t i = 0; i < CORNER; i++) {
            // Centre du pixel (i, j) par rapport au centre du quart de cercle, en demi-pixels.
            int32_t dx = 2 * i + 1 - 2 * CORNER;
            int32_t dy = 2 * j + 1 - 2 * CORNER;
            if (dx * dx + dy * dy <= (2 * CORNER) * (2 * CORNER)) continue;
            ui_fill(x0 + i, y0 + j, x0 + i, y0 + j, bg);
            ui_fill(x1 - i, y0 + j, x1 - i, y0 + j, bg);
            ui_fill(x0 + i, y1 - j, x0 + i, y1 - j, bg);
            ui_fill(x1 - i, y1 - j, x1 - i, y1 - j, bg);
        }
    }
}

// Tuile pleine sur le fond, coins arrondis.
static void tile(int16_t x0, int16_t y0, int16_t x1, int16_t y1, col_t c) {
    ui_fill(x0, y0, x1, y1, c);
    round_corners(x0, y0, x1, y1, BG);
}

// ---------------------------------------------------------------------------
// Accueil

static void home_clock(const char *hhmm, const char *date, bool caps) {
    tile(4, 4, 123, 63, TILE);
    int16_t top = 4 + (60 - (f_time->line_height + 3 + f_small->line_height)) / 2;
    ui_text(f_time, 12, top, hhmm, TEXT, TILE);
    ui_text(f_small, 12, top + f_time->line_height + 3, date, SUB, TILE);
    if (caps) {
        // Pastille en coin, plus près du bord que la maquette : l'heure
        // « 09:05 » de cette police touche sinon le coin de la pastille.
        int16_t x1 = 119, y0 = 6;
        int16_t w  = ui_text_width(f_bold, "MAJ") + 4;   // 2 px de part et d'autre
        int16_t h  = f_bold->line_height + 2;
        ui_fill(x1 - w + 1, y0, x1, y0 + h - 1, ACCENT);
        round_corners(x1 - w + 1, y0, x1, y0 + h - 1, TILE);
        ui_text(f_bold, x1 - w + 3, y0 + 1, "MAJ", TILE, ACCENT);
    }
}

// Libellé (police fine) puis valeur (police grasse) dans une tuile de deux
// lignes : le bloc est centré verticalement, tout le texte reste dans la tuile.
// Renvoie le haut du libellé ; la valeur est à `top + f_small->line_height + 2`.
static int16_t two_lines_top(int16_t y0, int16_t y1) {
    int16_t h = f_small->line_height + 2 + f_bold->line_height;
    return y0 + (y1 - y0 + 1 - h) / 2;
}

static void battery_tile(uint8_t bat) {
    tile(4, 68, 61, 95, TILE);
    int16_t top = two_lines_top(68, 95);
    ui_text(f_small, 10, top, "Batterie", SUB, TILE);
    int16_t vy = top + f_small->line_height + 2;

    char buf[8];
    if (bat == 0xFF) snprintf(buf, sizeof(buf), "-- %%");
    else snprintf(buf, sizeof(buf), "%u %%", (unsigned)bat);
    ui_text(f_bold, 10, vy, buf, TEXT, TILE);

    int16_t bx0 = 10 + ui_text_width(f_bold, buf) + 4, bx1 = 55;
    int16_t by  = vy + (f_bold->line_height - 4) / 2;
    ui_fill(bx0, by, bx1, by + 3, TRACK);
    int16_t w = (bx1 - bx0 + 1) * (bat == 0xFF ? 0 : bat) / 100;
    if (w > 0) ui_fill(bx0, by, bx0 + w - 1, by + 3, GREEN);
}

static void conn_text(const ui_status_t *st, char *buf, size_t n) {
    if (st->mode == CONN_USB) snprintf(buf, n, "USB");
    else if (st->mode == CONN_24G) snprintf(buf, n, "2,4 GHz");
    else snprintf(buf, n, "BT %u", (unsigned)st->slot);
    if (st->mode != CONN_USB && !st->connected) strncat(buf, " ...", n - strlen(buf) - 1);
}

static void conn_tile(const char *txt) {
    tile(66, 68, 123, 95, TILE);
    int16_t top = two_lines_top(68, 95);
    ui_text(f_small, 72, top, "Connexion", SUB, TILE);
    ui_text(f_bold, 72, top + f_small->line_height + 2, txt, TEXT, TILE);
}

// Couleur de la pastille : gris pour « Éteint », orange pour un effet multicolore.
static col_t effect_dot(uint8_t i) {
    if (ui_effect_is_off(i)) return OFF_DOT;
    if (ui_effect_rainbow(i)) return ORANGE;
    return ui_hue_color();
}

// Disque de 7 px de diamètre, coin haut gauche en (x, y). qp_circle donne un
// losange à ce rayon, d'où un dessin ligne par ligne.
static void dot7(int16_t x, int16_t y, col_t c) {
    static const int16_t INSET[7] = {2, 1, 0, 0, 0, 1, 2};
    for (int16_t r = 0; r < 7; r++) ui_fill(x + INSET[r], y + r, x + 6 - INSET[r], y + r, c);
}

static void effect_tile(uint8_t i, col_t dot) {
    tile(4, 100, 123, 123, TILE);
    dot7(12, 109, dot);
    ui_text(f_bold, 24, 100 + (24 - f_bold->line_height) / 2, ui_effect_name(i), TEXT, TILE);
}

static void home_draw(bool full) {
    rtc_time_t  t;
    ui_status_t st;
    ui_time(&t);
    ui_status(&st);

    if (full) {
        ui_fill(0, 0, UI_W - 1, UI_H - 1, BG);
        shown_time[0] = shown_date[0] = shown_conn[0] = 0;
        shown_bat = 0xFE;   // valeur impossible : tout est à dessiner
        shown_caps = -1;
        shown_eff  = 0xFF;
    }

    char time[8], date[24];
    uint8_t wd = t.weekday % 7, mo = (t.month >= 1 && t.month <= 12) ? t.month - 1 : 0;
    snprintf(time, sizeof(time), "%02u:%02u", (unsigned)t.hours, (unsigned)t.minutes);
    snprintf(date, sizeof(date), "%s %u %s", UI_JOURS[wd], (unsigned)t.day, UI_MOIS[mo]);
    int8_t caps = st.caps ? 1 : 0;
    if (strcmp(time, shown_time) != 0 || strcmp(date, shown_date) != 0 || caps != shown_caps) {
        strcpy(shown_time, time);
        strcpy(shown_date, date);
        shown_caps = caps;
        home_clock(time, date, st.caps);
    }

    if (st.battery != shown_bat) {
        shown_bat = st.battery;
        battery_tile(st.battery);
    }

    char conn[24];
    conn_text(&st, conn, sizeof(conn));
    if (strcmp(conn, shown_conn) != 0) {
        strcpy(shown_conn, conn);
        conn_tile(conn);
    }

    col_t dot = effect_dot(ui.eff_idx);
    if (ui.eff_idx != shown_eff || !same(dot, shown_dot)) {
        shown_eff = ui.eff_idx;
        shown_dot = dot;
        effect_tile(ui.eff_idx, dot);
    }
}

// ---------------------------------------------------------------------------
// Menu (grille de 3 × 2)

// Police des noms du menu : gras, sauf si un nom touche les bords de la tuile
// (« Lumière » et « Vitesse » en gras, tuile de 37 px). Dans ce cas, tous les
// noms passent en police fine pour rester alignés.
#define MENU_NAME_W 33

static painter_font_handle_t menu_name_font(void) {
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        if (ui_text_width(f_bold, NOM_COURT[i]) > MENU_NAME_W) return f_small;
    }
    return f_bold;
}

static void menu_tile(uint8_t i, bool sel) {
    int16_t x0 = MENU_X0[i % 3], x1 = MENU_X1[i % 3];
    int16_t y0 = MENU_Y0[i / 3], y1 = MENU_Y1[i / 3];
    col_t   bg  = sel ? ACCENT : TILE;
    col_t   fg  = sel ? TILE : TEXT;
    col_t   sub = sel ? ACCENT_SUB : SUB;

    char val[20];
    ui_value_text(i, val, sizeof(val), true);
    painter_font_handle_t fn = menu_name_font();

    tile(x0, y0, x1, y1, bg);

    const int16_t gap = 3;
    int16_t cx = (x0 + x1 + 1) / 2;
    int16_t h  = 18 + gap + fn->line_height + gap + f_small->line_height;
    int16_t y  = y0 + (y1 - y0 + 1 - h) / 2;

    ui_image(ic18[i], cx - 9, y, fg, bg);
    y += 18 + gap;
    ui_text(fn, cx - ui_text_width(fn, NOM_COURT[i]) / 2, y, NOM_COURT[i], fg, bg);
    y += fn->line_height + gap;
    ui_text(f_small, cx - ui_text_width(f_small, val) / 2, y, val, sub, bg);
}

static void menu_draw(bool full) {
    if (full) {
        ui_fill(0, 0, UI_W - 1, UI_H - 1, BG);
        for (uint8_t i = 0; i < IT_COUNT; i++) menu_tile(i, i == ui.sel);
        shown_sel = ui.sel;
    } else if (ui.sel != shown_sel) {
        menu_tile(shown_sel, false);
        menu_tile(ui.sel, true);
        shown_sel = ui.sel;
    }
}

// ---------------------------------------------------------------------------
// Réglage

#define EDIT_TEXT_W 100   // largeur utile de la tuile : x 14 à 113

// Bande de la valeur : sous le libellé, au-dessus de la barre.
static int16_t edit_bar_y(void) {
    return 113 - f_small->line_height + 1 - 14;   // aide en bas, puis 6 px, puis la barre
}

static int16_t edit_value_mid(void) {
    int16_t top = 14 + (f_bold->line_height > 12 ? f_bold->line_height : 12) + 4;
    int16_t bot = edit_bar_y() - 5;
    return (top + bot) / 2;
}

static painter_font_handle_t value_font(uint8_t item, const char *txt) {
    bool numeric = item == IT_BRIGHT || item == IT_SPEED ||
                   (item == IT_SLEEP && strcmp(txt, "Jamais") != 0);
    if (numeric && ui_text_width(f_value, txt) <= EDIT_TEXT_W) return f_value;
    if (ui_text_width(f_mid, txt) <= EDIT_TEXT_W) return f_mid;
    return f_bold;   // dernier recours : trop large pour la police moyenne
}

static void edit_value(bool full) {
    char buf[20];
    ui_value_text(ui.sel, buf, sizeof(buf), false);
    bool hue = ui.sel == IT_HUE;
    col_t pc = hue ? ui_hue_color() : TILE;
    if (!full && strcmp(buf, shown_val) == 0 && (!hue || same(pc, shown_val_col))) return;
    strcpy(shown_val, buf);
    shown_val_col = pc;

    // Efface la plus grande des deux polices, puis écrit centré sur la bande.
    int16_t lh = f_value->line_height > f_mid->line_height ? f_value->line_height : f_mid->line_height;
    int16_t cy = edit_value_mid();
    ui_fill(14, cy - lh / 2, 113, cy - lh / 2 + lh - 1, TILE);

    painter_font_handle_t f = value_font(ui.sel, buf);
    int16_t               w = ui_text_width(f, buf);
    ui_text(f, 14, cy - f->line_height / 2, buf, TEXT, TILE);
    if (hue) qp_circle(ui_dev, 14 + w + 6 + 7, cy, 7, COL(pc), true);   // pastille de 14 px
}

static void edit_segs(bool full) {
    uint16_t p = ui_value_permille(ui.sel);
    uint8_t  n = (uint8_t)((p + 50) / 100);
    if (n < 1) n = 1;
    if (n > 10) n = 10;
    col_t c = ui.sel == IT_HUE ? ui_hue_color() : ACCENT;
    if (!full && n == shown_n && same(c, shown_seg_col)) return;
    shown_n       = n;
    shown_seg_col = c;

    int16_t y = edit_bar_y();
    for (uint8_t i = 0; i < 10; i++) {
        int16_t x = 14 + i * 10;   // segments de 8 px, 2 px d'écart
        ui_fill(x, y, x + 7, y + 7, i < n ? c : TRACK);
    }
}

static void edit_draw(bool full) {
    if (full) {
        ui_fill(0, 0, UI_W - 1, UI_H - 1, BG);
        tile(4, 4, 123, 123, TILE);
        ui_image(ic12[ui.sel], 14, 14, ACCENT, TILE);
        ui_text(f_bold, 30, 14 + (12 - f_bold->line_height) / 2, UI_ITEM_LABEL[ui.sel], TEXT, TILE);
        ui_text(f_small, 14, 113 - f_small->line_height + 1, "Appui : valider", SUB, TILE);
    }
    edit_value(full);
    edit_segs(full);
}

// ---------------------------------------------------------------------------

static void enter(void) {
    f_time  = qp_load_font_mem(font_tui_time);
    f_value = qp_load_font_mem(font_tui_value);
    f_mid   = qp_load_font_mem(font_tui_mid);
    f_bold  = qp_load_font_mem(font_tui_bold);
    f_small = qp_load_font_mem(font_tui_small);
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        ic12[i] = qp_load_image_mem(ICON12[i]);
        ic18[i] = qp_load_image_mem(ICON18[i]);
    }
}

static void leave(void) {
    qp_close_font(f_time);
    qp_close_font(f_value);
    qp_close_font(f_mid);
    qp_close_font(f_bold);
    qp_close_font(f_small);
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        qp_close_image(ic12[i]);
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

const ui_theme_t theme_tuiles = {"Tuiles", enter, leave, draw};
