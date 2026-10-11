"""canvas.v1 (editor plan JSON, pixels, y down) -> geo.json (metres, plan frame, y down).

Everything downstream (views, schedule, apps, deck) reads geo.json, never the canvas.
A wall RUN is a maximal collinear chain of band segments (walls + the openings cut in them);
each run that faces a scoped space becomes one interior elevation.
"""
import hashlib, json, math

BAND_OBJECTS = ("wall-with-math", "door-with-math", "window-with-math", "opening-with-math")
OPENING_KIND = {"door-with-math": "door", "window-with-math": "window", "opening-with-math": "opening"}
# object id stem -> (category, default height m, default footprint m) ; categories match core.brief.CATS
OBJECT_KIND = {
    "reception-desk": ("joinery", 1.05, (3.0, 0.8)), "desk": ("furniture", 0.75, (1.4, 0.7)),
    "table": ("furniture", 0.75, (1.2, 0.8)), "chair": ("furniture", 0.85, (0.75, 0.8)),
    "sofa": ("furniture", 0.8, (2.0, 0.9)), "bed": ("furniture", 0.5, (2.0, 1.8)),
    "rug": ("soft", 0.01, (2.4, 2.4)), "planter-box": ("planting", 0.9, (1.2, 0.4)), "planter": ("planting", 0.9, (0.6, 0.6)),
    "pendant": ("light", 0.4, (0.4, 0.4)), "lamp": ("light", 0.4, (0.4, 0.4)), "tv": ("signage", 0.7, (1.2, 0.08)),
    "wardrobe": ("joinery", 2.1, (1.8, 0.6)), "column": ("structure", 3.0, (0.4, 0.4)),
}
SKIP_OBJECTS = ("camera-with-math",)

def sha256(path):
    return hashlib.sha256(open(path, "rb").read()).hexdigest()

def stem(object_id):
    s = (object_id or "").replace("-with-math", "")
    return s

def kind_of(object_id):
    s = stem(object_id)
    if s in OBJECT_KIND: return s
    for k in sorted(OBJECT_KIND, key=len, reverse=True):
        if k in s: return k
    return s or "object"

# ---------- small vector helpers ----------
def sub(a, b): return (a[0] - b[0], a[1] - b[1])
def add(a, b): return (a[0] + b[0], a[1] + b[1])
def mul(a, k): return (a[0] * k, a[1] * k)
def dot(a, b): return a[0] * b[0] + a[1] * b[1]
def norm(a):
    l = math.hypot(*a); return (a[0] / l, a[1] / l) if l else (0.0, 0.0)
def area(ring):
    s = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]; s += x1 * y2 - x2 * y1
    return s / 2
def centroid(ring):
    a = area(ring)
    if abs(a) < 1e-9: return (sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring))
    cx = cy = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]; f = x1 * y2 - x2 * y1; cx += (x1 + x2) * f; cy += (y1 + y2) * f
    return (cx / (6 * a), cy / (6 * a))
def inside(pt, ring):
    x, y = pt; c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]; x2, y2 = ring[(i + 1) % len(ring)]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c
def seg_dist(p, a, b):
    ab = sub(b, a); t = 0 if dot(ab, ab) == 0 else max(0, min(1, dot(sub(p, a), ab) / dot(ab, ab)))
    q = add(a, mul(ab, t)); return math.hypot(*sub(p, q))

# ---------- canvas reading ----------
def _level(canvas, level=None):
    """Single-level plans keep nodes/segments/spaces at the top; multi-level plans inside levels[]."""
    if canvas.get("levels"):
        lv = canvas["levels"]
        pick = next((l for l in lv if level in (l.get("id"), l.get("name"))), lv[0]) if level else lv[0]
        return pick, pick.get("id")
    return canvas, None

