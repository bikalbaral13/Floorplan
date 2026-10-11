"""Derived views, all generated from geo.json — nothing is drawn by hand.

    plan        the scoped spaces with walls, openings, furniture footprints and elevation tags
    rcp         reflected ceiling plan: walls, space outlines, ceiling levels (to confirm)
    elev-<L>    one unfolded interior elevation per wall run that faces a scoped space

Each sheet carries its metre -> sheet-pixel transform so the schedule can place shapes on it,
and the apps / deck can map back. Levels come from scope.json (stated defaults, tagged in the brief).
"""
import math, os
from . import geometry as G
from .draw import Sheet, INK, MUTED, FAINT, ROOM, GLASS, OBJ

TITLE = {"plan": "Plan", "rcp": "Reflected ceiling plan"}

class PlanXf:
    def __init__(self, bounds, scale, pad):
        self.x0, self.y0, self.s, self.pad = bounds[0], bounds[1], scale, pad
    def __call__(self, p): return (self.pad + (p[0] - self.x0) * self.s, self.pad + (p[1] - self.y0) * self.s)
    def meta(self): return {"type": "plan", "x0": self.x0, "y0": self.y0, "s": self.s, "pad": self.pad}

class ElevXf:
    def __init__(self, frame, top, scale, pad_l, pad_t):
        self.o = frame["origin"]; self.r = frame["right"]; self.top, self.s, self.pl, self.pt = top, scale, pad_l, pad_t
    def t(self, p): return (p[0] - self.o[0]) * self.r[0] + (p[1] - self.o[1]) * self.r[1]
    def __call__(self, t, z): return (self.pl + t * self.s, self.pt + (self.top - z) * self.s)
    def meta(self): return {"type": "elevation", "origin": self.o, "right": self.r, "top": self.top, "s": self.s, "pad_l": self.pl, "pad_t": self.pt}

def _wall_poly(w, extend=True):
    a, b = tuple(w["a"]), tuple(w["b"]); d = G.norm(G.sub(b, a)); n = (-d[1], d[0]); h = w["thickness"] / 2
    e = h if (extend and not w.get("opening")) else 0
    a2, b2 = G.sub(a, G.mul(d, e)), G.add(b, G.mul(d, e))
    return [G.add(a2, G.mul(n, h)), G.add(b2, G.mul(n, h)), G.sub(b2, G.mul(n, h)), G.sub(a2, G.mul(n, h))], d, n

def footprint(o):
    """Rotated rectangle (or circle radius for rugs) of a node object, metres."""
    c = o["at"]; L, D = o["length"], o["depth"]; th = math.radians(o.get("rotation") or 0)
    pts = []
    for x, y in ((-L / 2, -D / 2), (L / 2, -D / 2), (L / 2, D / 2), (-L / 2, D / 2)):
        pts.append((c[0] + x * math.cos(th) - y * math.sin(th), c[1] + x * math.sin(th) + y * math.cos(th)))
    return pts

def _scale_bar(sh, x, y, s, label_size=15):
    sh.text(x, y - 8, "0", label_size, MUTED, "middle")
    for i, m in enumerate((1, 2, 5)):
        x0 = x + (0 if i == 0 else (1, 2)[i - 1] * s); x1 = x + m * s
        sh.rect(x0, y, x1, y + 6, fill=INK if i % 2 == 0 else "#FFFFFF", stroke=INK, width=1)
        sh.text(x1, y - 8, f"{m} m", label_size, MUTED, "middle")

