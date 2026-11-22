// Simulateur d'écran : remplace quantum.h de QMK par le strict nécessaire aux
// fichiers graphics/ (display.c, theme_*.c) et à Quantum Painter.
#pragma once
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include "util.h"
#include "color.h"
#include "deferred_exec.h"
#include "qp.h"

#define TIMER_DIFF_32(a, b) (uint32_t)((a) - (b))
uint32_t timer_read32(void);
uint32_t timer_elapsed32(uint32_t last);
uint32_t last_input_activity_elapsed(void);

typedef int pin_t;
enum { A16 = 16, A17 = 17, B8 = 40, D14 = 110 };
void gpio_write_pin(pin_t pin, bool on);
void gpio_set_pin_output(pin_t pin);

typedef union {
    uint8_t raw;
    struct {
        bool num_lock : 1;
        bool caps_lock : 1;
        bool scroll_lock : 1;
        bool compose : 1;
        bool kana : 1;
        uint8_t reserved : 3;
    };
} led_t;
led_t host_keyboard_led_state(void);

// Éclairage (rgb_matrix) : simulé par quelques variables dans sim.c.
enum {
    RGB_MATRIX_NONE = 0,
    RGB_MATRIX_SOLID_COLOR,
    RGB_MATRIX_BREATHING,
    RGB_MATRIX_CYCLE_ALL,
    RGB_MATRIX_CYCLE_LEFT_RIGHT,
    RGB_MATRIX_CYCLE_PINWHEEL,
    RGB_MATRIX_SOLID_REACTIVE_SIMPLE,
    RGB_MATRIX_JELLYBEAN_RAINDROPS,
    RGB_MATRIX_TYPING_HEATMAP,
    RGB_MATRIX_STARLIGHT_SMOOTH,
    RGB_MATRIX_DIGITAL_RAIN,
    RGB_MATRIX_CYCLE_OUT_IN,
    RGB_MATRIX_CYCLE_UP_DOWN,
    RGB_MATRIX_CYCLE_SPIRAL,
    RGB_MATRIX_MULTISPLASH,
    RGB_MATRIX_SOLID_REACTIVE_CROSS,
    RGB_MATRIX_SOLID_SPLASH,
    RGB_MATRIX_RIVERFLOW,
    RGB_MATRIX_HUE_BREATHING,
    RGB_MATRIX_HUE_PENDULUM,
    RGB_MATRIX_DUAL_BEACON,
    RGB_MATRIX_CUSTOM_extinction,
    RGB_MATRIX_CUSTOM_perso,
};
#define ENABLE_RGB_MATRIX_SOLID_REACTIVE_SIMPLE
#define AK820_STUDIO_PERKEY
#define RGB_MATRIX_MAXIMUM_BRIGHTNESS 200
bool    rgb_matrix_is_enabled(void);
uint8_t rgb_matrix_get_mode(void);
uint8_t rgb_matrix_get_hue(void);
uint8_t rgb_matrix_get_sat(void);
uint8_t rgb_matrix_get_val(void);
uint8_t rgb_matrix_get_speed(void);
void    rgb_matrix_enable(void);
void    rgb_matrix_enable_noeeprom(void);
void    rgb_matrix_disable(void);
void    rgb_matrix_disable_noeeprom(void);
void    rgb_matrix_mode(uint8_t m);
void    rgb_matrix_mode_noeeprom(uint8_t m);
void    rgb_matrix_sethsv(uint8_t h, uint8_t s, uint8_t v);
void    rgb_matrix_sethsv_noeeprom(uint8_t h, uint8_t s, uint8_t v);
void    rgb_matrix_set_speed(uint8_t s);
void    rgb_matrix_set_speed_noeeprom(uint8_t s);

painter_device_t qp_gc9107_make_spi_device(uint16_t w, uint16_t h, pin_t cs, pin_t dc, pin_t rst, uint16_t div, int mode);
