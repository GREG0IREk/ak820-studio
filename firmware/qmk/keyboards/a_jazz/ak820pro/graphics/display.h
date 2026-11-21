// Copyright 2026 Fernando Birra
// Copyright 2026 Grégoire Kuhn (interface « Cadran »)
// SPDX-License-Identifier: GPL-2.0-or-later

#pragma once

#include "qp.h"
#include "rtc/rtc.h"

bool display_init_kb(void);
bool display_init_user(void);
void display_housekeeping_task(void);

void display_set_power(bool on);
bool display_get_power(void);
void display_toggle_power(void);

// Gardé pour la compatibilité avec ak820pro.c (touche SCR_MEDIA) : sans effet
// dans l'interface Cadran, qui n'affiche pas le morceau en cours.
void display_toggle_media(void);

// Veille de l'écran (minuterie d'inactivité ou mise en veille USB).
void display_enter_sleep(void);
void display_exit_sleep(void);

// Changements d'état signalés par ak820pro.c (interrupteurs Mac/Win et mode).
void display_draw_mac_logo(void);
void display_draw_windows_logo(void);
void display_draw_usb_logo(void);
void display_draw_bluetooth_logo(void);
void display_draw_2_4_g_logo(void);

// Menu de la molette (appelé par le keymap).
bool display_menu_active(void);
void display_menu_open(void);
void display_menu_close(void);   // valide un réglage en cours et revient à l'accueil
void display_menu_rotate(bool clockwise);
void display_menu_press(void);

// Effets du menu, partagés avec le canal HID d'AK820 Studio (même liste, même ordre).
uint8_t     display_effect_count(void);
const char *display_effect_name(uint8_t index);
uint8_t     display_effect_current(void);
void        display_effect_apply(uint8_t index, bool save);
int8_t      display_effect_perkey(void);       // index de « Personnalisé », -1 si absent
void        display_settings_changed(void);   // réglages changés depuis le PC : menu à jour

// Délai de veille réglable depuis le menu (défini dans ak820pro.c, mémorisé en EEPROM).
#define AK820_SLEEP_CHOICES 5
uint8_t ak820_get_sleep_index(void);
void    ak820_set_sleep_index(uint8_t index);
uint8_t ak820_sleep_minutes(uint8_t index);   // 0 = jamais
