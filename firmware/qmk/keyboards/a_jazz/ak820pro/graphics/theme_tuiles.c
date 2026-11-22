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

static bool same(col_t a, col_t b) {
    return a.h == b.h && a.s == b.s && a.v == b.v;
}

// ---------------------------------------------------------------------------
// Formes et remplissage
//
// Règle (voir ui.h) : on n'efface jamais une zone pour la réécrire, chaque pixel
// est écrit au plus une fois par dessin. Un texte ou une icône se redessine
// par-dessus l'ancien (cellules pleines) ; on ne repeint en fond que les trous,
// c'est-à-dire ce que le contenu ne recouvre pas. Le décor statique (tuiles,
// coins, libellés) n'est dessiné que pour full = true.

typedef struct {
    int16_t x0, y0, x1, y1;   // bornes incluses
    bool    round;            // coins arrondis (tuile)
} shape_t;

#define MAX_SEG 16
typedef struct {
    int16_t l, r;
} seg_t;

// Quantum Painter ne sait pas dessiner de rectangle arrondi. Les pixels d'angle
// situés hors d'un quart de cercle de rayon 4 restent à la couleur du fond :
// trois pixels par angle, soit un arrondi de 2 à 3 px.
#define CORNER 4

// Pixels d'angle à exclure à gauche (et à droite) sur la ligne y d'une forme.
static int16_t corner_inset(const shape_t *s, int16_t y) {
    if (!s->round) return 0;
    int16_t j = (y - s->y0 < s->y1 - y) ? y - s->y0 : s->y1 - y;
    if (j >= CORNER) return 0;
    int16_t n = 0;
    for (int16_t i = 0; i < CORNER; i++) {
        // Centre du pixel (i, j) par rapport au centre du quart de cercle, en demi-pixels.
        int32_t dx = 2 * i + 1 - 2 * CORNER;
        int32_t dy = 2 * j + 1 - 2 * CORNER;
        if (dx * dx + dy * dy <= (2 * CORNER) * (2 * CORNER)) break;
        n++;
    }
    return n;
}

// Tronçons de la ligne y de `area` que les formes `ex` ne recouvrent pas.
static uint8_t row_segs(const shape_t *area, const shape_t *ex, uint8_t n_ex, int16_t y, seg_t *out) {
    int16_t in = corner_inset(area, y);
    out[0].l   = area->x0 + in;
    out[0].r   = area->x1 - in;
    uint8_t n  = out[0].l <= out[0].r ? 1 : 0;
    for (uint8_t k = 0; k < n_ex && n; k++) {
        const shape_t *e = &ex[k];
        if (y < e->y0 || y > e->y1) continue;
        int16_t ei = corner_inset(e, y), el = e->x0 + ei, er = e->x1 - ei;
        if (el > er) continue;
        seg_t   tmp[2 * MAX_SEG];
        uint8_t m = 0;
        for (uint8_t i = 0; i < n; i++) {
            if (er < out[i].l || el > out[i].r) {
                tmp[m++] = out[i];
                continue;
            }
            if (el > out[i].l) tmp[m++] = (seg_t){out[i].l, el - 1};
            if (er < out[i].r) tmp[m++] = (seg_t){er + 1, out[i].r};
        }
        n = m > MAX_SEG ? MAX_SEG : m;
        memcpy(out, tmp, n * sizeof(seg_t));
    }
    return n;
}

// Peint `c` sur `area` sauf sous les formes `ex`. Les lignes voisines qui ont les
// mêmes tronçons ne forment qu'un rectangle : peu de fenêtres, aucun pixel en double.
static void fill_around(const shape_t *area, const shape_t *ex, uint8_t n_ex, col_t c) {
    seg_t   prev[MAX_SEG], cur[MAX_SEG];
    uint8_t np    = 0;
    int16_t start = area->y0;
    for (int16_t y = area->y0; y <= area->y1 + 1; y++) {
        uint8_t nc = y <= area->y1 ? row_segs(area, ex, n_ex, y, cur) : 0;
        if (y > area->y0 && nc == np && memcmp(cur, prev, nc * sizeof(seg_t)) == 0) continue;
        for (uint8_t k = 0; k < np; k++) ui_fill(prev[k].l, start, prev[k].r, y - 1, c);
        memcpy(prev, cur, nc * sizeof(seg_t));
        np    = nc;
        start = y;
    }
}

