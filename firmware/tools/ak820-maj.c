// ak820-maj : outil de mise à jour de l'AK820 Pro sous QMK « Cadran ».
//
//   ak820-maj version   affiche la version du micrologiciel
//   ak820-maj boot      redémarre le clavier en mode flash (bootloader 0c45:7140),
//                       sans toucher au clavier
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

// Envoie une commande système. Renvoie le nombre d'octets reçus en réponse (0 si aucune).
static int sys_cmd(hid_device *dev, unsigned char cmd, const char *arg, unsigned char *rep) {
    unsigned char buf[REPORT_LEN + 1] = {0};
    buf[1] = SET_VALUE;
    buf[2] = SYS_CHANNEL;
    buf[3] = cmd;
    if (arg) memcpy(&buf[4], arg, strlen(arg));
    if (hid_write(dev, buf, sizeof(buf)) < 0) return -1;
    return hid_read_timeout(dev, rep, REPORT_LEN, 1500);
}

int main(int argc, char **argv) {
    if (argc < 2 || (strcmp(argv[1], "version") && strcmp(argv[1], "boot"))) {
        fprintf(stderr, "usage : %s version | boot\n", argv[0]);
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
    if (!strcmp(argv[1], "version")) {
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
