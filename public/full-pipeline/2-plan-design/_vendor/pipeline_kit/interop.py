"""Format bridges between BuilderPluss pipelines.

plan_trace_to_canvas(trace, level)  program pipeline's plan_trace.v1 (mm, X east, Y north, room outlines = wall inner
                                    faces) → the editor's canvas.v1 (pixels, y down, walls on centrelines), which the
                                    floorplan editor, the space-brief pipeline and the mesh pipelines read.

How it rebuilds walls from room outlines
  1. each room outline is pushed out by half the wall thickness → its wall centreline loop;
  2. corners closer than `snap_mm` merge; a corner lying on another room's edge splits that edge (T-junctions);
  3. every centreline edge becomes ONE wall segment, shared by the rooms on both sides;
  4. each door (hinge, latch on its room's inner face) splits its wall into wall · door · wall;
  5. open connections the trace names in its assumptions ("Openings (living-dining, …) are open connections")
     become `opening` segments; edges of open-air rooms (porch, balcony, terrace, OTS …) that touch no enclosed room
     get no wall at all.
Everything the bridge had to decide is returned in `notes` (and copied into canvas.graphAttrs.notes).
"""
import math, re

OPEN_AIR = ("porch", "balcony", "terrace", "ots", "void", "court", "sitout", "deck", "verandah", "veranda", "open")

def _area(pts):
    return sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts))) / 2

def _offset(poly, d):
    """Push a simple polygon outward by d (mitred corners)."""
    pts = [tuple(map(float, p)) for p in poly]
    if len(pts) > 2 and pts[0] == pts[-1]: pts = pts[:-1]
    ccw = _area(pts) > 0; n = len(pts); lines = []
    for i in range(n):
        (x1, y1), (x2, y2) = pts[i], pts[(i + 1) % n]; dx, dy = x2 - x1, y2 - y1; L = math.hypot(dx, dy) or 1
        nx, ny = (dy / L, -dx / L) if ccw else (-dy / L, dx / L)
        lines.append(((x1 + nx * d, y1 + ny * d), (dx, dy), (nx, ny)))
    out = []
    for i in range(n):
        (p1, d1, n1), (p2, d2, n2) = lines[i - 1], lines[i]
        den = d1[0] * d2[1] - d1[1] * d2[0]
        if abs(den) < 1e-9: out.append((pts[i][0] + n2[0] * d, pts[i][1] + n2[1] * d)); continue
        t = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den
        out.append((p1[0] + d1[0] * t, p1[1] + d1[1] * t))
    return out

def _proj(p, a, b):
    ax, ay = a; bx, by = b; dx, dy = bx - ax, by - ay; L2 = dx * dx + dy * dy
    if L2 == 0: return 0.0, math.dist(p, a)
    t = ((p[0] - ax) * dx + (p[1] - ay) * dy) / L2
    q = (ax + t * dx, ay + t * dy); return t, math.dist(p, q)

def _open_tokens(trace):
    toks = []
    for a in trace.get("assumptions", []):
        m = re.search(r"[Oo]penings?\s*\(([^)]*)\)\s*are open", a)
        if m: toks += [tuple(x.strip().lower() for x in pair.split("-", 1)) for pair in m.group(1).split(",") if "-" in pair]
    return toks

def _matches(room, tok):
    return tok in room.get("kind", "").lower() or tok in room.get("name", "").lower() or tok in room["code"].lower()

