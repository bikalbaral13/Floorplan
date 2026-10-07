"""QC on the plan model — the skills' hard-won lessons as checks. run(plan, standards, ctx) → findings.

graph        unique ids · wall ends join something (free ends only on parapets / kerbs) · every opening jamb
             reaches a COLLINEAR wall piece (an opening ending on a perpendicular junction needs a stub)
spaces       valid rings on graph nodes · slivers · printed size exact (drawing) / within tolerance
             · area deltas · printed rooms whose edge has no band under it
scale        calibration residuals (drawing)
rooms        hierarchy (hall / kitchen > every bedroom, sketch) · wet rooms on an exterior wall
             · circulation (every room reachable from outside through doors / openings, never only
             through a bedroom)
openings     hinged doors to one side (jamb 30–600 mm from the corner, sketch) · door widths sane
elements     stair fills ≥ 85 % of its bay · fixtures inside a room · floor-level fixture overlaps
             · objects mandatory: every symbol read is placed or listed as not placed
"""
import math
from collections import defaultdict, deque
from shapely.geometry import Polygon, Point, LineString, box as sbox
from shapely.ops import unary_union
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import model as M, units as U
F = M.F

def _k(p): return (round(p[0], 4), round(p[1], 4))

def run(plan, std, ctx=None):
    ctx = ctx or {}; out = []; ch = std.get("checks", {}); kind = plan.get("source", {}).get("kind", "drawing")
    ids = [e["id"] for L in plan["levels"] for key in ("walls", "openings", "spaces", "columns", "stairs", "fixtures") for e in L[key]]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup: out.append(F("fail", "graph", "ids", f"duplicate ids: {sorted(dup)[:8]}"))
    sc = plan.get("scale")
    if sc and sc.get("max_residual_ft") is not None:
        r = sc["max_residual_ft"]
        out.append(F("fail" if r > ch.get("calibration_fail_ft", 0.6) else ("warn" if r > ch.get("calibration_warn_ft", 0.25) else "info"), "scale", "calibration",
                     f"{sc.get('px_per_m')} px/m from {sc.get('n_pairs')} pairs, max residual {r} ft"))
    for L in plan["levels"]:
        out += _graph(L); out += _spaces(L, ch, kind); out += _rooms(L, std, kind); out += _openings(L, ch, kind); out += _elements(L, ch, ctx)
    return out

def _graph(L):
    out = []; deg = defaultdict(list)
    for w in L["walls"]: deg[_k(w["a"])].append(("w", w)); deg[_k(w["b"])].append(("w", w))
    for o in L["openings"]: deg[_k(o["a"])].append(("o", o)); deg[_k(o["b"])].append(("o", o))
    for w in L["walls"]:
        for end in ("a", "b"):
            if len(deg[_k(w[end])]) == 1 and w["kind"] == "wall":
                out.append(F("warn", "graph", w["id"], f"free wall end at {w[end]} ({w.get('label') or 'wall'}) — a wall should end on a junction or a jamb"))
    for o in L["openings"]:
        horiz = abs(o["a"][1] - o["b"][1]) < 1e-6
        for end in ("a", "b"):
            others = [x for t, x in deg[_k(o[end])] if x is not o]
            coll = [x for x in others if (abs(x["a"][1] - x["b"][1]) < 1e-6) == horiz]
            perp = [x for x in others if (abs(x["a"][1] - x["b"][1]) < 1e-6) != horiz]
            if perp and not coll:
                out.append(F("fail", "graph", o["id"], f"{o['kind']} '{o.get('label','')}' ends on a perpendicular wall's node at {o[end]} — insert a short wall stub of its own thickness between the junction and the jamb"))
            elif not others and o["kind"] != "opening":
                out.append(F("warn", "graph", o["id"], f"{o['kind']} '{o.get('label','')}' jamb at {o[end]} connects to nothing"))
    return out

