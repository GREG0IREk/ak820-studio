// Copyright 2026 Grégoire Kuhn
// SPDX-License-Identifier: GPL-2.0-or-later
//
// Simulateur de l'écran 128x128 : compile le vrai display.c, les vraies
// interfaces (theme_*.c) et le vrai Quantum Painter de QMK sur PC, avec un faux
// pilote d'écran qui dessine dans une image en mémoire. Chaque scène est
// enregistrée en PNG (agrandie 3 fois) et une planche réunit toutes les scènes.
//
// Contrôle du dessin partiel : après chaque dessin partiel (full = false), la
// même scène est redessinée en entier (full = true) et les deux images sont
// comparées. Une différence est signalée « ÉCART » et enregistrée en
// <scène>-ecart.png (pixels différents en rouge) : l'interface a oublié
// d'effacer ou de redessiner quelque chose.
//
//   ./sim <dossier de sortie> [cadran|terminal|tuiles]...
// Lancé par firmware/sim/run.sh (voir firmware/ECRAN.md).

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

// display.c est inclus pour accéder à son état et à redraw().
#include "graphics/display.c"

// ---------------------------------------------------------------------------
// Faux matériel

static uint32_t now_ms = 0;
uint32_t        timer_read32(void) { return now_ms; }
uint32_t        timer_elapsed32(uint32_t last) { return now_ms - last; }
uint32_t        last_input_activity_elapsed(void) { return 0; }
void            gpio_write_pin(pin_t pin, bool on) { (void)pin; (void)on; }
void            gpio_set_pin_output(pin_t pin) { (void)pin; }

static deferred_exec_callback pending_cb;
deferred_token defer_exec(uint32_t delay_ms, deferred_exec_callback cb, void *arg) {
    (void)delay_ms; (void)arg;
    pending_cb = cb;
    return 1;
}
deferred_token defer_exec_advanced(deferred_executor_t *t, size_t n, uint32_t d, deferred_exec_callback cb, void *arg) {
    (void)t; (void)n; (void)d; (void)cb; (void)arg;
    return INVALID_DEFERRED_TOKEN;
}
bool cancel_deferred_exec_advanced(deferred_executor_t *t, size_t n, deferred_token k) { (void)t; (void)n; (void)k; return false; }
void deferred_exec_advanced_task(deferred_executor_t *t, size_t n, uint32_t *l) { (void)t; (void)n; (void)l; }

static bool sim_caps = false;
led_t       host_keyboard_led_state(void) { led_t l = {0}; l.caps_lock = sim_caps; return l; }

static bool    sim_connected = true;
static uint8_t sim_slot = 1, sim_battery = 87;
bool    ch582_is_connected(void) { return sim_connected; }
uint8_t ch582_get_slot(void) { return sim_slot; }
uint8_t ch582_get_battery(void) { return sim_battery; }

static rtc_time_t sim_time = {42, 37, 14, 21, 6, 11, 2026};   // sam. 21 nov. 2026 14:37:42
static bool       sim_time_set = true;
bool rtc_get_time(rtc_time_t *out) { *out = sim_time; return sim_time_set; }
uint32_t rtc_get_seconds(void) { return (uint32_t)sim_time.hours * 3600 + sim_time.minutes * 60 + sim_time.seconds; }

static const uint8_t SLEEP_MIN[AK820_SLEEP_CHOICES] = {1, 3, 5, 10, 0};
static uint8_t       sim_sleep = 1, sim_theme = 0;
uint8_t ak820_sleep_minutes(uint8_t i) { return i < AK820_SLEEP_CHOICES ? SLEEP_MIN[i] : 0; }
uint8_t ak820_get_sleep_index(void) { return sim_sleep; }
void    ak820_set_sleep_index(uint8_t i) { sim_sleep = i; }
uint8_t ak820_get_theme_index(void) { return sim_theme; }
void    ak820_set_theme_index(uint8_t i) { sim_theme = i; }

