// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once

// Effet « Réactif » du menu : les touches s'allument quand on les frappe.
#define RGB_MATRIX_KEYPRESSES
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE

// Version renvoyée par la commande système 0x13/0x02 (outil de mise à jour).
#define AK820_FW_VERSION "cadran-1.0"

// 12 icônes chargées (6 entrées du menu x 2 tailles) : QMK en prévoit 8 par défaut.
#define QUANTUM_PAINTER_NUM_IMAGES 12