def _spaces(L, ch, kind):
    out = []; nodes = {_k(w[e]) for w in L["walls"] for e in ("a", "b")} | {_k(o[e]) for o in L["openings"] for e in ("a", "b")}
    for s in L["spaces"]:
        off = [p for p in s["ring"] if _k(p) not in nodes]
        if off: out.append(F("warn", "space", s["name"], f"{len(off)} ring corner(s) not on a wall node — rings run on the centrelines"))
        if s["area"] < ch.get("sliver_m2", 0.6): out.append(F("warn", "space", s["name"], f"sliver {s['area']:.2f} m²"))
        if s.get("printed") and s.get("clear"):
            pw, ph = s["printed"]; cw, chh = s["clear"]
            if abs(cw - pw) > abs(cw - ph): pw, ph = ph, pw              # printed pairs are not always W × H
            dw, dh = (cw - pw) / U.FT, (chh - ph) / U.FT
            pa = pw * ph; da = (cw * chh - pa) / pa * 100
            tol = ch.get("printed_exact_ft", 0.02)
            lvl = "info" if max(abs(dw), abs(dh)) <= tol else ("fail" if abs(da) > ch.get("printed_area_fail_pct", 8) else "warn")
            out.append(F(lvl, "printed", s["name"], f"clear {U.ftin(cw)} × {U.ftin(chh)} vs printed {U.ftin(pw)} × {U.ftin(ph)}  (Δ {dw:+.3f} / {dh:+.3f} ft, area {da:+.1f} %)"))
            for e in s.get("edges_without_band", []):
                out.append(F("warn", "printed", s["name"], f"edge {e} has no wall band under it — give it a real thin band so its face is defined"))
    return out

def _outside_sides(L):
    """For each wall / opening: which sides (L, R) are outside every space."""
    polys = [(s, Polygon(s["ring"])) for s in L["spaces"]]
    def sp_at(p): return next((s for s, pg in polys if pg.buffer(1e-6).contains(Point(p))), None)
    res = {}
    for e in L["walls"] + L["openings"]:
        (ax, ay), (bx, by) = e["a"], e["b"]; mx, my = (ax + bx) / 2, (ay + by) / 2; nx, ny = M.left_normal(e["a"], e["b"]); d = e["t"] / 2 + 0.25
        res[e["id"]] = (sp_at((mx + nx * d, my + ny * d)), sp_at((mx - nx * d, my - ny * d)))
    return res

def _rooms(L, std, kind):
    out = []; sides = _outside_sides(L)
    hi = std.get("hierarchy", {})
    if kind in hi.get("enabled_for", []):
        big = [s for s in L["spaces"] if any(k in s["name"].upper() for k in hi.get("big", []))]
        small = [s for s in L["spaces"] if any(k in s["name"].upper() for k in hi.get("small", []))]
        for b in big:
            for s in small:
                ok = b["net_area"] > s["net_area"]
                out.append(F("info" if ok else "fail", "hierarchy", f"{b['name']}>{s['name']}", f"{b['name']} {U.sqft(b['net_area']):.0f} sq ft vs {s['name']} {U.sqft(s['net_area']):.0f} sq ft → {ok}"))
    for s in L["spaces"]:
        if s["type"] != "toilet": continue
        ext = any((l is s and r is None) or (r is s and l is None) for eid, (l, r) in sides.items())
        if not ext: out.append(F("warn", "wet_room", s["name"], "toilet has no wall to the outside (no ventilator possible)"))
    # circulation graph: rooms joined by doors / openings / gates / sliding doors
    adj = defaultdict(set); outside_links = set()
    for o in L["openings"]:
        if o["kind"] == "window": continue
        l, r = sides[o["id"]]
        if l and r: adj[l["id"]].add(r["id"]); adj[r["id"]].add(l["id"])
        elif l or r: outside_links.add((l or r)["id"])
    rooms = {s["id"]: s for s in L["spaces"] if s["type"] != "area"}
    if outside_links and rooms:
        def reach(block_bedrooms):
            seen, q = set(outside_links), deque(outside_links)
            while q:
                u = q.popleft()
                if block_bedrooms and "BED" in rooms.get(u, {"name": ""})["name"].upper(): continue
                for v in adj[u]:
                    if v not in seen: seen.add(v); q.append(v)
            return seen
        full, nobed = reach(False), reach(True)
        for rid, s in rooms.items():
            if rid not in full: out.append(F("fail", "circulation", s["name"], "not reachable from outside through any door or opening"))
            elif rid not in nobed and "BED" not in s["name"].upper() and s["type"] != "toilet":
                out.append(F("warn", "circulation", s["name"], "reachable only through a bedroom"))
    elif rooms:
        out.append(F("warn", "circulation", "plan", "no door or opening leads outside — entrance missing?"))
    return out