def read_canvas(canvas, level=None):
    ppm = float(canvas["settings"]["pixelsPerMeter"])
    L, level_id = _level(canvas, level)
    nodes = {n["id"]: n for n in L.get("nodes", [])}
    P = lambda nid: (nodes[nid]["x"] / ppm, nodes[nid]["y"] / ppm)
    walls, objects, others = [], [], []
    for s in L.get("segments", []):
        a, b = P(s["fromNodeId"]), P(s["toNodeId"])
        atts = s.get("attachments") or []
        objs = [x.get("objectId") or stem(x.get("objectPath", "")) for x in atts]
        if s["fromNodeId"] == s["toNodeId"] or math.hypot(*sub(b, a)) < 1e-6:
            continue                                   # marker segment: hosts node objects (read from the node)
        band = any(o in BAND_OBJECTS for o in objs)
        wall_att = next((x for x in atts if (x.get("objectId") == "wall-with-math")), None)
        op_att = next((x for x in atts if x.get("objectId") in OPENING_KIND), None)
        rec = {"id": s["id"], "a": [round(a[0], 4), round(a[1], 4)], "b": [round(b[0], 4), round(b[1], 4)],
               "thickness": round(float(s.get("thickness") or 0) / ppm, 4), "layer": s.get("layer", ""),
               "label": s.get("label", ""), "height": float((wall_att or {}).get("params", {}).get("height") or 0) or None,
               "opening": None}
        if op_att:
            pr = op_att.get("params") or {}
            rec["opening"] = {"kind": OPENING_KIND[op_att["objectId"]], "width": round(math.hypot(*sub(b, a)), 4),
                              "sill": float(pr.get("sillHeight", 0) or 0), "lintel": float(pr.get("lintelHeight", 2.1) or 2.1),
                              "leaves": pr.get("leaves", "Single"), "panes": int(pr.get("panes", 0) or 0),
                              "hinge": pr.get("hinge"), "swing": pr.get("swing"), "flip": bool(op_att.get("flip"))}
        if band and rec["thickness"] > 0.02: walls.append(rec)
        else: others.append(rec)
    for n in L.get("nodes", []):
        for x in n.get("attachments") or []:
            oid = x.get("objectId") or stem(x.get("objectPath", ""))
            if oid in SKIP_OBJECTS: continue
            pr = x.get("params") or {}
            k = kind_of(oid); cat, hdef, fdef = OBJECT_KIND.get(k, ("furniture", 0.8, (0.6, 0.6)))
            L_ = float(pr.get("length") or pr.get("width") or pr.get("diameter") or fdef[0])
            D_ = float(pr.get("depth") or pr.get("breadth") or pr.get("diameter") or fdef[1])
            objects.append({"id": x.get("id") or n["id"], "node": n["id"], "object": oid, "kind": k, "category": cat,
                            "at": [round(n["x"] / ppm, 4), round(n["y"] / ppm, 4)],
                            "rotation": float(pr.get("rotation") or 0), "length": round(L_, 3), "depth": round(D_, 3),
                            "height": float(pr.get("height") or hdef), "label": pr.get("label") or x.get("label") or ""})
    spaces = []
    for sp in L.get("spaces", []):
        ring = [P(i) for i in sp.get("nodeIds", []) if i in nodes]
        if len(ring) < 3: continue
        spaces.append({"id": sp["id"], "label": sp.get("label") or sp["id"], "roomType": sp.get("roomType", "room"),
                       "ring": [[round(p[0], 4), round(p[1], 4)] for p in ring], "area": round(abs(area(ring)), 3)})
    return {"ppm": ppm, "level": level_id, "walls": walls, "others": others, "objects": objects, "spaces": spaces}

# ---------- wall runs ----------
def wall_runs(walls, tol_angle=0.01, tol_off=0.06, gap=0.08):
    groups = []
    for w in walls:
        a, b = tuple(w["a"]), tuple(w["b"]); d = norm(sub(b, a))
        if d[1] < -1e-9 or (abs(d[1]) < 1e-9 and d[0] < 0): d = (-d[0], -d[1])     # canonical direction
        n = (-d[1], d[0]); off = dot(n, a)
        g = next((g for g in groups if abs(g["d"][0] * d[1] - g["d"][1] * d[0]) < tol_angle and dot(g["d"], d) > 0 and abs(g["off"] - off) < tol_off), None)
        if not g: g = {"d": d, "n": n, "off": off, "items": []}; groups.append(g)
        t0, t1 = sorted((dot(g["d"], a), dot(g["d"], b))); g["items"].append((t0, t1, w))
    runs = []
    for g in groups:
        items = sorted(g["items"], key=lambda x: x[0]); cur = None
        for t0, t1, w in items:
            if cur and t0 <= cur["t1"] + gap: cur["t1"] = max(cur["t1"], t1); cur["walls"].append(w)
            else:
                cur = {"t0": t0, "t1": t1, "walls": [w]}; runs.append((g, cur))
    out = []
    for i, (g, r) in enumerate(runs):
        p0 = add(mul(g["d"], r["t0"]), mul(g["n"], g["off"])); p1 = add(mul(g["d"], r["t1"]), mul(g["n"], g["off"]))
        hs = [w["height"] for w in r["walls"] if w.get("height")]
        out.append({"id": f"R{i + 1:02d}", "a": [round(p0[0], 4), round(p0[1], 4)], "b": [round(p1[0], 4), round(p1[1], 4)],
                    "length": round(r["t1"] - r["t0"], 4), "height": max(hs) if hs else None,
                    "thickness": max(w["thickness"] for w in r["walls"]), "walls": [w["id"] for w in r["walls"]],
                    "glazed": all((w.get("opening") or {}).get("kind") in ("window", "door") for w in r["walls"]) and any((w.get("opening") or {}).get("kind") == "window" for w in r["walls"])})
    return out

