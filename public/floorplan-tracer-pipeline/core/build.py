"""Layout (tracer-layout/1) → plan model (tracer-plan/1). Deterministic; returns (plan, findings).

Rules carried from the Floorplan Tracer / Scribble skills:
  * one node per exact position; the first run of a line starts and the last run ends ON the nearest
    perpendicular centreline within the snap tolerance, so every junction shares a node (no stubs past a
    90° bend: both walls end on the shared centreline node, the mitre fills the corner);
  * wall pieces are split at every node lying strictly inside them (T-junctions, ring corners);
  * openings are pre-cut gap pieces; a junction inside an opening piece is a finding;
  * space rings snap to the centrelines; their face-to-face (clear) size subtracts the half-thickness of
    the thickest band collinear with each edge — the printed room size is compared with that.
"""
import math
from shapely.geometry import Polygon, LineString, box as sbox
from shapely.ops import unary_union
from . import model as M, units as U
from .layout import Frame

R = 4                       # metres, 0.1 mm
def rp(p): return [round(p[0], R), round(p[1], R)]

WET = ("TOILET", "BATH", "WC", "WASH")
OPEN = ("BALCONY", "VERANDAH", "VERANDA", "DECK", "SIT OUT", "SIT-OUT", "PORCH", "TERRACE")
AREA = ("DUCT", "SHAFT", "NICHE", "OTS", "LIFT")

def space_type(name, given=None):
    if given: return given
    n = name.upper()
    if any(k in n for k in WET): return "toilet"
    if any(k in n for k in OPEN): return "balcony"
    if any(k in n for k in AREA): return "area"
    return "room"

