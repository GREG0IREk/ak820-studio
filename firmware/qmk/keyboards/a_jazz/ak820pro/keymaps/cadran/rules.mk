# Pas d'ENCODER_MAP : la molette passe par encoder_update_user (menu de l'écran).

# AK820 Studio (canal HID 0x14, studio.c) : keymap modifiable depuis le site,
# effet « Personnalisé » (couleur par touche, rgb_matrix_user.inc).
DYNAMIC_KEYMAP_ENABLE = yes
RGB_MATRIX_CUSTOM_USER = yes
SRC += studio.c

# Clics et molette de souris : les macros les envoient (MS_BTN1..3, MS_WHLU/D).
MOUSEKEY_ENABLE = yes