// Cellules occupées par un texte (les cellules de glyphes se touchent).
static shape_t cell(painter_font_handle_t f, int16_t x, int16_t y, const char *s) {
    return (shape_t){x, y, x + ui_text_width(f, s) - 1, y + f->line_height - 1, false};
}

// ---------------------------------------------------------------------------
// Texte qui change : seules les cellules qui diffèrent de l'ancien sont réécrites.

typedef struct {
    painter_font_handle_t f;   // NULL : rien d'affiché
    int16_t               x, y;
    char                  s[32];
} shown_t;

// Largeur de s[0..n[ (n au plus 31).
static int16_t width_n(painter_font_handle_t f, const char *s, size_t n) {
    char buf[32];
    if (n > sizeof(buf) - 1) n = sizeof(buf) - 1;
    memcpy(buf, s, n);
    buf[n] = 0;
    return ui_text_width(f, buf);
}

static bool utf8_cont(char c) {
    return ((uint8_t)c & 0xC0) == 0x80;
}

// Écrit `s` à (x, y). Si l'ancien texte avait la même police et la même position,
// seuls les caractères qui changent sont redessinés (« 14:37 » devient « 14:38 » :
// un chiffre) ; sinon tout est écrit. Ne repeint rien d'autre (voir text_show).
// redo_x : les caractères dont la cellule atteint cette colonne sont réécrits même
// s'ils n'ont pas changé (NO_REDO : aucun).
#define NO_REDO INT16_MAX
static void text_diff(shown_t *t, painter_font_handle_t f, int16_t x, int16_t y, const char *s, col_t fg, col_t bg, int16_t redo_x) {
    if (t->f == f && t->x == x && t->y == y) {
        const char *o  = t->s;
        size_t      lo = strlen(o), ln = strlen(s), k = 0, m = 0;
        while (k < lo && k < ln && o[k] == s[k]) k++;
        while (k > 0 && (utf8_cont(o[k]) || utf8_cont(s[k]))) k--;   // frontière de caractère
        if (redo_x != NO_REDO) {
            while (k > 0 && x + width_n(f, s, k) > redo_x) {
                k--;
                while (k > 0 && utf8_cont(s[k])) k--;
            }
            if (k == lo && k == ln) return;
        } else {
            if (k == lo && k == ln) return;
            while (m < lo - k && m < ln - k && o[lo - 1 - m] == s[ln - 1 - m]) m++;
            while (m > 0 && utf8_cont(s[ln - m])) m--;
        }
        int16_t px = x + width_n(f, s, k);
        // Milieu de même largeur : la fin du texte ne bouge pas, on n'y touche pas.
        int16_t wo = ui_text_width(f, o + k) - ui_text_width(f, o + lo - m);
        int16_t wn = ui_text_width(f, s + k) - ui_text_width(f, s + ln - m);
        if (wo == wn) {
            char   mid[32];
            size_t n = ln - k - m;
            if (n > sizeof(mid) - 1) n = sizeof(mid) - 1;
            memcpy(mid, s + k, n);
            mid[n] = 0;
            ui_text(f, px, y, mid, fg, bg);
        } else {
            ui_text(f, px, y, s + k, fg, bg);
        }
    } else {
        ui_text(f, x, y, s, fg, bg);
    }
    t->f = f;
    t->x = x;
    t->y = y;
    strncpy(t->s, s, sizeof(t->s) - 1);
    t->s[sizeof(t->s) - 1] = 0;
}

// text_diff, puis repeint en fond ce que l'ancien texte couvrait et que le nouveau
// ne couvre plus (texte plus court, autre police ou autre position).
static void text_show(shown_t *t, painter_font_handle_t f, int16_t x, int16_t y, const char *s, col_t fg, col_t bg, int16_t redo_x) {
    if (t->f) {
        shape_t old = cell(t->f, t->x, t->y, t->s), nw = cell(f, x, y, s);
        fill_around(&old, &nw, 1, bg);
    }
    text_diff(t, f, x, y, s, fg, bg, redo_x);
}

// ---------------------------------------------------------------------------
// Disques

