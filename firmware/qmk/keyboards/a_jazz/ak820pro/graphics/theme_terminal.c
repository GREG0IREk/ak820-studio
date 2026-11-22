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

// Ce qui est affiché, pour ne redessiner que ce qui change (vide ou -1 : rien d'affiché).
static char                  shown_conn[16], shown_bat[12], shown_time[8], shown_date[32], shown_value[24], shown_bar[14], shown_pos[8];
static int16_t               shown_caps, shown_eff, shown_bar_w, shown_sel, shown_hue;
static painter_font_handle_t shown_font;

// Règle : jamais d'effacement suivi d'une réécriture. Les cellules de glyphes couvrent toute la
// hauteur de la police : un texte écrit par-dessus l'ancien le remplace. Un redessin complet
// peint chaque pixel une seule fois (textes en place, fond seulement entre eux).
static void gap(int16_t y0, int16_t y1) {
    ui_fill(0, y0, UI_W - 1, y1, BG);
}

// Réécrit seulement les caractères qui diffèrent entre `old` et `s`, à x (premier caractère).
// Faux si les deux textes ne se superposent pas case pour case (longueurs ou largeurs
// différentes, caractères hors ASCII) : l'appelant redessine alors tout le texte.
static bool text_diff(painter_font_handle_t f, int16_t x, int16_t y, const char *old, const char *s, col_t fg, col_t bg) {
    size_t n = strlen(s);
    if (!old[0] || strlen(old) != n) return false;
    char pre[32];
    if (n >= sizeof(pre)) return false;
    for (size_t i = 0; i < n; i++) {
        if ((unsigned char)s[i] >= 0x80 || (unsigned char)old[i] >= 0x80) return false;
        char a[2] = {old[i], 0}, b[2] = {s[i], 0};
        if (ui_text_width(f, a) != ui_text_width(f, b)) return false;
    }
    for (size_t i = 0; i < n; i++) {
        if (old[i] == s[i]) continue;
        memcpy(pre, s, i);
        pre[i]    = 0;
        char c[2] = {s[i], 0};
        ui_text(f, x + ui_text_width(f, pre), y, c, fg, bg);
    }
    return true;
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

// En-tête : connexion à gauche, batterie à droite. Chaque texte n'est réécrit que s'il change ;
// le fond n'est repeint qu'entre les deux textes (et dans les marges d'un redessin complet).
static void home_head(const ui_status_t *st, bool full) {
    char conn[16], bat[12];
    conn_text(st, conn, sizeof(conn));
    if (st->battery == 0xFF) snprintf(bat, sizeof(bat), "BAT --%%");
    else snprintf(bat, sizeof(bat), "BAT %u%%", (unsigned)st->battery);
    bool dl = full || strcmp(conn, shown_conn) != 0;
    bool dr = full || strcmp(bat, shown_bat) != 0;
    if (!dl && !dr) return;

    int16_t y = MARGIN_Y, yb = y + f_text->line_height - 1;
    int16_t lend = MARGIN_X + ui_text_width(f_text, conn);
    int16_t rx   = RIGHT_X + 1 - ui_text_width(f_text, bat);
    bool    ldif = false, rdif = false;

    if (full) ui_fill(0, y, MARGIN_X - 1, yb, BG);
    if (dl) {
        ldif = text_diff(f_text, MARGIN_X, y, shown_conn, conn, PH, BG);
        if (!ldif) ui_text(f_text, MARGIN_X, y, conn, PH, BG);
    }
    // Le trou entre les deux textes n'est repeint que si l'un des deux a changé de largeur.
    if ((dl && !ldif) || (dr && (full || strlen(bat) != strlen(shown_bat)))) ui_fill(lend, y, rx - 1, yb, BG);
    if (dr) {
        rdif = text_diff(f_text, rx, y, shown_bat, bat, PH, BG);
        if (!rdif) ui_text(f_text, rx, y, bat, PH, BG);
    }
    if (full) ui_fill(RIGHT_X + 1, y, UI_W - 1, yb, BG);
    strcpy(shown_conn, conn);
    strcpy(shown_bat, bat);
}

// Barre des secondes : la partie remplie suit sec / 59.
static void home_seconds(uint8_t sec) {
    int16_t w  = (int16_t)((uint32_t)sec * BAR_W / 59);
    int16_t y0 = bar_y(), y1 = bar_y() + BAR_H - 1;
    if (shown_bar_w < 0) {
        // Redessin complet : marges, partie remplie, reste du trait, chacun une seule fois.
        ui_fill(0, y0, BAR_X0 - 1, y1, BG);
        if (w > 0) ui_fill(BAR_X0, y0, BAR_X0 + w - 1, y1, PH);
        ui_fill(BAR_X0 + w, y0, BAR_X1, y1, TRACK);
        ui_fill(BAR_X1 + 1, y0, UI_W - 1, y1, BG);
    } else if (w > shown_bar_w) {
        ui_fill(BAR_X0 + shown_bar_w, y0, BAR_X0 + w - 1, y1, PH);
    } else if (w < shown_bar_w) {
        ui_fill(BAR_X0 + w, y0, BAR_X0 + shown_bar_w - 1, y1, TRACK);
    }
    shown_bar_w = w;
}

// Texte centré sur l'écran qui change : seuls les caractères différents sont réécrits quand les
// largeurs correspondent, sinon le texte est écrit en place sur [x0, x1] (tout l'écran si full).
static void centered_change(painter_font_handle_t f, int16_t y, bool full, const char *old, const char *s, col_t fg) {
    int16_t x = (UI_W - ui_text_width(f, s)) / 2;
    if (text_diff(f, x, y, old, s, fg, BG)) return;
    ui_text_center(f, y, full ? 0 : MARGIN_X, full ? UI_W - 1 : RIGHT_X, s, fg, BG);
}

static void home_time(const rtc_time_t *t, bool full) {
    char buf[8], old[8];
    snprintf(buf, sizeof(buf), "%02u:%02u", (unsigned)t->hours, (unsigned)t->minutes);
    if (strcmp(buf, shown_time) == 0) return;
    strcpy(old, shown_time);
    strcpy(shown_time, buf);
    centered_change(f_huge, time_y(), full, old, buf, PH);
}

static void home_date(const rtc_time_t *t, bool full) {
    char buf[32], up[32], old[32];
    uint8_t wd = t->weekday % 7, mo = (t->month >= 1 && t->month <= 12) ? t->month - 1 : 0;
    snprintf(buf, sizeof(buf), "%s %u %s", UI_JOURS[wd], (unsigned)t->day, UI_MOIS[mo]);
    to_upper_fr(up, sizeof(up), buf);
    if (strcmp(up, shown_date) == 0) return;
    strcpy(old, shown_date);
    strcpy(shown_date, up);
    centered_change(f_text, date_y(), full, old, up, PH);
}

// Pied : « MAJ » à gauche (vidéo inversée si Verr. Maj), nom court de l'effet à droite.
// Verr. Maj ne repeint que le bloc de gauche, l'effet que le trou et le texte de droite.
static void home_foot(bool caps, uint8_t eff, bool full) {
    int16_t c  = caps ? 1 : 0;
    bool    dl = full || c != shown_caps, dr = full || (int16_t)eff != shown_eff;
    if (!dl && !dr) return;
    shown_caps = c;
    shown_eff  = eff;

    int16_t y = foot_y(), yb = y + f_text->line_height - 1;
    int16_t w    = ui_text_width(f_text, "MAJ");
    int16_t lend = MARGIN_X + 2 + w + 2;   // fin du bloc de gauche : 2 px de marge de chaque côté du texte

    if (full) ui_fill(0, y, MARGIN_X - 1, yb, BG);
    if (dl) {
        col_t lb = caps ? PH : BG;   // fond phosphore avec Verr. Maj
        ui_fill(MARGIN_X, y, MARGIN_X + 1, yb, lb);
        ui_text(f_text, MARGIN_X + 2, y, "MAJ", caps ? BG : DIM, lb);
        ui_fill(MARGIN_X + 2 + w, y, lend - 1, yb, lb);
    }
    if (dr) {
        char up[16];
        to_upper_fr(up, sizeof(up), ui_effect_short(eff));
        int16_t rx = RIGHT_X + 1 - ui_text_width(f_text, up);
        ui_fill(lend, y, rx - 1, yb, BG);
        ui_text(f_text, rx, y, up, PH, BG);
    }
    if (full) ui_fill(RIGHT_X + 1, y, UI_W - 1, yb, BG);
}

static void home_draw(bool full) {
    rtc_time_t  t;
    ui_status_t st;
    ui_time(&t);
    ui_status(&st);
    int16_t lh = f_text->line_height;

    // Redessin complet : de haut en bas, chaque pixel est peint une seule fois (pas de clear_all).
    if (full) {
        shown_conn[0] = shown_bat[0] = shown_time[0] = shown_date[0] = 0;
        shown_caps = shown_eff = shown_bar_w = -1;
        gap(0, MARGIN_Y - 1);
    }
    home_head(&st, full);
    if (full) {
        gap(MARGIN_Y + lh, line1_y() - 1);
        ui_fill(0, line1_y(), MARGIN_X - 1, line1_y(), BG);
        ui_fill(MARGIN_X, line1_y(), RIGHT_X, line1_y(), TRACK);
        ui_fill(RIGHT_X + 1, line1_y(), UI_W - 1, line1_y(), BG);
        gap(line1_y() + 1, time_y() - 1);
    }
    home_time(&t, full);
    if (full) gap(time_y() + f_huge->line_height, bar_y() - 1);
    home_seconds(t.seconds);
    if (full) gap(bar_y() + BAR_H, date_y() - 1);
    home_date(&t, full);
    if (full) gap(date_y() + lh, foot_y() - 1);
    home_foot(st.caps, ui.eff_idx, full);
    if (full) gap(foot_y() + lh, UI_H - 1);
}

// ---------------------------------------------------------------------------
// Menu

// Une ligne du menu : libellé à gauche, valeur courte à droite. La ligne choisie est en vidéo inversée.
// Le fond change sur toute la ligne : on écrit le libellé et la valeur, puis seulement les trous.
static void menu_row(uint8_t i, bool sel, bool full) {
    int16_t y  = menu_list_y() + i * f_text->line_height;
    int16_t yb = y + f_text->line_height - 1;
    col_t   bg = sel ? PH : BG;
    col_t   fg = sel ? BG : PH;
    col_t   vg = sel ? BG : DIM;

    char val[20];
    ui_value_text(i, val, sizeof(val), true);
    int16_t lx   = MARGIN_X + 1;
    int16_t lend = lx + ui_text_width(f_text, UI_ITEM_LABEL[i]);
    int16_t rx   = RIGHT_X - ui_text_width(f_text, val);

    // Marges (fond noir hors de la ligne, seulement au redessin complet).
    if (full && sel) ui_fill(0, y, MARGIN_X - 1, yb, BG);
    ui_fill(full && !sel ? 0 : MARGIN_X, y, MARGIN_X, yb, bg);
    ui_text(f_text, lx, y, UI_ITEM_LABEL[i], fg, bg);
    ui_fill(lend, y, rx - 1, yb, bg);
    ui_text(f_text, rx, y, val, vg, bg);
    ui_fill(RIGHT_X, y, full && !sel ? UI_W - 1 : RIGHT_X, yb, bg);
    if (full && sel) ui_fill(RIGHT_X + 1, y, UI_W - 1, yb, BG);
}

// Position « n/6 » à droite de l'en-tête. Largeur constante : seul le chiffre change.
static void menu_pos(uint8_t sel, bool full) {
    char pos[8], old[8];
    snprintf(pos, sizeof(pos), "%u/%u", (unsigned)sel + 1, (unsigned)IT_COUNT);
    strcpy(old, shown_pos);
    strcpy(shown_pos, pos);
    if (text_diff(f_text, RIGHT_X + 1 - ui_text_width(f_text, pos), MENU_TOP, old, pos, DIM, BG)) return;
    // Au redessin complet, le fond va de la fin de « > MENU » au texte.
    int16_t x0 = full ? MARGIN_X + ui_text_width(f_text, "> MENU") : 90;
    ui_text_span(f_text, x0, RIGHT_X, UI_RIGHT, MENU_TOP, pos, DIM, BG);
}

static void menu_draw(bool full) {
    uint8_t sel = ui.sel;
    if (full) {
        int16_t lh = f_text->line_height;
        shown_pos[0] = 0;
        gap(0, MENU_TOP - 1);
        ui_fill(0, MENU_TOP, MARGIN_X - 1, MENU_TOP + lh - 1, BG);
        ui_text(f_text, MARGIN_X, MENU_TOP, "> MENU", PH, BG);
        menu_pos(sel, true);
        ui_fill(RIGHT_X + 1, MENU_TOP, UI_W - 1, MENU_TOP + lh - 1, BG);
        for (uint8_t i = 0; i < IT_COUNT; i++) menu_row(i, i == sel, true);
        gap(menu_list_y() + IT_COUNT * lh, UI_H - 1);
    } else if (sel == shown_sel) {
        return;
    } else {
        // Seules l'ancienne et la nouvelle ligne choisies changent.
        menu_row((uint8_t)shown_sel, false, false);
        menu_row(sel, true, false);
        menu_pos(sel, false);
    }
    shown_sel = sel;
}

// ---------------------------------------------------------------------------
// Réglage

// Valeur du réglage. Quand la police change (grande puis moyenne), les bandes au-dessus et
// au-dessous du texte moyen ne sont repeintes qu'à ce moment-là ; sinon le texte est écrit en place.
static void edit_value(bool full) {
    char buf[24], old[24];
    ui_value_text(ui.sel, buf, sizeof(buf), false);
    if (strcmp(buf, shown_value) == 0) return;
    strcpy(old, shown_value);
    strcpy(shown_value, buf);

    // Les nombres en grand ; un nom d'effet ou d'interface, ou un texte trop large, en moyen.
    bool                  big = ui.sel != IT_EFFECT && ui.sel != IT_THEME && ui.sel != IT_HUE && ui_text_width(f_big, buf) <= RIGHT_X - MARGIN_X - 8;
    painter_font_handle_t f   = big ? f_big : f_mid;
    if (!big && ui_text_width(f_mid, buf) > RIGHT_X - MARGIN_X + 1) f = f_text;   // « Personnalisé » ne tient pas en 22 px
    int16_t               y   = value_y() + (f_big->line_height - f->line_height) / 2;
    int16_t               x0  = full ? 0 : MARGIN_X, x1 = full ? UI_W - 1 : RIGHT_X;

    if (f != f_big && (full || shown_font != f)) {
        ui_fill(x0, value_y(), x1, y - 1, BG);
        ui_fill(x0, y + f->line_height, x1, value_y() + f_big->line_height - 1, BG);
    }
    int16_t x = (UI_W - ui_text_width(f, buf)) / 2;
    if (shown_font != f || !text_diff(f, x, y, old, buf, PH, BG)) ui_text_center(f, y, x0, x1, buf, PH, BG);
    shown_font = f;
}

// Pastille de la couleur choisie, 40 × 6 px, sous la valeur (réglage Couleur seulement).
static void edit_swatch(bool full) {
    if (ui.sel != IT_HUE || (!full && ui.hue_idx == shown_hue)) return;
    shown_hue  = ui.hue_idx;
    int16_t x0 = (UI_W - 40) / 2, y = swatch_y();
    if (full) {
        ui_fill(0, y, x0 - 1, y + 5, BG);
        ui_fill(x0 + 40, y, UI_W - 1, y + 5, BG);
    }
    ui_fill(x0, y, x0 + 39, y + 5, ui_hue_color());
}

// Barre « [######....] » de 10 cases : à chaque cran, une seule case change.
static int16_t edit_bar_y(void) {
    return ui.sel == IT_HUE ? swatch_y() + 6 + 6 : value_y() + f_big->line_height + 8;
}

static void edit_bar(bool full) {
    int16_t n = (ui_value_permille(ui.sel) + 50) / 100;
    if (n > 10) n = 10;

    char bar[14], old[14];
    bar[0] = '[';
    for (int16_t k = 0; k < 10; k++) bar[1 + k] = k < n ? '#' : '.';
    bar[11] = ']';
    bar[12] = 0;
    if (!full && strcmp(bar, shown_bar) == 0) return;
    strcpy(old, shown_bar);
    strcpy(shown_bar, bar);
    centered_change(f_text, edit_bar_y(), full, old, bar, PH);
}

static void edit_draw(bool full) {
    int16_t lh  = f_text->line_height;
    bool    hue = ui.sel == IT_HUE;
    if (full) {
        // Redessin complet : de haut en bas, chaque pixel est peint une seule fois (pas de clear_all).
        char up[24], head[32];
        to_upper_fr(up, sizeof(up), UI_ITEM_LABEL[ui.sel]);
        snprintf(head, sizeof(head), "> %s", up);
        shown_value[0] = shown_bar[0] = 0;
        shown_hue      = -1;
        shown_font     = NULL;
        gap(0, MARGIN_Y - 1);
        ui_fill(0, MARGIN_Y, MARGIN_X - 1, MARGIN_Y + lh - 1, BG);
        ui_text_span(f_text, MARGIN_X, UI_W - 1, UI_LEFT, MARGIN_Y, head, PH, BG);
        gap(MARGIN_Y + lh, line1_y() - 1);
        ui_fill(0, line1_y(), MARGIN_X - 1, line1_y(), BG);
        ui_fill(MARGIN_X, line1_y(), RIGHT_X, line1_y(), TRACK);
        ui_fill(RIGHT_X + 1, line1_y(), UI_W - 1, line1_y(), BG);
        gap(line1_y() + 1, value_y() - 1);
    }
    edit_value(full);
    if (full) gap(value_y() + f_big->line_height, (hue ? swatch_y() : edit_bar_y()) - 1);
    edit_swatch(full);
    if (full && hue) gap(swatch_y() + 6, edit_bar_y() - 1);
    edit_bar(full);
    if (full) {
        gap(edit_bar_y() + lh, foot_y() - 1);
        // Une seule ligne d'aide : deux lignes ne tiennent pas en 16 px.
        ui_fill(0, foot_y(), MARGIN_X - 1, foot_y() + lh - 1, BG);
        ui_text_span(f_text, MARGIN_X, UI_W - 1, UI_LEFT, foot_y(), "APPUI : VALIDER", DIM, BG);
        gap(foot_y() + lh, UI_H - 1);
    }
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