static bool    rgb_on = true;
static uint8_t rgb_mode = RGB_MATRIX_CYCLE_LEFT_RIGHT, rgb_h = 142, rgb_s = 255, rgb_v = 160, rgb_spd = 153;
bool    rgb_matrix_is_enabled(void) { return rgb_on; }
uint8_t rgb_matrix_get_mode(void) { return rgb_mode; }
uint8_t rgb_matrix_get_hue(void) { return rgb_h; }
uint8_t rgb_matrix_get_sat(void) { return rgb_s; }
uint8_t rgb_matrix_get_val(void) { return rgb_v; }
uint8_t rgb_matrix_get_speed(void) { return rgb_spd; }
void    rgb_matrix_enable(void) { rgb_on = true; }
void    rgb_matrix_enable_noeeprom(void) { rgb_on = true; }
void    rgb_matrix_disable(void) { rgb_on = false; }
void    rgb_matrix_disable_noeeprom(void) { rgb_on = false; }
void    rgb_matrix_mode(uint8_t m) { rgb_mode = m; }
void    rgb_matrix_mode_noeeprom(uint8_t m) { rgb_mode = m; }
void    rgb_matrix_sethsv(uint8_t h, uint8_t s, uint8_t v) { rgb_h = h; rgb_s = s; rgb_v = v; }
void    rgb_matrix_sethsv_noeeprom(uint8_t h, uint8_t s, uint8_t v) { rgb_h = h; rgb_s = s; rgb_v = v; }
void    rgb_matrix_set_speed(uint8_t s) { rgb_spd = s; }
void    rgb_matrix_set_speed_noeeprom(uint8_t s) { rgb_spd = s; }

// ---------------------------------------------------------------------------
// Faux pilote d'écran : RGB888 dans fb[], hors écran = erreur comptée.

static uint8_t  fb[UI_H][UI_W][3];
static uint16_t vp_l, vp_t, vp_r, vp_b, cur_x, cur_y;
static uint32_t out_of_bounds = 0;

static bool d_init(painter_device_t d, painter_rotation_t r) { (void)d; (void)r; return true; }
static bool d_power(painter_device_t d, bool on) { (void)d; (void)on; return true; }
static bool d_clear(painter_device_t d) { (void)d; memset(fb, 0, sizeof(fb)); return true; }
static bool d_flush(painter_device_t d) { (void)d; return true; }
static bool d_viewport(painter_device_t d, uint16_t l, uint16_t t, uint16_t r, uint16_t b) {
    (void)d;
    vp_l = l; vp_t = t; vp_r = r; vp_b = b;
    cur_x = l; cur_y = t;
    return true;
}
static bool d_pixdata(painter_device_t d, const void *data, uint32_t count) {
    (void)d;
    const uint8_t *p = data;
    for (uint32_t i = 0; i < count; i++, p += 3) {
        if (cur_x < UI_W && cur_y < UI_H) memcpy(fb[cur_y][cur_x], p, 3);
        else out_of_bounds++;
        if (++cur_x > vp_r) { cur_x = vp_l; cur_y++; }
    }
    return true;
}
static bool d_palette(painter_device_t d, int16_t n, qp_pixel_t *pal) {
    (void)d;
    for (int16_t i = 0; i < n; i++) {
        rgb_t c = hsv_to_rgb_nocie((hsv_t){pal[i].hsv888.h, pal[i].hsv888.s, pal[i].hsv888.v});
        pal[i].rgb888 = c;
    }
    return true;
}
static bool d_append(painter_device_t d, uint8_t *buf, qp_pixel_t *pal, uint32_t off, uint32_t n, uint8_t *idx) {
    (void)d;
    for (uint32_t i = 0; i < n; i++) {
        buf[(off + i) * 3 + 0] = pal[idx[i]].rgb888.r;
        buf[(off + i) * 3 + 1] = pal[idx[i]].rgb888.g;
        buf[(off + i) * 3 + 2] = pal[idx[i]].rgb888.b;
    }
    return true;
}
static bool d_append_pixdata(painter_device_t d, uint8_t *buf, uint32_t off, uint8_t byte) { (void)d; buf[off] = byte; return true; }

