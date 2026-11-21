"""Prépare les sources graphiques de l'interface « Cadran ».

- icônes du menu (tracés SVG 24x24) rendues en PNG blanc sur noir, en 26 et 18 px ;
- instances fixes SemiBold (600) et Regular (400) de la police variable Space Grotesk.

Usage : python make_sources.py <SpaceGrotesk[wght].ttf> <dossier_sortie>
Lancé par generate.sh dans un conteneur jetable (cairosvg + fonttools).
"""
import sys
from pathlib import Path

import cairosvg
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

# Mêmes tracés que la maquette (stroke 2, extrémités rondes).
ICONS = {
    'effet': 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18',
    'lumiere': 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4',
    'vitesse': 'M4 16a8 8 0 1 1 16 0M12 16l4-5',
    'couleur': 'M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z',
    'veille': 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    'retour': 'M10 6l-6 6l6 6M4 12h16',
}
SIZES = (26, 18)


def main(font_path: str, out_dir: str) -> None:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    for name, d in ICONS.items():
        for size in SIZES:
            svg = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24">'
                '<rect width="24" height="24" fill="#000"/>'
                f'<path d="{d}" fill="none" stroke="#fff" stroke-width="2" '
                'stroke-linecap="round" stroke-linejoin="round"/></svg>'
            )
            cairosvg.svg2png(bytestring=svg.encode(), write_to=str(out / f'ic_{name}_{size}.png'))

    for weight, label in ((600, 'semibold'), (400, 'regular')):
        font = TTFont(font_path)
        inst = instancer.instantiateVariableFont(font, {'wght': weight})
        inst.save(str(out / f'spacegrotesk_{label}.ttf'))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
