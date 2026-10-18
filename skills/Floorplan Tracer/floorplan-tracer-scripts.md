---
id: floorplan-tracer-scripts
name: Reference scripts for the raster-plan tracer
category: Floorplan Tracer
when: You are executing trace-raster-plan-to-canvas and need the working measurement, build and proof scripts — copy these rather than rewriting them.
tools: [Bash]
requires: [trace-raster-plan-to-canvas]
---

Seven scripts, all run from a scratch folder holding the image (`floorplan.jpeg` here). Python needs `numpy` + `Pillow` + `scipy`; the build script is plain Node. Paths are the only thing to change. Every one of these was run on the Windsor Park trace (2026-09-14); the build script below IS that trace's `build.mjs`, so it doubles as a worked example of every construct.

## 1 · `profiles.py` — sample the wall colour and read an opening's exact edges

```python
import numpy as np
from PIL import Image
g = np.asarray(Image.open("floorplan.jpeg").convert("RGB")).astype(int).mean(2)
def col(x, y0, y1): print(f"col x={x} y{y0}-{y1}:", " ".join(f"{int(v):3d}" for v in g[y0:y1, x]))
def row(y, x0, x1): print(f"row y={y} x{x0}-{x1}:", " ".join(f"{int(v):3d}" for v in g[y, x0:x1]))
col(840, 500, 620)      # straight down the right wall through the main door: wall ≈78, edge 0-10, gap >150
row(366, 600, 680)      # across the bedroom door gap: frame lines at both ends give the exact opening
```

Wall fill ≈ 78 with 0–10 edges means a brochure plan: use `gray < 105` below. Near-black throughout means `gray < 80`.

## 2 · `bands.py` — find every dark band (walls) and draw them for inspection

```python
import numpy as np, json, sys
from PIL import Image, ImageDraw
im = Image.open("floorplan.jpeg").convert("RGB"); a = np.asarray(im).astype(int); H, W, _ = a.shape
gray = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2)
dark = (gray < 105) & (sat < 70)
# restrict to the plan region (exclude orange frame / key plans)
dark[:, :180] = False; dark[:, 900:] = False; dark[:110, :] = False; dark[960:, :] = False
Image.fromarray((dark * 255).astype(np.uint8)).save("dark.png")
MINLEN = 30
def runs(line):
    out = []; i = 0; n = len(line)
    while i < n:
        if line[i]:
            j = i
            while j < n and line[j]: j += 1
            if j - i >= MINLEN: out.append((i, j))
            i = j
        else: i += 1
    return out
def group(rundict, n):
    bands, active = [], []
    for k in range(n):
        cur = rundict[k]; nxt = []; used = [False] * len(cur)
        for b in active:
            hit = next((i for i, (p, q) in enumerate(cur) if not used[i] and min(q, b["b"]) - max(p, b["a"]) > MINLEN * 0.6), None)
            if hit is None: bands.append(b); continue
            p, q = cur[hit]; used[hit] = True
            b.update(k1=k, a=min(b["a"], p), b=max(b["b"], q)); b["rows"].append((p, q)); nxt.append(b)
        nxt += [dict(k0=k, k1=k, a=p, b=q, rows=[(p, q)]) for i, (p, q) in enumerate(cur) if not used[i]]
        active = nxt
    return bands + active
def summ(b):
    ps = sorted(r[0] for r in b["rows"]); qs = sorted(r[1] for r in b["rows"])
    return dict(k0=b["k0"], k1=b["k1"], thick=b["k1"] - b["k0"] + 1, a=int(np.median(ps)), b=int(np.median(qs)))
HB = [summ(b) for b in group({y: runs(dark[y]) for y in range(H)}, H) if b["k1"] - b["k0"] >= 3]
VB = [summ(b) for b in group({x: runs(dark[:, x]) for x in range(W)}, W) if b["k1"] - b["k0"] >= 3]
for d in HB: print(f"H y {d['k0']}-{d['k1']} t={d['thick']} | x {d['a']}..{d['b']}")
for d in VB: print(f"V x {d['k0']}-{d['k1']} t={d['thick']} | y {d['a']}..{d['b']}")
json.dump(dict(H=HB, V=VB), open("bands.json", "w"), indent=1)
ov = im.copy(); dr = ImageDraw.Draw(ov)
for d in HB: dr.rectangle([d["a"], d["k0"], d["b"], d["k1"]], outline=(255, 0, 0))
for d in VB: dr.rectangle([d["k0"], d["a"], d["k1"], d["b"]], outline=(0, 0, 255))
ov.crop((180,110,900,960)).resize((1440, 1700), Image.NEAREST).save("bands_overlay.png")
```

## 3 · `columns.py` — list the darker RCC column blocks as rectangles

```python
import numpy as np
from PIL import Image
from scipy import ndimage
a = np.asarray(Image.open("floorplan.jpeg").convert("RGB")).astype(int); g = a.mean(2); sat = a.max(2) - a.min(2)
m = (g < 55) & (sat < 70)                                     # dark-chocolate blocks only, walls (~78) drop out
m[:, :180] = False; m[:, 900:] = False; m[:110, :] = False     # plan region — mask the title block / key plans
m = ndimage.binary_opening(m, structure=np.ones((5, 5)))      # kills the 2 px edge lines, keeps solid blocks
lab, n = ndimage.label(m)
for i, sl in enumerate(ndimage.find_objects(lab), 1):
    ys, xs = sl; h = ys.stop - ys.start; w = xs.stop - xs.start
    if h * w < 150: continue
    print(f"col {i:2d}: x {xs.start}..{xs.stop-1}  y {ys.start}..{ys.stop-1}  ({w}x{h}) fill={m[sl].mean():.2f}")
```