static bool     c_ok(painter_device_t d) { (void)d; return true; }
static uint32_t c_send(painter_device_t d, const void *data, uint32_t n) { (void)d; (void)data; return n; }
static bool     c_cmd(painter_device_t d, uint8_t cmd) { (void)d; (void)cmd; return true; }

static const painter_driver_vtable_t             drv_vt = {d_init, d_power, d_clear, d_flush, d_viewport, d_pixdata, d_palette, d_append, d_append_pixdata};
static const painter_comms_with_command_vtable_t com_vt = {{c_ok, c_ok, c_ok, c_send}, c_cmd, NULL};
static painter_driver_t                          sim_dev;

painter_device_t qp_gc9107_make_spi_device(uint16_t w, uint16_t h, pin_t cs, pin_t dc, pin_t rst, uint16_t div, int mode) {
    (void)cs; (void)dc; (void)rst; (void)div; (void)mode;
    sim_dev.driver_vtable         = &drv_vt;
    sim_dev.comms_vtable          = (const painter_comms_vtable_t *)&com_vt;
    sim_dev.panel_width           = w;
    sim_dev.panel_height          = h;
    sim_dev.native_bits_per_pixel = 24;
    return &sim_dev;
}

// ---------------------------------------------------------------------------
// PNG (sans compression : blocs « stored » de deflate)

