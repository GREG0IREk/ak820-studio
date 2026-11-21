// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Interface « Terminal » : police pixel verte sur fond noir.
//   - accueil : connexion et batterie, heure, barre des secondes, date, pied (Verr. Maj, effet) ;
//   - menu : liste des entrées, la ligne choisie en vidéo inversée ;
//   - réglage : valeur centrée, barre de caractères, pastille pour la couleur.
// Maquette : firmware/maquettes/terminal.dc.html (pixels réels de l'écran).
// Les petits textes sont en VT323 16 px : en dessous, « M » et « m » se confondent avec « N » et « n ».

#include <stdio.h>
#include <string.h>

#include "graphics/ui.h"

#include "res_terminal/term_huge.qff.h"
#include "res_terminal/term_big.qff.h"
#include "res_terminal/term_mid.qff.h"
#include "res_terminal/term_text.qff.h"

// Couleurs (TSV 0-255, converties depuis la maquette)
static const col_t BG    = {93, 85, 15};     // #0A0F0B fond
static const col_t PH    = {98, 158, 240};   // #5BF08A phosphore
static const col_t TRACK = {98, 147, 78};    // #214E2F trait discret (28 % du phosphore)
static const col_t DIM   = {98, 154, 139};   // #378B51 texte discret (55 %)

// Marges : 6 px en haut, 7 px sur les côtés (maquette), en retrait de 1 px pour les lignes du menu.
#define MARGIN_X 7
#define MARGIN_Y 6
#define RIGHT_X  120   // dernier pixel de la zone utile (128 - 7 - 1)

// Barre des secondes : retrait de 10 px de chaque côté de la zone utile.
#define BAR_X0 17
#define BAR_X1 110
#define BAR_W  (BAR_X1 - BAR_X0 + 1)
#define BAR_H  3

static painter_font_handle_t f_huge, f_big, f_mid, f_text;

// Ce qui est affiché, pour ne redessiner que ce qui change (-1 : rien d'affiché).
static char    shown_conn[16], shown_time[8], shown_date[32], shown_value[24];
static int16_t shown_bat, shown_caps, shown_eff, shown_bar_w, shown_sel, shown_hue, shown_bar_n;

static void clear_all(void) {
    ui_fill(0, 0, UI_W - 1, UI_H - 1, BG);
}

// Positions verticales, dérivées des hauteurs de ligne des polices (VT323 : 18 px pour le texte).
static int16_t line1_y(void)  { return MARGIN_Y + f_text->line_height + 1; }   // trait sous l'en-tête
static int16_t time_y(void)   { return line1_y() + 8; }
static int16_t bar_y(void)    { return time_y() + f_huge->line_height + 4; }   // barre des secondes
static int16_t date_y(void)   { return bar_y() + BAR_H + 6; }
// Menu : en-tête remonté à 2 px, sans trait, pour que six lignes de 18 px tiennent dans 128 px.
#define MENU_TOP 2
static int16_t menu_list_y(void) { return MENU_TOP + f_text->line_height; }
static int16_t foot_y(void)   { return UI_H - MARGIN_Y - f_text->line_height; }
static int16_t value_y(void)  { return line1_y() + 8; }                         // valeur du réglage
static int16_t swatch_y(void) { return value_y() + f_big->line_height + 3; }

// Majuscules pour le français : ASCII, et les lettres latines accentuées (U+00E0..U+00FE).
static void to_upper_fr(char *dst, size_t n, const char *src) {
    size_t i = 0, o = 0;
    while (src[i] && o + 1 < n) {
        unsigned char c = (unsigned char)src[i];
        if (c >= 'a' && c <= 'z') {
            dst[o++] = (char)(c - 32);
            i++;
        } else if (c == 0xC3 && src[i + 1] && o + 2 < n) {
            unsigned char d = (unsigned char)src[i + 1];
            if (d >= 0xA0 && d <= 0xBE && d != 0xB7) d -= 0x20;   // pas le signe ÷
            dst[o++] = (char)c;
            dst[o++] = (char)d;
            i += 2;
        } else {
            dst[o++] = src[i++];
        }
    }
    dst[o] = 0;
}

// ---------------------------------------------------------------------------
// Accueil

static void conn_text(const ui_status_t *st, char *buf, size_t n) {
    if (st->mode == CONN_USB) snprintf(buf, n, "USB");
    else if (st->mode == CONN_24G) snprintf(buf, n, st->connected ? "2,4 GHZ" : "2,4 GHZ ...");
    else snprintf(buf, n, st->connected ? "BT %u" : "BT %u ...", (unsigned)st->slot);
}

