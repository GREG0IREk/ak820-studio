#!/bin/sh
# Régénère les polices et icônes des interfaces de l'écran (fichiers .qff.c/.qgf.c)
# dans graphics/res_cadran, res_terminal et res_tuiles. Il faut seulement Docker.
# Les fichiers produits sont versionnés : ne relancer ce script que pour changer
# une police, une taille, un jeu de caractères ou une icône (voir firmware/ECRAN.md).
#
#   sh firmware/assets/generate.sh <dossier qmk_firmware préparé par build.sh>
set -eu
QMK_DIR=$(cd "${1:?chemin vers qmk_firmware}" && pwd)

HERE=$(cd "$(dirname "$0")" && pwd)
GFX="$HERE/../qmk/keyboards/a_jazz/ak820pro/graphics"
WORK=$(mktemp -d)
# Les conteneurs écrivent en root : on nettoie aussi via Docker.
trap 'docker run --rm -v "$WORK:/w" alpine:latest rm -rf /w/src /w/out; rm -rf "$WORK"' EXIT

FONTS=https://raw.githubusercontent.com/google/fonts/main/ofl
QMK_IMAGE=ghcr.io/qmk/qmk_cli:latest

# VT323 (Terminal) n'est nette qu'à partir de 16 px : en dessous, M/N et m/n se confondent.
# Glyphes en plus de l'ASCII (accents français, degré).
ACCENTS='éèêëàâçùûôîïÉÈÊÀÇÛÔÎ°'
# Les grandes polices ne contiennent que ce qu'affichent l'heure et les réglages.
TIME_GLYPHS='0123456789:-'
VALUE_GLYPHS='0123456789:%/ minJas°-'

cp "$HERE/make_sources.py" "$WORK/"
curl -fsSL "$FONTS/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf" -o "$WORK/SpaceGrotesk.ttf"
curl -fsSL "$FONTS/inter/Inter%5Bopsz,wght%5D.ttf" -o "$WORK/Inter.ttf"
curl -fsSL "$FONTS/vt323/VT323-Regular.ttf" -o "$WORK/VT323.ttf"

# 1. Icônes PNG + instances de police (conteneur Python jetable).
docker run --rm -v "$WORK:/w" -w /w python:3.12-slim sh -c '
  apt-get -qq update >/dev/null && apt-get -qq install -y libcairo2 >/dev/null &&
  pip -q install --root-user-action=ignore cairosvg fonttools &&
  python -I make_sources.py SpaceGrotesk.ttf Inter.ttf src && cp VT323.ttf src/ &&
  chown -R '"$(id -u):$(id -g)"' src'

# 2. Conversion au format Quantum Painter (conteneur QMK jetable).
# Les commandes « qmk painter-* » n'existent qu'à l'intérieur d'un dépôt qmk_firmware.
# font <dossier> <nom> <ttf> <taille> <glyphes> [ascii|noascii]
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK:/w" -v "$QMK_DIR:/qmk_firmware" -w /qmk_firmware "$QMK_IMAGE" sh -c "
  set -e
  mkdir -p /w/out/res_cadran /w/out/res_terminal /w/out/res_tuiles
  font() {
    n=''; [ \"\$6\" = noascii ] && n=-n
    qmk painter-make-font-image --font /w/src/\$3 --size \$4 \$n -u \"\$5\" -o /w/src/\$2.png
    qmk painter-convert-font-image --input /w/src/\$2.png -f mono4 \$n -u \"\$5\" -o /w/out/\$1 >/dev/null
  }
  for f in /w/src/ic_*_26.png /w/src/ic_*_18.png; do qmk painter-convert-graphics -i \"\$f\" -f mono4 -o /w/out/res_cadran >/dev/null; done
  for f in /w/src/ic_*_12.png; do qmk painter-convert-graphics -i \"\$f\" -f mono4 -o /w/out/res_tuiles >/dev/null; done

  font res_cadran cadran_big   spacegrotesk_semibold.ttf 30 '$TIME_GLYPHS%/ minJas°' noascii
  font res_cadran cadran_mid   spacegrotesk_semibold.ttf 14 '$ACCENTS' ascii
  font res_cadran cadran_small spacegrotesk_regular.ttf  11 '$ACCENTS' ascii

  font res_terminal term_huge  VT323.ttf 42 '$TIME_GLYPHS' noascii
  font res_terminal term_big   VT323.ttf 32 '$VALUE_GLYPHS' noascii
  font res_terminal term_mid   VT323.ttf 22 '$ACCENTS' ascii
  font res_terminal term_text  VT323.ttf 16 '$ACCENTS' ascii

  font res_tuiles tui_time  inter_800_32.ttf 30 '$TIME_GLYPHS' noascii
  font res_tuiles tui_value inter_800_32.ttf 26 '$VALUE_GLYPHS' noascii
  font res_tuiles tui_mid   inter_800_14.ttf 17 '$ACCENTS' ascii
  font res_tuiles tui_bold  inter_700_14.ttf 9  '$ACCENTS' ascii
  font res_tuiles tui_small inter_400_14.ttf 8  '$ACCENTS' ascii
"

for d in res_cadran res_terminal res_tuiles; do
    mkdir -p "$GFX/$d"
    rm -f "$GFX/$d"/*.qgf.* "$GFX/$d"/*.qff.*
    cp "$WORK/out/$d"/* "$GFX/$d/"
done
ls -l "$GFX"/res_*
