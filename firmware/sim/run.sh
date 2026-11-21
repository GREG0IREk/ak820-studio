#!/bin/sh
# Simulateur de l'écran : compile display.c + theme_*.c + Quantum Painter pour le
# PC et produit une capture PNG de chaque scène dans firmware/sim/out/<interface>/.
# Voir firmware/ECRAN.md.
#
# Depuis pve (copie le dossier firmware sur la VM, compile et lance là-bas,
# puis rapatrie les images) :
#   sh firmware/sim/run.sh                 # les trois interfaces
#   sh firmware/sim/run.sh terminal        # une seule
#   SIM_NAME=agent1 sh firmware/sim/run.sh  # dossier de travail séparé sur la VM
#
# Il faut, sur la VM, l'arbre QMK préparé par build.sh (~/ak820-build/qmk_firmware)
# et l'image Docker ghcr.io/qmk/qmk_cli (qui contient gcc).
set -eu

HERE=$(cd "$(dirname "$0")" && pwd)
FW=$(cd "$HERE/.." && pwd)
VM=${VM:-greg@192.168.0.174}
SIM_NAME=${SIM_NAME:-default}
REMOTE=ak820-sim/$SIM_NAME
QMK_DIR=${QMK_DIR:-ak820-build/qmk_firmware}

ssh "$VM" "mkdir -p $REMOTE"
rsync -a --delete --exclude .build --exclude out --exclude sim/out "$FW/" "$VM:$REMOTE/firmware/"

status=0
ssh "$VM" "cd ~/$REMOTE && rm -rf out && mkdir -p out && docker run --rm --user \$(id -u):\$(id -g) \
  -v \$PWD:/w -v \$HOME/$QMK_DIR:/qmk:ro -w /w ghcr.io/qmk/qmk_cli:latest sh -c '
set -e
KB=firmware/qmk/keyboards/a_jazz/ak820pro
P=/qmk/quantum/painter
gcc -std=gnu11 -funsigned-char -O1 -g -Wall -Wno-unused-function -Wno-unused-variable -Wno-address-of-packed-member \
  -DQUANTUM_PAINTER_NUM_IMAGES=12 -DQUANTUM_PAINTER_NUM_FONTS=5 -DLCD_PANEL_V1 \
  -Ifirmware/sim/stub -I\$KB -I\$P -I/qmk/quantum -I/qmk/quantum/unicode \
  firmware/sim/sim.c \$KB/graphics/theme_*.c \$KB/graphics/res_*/*.c \
  \$P/qp.c \$P/qp_comms.c \$P/qp_draw_core.c \$P/qp_draw_codec.c \$P/qp_draw_image.c \$P/qp_draw_text.c \
  \$P/qp_stream.c \$P/qff.c \$P/qgf.c \$P/qp_draw_circle.c \$P/qp_draw_ellipse.c \
  /qmk/quantum/color.c /qmk/quantum/unicode/utf8.c -o out/sim
./out/sim out $*
'" || status=$?

mkdir -p "$HERE/out"
rsync -a --delete --exclude sim "$VM:$REMOTE/out/" "$HERE/out/"
echo "Images : $HERE/out/"
exit $status