// Demi-largeur de chaque ligne (du centre vers le bord) d'un disque de rayon r,
// comme qp_circle(..., true) le dessine (même algorithme, chaque pixel écrit une fois).
static void disc_half_widths(uint8_t r, int8_t *hw) {
    for (uint8_t i = 0; i <= r; i++) hw[i] = -1;
    int16_t x = 0, y = r, err = (5 - (r >> 2)) >> 2;
    for (;;) {
        if (hw[y] < x) hw[y] = (int8_t)x;
        if (hw[x] < y) hw[x] = (int8_t)y;
        if (x >= y) break;
        x++;
        if (err < 0) {
            err += (x << 1) + 1;
        } else {
            y--;
            err += ((x - y) << 1) + 1;
        }
    }
}

#define MAX_BLOB 16

// Disque en rectangles (lignes voisines de même largeur fusionnées). hw[d] :
// demi-largeur à d lignes du centre.
static uint8_t blob_shapes(int16_t cx, int16_t cy, uint8_t r, const int8_t *hw, shape_t *out) {
    uint8_t n = 0;
    for (int16_t dy = -(int16_t)r; dy <= r; dy++) {
        int16_t h = hw[dy < 0 ? -dy : dy];
        if (n && out[n - 1].x1 == cx + h && out[n - 1].y1 == cy + dy - 1) {
            out[n - 1].y1 = cy + dy;
        } else if (n < MAX_BLOB) {
            out[n++] = (shape_t){cx - h, cy + dy, cx + h, cy + dy, false};
        }
    }
    return n;
}

static void blob_draw(const shape_t *b, uint8_t n, col_t c) {
    for (uint8_t i = 0; i < n; i++) ui_fill(b[i].x0, b[i].y0, b[i].x1, b[i].y1, c);
}

// ---------------------------------------------------------------------------
// Accueil

static const shape_t T_CLOCK = {4, 4, 123, 63, true};
static const shape_t T_BAT   = {4, 68, 61, 95, true};
static const shape_t T_CONN  = {66, 68, 123, 95, true};
static const shape_t T_EFF   = {4, 100, 123, 123, true};
static const shape_t SCREEN  = {0, 0, UI_W - 1, UI_H - 1, false};

#define CLOCK_X 12
#define BAT_X   10
#define BAT_X1  55
#define CONN_X  72
#define EFF_X   24

// Ce qui est affiché, pour ne redessiner que ce qui change.
static shown_t sh_time, sh_date, sh_bat, sh_conn, sh_eff;
static uint8_t shown_bat;
static int16_t shown_bar_x0, shown_bar_wg;
static bool    shown_caps;
static col_t   shown_dot;
static bool    shown_dot_ok;

static int16_t clock_top(void) {
    return 4 + (60 - (f_time->line_height + 3 + f_small->line_height)) / 2;
}

// Pastille MAJ en coin, plus près du bord que la maquette : l'heure
// « 09:05 » de cette police touche sinon le coin de la pastille.
static shape_t maj_shape(void) {
    int16_t w = ui_text_width(f_bold, "MAJ") + 4;   // 2 px de part et d'autre
    int16_t h = f_bold->line_height + 2;
    return (shape_t){119 - w + 1, 6, 119, 6 + h - 1, true};
}

// Pixels d'angle d'une forme arrondie, repeints en couleur c.
static void corners_fill(const shape_t *s, col_t c) {
    for (int16_t j = 0; j < CORNER; j++) {
        int16_t n = corner_inset(s, s->y0 + j);
        if (n == 0) continue;
        ui_fill(s->x0, s->y0 + j, s->x0 + n - 1, s->y0 + j, c);
        ui_fill(s->x1 - n + 1, s->y0 + j, s->x1, s->y0 + j, c);
        ui_fill(s->x0, s->y1 - j, s->x0 + n - 1, s->y1 - j, c);
        ui_fill(s->x1 - n + 1, s->y1 - j, s->x1, s->y1 - j, c);
    }
}

// Pastille MAJ allumée, angles compris. L'heure est dessinée avant elle : si elles
// se touchent, la pastille l'emporte.
static void maj_on(void) {
    shape_t p   = maj_shape();
    shape_t txt = cell(f_bold, p.x0 + 2, p.y0 + 1, "MAJ");
    fill_around(&p, &txt, 1, ACCENT);
    ui_text(f_bold, p.x0 + 2, p.y0 + 1, "MAJ", TILE, ACCENT);
    corners_fill(&p, TILE);
}

