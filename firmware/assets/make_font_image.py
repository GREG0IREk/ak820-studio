"""Image de police au format attendu par « qmk painter-convert-font-image ».

Même algorithme que « qmk painter-make-font-image » (lib/python/qmk/painter_qff.py),
avec une correction : QMK dessine chaque caractère dans une zone haute de
ascent + descent, alors que le haut de la zone est calé sur le caractère le plus
haut (É, Î…). Le bas des jambages (g, p, q, y) sort alors de la zone et
disparaît. Ici la zone est assez haute pour tous les caractères.

Usage : python make_font_image.py <police.ttf> <taille> <ascii|noascii> <caractères> <sortie.png> [--check]
--check : affiche seulement si QMK couperait des caractères avec cette police.
"""
import sys

from PIL import Image, ImageDraw, ImageFont


def glyph_list(ascii_glyphs: bool, extra: str) -> list:
    # Même liste et même ordre (tri par code) que _generate_font_glyphs_list de QMK :
    # le convertisseur attend les caractères dans cet ordre.
    glyphs = {chr(c) for c in range(0x20, 0x7F)} if ascii_glyphs else set()
    glyphs.update(extra)
    return sorted(glyphs)


def main() -> None:
    ttf, size, mode, extra, out = sys.argv[1:6]
    check = '--check' in sys.argv[6:]
    font = ImageFont.truetype(ttf, int(size))
    glyphs = glyph_list(mode == 'ascii', extra)

    qmk_height = font.font.ascent + abs(font.font.descent)
    top = min(font.getbbox(g, anchor='ls')[1] for g in glyphs)
    bottom = max(font.getbbox(g, anchor='ls')[3] for g in glyphs)
    height = max(qmk_height, bottom - top)
    if check:
        cut = [g for g in glyphs if font.getbbox(g, anchor='ls')[3] - top > qmk_height]
        print(f'{ttf} {size} : zone QMK {qmk_height}, nécessaire {bottom - top}, coupés : {"".join(cut) or "aucun"}')
        return

    widths = [font.getbbox(g, anchor='ls')[2] for g in glyphs]
    img = Image.new('RGB', (sum(widths) + 1, height + 1), (0, 0, 0))
    px = img.load()
    x = 0
    for g, w in zip(glyphs, widths):
        l, t, _, _ = font.getbbox(g, anchor='ls')
        cell = Image.new('RGB', (w, height), (0, 0, 0))
        ImageDraw.Draw(cell).text((-l, t - top), g, font=font, anchor='lt')
        img.paste(cell, (x, 1))
        px[x, 0] = (255, 0, 255)
        x += w
    px[x, 0] = (255, 0, 255)

    # Comme QMK : on rogne les lignes vides en haut et en bas (les marqueurs restent en ligne 0).
    rows = [y for y in range(1, height + 1) if any(px[i, y] != (0, 0, 0) for i in range(x))]
    bottom_row = max(rows) if rows else 1
    img.crop((0, 0, x, bottom_row + 1)).save(out)


if __name__ == '__main__':
    main()