// En-tête : connexion à gauche, batterie à droite.
static void home_head(const ui_status_t *st) {
    char conn[16], bat[12];
    conn_text(st, conn, sizeof(conn));
    if (strcmp(conn, shown_conn) == 0 && (int16_t)st->battery == shown_bat) return;
    strcpy(shown_conn, conn);
    shown_bat = st->battery;

    if (st->battery == 0xFF) snprintf(bat, sizeof(bat), "BAT --%%");
    else snprintf(bat, sizeof(bat), "BAT %u%%", (unsigned)st->battery);

    int16_t y = MARGIN_Y, lh = f_text->line_height;
    ui_fill(MARGIN_X, y, RIGHT_X, y + lh - 1, BG);
    ui_text(f_text, MARGIN_X, y, conn, PH, BG);
    ui_text_right(f_text, RIGHT_X, y, bat, PH, BG);
}

// Barre des secondes : la partie remplie suit sec / 59.
static void home_seconds(uint8_t sec) {
    int16_t w  = (int16_t)((uint32_t)sec * BAR_W / 59);
    int16_t y0 = bar_y(), y1 = bar_y() + BAR_H - 1;
    if (shown_bar_w < 0) {
        ui_fill(BAR_X0, y0, BAR_X1, y1, TRACK);
        if (w > 0) ui_fill(BAR_X0, y0, BAR_X0 + w - 1, y1, PH);
    } else if (w > shown_bar_w) {
        ui_fill(BAR_X0 + shown_bar_w, y0, BAR_X0 + w - 1, y1, PH);
    } else if (w < shown_bar_w) {
        ui_fill(BAR_X0 + w, y0, BAR_X0 + shown_bar_w - 1, y1, TRACK);
    }
    shown_bar_w = w;
}

static void home_time(const rtc_time_t *t) {
    char buf[8];
    snprintf(buf, sizeof(buf), "%02u:%02u", (unsigned)t->hours, (unsigned)t->minutes);
    if (strcmp(buf, shown_time) == 0) return;
    strcpy(shown_time, buf);
    ui_text_center(f_huge, time_y(), MARGIN_X, RIGHT_X, buf, PH, BG);
}

static void home_date(const rtc_time_t *t) {
    char buf[32], up[32];
    uint8_t wd = t->weekday % 7, mo = (t->month >= 1 && t->month <= 12) ? t->month - 1 : 0;
    snprintf(buf, sizeof(buf), "%s %u %s", UI_JOURS[wd], (unsigned)t->day, UI_MOIS[mo]);
    to_upper_fr(up, sizeof(up), buf);
    if (strcmp(up, shown_date) == 0) return;
    strcpy(shown_date, up);
    ui_text_center(f_text, date_y(), MARGIN_X, RIGHT_X, up, PH, BG);
}

// Pied : « MAJ » à gauche (vidéo inversée si Verr. Maj), nom court de l'effet à droite.
static void home_foot(bool caps, uint8_t eff) {
    int16_t c = caps ? 1 : 0;
    if (c == shown_caps && (int16_t)eff == shown_eff) return;
    shown_caps = c;
    shown_eff  = eff;

    int16_t y = foot_y(), lh = f_text->line_height;
    int16_t w = ui_text_width(f_text, "MAJ");
    ui_fill(MARGIN_X, y, RIGHT_X, y + lh - 1, BG);
    if (caps) {
        // Fond phosphore avec 2 px de marge de chaque côté du texte.
        ui_fill(MARGIN_X, y, MARGIN_X + 2 + w + 2 - 1, y + lh - 1, PH);
        ui_text(f_text, MARGIN_X + 2, y, "MAJ", BG, PH);
    } else {
        ui_text(f_text, MARGIN_X + 2, y, "MAJ", DIM, BG);
    }

    char up[16];
    to_upper_fr(up, sizeof(up), ui_effect_short(eff));
    ui_text_right(f_text, RIGHT_X, y, up, PH, BG);
}

static void home_draw(bool full) {
    rtc_time_t  t;
    ui_status_t st;
    ui_time(&t);
    ui_status(&st);

    if (full) {
        clear_all();
        shown_conn[0] = shown_time[0] = shown_date[0] = 0;
        shown_bat = shown_caps = shown_eff = shown_bar_w = -1;
        ui_fill(MARGIN_X, line1_y(), RIGHT_X, line1_y(), TRACK);
    }
    home_head(&st);
    home_seconds(t.seconds);
    home_time(&t);
    home_date(&t);
    home_foot(st.caps, ui.eff_idx);
}

// ---------------------------------------------------------------------------
// Menu

// Une ligne du menu : libellé à gauche, valeur courte à droite. La ligne choisie est en vidéo inversée.
static void menu_row(uint8_t i, bool sel) {
    int16_t y  = menu_list_y() + i * f_text->line_height;
    int16_t h  = f_text->line_height;
    col_t   bg = sel ? PH : BG;
    col_t   fg = sel ? BG : PH;
    col_t   vg = sel ? BG : DIM;

    char val[20];
    ui_value_text(i, val, sizeof(val), true);

    ui_fill(MARGIN_X, y, RIGHT_X, y + h - 1, bg);
    ui_text(f_text, MARGIN_X + 1, y, UI_ITEM_LABEL[i], fg, bg);
    ui_text_right(f_text, RIGHT_X - 1, y, val, vg, bg);
}