def facing(run, spaces):
    """Which side of the run the scoped spaces are on. Returns (space ids touched, inward normal) or ([], None)."""
    a, b = tuple(run["a"]), tuple(run["b"]); d = norm(sub(b, a)); n = (-d[1], d[0])
    eps = max(0.12, run["thickness"] / 2 + 0.08); touched = {1: set(), -1: set()}
    for k in range(1, 20):
        p = add(a, mul(sub(b, a), k / 20))
        for sgn in (1, -1):
            q = add(p, mul(n, sgn * eps))
            for sp in spaces:
                if inside(q, sp["ring"]): touched[sgn].add(sp["id"])
    sgn = 1 if len(touched[1]) >= len(touched[-1]) else -1
    if not touched[sgn]: return [], None
    return sorted(touched[sgn]), (n[0] * sgn, n[1] * sgn)

def view_frame(run, inward):
    """Viewer stands on the inward side, faces the wall. Along-axis t runs viewer-left -> viewer-right.
    Plan frame is y-down, so the viewer's right of facing f is (-f.y, f.x)."""
    f = (-inward[0], -inward[1]); right = (-f[1], f[0])
    a, b = tuple(run["a"]), tuple(run["b"])
    origin = a if dot(sub(b, a), right) > 0 else b
    return {"origin": [round(origin[0], 4), round(origin[1], 4)], "right": [round(right[0], 6), round(right[1], 6)],
            "inward": [round(inward[0], 6), round(inward[1], 6)]}

def compass(inward):
    """Name a wall by the direction the viewer looks (plan up = 'north' by drawing convention)."""
    f = (-inward[0], -inward[1]); ang = math.degrees(math.atan2(-f[1], f[0])) % 360   # y-down -> math angle
    names = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"]
    return names[int(((ang + 22.5) % 360) // 45)]

def build(canvas, scope_space_ids=None, level=None):
    g = read_canvas(canvas, level)
    spaces = g["spaces"] if not scope_space_ids else [s for s in g["spaces"] if s["id"] in scope_space_ids]
    runs = []
    for r in wall_runs(g["walls"]):
        ids, inward = facing(r, spaces)
        if not ids: continue
        r.update({"spaces": ids, "frame": view_frame(r, inward), "looks": compass(inward)})
        runs.append(r)
    # letter elevations clockwise from the top-left as a reader scans the plan
    cx, cy = centroid([tuple(p) for s in spaces for p in s["ring"]]) if spaces else (0, 0)
    def ang(r):
        m = ((r["a"][0] + r["b"][0]) / 2 - cx, (r["a"][1] + r["b"][1]) / 2 - cy)
        return (math.degrees(math.atan2(m[1], m[0])) + 135) % 360
    for i, r in enumerate(sorted(runs, key=ang)): r["letter"] = chr(65 + i)
    runs.sort(key=lambda r: r["letter"])
    xs = [p[0] for s in spaces for p in s["ring"]] or [0]; ys = [p[1] for s in spaces for p in s["ring"]] or [0]
    objs = [o for o in g["objects"] if not spaces or any(inside(tuple(o["at"]), s["ring"]) for s in spaces) or o["kind"] == "column"]
    return {"schema": "spacebrief-geo/1", "ppm": g["ppm"], "level": g["level"],
            "scope": [s["id"] for s in spaces], "bounds": [min(xs), min(ys), max(xs), max(ys)],
            "spaces_all": [{"id": s["id"], "label": s["label"], "area": s["area"]} for s in g["spaces"]],
            "spaces": spaces, "walls": g["walls"], "objects": objs, "runs": runs}
