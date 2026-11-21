#!/bin/sh
# Compile le micrologiciel QMK « Cadran » de l'AK820 Pro. Il faut Docker et git.
#
#   sh firmware/build.sh            # écran v1 (le plus courant)
#   LCD_PANEL=v2 sh firmware/build.sh
#
# Étapes : récupère le portage QMK de fpb à un commit figé, applique les quatre
# correctifs ChibiOS du portage, copie nos fichiers (dossier qmk/) par-dessus,
# puis compile dans le conteneur officiel QMK. Le .bin arrive dans firmware/out/.
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
WORK=${WORK:-$HERE/.build}
OUT=$HERE/out
LCD_PANEL=${LCD_PANEL:-v1}
KEYMAP=${KEYMAP:-cadran}

QMK_REPO=https://github.com/fpb/qmk_firmware
QMK_COMMIT=75d2d9b19cc6ca29762a02e975c10118e8c7bdde   # branche ak820pro-lcd-embedded
QMK_IMAGE=ghcr.io/qmk/qmk_cli:latest
KB=keyboards/a_jazz/ak820pro

mkdir -p "$WORK" "$OUT"
cd "$WORK"

# 1. Sources QMK au commit figé (+ sous-modules nécessaires au SN32).
if [ ! -d qmk_firmware/.git ]; then
    git init -q qmk_firmware
    git -C qmk_firmware remote add origin "$QMK_REPO"
fi
cd qmk_firmware
if [ "$(git rev-parse -q --verify HEAD 2>/dev/null || true)" != "$QMK_COMMIT" ]; then
    git fetch -q --depth 1 origin "$QMK_COMMIT"
    git checkout -q -f FETCH_HEAD
fi
git submodule update -q --init --depth 1 lib/chibios lib/chibios-contrib lib/printf lib/lufa

# 2. Repart d'un arbre propre, puis correctifs ChibiOS du portage.
git checkout -q -f -- .
git clean -q -fd -- "$KB"
(cd lib/chibios-contrib && git checkout -q -f -- . && \
    for p in hardware_pwm i2c_fallback rtc_lld spi_fifo_pump; do git apply "../../$KB/$p.diff"; done)

# 3. Nos fichiers par-dessus le portage.
cp -R "$HERE/qmk/." .

# 4. Compilation dans le conteneur QMK (jetable).
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/qmk_firmware" -w /qmk_firmware "$QMK_IMAGE" \
    qmk compile -kb a_jazz/ak820pro -km "$KEYMAP" -e LCD_PANEL="$LCD_PANEL"

BIN="ak820pro-${KEYMAP}-${LCD_PANEL}.bin"
cp "a_jazz_ak820pro_${KEYMAP}.bin" "$OUT/$BIN"
echo "Micrologiciel prêt : $OUT/$BIN"