def _openings(L, ch, kind):
    out = []
    for o in L["openings"]:
        if o["kind"] == "door" and not (0.6 <= o["width"] <= 2.4):
            out.append(F("warn", "door", o["id"], f"door width {o['width']:.2f} m looks wrong"))
        if kind == "sketch" and o["kind"] == "door":
            horiz = abs(o["a"][1] - o["b"][1]) < 1e-6; ax = 0 if horiz else 1
            coll = [w for w in L["walls"] if (abs(w["a"][1] - w["b"][1]) < 1e-6) == horiz and abs(w["a"][1 - ax] - o["a"][1 - ax]) < 1e-4]
            lo, hi = sorted((o["a"][ax], o["b"][ax]))
            # run of collinear pieces touching the door → the wall span between junctions it sits in
            left = max([min(w["a"][ax], w["b"][ax]) for w in coll if max(w["a"][ax], w["b"][ax]) <= lo + 1e-4 and max(w["a"][ax], w["b"][ax]) >= lo - 1e-4] or [lo])
            right = min([max(w["a"][ax], w["b"][ax]) for w in coll if min(w["a"][ax], w["b"][ax]) >= hi - 1e-4 and min(w["a"][ax], w["b"][ax]) <= hi + 1e-4] or [hi])
            gap = min(lo - left, right - hi)
            if not (ch.get("door_jamb_min_m", 0.03) - 1e-6 <= gap <= ch.get("door_jamb_max_m", 0.6) + 1e-6):
                out.append(F("warn", "door_side", o["id"], f"door '{o.get('label','')}' sits {gap:.2f} m from the nearer corner — doors go to one side, a jamb (30–600 mm) off the corner"))
    return out

def _elements(L, ch, ctx):
    out = []
    for st in L["stairs"]:
        b, f = st["bay"], st["footprint"]
        fill = ((f[2] - f[0]) * (f[3] - f[1])) / max(1e-9, (b[2] - b[0]) * (b[3] - b[1]))
        fits = f[0] >= b[0] - 1e-3 and f[1] >= b[1] - 1e-3 and f[2] <= b[2] + 1e-3 and f[3] <= b[3] + 1e-3
        out.append(F("fail" if not fits else ("warn" if fill < ch.get("stair_fill_min", 0.85) else "info"), "stair", st["id"],
                     f"{st['config']} {st['risers']} risers × {st['riser']*1000:.0f} mm, footprint {f[2]-f[0]:.2f} × {f[3]-f[1]:.2f} m fills {fill*100:.0f} % of its bay" + ("" if fits else " — DOES NOT FIT the bay")))
    rects = []
    for fx in L["fixtures"]:
        w, d = fx["size"]; rot = fx["rot"] % 180
        ex, ey = (w, d) if rot in (0, 0.0) else ((d, w) if abs(rot - 90) < 1e-6 else (max(w, d), max(w, d)))
        r = sbox(fx["c"][0] - ex / 2, fx["c"][1] - ey / 2, fx["c"][0] + ex / 2, fx["c"][1] + ey / 2); rects.append((fx, r))
        if fx["kind"] == "north-arrow": continue
        if not fx.get("room"): out.append(F("warn", "fixture", fx["id"], f"{fx['kind']} at {fx['c']} is outside every room"))
    for i in range(len(rects)):
        for j in range(i + 1, len(rects)):
            a, b = rects[i], rects[j]
            pair = {a[0]["kind"], b[0]["kind"]}
            if pair & {"rug", "north-arrow"} or any(pair == set(p) or (len(set(p)) == 1 and pair == set(p)) for p in ch.get("may_overlap", [])): continue
            ov = a[1].intersection(b[1]).area
            if ov > ch.get("fixture_overlap_m2", 0.02): out.append(F("warn", "fixture_overlap", f"{a[0]['id']}/{b[0]['id']}", f"{a[0]['kind']} and {b[0]['kind']} overlap {ov:.2f} m² at floor level"))
    symbols = (ctx.get("reading") or {}).get("symbols")
    if symbols is not None:
        placed = defaultdict(int)
        for fx in L["fixtures"]: placed[fx["kind"]] += 1
        for np_ in L.get("not_placed", []): placed[np_["kind"]] += 1
        for s in symbols:
            if s.get("level", L["id"]) != L["id"]: continue
            want = int(s.get("count", 1)); have = placed.get(s["kind"], 0)
            if have < want: out.append(F("fail", "objects", s["kind"], f"{want} read on the sheet, {have} placed or listed as not placed — a trace is unfinished until every symbol is accounted for"))
    return out
