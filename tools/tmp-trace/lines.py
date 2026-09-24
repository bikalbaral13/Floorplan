"""Find the long straight black lines of a hollow-wall CAD plan, then pair them into walls.

measure-wall-bands-from-pixels assumes a FILLED band (solid or fill-plus-edges). This sheet is an
AutoCAD line drawing: each wall is two thin ~2 px lines with white between them. So the band pass is
replaced by a line pass — but step 4's arithmetic is unchanged, because those two lines ARE the two
faces the skill asks for: centreline = (face0+face1)/2, thickness = face1-face0.
"""
import json
import numpy as np
from PIL import Image

IMG = "C:/Users/bikal/AppData/Local/Temp/claude/D--MAIN-monica-recent/f49cee9d-947a-4df6-8b3c-57a6cdbddf05/scratchpad/fp/floorplan_with_bedroom.png"
a = np.asarray(Image.open(IMG).convert("RGB")).astype(np.int16)
H, W, _ = a.shape
gray = a.mean(axis=2)
sat = a.max(axis=2) - a.min(axis=2)
# Near-black linework only: the plan's walls are black, while dimensions are red/blue and the
# furniture is orange/tan. Keeping the saturation term stops a coloured line reading as a wall.
dark = (gray < 90) & (sat < 60)

# ── The title block: the sheet's right-hand column. Find its left edge as the rightmost full-height
#    rule, then drop everything right of it so its ruling never registers as a wall.
colfull = np.where(dark.sum(axis=0) > H * 0.55)[0]
tb = int(colfull.max()) if len(colfull) else W
# The drawing's own left exterior wall is also full height, so take the RIGHTMOST cluster.
print("full-height rules at x:", colfull.tolist())

def runs(mask, min_len):
    """Contiguous True runs of at least min_len, as (start, end_inclusive)."""
    out, i, n = [], 0, len(mask)
    while i < n:
        if mask[i]:
            j = i
            while j + 1 < n and mask[j + 1]:
                j += 1
            if j - i + 1 >= min_len:
                out.append((i, j))
            i = j + 1
        else:
            i += 1
    return out

MINLEN = 60            # a wall face shorter than ~1 ft at this scale is a symbol, not a wall
def find_lines(axis):
    """axis=0 -> vertical lines (constant x); axis=1 -> horizontal lines (constant y)."""
    res = []
    n = W if axis == 0 else H
    for k in range(n):
        line = dark[:, k] if axis == 0 else dark[k, :]
        for s, e in runs(line, MINLEN):
            res.append({"k": k, "s": int(s), "e": int(e), "len": int(e - s + 1)})
    return res

vert = [l for l in find_lines(0) if l["k"] < tb]
horz = [l for l in find_lines(1)]
print(f"raw vertical line pixels: {len(vert)}   horizontal: {len(horz)}")

def merge(lines, tol=2):
    """Collapse the 2-3 px thickness of one drawn line into a single entry."""
    lines = sorted(lines, key=lambda l: (l["k"], l["s"]))
    out = []
    for l in lines:
        hit = None
        for m in out:
            if abs(m["k1"] - l["k"]) <= tol and not (l["e"] < m["s"] - 8 or l["s"] > m["e"] + 8):
                hit = m
                break
        if hit:
            hit["k1"] = l["k"]; hit["k0"] = min(hit["k0"], l["k"])
            hit["s"] = min(hit["s"], l["s"]); hit["e"] = max(hit["e"], l["e"])
        else:
            out.append({"k0": l["k"], "k1": l["k"], "s": l["s"], "e": l["e"]})
    for m in out:
        m["k"] = (m["k0"] + m["k1"]) / 2
        m["len"] = m["e"] - m["s"] + 1
    return out

V = sorted(merge(vert), key=lambda m: m["k"])
Hz = sorted(merge(horz), key=lambda m: m["k"])
print(f"merged vertical lines: {len(V)}   horizontal: {len(Hz)}")
print("title block left edge x =", tb)

json.dump({"W": W, "H": H, "tb": tb, "V": V, "H": Hz}, open("tools/tmp-trace/lines.json", "w"), indent=1)
print("\nlongest vertical lines (x, y0..y1, len):")
for m in sorted(V, key=lambda m: -m["len"])[:14]:
    print(f"   x={m['k']:7.1f}  y {m['s']:5d}..{m['e']:5d}  len {m['len']:5d}")
print("\nlongest horizontal lines (y, x0..x1, len):")
for m in sorted(Hz, key=lambda m: -m["len"])[:14]:
    print(f"   y={m['k']:7.1f}  x {m['s']:5d}..{m['e']:5d}  len {m['len']:5d}")
