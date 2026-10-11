"""VILLA_4BHK_G1 0.1.0 — premium 4BHK G+1 villa for 30' x 40' class plots.

Drawing frame (feet): road at the top, x across the frontage from the left plot edge, y into the plot from the road.
Building origin (x0, y0) = (left setback, front setback); buildable bw x bd.
Bands (depth): front f (porch + living), middle m (stair + dining hub + common toilet), rear r.
The dining hub gives every ground-floor room a door; the first-floor lounge (A) or gallery (B) does the same upstairs.
Functions receive the loaded Typology `T` (objects: stair = STAIR_DOGLEG, door = DOOR_HINGED).
"""
import math, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.units import fmt as f, FT_MM, SQFT_M2
from core.svg import Svg
from core.stage import F

HABITABLE = {"living", "bedroom", "master", "lounge", "dining"}
BEDROOMS = {"bedroom", "master"}
NAMES = {"PORCH": "Car porch", "LIV": "Living", "PUJA": "Puja", "STAIR": "Staircase", "DIN": "Dining", "TC": "Common toilet", "BED4": "Bedroom 4 (guest / parents)",
         "T4": "Toilet 4", "KIT": "Kitchen", "BED2": "Bedroom 2", "T2": "Toilet 2", "BED3": "Bedroom 3", "T3": "Toilet 3", "LNG": "Family lounge", "LOB": "Gallery",
         "MBR": "Master bedroom", "MDR": "Master dress", "MT": "Master toilet", "OTS": "Open to sky (double height)", "BAL": "Balcony"}

# ------------------------------------------------------------------ geometry helpers
def rect(x1, y1, x2, y2):
    return [(x1, y1), (x2, y1), (x2, y2), (x1, y2)]

def notch(x1, y1, x2, y2, corner, s):
    """Rectangle minus an s x s square at corner 'tl' / 'tr' / 'bl' / 'br' (t = toward the road)."""
    if s <= 0: return rect(x1, y1, x2, y2)
    return {"tl": [(x1 + s, y1), (x2, y1), (x2, y2), (x1, y2), (x1, y1 + s), (x1 + s, y1 + s)],
            "tr": [(x1, y1), (x2 - s, y1), (x2 - s, y1 + s), (x2, y1 + s), (x2, y2), (x1, y2)],
            "bl": [(x1, y1), (x2, y1), (x2, y2), (x1 + s, y2), (x1 + s, y2 - s), (x1, y2 - s)],
            "br": [(x1, y1), (x2, y1), (x2, y2 - s), (x2 - s, y2 - s), (x2 - s, y2), (x1, y2)]}[corner]