static uint32_t crc_table[256];
static void crc_init(void) {
    for (uint32_t n = 0; n < 256; n++) {
        uint32_t c = n;
        for (int k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1;
        crc_table[n] = c;
    }
}
static uint32_t crc(uint32_t c, const uint8_t *b, size_t n) {
    c ^= 0xFFFFFFFFu;
    for (size_t i = 0; i < n; i++) c = crc_table[(c ^ b[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFu;
}
static void be32(uint8_t *p, uint32_t v) { p[0] = v >> 24; p[1] = v >> 16; p[2] = v >> 8; p[3] = v; }
static void chunk(FILE *f, const char *type, const uint8_t *data, uint32_t n) {
    uint8_t hdr[8];
    be32(hdr, n);
    memcpy(hdr + 4, type, 4);
    fwrite(hdr, 1, 8, f);
    if (n) fwrite(data, 1, n, f);
    // Le CRC porte sur le type et les données.
    uint8_t *tmp = malloc(n + 4);
    memcpy(tmp, type, 4);
    if (n) memcpy(tmp + 4, data, n);
    uint32_t c = crc(0, tmp, n + 4);
    free(tmp);
    uint8_t t[4];
    be32(t, c);
    fwrite(t, 1, 4, f);
}
static void png_write(const char *path, int w, int h, const uint8_t *rgb) {
    FILE *f = fopen(path, "wb");
    if (!f) { perror(path); exit(1); }
    static const uint8_t sig[8] = {137, 80, 78, 71, 13, 10, 26, 10};
    fwrite(sig, 1, 8, f);
    uint8_t ihdr[13];
    be32(ihdr, w); be32(ihdr + 4, h);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = ihdr[11] = ihdr[12] = 0;
    chunk(f, "IHDR", ihdr, 13);
    size_t   raw_n = (size_t)h * (1 + w * 3);
    uint8_t *raw   = malloc(raw_n);
    for (int y = 0; y < h; y++) {
        raw[y * (1 + w * 3)] = 0;
        memcpy(raw + y * (1 + w * 3) + 1, rgb + (size_t)y * w * 3, w * 3);
    }
    size_t   blocks = (raw_n + 65534) / 65535;
    size_t   z_n    = 2 + raw_n + blocks * 5 + 4;
    uint8_t *z = malloc(z_n), *p = z;
    *p++ = 0x78; *p++ = 0x01;
    uint32_t a = 1, b = 0;
    for (size_t i = 0; i < raw_n; i++) { a = (a + raw[i]) % 65521; b = (b + a) % 65521; }
    for (size_t off = 0; off < raw_n; off += 65535) {
        size_t n = raw_n - off < 65535 ? raw_n - off : 65535;
        *p++ = off + n >= raw_n ? 1 : 0;
        *p++ = n & 0xFF; *p++ = n >> 8; *p++ = ~n & 0xFF; *p++ = (~n >> 8) & 0xFF;
        memcpy(p, raw + off, n);
        p += n;
    }
    be32(p, (b << 16) | a);
    p += 4;
    chunk(f, "IDAT", z, (uint32_t)(p - z));
    chunk(f, "IEND", NULL, 0);
    fclose(f);
    free(raw);
    free(z);
}

static void save_scaled(const char *path, const uint8_t *img, int scale) {
    int      w = UI_W * scale, h = UI_H * scale;
    uint8_t *big = malloc((size_t)w * h * 3);
    for (int y = 0; y < h; y++)
        for (int x = 0; x < w; x++) memcpy(big + ((size_t)y * w + x) * 3, img + ((size_t)(y / scale) * UI_W + x / scale) * 3, 3);
    png_write(path, w, h, big);
    free(big);
}

// ---------------------------------------------------------------------------
// Scènes

#define MAX_SCENES 40
static uint8_t     shots[MAX_SCENES][UI_H][UI_W][3];
static int         n_shots;
static const char *out_dir;
static const char *theme_dir;
static int         problems;

static void snap(const char *name) {
    char path[512];
    snprintf(path, sizeof(path), "%s/%s/%s.png", out_dir, theme_dir, name);
    save_scaled(path, &fb[0][0][0], 3);
    if (n_shots < MAX_SCENES) memcpy(shots[n_shots++], fb, sizeof(fb));
    printf("  %s\n", name);
}

// Dessin partiel, puis contrôle par un dessin complet de la même scène.
static void partial(const char *name) {
    redraw(false);
    static uint8_t part[UI_H][UI_W][3];
    memcpy(part, fb, sizeof(fb));
    snap(name);
    redraw(true);
    int diff = 0;
    static uint8_t mask[UI_H][UI_W][3];
    for (int y = 0; y < UI_H; y++)
        for (int x = 0; x < UI_W; x++) {
            bool d = memcmp(part[y][x], fb[y][x], 3) != 0;
            diff += d;
            mask[y][x][0] = d ? 255 : fb[y][x][0] / 3;
            mask[y][x][1] = d ? 0 : fb[y][x][1] / 3;
            mask[y][x][2] = d ? 0 : fb[y][x][2] / 3;
        }
    if (diff) {
        char path[512];
        snprintf(path, sizeof(path), "%s/%s/%s-ecart.png", out_dir, theme_dir, name);
        save_scaled(path, &mask[0][0][0], 3);
        printf("  ÉCART %s : %d pixels diffèrent entre dessin partiel et dessin complet (%s-ecart.png)\n", name, diff, name);
        problems++;
    }
}

static void full(const char *name) {
    redraw(true);
    snap(name);
}

static const char *const ITEM_FILE[IT_COUNT] = {"effet", "luminosite", "vitesse", "couleur", "veille", "ecran"};

static void run_theme(uint8_t idx, const char *dir) {
    theme_dir = dir;
    n_shots   = 0;
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", out_dir, dir);
    mkdir(path, 0755);
    printf("%s :\n", dir);

    // État de départ identique pour chaque interface.
    sim_caps = false; sim_connected = true; sim_slot = 1; sim_battery = 87; sim_time_set = true;
    sim_time = (rtc_time_t){42, 37, 14, 21, 6, 11, 2026};
    rgb_on = true; rgb_mode = RGB_MATRIX_CYCLE_LEFT_RIGHT; rgb_h = 142; rgb_s = 255; rgb_v = 160; rgb_spd = 153;
    sim_sleep = 1;
    connection_mode = CONN_USB;

    sim_theme    = idx;
    ui.theme_idx = idx;
    theme_use(idx);
    ui.screen = SCR_HOME;
    load_values();

    // Accueil
    full("accueil");
    sim_time.seconds = 43;
    partial("accueil-seconde");
    sim_time = (rtc_time_t){7, 5, 9, 1, 2, 12, 2026};   // mar. 1 déc. 09:05:07
    sim_caps = true; connection_mode = CONN_BT; sim_slot = 2; sim_battery = 15;
    partial("accueil-bt-maj");
    connection_mode = CONN_24G; sim_connected = false; sim_battery = 0xFF; sim_caps = false;
    sim_time = (rtc_time_t){59, 59, 23, 31, 1, 8, 2026};  // lun. 31 août 23:59:59
    partial("accueil-24g-attente");
    connection_mode = CONN_USB; sim_connected = true; sim_battery = 100;
    sim_time = (rtc_time_t){42, 37, 14, 21, 6, 11, 2026};
    partial("accueil-retour");

    // Menu : ouverture puis un cran par entrée
    display_menu_open();
    snap("menu-effet");
    for (uint8_t i = 1; i < IT_COUNT; i++) {
        ui.sel = i;
        last_input = now_ms;
        char name[64];
        snprintf(name, sizeof(name), "menu-%s", ITEM_FILE[i]);
        partial(name);
    }
    ui.sel = 0;
    partial("menu-retour-debut");

    // Réglages : chaque entrée, puis deux crans de molette (sauf Écran, qui
    // changerait d'interface)
    for (uint8_t i = 0; i < IT_COUNT; i++) {
        ui.sel    = i;
        ui.screen = SCR_MENU;
        display_menu_press();
        char name[64];
        snprintf(name, sizeof(name), "reglage-%s", ITEM_FILE[i]);
        snap(name);
        if (i != IT_THEME) {
            display_menu_rotate(true);
            display_menu_rotate(true);
            // display_menu_rotate a déjà fait un dessin partiel ; on le contrôle.
            snprintf(name, sizeof(name), "reglage-%s-2", ITEM_FILE[i]);
            partial(name);
            // Retour à la valeur de départ dans l'autre sens.
            display_menu_rotate(false);
            display_menu_rotate(false);
            display_menu_rotate(false);
            snprintf(name, sizeof(name), "reglage-%s-moins", ITEM_FILE[i]);
            partial(name);
        }
        display_menu_close();   // valide et revient à l'accueil
        ui.screen = SCR_HOME;
    }

    // Planche : toutes les scènes, 2 fois, 6 par ligne.
    int cols = 6, rows = (n_shots + cols - 1) / cols, sc = 2, gap = 8;
    int W = cols * (UI_W * sc + gap) + gap, H = rows * (UI_H * sc + gap) + gap;
    uint8_t *sheet = malloc((size_t)W * H * 3);
    memset(sheet, 0x55, (size_t)W * H * 3);
    for (int k = 0; k < n_shots; k++) {
        int ox = gap + (k % cols) * (UI_W * sc + gap), oy = gap + (k / cols) * (UI_H * sc + gap);
        for (int y = 0; y < UI_H * sc; y++)
            for (int x = 0; x < UI_W * sc; x++) memcpy(sheet + ((size_t)(oy + y) * W + ox + x) * 3, shots[k][y / sc][x / sc], 3);
    }
    snprintf(path, sizeof(path), "%s/%s/planche.png", out_dir, dir);
    png_write(path, W, H, sheet);
    free(sheet);
    printf("  planche.png (%d scènes)\n", n_shots);
}

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "usage : sim <dossier> [cadran|terminal|tuiles]...\n");
        return 2;
    }
    crc_init();
    out_dir = argv[1];
    mkdir(out_dir, 0755);

    display_init_kb();
    if (pending_cb) pending_cb(0, NULL);   // premier dessin (defer_exec)

    static const char *const NAMES[] = {"cadran", "terminal", "tuiles"};
    for (uint8_t i = 0; i < THEME_COUNT; i++) {
        bool want = argc == 2;
        for (int a = 2; a < argc; a++) want |= strcmp(argv[a], NAMES[i]) == 0;
        if (want) run_theme(i, NAMES[i]);
    }
    if (out_of_bounds) {
        printf("HORS ÉCRAN : %u pixels écrits hors des 128 x 128\n", (unsigned)out_of_bounds);
        problems++;
    }
    printf(problems ? "%d problème(s)\n" : "aucun problème\n", problems);
    return problems ? 1 : 0;
}