def plan_sheet(geo, levels, kind="plan", target_w=1600, margin=1.4):
    bx = geo["bounds"]; b = (bx[0] - margin, bx[1] - margin, bx[2] + margin, bx[3] + margin)
    s = min(target_w / (b[2] - b[0]), 1250 / (b[3] - b[1])); pad = 30
    W = (b[2] - b[0]) * s + 2 * pad; H = (b[3] - b[1]) * s + 2 * pad + 30
    X = PlanXf(b, s, pad); sh = Sheet(W, H)
    rcp = kind == "rcp"
    for sp in geo["spaces"]:
        sh.poly([X(p) for p in sp["ring"]], fill=None if rcp else ROOM, stroke=FAINT if not rcp else MUTED, width=1, dash="6 4" if rcp else None)
    # objects (plan only)
    if not rcp:
        for o in geo["objects"]:
            if o["kind"] == "column": continue
            if o["kind"] == "rug":
                sh.circle(X(o["at"]), o["length"] / 2 * s, fill=None, stroke=MUTED, width=1, dash="3 3")
            else:
                sh.poly([X(p) for p in footprint(o)], fill=OBJ, stroke=MUTED, width=1)
    # walls and openings
    for w in geo["walls"]:
        poly, d, n = _wall_poly(w); op = w.get("opening")
        if not op:
            sh.poly([X(p) for p in poly], fill=INK, stroke=INK, width=0.6)
            continue
        a, b2 = tuple(w["a"]), tuple(w["b"]); t = w["thickness"]
        if op["kind"] == "window":
            sh.poly([X(p) for p in poly], fill=GLASS if not rcp else "#FFFFFF", stroke=INK, width=1)
            sh.line(X(a), X(b2), MUTED, 1)
            n_p = op["panes"] or max(1, round(op["width"] / 0.6))
            for i in range(1, n_p):
                q = G.add(a, G.mul(d, op["width"] * i / n_p)); sh.line(X(G.add(q, G.mul(n, t / 2))), X(G.sub(q, G.mul(n, t / 2))), INK, 1.2)
        else:
            for q in (a, b2): sh.line(X(G.add(q, G.mul(n, t / 2))), X(G.sub(q, G.mul(n, t / 2))), INK, 2)
            if rcp:
                sh.line(X(a), X(b2), MUTED, 1, "4 3"); continue
            leaves = 2 if str(op.get("leaves", "")).lower().startswith("double") else 1
            side = -1 if op.get("swing") == "left" else 1
            if op.get("flip"): side = -side
            wid = op["width"] / leaves
            hinges = [a, b2] if leaves == 2 else ([b2] if op.get("hinge") == "right" else [a])
            for hg in hinges:
                inward_d = d if hg == a else (-d[0], -d[1])
                tip = G.add(hg, G.mul(n, side * wid)); sh.line(X(hg), X(tip), INK, 1.4)
                a0 = math.degrees(math.atan2(n[1] * side, n[0] * side)); a1 = math.degrees(math.atan2(inward_d[1], inward_d[0]))
                if a1 - a0 > 180: a1 -= 360
                if a0 - a1 > 180: a1 += 360
                c = X(hg); sh.arc(c, wid * s, a0, a1, MUTED, 1, "4 3")
    for o in geo["objects"]:
        if o["kind"] == "column": sh.poly([X(p) for p in footprint(o)], fill=INK, stroke=INK, width=0.6)
    # labels
    for sp in geo["spaces"]:
        c = X(G.centroid([tuple(p) for p in sp["ring"]]))
        sh.text(c[0], c[1] - 6, sp["label"].upper(), 22, INK, "middle", True)
        sub = f"{sp['area']:.1f} m²" if not rcp else f"FC +{int(levels['ceiling_mm'])} (to confirm)"
        sh.text(c[0], c[1] + 20, sub, 17, MUTED, "middle")
    if not rcp:
        for r in geo["runs"]:
            m = ((r["a"][0] + r["b"][0]) / 2, (r["a"][1] + r["b"][1]) / 2); inw = r["frame"]["inward"]
            c = X(G.add(m, G.mul(inw, 0.8))); rr = 19
            tip = X(G.add(m, G.mul(inw, 0.8 - 0.5)))
            sh.poly([tip, (c[0] + inw[1] * rr * 0.9, c[1] - inw[0] * rr * 0.9), (c[0] - inw[1] * rr * 0.9, c[1] + inw[0] * rr * 0.9)], fill=INK, stroke=INK, width=1)
            sh.circle(c, rr, fill="#FFFFFF", stroke=INK, width=1.4)
            sh.text(c[0], c[1] + 6.5, r["letter"], 18, INK, "middle", True)
    _scale_bar(sh, pad + 8, H - 28, s)
    return sh, X

