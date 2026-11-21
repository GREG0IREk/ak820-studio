"""Aperçus des interfaces pour le site : src/ecrans.js.

Lit l'accueil de chaque interface produit par le simulateur
(firmware/sim/out/<interface>/accueil.png, agrandi 3 fois), le ramène à
128 x 128 et l'écrit en PNG compressé, en data: URI.

    sh firmware/sim/run.sh && python3 firmware/sim/previews.py
Bibliothèque standard seulement.
"""
import base64
import pathlib
import struct
import zlib

ROOT = pathlib.Path(__file__).resolve().parents[2]
OUT = ROOT / 'firmware' / 'sim' / 'out'
THEMES = ('cadran', 'terminal', 'tuiles')
SCALE = 3


def read_png(path: pathlib.Path):
    """PNG RGB 8 bits sans filtre, comme les écrit le simulateur."""
    data = path.read_bytes()
    pos, idat = 8, b''
    while pos < len(data):
        n, kind = struct.unpack('>I4s', data[pos:pos + 8])
        body = data[pos + 8:pos + 8 + n]
        if kind == b'IHDR':
            w, h, depth, ctype = struct.unpack('>IIBB', body[:10])
            assert depth == 8 and ctype == 2, path
        elif kind == b'IDAT':
            idat += body
        pos += 12 + n
    raw = zlib.decompress(idat)
    stride = w * 3
    rows = []
    for y in range(h):
        line = raw[y * (stride + 1):(y + 1) * (stride + 1)]
        assert line[0] == 0, 'filtre PNG inattendu'
        rows.append(line[1:])
    return w, h, rows


def write_png(w: int, h: int, rows) -> bytes:
    def chunk(kind, body):
        return struct.pack('>I', len(body)) + kind + body + struct.pack('>I', zlib.crc32(kind + body))
    raw = b''.join(b'\0' + bytes(r) for r in rows)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


def main() -> None:
    lines = ["// Aperçus des interfaces de l'écran, générés par firmware/sim/previews.py.",
             'export const SCREEN_PREVIEWS = {']
    for name in THEMES:
        w, h, rows = read_png(OUT / name / 'accueil.png')
        small = [bytes(r[x * SCALE * 3:x * SCALE * 3 + 3][i] for x in range(w // SCALE) for i in range(3))
                 for r in rows[::SCALE]]
        png = write_png(w // SCALE, h // SCALE, small)
        lines.append(f"  {name}: 'data:image/png;base64,{base64.b64encode(png).decode()}',")
        print(f'{name} : {len(png)} octets')
    lines.append('};')
    (ROOT / 'src' / 'ecrans.js').write_text('\n'.join(lines) + '\n', encoding='utf-8')


if __name__ == '__main__':
    main()
