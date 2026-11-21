#!/usr/bin/env python3
"""Assemble index.html + src/*.js + src/style.css en un seul fichier : dist/ak820-studio.html.

Un fichier unique s'ouvre en file:// (contexte sécurisé, donc WebHID disponible) ;
les modules ES externes y seraient bloqués. Mini-assembleur : chaque module est
enveloppé dans une fonction, ses exports rangés dans un objet, ses imports lus dans
les objets des modules déjà chargés.
"""
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
ORDER = ["qmk", "protocol", "layouts", "keycodes", "image", "mock", "ecrans", "app"]

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'\./(\w+)\.js';\s*$", re.M)
EXPORT_RE = re.compile(r"^export\s+(?:async\s+)?(const|let|function|class)\s+(\w+)", re.M)


def bundle() -> str:
    out = []
    for name in ORDER:
        src = (ROOT / "src" / f"{name}.js").read_text(encoding="utf-8")
        imports = IMPORT_RE.findall(src)
        src = IMPORT_RE.sub("", src)
        if re.search(r"^import ", src, re.M):
            raise SystemExit(f"{name}.js : import non géré")
        names = [n for _, n in EXPORT_RE.findall(src)]
        src = re.sub(r"^export\s+", "", src, flags=re.M)
        head = "".join(
            f"const {{ {' '.join(i.split())} }} = __mod.{mod};\n" for i, mod in imports
        )
        out.append(
            f"// ---- {name}.js\n__mod.{name} = (() => {{\n{head}{src}\nreturn {{ {', '.join(names)} }};\n}})();\n"
        )
    return "const __mod = {};\n" + "\n".join(out)


def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "src" / "style.css").read_text(encoding="utf-8")
    js = bundle().replace("</script", "<\\/script")
    link = '<link rel="stylesheet" href="src/style.css">'
    script = '<script type="module" src="src/app.js"></script>'
    assert link in html and script in html
    html = html.replace(link, f"<style>\n{css}</style>")
    html = html.replace(script, f"<script type=\"module\">\n{js}</script>")
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    target = dist / "ak820-studio.html"
    target.write_text(html, encoding="utf-8")
    print(f"{target} ({target.stat().st_size // 1024} Ko)")


if __name__ == "__main__":
    main()
