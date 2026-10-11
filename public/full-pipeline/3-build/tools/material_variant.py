"""Recolour a library material to a deck swatch: keeps the base's texture recipe and surface block,
moves its colour pair so their mean lands on the swatch (keeping the base's light/dark spread),
and records provenance. Writes materials/<name>.json for upload to library/Materials/<Category>/.

    python tools/material_variant.py <base.json> <#RRGGBB> <name> "<title>" "<why>"
"""
import copy, json, sys
from pathlib import Path


def rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def hexs(c):
    return "#" + "".join(f"{max(0, min(255, round(v))):02x}" for v in c)


def main(base_path, swatch, name, title, why):
    base = json.loads(Path(base_path).read_text(encoding="utf-8"))
    out = copy.deepcopy(base)
    target = rgb(swatch)
    proc = out.get("procedural", {}).get("params", {})
    if "colorA" in proc and "colorB" in proc:
        a, b = rgb(proc["colorA"]), rgb(proc["colorB"])
        mean = [(x + y) / 2 for x, y in zip(a, b)]
        proc["colorA"] = hexs([t + (x - m) for t, x, m in zip(target, a, mean)])
        proc["colorB"] = hexs([t + (y - m) for t, y, m in zip(target, b, mean)])
    out["pbr"]["baseColor"] = swatch.upper()
    if "plan2d" in out:
        out["plan2d"]["color"] = swatch.upper()
    out["id"] = f"{base['id']}.{name.split('-')[-1].lower()}"
    out["title"] = title
    out["description"] = f"{why} Recoloured from {base['id']} to the deck swatch {swatch.upper()}; texture recipe and surface block unchanged."
    out["variantOf"] = {"id": base["id"], "swatch": swatch.upper()}
    dst = Path(__file__).resolve().parent.parent / "materials" / f"{name}.json"
    dst.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(f"{out['id']} -> {dst.name}")


if __name__ == "__main__":
    main(*sys.argv[1:6])