def build(layout, standards, source=None):
    fnd = []
    plan = M.empty_plan(source or {"kind": "layout"})
    grid = layout.get("grid", {"x": {}, "y": {}})
    conv = standards.get("conventions", {})
    for li, lv in enumerate(layout["levels"]):
        fr = Frame(lv.get("frame") or layout.get("frame"), grid)
        tol = fr.tol(lv.get("snap", layout.get("snap")))
        L = M.empty_level(lv.get("id", f"L{li}"), lv.get("name", f"Level {li}"), float(lv.get("elevation", 0)), float(lv.get("height", conv.get("floor_to_floor_m", 3.0))))
        wall_h = float(lv.get("wall_h", conv.get("wall_height_m", L["height"])))
        seq = {"n": 0}
        def nid(p):
            seq["n"] += 1; return f"{L['id']}-{p}{seq['n']}"
        lines = lv.get("lines", [])
        Vc = [fr.val(l[1], "x") for l in lines if l[0] == "V"]; Hc = [fr.val(l[1], "y") for l in lines if l[0] == "H"]
        def snap(v, cs):
            best, d = v, tol
            for c in cs:
                if abs(c - v) < d: d, best = abs(c - v), c
            return best
        nodes = {}
        def N(xf, yf):
            p = rp((fr.X(xf), fr.Y(yf))); k = (p[0], p[1]); nodes.setdefault(k, p); return p
        pieces = []
        for ln in lines:
            o, c_raw, t_raw, runs = ln[0], ln[1], ln[2], ln[3]
            c = fr.val(c_raw, "y" if o == "H" else "x"); along = "x" if o == "H" else "y"; perp = Vc if o == "H" else Hc
            for i, run in enumerate(runs):
                kind, s_raw, e_raw = run[0], run[1], run[2]; opt = run[3] if len(run) > 3 else {}
                s, e = fr.val(s_raw, along), fr.val(e_raw, along)
                if s > e: s, e = e, s
                if i == 0: s = snap(s, perp)
                if i == len(runs) - 1: e = snap(e, perp)
                t = fr.val(opt["t"], along) if "t" in opt else fr.val(t_raw, along)
                a = N(s, c) if o == "H" else N(c, s); b = N(e, c) if o == "H" else N(c, e)
                pieces.append(dict(o=o, kind=kind, a=a, b=b, t=round(fr.L(t), 4), opt=opt))
        for sp in lv.get("spaces", []):
            for x, y in _ring(sp[1], fr): N(snap(x, Vc), snap(y, Hc))
        allnodes = list(nodes.values())
        def inside(p):
            a, b = p["a"], p["b"]; out = []
            for n in allnodes:
                if p["o"] == "H" and abs(n[1] - a[1]) < 1e-4 and min(a[0], b[0]) + 1e-4 < n[0] < max(a[0], b[0]) - 1e-4: out.append(n)
                if p["o"] == "V" and abs(n[0] - a[0]) < 1e-4 and min(a[1], b[1]) + 1e-4 < n[1] < max(a[1], b[1]) - 1e-4: out.append(n)
            return sorted(out, key=lambda n: math.dist(n, a))
        for p in pieces:
            k, opt = p["kind"], p["opt"]; src = opt.get("src", lv.get("src", layout.get("src", "measured")))
            if k == "l":
                L["walls"].append(dict(id=nid("w"), a=p["a"], b=p["b"], t=p["t"], h=0.0, kind="line", layer=opt.get("layer", "ledge"), label=opt.get("label", ""), src=src)); continue
            if k in ("w", "r", "k"):
                kind = {"w": "wall", "r": "parapet", "k": "kerb"}[k]
                h = float(opt.get("h", wall_h if k == "w" else (1.0 if k == "r" else 0.6)))
                chain = [p["a"]] + inside(p) + [p["b"]]
                for a, b in zip(chain, chain[1:]):
                    L["walls"].append(dict(id=nid("w"), a=a, b=b, t=p["t"], h=h, kind=kind, label=opt.get("label", ""), src=src))
            else:
                mids = inside(p)
                if mids: fnd.append(M.F("warn", "opening_split", opt.get("label", k), f"{len(mids)} junction node(s) inside an opening piece on {p['o']} line — split the run or move the jamb"))
                kind = {"d": "door", "win": "window", "g": "sliding", "o": "opening", "gate": "gate"}.get(k)
                if not kind: fnd.append(M.F("fail", "layout", k, f"unknown run kind {k!r}")); continue
                w = math.dist(p["a"], p["b"])
                lab = opt.get("label", "")
                sill = opt.get("sill")
                if sill is None and kind == "window":
                    sill = conv.get("toilet_window_sill_m", 1.5) if any(x in lab.upper() for x in ("TOILET", "VENT", "BATH")) else conv.get("window_sill_m", 0.9)
                    src_s = "convention"
                else: src_s = src
                hinge = swing = None
                if kind == "door":
                    hinge = "a" if opt.get("hinge", "s") == "s" else "b"
                    sw = opt.get("swing", "+"); perp_frame = (0.0, fr.plus_y_world()) if p["o"] == "H" else (1.0, 0.0)
                    dirv = (perp_frame[0] * (1 if sw == "+" else -1), perp_frame[1] * (1 if sw == "+" else -1))
                    ln_ = M.left_normal(p["a"], p["b"]); swing = "L" if dirv[0] * ln_[0] + dirv[1] * ln_[1] > 0 else "R"
                L["openings"].append(dict(id=nid("o"), a=p["a"], b=p["b"], t=p["t"], kind=kind, width=round(w, 4),
                                          sill=float(sill) if sill is not None else (0.0 if kind in ("door", "sliding", "opening", "gate") else None),
                                          head=float(opt.get("head", conv.get("door_head_m", 2.1))), hinge=hinge, swing=swing,
                                          leaves=int(opt.get("leaves", 2 if (kind == "door" and w >= conv.get("double_leaf_min_m", 1.2)) else 1)),
                                          panes=int(opt.get("panes", 2 if kind in ("window", "sliding") else 1)), label=lab, src=src, sill_src=src_s))
        bands = [(x["a"], x["b"], x["t"]) for x in L["walls"]] + [(x["a"], x["b"], x["t"]) for x in L["openings"]]
        band_u = unary_union([LineString([a, b]).buffer(t / 2, cap_style=2) for a, b, t in bands if t > 0] + [Polygon()])
        for sp in lv.get("spaces", []):
            name = sp[0]; opt = sp[2] if len(sp) > 2 else {}
            ring = [rp((fr.X(snap(x, Vc)), fr.Y(snap(y, Hc)))) for x, y in _ring(sp[1], fr)]
            poly = Polygon(ring)
            if not poly.is_valid: fnd.append(M.F("fail", "space", name, "ring is not a valid polygon")); continue
            clear, edges_nb = _clear(ring, bands)
            net = poly.difference(band_u)
            rec = dict(id=nid("sp"), name=name, type=space_type(name, opt.get("type")), ring=ring, area=round(poly.area, 4),
                       net_area=round(net.area, 4), clear=clear, printed=None, src=opt.get("src", lv.get("src", layout.get("src", "measured"))))
            if opt.get("printed"):
                pw, ph = U.parse_size(opt["printed"]); rec["printed"] = [round(pw, 4), round(ph, 4)]
            if edges_nb: rec["edges_without_band"] = edges_nb
            L["spaces"].append(rec)
        for c in lv.get("columns", []):
            o = c[4] if len(c) > 4 else {}
            L["columns"].append(dict(id=nid("c"), c=rp((fr.X(fr.val(c[0], "x")), fr.Y(fr.val(c[1], "y")))), size=[round(fr.L(fr.val(c[2], "x")), 4), round(fr.L(fr.val(c[3], "y")), 4)],
                                     rot=float(o.get("rot", 0)), src=o.get("src", "measured")))
        for st in lv.get("stairs", []):
            L["stairs"].append(_stair(st, fr, conv, L["height"], nid("st")))
        for fx in lv.get("fixtures", []):
            kind, cx, cy, across, along, back = fx[:6]; o = fx[6] if len(fx) > 6 else {}
            c = rp((fr.X(fr.val(cx, "x")), fr.Y(fr.val(cy, "y"))))
            rot = {"S": 0, "E": 90, "N": 180, "W": 270}.get(back, float(o.get("rot", 0)))
            room = next((s["name"] for s in L["spaces"] if Polygon(s["ring"]).contains(_pt(c))), None)
            L["fixtures"].append(dict(id=nid("f"), kind=kind, c=c, size=[round(fr.L(float(across)), 4), round(fr.L(float(along)), 4)], back=back, rot=rot,
                                      room=room, label=o.get("label", ""), src=o.get("src", "measured")))
        L["not_placed"] = [{"kind": k, "why": w} for k, w in lv.get("not_placed", [])]
        L["nodes"] = len(nodes)
        plan["levels"].append(L)
    return plan, fnd

