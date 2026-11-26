# Ajazz AJ139 V2 MC : protocole HID

Établi le 26/11/2026 par analyse du logiciel Ajazz « AJ139 V2 MC Gaming Mouse 1.2.9 » (`DeviceDriver.exe`) et vérifié sur la souris.

## Périphérique

| | |
|---|---|
| Récepteur 2,4 GHz | `A8A5:2255`, « AJAZZ 2.4G », fabricant « YJX-CHIP » |
| Câble | `A8A4:2255` |
| Interface de réglage | n° 2, page `0xFF01`, usage `0x10` |
| Rapports | n° 0, 64 octets dans chaque sens |
| Firmware relevé | `YJX.co.mouse` 2712 v20, souris du 12/11/2025, récepteur du 20/02/2024 |

## Trame

```
requête  55 cmd drapeau somme long 00 00 profil données (octets 8 à 63)
réponse  AA cmd ...  (même disposition)
somme  = (octets 4 à 63 additionnés) & 0xFF
```

## Commandes

| cmd | drapeau | long | rôle |
|---|---|---|---|
| 03 | 00 | 00 | identité du firmware (ASCII à partir de l'octet 8) |
| 30 | A5 | 2E | batterie : octet 8 = %, octet 9 = en charge |
| 0E | A5 | 30 | lecture des réglages |
| 0F | AE | 30 | écriture des réglages (même disposition que 0E) |
| 08 | A5 | 20 | lecture des 9 boutons |
| 09 | A5 | 20 | écriture des 9 boutons |
| 21 | A5 | 03 | mode d'éclairage immédiat (octet 10) ; sans elle, le mode écrit par 0F ne s'applique pas tout de suite |
| 22 | AE | 03 | palier DPI immédiat : octet 10 = palier + 1, 11-12 = DPI |
| 23 | AE | 03 | taux de rapport immédiat (octet 10) |
| 0D, 10 | | | macros (blocs de 56 octets, non utilisé ici) |

## Réglages (0E / 0F)

| octet | contenu |
|---|---|
| 9 | mode d'éclairage : 0 vague, 1 néon, 2 flash cyclique, 3 balle yoyo, 4 flash simple, 5 respiration, 6 éteint |
| 10 | taux de rapport : 0 = 125, 1 = 250, 2 = 500, 3 = 1000, 4 = 2000, 5 = 4000, 6 = 8000 Hz |
| 11 | nombre de paliers DPI (6) |
| 12 | palier actif + 1 |
| 13-24 | 6 valeurs DPI, 16 bits petit-boutiste, 50 à 26000 |
| 25-42 | couleur du témoin par palier (R, V, B) ; 000000 = couleur d'origine |
| 48 | molette inversée (0/1) |
| 49 | LOD : 1 = 1 mm, 2 = 2 mm, FF = jamais réglé |
| 50 | capteur : bit 0 correction d'angle, bit 4 lissage (ripple), bit 5 Motion Sync |
| 51 | anti-rebond en ms (0 à 20) |
| 52 | veille : 0 = 1, 1 = 3, 2 = 5, 3 = 10, 4 = 20, 5 = 30, 6 = 60 min |
| 53 | mode e-sport (0/1, FF = jamais réglé) |
| 54 | batterie (rempli par la souris) |
| 55 | réveil au mouvement (0/1) ; le logiciel Ajazz l'écrit en 54 |

## Boutons (08 / 09)

Emplacements de 4 octets à partir de l'octet 8 : clic gauche, droit, molette, arrière, avant, bouton DPI, molette haut, molette bas, libre.

| code | fonction |
|---|---|
| `20 01 00 00` … `20 10 00 00` | clic gauche, droit (02), molette (04), arrière (08), avant (10) |
| `20 01 02 00` | double-clic |
| `21 38 01 00` / `21 38 FF 00` | molette haut / bas |
| `21 55 00 00` | palier DPI suivant |
| `21 AA 00 00` | changer l'éclairage |
| `F0 01 0x 00` | DPI + (1), − (2), en boucle (3) |
| `F0 02 0x 00` | taux de rapport +, −, en boucle |
| `30 lo hi 00` | touche multimédia (usage HID Consumer) |
| `10 mod touche 00` | touche clavier (modificateurs HID : 1 Ctrl, 2 Maj, 4 Alt, 8 Win) |
| `70 n …` | macro n |

Outil de sonde Windows : `outils/souris.c`, compilé par `outils/build.sh` (`souris list`, `souris n <octets>`).
