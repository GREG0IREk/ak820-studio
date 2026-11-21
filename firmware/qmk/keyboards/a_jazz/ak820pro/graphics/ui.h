// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Socle commun des interfaces de l'écran (display.c) et contrat d'une interface
// (theme_*.c). Explication complète : firmware/ECRAN.md du dépôt ak820-studio.
//
// display.c tient l'état (écran affiché, entrée choisie, valeurs en cours de
// réglage), gère la molette, la veille, l'EEPROM et le canal HID. Une interface
// ne fait que dessiner cet état ; elle ne change jamais `ui` ni les réglages.

#pragma once

#include <stddef.h>
#include "qp.h"
#include "rtc/rtc.h"

#define UI_W 128
#define UI_H 128

// Couleur TSV 0-255 (format de Quantum Painter).
typedef struct {
    uint8_t h, s, v;
} col_t;
#define COL(c) (c).h, (c).s, (c).v

typedef enum { SCR_HOME, SCR_MENU, SCR_EDIT } ui_screen_t;

// Entrées du menu de la molette, dans l'ordre d'affichage.
enum { IT_EFFECT, IT_BRIGHT, IT_SPEED, IT_HUE, IT_SLEEP, IT_THEME, IT_COUNT };

typedef enum { CONN_USB, CONN_BT, CONN_24G } ui_conn_t;

typedef struct {
    ui_screen_t screen;
    uint8_t     sel;          // entrée du menu choisie (IT_*)
    uint8_t     eff_idx;      // index dans la liste des effets (ui_effect_*)
    uint8_t     bright_pct;   // 0..100 par pas de 10
    uint8_t     speed_lvl;    // 1..5
    uint16_t    hue_deg;      // 0..340 par pas de 20
    uint8_t     sleep_idx;    // index du délai de veille (ui_sleep_minutes)
    uint8_t     theme_idx;    // interface choisie (ui_theme_name)
} ui_state_t;

typedef struct {
    ui_conn_t mode;
    bool      connected;   // sans fil : liaison établie (toujours vrai en USB)
    uint8_t   slot;        // profil Bluetooth 1..3
    uint8_t   battery;     // 0..100, 0xFF si inconnue
    bool      caps;        // Verr. Maj
} ui_status_t;

extern ui_state_t       ui;       // lecture seule pour les interfaces
extern painter_device_t ui_dev;   // l'écran, pour les appels qp_* directs

// --- Données ---------------------------------------------------------------

void ui_status(ui_status_t *st);
bool ui_time(rtc_time_t *t);   // false : horloge pas réglée (t mis à zéro)

extern const char *const UI_ITEM_LABEL[IT_COUNT];   // « Effet », « Luminosité »…
extern const char *const UI_JOURS[7];               // « dim. » … (dimanche = 0)
extern const char *const UI_MOIS[12];               // « janv. » …

uint8_t     ui_effect_count(void);
const char *ui_effect_name(uint8_t i);    // « Respiration »
const char *ui_effect_short(uint8_t i);   // « Respir. » (8 caractères au plus)
bool        ui_effect_is_off(uint8_t i);  // l'entrée « Éteint »
uint8_t     ui_theme_count(void);
const char *ui_theme_name(uint8_t i);     // « Cadran », « Terminal », « Tuiles »
uint8_t     ui_sleep_count(void);
uint8_t     ui_sleep_minutes(uint8_t i);  // 0 = jamais

// Valeur d'une entrée en texte : « 80 % », « 3/5 », « 200° », « 5 min »,
// « Jamais », nom de l'effet (court si `brief`), nom de l'interface.
void ui_value_text(uint8_t item, char *buf, size_t n, bool brief);
// Position de la valeur dans sa plage, 0..1000 (pour un anneau ou une barre).
uint16_t ui_value_permille(uint8_t item);
// Couleur choisie (teinte du réglage Couleur, saturation et luminosité pleines).
col_t ui_hue_color(void);

// --- Dessin -----------------------------------------------------------------

void    ui_fill(int16_t x0, int16_t y0, int16_t x1, int16_t y1, col_t c);   // bornes incluses
int16_t ui_text_width(painter_font_handle_t f, const char *s);
// Texte et icônes (mono4) sont lissés en mélangeant fg et bg en TSV, teinte
// comprise. Entre deux teintes éloignées (orange sur bleu nuit), les pixels du
// bord prennent des teintes parasites (rose). ui_text et ui_image donnent à une
// couleur grise (s = 0) la teinte de l'autre, ce qui supprime le défaut sans
// rien changer au rendu. D'où la règle : fond gris (s = 0) derrière un texte ou
// une icône de couleur, ou couleurs de teintes voisines. Toujours passer par
// ui_text / ui_image plutôt que par qp_drawtext_recolor / qp_drawimage_recolor.
void    ui_text(painter_font_handle_t f, int16_t x, int16_t y, const char *s, col_t fg, col_t bg);
void    ui_image(painter_image_handle_t img, int16_t x, int16_t y, col_t fg, col_t bg);
// Efface [clear_x0, clear_x1] sur la hauteur de la police, puis centre le texte sur l'écran.
void    ui_text_center(painter_font_handle_t f, int16_t y, int16_t clear_x0, int16_t clear_x1, const char *s, col_t fg, col_t bg);
// Idem, texte aligné à droite sur x_right (dernier pixel inclus).
void    ui_text_right(painter_font_handle_t f, int16_t x_right, int16_t y, const char *s, col_t fg, col_t bg);

// --- Contrat d'une interface -------------------------------------------------
//
// enter() charge ses polices et images (qp_load_*_mem), leave() les libère
// (qp_close_*) : une seule interface est chargée à la fois.
// draw(screen, full) dessine l'écran demandé à partir de `ui` :
//   full = true  : tout redessiner (changement d'écran, réveil, changement d'interface) ;
//   full = false : même écran, ne redessiner que ce qui a changé depuis le dernier appel
//                  (accueil : chaque seconde ; menu et réglage : après un cran de molette).
// Pas de tampon d'image : on dessine directement sur l'écran, en effaçant
// chaque zone avec la couleur de fond avant d'y écrire.

typedef struct {
    const char *name;
    void (*enter)(void);
    void (*leave)(void);
    void (*draw)(ui_screen_t screen, bool full);
} ui_theme_t;

extern const ui_theme_t theme_cadran;
extern const ui_theme_t theme_terminal;
extern const ui_theme_t theme_tuiles;
