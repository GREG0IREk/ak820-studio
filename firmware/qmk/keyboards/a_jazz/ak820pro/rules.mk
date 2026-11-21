QUANTUM_PAINTER_ENABLE = yes
QUANTUM_PAINTER_DRIVERS += gc9107_spi

# LCD panel hardware revision. At least two exist, needing different MADCTL
# orientation/inversion (see the comment in graphics/display.c). Pick with:
#   qmk compile -kb a_jazz/ak820pro -km default -e LCD_PANEL=v2
LCD_PANEL ?= v1

ifeq ($(strip $(LCD_PANEL)),v2)
    OPT_DEFS += -DLCD_PANEL_V2
else
    OPT_DEFS += -DLCD_PANEL_V1
endif

# CH582F wireless module exposed through QMK's official Bluetooth driver API.
# BLUETOOTH_DRIVER = custom defines BLUETOOTH_ENABLE, CONNECTION_ENABLE and
# NO_USB_STARTUP_CHECK and compiles bluetooth.c (weak bluetooth_* defaults);
# our ch582f_ajazz.c (below in SRC) provides the strong overrides.
BLUETOOTH_ENABLE = yes
BLUETOOTH_DRIVER = custom

# WIP: external PCF8563 RTC over the ChibiOS software (bit-banged) I2C fallback LLD.
# Swaps the SN32 HW I2C driver for the SW fallback; rtc.c drives it via the I2C HAL
# API. Does NOT work on hardware yet (compiles/links fine) -- see rtc.c.
USE_HAL_I2C_FALLBACK = yes

SRC += bluetooth/ch582f_ajazz.c

# Interface « Cadran » (graphics/display.c) : polices Space Grotesk et icônes du
# menu, générées par firmware/assets/generate.sh du dépôt ak820-studio.
SRC += graphics/res_cadran/cadran_big.qff.c
SRC += graphics/res_cadran/cadran_mid.qff.c
SRC += graphics/res_cadran/cadran_small.qff.c
SRC += graphics/res_cadran/ic_effet_26.qgf.c
SRC += graphics/res_cadran/ic_effet_18.qgf.c
SRC += graphics/res_cadran/ic_lumiere_26.qgf.c
SRC += graphics/res_cadran/ic_lumiere_18.qgf.c
SRC += graphics/res_cadran/ic_vitesse_26.qgf.c
SRC += graphics/res_cadran/ic_vitesse_18.qgf.c
SRC += graphics/res_cadran/ic_couleur_26.qgf.c
SRC += graphics/res_cadran/ic_couleur_18.qgf.c
SRC += graphics/res_cadran/ic_veille_26.qgf.c
SRC += graphics/res_cadran/ic_veille_18.qgf.c
SRC += graphics/res_cadran/ic_retour_26.qgf.c
SRC += graphics/res_cadran/ic_retour_18.qgf.c

SRC += graphics/display.c
SRC += rtc/rtc.c
SRC += media/media.c
VPATH += bluetooth
VPATH += graphics
VPATH += rtc
VPATH += media
