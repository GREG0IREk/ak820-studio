// ak820-maj : outil de mise à jour de l'AK820 Pro sous QMK « Cadran ».
//
//   ak820-maj version   affiche la version du micrologiciel
//   ak820-maj boot      redémarre le clavier en mode flash (bootloader 0c45:7140),
//                       sans toucher au clavier
//   ak820-maj info      état lu par le canal d'AK820 Studio (0x14, Cadran 1.1 et plus) :
//                       effets, éclairage, veille, première rangée de la keymap (lecture seule)
//
// Parle au canal HID brut de QMK (page 0xFF60, usage 0x61) avec le cadre des
// commandes « custom value » de VIA : [0x07, canal 0x13, commande, ...].
// Ne fonctionne que si le clavier tourne déjà sous Cadran ; sinon, Fn+Échap.
//
// Compilation (Windows, depuis Linux) : voir firmware/tools/build-windows.sh
// Compilation (Linux / macOS) : cc ak820-maj.c -o ak820-maj $(pkg-config --cflags --libs hidapi)
#include <stdio.h>
#include <string.h>

#include <hidapi.h>

#define VID            0x0C45
#define PID            0x8009
#define RAW_USAGE_PAGE 0xFF60
#define RAW_USAGE      0x61
#define REPORT_LEN     32

#define SET_VALUE      0x07
#define SYS_CHANNEL    0x13
#define SYS_BOOTLOADER 0x01
#define SYS_VERSION    0x02
#define STUDIO_CHANNEL 0x14

static hid_device *open_raw(void) {
    hid_device             *dev  = NULL;
    struct hid_device_info *list = hid_enumerate(VID, PID), *cur;
    for (cur = list; cur; cur = cur->next) {
        if (cur->usage_page == RAW_USAGE_PAGE && cur->usage == RAW_USAGE) {
            dev = hid_open_path(cur->path);
            if (dev) break;
        }
    }
    hid_free_enumeration(list);
    return dev;
}

// Envoie [0x07, canal, cmd, args…]. Renvoie le nombre d'octets reçus en réponse (0 si aucune).
static int chan_cmd(hid_device *dev, unsigned char channel, unsigned char cmd, const unsigned char *args, size_t nargs, unsigned char *rep) {
    unsigned char buf[REPORT_LEN + 1] = {0};
    buf[1] = SET_VALUE;
    buf[2] = channel;
    buf[3] = cmd;
    if (nargs > REPORT_LEN - 3) nargs = REPORT_LEN - 3;
    if (args) memcpy(&buf[4], args, nargs);
    if (hid_write(dev, buf, sizeof(buf)) < 0) return -1;
    return hid_read_timeout(dev, rep, REPORT_LEN, 1500);
}

static int sys_cmd(hid_device *dev, unsigned char cmd, const char *arg, unsigned char *rep) {
    return chan_cmd(dev, SYS_CHANNEL, cmd, (const unsigned char *)arg, arg ? strlen(arg) : 0, rep);
}

// Canal d'AK820 Studio : renvoie 1 si la réponse est valide.
static int studio(hid_device *dev, unsigned char cmd, const unsigned char *args, size_t nargs, unsigned char *rep) {
    int n = chan_cmd(dev, STUDIO_CHANNEL, cmd, args, nargs, rep);
    return n > 3 && rep[0] == SET_VALUE && rep[1] == STUDIO_CHANNEL && rep[2] == cmd;
}

static int info(hid_device *dev) {
    unsigned char r[REPORT_LEN];
    if (!studio(dev, 0x01, NULL, 0, r)) {
        fprintf(stderr, "Pas de canal AK820 Studio : firmware antérieur à Cadran 1.1.\n");
        return 1;
    }
    unsigned char n_eff = r[4], layers = r[5], rows = r[6], cols = r[7];
    printf("protocole %u, %u effets, %u couches, matrice %ux%u, %u LED\n", r[3], n_eff, layers, rows, cols, r[8]);
    printf("veille : choix %u parmi", r[10]);
    for (int i = 0; i < r[9] && 14 + i < REPORT_LEN; i++) printf(" %umin", r[14 + i]);
    printf("\neffet Personnalisé : %d, couche de base : %u, batterie : %u\n", r[11] == 0xFF ? -1 : r[11], r[12], r[13]);
    printf("effets :");
    for (unsigned char i = 0; i < n_eff; i++) {
        unsigned char e[REPORT_LEN];
        if (studio(dev, 0x02, &i, 1, e)) { e[REPORT_LEN - 1] = 0; printf(" [%u] %s", i, (const char *)&e[4]); }
    }
    if (studio(dev, 0x03, NULL, 0, r))
        printf("\néclairage : effet %u, teinte %u, saturation %u, luminosité %u/%u, vitesse %u\n", r[3], r[4], r[5], r[6], r[8], r[7]);
    for (int factory = 0; factory < 2; factory++) {
        unsigned char a[3] = {0, 0, 26};
        if (!studio(dev, factory ? 0x08 : 0x06, a, 3, r)) continue;
        printf("%s, rangée 0 :", factory ? "keymap d'origine" : "keymap active  ");
        for (int k = 0; k < 13; k++) printf(" %04x", (r[6 + 2 * k] << 8) | r[7 + 2 * k]);
        printf("\n");
    }
    return 0;
}

int main(int argc, char **argv) {
    if (argc < 2 || (strcmp(argv[1], "version") && strcmp(argv[1], "boot") && strcmp(argv[1], "info"))) {
        fprintf(stderr, "usage : %s version | boot | info\n", argv[0]);
        return 2;
    }
    if (hid_init()) return 1;
    hid_device *dev = open_raw();
    if (!dev) {
        fprintf(stderr, "Clavier introuvable (0c45:8009, interface HID brute FF60).\n");
        hid_exit();
        return 1;
    }

    unsigned char rep[REPORT_LEN] = {0};
    int           ret             = 1;
    if (!strcmp(argv[1], "info")) {
        ret = info(dev);
    } else if (!strcmp(argv[1], "version")) {
        int n = sys_cmd(dev, SYS_VERSION, NULL, rep);
        if (n > 3 && rep[0] == SET_VALUE) {
            rep[REPORT_LEN - 1] = 0;
            printf("%s\n", (const char *)&rep[3]);
            ret = 0;
        } else {
            fprintf(stderr, "Pas de réponse : le clavier ne tourne pas sous Cadran.\n");
        }
    } else {
        int n = sys_cmd(dev, SYS_BOOTLOADER, "BOOT", rep);
        if (n > 0 && rep[0] == SET_VALUE) {
            printf("Redémarrage en mode flash demandé.\n");
            ret = 0;
        } else {
            fprintf(stderr, "Commande refusée : le clavier ne tourne pas sous Cadran (utiliser Fn+Échap).\n");
        }
    }
    hid_close(dev);
    hid_exit();
    return ret;
}
