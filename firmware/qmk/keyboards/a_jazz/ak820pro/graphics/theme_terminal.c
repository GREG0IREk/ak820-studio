// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Interface « Terminal » : à écrire (voir firmware/ECRAN.md). Ce fichier provisoire
// remplit l'écran d'une couleur pour que le firmware compile.

#include "graphics/ui.h"

static void enter(void) {}
static void leave(void) {}

static void draw(ui_screen_t screen, bool full) {
    if (full) ui_fill(0, 0, UI_W - 1, UI_H - 1, (col_t){85, 255, 60});
}

const ui_theme_t theme_terminal = {"Terminal", enter, leave, draw};
