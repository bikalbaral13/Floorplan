import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
# Pure red only: the bed's outline is orange (R~190 G~100 B~40) and was passing a looser test.
red = (R > 200) & (G < 80) & (B < 80)
cyan = (B > 150) & (G > 150) & (R < 120)
PPF = 44.152
X0, X1, Y0, Y1 = 992.5, 1567.5, 327.5, 867.5   # room inner faces

def spans(hit, lo, minw=10):
    out, i, n = [], 0, len(hit)
    while i < n:
        if hit[i]:
            j = i
            while j + 1 < n and hit[j + 1]: j += 1
            if j - i + 1 >= minw: out.append((lo + i, lo + j))
            i = j + 1
        else: i += 1
    return out

# Explicit rectangles: the wall band plus 45 px INTO the room, where the swing symbol lives.
WALLS = [
    ("WEST  x 959-992",  (959, 1037, 294, 901),  "v", Y0, "N inner face"),
    ("EAST  x 1567-1600",(1522, 1601, 294, 901), "v", Y0, "N inner face"),
    ("NORTH y 294-327",  (959, 1601, 294, 372),  "h", X0, "W inner face"),
    ("SOUTH y 867-900",  (959, 1601, 822, 901),  "h", X0, "W inner face"),
]
for name, (xa, xb, ya, yb), orient, ref, refname in WALLS:
    print(f"\n{name}")
    found = False
    for label, m in (("door  (cyan)", cyan), ("window (red)", red)):
        sub = m[ya:yb, xa:xb]
        hit = sub.any(axis=1) if orient == "v" else sub.any(axis=0)
        lo = ya if orient == "v" else xa
        for s, e in spans(hit, lo):
            w = e - s + 1
            print(f"   {label} {s:5d}..{e:5d}  {w:4d} px  {w/PPF:5.2f} ft   "
                  f"{(s-ref)/PPF:5.2f}..{(e-ref)/PPF:5.2f} ft from {refname}")
            found = True
    if not found: print("   nothing")
