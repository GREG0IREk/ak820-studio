#!/bin/sh
# Régénère les polices et icônes de l'interface « Cadran » (fichiers .qff.c/.qgf.c).
# Il faut seulement Docker. Les fichiers produits sont versionnés : ne relancer
# ce script que pour changer une police, une taille ou une icône.
#
#   sh firmware/assets/generate.sh <dossier qmk_firmware préparé par build.sh>
set -eu
QMK_DIR=$(cd "${1:?chemin vers qmk_firmware}" && pwd)

HERE=$(cd "$(dirname "$0")" && pwd)
RES="$HERE/../qmk/keyboards/a_jazz/ak820pro/graphics/res_cadran"
WORK=$(mktemp -d)
# Les conteneurs écrivent en root : on nettoie aussi via Docker.
trap 'docker run --rm -v "$WORK:/w" alpine:latest rm -rf /w/src /w/out; rm -rf "$WORK"' EXIT

FONT_URL='https://raw.githubusercontent.com/google/fonts/main/ofl/spacegrotesk/SpaceGrotesk%5Bwght%5D.ttf'
QMK_IMAGE=ghcr.io/qmk/qmk_cli:latest

# Glyphes en plus de l'ASCII (accents français, degré, points de suspension).
ACCENTS='éèêëàâçùûôîïÉÈÊÀÇ°'
# La grande police ne contient que ce qu'affichent l'heure et les réglages.
BIG_GLYPHS='0123456789:%/ minJas°'

cp "$HERE/make_sources.py" "$WORK/"
curl -fsSL "$FONT_URL" -o "$WORK/SpaceGrotesk.ttf"

# 1. Icônes PNG + instances de police (conteneur Python jetable).
docker run --rm -v "$WORK:/w" -w /w python:3.12-slim sh -c '
  apt-get -qq update >/dev/null && apt-get -qq install -y libcairo2 >/dev/null &&
  pip -q install --root-user-action=ignore cairosvg fonttools &&
  python -I make_sources.py SpaceGrotesk.ttf src && chown -R '"$(id -u):$(id -g)"' src'

# 2. Conversion au format Quantum Painter (conteneur QMK jetable).
# Les commandes « qmk painter-* » n'existent qu'à l'intérieur d'un dépôt qmk_firmware.
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$WORK:/w" -v "$QMK_DIR:/qmk_firmware" -w /qmk_firmware "$QMK_IMAGE" sh -c "
  set -e
  cd /w && mkdir -p out && cd /qmk_firmware
  for f in /w/src/ic_*.png; do qmk painter-convert-graphics -i \"\$f\" -f mono4 -o /w/out >/dev/null; done
  qmk painter-make-font-image --font /w/src/spacegrotesk_semibold.ttf --size 30 -n -u '$BIG_GLYPHS' -o /w/src/cadran_big.png
  qmk painter-convert-font-image --input /w/src/cadran_big.png -f mono4 -n -u '$BIG_GLYPHS' -o /w/out >/dev/null
  qmk painter-make-font-image --font /w/src/spacegrotesk_semibold.ttf --size 14 -u '$ACCENTS' -o /w/src/cadran_mid.png
  qmk painter-convert-font-image --input /w/src/cadran_mid.png -f mono4 -u '$ACCENTS' -o /w/out >/dev/null
  qmk painter-make-font-image --font /w/src/spacegrotesk_regular.ttf --size 11 -u '$ACCENTS' -o /w/src/cadran_small.png
  qmk painter-convert-font-image --input /w/src/cadran_small.png -f mono4 -u '$ACCENTS' -o /w/out >/dev/null
"

mkdir -p "$RES"
rm -f "$RES"/*.qgf.* "$RES"/*.qff.*
cp "$WORK"/out/* "$RES/"
ls -l "$RES"