## 4 · `measure.py` — refine the faces of each wall you will use and read the runs along it

```python
import numpy as np, json
from PIL import Image
a = np.asarray(Image.open("floorplan.jpeg").convert("RGB")).astype(int)
gray = a.mean(axis=2); sat = a.max(axis=2) - a.min(axis=2); dark = (gray < 105) & (sat < 70)
def largest_block(idx):
    best = cur = [idx[0]]
    for r in idx[1:]:
        cur = cur + [r] if r == cur[-1] + 1 else [r]
        if len(cur) > len(best): best = cur
    return best[0], best[-1]
def refine_h(y_lo, y_hi, x0, x1):
    frac = dark[y_lo:y_hi + 1, x0:x1].mean(axis=1); rows = [y_lo + i for i, f in enumerate(frac) if f > 0.6]
    return largest_block(rows) if rows else None
def refine_v(x_lo, x_hi, y0, y1):
    frac = dark[y0:y1, x_lo:x_hi + 1].mean(axis=0); cols = [x_lo + i for i, f in enumerate(frac) if f > 0.6]
    return largest_block(cols) if cols else None
def rle(line, start):
    out = []; i = 0
    while i < len(line):
        j = i
        while j < len(line) and line[j] == line[i]: j += 1
        out.append((bool(line[i]), start + i, start + j - 1)); i = j
    return [r for r in out if r[2] - r[1] + 1 >= 3]
# name, orient, lo, hi, clean a..b, full span
WALLS = [
 ("bed2-top-wall",   "h", 135, 165, 680, 760, 590, 852), ("bed2-top-colL",   "h", 135, 165, 600, 660, 590, 852), ("toilet2-top",     "h", 240, 268, 430, 560, 395, 612),
 # …one row per wall line, columns included as their own rows
]
res = {}
for name, o, lo, hi, a_, b_, fa, fb in WALLS:
    f = refine_h(lo, hi, a_, b_) if o == "h" else refine_v(lo, hi, a_, b_)
    if not f: print(name, "NOT FOUND"); continue
    f0, f1 = f; c = (f0 + f1) / 2
    band = (dark[f0:f1 + 1, fa:fb].mean(axis=0) if o == "h" else dark[fa:fb, f0:f1 + 1].mean(axis=1)) > 0.5
    rr = rle(band, fa)
    res[name] = dict(orient=o, face0=int(f0), face1=int(f1), centre=c, thick=int(f1 - f0 + 1), runs=rr)
    print(f"{name:17s} faces {f0}..{f1} t={f1 - f0 + 1:2d} c={c:6.1f}  " + " ".join(f"{'#' if v else '.'}{s}-{e}" for v, s, e in rr))
json.dump(res, open("walls_measured.json", "w"), indent=1)
```

The `.` runs printed on each line are the openings; their start/end pixels are what `build.mjs` uses.

## 5 · `grid_crops.py` — room crops with labelled image-px gridlines (read furniture coordinates off them)

```python
from PIL import Image, ImageDraw
im = Image.open("floorplan.jpeg").convert("RGB")
def grid(name, x0, y0, x1, y1, Z=4):                          # crop at Z× with image-px gridlines every 10 px
    c = im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * Z, (y1 - y0) * Z), Image.NEAREST); d = ImageDraw.Draw(c)
    for x in range((x0 // 10 + 1) * 10, x1, 10):
        X = (x - x0) * Z; d.line([X, 0, X, c.height], fill=(255, 0, 0) if x % 50 == 0 else (255, 160, 160))
        if x % 50 == 0: d.text((X + 2, 2), str(x), fill=(200, 0, 0))
    for y in range((y0 // 10 + 1) * 10, y1, 10):
        Y = (y - y0) * Z; d.line([0, Y, c.width, Y], fill=(0, 0, 255) if y % 50 == 0 else (160, 160, 255))
        if y % 50 == 0: d.text((2, Y + 2), str(y), fill=(0, 0, 200))
    c.save(f"grid_{name}.png")
grid("bed2", 600, 155, 840, 370); grid("kitchen", 600, 600, 780, 880)   # one per room
```

## 6 · `build.mjs` — the plan builder (the Windsor Park trace, complete: every construct in use, the wall lines solved from the printed dimensions, and the label predictor that replays the editor's inset rule)

