#!/bin/sh
# Compile sonixflasher-hid.exe (SonixFlasherC 3.1.0 avec hidapi natif) pour Windows.
# Il faut Docker. Résultat : firmware/out/sonixflasher-hid.exe
#
# Deux correctifs sont appliqués :
#   hidapi-windows.patch  : la version officielle passe par libusb et ne voit pas le clavier ;
#   partial-erase.patch   : SF_ERASE_PAGES=n n'efface que les n premières pages au lieu de
#                           toute la puce, ce qui garde l'EEPROM (réglages) à la mise à jour.
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../../out
mkdir -p "$OUT"
docker run --rm -v "$HERE:/src:ro" -v "$OUT:/out" debian:bookworm sh -c '
  set -e
  apt-get -qq update >/dev/null
  apt-get -qq install -y gcc-mingw-w64-x86-64 curl ca-certificates patch >/dev/null
  cd /tmp
  curl -fsSL https://github.com/libusb/hidapi/archive/refs/tags/hidapi-0.14.0.tar.gz | tar xz
  curl -fsSL https://github.com/SonixQMK/SonixFlasherC/archive/refs/tags/3.1.0.tar.gz | tar xz
  H=/tmp/hidapi-hidapi-0.14.0
  cd SonixFlasherC-3.1.0
  patch -p1 < /src/hidapi-windows.patch
  patch -p1 < /src/partial-erase.patch
  x86_64-w64-mingw32-gcc -O2 -Iinclude -I$H/hidapi src/checksum.c src/chip.c src/cli.c src/device.c \
      src/file_util.c src/flash.c src/hid_io.c src/log.c src/main.c src/mem.c src/usb_device_hidapi.c \
      $H/windows/hid.c -o /out/sonixflasher-hid.exe -lsetupapi -static
  chown '"$(id -u):$(id -g)"' /out/sonixflasher-hid.exe'
echo "Prêt : $OUT/sonixflasher-hid.exe"
