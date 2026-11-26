// souris : sonde HID pour la souris Ajazz AJ139 V2 MC (dongle A8A5:2255, filaire A8A4:2255).
//   souris list                  liste les interfaces HID de la souris
//   souris send <octets hex...>  envoie une trame de 64 octets sur l'interface 2
//                                (octet 63 = somme de contrôle 0xA1 - somme(0..62)), affiche la réponse
//   souris n <octets hex...>     trame famille Nordic : octet 3 = somme(4..63)
//   souris raw <octets hex...>   idem sans somme de contrôle
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <hidapi.h>

static const unsigned short VIDS[] = {0xA8A5, 0xA8A4};
#define PID 0x2255

static void dump(const char *tag, const unsigned char *b, int n) {
    printf("%s", tag);
    for (int i = 0; i < n; i++) printf("%s%02X", (i && i % 16 == 0) ? "\n    " : " ", b[i]);
    printf("\n");
}

static hid_device *open_cfg(void) {
    for (int v = 0; v < 2; v++) {
        struct hid_device_info *l = hid_enumerate(VIDS[v], PID), *c;
        for (c = l; c; c = c->next)
            if (c->interface_number == 2) {
                hid_device *d = hid_open_path(c->path);
                if (d) { printf("ouvert %04X:%04X if2 page %04X usage %02X\n", c->vendor_id, c->product_id, c->usage_page, c->usage); hid_free_enumeration(l); return d; }
            }
        hid_free_enumeration(l);
    }
    return NULL;
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: souris list | send hex... | raw hex...\n"); return 2; }
    hid_init();
    if (!strcmp(argv[1], "list")) {
        for (int v = 0; v < 2; v++) {
            struct hid_device_info *l = hid_enumerate(VIDS[v], PID), *c;
            for (c = l; c; c = c->next)
                printf("%04X:%04X if%d page %04X usage %02X rel %04X \"%ls\" \"%ls\"\n  %s\n", c->vendor_id, c->product_id,
                       c->interface_number, c->usage_page, c->usage, c->release_number,
                       c->manufacturer_string ? c->manufacturer_string : L"", c->product_string ? c->product_string : L"", c->path);
            hid_free_enumeration(l);
        }
        return 0;
    }
    int chk = !strcmp(argv[1], "send"), nchk = !strcmp(argv[1], "n");
    hid_device *d = open_cfg();
    if (!d) { fprintf(stderr, "interface 2 introuvable\n"); return 1; }
    unsigned char buf[65] = {0}, rep[65];
    for (int i = 2; i < argc && i - 2 < 64; i++) buf[1 + i - 2] = (unsigned char)strtoul(argv[i], NULL, 16);
    if (nchk) { unsigned s = 0; for (int i = 4; i < 64; i++) s += buf[1 + i]; buf[4] = (unsigned char)s; }
    if (chk) { unsigned s = 0; for (int i = 0; i < 63; i++) s += buf[1 + i]; buf[64] = (unsigned char)(0xA1 - s); }
    while (hid_read_timeout(d, rep, 64, 20) > 0) dump("vidange:", rep, 64);
    dump("-> ", buf + 1, 64);
    int w = hid_write(d, buf, 65);
    if (w < 0) { fprintf(stderr, "écriture: %ls\n", hid_error(d)); return 1; }
    for (int k = 0; k < 3; k++) {
        int n = hid_read_timeout(d, rep, 64, 600);
        if (n <= 0) break;
        dump("<- ", rep, n);
    }
    hid_close(d);
    return 0;
}
