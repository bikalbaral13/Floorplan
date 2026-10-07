"""Measure wall bands, their interruptions (openings) and dark column blocks on a rendered plan, in image pixels.
The Floorplan Tracer skill's measurement step (measure-wall-bands-from-pixels + multi/rects.py + auto.py) as a tool.

    python tools/wallbands.py <image> <out.json> [--profile] [--dark 105] [--sat 70] [--min-run 32]
                              [--mask x0,y0,x1,y1 ...] [--column-dark 55]

  --profile   print gray profiles across the image centre first: SAMPLE THE WALL COLOUR BEFORE CHOOSING
              A THRESHOLD (black-line plans: walls gray < 70–80; brochure plans: brown fill ≈ 78 between
              2 px black edges → use --dark 105 or the band splits into two edge lines)
Output JSON: {image, size, params, lines: [{o, c, t, pieces: [[s, e]], faces: [f0, f1]}],
              gaps: [{o, c, t, s, e, width_px}], columns: [{x0, y0, x1, y1}]}
plus <out>.png: bands magenta, gaps green, columns violet, on a 2× copy — check it before trusting a number.
Anything the mask cannot see (a wall under a dark render element) must be measured from neighbours and
flagged in the reading.
"""
import argparse, json, sys
import numpy as np
from PIL import Image, ImageDraw

def runs(row, L):
    d = np.diff(np.concatenate([[0], row.astype(np.int8), [0]])); s = np.where(d == 1)[0]; e = np.where(d == -1)[0]
    return [(int(a), int(b)) for a, b in zip(s, e) if b - a >= L]

def bands(M, L, min_rows=3):
    """Horizontal bands: runs ≥ L px on consecutive rows that overlap → (x0, x1, y0, y1)."""
    open_, done = [], []
    for y in range(M.shape[0]):
        cur = runs(M[y], L); nxt = []
        for x0, x1 in cur:
            hit = None
            for o in open_:
                if o["last"] == y - 1 and min(x1, o["x1"]) - max(x0, o["x0"]) > 0.8 * min(x1 - x0, o["x1"] - o["x0"]) and abs(x0 - o["x0"]) < 12 and abs(x1 - o["x1"]) < 12:
                    hit = o; break
            if hit: hit["last"] = y; hit["ys"].append((x0, x1)); nxt.append(hit)
            else: nxt.append({"y0": y, "last": y, "x0": x0, "x1": x1, "ys": [(x0, x1)]})
        done += [o for o in open_ if o not in nxt]; open_ = nxt
    done += open_
    out = []
    for o in done:
        if o["last"] - o["y0"] + 1 < min_rows: continue
        out.append((int(np.median([p[0] for p in o["ys"]])), int(np.median([p[1] for p in o["ys"]])), o["y0"], o["last"] + 1))
    return out

def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("image"); ap.add_argument("out")
    ap.add_argument("--dark", type=int, default=80); ap.add_argument("--sat", type=int, default=70); ap.add_argument("--min-run", type=int, default=32)
    ap.add_argument("--column-dark", type=int, default=55); ap.add_argument("--mask", nargs="*", default=[]); ap.add_argument("--profile", action="store_true")
    ap.add_argument("--merge", type=float, default=8.0, help="px: collinear bands closer than this are one line")
    a = ap.parse_args()
    im = Image.open(a.image).convert("RGB"); A = np.asarray(im).astype(int); H, W = A.shape[:2]
    gray = A.mean(axis=2); sat = A.max(axis=2) - A.min(axis=2)
    if a.profile:
        for name, prof in (("row H/2", gray[H // 2]), ("col W/2", gray[:, W // 2])):
            print(name, " ".join(str(int(v)) for v in prof[::max(1, len(prof) // 120)]))
    m = (gray < a.dark) & (sat < a.sat)
    for box in a.mask:
        x0, y0, x1, y1 = map(int, box.split(",")); m[y0:y1, x0:x1] = False
    Hb = bands(m, a.min_run); Vb = [(y0, y1, x0, x1) for (y0, y1, x0, x1) in bands(m.T, a.min_run)]
    raw = [("H", (y0 + y1) / 2, y1 - y0, x0, x1) for x0, x1, y0, y1 in Hb] + [("V", (x0 + x1) / 2, x1 - x0, y0, y1) for y0, y1, x0, x1 in Vb]
    lines = []
    for o, c, t, s, e in raw:
        for L in lines:
            if L["o"] == o and abs(L["c"] - c) <= a.merge:
                L["pieces"].append([s, e]); L["ts"].append(t); break
        else: lines.append({"o": o, "c": c, "ts": [t], "pieces": [[s, e]]})
    gaps = []
    for L in lines:
        L["pieces"].sort(); merged = []
        for s, e in L["pieces"]:
            if merged and s <= merged[-1][1] + 3: merged[-1][1] = max(merged[-1][1], e)
            else: merged.append([s, e])
        L["pieces"] = merged; L["t"] = int(np.median(L["ts"])); L["c"] = round(float(np.median([L["c"]])), 1)
        L["faces"] = [round(L["c"] - L["t"] / 2, 1), round(L["c"] + L["t"] / 2, 1)]; del L["ts"]
        for (s0, e0), (s1, e1) in zip(merged, merged[1:]):
            if 3 <= s1 - e0 <= 600: gaps.append({"o": L["o"], "c": L["c"], "t": L["t"], "s": e0, "e": s1, "width_px": s1 - e0})
    from scipy import ndimage
    cm = ndimage.binary_opening((gray < a.column_dark), structure=np.ones((5, 5)))
    for box in a.mask:
        x0, y0, x1, y1 = map(int, box.split(",")); cm[y0:y1, x0:x1] = False
    lab, n = ndimage.label(cm); cols = []
    for sl in ndimage.find_objects(lab):
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if 6 <= x1 - x0 <= 200 and 6 <= y1 - y0 <= 200: cols.append({"x0": x0, "y0": y0, "x1": x1, "y1": y1})
    out = {"image": a.image, "size": [W, H], "params": vars(a), "lines": sorted(lines, key=lambda L: (L["o"], L["c"])), "gaps": gaps, "columns": cols}
    json.dump(out, open(a.out, "w"), indent=0)
    big = im.resize((W * 2, H * 2)); d = ImageDraw.Draw(big)
    for L in lines:
        for s, e in L["pieces"]:
            seg = [(s * 2, L["c"] * 2), (e * 2, L["c"] * 2)] if L["o"] == "H" else [(L["c"] * 2, s * 2), (L["c"] * 2, e * 2)]
            d.line(seg, fill=(255, 0, 255), width=max(2, L["t"]))
    for g in gaps:
        seg = [(g["s"] * 2, g["c"] * 2), (g["e"] * 2, g["c"] * 2)] if g["o"] == "H" else [(g["c"] * 2, g["s"] * 2), (g["c"] * 2, g["e"] * 2)]
        d.line(seg, fill=(0, 200, 0), width=6)
    for c in cols: d.rectangle([c["x0"] * 2, c["y0"] * 2, c["x1"] * 2, c["y1"] * 2], outline=(124, 58, 237), width=3)
    big.save(a.out.rsplit(".", 1)[0] + ".png")
    print(f"{len(lines)} wall lines ({sum(1 for L in lines if L['o']=='H')} H / {sum(1 for L in lines if L['o']=='V')} V), {len(gaps)} gaps, {len(cols)} column blocks → {a.out}")

if __name__ == "__main__":
    main()
