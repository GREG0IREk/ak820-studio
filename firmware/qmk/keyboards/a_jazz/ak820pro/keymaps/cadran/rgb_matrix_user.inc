// Effet « Personnalisé » : une couleur par touche, envoyée par AK820 Studio
// (keymaps/cadran/studio.c) et réglée en intensité par la luminosité globale.
RGB_MATRIX_EFFECT(perso)
RGB_MATRIX_EFFECT(extinction)

#ifdef RGB_MATRIX_CUSTOM_EFFECT_IMPLS
const uint8_t *ak820_perkey_color(uint8_t led);

// « Touche éteinte » : tout est allumé, la touche frappée s'éteint puis se rallume
// (l'inverse de « Touche allumée »).
static hsv_t extinction_math(hsv_t hsv, uint16_t offset) {
    if (offset > 255) offset = 255;
    hsv.v = scale8(offset, hsv.v);
    return hsv;
}

static bool extinction(effect_params_t *params) {
    return effect_runner_reactive(params, &extinction_math);
}

static bool perso(effect_params_t *params) {
    RGB_MATRIX_USE_LIMITS(led_min, led_max);
    uint8_t v = rgb_matrix_get_val();
    for (uint8_t i = led_min; i < led_max; i++) {
        RGB_MATRIX_TEST_LED_FLAGS();
        const uint8_t *c = ak820_perkey_color(i);
        rgb_matrix_set_color(i, scale8(c[0], v), scale8(c[1], v), scale8(c[2], v));
    }
    return rgb_matrix_check_finished_leds(led_max);
}
#endif
