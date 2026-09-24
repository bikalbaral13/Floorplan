"""Openings on this sheet are drawn as COLOURED lines laid over a continuous black wall, so the
run-length pass over the black mask reports the wall solid. Scan the wall band for colour instead."""
import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
red = (R > 150) & (G < 110) & (B < 110)
cyan = (B > 120) & (G > 110) & (R < 130)
PPF = 44.15

def band(mask, orient, f0, f1, lo, hi, name):
    sub = mask[lo:hi, f0:f1 + 1] if orient == "v" else mask[f0:f1 + 1, lo:hi]
    hit = sub.any(axis=1 if orient == "v" else 0)
    spans, i, n = [], 0, len(hit)
    while i < n:
        if hit[i]:
            j = i
            while j + 1 < n and hit[j + 1]:
                j += 1
            if j - i + 1 >= 12:
                spans.append((lo + i, lo + j, j - i + 1))
            i = j + 1
        else:
            i += 1
    for s, e, w in spans:
        print(f"   {name:6s} {s:5d}..{e:5d}  {w:4d} px  {w/PPF:5.2f} ft")
    if not spans:
        print(f"   {name:6s} none")

WALLS = [
    ("v", 959, 992, 294, 901, "WEST wall  x 959-992"),
    ("v", 1567, 1600, 294, 901, "EAST wall  x 1567-1600"),
    ("h", 294, 327, 959, 1601, "NORTH wall y 294-327"),
    ("h", 867, 900, 959, 1601, "SOUTH wall y 867-900"),
]
for orient, f0, f1, lo, hi, name in WALLS:
    print(f"\n{name}")
    band(red, orient, f0, f1, lo, hi, "red")
    band(cyan, orient, f0, f1, lo, hi, "cyan")

print("\n— reference: room inner faces  x 992.5..1567.5   y 327.5..867.5")
for lbl, v in [("window start from N", 640), ("window end from N", 865), ("door start from N", 416), ("door end from N", 523)]:
    print(f"   {lbl:22s} {(v-327.5)/PPF:5.2f} ft")