def area(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2

def bbox(p):
    xs, ys = [q[0] for q in p], [q[1] for q in p]
    return min(xs), min(ys), max(xs), max(ys)

def centroid(p):
    x1, y1, x2, y2 = bbox(p); return ((x1 + x2) / 2, (y1 + y2) / 2)

def inside(pt, poly):
    x, y = pt; c = False
    for i in range(len(poly)):
        (x1, y1), (x2, y2) = poly[i], poly[(i + 1) % len(poly)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def shared(pa, pb, tol=1e-6):
    """Longest common collinear segment of two orthogonal polygons -> (a, b) or None."""
    best = None
    for i in range(len(pa)):
        a1, a2 = pa[i], pa[(i + 1) % len(pa)]
        for j in range(len(pb)):
            b1, b2 = pb[j], pb[(j + 1) % len(pb)]
            if abs(a1[1] - a2[1]) < tol and abs(b1[1] - b2[1]) < tol and abs(a1[1] - b1[1]) < tol:
                lo, hi = max(min(a1[0], a2[0]), min(b1[0], b2[0])), min(max(a1[0], a2[0]), max(b1[0], b2[0]))
                if hi - lo > tol and (best is None or hi - lo > best[2]): best = ((lo, a1[1]), (hi, a1[1]), hi - lo)
            if abs(a1[0] - a2[0]) < tol and abs(b1[0] - b2[0]) < tol and abs(a1[0] - b1[0]) < tol:
                lo, hi = max(min(a1[1], a2[1]), min(b1[1], b2[1])), min(max(a1[1], a2[1]), max(b1[1], b2[1]))
                if hi - lo > tol and (best is None or hi - lo > best[2]): best = ((a1[0], lo), (a1[0], hi), hi - lo)
    return best

def label_point(poly):
    """Inside point farthest from the outline (coarse grid), for room labels."""
    x1, y1, x2, y2 = bbox(poly); best = ((x1 + x2) / 2, (y1 + y2) / 2, -1)
    def dseg(px, py, a, b):
        ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
        t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) if L2 else 0
        return math.hypot(px - ax - t * dx, py - ay - t * dy)
    for i in range(1, 12):
        for j in range(1, 12):
            px, py = x1 + (x2 - x1) * i / 12, y1 + (y2 - y1) * j / 12
            if not inside((px, py), poly): continue
            d = min(dseg(px, py, poly[k], poly[(k + 1) % len(poly)]) for k in range(len(poly)))
            d -= 0.05 * math.hypot(px - (x1 + x2) / 2, py - (y1 + y2) / 2)
            if d > best[2]: best = (px, py, d)
    return best[0], best[1]

def inset(poly, d):
    """Orthogonal polygon offset inward by d."""
    s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    sgn = 1 if s > 0 else -1; n = len(poly); out = []
    for i in range(n):
        p0, p1, p2 = poly[i - 1], poly[i], poly[(i + 1) % n]
        def nrm(a, b):
            dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1
            return (-dy / L * sgn, dx / L * sgn)
        n1, n2 = nrm(p0, p1), nrm(p1, p2)
        out.append((p1[0] + d * (n1[0] + n2[0]), p1[1] + d * (n1[1] + n2[1])))
    return out

# compass: drawing frame unit vectors -> (east, north) components
AXES = {"N": ((1, 0), (0, -1)), "E": ((0, -1), (-1, 0)), "S": ((-1, 0), (0, 1)), "W": ((0, 1), (1, 0))}   # (x->(e,n), y->(e,n))

def to_compass(road, dx, dy):
    (xe, xn), (ye, yn) = AXES[road]
    return dx * xe + dy * ye, dx * xn + dy * yn

def zone(road, dx, dy, half_w, half_d):
    e, n = to_compass(road, dx / half_w, dy / half_d)
    if math.hypot(e, n) < 0.3: return "C"
    a = (math.degrees(math.atan2(n, e)) + 360) % 360
    return ["E", "NE", "N", "NW", "W", "SW", "S", "SE"][int(((a + 22.5) % 360) // 45)]

VASTU = {"kitchen": ({"SE"}, {"NW"}, {"NE", "SW", "C"}), "master": ({"SW"}, {"S", "W"}, {"NE", "SE"}), "puja": ({"NE"}, {"E", "N"}, {"S", "SW", "SE"}),
         "living": ({"N", "E", "NE"}, {"NW"}, {"SW"}), "stair": ({"S", "W", "SW"}, {"SE", "NW"}, {"NE", "C"}), "toilet": ({"NW", "W"}, {"S", "SE", "E"}, {"NE", "SW", "C"}),
         "entrance": ({"N", "E", "NE"}, {"NW", "SE"}, {"SW", "S"})}

# ------------------------------------------------------------------ layout
def _layout(p, T, mirror):
    so, do = T.objects["stair"].mod, T.objects["door"].mod
    PW, PD = p["plot_width_ft"], p["plot_depth_ft"]
    x0, y0 = p["setback_left_ft"], p["setback_front_ft"]
    bw, bd = PW - x0 - p["setback_right_ft"], PD - y0 - p["setback_rear_ft"]
    sp = {k: p[k] for k in ("floor_height_ft", "max_riser_in", "tread_in", "flight_width_ft")}
    sp.update(gap_ft=1 / 3, direction=p["stair_first_flight"], turn=p["stair_turn"])
    if mirror: sp["direction"] = {"E": "W", "W": "E"}.get(sp["direction"], sp["direction"])
    sc = so.compute(sp)
    SL, SW = (sc["wX"], sc["hY"])
    fb = p["front_band_ft"]; m = max(p["middle_band_ft"], SW); r = bd - fb - m
    pw, tw, at = p["porch_width_ft"], p["toilet_width_ft"], p["attached_toilet_ft"]
    dw = bw - SL - tw; warn = []
    if dw < 8: warn.append(f"Dining hub is only {f(dw)} wide (stair {f(SL)} + toilet {f(tw)} on a {f(bw)} footprint).")
    if r < 8.5: warn.append(f"Rear band is only {f(r)} deep; bedrooms there will be cramped.")
    xs_lo, xs_hi = SL + 3.5, SL + dw - 3.5
    xs = min(max(bw - p["kitchen_width_ft"], xs_lo), xs_hi)
    if abs((bw - xs) - p["kitchen_width_ft"]) > 0.01: warn.append(f"Kitchen set to {f(bw - xs)} (target {f(p['kitchen_width_ft'])}) so bedroom 4 and the kitchen both keep a door to the dining.")
    sf = SL + 3.5 if p["option"] == "A" else SL + 4
    Y = [fb, fb + m, bd]
    rooms, conns = {"GF": {}, "FF": {}}, []
    def R(level, code, kind, poly): rooms[level][code] = {"code": code, "name": NAMES[code], "kind": kind, "level": level, "poly": poly}
    # ---- ground floor
    R("GF", "PORCH", "porch", rect(0, 0, pw, fb))
    R("GF", "LIV", "living", rect(pw, 0, bw, fb))
    R("GF", "STAIR", "stair", rect(0, fb, SL, fb + m))
    R("GF", "DIN", "dining", rect(SL, fb, SL + dw, fb + m))
    R("GF", "TC", "toilet", rect(SL + dw, fb, bw, fb + m))
    def zone_at(x, y):
        return zone(p["road_side"], ((bw - x) if mirror else x) - bw / 2, y - bd / 2, bw / 2, bd / 2)
    good, okz, bad = VASTU["toilet"]
    rank = lambda z: 2 if z in good else 1 if z in okz else -2 if z in bad else 0
    t4c = max(("bl", "br"), key=lambda c: rank(zone_at(at / 2 if c == "bl" else xs - at / 2, bd - at / 2)))
    R("GF", "BED4", "bedroom", notch(0, fb + m, xs, bd, t4c, at))
    R("GF", "T4", "toilet", rect(0, bd - at, at, bd) if t4c == "bl" else rect(xs - at, bd - at, xs, bd))
    R("GF", "KIT", "kitchen", rect(xs, fb + m, bw, bd))
    conns += [("GF", "DIN", "LIV", "opening", 0), ("GF", "DIN", "TC", "door", 2.5), ("GF", "DIN", "BED4", "door", 3), ("GF", "BED4", "T4", "door", 2.5),
              ("GF", "DIN", "KIT", "door", 3), ("GF", "DIN", "STAIR", "opening", 0), ("GF", "LIV", "PORCH", "door", 3)]
    # ---- first floor
    R("FF", "STAIR", "stair", rect(0, fb, SL, fb + m))
    R("FF", "BED2", "bedroom", notch(0, 0, sf, fb, "bl", at)); R("FF", "T2", "toilet", rect(0, fb - at, at, fb))
    bal = p["balcony_depth_ft"]
    if bal > 0: R("FF", "BAL", "balcony", rect(0, -bal, bw, 0))
    if p["option"] == "A":
        R("FF", "BED3", "bedroom", notch(sf, 0, bw, fb, "br", at)); R("FF", "T3", "toilet", rect(bw - at, fb - at, bw, fb))
        R("FF", "LNG", "lounge", rect(SL, fb, bw, fb + m))
        mw = min(max(p["master_width_ft"], SL + 3.5), bw - 7)
        mtd = min(max(r / 2, 30.2 / max(bw - mw, 0.1)), r - 2.5)
        R("FF", "MBR", "master", rect(0, fb + m, mw, bd)); R("FF", "MDR", "dress", rect(mw, fb + m, bw, bd - mtd)); R("FF", "MT", "toilet", rect(mw, bd - mtd, bw, bd))
        conns += [("FF", "STAIR", "LNG", "opening", 0), ("FF", "LNG", "BED2", "door", 3), ("FF", "LNG", "BED3", "door", 3), ("FF", "BED2", "T2", "door", 2.5),
                  ("FF", "BED3", "T3", "door", 2.5), ("FF", "LNG", "MBR", "door", 3), ("FF", "MBR", "MDR", "opening", 0), ("FF", "MBR", "MT", "door", 2.5)]
        if bal > 0: conns.append(("FF", "BED3", "BAL", "door", 3))
    else:
        R("FF", "OTS", "void", rect(sf, 0, bw, fb))
        R("FF", "LOB", "lounge", rect(SL, fb, SL + 4, fb + m))
        R("FF", "BED3", "bedroom", rect(SL + 4, fb, bw, fb + m))
        mw = min(max(bw - at - 5.5, SL + 3.5), bw - at - 4)
        sx2 = min(mw + 5.5, bw - at); mtd = min(max(r / 2, 30.2 / max(sx2 - mw, 0.1)), r - 2.5)
        R("FF", "MBR", "master", rect(0, fb + m, mw, bd)); R("FF", "MDR", "dress", rect(mw, fb + m, sx2, bd - mtd))
        R("FF", "MT", "toilet", rect(mw, bd - mtd, sx2, bd)); R("FF", "T3", "toilet", rect(sx2, fb + m, bw, bd))
        conns += [("FF", "STAIR", "LOB", "opening", 0), ("FF", "LOB", "BED2", "door", 3), ("FF", "LOB", "BED3", "door", 3), ("FF", "BED2", "T2", "door", 2.5),
                  ("FF", "BED3", "T3", "door", 2.5), ("FF", "LOB", "MBR", "door", 3), ("FF", "MBR", "MDR", "opening", 0), ("FF", "MBR", "MT", "door", 2.5)]
        if bal > 0: conns.append(("FF", "BED2", "BAL", "door", 3))
    # ---- puja niche in the living corner nearest north-east (in the unmirrored drawing frame, then mirrored)
    pj = p["puja_ft"]; liv = rooms["GF"]["LIV"]
    if pj > 0:
        x1, y1, x2, y2 = bbox(liv["poly"]); best = None
        for cn, (cx, cy) in {"tl": (x1, y1), "tr": (x2, y2 - (y2 - y1)), "bl": (x1, y2), "br": (x2, y2)}.items():
            if cn in ("tl", "bl") and abs(x1 - pw) < 1e-6: continue          # never against the porch wall
            ex = (bw - (cx - 0) if mirror else cx)                               # corner x after mirroring
            e, n = to_compass(p["road_side"], (ex - bw / 2), (cy - bd / 2))
            sc_ = e + n
            if best is None or sc_ > best[0]: best = (sc_, cn)
        cn = best[1]
        liv["poly"] = notch(x1, y1, x2, y2, cn, pj)
        qx = x1 if cn in ("tl", "bl") else x2 - pj; qy = y1 if cn in ("tl", "tr") else y2 - pj
        R("GF", "PUJA", "puja", rect(qx, qy, qx + pj, qy + pj)); conns.append(("GF", "LIV", "PUJA", "opening", 0))
    # ---- main door on the living front wall, clear of the puja niche
    lx1, _, lx2, _ = bbox(liv["poly"])
    a, b = lx1, lx2
    if pj > 0 and rooms["GF"]["PUJA"]["poly"][0][1] == 0:
        if rooms["GF"]["PUJA"]["poly"][0][0] > lx1 + 1e-6: b = rooms["GF"]["PUJA"]["poly"][0][0]
        else: a = rooms["GF"]["PUJA"]["poly"][1][0]
    md = do.place({"width_ft": p["main_door_width_ft"], "position_pct": p["main_door_pct"], "margin_ft": 0.5}, (a, 0), (b, 0))
    # ---- mirror + move into plot coordinates
    def tx(pt):
        x, y = pt
        return ((bw - x) if mirror else x) + x0, y + y0
    for lv in rooms.values():
        for rm in lv.values():
            rm["poly"] = [tx(q) for q in rm["poly"]]
            if mirror: rm["poly"] = rm["poly"][::-1]
    md = {"a": list(tx(md["a"])), "b": list(tx(md["b"])), "width_ft": md["width_ft"]}
    if mirror: md["a"], md["b"] = sorted([md["a"], md["b"]])
    st = so.place(sc, (bw - SL if mirror else 0) + x0, fb + y0)
    return dict(PW=PW, PD=PD, x0=x0, y0=y0, bw=bw, bd=bd, fb=fb, m=m, r=r, SL=SL, SW=SW, dw=dw, xs=xs, sf=sf, rooms=rooms, conns=conns,
                main_door=md, stair=st, warn=warn)

def _doors(L):
    out = []
    for lv, a, b, kind, w in L["conns"]:
        ra, rb = L["rooms"][lv].get(a), L["rooms"][lv].get(b)
        if not ra or not rb: continue
        seg = shared(ra["poly"], rb["poly"])
        if not seg: out.append({"level": lv, "from": a, "to": b, "kind": kind, "missing": True}); continue
        (p1, p2, ln) = seg
        if kind == "opening":
            out.append({"level": lv, "from": a, "to": b, "kind": kind, "a": list(p1), "b": list(p2), "width_ft": ln}); continue
        w = min(w, ln - 0.5)
        if w < 2: out.append({"level": lv, "from": a, "to": b, "kind": kind, "missing": True, "why": f"shared wall only {f(ln)}"}); continue
        mx, my = (p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2
        if abs(p1[1] - p2[1]) < 1e-6: da, db = (mx - w / 2, my), (mx + w / 2, my)
        else: da, db = (mx, my - w / 2), (mx, my + w / 2)
        out.append({"level": lv, "from": a, "to": b, "kind": "door", "a": list(da), "b": list(db), "width_ft": w})
    return out

def _vastu(L, road, rooms):
    cx, cy = L["x0"] + L["bw"] / 2, L["y0"] + L["bd"] / 2; hw, hd = L["bw"] / 2, L["bd"] / 2; out = []; score = 0
    def judge(what, ref, pt):
        nonlocal score
        z = zone(road, pt[0] - cx, pt[1] - cy, hw, hd); good, ok, bad = VASTU[what]
        v = 2 if z in good else 1 if z in ok else -2 if z in bad else 0; score += v
        out.append({"item": what, "ref": ref, "zone": z, "verdict": {2: "good", 1: "acceptable", 0: "neutral", -2: "avoid"}[v]})
    for lv, code, what in [("GF", "KIT", "kitchen"), ("FF", "MBR", "master"), ("GF", "PUJA", "puja"), ("GF", "LIV", "living"), ("GF", "STAIR", "stair")]:
        if code in rooms[lv]: judge(what, f"{lv}-{code}", centroid(rooms[lv][code]["poly"]))
    for lv in rooms:
        for code, rm in rooms[lv].items():
            if rm["kind"] == "toilet": judge("toilet", f"{lv}-{code}", centroid(rm["poly"]))
    md = L["main_door"]; judge("entrance", "main door", ((md["a"][0] + md["b"][0]) / 2, (md["a"][1] + md["b"][1]) / 2))
    return out, score

def generate(p, T):
    road = p["road_side"]
    cands = [False, True] if p["mirror"] == "auto" else [p["mirror"] == "yes"]
    best = None
    for mi in cands:
        L = _layout(p, T, mi); va, score = _vastu(L, road, L["rooms"])
        if best is None or score > best[2]: best = (L, va, score, mi)
    L, va, score, mi = best
    rooms = L["rooms"]; doors = _doors(L)
    sched = []
    for lv in ("GF", "FF"):
        for code, rm in rooms[lv].items():
            x1, y1, x2, y2 = bbox(rm["poly"]); rm["area_sqft"] = area(rm["poly"])
            rm["w"], rm["h"] = x2 - x1, y2 - y1
            sched.append({"code": f"{lv}-{code}", "name": rm["name"], "level": lv, "kind": rm["kind"], "face": "",
                          "size": f"{f(rm['w'])} x {f(rm['h'])}", "area_sqft": rm["area_sqft"]})
    foot = L["bw"] * L["bd"]; plot = L["PW"] * L["PD"]
    porch = rooms["GF"]["PORCH"]["area_sqft"]; void = sum(r_["area_sqft"] for r_ in rooms["FF"].values() if r_["kind"] == "void")
    balc = sum(r_["area_sqft"] for r_ in rooms["FF"].values() if r_["kind"] == "balcony")
    gf, ff = foot, foot - void
    total = gf + ff; far_area = total - porch
    beds = sum(1 for lv in rooms.values() for r_ in lv.values() if r_["kind"] in BEDROOMS)
    toilets = sum(1 for lv in rooms.values() for r_ in lv.values() if r_["kind"] == "toilet")
    face = {"N": "North", "E": "East", "S": "South", "W": "West"}[road]
    st = L["stair"]; e = T.objects["stair"].mod.entry_point(st)
    st["entryOK"] = inside(e, rooms["GF"]["DIN"]["poly"])
    w2 = [] if st["entryOK"] else ["The first step does not start from the dining hub. Change stair_first_flight / stair_turn."]
    if L["m"] > p["middle_band_ft"] + 1e-6: w2.append(f"Middle band widened to the stair width {f(L['m'])}.")
    res = dict(typology=T.id, version=T.version, lineage=T.lineage, option=p["option"], option_title=T.schema["options"][p["option"]]["title"], params=dict(p),
               objects={s: f"{o.id}@{o.version}" for s, o in T.objects.items()}, mirror=mi, road_side=road, facing=face,
               site=dict(width_ft=L["PW"], depth_ft=L["PD"], area_sqft=plot),
               setbacks=dict(front=p["setback_front_ft"], rear=p["setback_rear_ft"], left=p["setback_left_ft"], right=p["setback_right_ft"]),
               build=dict(x0=L["x0"], y0=L["y0"], bw=L["bw"], bd=L["bd"], front_band=L["fb"], middle_band=L["m"], rear_band=L["r"], dining_w=L["dw"], rear_split=L["xs"]),
               levels=[{"code": "GF", "ffl_ft": 0}, {"code": "FF", "ffl_ft": p["floor_height_ft"]}],
               rooms={lv: list(rooms[lv].values()) for lv in rooms}, doors=doors, main_door=L["main_door"], stair=st,
               areas=dict(footprint=foot, gf=gf, ff=ff, porch=porch, void=void, balcony=balc, far_area=far_area),
               total=total, coverage_pct=foot / plot * 100, far=far_area / plot, bedrooms=beds, toilets=toilets,
               height_ft=2 * p["floor_height_ft"], vastu=va, vastu_score=score, schedule=sched, warn=L["warn"], warn2=w2)
    res["headline"] = f"{beds}BHK, {toilets} toilets; GF {gf:.0f} + FF {ff:.0f} sq ft; FAR {res['far']:.2f}; {face} facing; vastu {score:+d}" + (" (mirrored)" if mi else "")
    res["summary_lines"] = [f"- Plot {f(L['PW'])} x {f(L['PD'])} ({plot:.0f} sq ft), road {road}; setbacks front {f(p['setback_front_ft'])}, rear {f(p['setback_rear_ft'])}, left {f(p['setback_left_ft'])}, right {f(p['setback_right_ft'])}.",
                            f"- Footprint {f(L['bw'])} x {f(L['bd'])} = {foot:.0f} sq ft (coverage {res['coverage_pct']:.1f}%); GF {gf:.0f} + FF {ff:.0f} = {total:.0f} sq ft built-up; FAR area {far_area:.0f} (FAR {res['far']:.2f}).",
                            f"- {beds} bedrooms, {toilets} toilets, car porch {f(rooms['GF']['PORCH']['w'])} x {f(rooms['GF']['PORCH']['h'])}" + (f", double-height living ({void:.0f} sq ft OTS)" if void else ", family lounge upstairs") + (f", front balcony {balc:.0f} sq ft." if balc else "."),
                            f"- Staircase {f(st['SL'])} x {f(st['SW'])}, {st['risers']} risers of {st['rAct']:.2f}\", floor to floor {f(p['floor_height_ft'])}.",
                            f"- Vastu score {score:+d}: " + ", ".join(f"{v['item']} {v['zone']} ({v['verdict']})" for v in va if v["item"] != "toilet") + "."]
    return res

# ------------------------------------------------------------------ drawing
KFILL = {"porch": "#EEF1F4", "living": "#EAF4F8", "dining": "#EAF4F8", "lounge": "#EAF4F8", "bedroom": "#F2EEF8", "master": "#EDE6F7", "kitchen": "#FFF2D2",
         "toilet": "#E3F1E4", "dress": "#F6F1E7", "stair": "#FFFFFF", "puja": "#FCE9D9", "void": "#FFFFFF", "balcony": "#F7F7F7"}

def render_svg(res, title, T):
    so = T.objects["stair"].mod
    PW, PD = res["site"]["width_ft"], res["site"]["depth_ft"]; k = 9.0; pad = 46; gap = 16
    W = 2 * PW + gap; g = Svg(W, PD + 8, scale=k, pad=pad)
    for i, lv in enumerate(("GF", "FF")):
        ox = i * (PW + gap)
        X = lambda x: x + ox
        g.items.append(f'<rect x="{g.X(X(-2))}" y="{g.Y(-5)}" width="{(PW+4)*k}" height="{3.4*k}" fill="#E8EBEE"/>')
        g.text(X(PW / 2), -2.6, f"ROAD ({res['road_side']})", 10, bold=True)
        g.rect(X(0), 0, PW, PD, fill="none", stroke="#8b949c", sw=1.2, extra='stroke-dasharray="6 4"')
        for rm in res["rooms"][lv]:
            pts = " ".join(f"{g.X(X(x))},{g.Y(y)}" for x, y in rm["poly"])
            dash = ' stroke-dasharray="5 3"' if rm["kind"] in ("balcony",) else ""
            g.items.append(f'<polygon points="{pts}" fill="{KFILL.get(rm["kind"], "#fff")}" stroke="#1b1f24" stroke-width="{1.0 if rm["kind"] in ("balcony", "void") else 1.6}"{dash}/>')
            x1, y1, x2, y2 = bbox(rm["poly"])
            if rm["kind"] == "void":
                g.line((X(x1), y1), (X(x2), y2), stroke="#9AA3AB", sw=0.6); g.line((X(x1), y2), (X(x2), y1), stroke="#9AA3AB", sw=0.6)
            cx, cy = label_point(rm["poly"])
            if rm["kind"] == "stair":
                g.text(X((x1 + x2) / 2), y2 - 0.5, "STAIR", 7, color="#4E5A66"); continue
            small = rm["w"] < 6.5 or rm["h"] < 4
            g.text(X(cx), cy - (0 if small else 0.5), rm["name"].split(" (")[0] if not small else rm["code"], 7 if small else 9, bold=not small)
            if not small: g.text(X(cx), cy + 1.1, f"{f(rm['w'])} x {f(rm['h'])}", 7, color="#4E5A66")
        if lv in ("GF", "FF") and res["stair"]:
            st = res["stair"]
            for kind, a, b in so.lines(st):
                g.line((X(a[0]), a[1]), (X(b[0]), b[1]), stroke="#0B6E99" if kind == "path" else "#1b1f24", sw={"tread": 0.4, "path": 0.7}.get(kind, 0.9))
            if lv == "GF":
                e = so.pt(st, -1.2, st["FW"] / 2); g.text(X(e[0]), e[1] + 0.4, "UP", 7, color="#0B6E99", bold=True)
        for d in res["doors"]:
            if d["level"] != lv or d.get("missing") or d["kind"] != "door": continue
            a, b = d["a"], d["b"]; g.line((X(a[0]), a[1]), (X(b[0]), b[1]), stroke="#ffffff", sw=3.2)
            g.line((X(a[0]), a[1]), (X(b[0]), b[1]), stroke="#0B6E99", sw=0.6)
        if lv == "GF":
            md = res["main_door"]; g.line((X(md["a"][0]), md["a"][1]), (X(md["b"][0]), md["b"][1]), stroke="#ffffff", sw=3.4)
            mx = (md["a"][0] + md["b"][0]) / 2; g.poly([(X(mx) - 0.8, md["a"][1] - 1.8), (X(mx) + 0.8, md["a"][1] - 1.8), (X(mx), md["a"][1] - 0.3)])
        g.text(X(0), PD + 3, ("GROUND FLOOR" if lv == "GF" else "FIRST FLOOR") + (f" (FFL +{f(res['levels'][1]['ffl_ft'])})" if lv == "FF" else ""), 10, anchor="start", bold=True)
        # north arrow
        ang = {"N": 0, "E": -90, "S": 180, "W": 90}[res["road_side"]]
        nx, ny = g.X(X(PW)) + 18, g.Y(PD) - 30
        g.items.append(f'<g transform="rotate({ang} {nx} {ny})"><polygon points="{nx},{ny-14} {nx+6},{ny+8} {nx},{ny+3} {nx-6},{ny+8}" fill="#1b1f24"/></g>')
        g.text(nx, ny - 18 if ang == 0 else ny + 24, "N", 9, bold=True, raw=True)
    if title: g.text(0, PD + 6.5, title + f" — {res['headline']}", 9, anchor="start")
    return g.render()

# ------------------------------------------------------------------ hand-off
def to_plan_trace(res, project, T):
    t = project.get("wall_mm", 230) / FT_MM / 2; road = res["road_side"]; PW, PD = res["site"]["width_ft"], res["site"]["depth_ft"]
    def C(pt):
        x, y = pt
        X, Y = {"N": (x, PD - y), "E": (PD - y, PW - x), "S": (PW - x, y), "W": (y, x)}[road]
        return [round(X * FT_MM), round(Y * FT_MM)]
    rooms, doors = [], []
    polys = {}
    for lv in ("GF", "FF"):
        ffl = round(next(l["ffl_ft"] for l in res["levels"] if l["code"] == lv) * FT_MM)
        for rm in res["rooms"][lv]:
            polys[(lv, rm["code"])] = rm["poly"]
            if rm["kind"] == "void": continue
            pin = inset(rm["poly"], t)
            pc = [C(q) for q in pin]
            sgn = sum(pc[i][0] * pc[(i + 1) % len(pc)][1] - pc[(i + 1) % len(pc)][0] * pc[i][1] for i in range(len(pc)))
            if sgn < 0: pc = pc[::-1]
            rooms.append({"code": f"{lv}-{rm['code']}", "name": rm["name"], "kind": rm["kind"], "level": lv, "ffl_mm": ffl, "polygon": pc,
                          "ceiling_mm": round(res["params"]["floor_height_ft"] * FT_MM - 150) if rm["kind"] not in ("porch", "balcony") else None})
    def into(lv, code, a, b):
        poly = inset(polys[(lv, code)], t); mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        horiz = abs(a[1] - b[1]) < 1e-6
        for s in (1, -1):
            q = (mx, my + s * t) if horiz else (mx + s * t, my)
            if inside((q[0] + (0 if horiz else s * 0.01), q[1] + (s * 0.01 if horiz else 0)), poly) or inside(q, polys[(lv, code)]):
                return [(a[0], a[1] + s * t), (b[0], b[1] + s * t)] if horiz else [(a[0] + s * t, a[1]), (b[0] + s * t, b[1])]
        return [a, b]
    n = 0
    for d in res["doors"]:
        if d.get("missing") or d["kind"] != "door": continue
        n += 1; ha, hb = into(d["level"], d["to"], d["a"], d["b"])
        doors.append({"id": f"{d['level']}-D{n}", "rooms": [f"{d['level']}-{d['from']}", f"{d['level']}-{d['to']}"], "swing_room": f"{d['level']}-{d['to']}", "type": "hinged",
                      "hinge": C(ha), "latch": C(hb), "level": d["level"]})
    md = res["main_door"]; ha, hb = into("GF", "LIV", md["a"], md["b"])
    doors.append({"id": "GF-MAIN", "rooms": ["GF-LIV"], "swing_room": "GF-LIV", "type": "hinged", "hinge": C(ha), "latch": C(hb), "level": "GF",
                  "object": res["objects"]["door"], "note": "main entrance (outside not traced)"})
    st = res["stair"]
    return {"source": f"program_pipeline {res['typology']} {res['version']} option {res['option']}", "units": "mm", "rooms": rooms, "doors": doors,
            "windows": [], "fixtures": [],
            "levels": [{"code": l["code"], "ffl_mm": round(l["ffl_ft"] * FT_MM)} for l in res["levels"]],
            "program": {"typology": res["typology"], "typology_version": res["version"], "lineage": res["lineage"], "option": res["option"], "objects": res["objects"],
                        "road_side": road, "mirror": res["mirror"], "areas_sqft": res["areas"], "far": round(res["far"], 3), "vastu_score": res["vastu_score"],
                        "stair": {"object": res["objects"]["stair"], "risers": st["risers"], "riser_in": round(st["rAct"], 2), "tread_in": round(st["TD"] * 12, 2),
                                  "outline_mm": [C(q) for q in rect(st["x"], st["y"], st["x"] + st["w"], st["y"] + st["h"])], "levels": ["GF", "FF"]}},
            "assumptions": [f"{res['typology']} option {res['option']}: room lines are wall centrelines, inset {project.get('wall_mm', 230)/2:.0f} mm (wall_mm {project.get('wall_mm', 230)}).",
                            "Origin: south-west plot corner. X east, Y north. Two levels (GF, FF): split by level when handing to design_pipeline (handoff_to_design.py --level).",
                            "Openings (living-dining, dining-stair, lounge-OTS) are open connections and not traced as doors.",
                            "Windows and fixtures are not planned yet."]}

# ------------------------------------------------------------------ QC
def _reach(res, lv):
    doors = [d for d in res["doors"] if d["level"] == lv and not d.get("missing")]
    start = {"GF": {"LIV", "PORCH"}, "FF": {"STAIR"}}[lv]; seen = set(start); grow = True
    while grow:
        grow = False
        for d in doors:
            for a, b in ((d["from"], d["to"]), (d["to"], d["from"])):
                if a in seen and b not in seen: seen.add(b); grow = True
    return seen

def qc(res, rules, brief, T):
    r = rules; out = []; P = res["params"]; so, do = T.objects["stair"].mod, T.objects["door"].mod
    sb = res["setbacks"]
    for k, rk in (("front", "front_setback_min_ft"), ("rear", "rear_setback_min_ft"), ("left", "side_setback_min_ft"), ("right", "side_setback_min_ft")):
        if r.get(rk) is not None and sb[k] < r[rk] - 1e-9:
            if not (k in ("left", "right") and sb[k] == 0 and r.get("one_side_zero_allowed") and sb["left" if k == "right" else "right"] > 0):
                out.append(F("fail", "setback", k, f"{k} setback {f(sb[k])} below {f(r[rk])}"))
    if r.get("coverage_max_pct") is not None:
        out.append(F("fail" if res["coverage_pct"] > r["coverage_max_pct"] + 1e-9 else "info", "coverage", "site", f"ground coverage {res['coverage_pct']:.1f}% (max {r['coverage_max_pct']}%)"))
    ex = set(r.get("far_excludes", ["porch", "void", "balcony"])); A = res["areas"]
    far_area = res["total"] - (A["porch"] if "porch" in ex else 0) + (0 if "balcony" in ex else A["balcony"])
    far = far_area / res["site"]["area_sqft"]
    if r.get("far_max") is not None: out.append(F("fail" if far > r["far_max"] + 1e-9 else "info", "far", "site", f"FAR {far:.2f} (max {r['far_max']}; excludes {sorted(ex)})"))
    h = res["height_ft"] + (r.get("parapet_ft") or 0)
    if r.get("height_max_ft") is not None and h > r["height_max_ft"] + 1e-9: out.append(F("fail", "height", "building", f"height {f(h)} above {f(r['height_max_ft'])}"))
    if brief.get("bedrooms") and res["bedrooms"] != brief["bedrooms"]: out.append(F("fail", "program", "bedrooms", f"{res['bedrooms']} bedrooms, brief asks {brief['bedrooms']}"))
    allowed = set(brief.get("facing_allowed", [])) or {res["facing"]}
    if res["facing"] not in allowed: out.append(F("fail", "facing", "entrance", f"{res['facing']} facing, brief allows {sorted(allowed)}"))
    habit = []
    for lv, rms in res["rooms"].items():
        for rm in rms:
            ref = f"{lv}-{rm['code']}"; a = rm["area_sqft"]; w = min(rm["w"], rm["h"])
            if rm["kind"] in ("bedroom", "master", "living", "lounge") and rm["code"] != "LOB":
                habit.append(a)
                if r.get("min_habitable_sqft") and a < r["min_habitable_sqft"] - 1e-6: out.append(F("fail", "room_area", ref, f"{a:.0f} sq ft below {r['min_habitable_sqft']}"))
                if r.get("min_habitable_width_ft") and w < r["min_habitable_width_ft"] - 1e-6: out.append(F("fail", "room_width", ref, f"{f(w)} below {f(r['min_habitable_width_ft'])}"))
            if rm["kind"] == "kitchen":
                if r.get("min_kitchen_sqft") and a < r["min_kitchen_sqft"] - 1e-6: out.append(F("fail", "room_area", ref, f"kitchen {a:.0f} sq ft below {r['min_kitchen_sqft']}"))
                if r.get("min_kitchen_width_ft") and w < r["min_kitchen_width_ft"] - 1e-6: out.append(F("fail", "room_width", ref, f"kitchen {f(w)} below {f(r['min_kitchen_width_ft'])}"))
            if rm["kind"] == "toilet":
                if r.get("min_toilet_sqft") and a < r["min_toilet_sqft"] - 1e-6: out.append(F("fail", "room_area", ref, f"toilet {a:.0f} sq ft below {r['min_toilet_sqft']}"))
                if r.get("min_toilet_width_ft") and w < r["min_toilet_width_ft"] - 1e-6: out.append(F("fail", "room_width", ref, f"toilet {f(w)} below {f(r['min_toilet_width_ft'])}"))
            if rm["kind"] == "porch" and brief.get("parking", 1):
                L_ = rm["h"] + (sb["front"] if r.get("parking_in_front_setback", True) else 0)
                if rm["w"] < (r.get("parking_min_width_ft") or 0) - 1e-6 or L_ < (r.get("parking_min_length_ft") or 0) - 1e-6:
                    out.append(F("fail", "parking", ref, f"car bay {f(rm['w'])} x {f(L_)} below {f(r.get('parking_min_width_ft', 0))} x {f(r.get('parking_min_length_ft', 0))}"))
                elif L_ > rm["h"] + 1e-6:
                    out.append(F("info", "parking", ref, f"car bay {f(rm['w'])} x {f(L_)} uses {f(L_ - rm['h'])} of the open front setback"))
            if rm["kind"] == "balcony" and r.get("balcony_max_projection_ft") is not None:
                if rm["h"] > r["balcony_max_projection_ft"] + 1e-9: out.append(F("fail", "balcony", ref, f"projects {f(rm['h'])} (max {f(r['balcony_max_projection_ft'])})"))
                if rm["h"] > sb["front"] + 1e-9: out.append(F("fail", "balcony", ref, f"projects {f(rm['h'])} beyond the {f(sb['front'])} front setback"))
    if r.get("min_first_habitable_sqft") and (not habit or max(habit) < r["min_first_habitable_sqft"] - 1e-6):
        out.append(F("fail", "room_area", "habitable", f"no habitable room reaches {r['min_first_habitable_sqft']} sq ft"))
    for d in res["doors"]:
        if d.get("missing"): out.append(F("fail", "access", f"{d['level']}-{d['from']}/{d['to']}", f"no {d['kind']} possible between {d['from']} and {d['to']} {d.get('why', '')}".strip()))
    for lv, rms in res["rooms"].items():
        seen = _reach(res, lv)
        for rm in rms:
            if rm["kind"] not in ("void",) and rm["code"] not in seen: out.append(F("fail", "access", f"{lv}-{rm['code']}", "cannot be reached by doors / openings"))
    st = res["stair"]; out += so.qc(st, r, F)
    if not st["entryOK"]: out.append(F("fail", "stair", "entry", "first step does not start from the dining hub"))
    out += do.qc({"width_ft": res["main_door"]["width_ft"]}, r, F, "main door")
    for w in res["warn"]: out.append(F("warn", "layout", "plan", w))
    if brief.get("vastu", False):
        for v in res["vastu"]:
            if v["verdict"] == "avoid": out.append(F("warn", "vastu", v["ref"], f"{v['item']} in {v['zone']} (traditionally avoided)"))
        out.append(F("info", "vastu", "score", f"vastu score {res['vastu_score']:+d}" + (" with mirrored layout" if res["mirror"] else "")))
    return out

def migrate(params, from_version):
    if from_version not in ("0.1.0", None, ""): raise ValueError(f"no migration from {from_version}")
    return dict(params), []