static void clock_tile(const char *hhmm, const char *date, bool caps, bool full) {
    int16_t top = clock_top(), dy = top + f_time->line_height + 3;
    shape_t p   = maj_shape();
    if (full) {
        shape_t pb = p;
        pb.round   = false;   // les angles sont repeints par maj_on, après l'heure
        shape_t sk[3] = {cell(f_time, CLOCK_X, top, hhmm), cell(f_small, CLOCK_X, dy, date), pb};
        fill_around(&T_CLOCK, sk, caps ? 3 : 2, TILE);
        sh_time.f = sh_date.f = NULL;
        shown_caps = false;
    }
    // L'heure peut toucher la pastille (« 09:05 »). Ancienne ou nouvelle, elle a pu
    // la recouvrir ou être recouverte : on redessine alors la pastille par-dessus.
    bool time_changed = sh_time.f && strcmp(sh_time.s, hhmm) != 0;
    bool touch        = time_changed && (cell(f_time, CLOCK_X, top, hhmm).x1 >= p.x0 || cell(sh_time.f, sh_time.x, sh_time.y, sh_time.s).x1 >= p.x0);

    // Pastille éteinte : fond de tuile sous la pastille, sauf sous l'heure ; les
    // caractères qu'elle cachait sont réécrits avec l'heure (redo_x).
    int16_t redo = NO_REDO;
    if (!caps && shown_caps) {
        shape_t tc = cell(f_time, CLOCK_X, top, hhmm);
        fill_around(&p, &tc, 1, TILE);
        redo = p.x0;
    }
    text_show(&sh_time, f_time, CLOCK_X, top, hhmm, TEXT, TILE, redo);
    text_show(&sh_date, f_small, CLOCK_X, dy, date, SUB, TILE, NO_REDO);
    if (caps && (!shown_caps || touch)) maj_on();
    shown_caps = caps;
}

// Libellé (police fine) puis valeur (police grasse) dans une tuile de deux
// lignes : le bloc est centré verticalement, tout le texte reste dans la tuile.
// Renvoie le haut du libellé ; la valeur est à `top + f_small->line_height + 2`.
static int16_t two_lines_top(int16_t y0, int16_t y1) {
    int16_t h = f_small->line_height + 2 + f_bold->line_height;
    return y0 + (y1 - y0 + 1 - h) / 2;
}

static void battery_tile(uint8_t bat, bool full) {
    if (!full && bat == shown_bat) return;
    shown_bat   = bat;
    int16_t top = two_lines_top(68, 95);
    int16_t vy  = top + f_small->line_height + 2;

    char buf[8];
    if (bat == 0xFF) snprintf(buf, sizeof(buf), "-- %%");
    else snprintf(buf, sizeof(buf), "%u %%", (unsigned)bat);

    int16_t bx0 = BAT_X + ui_text_width(f_bold, buf) + 4;
    int16_t by  = vy + (f_bold->line_height - 4) / 2;
    int16_t wg  = (BAT_X1 - bx0 + 1) * (bat == 0xFF ? 0 : bat) / 100;

    if (full) {
        shape_t sk[3] = {cell(f_small, BAT_X, top, "Batterie"), cell(f_bold, BAT_X, vy, buf), {bx0, by, BAT_X1, by + 3, false}};
        fill_around(&T_BAT, sk, 3, TILE);
        ui_text(f_small, BAT_X, top, "Batterie", SUB, TILE);
        sh_bat.f     = NULL;
        shown_bar_x0 = -1;
    }
    // Texte plus large : l'ancienne barre passe sous le nouveau texte, seuls les
    // 4 px entre le texte et la nouvelle barre sont à repeindre.
    if (shown_bar_x0 >= 0 && bx0 > shown_bar_x0) ui_fill(bx0 - 4, by, bx0 - 1, by + 3, TILE);
    text_show(&sh_bat, f_bold, BAT_X, vy, buf, TEXT, TILE, NO_REDO);

    if (bx0 != shown_bar_x0) {   // la barre a changé de longueur : entière
        if (wg > 0) ui_fill(bx0, by, bx0 + wg - 1, by + 3, GREEN);
        ui_fill(bx0 + wg, by, BAT_X1, by + 3, TRACK);
    } else if (wg > shown_bar_wg) {
        ui_fill(bx0 + shown_bar_wg, by, bx0 + wg - 1, by + 3, GREEN);
    } else if (wg < shown_bar_wg) {
        ui_fill(bx0 + wg, by, bx0 + shown_bar_wg - 1, by + 3, TRACK);
    }
    shown_bar_x0 = bx0;
    shown_bar_wg = wg;
}