```js
import { readFileSync, writeFileSync } from "node:fs";
const IMG = "Windsor_park.jpeg", IMG_W = 1500, IMG_H = 1086, OX = -IMG_W / 2, OY = -IMG_H / 2;
const LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library";
// calibration: [clear span px between wall inner faces, printed ft]
const CAL = [["BED2 w",227,11],["BED2 h",201,10],["T2 w",159,8],["T2 h",98,5],["LIV w",416,20.5],["LIV h",221,11],["BED1 w",209,10.5],["BED1 h",262,13],["T1 w",99,5],["T1 h",170,8.5],["KIT w",161,8],["KIT h",178,8.75],["UTIL w",115,5.75],["UTIL h",82,4],["BALC w",79,4],["BALC h",195,9.25]];
const PX_PER_FT = CAL.reduce((s, [, px, ft]) => s + px * ft, 0) / CAL.reduce((s, [, , ft]) => s + ft * ft, 0);
const PPM = +(PX_PER_FT / 0.3048).toFixed(3); const m = (px) => +(px / PPM).toFixed(3);
console.log(`px/ft ${PX_PER_FT.toFixed(3)}  ppm ${PPM}`);
for (const [n, px, ft] of CAL) console.log(`  ${n.padEnd(7)} ${px}px / ${ft}ft  resid ${(px / PX_PER_FT - ft).toFixed(2)} ft`);

let seq = 0; const id = (p) => `${p}-${(++seq).toString(36).padStart(3, "0")}`;
const nodeIdx = new Map(), nodes = [], nodeExtra = new Map(), segments = [], spaces = [], graphNodes = {}, objLayers = new Map();
const N = (x, y) => { const k = `${x},${y}`; if (nodeIdx.has(k)) return nodeIdx.get(k); const nid = `n${nodes.length}`; nodeIdx.set(k, nid); nodes.push({ id: nid, x: +(x + OX).toFixed(2), y: +(y + OY).toFixed(2) }); return nid; };
const att = (kind, params, extra = {}, cat = "Architectural") => ({ id: id("att"), objectId: `${kind}-with-math`, objectPath: `Objects/${cat}/${kind}.json`, params, t: 0.5, flip: false, ...extra });
const wallBase = (tPx) => ({ thickness: tPx, color: "#1e293b", dashed: false, lineStyle: "solid", mode: "fill", method: "center", segmentType: "line", bufferStyle: "flat", hatch: true, hatchStyle: "diagonal", hatchSpacing: 6, showLabel: false });
const wallAtt = (tPx, hatch = true, height = 2.7) => att("wall", { thickness: m(tPx), height, mode: "Buffered", hatch, fitMode: "Fill segment" });
const push = (s) => (segments.push(s), s);
const wall = (x1, y1, x2, y2, t) => push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "wall", ...wallBase(t), attachments: [wallAtt(t)] });
const thin = (x1, y1, x2, y2, t, h = 1) => push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "wall", ...wallBase(t), hatch: false, attachments: [wallAtt(t, false, h)] });
const dashed = (x1, y1, x2, y2, label) => push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "wall", thickness: 1.5, color: "#334155", dashed: true, lineStyle: "dashed", mode: "line", method: "center", segmentType: "line", showLabel: false, label });
// A wall gap with no leaf (kitchen → living, kitchen → utility) is a pre-cut band of the ADJACENT wall's thickness
// carrying the Wall object and opening.json — a thin dashed line there makes the mitre taper both wall ends to a point.
// An opening piece (door / window / opening) is NOT a wall: in series with a wall it already sits between wall pieces,
// but its end must never land on a perpendicular wall's centreline node — bridge junction → jamb with a short wall stub.
// A VACANT opening carries NO Wall attachment (nothing may stand in the gap, in 2D or 3D — no spandrel, no sill wall);
// the SEGMENT still keeps the wall thickness so the mitre at its ends stays square and the space label insets by it.
// `isObjectOpening` makes the canvas draw the band as a gap; opening.json draws one dotted line across it.
const opening = (x1, y1, x2, y2, t, label) => { objLayers.set("opening", "Opening"); return push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "opening", ...wallBase(t), isObjectOpening: true, label,
  attachments: [att("opening", { width: m(Math.hypot(x2 - x1, y2 - y1)), fitMode: "Fill segment", thickness: m(t), lintelHeight: 2.1, dashLength: 0.12, dashGap: 0.08 })] }); };
const ledge = (x1, y1, x2, y2, label) => { objLayers.set("ledge", "Ledge"); return push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "ledge", thickness: 1.5, color: "#64748b", dashed: false, lineStyle: "solid", mode: "line", method: "center", segmentType: "line", showLabel: false, label }); };
const door = (x1, y1, x2, y2, t, hinge, swing, o = {}) => push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "door", ...wallBase(t), isObjectOpening: true, label: o.label,
  attachments: [wallAtt(t), att("door", { width: m(Math.hypot(x2 - x1, y2 - y1)), leaves: o.leaves ?? "Single", hinge, swing, openAngle: 90, fitMode: "Fill segment", frameDepth: m(t), lintelHeight: 2.1 }, { flip: swing === "right" })] });
const window = (x1, y1, x2, y2, t, o = {}) => push({ id: id("seg"), fromNodeId: N(x1, y1), toNodeId: N(x2, y2), layer: "window", ...wallBase(t), isObjectOpening: true, label: o.label,
  attachments: [wallAtt(t), att("window", { width: m(Math.hypot(x2 - x1, y2 - y1)), fitMode: "Fill wall", sillHeight: o.sill ?? 0.9, lintelHeight: o.lintel ?? 2.1, wallDepth: m(t), panes: o.panes ?? 2, operation: o.operation ?? "Casement", showFrame: true })] });
const space = (label, ring, o = {}) => { const pts = ring.length === 4 && typeof ring[0] === "number" ? [[ring[0], ring[1]], [ring[2], ring[1]], [ring[2], ring[3]], [ring[0], ring[3]]] : ring;
  spaces.push({ id: id("space"), nodeIds: pts.map(([x, y]) => N(x, y)), layer: "space", label, showLabel: true, roomType: o.roomType ?? "room", fill: o.fill ?? "rgba(148,163,184,0.25)", stroke: o.stroke ?? "#475569", fillOpacity: o.fillOpacity ?? 0.18, ...(o.region ? { region: o.region } : {}), attachments: [att("room", { color: o.color ?? "Grey" }, { t: 0 })] }); };
const obj = (kind, cx, cy, params, name, cat = "Architectural") => { objLayers.set(kind, name ?? kind); const segId = id("obj"), nid = N(cx, cy);
  segments.push({ id: segId, fromNodeId: nid, toNodeId: nid, layer: kind, thickness: 0.5, color: "#1e293b", dashed: false, mode: "line", method: "center", segmentType: "wall" });
  graphNodes[[`${segId}:start`, `${segId}:end`].sort().join("|")] = { "node-type": "object" };
  nodeExtra.set(nid, [...(nodeExtra.get(nid) ?? []), att(kind, { rotation: 0, anchorDir: "Center", fitMode: "Off", ...params }, { t: 0 }, cat)]); };
// a dark block in the render = RCC column sitting on the wall line; the wall runs through underneath
const column = (x0, y0, x1, y1) => obj("column", (x0 + x1) / 2, (y0 + y1) / 2, { shape: "Rectangular", length: m(x1 - x0), breadth: m(y1 - y0), height: 3 }, "Column", "Structural");

// ── wall lines: SOLVED from the printed room dimensions, seeded by the measured centrelines ──
// The editor's space label ("Subtract segment for Space", on by default) insets every ring edge by the LARGEST
// half-thickness of any band collinear with that edge, floored at half the current wall style (10 px → 5). So a
// printed clear span becomes: centreline − centreline = span + halfT(near) + halfT(far). Three measured lines are
// anchors (xT2L, yB2, yDuct); every other line is placed from a printed dimension, and the move from its measured
// position (≤ 6.5 px = 0.1 m here) is what "slightly translate the walls" means. Rooms with no printed size
// (duct, niche, shafts) keep the measured line.
const ft = (f, i = 0) => (f + i / 12) * PX_PER_FT, FLOOR = 5;   // FLOOR = editor default wall style 10 px / 2
const xT2L = 408.5, yB2 = 366, yDuct = 336;                                   // anchors (measured)
const xR   = xT2L + 8.5 + ft(20, 6) + 8;        // LIVING 20'6"  : t17 | t16
const xW2  = xR - 8 - ft(11) - 6;               // BEDROOM-2 11' : t16 | t12 window line
const xT2R = xT2L + 8.5 + ft(8) + 5;            // TOILET-2 8'   : t17 | t10
const xB1R = xW2 - 8 - ft(5) - 6;               // TOILET-1 5'   : t16 | t12
const xB1L = xB1R - 6 - ft(10, 6) - 8.5;        // BEDROOM-1 10'6": t12 | t17
const xKR  = xW2 + 8 + ft(8) + 8;               // KITCHEN 8'    : t16 | t16
const xUL  = xKR - 8 - ft(5, 9) - 8;            // UTILITY 5'9"  : t16 | t16
const xPar = xT2L - 8.5 - ft(4) - FLOOR;        // BALCONY 4'    : t17 | parapet t10 (half 5 = floor)
const xSh  = xR + 7;                            // shaft outer edge, thin line 7 px outside the wall centreline
const yTop = yB2 - 5.5 - ft(10) - 8;            // BEDROOM-2 10' : t11 | t16
const yT2  = yB2 - 5.5 - ft(5) - 8.5;           // TOILET-2 5'   : t11 | t17
const yMid = yB2 + 5.5 + ft(11) + 8.5;          // LIVING 11'    : t11 | t17 (the thickest band on that edge)
const yB1  = yMid + 8.5 + ft(13) + 8.5;         // BEDROOM-1 13' : t17 | t17
const yBot = yMid + 5 + ft(8, 6) + 8.5;         // TOILET-1 8'6" : t10 | t17  (KITCHEN prints 8'9" to the same two lines — see report)
const yUt  = yBot + 8.5 + ft(4) + 11.5;         // UTILITY 4'    : t17 | t23
const yDuctBot = yMid - 8.5 - ft(9, 3) - 5;     // BALCONY 9'3"  : t17 | duct kerb t10
const measured = { xR: 840.5, xW2: 599.5, xT2R: 581.5, xB1R: 486.5, xB1L: 263, xKR: 776.5, xUL: 645.5, xPar: 319.5, yTop: 151.5, yT2: 254, yMid: 599.5, yB1: 880, yBot: 781.5, yUt: 883, yDuctBot: 397 };
for (const [k, v] of Object.entries({ xR, xW2, xT2R, xB1R, xB1L, xKR, xUL, xPar, yTop, yT2, yMid, yB1, yBot, yUt, yDuctBot })) console.log(`  ${k.padEnd(9)} ${v.toFixed(2).padStart(7)}  measured ${String(measured[k]).padStart(6)}  moved ${(v - measured[k]).toFixed(1).padStart(5)} px`);
// bedroom-2 top (exterior)
wall(xW2, yTop, xR, yTop, 16);                                   // corners at xW2 and xR: no stub past the junction
column(593, 138, 661, 160); column(778, 138, 848, 160);
// bedroom-2 left: window line, toilet-2 top wall, thin partition (the niche between them is a space ring, no wall)
wall(xW2, yTop, xW2, 160, 12); window(xW2, 160, xW2, 246, 12, { label: "Bedroom-2 window", panes: 3 }); wall(xW2, 246, xW2, yT2, 12);
wall(xT2L, yT2, xT2R, yT2, 17); wall(xT2R, yT2, xW2, yT2, 17);
wall(xT2R, yT2, xT2R, yB2, 10);
ledge(476, 263, 476, 361, "Shower screen");
// toilet-2 / bedroom-2 bottom row (split at xW2 so the bedroom-2 ring can close on a wall node)
wall(xT2L, yB2, 530, yB2, 11); door(530, yB2, 572, yB2, 11, "right", "right", { label: "Toilet-2 door" });
wall(572, yB2, xT2R, yB2, 11); wall(xT2R, yB2, xW2, yB2, 11); wall(xW2, yB2, 611, yB2, 11); door(611, yB2, 666, yB2, 11, "left", "right", { label: "Bedroom-2 door" });
wall(666, yB2, xR, yB2, 11);
column(576, 327, 607, 371); column(792, 341, 848, 371);
// right exterior wall + main door
wall(xR, yTop, xR, yB2, 16); wall(xR, yB2, xR, 527, 16); door(xR, 527, xR, 592, 16, "right", "left", { label: "Main door" }); wall(xR, 592, xR, yMid, 16);
// duct + balcony: the parapet line carries the duct's left wall too (the RCC block is a column object on top),
// then stub · vacant opening · stub so the balcony's open side meets both perpendicular walls through wall (no parapet:
// the render's thin line is the opening's dotted line, and nothing stands in the gap in 3D)
wall(xPar, yDuct, xT2L, yDuct, 17); wall(xPar, yDuct, xPar, yDuctBot, 10); column(313, 328, 335, 397);
thin(xPar, yDuctBot, xT2L, yDuctBot, 10, 0.6);   // duct kerb: a real 10 px band, so the balcony's top edge insets by 5 whatever the editor's floor is
wall(xPar, yDuctBot, xPar, 410, 10); opening(xPar, 410, xPar, 592, 10, "Balcony open side"); wall(xPar, 592, xPar, yMid, 10);
wall(xT2L, yT2, xT2L, 291, 17); window(xT2L, 291, xT2L, 328, 17, { label: "Toilet-2 window", sill: 1.5, panes: 1 }); wall(xT2L, 328, xT2L, yDuct, 17);
wall(xT2L, yDuct, xT2L, yDuctBot, 17); wall(xT2L, yDuctBot, xT2L, 442, 17);
window(xT2L, 442, xT2L, 579, 17, { label: "Balcony sliding door", sill: 0, operation: "Sliding", panes: 2 }); wall(xT2L, 579, xT2L, yMid, 17);
// middle row: bedroom-1 top · toilet-1 top · kitchen top · living/shaft top (the shaft piece measured 19 px is
// authored at 17 so the living's bottom edge insets by one thickness everywhere)
wall(xB1L, yMid, xPar, yMid, 17); wall(xPar, yMid, xT2L, yMid, 17); wall(xT2L, yMid, 426, yMid, 17);
door(426, yMid, 480, yMid, 17, "right", "left", { label: "Bedroom-1 door" });
wall(480, yMid, xB1R, yMid, 10); wall(xB1R, yMid, xW2, yMid, 10); wall(xW2, yMid, 648.5, yMid, 10);
opening(648.5, yMid, 699, yMid, 10, "Kitchen opening");
wall(699, yMid, xKR, yMid, 10); wall(xKR, yMid, xR, yMid, 17); wall(xR, yMid, xSh, yMid, 17);
column(256, 587, 321, 609); column(592, 594, 648, 616);
// bedroom-1 sides and bottom
wall(xB1L, yMid, xB1L, 657, 17); window(xB1L, 657, xB1L, 733, 17, { label: "Bedroom-1 window", panes: 3 }); wall(xB1L, 733, xB1L, yB1, 17);
wall(xB1R, yMid, xB1R, 667, 12); door(xB1R, 667, xB1R, 709, 12, "right", "right", { label: "Toilet-1 door" }); wall(xB1R, 709, xB1R, yBot, 12); wall(xB1R, yBot, xB1R, yB1, 12);
column(249, 788, 270, 858); column(483, 787, 505, 858);
wall(xB1L, yB1, xB1R, yB1, 17);
// kitchen / shafts
wall(xW2, yMid, xW2, yBot, 16);
wall(xKR, yMid, xKR, yBot, 16); wall(xKR, yBot, xKR, yUt, 16);
thin(xSh, yMid, xSh, yBot, 2, 1.0); thin(xSh, yBot, xSh, yUt, 2, 1.0);
wall(xB1R, yBot, 524, yBot, 17); window(524, yBot, 560, yBot, 17, { label: "Toilet-1 ventilator", sill: 1.8, lintel: 2.3, panes: 1 }); wall(560, yBot, xW2, yBot, 17);
wall(xW2, yBot, xUL, yBot, 17); wall(xUL, yBot, xUL + 8, yBot, 17);
opening(xUL + 8, yBot, xKR - 8, yBot, 17, "Kitchen-utility opening"); wall(xKR - 8, yBot, xKR, yBot, 17);   // jambs on the utility's faces; half-band stubs join both perpendicular walls
wall(xKR, yBot, xSh, yBot, 23);
// utility
wall(xUL, yBot, xUL, 795, 16); window(xUL, 795, xUL, 871, 16, { label: "Utility window", sill: 0.9, panes: 2 }); wall(xUL, 871, xUL, yUt, 16); wall(xUL, yUt, xUL, 913, 16);
wall(xUL, yUt, xKR, yUt, 23); wall(xKR, yUt, xSh, yUt, 23);
// The chajja boxes drawn outside the three windows are deliberately NOT traced: any open polyline that
// touches a wall gets closed by the auto-room detector into a sliver "Space00N" on import.

// ── spaces: rings on the wall CENTRELINES (shared wall nodes), the editor's own convention — it insets them to
//    the faces for the label, and a ring that sits on wall nodes moves with the walls ──
space("BEDROOM-2", [xW2, yTop, xR, yB2], { fill: "rgba(226,232,240,0.5)" });
space("TOILET-2", [xT2L, yT2, xT2R, yB2], { region: "Toilet", fill: "rgba(147,197,253,0.45)", color: "Blue" });
space("NICHE", [xT2R, yT2, xW2, 327], { roomType: "area", fill: "rgba(255,255,255,0.3)" });
space("LIVING / DINING", [xT2L, yB2, xR, yMid], { fill: "rgba(226,232,240,0.5)" });
space("DUCT", [xPar, yDuct, xT2L, yDuctBot], { roomType: "area", fill: "rgba(203,213,225,0.5)" });
space("BALCONY", [xPar, yDuctBot, xT2L, yMid], { region: "Balcony", fill: "rgba(254,215,170,0.45)", color: "Orange" });
space("BEDROOM-1", [xB1L, yMid, xB1R, yB1], { fill: "rgba(226,232,240,0.5)" });
space("TOILET-1", [xB1R, yMid, xW2, yBot], { region: "Toilet", fill: "rgba(147,197,253,0.45)", color: "Blue" });
space("KITCHEN", [xW2, yMid, xKR, yBot], { fill: "rgba(226,232,240,0.5)" });
space("UTILITY", [xUL, yBot, xKR, yUt], { fill: "rgba(226,232,240,0.5)" });
space("SERVICE SHAFT", [xKR, yMid, xSh, yBot], { roomType: "area", fill: "rgba(203,213,225,0.5)" });
space("SERVICE SHAFT", [xKR, yBot, xSh, yUt], { roomType: "area", fill: "rgba(203,213,225,0.5)" });

// ── furniture & fixtures (centre px, dims px → m) ──
obj("bed", 695, 221, { length: m(117), width: m(90), rotation: 90, pillows: 2 }, "Bed");
obj("nightstand", 632.5, 177.5, { length: m(25), width: m(25), rotation: 90 }, "Nightstand"); obj("nightstand", 757, 177.5, { length: m(25), width: m(25), rotation: 90 }, "Nightstand");
obj("wardrobe", 814, 250, { width: m(180), depth: m(42), rotation: 90, doors: 4, doorStyle: "Sliding" }, "Wardrobe");
obj("tv-unit", 714, 353.5, { length: m(60), width: m(15), rotation: 0, base: "Wall-hung", screenSize: m(50), bays: 2 }, "TV unit");
obj("bed", 421, 784, { length: m(116), width: m(113), rotation: 180, pillows: 2 }, "Bed");
obj("nightstand", 467.5, 854.5, { length: m(23), width: m(21), rotation: 0 }, "Nightstand");
obj("wardrobe", 341, 629, { width: m(137), depth: m(40), rotation: 0, doors: 4, doorStyle: "Sliding" }, "Wardrobe");
obj("dressing-table", 284, 805.5, { length: Math.min(1.8, m(119)), width: m(23.5), rotation: 90, mirrorShape: "Rectangular", mirrorWidth: 0.9 }, "Dressing table");
obj("stool", 299, 839, { length: m(26), width: m(27), seatShape: "Square", height: 0.45, showFootrest: false }, "Stool");
obj("table", 515, 482.5, { length: m(70), width: m(65), rotation: 0 }, "Table");
for (const [cx, cy, r] of [[516, 439.5, 90], [516, 525.5, 270], [467, 482, 0], [559.5, 482, 180]]) obj("chair", cx, cy, { width: m(28), depth: m(29), rotation: r, arms: true }, "Chair");
obj("sofa", 750, 396, { length: m(84), depth: m(38), seats: 3, rotation: 180 }, "Sofa");
obj("armchair", 809, 394.5, { length: Math.max(0.5, m(28)), width: m(35), rotation: 180 }, "Armchair");
obj("sofa", 687, 463.5, { length: m(93), depth: m(40), seats: 2, rotation: 90 }, "Sofa");
obj("table", 747.5, 465.5, { length: m(41), width: m(41), height: 0.45, legStyle: "Pedestal", apron: false }, "Table");
obj("shoe-rack", 825, 474.5, { length: m(61), width: m(20), rotation: 90 }, "Shoe rack");
obj("toilet", 503, 284.5, { length: m(49), width: m(31), rotation: 90 }, "Toilet");
obj("washbasin", 553, 277.5, { length: m(36), width: m(35), rotation: 0, support: "Vanity unit" }, "Washbasin");
obj("toilet", 524, 752, { length: m(44), width: m(30), rotation: 270 }, "Toilet");
obj("washbasin", 576, 686, { length: m(43), width: m(30), rotation: 90, support: "Vanity unit" }, "Washbasin");
obj("cabinet", 628.5, 695, { width: m(154), depth: m(41), rotation: 90, worktop: true, doors: 4, drawers: 2 }, "Cabinet");
obj("stove", 626, 724.5, { length: m(51), width: m(32), rotation: 90, kind: "Built-in hob", burners: "Four" }, "Stove");
obj("refrigerator", 751, 632.5, { length: m(43), width: m(37), rotation: 270 }, "Refrigerator");
obj("cabinet", 749.5, 722, { width: m(124), depth: m(41), rotation: 270, worktop: true, doors: 3, drawers: 1 }, "Cabinet");
obj("kitchen-sink", 750, 737, { length: m(70), width: m(35), rotation: 270, bowls: "Single", drainer: true }, "Kitchen sink");
obj("washing-machine", 751, 839, { length: m(37), width: m(37), rotation: 270 }, "Washing machine");
obj("washbasin", 366, 412, { length: m(32), width: m(31), rotation: 0 }, "Washbasin");
obj("north-arrow", 1115, 855, { style: "Triangle", color: "Black", size: 0.9, showCircle: true, showLetter: true, rotation: 0 }, "North arrow");

// ── assemble ──
const layers = [{ id: "0", name: "0", color: "#000000", visible: true, locked: false, order: 0 }, { id: "image", name: "Image", color: "#a855f7", visible: true, locked: false, order: 1 },
  { id: "map", name: "Map", color: "#0284c7", visible: false, locked: false, order: 2 }, { id: "dimension", name: "Dimension", color: "#b45309", visible: true, locked: false, order: 3 },
  { id: "wall", name: "Wall", color: "#1e293b", visible: true, locked: false, order: 4 }, { id: "door", name: "Door", color: "#b91c1c", visible: true, locked: false, order: 5 },
  { id: "window", name: "Window", color: "#0e7490", visible: true, locked: false, order: 6 }, { id: "space", name: "Space", color: "#16a34a", visible: true, locked: false, order: 7 }];
let order = 8; for (const [lid, name] of objLayers) if (!layers.some((l) => l.id === lid)) layers.push({ id: lid, name, color: lid === "ledge" ? "#64748b" : "#7c3aed", visible: true, locked: false, order: order++ });
const planNodes = nodes.map((n) => { const e = nodeExtra.get(n.id); return { ...n, layer: e ? "0" : "wall", ...(e ? { attachments: e } : {}) }; });
const jpeg = readFileSync(IMG);
const plan = { schemaVersion: 1,
  settings: { library_path: LIB, units: "m", northbearing: 0, pixelsPerMeter: PPM, keywords: "Windsor Park unit B1 2BHK, Windsor_park.jpeg trace, image-native scale",
    source: { image: `Images/${IMG}`, imagePixels: [IMG_W, IMG_H], pxPerFoot: +PX_PER_FT.toFixed(3), worldOrigin: `image top-left at world (${OX}, ${OY})` } },
  nodes: planNodes, segments, spaces, layers,
  imageUnderlay: { id: "img-windsor-park", src: `data:image/jpeg;base64,${jpeg.toString("base64")}`, x: OX, y: OY, width: IMG_W, height: IMG_H, opacity: 0.55, scale: 1, locked: true, layerId: "image" },
  graphAttrs: { nodes: graphNodes, segments: {} } };
writeFileSync("plan.json", JSON.stringify(plan, null, 1));
writeFileSync("plan.noimg.json", JSON.stringify({ ...plan, imageUnderlay: { ...plan.imageUnderlay, src: `${LIB}/Images/${IMG}` } }, null, 1));
const nObj = planNodes.reduce((s, n) => s + (n.attachments?.length ?? 0), 0);
console.log(`nodes ${planNodes.length}  segments ${segments.length}  spaces ${spaces.length}  node objects ${nObj}  openings ${segments.filter((s) => s.isObjectOpening).length}`);
// ── what the editor's label will say: replay its per-edge inset (max collinear half-thickness, floored) ──
const printed = { "BEDROOM-2": [11, 10], "TOILET-2": [8, 5], "LIVING / DINING": [20.5, 11], BALCONY: [4, 9.25], "BEDROOM-1": [10.5, 13], "TOILET-1": [5, 8.5], KITCHEN: [8, 8.75], UTILITY: [5.75, 4] };
const at = Object.fromEntries(nodes.map((n) => [n.id, n]));
const bands = segments.filter((s) => s.bufferStyle && s.fromNodeId !== s.toNodeId).map((s) => ({ a: at[s.fromNodeId], b: at[s.toNodeId], t: s.thickness }));
const ftin = (px) => { let i = Math.round((px / PX_PER_FT) * 120) / 10, F = Math.floor(i / 12); i -= F * 12; return `${F}' ${i.toFixed(1)}"`; };
for (const sp of spaces) {
  const P = sp.nodeIds.map((i) => at[i]); const M = P.length; const ins = [];
  for (let i = 0; i < M; i++) { const a = P[i], b = P[(i + 1) % M]; const ex = b.x - a.x, ey = b.y - a.y, L = Math.hypot(ex, ey), ux = ex / L, uy = ey / L; let half = 0;
    for (const w of bands) { const wx = w.b.x - w.a.x, wy = w.b.y - w.a.y, wL = Math.hypot(wx, wy); if (Math.abs((ux * wy - uy * wx) / wL) > 0.2) continue;
      const mx = (w.a.x + w.b.x) / 2, my = (w.a.y + w.b.y) / 2; let t = Math.max(0, Math.min(L, (mx - a.x) * ux + (my - a.y) * uy));
      if (Math.hypot(mx - (a.x + t * ux), my - (a.y + t * uy)) < 8) half = Math.max(half, w.t / 2); }
    if (!half && printed[sp.label]) console.log(`  !! ${sp.label}: edge ${i} has NO band — its inset is the editor's floor, which varies per session; give it a thin band`);
    ins.push(Math.max(FLOOR, half)); }
  // axis-aligned rectangles here: inset each side by its edge's value
  const xs = P.map((p) => p.x), ys = P.map((p) => p.y); const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const side = (pred) => ins[P.findIndex((p, i) => pred(p, P[(i + 1) % M]))];
  const top = side((p, q) => p.y === y0 && q.y === y0), bot = side((p, q) => p.y === y1 && q.y === y1), lef = side((p, q) => p.x === x0 && q.x === x0), rig = side((p, q) => p.x === x1 && q.x === x1);
  const W = (x1 - x0) - lef - rig, H = (y1 - y0) - top - bot, pr = printed[sp.label];
  console.log(`${sp.label.padEnd(16)} label ${ftin(W).padStart(9)} × ${ftin(H).padStart(9)}  ${(W * H / PPM / PPM).toFixed(2)} m²` + (pr ? `   printed ${pr[0]}' × ${pr[1]}'  Δ ${(W / PX_PER_FT - pr[0]).toFixed(3)} / ${(H / PX_PER_FT - pr[1]).toFixed(3)} ft` : ""));
}
```

## 7 · `overlay_proof.py` — composite the plan AND the baked object footprints on the image at 2×

```python
"""Composite the traced plan on the image at 2x. Walls from the plan segments (bands of their real thickness);
doors / windows / furniture from the headless bake's `plan2d` fills, so what you see is what the objects draw."""
import json, sys
from PIL import Image, ImageDraw
img_path, plan_path, out_path = sys.argv[1:4]; baked_path = sys.argv[4] if len(sys.argv) > 4 else None
im = Image.open(img_path).convert("RGB"); W, H = im.size; plan = json.load(open(plan_path, encoding="utf8")); Z = 2
PPM = plan["settings"]["pixelsPerMeter"]
ov = im.resize((W * Z, H * Z), Image.NEAREST); dr = ImageDraw.Draw(ov, "RGBA")
nodes = {n["id"]: (n["x"] + W / 2, n["y"] + H / 2) for n in plan["nodes"]}; P = lambda p: (p[0] * Z, p[1] * Z)
def band(a, b, t, fill):
    (x1, y1), (x2, y2) = a, b; dx, dy = x2 - x1, y2 - y1; L = (dx * dx + dy * dy) ** 0.5 or 1; nx, ny = -dy / L * t / 2, dx / L * t / 2
    dr.polygon([P((x1 + nx, y1 + ny)), P((x2 + nx, y2 + ny)), P((x2 - nx, y2 - ny)), P((x1 - nx, y1 - ny))], fill=fill)
