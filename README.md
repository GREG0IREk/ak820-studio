# AK820 Studio

Réglages de l'Ajazz / Epomaker AK820 Pro dans Chrome ou Edge, sans installer le logiciel Ajazz.

- Éclairage : les 20 effets, couleur ou arc-en-ciel, luminosité, vitesse, direction.
- Couleurs touche par touche, avec un clavier AZERTY ou QWERTY dessiné.
- Écran 128 × 128 : image ou GIF animé, cadrage, zoom, aperçu aux couleurs de l'écran ; horloge mise à l'heure.
- Réaffectation des touches (couche normale et couche Fn), valeurs d'usine.
- Mise en veille, batterie, version du firmware, journal des échanges USB.

## Utilisation

1. Télécharger `dist/ak820-studio.html`.
2. L'ouvrir dans Chrome ou Edge (double-clic sur le fichier).
3. Brancher le clavier en USB, cliquer sur « Connecter ».

L'accès USB (WebHID) n'existe que dans un contexte sécurisé : fichier local, `https://` ou `localhost`. Une adresse `http://` du réseau local ne fonctionne pas. Firefox et Safari ne gèrent pas WebHID.

Sous Linux, autoriser l'accès au clavier une fois :

```
echo 'KERNEL=="hidraw*", ATTRS{idVendor}=="0c45", MODE="0660", TAG+="uaccess"' | sudo tee /etc/udev/rules.d/99-ak820.rules
sudo udevadm control --reload-rules && sudo udevadm trigger
```

`?demo=a` ou `?demo=b` à la fin de l'adresse ouvre un faux clavier pour essayer l'interface.

## Deux familles de firmware

Les AK820 Pro n'ont pas tous le même protocole. L'application le détecte d'après les interfaces USB :

| | Famille A | Famille B |
|---|---|---|
| Interfaces | contrôle `0xFF68`, écran `0xFF67` | contrôle `0xFF13`, écran `0xFF68` |
| Éclairage, couleurs par touche, écran, horloge, veille | oui | oui |
| Réaffectation des touches | oui | écriture seule (commandes 0x11 et 0x27, relevées dans le pilote Windows 1.0.0.5), sauf « < > » |
| Envoi | immédiat | à la demande (chaque envoi s'écrit en flash) |

Sur la famille B, la correspondance des LED par touche n'est connue que pour la disposition ANSI.

## Micrologiciel QMK « Cadran »

Pour remplacer le micrologiciel Ajazz par QMK avec une nouvelle interface d'écran (heure, menu à la molette pour l'éclairage) : [firmware/README.md](firmware/README.md). AK820 Studio ne fonctionne plus une fois QMK installé.

## Développement

```
python3 build.py              # assemble dist/ak820-studio.html
python3 -m http.server 8820   # index.html charge les sources de src/ directement
node --test test/protocol.test.mjs
```

- `src/protocol.js` : trames, encodages, transactions des deux familles (sans DOM, testé sous Node).
- `src/app.js` : interface. `src/image.js` : décodage et cadrage des images. `src/mock.js` : faux claviers.

## Origine du protocole

Le protocole est repris de [wsclx/ak820pro-modder](https://github.com/wsclx/ak820pro-modder) (MIT), qui l'a rétro-conçu à partir du pilote web officiel d'Ajazz et des travaux de [gohv](https://github.com/gohv/EPOMAKER-Ajazz-AK820-Pro), adamauthor et vespovios. Matériel identifié par [fpb/ajazz-ak820-pro](https://github.com/fpb/ajazz-ak820-pro).

Logiciel non officiel, sans garantie. Il écrit dans la mémoire du clavier ; aucun cas de clavier bloqué n'est connu à ce jour.
