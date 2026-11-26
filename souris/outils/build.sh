#!/bin/sh
# Compile souris.exe (Windows, hidapi statique) sur la VM docker, puis la copie sur le PC fixe.
set -eu
cd "$(dirname "$0")"
scp -q souris.c greg@192.168.0.174:aj139-build/souris.c
ssh greg@192.168.0.174 'cd ~/aj139-build && docker run --rm -v $PWD:/w debian:bookworm sh -c "
set -e; apt-get -qq update >/dev/null; apt-get -qq install -y gcc-mingw-w64-x86-64 curl ca-certificates >/dev/null 2>&1
cd /tmp; curl -fsSL https://github.com/libusb/hidapi/archive/refs/tags/hidapi-0.14.0.tar.gz | tar xz; H=/tmp/hidapi-hidapi-0.14.0
x86_64-w64-mingw32-gcc -O2 -I\$H/hidapi /w/souris.c \$H/windows/hid.c -o /w/souris.exe -lsetupapi -static; chown $(id -u):$(id -g) /w/souris.exe"'
scp -q greg@192.168.0.174:aj139-build/souris.exe souris.exe
scp -q souris.exe 'pcfixe:C:/aj139/souris.exe'
echo ok
