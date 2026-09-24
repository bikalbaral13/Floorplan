"""Run-length the black linework along a row or column — the 'single-pixel profile' fallback in
measure-wall-bands-from-pixels step 5, used here as the primary read because the walls are hollow."""
import sys
import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
gray = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
dark = (gray < 90) & (sat < 60)

mode, k, lo, hi = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])
line = dark[k, lo:hi] if mode == "row" else dark[lo:hi, k]
spans, i = [], 0
while i < len(line):
    if line[i]:
        j = i
        while j + 1 < len(line) and line[j + 1]:
            j += 1
        spans.append((lo + i, lo + j, j - i + 1))
        i = j + 1
    else:
        i += 1
label = "x" if mode == "row" else "y"
print(f"{mode} {k}: dark spans in {label} {lo}..{hi}")
prev = None
for s, e, n in spans:
    gap = f"   gap {s - prev - 1:4d}" if prev is not None else ""
    print(f"   {label} {s:5d}..{e:5d}  w {n:3d}{gap}")
    prev = e