static void conn_text(const ui_status_t *st, char *buf, size_t n) {
    if (st->mode == CONN_USB) snprintf(buf, n, "USB");
    else if (st->mode == CONN_24G) snprintf(buf, n, "2,4 GHz");
    else snprintf(buf, n, "BT %u", (unsigned)st->slot);
    if (st->mode != CONN_USB && !st->connected) strncat(buf, " ...", n - strlen(buf) - 1);
}

static void conn_tile(const char *txt, bool full) {
    int16_t top = two_lines_top(68, 95);
    int16_t vy  = top + f_small->line_height + 2;
    if (full) {
        shape_t sk[2] = {cell(f_small, CONN_X, top, "Connexion"), cell(f_bold, CONN_X, vy, txt)};
        fill_around(&T_CONN, sk, 2, TILE);
        ui_text(f_small, CONN_X, top, "Connexion", SUB, TILE);
        sh_conn.f = NULL;
    }
    text_show(&sh_conn, f_bold, CONN_X, vy, txt, TEXT, TILE, NO_REDO);
}

// Couleur de la pastille : gris pour « Éteint », orange pour un effet multicolore.
static col_t effect_dot(uint8_t i) {
    if (ui_effect_is_off(i)) return OFF_DOT;
    if (ui_effect_rainbow(i)) return ORANGE;
    return ui_hue_color();
}

// Disque de 7 px de diamètre, centre en (15, 112). qp_circle donne un losange à
// ce rayon : la forme est donnée ligne par ligne (demi-largeurs du centre au bord).
static const int8_t DOT_HW[4] = {3, 3, 2, 1};

static void effect_tile(uint8_t i, col_t dot, bool full) {
    const char *name = ui_effect_name(i);
    int16_t     ny   = 100 + (24 - f_bold->line_height) / 2;
    shape_t     d[MAX_BLOB];
    uint8_t     nd = blob_shapes(15, 112, 3, DOT_HW, d);
    if (full) {
        shape_t sk[1 + MAX_BLOB];
        sk[0] = cell(f_bold, EFF_X, ny, name);
        memcpy(&sk[1], d, nd * sizeof(shape_t));
        fill_around(&T_EFF, sk, 1 + nd, TILE);
        sh_eff.f     = NULL;
        shown_dot_ok = false;
    }
    text_show(&sh_eff, f_bold, EFF_X, ny, name, TEXT, TILE, NO_REDO);
    if (!shown_dot_ok || !same(dot, shown_dot)) {
        shown_dot    = dot;
        shown_dot_ok = true;
        blob_draw(d, nd, dot);
    }
}