def _dim_chain(sh, X, ticks, y, label=True, size=15):
    for t0, t1 in zip(ticks, ticks[1:]):
        if t1 - t0 < 0.05: continue
        a, b = X(t0, 0), X(t1, 0)
        sh.line((a[0], y), (b[0], y), INK, 0.8)
        if label: sh.text((a[0] + b[0]) / 2, y - 6, f"{round((t1 - t0) * 1000)}", size, INK, "middle")
    for t in ticks:
        p = X(t, 0); sh.line((p[0] - 4, y + 4), (p[0] + 4, y - 4), INK, 1.2); sh.line((p[0], y - 7), (p[0], y + 7), FAINT, 0.8)

def elevation_sheet(geo, run, levels, scale):
    top = run.get("height") or levels["soffit_mm"] / 1000
    pl, pt = 100, 60; L = run["length"]
    W = pl + L * scale + 190; H = pt + top * scale + 120
    X = ElevXf(run["frame"], top, scale, pl, pt); sh = Sheet(W, H)
    walls = {w["id"]: w for w in geo["walls"]}
    t = lambda p: X.t(p)
    # wall face
    a, b = X(0, top), X(L, 0); sh.rect(a[0], a[1], b[0], b[1], fill="#F6F6F4", stroke=INK, width=1.6)
    ticks = {0.0, round(L, 4)}
    for wid in run["walls"]:
        w = walls[wid]; t0, t1 = sorted((t(w["a"]), t(w["b"]))); op = w.get("opening")
        ticks.update((round(max(0, t0), 4), round(min(L, t1), 4)))
        if not op: continue
        if op["kind"] == "window":
            p, q = X(t0, op["lintel"]), X(t1, op["sill"])
            sh.rect(p[0], p[1], q[0], q[1], fill=GLASS, stroke=INK, width=1.4)
            n_p = op["panes"] or max(1, round(op["width"] / 0.6))
            for i in range(1, n_p):
                x = X(t0 + (t1 - t0) * i / n_p, 0)[0]; sh.line((x, p[1]), (x, q[1]), INK, 1.1)
        else:
            p, q = X(t0, op["lintel"]), X(t1, 0)
            sh.rect(p[0], p[1], q[0], q[1], fill="#FFFFFF", stroke=INK, width=1.4)
            if str(op.get("leaves", "")).lower().startswith("double"):
                xm = (p[0] + q[0]) / 2; sh.line((xm, p[1]), (xm, q[1]), INK, 1)
            sh.text((p[0] + q[0]) / 2, p[1] + 20, "DOOR", 14, MUTED, "middle")
    # furniture seen against this wall
    inw = run["frame"]["inward"]; ra, rb = tuple(run["a"]), tuple(run["b"])
    for o in geo["objects"]:
        if o["kind"] in ("column", "rug"): continue
        fp = footprint(o)
        dist = min(G.seg_dist(p, ra, rb) for p in fp)
        side = G.dot(G.sub(tuple(o["at"]), ra), inw)
        if dist > 2.2 or side < 0: continue
        ts = [t(p) for p in fp]; t0, t1 = max(0, min(ts)), min(L, max(ts))
        if t1 - t0 < 0.05: continue
        p, q = X(t0, o["height"]), X(t1, 0)
        sh.rect(p[0], p[1], q[0], q[1], fill=OBJ, stroke=MUTED, width=1, dash="5 3")
        sh.text((p[0] + q[0]) / 2, (p[1] + q[1]) / 2 + 5, o["kind"].replace("-", " "), 14, MUTED, "middle")
    # floor + levels
    f0, f1 = X(-0.3, 0), X(L + 0.3, 0); sh.line(f0, f1, INK, 2.6)
    lv = [(0, "FFL ±0"), (levels["ceiling_mm"] / 1000, f"FC +{int(levels['ceiling_mm'])}"), (top, f"SOFFIT +{int(round(top * 1000))}")]
    if levels.get("partition_mm") and run.get("glazed"): lv.insert(1, (levels["partition_mm"] / 1000, f"HEAD +{int(levels['partition_mm'])}"))
    for z, lab in lv:
        p = X(L, z); sh.line((X(0, z)[0], p[1]), (p[0] + 18, p[1]), MUTED if z else INK, 0.9, None if z in (0, top) else "8 4")
        sh.poly([(p[0] + 22, p[1]), (p[0] + 30, p[1] - 7), (p[0] + 38, p[1])], fill=INK, stroke=INK, width=1)
        sh.text(p[0] + 44, p[1] + 5, lab, 15, INK)
    # dimensions
    tk = sorted(ticks)
    if len(tk) > 2: _dim_chain(sh, X, tk, X(0, 0)[1] + 38)
    _dim_chain(sh, X, [0, L], X(0, 0)[1] + (74 if len(tk) > 2 else 38))
    hx = X(0, 0)[0] - 40; sh.line((hx, X(0, 0)[1]), (hx, X(0, top)[1]), INK, 0.8)
    for z in (0, top): y = X(0, z)[1]; sh.line((hx - 4, y + 4), (hx + 4, y - 4), INK, 1.2)
    sh.text(hx - 10, (X(0, 0)[1] + X(0, top)[1]) / 2, f"{round(top * 1000)}", 15, INK, "middle", rotate=-90)
    sh.text(pl, 30, f"ELEVATION {run['letter']}", 20, INK, "start", True)
    sh.text(pl + 170, 30, f"looking {run['looks']} · {', '.join(s['label'] for s in geo['spaces'] if s['id'] in run['spaces'])}", 16, MUTED)
    return sh, X

