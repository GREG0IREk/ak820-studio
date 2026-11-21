#!/bin/sh
# Compile ak820-maj.exe pour Windows (hidapi natif, exécutable autonome).
# Il faut Docker. Résultat : firmware/out/ak820-maj.exe
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=$HERE/../out
mkdir -p "$OUT"
docker run --rm -v "$HERE:/src:ro" -v "$OUT:/out" debian:bookworm sh -c '
  set -e
  apt-get -qq update >/dev/null
  apt-get -qq install -y gcc-mingw-w64-x86-64 curl ca-certificates >/dev/null
  cd /tmp
  curl -fsSL https://github.com/libusb/hidapi/archive/refs/tags/hidapi-0.14.0.tar.gz | tar xz
  H=/tmp/hidapi-hidapi-0.14.0
  x86_64-w64-mingw32-gcc -O2 -I$H/hidapi /src/ak820-maj.c $H/windows/hid.c \
      -o /out/ak820-maj.exe -lsetupapi -static
  chown '"$(id -u):$(id -g)"' /out/ak820-maj.exe'
echo "Prêt : $OUT/ak820-maj.exe"
