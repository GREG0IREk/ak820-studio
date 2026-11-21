"""Prépare les sources graphiques des interfaces de l'écran.

- icônes du menu (tracés SVG 24x24) rendues en PNG blanc sur noir, en 26, 18 et 12 px ;
- instances fixes des polices variables : Space Grotesk (Cadran) et Inter (Tuiles).
  VT323 (Terminal) n'est pas variable et sert telle quelle.

Usage : python make_sources.py <SpaceGrotesk[wght].ttf> <Inter[opsz,wght].ttf> <dossier_sortie>
Lancé par generate.sh dans un conteneur jetable (cairosvg + fonttools).
"""
import sys
from pathlib import Path

import cairosvg
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Mêmes tracés que les maquettes (stroke 2, extrémités rondes).
ICONS = {
    'effet': 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
    'lumiere': 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
    'vitesse': 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
    'couleur': 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z',
    'veille': 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    'ecran': 'M4 4h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zM8 20h8M12 16v4',
}
SIZES = (26, 18, 12)


def main(grotesk: str, inter: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for name, d in ICONS.items():
        for size in SIZES:
            # Trait un peu plus épais en 12 px pour rester lisible.
            stroke = 2.4 if size == 12 else 2
            svg = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24">'
                '<rect width="24" height="24" fill="#000"/>'
                f'<path d="{d}" fill="none" stroke="#fff" stroke-width="{stroke}" '
                'stroke-linecap="round" stroke-linejoin="round"/></svg>'
            )
            cairosvg.svg2png(bytestring=svg.encode(), write_to=str(out / f'ic_{name}_{size}.png'))

    for weight, label in ((600, 'semibold'), (400, 'regular')):
        inst = instancer.instantiateVariableFont(TTFont(grotesk), {'wght': weight})
        inst.save(str(out / f'spacegrotesk_{label}.ttf'))

    # Inter : taille optique 32 pour les grands chiffres, 14 pour le reste.
    for weight, opsz in ((800, 32), (800, 14), (700, 14), (400, 14)):
        inst = instancer.instantiateVariableFont(TTFont(inter), {'wght': weight, 'opsz': opsz})
        inst.save(str(out / f'inter_{weight}_{opsz}.ttf'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3])