def _pt(c):
    from shapely.geometry import Point
    return Point(c)

def _ring(r, fr):
    if len(r) == 4 and not isinstance(r[0], (list, tuple)):
        x0, y0, x1, y1 = fr.val(r[0], "x"), fr.val(r[1], "y"), fr.val(r[2], "x"), fr.val(r[3], "y")
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    return [(fr.val(x, "x"), fr.val(y, "y")) for x, y in r]

def _clear(ring, bands):
    """Face-to-face size of an axis-aligned rectangular ring + edges that found no band under them."""
    xs = sorted({p[0] for p in ring}); ys = sorted({p[1] for p in ring})
    nb = []
    def half(edge_a, edge_b):
        horiz = abs(edge_a[1] - edge_b[1]) < 1e-6; best = None
        for a, b, t in bands:
            if horiz and abs(a[1] - b[1]) < 1e-6 and abs(a[1] - edge_a[1]) < 1e-4:
                lo, hi = sorted((a[0], b[0])); m = (lo + hi) / 2
                if min(edge_a[0], edge_b[0]) - 1e-4 <= m <= max(edge_a[0], edge_b[0]) + 1e-4 or (lo < max(edge_a[0], edge_b[0]) and hi > min(edge_a[0], edge_b[0])):
                    best = max(best or 0, t / 2)
            if not horiz and abs(a[0] - b[0]) < 1e-6 and abs(a[0] - edge_a[0]) < 1e-4:
                lo, hi = sorted((a[1], b[1])); m = (lo + hi) / 2
                if min(edge_a[1], edge_b[1]) - 1e-4 <= m <= max(edge_a[1], edge_b[1]) + 1e-4 or (lo < max(edge_a[1], edge_b[1]) and hi > min(edge_a[1], edge_b[1])):
                    best = max(best or 0, t / 2)
        if best is None: nb.append([rp(edge_a), rp(edge_b)])
        return best or 0.0
    if len(xs) != 2 or len(ys) != 2: return None, []
    x0, x1 = xs; y0, y1 = ys
    w = (x1 - x0) - half((x0, y0), (x0, y1)) - half((x1, y0), (x1, y1))
    h = (y1 - y0) - half((x0, y0), (x1, y0)) - half((x0, y1), (x1, y1))
    return [round(w, 4), round(h, 4)], nb

def _stair(st, fr, conv, f2f, sid):
    x0, y0, x1, y1 = (fr.val(st["bay"][0], "x"), fr.val(st["bay"][1], "y"), fr.val(st["bay"][2], "x"), fr.val(st["bay"][3], "y"))
    X0, X1 = sorted((fr.X(x0), fr.X(x1))); Y0, Y1 = sorted((fr.Y(y0), fr.Y(y1)))
    risers = int(st.get("risers") or round(f2f / conv.get("riser_target_m", 0.170)))
    tread = float(st.get("tread", conv.get("tread_m", 0.25))); fw = float(st.get("flight_w", 1.0)); mid = float(st.get("mid", 0.12))
    landing = float(st.get("landing", fw)); cfg = st.get("config", "dogleg"); toe = st.get("toe", "S")
    if cfg == "dogleg":
        per = math.ceil(risers / 2); run = per * tread + landing; width = 2 * fw + mid      # Scribble skill: flightSteps × tread + landing
    else:
        run = (risers - 1) * tread; width = fw
    vertical = toe in ("N", "S")
    fx, fy = (width, run) if vertical else (run, width)
    cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
    if toe == "S": cy = Y0 + fy / 2
    if toe == "N": cy = Y1 - fy / 2
    if toe == "W": cx = X0 + fx / 2
    if toe == "E": cx = X1 - fx / 2
    fp = [round(cx - fx / 2, 4), round(cy - fy / 2, 4), round(cx + fx / 2, 4), round(cy + fy / 2, 4)]
    return dict(id=sid, bay=[round(X0, 4), round(Y0, 4), round(X1, 4), round(Y1, 4)], footprint=fp, risers=risers, riser=round(f2f / risers, 4),
                tread=tread, flight_w=fw, mid=mid, landing=landing, config=cfg, toe=toe, first_flight=st.get("first_flight", "W" if vertical else "S"),
                src=st.get("src", "derived"))
