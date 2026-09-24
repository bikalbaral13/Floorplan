"""Step 5 of measure-wall-bands-from-pixels: run-length the band-majority mask along each wall.
Every light run >= 3 px is an interruption — a door leaf gap, a window, or an open boundary."""
import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
gray = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
dark = (gray < 90) & (sat < 60)

def along(orient, f0, f1, lo, hi, name):
    """orient 'v': wall is vertical, faces at x=f0,f1, scanned over y lo..hi."""
    band = dark[lo:hi, f0:f1 + 1] if orient == "v" else dark[f0:f1 + 1, lo:hi]
    axis = 1 if orient == "v" else 0
    # A position is 'wall' where EITHER drawn face line is present there.
    solid = band.any(axis=axis)
    spans, i, n = [], 0, len(solid)
    while i < n:
        if not solid[i]:
            j = i
            while j + 1 < n and not solid[j + 1]:
                j += 1
            if j - i + 1 >= 8:
                spans.append((lo + i, lo + j, j - i + 1))
            i = j + 1
        else:
            i += 1
    print(f"\n{name}  (faces {f0}/{f1}, along {lo}..{hi})")
    if not spans:
        print("   solid — no interruptions")
    for s, e, w in spans:
        print(f"   gap {s:5d}..{e:5d}   {w:4d} px   {w/44.15:6.2f} ft")

# The bedroom's own four walls (33 px) and the exterior wall west of the niche (19 px).
along("v", 959, 992, 294, 901, "WEST wall of room (x 959-992)")
along("v", 1567, 1600, 294, 901, "EAST wall of room (x 1567-1600)")
along("h", 294, 327, 959, 1601, "NORTH wall of room (y 294-327)")
along("h", 867, 900, 959, 1601, "SOUTH wall of room (y 867-900)")
along("v", 826, 845, 245, 950, "EXTERIOR wall west of the niche (x 826-845)")