def plan_trace_to_canvas(trace, level=None, ppm=50.0, wall_mm=None, wall_height_m=None, door_head_m=2.1, snap_mm=20.0):
    """→ (canvas dict, notes list). `level` is required when the trace has several levels."""
    notes = []
    rooms = trace.get("rooms", [])
    levels = sorted({r.get("level") for r in rooms if r.get("level")})
    if len(levels) > 1 and not level: raise ValueError(f"the trace has levels {levels}: pick one (one plan per level)")
    if level:
        if level not in levels: raise ValueError(f"level {level} not in {levels}")
        rooms = [r for r in rooms if r.get("level") == level]
    doors = [d for d in trace.get("doors", []) if not level or d.get("level", level) == level]
    if wall_mm is None:
        m = next((re.search(r"wall_mm (\d+)", a) for a in trace.get("assumptions", []) if re.search(r"wall_mm (\d+)", a)), None)
        wall_mm = float(m.group(1)) if m else 230.0
        notes.append(f"wall thickness {wall_mm:.0f} mm" + (" (from the trace)" if m else " (default — the trace does not say)"))
    t = float(wall_mm)
    if wall_height_m is None:
        lv = trace.get("levels") or []; ffl = [l.get("ffl_mm") for l in lv if l.get("ffl_mm") is not None]
        here = next((l.get("ffl_mm") for l in lv if l.get("code") == level), None)
        above = sorted(f for f in ffl if here is not None and f > here)
        wall_height_m = (above[0] - here) / 1000 if above else 2.7
    open_air = {r["code"] for r in rooms if any(k in r.get("kind", "").lower() for k in OPEN_AIR)}

    # 1 · centreline loops, 2 · merged corners
    nodes = []                                     # [(x, y)]
    def node(p):
        for i, q in enumerate(nodes):
            if math.dist(p, q) <= snap_mm: return i
        nodes.append((round(p[0], 1), round(p[1], 1))); return len(nodes) - 1
    loops = {r["code"]: [node(p) for p in _offset(r["polygon"], t / 2)] for r in rooms}
    for code, lp in loops.items():                 # drop repeats created by merging
        loops[code] = [v for i, v in enumerate(lp) if v != lp[i - 1]]
    # T-junctions: a corner on another loop's edge splits that edge
    for code, lp in loops.items():
        out = []
        for i, a in enumerate(lp):
            b = lp[(i + 1) % len(lp)]; out.append(a); mids = []
            for v in range(len(nodes)):
                if v in (a, b): continue
                u, dist = _proj(nodes[v], nodes[a], nodes[b])
                if 1e-6 < u < 1 - 1e-6 and dist <= snap_mm: mids.append((u, v))
            out += [v for _, v in sorted(mids)]
        loops[code] = out
    # 3 · one segment per centreline edge; who is on each side
    segs = {}                                      # frozenset({a, b}) → {"a", "b", "rooms": set, "layer"}
    for code, lp in loops.items():
        for i, a in enumerate(lp):
            b = lp[(i + 1) % len(lp)]; k = frozenset((a, b))
            segs.setdefault(k, {"a": a, "b": b, "rooms": set(), "layer": "wall"})["rooms"].add(code)
    by_code = {r["code"]: r for r in rooms}
    for k, s in list(segs.items()):
        if s["rooms"] and s["rooms"] <= open_air and len(s["rooms"]) == 1:
            s["layer"] = None                      # an open-air room's outer edge: no wall
    dropped = sum(1 for s in segs.values() if s["layer"] is None)
    if dropped: notes.append(f"{dropped} edges of open-air rooms ({', '.join(sorted(open_air))}) left without walls")
    # 5 · open connections named by the trace
    toks = _open_tokens(trace); opened = []
    for s in segs.values():
        rs = [by_code[c] for c in s["rooms"]]
        if len(rs) == 2 and any((_matches(rs[0], x) and _matches(rs[1], y)) or (_matches(rs[0], y) and _matches(rs[1], x)) for x, y in toks):
            s["layer"] = "opening"; opened.append("/".join(sorted(s["rooms"])))
    if opened: notes.append(f"open connections drawn as openings: {', '.join(sorted(set(opened)))}")
    # 4 · doors split their wall
    placed = []
    for d in doors:
        h, l = tuple(d["hinge"]), tuple(d["latch"]); mid = ((h[0] + l[0]) / 2, (h[1] + l[1]) / 2); w = math.dist(h, l)
        best = None
        for k, s in segs.items():
            if s["layer"] != "wall": continue
            A, Bp = nodes[s["a"]], nodes[s["b"]]; u, dist = _proj(mid, A, Bp)
            seg_dir = (Bp[0] - A[0], Bp[1] - A[1]); door_dir = (l[0] - h[0], l[1] - h[1])
            par = abs(seg_dir[0] * door_dir[1] - seg_dir[1] * door_dir[0]) / ((math.hypot(*seg_dir) * math.hypot(*door_dir)) or 1)
            if 0 < u < 1 and dist <= t and par < 0.05 and (best is None or dist < best[0]): best = (dist, k)
        if not best: notes.append(f"door {d.get('id')} ({w:.0f} mm): no wall found at its position — not placed"); continue
        s = segs.pop(best[1]); A, Bp = nodes[s["a"]], nodes[s["b"]]
        uh, _ = _proj(h, A, Bp); ul, _ = _proj(l, A, Bp); u1, u2 = sorted((max(0.0, min(1.0, uh)), max(0.0, min(1.0, ul))))
        pt = lambda u: (A[0] + (Bp[0] - A[0]) * u, A[1] + (Bp[1] - A[1]) * u)
        m1, m2 = node(pt(u1)), node(pt(u2))
        chain = [x for x in (s["a"], m1, m2, s["b"]) if True]
        chain = [v for i, v in enumerate(chain) if i == 0 or v != chain[i - 1]]
        for i in range(len(chain) - 1):
            a, b = chain[i], chain[i + 1]; is_door = (a, b) == (m1, m2)
            segs[frozenset((a, b))] = {"a": a, "b": b, "rooms": set(s["rooms"]), "layer": "door" if is_door else "wall", "door": d if is_door else None, "width": w}
        for code in s["rooms"]:                    # keep every loop running through the new nodes
            lp = loops[code]
            for i in range(len(lp)):
                a, b = lp[i], lp[(i + 1) % len(lp)]
                if {a, b} == {s["a"], s["b"]}:
                    ins = [m for m in (m1, m2) if m not in (a, b)]
                    if a == s["b"]: ins = ins[::-1]
                    loops[code] = lp[:i + 1] + ins + lp[i + 1:]; break
        placed.append(d.get("id"))

    # canvas.v1
    P = lambda i: {"id": f"n{i + 1:03d}", "x": round(nodes[i][0] / 1000 * ppm, 3), "y": round(-nodes[i][1] / 1000 * ppm, 3)}
    wall_att = lambda n: {"id": f"att-w{n:03d}", "objectId": "wall-with-math", "objectPath": "Architectural/wall-with-math.json",
                          "params": {"thickness": round(t / 1000, 4), "height": round(wall_height_m, 3), "mode": "Buffered", "hatch": True, "fitMode": "Fill segment"}}
    out_segs = []
    for n, s in enumerate(sorted((s for s in segs.values() if s["layer"]), key=lambda s: (min(s["a"], s["b"]), max(s["a"], s["b"]))), 1):
        seg = {"id": f"s{n:03d}", "fromNodeId": f"n{s['a'] + 1:03d}", "toNodeId": f"n{s['b'] + 1:03d}", "layer": s["layer"], "thickness": round(t / 1000 * ppm, 4),
               "attachments": [wall_att(n)]}
        names = " / ".join(by_code[c]["name"] for c in sorted(s["rooms"]))
        if s["layer"] == "door":
            d = s["door"]; w = s["width"] / 1000
            seg.update(isObjectOpening=True, label=f"Door {d.get('id', '')}: {names}")
            seg["attachments"].append({"id": f"att-d{n:03d}", "objectId": "door-with-math", "objectPath": "Architectural/door-with-math.json",
                                       "params": {"width": round(w, 3), "leaves": "Double" if w >= 1.2 else "Single", "hinge": "left", "swing": "right", "openAngle": 90,
                                                  "fitMode": "Fill segment", "frameDepth": 0.1, "lintelHeight": door_head_m, "panelStyle": "Flush"}})
        elif s["layer"] == "opening":
            seg.update(isObjectOpening=True, label=f"Opening: {names}")
            seg["attachments"] = [{"id": f"att-o{n:03d}", "objectId": "opening-with-math", "objectPath": "Architectural/opening-with-math.json",
                                   "params": {"fitMode": "Fill segment", "lintelHeight": round(wall_height_m, 3)}}]
        out_segs.append(seg)
    spaces = [{"id": f"sp-{r['code']}", "nodeIds": [f"n{v + 1:03d}" for v in loops[r["code"]]], "label": r.get("name") or r["code"],
               "roomType": r.get("kind") or "room", "code": r["code"],
               "attachments": [{"id": f"att-r-{r['code']}", "objectId": "room-with-math", "objectPath": "Architectural/room-with-math.json", "params": {"color": "Grey"}}]}
              for r in rooms]
    missing = [d.get("id") for d in doors if d.get("id") not in placed]
    if not missing: notes.append(f"{len(placed)} doors placed")
    prog = trace.get("program") or {}
    # Every layer the drawing uses, in the editor's full shape: a layer without `visible: true` is HIDDEN in the
    # editor, so a bare {"id": "0"} (and no entry at all for wall / door / opening) imported as an empty canvas.
    used = list(dict.fromkeys(["0"] + [g.get("layer", "0") for g in out_segs] + [sp.get("layer", "0") for sp in spaces]))
    layers = [{"id": lid, "name": lid, "color": "#000000", "visible": True, "locked": False, "order": i} for i, lid in enumerate(used)]
    canvas = {"schemaVersion": 1, "settings": {"pixelsPerMeter": ppm, "units": "m"}, "nodes": [P(i) for i in range(len(nodes))], "segments": out_segs,
              "spaces": spaces, "layers": layers, "imageUnderlay": None,
              "graphAttrs": {"source": "program plan_trace.v1 → canvas.v1 (pipeline_kit.interop)", "trace_source": trace.get("source", ""),
                             "typology": prog.get("typology"), "typology_version": prog.get("typology_version"), "option": prog.get("option"),
                             "level": level or (levels[0] if levels else None), "wall_mm": t, "notes": notes}}
    return canvas, notes