// Position « n/6 » à droite de l'en-tête.
static void menu_pos(uint8_t sel) {
    char pos[8];
    snprintf(pos, sizeof(pos), "%u/%u", (unsigned)sel + 1, (unsigned)IT_COUNT);
    ui_fill(90, MENU_TOP, RIGHT_X, MENU_TOP + f_text->line_height - 1, BG);
    ui_text_right(f_text, RIGHT_X, MENU_TOP, pos, DIM, BG);
}

static void menu_draw(bool full) {
    uint8_t sel = ui.sel;
    if (full) {
        clear_all();
        ui_text(f_text, MARGIN_X, MENU_TOP, "> MENU", PH, BG);
        for (uint8_t i = 0; i < IT_COUNT; i++) menu_row(i, i == sel);
    } else if (sel == shown_sel) {
        return;
    } else {
        // Seules l'ancienne et la nouvelle ligne choisies changent.
        menu_row((uint8_t)shown_sel, false);
        menu_row(sel, true);
    }
    menu_pos(sel);
    shown_sel = sel;
}

// ---------------------------------------------------------------------------
// Réglage

static void edit_value(void) {
    char buf[24];
    ui_value_text(ui.sel, buf, sizeof(buf), false);
    if (strcmp(buf, shown_value) == 0) return;
    strcpy(shown_value, buf);

    // Les nombres en grand ; un nom d'effet ou d'interface, ou un texte trop large, en moyen.
    bool                  big = ui.sel != IT_EFFECT && ui.sel != IT_THEME && ui_text_width(f_big, buf) <= RIGHT_X - MARGIN_X - 8;
    painter_font_handle_t f   = big ? f_big : f_mid;
    int16_t               y   = big ? value_y() : value_y() + (f_big->line_height - f_mid->line_height) / 2;

    ui_fill(MARGIN_X, value_y(), RIGHT_X, value_y() + f_big->line_height - 1, BG);
    ui_text(f, (UI_W - ui_text_width(f, buf)) / 2, y, buf, PH, BG);
}

// Pastille de la couleur choisie, 40 × 6 px, sous la valeur (réglage Couleur seulement).
static void edit_swatch(void) {
    if (ui.sel != IT_HUE || ui.hue_deg == shown_hue) return;
    shown_hue = ui.hue_deg;
    ui_fill((UI_W - 40) / 2, swatch_y(), (UI_W - 40) / 2 + 39, swatch_y() + 5, ui_hue_color());
}

// Barre « [######....] » de 10 cases.
static int16_t edit_bar_y(void) {
    return ui.sel == IT_HUE ? swatch_y() + 6 + 6 : value_y() + f_big->line_height + 8;
}

static void edit_bar(void) {
    int16_t n = (ui_value_permille(ui.sel) + 50) / 100;
    if (n > 10) n = 10;
    if (n == shown_bar_n) return;
    shown_bar_n = n;

    char bar[14];
    bar[0] = '[';
    for (int16_t k = 0; k < 10; k++) bar[1 + k] = k < n ? '#' : '.';
    bar[11] = ']';
    bar[12] = 0;

    ui_text_center(f_text, edit_bar_y(), MARGIN_X, RIGHT_X, bar, PH, BG);
}

static void edit_draw(bool full) {
    uint8_t sel = ui.sel;
    if (full) {
        clear_all();
        char up[24], head[32];
        to_upper_fr(up, sizeof(up), UI_ITEM_LABEL[sel]);
        snprintf(head, sizeof(head), "> %s", up);
        ui_text(f_text, MARGIN_X, MARGIN_Y, head, PH, BG);
        ui_fill(MARGIN_X, line1_y(), RIGHT_X, line1_y(), TRACK);
        // Une seule ligne d'aide : deux lignes ne tiennent pas en 16 px.
        ui_text(f_text, MARGIN_X, foot_y(), "APPUI : VALIDER", DIM, BG);
        shown_value[0] = 0;
        shown_hue = shown_bar_n = -1;
    }
    edit_value();
    edit_swatch();
    edit_bar();
}

// ---------------------------------------------------------------------------

static void enter(void) {
    f_huge = qp_load_font_mem(font_term_huge);
    f_big  = qp_load_font_mem(font_term_big);
    f_mid  = qp_load_font_mem(font_term_mid);
    f_text = qp_load_font_mem(font_term_text);
}

static void leave(void) {
    qp_close_font(f_huge);
    qp_close_font(f_big);
    qp_close_font(f_mid);
    qp_close_font(f_text);
}

static void draw(ui_screen_t screen, bool full) {
    switch (screen) {
        case SCR_HOME: home_draw(full); break;
        case SCR_MENU: menu_draw(full); break;
        case SCR_EDIT: edit_draw(full); break;
    }
}

const ui_theme_t theme_terminal = {"Terminal", enter, leave, draw};