for s in plan["segments"]:
    a, b = nodes[s["fromNodeId"]], nodes[s["toNodeId"]]
    if a == b: continue
    if s.get("dashed"): dr.line([P(a), P(b)], fill=(255, 140, 0, 255), width=2); continue
    if s.get("layer") == "ledge": dr.line([P(a), P(b)], fill=(120, 0, 200, 255), width=2); continue
    band(a, b, float(s.get("thickness", 4)), ({"door": (255, 180, 80, 120), "opening": (190, 140, 255, 120)}.get(s.get("layer"), (120, 220, 255, 120))) if s.get("isObjectOpening") else (220, 0, 0, 140))
for sp in plan["spaces"]:
    pts = [nodes[i] for i in sp["nodeIds"]]; dr.polygon([P(p) for p in pts], outline=(0, 160, 0, 255))
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts); dr.text(P((cx - 12, cy - 4)), sp.get("label", ""), fill=(0, 120, 0, 255))
if baked_path:
    baked = json.load(open(baked_path, encoding="utf8"))
    col = {"door": (255, 120, 0, 255), "window": (0, 170, 255, 255), "opening": (140, 60, 255, 255), "column": (0, 0, 0, 255)}
    for hosts in (baked["nodes"], baked["segments"], baked["spaces"]):
        for h in hosts:
            for att in h.get("attachments", []):
                b = att.get("baked"); kind = att["objectPath"].split("/")[-1].replace(".json", "")
                if not b or not b.get("plan2d"): continue
                ax, ay = b["anchor"]; c = col.get(kind, (255, 0, 255, 255))
                tw = lambda p: P(((ax + p[0]) * PPM + W / 2, (ay + p[1]) * PPM + H / 2))
                for poly in b["plan2d"].get("fill", []):
                    if len(poly) >= 3: dr.polygon([tw(p) for p in poly], outline=c)
                for ln in b["plan2d"].get("lines", []):
                    if len(ln) >= 2: dr.line([tw(p) for p in ln], fill=c, width=1)
