"""Step 2a of measure-wall-bands-from-pixels: sample the wall colour BEFORE choosing a threshold."""
import numpy as np
from PIL import Image
IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
H, W, _ = a.shape
gray = a.mean(axis=2)
sat = a.max(axis=2) - a.min(axis=2)
print(f"image {W}x{H}")

# The title block is the right-hand column of the sheet; mask it or its rules become wall bands.
# Find it: the long vertical near-black rule that separates drawing from title block.
col_dark = (gray < 100).sum(axis=0)
cands = [(x, int(c)) for x, c in enumerate(col_dark) if c > H * 0.5]
print("full-height vertical rules at x:", [x for x, _ in cands][:20])

# Histogram of dark-ish pixels in the DRAWING half only
draw = gray[:, : int(W * 0.60)]
for lo, hi in [(0, 40), (40, 70), (70, 90), (90, 110), (110, 140), (140, 180)]:
    n = int(((draw >= lo) & (draw < hi)).sum())
    print(f"  gray {lo:3d}-{hi:3d}: {n:8d} px  ({100*n/draw.size:5.2f}%)")

# A horizontal slice across the master bedroom's left wall region (top-left of the sheet)
for y in (400, 520, 700):
    row = gray[y, 780:1000]
    runs = "".join("#" if v < 100 else "." for v in row)
    print(f"y={y}: {runs}")
