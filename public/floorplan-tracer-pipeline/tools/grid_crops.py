"""Gridded zoom crop for reading doors, windows, symbols and furniture edges directly in IMAGE pixels.

    python tools/grid_crops.py <image> <x0> <y0> <x1> <y1> <out.png> [--scale 4] [--step 10]

Nearest-neighbour ×scale crop with a line every `step` image px and the x / y value printed every 5th line,
so an edge reads as "x 650, y 163" off the crop — never convert crop pixels back by hand (that is where
traces lost 5–10 px per object). Crop doors at ≥ 4× before deciding hinge and swing.
"""
import argparse, sys
from PIL import Image, ImageDraw

def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("x0", type=int); ap.add_argument("y0", type=int); ap.add_argument("x1", type=int); ap.add_argument("y1", type=int)
    ap.add_argument("out"); ap.add_argument("--scale", type=int, default=4); ap.add_argument("--step", type=int, default=10)
    a = ap.parse_args()
    im = Image.open(a.image).convert("RGB").crop((a.x0, a.y0, a.x1, a.y1))
    im = im.resize((im.width * a.scale, im.height * a.scale), Image.NEAREST); d = ImageDraw.Draw(im)
    gx = (a.x0 // a.step + 1) * a.step
    while gx < a.x1:
        X = (gx - a.x0) * a.scale; major = gx % (a.step * 5) == 0
        d.line([(X, 0), (X, im.height)], fill=(0, 140, 255) if major else (150, 200, 255), width=1)
        if major: d.text((X + 2, 2), str(gx), fill=(0, 80, 200))
        gx += a.step
    gy = (a.y0 // a.step + 1) * a.step
    while gy < a.y1:
        Y = (gy - a.y0) * a.scale; major = gy % (a.step * 5) == 0
        d.line([(0, Y), (im.width, Y)], fill=(0, 180, 110) if major else (160, 230, 190), width=1)
        if major: d.text((2, Y + 2), str(gy), fill=(0, 120, 60))
        gy += a.step
    im.save(a.out); print(a.out)

if __name__ == "__main__":
    main()