def build(geo, levels, out_dir):
    os.makedirs(out_dir, exist_ok=True); sheets = []
    for kind in ("plan", "rcp"):
        sh, X = plan_sheet(geo, levels, kind)
        base = os.path.join(out_dir, kind)
        open(base + ".svg", "w", encoding="utf-8").write(sh.svg()); sh.png(base + ".png")
        sheets.append({"id": kind, "kind": kind, "name": TITLE[kind], "svg": f"{kind}.svg", "png": f"{kind}.png", "w": sh.w, "h": sh.h, "xf": X.meta()})
    longest = max([r["length"] for r in geo["runs"]] or [1])
    scale = min(140, 1700 / longest)              # one scale for every elevation so they compare at a glance
    for r in geo["runs"]:
        sh, X = elevation_sheet(geo, r, levels, scale)
        sid = f"elev-{r['letter']}"; base = os.path.join(out_dir, sid)
        open(base + ".svg", "w", encoding="utf-8").write(sh.svg()); sh.png(base + ".png")
        sheets.append({"id": sid, "kind": "elevation", "name": f"Elevation {r['letter']} · {r['looks']}", "run": r["id"], "letter": r["letter"],
                       "svg": f"{sid}.svg", "png": f"{sid}.png", "w": sh.w, "h": sh.h, "xf": X.meta(), "length": r["length"]})
    return sheets

# ----- metre -> normalised sheet coordinates (used by the schedule) -----
def to_norm(sheet, pts_m=None, tz=None):
    xf = sheet["xf"]
    if xf["type"] == "plan":
        return [[round((xf["pad"] + (p[0] - xf["x0"]) * xf["s"]) / sheet["w"], 4), round((xf["pad"] + (p[1] - xf["y0"]) * xf["s"]) / sheet["h"], 4)] for p in pts_m]
    return [[round((xf["pad_l"] + t * xf["s"]) / sheet["w"], 4), round((xf["pad_t"] + (xf["top"] - z) * xf["s"]) / sheet["h"], 4)] for t, z in tz]
