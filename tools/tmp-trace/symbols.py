"""Openings here are SYMBOLS over a continuous wall: red glazing lines for windows, cyan leaf+arc for
doors. Find them by scanning a band that reaches a little way into the room, not just the wall."""
import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
R, G, B = a[..., 0], a[..., 1], a[..., 2]
red = (R > 150) & (G < 110) & (B < 110)
cyan = (B > 120) & (G > 110) & (R < 130)
PPF = 44.152
IN = {"x0": 992.5, "x1": 1567.5, "y0": 327.5, "y1": 867.5}

def spans(hit, lo, minw=10):
    out, i, n = [], 0, len(hit)
    while i < n:
        if hit[i]:
            j = i
            while j + 1 < n and hit[j + 1]:
                j += 1
            if j - i + 1 >= minw:
                out.append((lo + i, lo + j))
            i = j + 1
        else:
            i += 1
    return out

def wall(name, orient, w0, w1, reach, lo, hi, ref, refname):
    """reach: how far INTO the room to look for the swing symbol."""
    if orient == "v":
        s0, s1 = (w0 - reach, w1) if reach < 0 else (w0, w1 + reach)
        s0, s1 = min(s0, s1), max(s0, s1)
        sub_c, sub_r = cyan[lo:hi, s0:s1], red[lo:hi, s0:s1]
        ax = 1
    else:
        s0, s1 = min(w0 - reach, w1), max(w0, w1 + reach)
        sub_c, sub_r = cyan[s0:s1, lo:hi], red[s0:s1, lo:hi]
        ax = 0
    print(f"\n{name}")
    for label, sub in (("door (cyan)", sub_c), ("window (red)", sub_r)):
        for s, e in spans(sub.any(axis=ax), lo):
            w = e - s + 1
            print(f"   {label:13s} {s:5d}..{e:5d}  {w:4d} px  {w/PPF:5.2f} ft   "
                  f"{(s-ref)/PPF:5.2f}..{(e-ref)/PPF:5.2f} ft from {refname}")

wall("WEST wall  x 959-992", "v", 959, 992, 40, 294, 901, IN["y0"], "N inner face")
wall("EAST wall  x 1567-1600", "v", 1567, 1600, -40, 294, 901, IN["y0"], "N inner face")
wall("NORTH wall y 294-327", "h", 294, 327, 40, 959, 1601, IN["x0"], "W inner face")
wall("SOUTH wall y 867-900", "h", 867, 900, -40, 959, 1601, IN["x0"], "W inner face")