for n in plan["nodes"]:
    if n.get("attachments"): x, y = nodes[n["id"]]; dr.ellipse([P((x - 2, y - 2)), P((x + 2, y + 2))], fill=(255, 0, 255, 255))
ov.save(out_path); print("wrote", out_path, ov.size)
```

Run as `python overlay_proof.py floorplan.jpeg plan.noimg.json proof.png baked.json` after the bake; crop the proof per room with PIL and read each crop.

## 8 · Headless bake and in-app import

```bash
node tools/bakeplan/run.mjs plan.noimg.json --out baked.json      # from the app repo; expects "library: N/N objects resolved" and "with meshes N" = attachments
```

Upload the picture and the plan to the bucket first (`putObject` in `tools/r2.mjs` with the `.env` R2 credentials: keys `library/Images/<file>`, `library/Designs/<Name>.json`), open `http://localhost:<port>/floorplan-editor?agent=1`, then import through the editor's own file input:

```js
// Run in the editor tab (opened with ?agent=1) via the browser tools' javascript_exec, after putObject
// uploaded the plan to library/Designs/. Input [0] is the editor's "Import JSON" chooser (accept=".json").
const r = await fetch('https://<public-r2-host>/library/Designs/<Name>.json', { cache: 'no-store' });
const f = new File([await r.text()], '<Name>.json', { type: 'application/json' });
const dt = new DataTransfer(); dt.items.add(f);
const inp = document.querySelectorAll('input[type=file]')[0]; inp.value = ''; inp.files = dt.files;
inp.dispatchEvent(new Event('change', { bubbles: true }));
// then: get_state → ppm + objectsLoaded; list_spaces → labels/areas, no Space00N; screenshot.
```

`apply_model` over the bridge is NOT an import: it merges the internal model without settings, underlay or object resolution.


## 9 · Multi-storey scripts (beside this file)

`multi/rects.py` (wall bands → rectangles), `multi/auto.py` (centrelines + gaps classified door/window by glazing colour + overlay), `multi/grid.py` (gridded crops), `multi/build.mjs` (the Villa 1 builder: per-sheet calibration, shared anchor, run specs, T-split, packed `levels[]` output), `multi/overlay.py` (per-level proof), `multi/bakeobj.mjs` + `multi/overlay_obj.py` (bake every placed object with its own Math Engine and draw the real footprints on each sheet). How to drive them: `trace-multi-storey-plans`.