static void home_draw(bool full) {
    rtc_time_t  t;
    ui_status_t st;
    ui_time(&t);
    ui_status(&st);

    if (full) {
        const shape_t tiles[4] = {T_CLOCK, T_BAT, T_CONN, T_EFF};
        fill_around(&SCREEN, tiles, 4, BG);   // fond et coins arrondis, seulement hors des tuiles
    }

    char time[8], date[24];
    uint8_t wd = t.weekday % 7, mo = (t.month >= 1 && t.month <= 12) ? t.month - 1 : 0;
    snprintf(time, sizeof(time), "%02u:%02u", (unsigned)t.hours, (unsigned)t.minutes);
    snprintf(date, sizeof(date), "%s %u %s", UI_JOURS[wd], (unsigned)t.day, UI_MOIS[mo]);
    clock_tile(time, date, st.caps, full);

    battery_tile(st.battery, full);

    char conn[24];
    conn_text(&st, conn, sizeof(conn));
    conn_tile(conn, full);

    effect_tile(ui.eff_idx, effect_dot(ui.eff_idx), full);
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

static shape_t menu_shape(uint8_t i) {
    return (shape_t){MENU_X0[i % 3], MENU_Y0[i / 3], MENU_X1[i % 3], MENU_Y1[i / 3], true};
}

// Tuile entière : icône, nom et valeur sont écrits directement (cellules pleines),
// seuls les trous entre eux sont repeints au fond de la tuile.
static void menu_tile(uint8_t i, bool sel) {
    shape_t t   = menu_shape(i);
    col_t   bg  = sel ? ACCENT : TILE;
    col_t   fg  = sel ? TILE : TEXT;
    col_t   sub = sel ? ACCENT_SUB : SUB;

    char val[20];
    ui_value_text(i, val, sizeof(val), true);
    painter_font_handle_t fn = menu_name_font();

    const int16_t gap = 3;
    int16_t cx = (t.x0 + t.x1 + 1) / 2;
    int16_t h  = 18 + gap + fn->line_height + gap + f_small->line_height;
    int16_t y  = t.y0 + (t.y1 - t.y0 + 1 - h) / 2;

    int16_t nx = cx - ui_text_width(fn, NOM_COURT[i]) / 2, ny = y + 18 + gap;
    int16_t vx = cx - ui_text_width(f_small, val) / 2, vy = ny + fn->line_height + gap;

    shape_t sk[3] = {{cx - 9, y, cx + 8, y + 17, false}, cell(fn, nx, ny, NOM_COURT[i]), cell(f_small, vx, vy, val)};
    fill_around(&t, sk, 3, bg);
    ui_image(ic18[i], cx - 9, y, fg, bg);
    ui_text(fn, nx, ny, NOM_COURT[i], fg, bg);
    ui_text(f_small, vx, vy, val, sub, bg);
}

static uint8_t shown_sel;

static void menu_draw(bool full) {
    if (full) {
        shape_t tiles[IT_COUNT];
        for (uint8_t i = 0; i < IT_COUNT; i++) tiles[i] = menu_shape(i);
        fill_around(&SCREEN, tiles, IT_COUNT, BG);
        for (uint8_t i = 0; i < IT_COUNT; i++) menu_tile(i, i == ui.sel);
        shown_sel = ui.sel;
    } else if (ui.sel != shown_sel) {
        // Le fond change (bleu <-> blanc) : tout le contenu des deux tuiles est
        // réécrit, mais les autres tuiles ne sont pas touchées.
        menu_tile(shown_sel, false);
        menu_tile(ui.sel, true);
        shown_sel = ui.sel;
    }
}

// ---------------------------------------------------------------------------
// Réglage

#define EDIT_TEXT_W 100   // largeur utile de la tuile : x 14 à 113
#define EDIT_X      14
#define DISC_R      7     // pastille de la couleur : 15 px

static const shape_t T_EDIT = {4, 4, 123, 123, true};

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

// Valeur à afficher : texte, et pastille de la couleur choisie (réglage Couleur).
typedef struct {
    char                  buf[20];
    painter_font_handle_t f;
    int16_t               y;          // haut du texte
    int16_t               cx, cy;     // centre de la pastille
    bool                  hue;
    col_t                 pc;
    shape_t               t;          // cellules du texte
    shape_t               d[MAX_BLOB];   // pastille
    uint8_t               nd;
} value_t;

static void value_layout(value_t *v) {
    ui_value_text(ui.sel, v->buf, sizeof(v->buf), false);
    v->hue = ui.sel == IT_HUE;
    v->pc  = v->hue ? ui_hue_color() : TILE;
    v->f   = value_font(ui.sel, v->buf);
    v->cy  = edit_value_mid();
    v->y   = v->cy - v->f->line_height / 2;
    v->t   = cell(v->f, EDIT_X, v->y, v->buf);
    v->cx  = v->t.x1 + 1 + 6 + DISC_R;
    v->nd  = 0;
    if (v->hue) {
        int8_t hw[DISC_R + 1];
        disc_half_widths(DISC_R, hw);
        v->nd = blob_shapes(v->cx, v->cy, DISC_R, hw, v->d);
    }
}

static shown_t sh_val;
static bool    shown_val_hue;
static int16_t shown_val_cx, shown_val_cy;
static col_t   shown_val_col;
static uint8_t shown_n;
static bool    shown_seg_ok;
static col_t   shown_seg_col;

// Valeur en place : on repeint en fond seulement ce que l'ancienne valeur
// (texte plus long, autre police, pastille) couvrait et que la nouvelle ne
// recouvre pas, puis on écrit les cellules qui changent.
static void edit_value(const value_t *v, bool full) {
    bool disc_same = !full && shown_val_hue && v->hue && shown_val_cx == v->cx && same(shown_val_col, v->pc);
    if (full) {
        sh_val.f = NULL;
    } else {
        if (sh_val.f == v->f && strcmp(sh_val.s, v->buf) == 0 && (!v->hue || disc_same)) return;
        shape_t ex[1 + MAX_BLOB];
        ex[0] = v->t;
        memcpy(&ex[1], v->d, v->nd * sizeof(shape_t));
        shape_t old = cell(sh_val.f, sh_val.x, sh_val.y, sh_val.s);
        fill_around(&old, ex, 1 + v->nd, TILE);
        if (shown_val_hue && !disc_same) {
            old = (shape_t){shown_val_cx - DISC_R, shown_val_cy - DISC_R, shown_val_cx + DISC_R, shown_val_cy + DISC_R, false};
            fill_around(&old, ex, 1 + v->nd, TILE);
        }
    }
    text_diff(&sh_val, v->f, EDIT_X, v->y, v->buf, TEXT, TILE, NO_REDO);
    if (v->hue && !disc_same) blob_draw(v->d, v->nd, v->pc);
    shown_val_hue = v->hue;
    shown_val_cx  = v->cx;
    shown_val_cy  = v->cy;
    shown_val_col = v->pc;
}

// Segment i de la barre : 8 px, 2 px d'écart.
static shape_t seg_shape(uint8_t i) {
    int16_t x = EDIT_X + i * 10, y = edit_bar_y();
    return (shape_t){x, y, x + 7, y + 7, false};
}

// Seuls les segments qui changent de couleur sont repeints.
static void edit_segs(bool full) {
    uint16_t p = ui_value_permille(ui.sel);
    uint8_t  n = (uint8_t)((p + 50) / 100);
    if (n < 1) n = 1;
    if (n > 10) n = 10;
    col_t c = ui.sel == IT_HUE ? ui_hue_color() : ACCENT;
    if (full) shown_seg_ok = false;
    if (shown_seg_ok && n == shown_n && same(c, shown_seg_col)) return;

    for (uint8_t i = 0; i < 10; i++) {
        col_t nc = i < n ? c : TRACK;
        if (shown_seg_ok && same(nc, i < shown_n ? shown_seg_col : TRACK)) continue;
        shape_t s = seg_shape(i);
        ui_fill(s.x0, s.y0, s.x1, s.y1, nc);
    }
    shown_n       = n;
    shown_seg_col = c;
    shown_seg_ok  = true;
}

static void edit_draw(bool full) {
    value_t v;
    value_layout(&v);
    if (full) {
        const shape_t tile = T_EDIT;
        fill_around(&SCREEN, &tile, 1, BG);

        int16_t ly = 14 + (12 - f_bold->line_height) / 2, hy = 113 - f_small->line_height + 1;
        shape_t sk[3 + 1 + MAX_BLOB + 10];
        uint8_t n = 0;
        sk[n++]   = (shape_t){EDIT_X, 14, EDIT_X + 11, 25, false};
        sk[n++]   = cell(f_bold, 30, ly, UI_ITEM_LABEL[ui.sel]);
        sk[n++]   = cell(f_small, EDIT_X, hy, "Appui : valider");
        sk[n++]   = v.t;
        for (uint8_t i = 0; i < v.nd; i++) sk[n++] = v.d[i];
        for (uint8_t i = 0; i < 10; i++) sk[n++] = seg_shape(i);
        fill_around(&T_EDIT, sk, n, TILE);

        ui_image(ic12[ui.sel], EDIT_X, 14, ACCENT, TILE);
        ui_text(f_bold, 30, ly, UI_ITEM_LABEL[ui.sel], TEXT, TILE);
        ui_text(f_small, EDIT_X, hy, "Appui : valider", SUB, TILE);
    }
    edit_value(&v, full);
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
