"""Stack a single-storey Library design into a 2.5-storey multi-level plan (schemaVersion 2).

  Ground floor (+0)        the design as-is
  First floor  (+slab)     a copy, every id prefixed "L1-" (a typical floor); scene objects
                           (cameras, render-look, exterior context, north arrow) stay on the ground floor only
  Half storey  (+2·slab)   only the KEEP spaces (stair head block) with the walls on their boundary and the
                           objects inside them, plus an OPEN TERRACE over the footprint with 1 m parapets

usage: python stack_design.py <design.json> <out.json> [--keep "STAIRCASE,PASSAGE"] [--lite]

  --lite  keep only structure, openings, floors and the main furniture (~1/3 of the objects): the editor
          evaluates every attachment on load, and trims / services / decor are most of the count
"""
import copy, json, sys

src, out = sys.argv[1], sys.argv[2]
KEEP = [s.strip() for s in (sys.argv[sys.argv.index("--keep") + 1] if "--keep" in sys.argv else "STAIRCASE,PASSAGE").split(",")]
base = json.load(open(src, encoding="utf-8"))
ppm = base["settings"]["pixelsPerMeter"]
walls = [a for s in base["segments"] for a in s.get("attachments", []) if a["objectId"] == "wall-with-math"]
SLAB = max((a["params"].get("height", 0) for a in walls), default=3.0) or 3.0
SCENE = {"camera-with-math", "render-look-with-math", "exterior-context-with-math", "north-arrow-with-math", "backplate-plane-with-math"}
GEOM_KEYS = ["nodes", "segments", "spaces", "imageUnderlay", "graphAttrs"]
LITE = "--lite" in sys.argv
LITE_KEEP = {f"{k}-with-math" for k in ["wall", "door", "window", "room", "tessellation", "staircase", "bed", "wardrobe", "nightstand",
             "tv-unit", "desk", "chair", "toilet", "washbasin", "shower", "ceiling-fan", "camera", "render-look", "north-arrow"]}


def prefixed(level, p):
    """Copy with every id prefixed, and every reference to an id rewritten to match."""
    L = copy.deepcopy(level)
    f = lambda i: f"{p}{i}"
    for n in L["nodes"]:
        n["id"] = f(n["id"])
        for a in n.get("attachments", []): a["id"] = f(a["id"])
    for s in L["segments"]:
        s["id"], s["fromNodeId"], s["toNodeId"] = f(s["id"]), f(s["fromNodeId"]), f(s["toNodeId"])
        for a in s.get("attachments", []): a["id"] = f(a["id"])
    for s in L["spaces"]:
        s["id"], s["nodeIds"] = f(s["id"]), [f(i) for i in s["nodeIds"]]
        for a in s.get("attachments", []): a["id"] = f(a["id"])
    ga = L.get("graphAttrs") or {}
    if "nodes" in ga:  # keyed by "<segId>:end|<segId>:start"
        ga["nodes"] = {"|".join(f(t) for t in k.split("|")): v for k, v in ga["nodes"].items()}
    for kind in ("segments", "spaces"):
        if kind in ga: ga[kind] = {f(k): v for k, v in ga[kind].items()}
    return L


def drop_scene_objects(L, drop=lambda oid: oid in SCENE):
    """Remove node-hosted objects matching `drop` and their marker segments / graphAttrs entries."""
    gone = set()
    for n in L["nodes"]:
        keep = [a for a in n.get("attachments", []) if not drop(a["objectId"])]
        if len(keep) != len(n.get("attachments", [])): gone.add(n["id"])
        if keep: n["attachments"] = keep
        else: n.pop("attachments", None)
    markers = {s["id"] for s in L["segments"] if s["fromNodeId"] == s["toNodeId"] and s["fromNodeId"] in gone}
    L["segments"] = [s for s in L["segments"] if s["id"] not in markers]
    ga = L.get("graphAttrs", {}).get("nodes", {})
    for k in [k for k in ga if any(t.split(":")[0] in markers for t in k.split("|"))]: del ga[k]
    return L


def in_poly(x, y, pts):
    r = False
    for i in range(len(pts)):
        (xi, yi), (xj, yj) = pts[i], pts[i - 1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: r = not r
    return r


def on_ring(x, y, pts, tol=2.0):
    for i in range(len(pts)):
        (ax, ay), (bx, by) = pts[i - 1], pts[i]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy or 1
        t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / L2))
        if (ax + t * dx - x) ** 2 + (ay + t * dy - y) ** 2 <= tol * tol: return True
    return False


def half_storey(level):
    L = drop_scene_objects(copy.deepcopy(level))
    N = {n["id"]: n for n in L["nodes"]}
    keep_sp = [s for s in L["spaces"] if s.get("label") in KEEP]
    if not keep_sp: sys.exit(f"no space labelled {KEEP}; have {[s.get('label') for s in L['spaces']]}")
    rings = [[(N[i]["x"], N[i]["y"]) for i in s["nodeIds"]] for s in keep_sp]
    xy = lambda i: (N[i]["x"], N[i]["y"])
    inside = lambda i: any(in_poly(*xy(i), r) for r in rings)
    onb = lambda i: any(on_ring(*xy(i), r) for r in rings)
    segs = []
    for s in L["segments"]:
        a, b = s["fromNodeId"], s["toNodeId"]
        if a == b:  # object marker — keep with its object
            if inside(a): segs.append(s)
        elif onb(a) and onb(b):
            mx, my = [(p + q) / 2 for p, q in zip(xy(a), xy(b))]
            if any(on_ring(mx, my, r) for r in rings): segs.append(s)
    used = {i for s in segs for i in (s["fromNodeId"], s["toNodeId"])} | {i for s in keep_sp for i in s["nodeIds"]}
    nodes = []
    for n in L["nodes"]:
        if n["id"] in used or (n.get("attachments") and inside(n["id"])):
            if n["id"] not in used and not inside(n["id"]): n.pop("attachments", None)
            nodes.append(n)
    # open terrace + parapet over the footprint of every habitable space
    xs = [N[i]["x"] for s in L["spaces"] for i in s["nodeIds"] if not str(s.get("label", "")).startswith("OPEN")]
    ys = [N[i]["y"] for s in L["spaces"] for i in s["nodeIds"] if not str(s.get("label", "")).startswith("OPEN")]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    corners = [("T-c0", x0, y0), ("T-c1", x1, y0), ("T-c2", x1, y1), ("T-c3", x0, y1)]
    nodes += [{"id": i, "x": x, "y": y, "layer": "0"} for i, x, y in corners]
    for k in range(4):
        a, b = corners[k][0], corners[(k + 1) % 4][0]
        segs.append({"id": f"T-parapet{k}", "fromNodeId": a, "toNodeId": b, "layer": "wall", "thickness": 0.15 * ppm,
                     "color": "#1e293b", "mode": "fill", "method": "center", "segmentType": "line", "label": "Parapet",
                     "attachments": [{"id": f"T-att-parapet{k}", "objectId": "wall-with-math", "objectPath": "Objects/Architectural/wall.json",
                                      "params": {"thickness": 0.15, "height": 1.0, "mode": "Buffered", "hatch": False, "fitMode": "Fill segment"}, "t": 0.5, "flip": False}]})
    terrace = {"id": "T-terrace", "nodeIds": [c[0] for c in corners], "layer": "space", "label": "OPEN TERRACE", "showLabel": True,
               "roomType": "room", "fill": "rgba(14,165,233,0.10)", "stroke": "#0EA5E9",
               "attachments": [{"id": "T-att-tiles", "objectId": "tessellation-with-math", "objectPath": "Objects/Architectural/tessellation.json",
                                "t": 0.5, "flip": False, "params": {"pattern": "Square", "cellSize": 0.6, "cellLength": 0, "joint": 0.003, "angle": 0,
                                                                   "originCorner": "SW", "fitMode": "Clip to boundary", "height": 0.01, "materialPath": "Masonry/stone.json"}}]}
    seg_ids = {s["id"] for s in segs}
    ga = L.get("graphAttrs", {})
    ga["nodes"] = {k: v for k, v in ga.get("nodes", {}).items() if all(t.split(":")[0] in seg_ids for t in k.split("|"))}
    if "segments" in ga: ga["segments"] = {k: v for k, v in ga["segments"].items() if k in seg_ids}
    sp_ids = {s["id"] for s in keep_sp}
    if "spaces" in ga: ga["spaces"] = {k: v for k, v in ga["spaces"].items() if k in sp_ids}
    L.update(nodes=nodes, segments=segs, spaces=keep_sp + [terrace], graphAttrs=ga, imageUnderlay=None)
    return L


geom = {k: base.get(k) for k in GEOM_KEYS}
if LITE:
    geom = drop_scene_objects(copy.deepcopy(geom), drop=lambda oid: oid not in LITE_KEEP)
    for key in ("segments", "spaces"):
        for x in geom[key]:
            if x.get("attachments"):
                x["attachments"] = [a for a in x["attachments"] if a["objectId"] in LITE_KEEP]
                if not x["attachments"]: del x["attachments"]
    # nodes that only existed to host a dropped object would draw as stray dots
    used = {i for sg in geom["segments"] for i in (sg["fromNodeId"], sg["toNodeId"])} | {i for sp in geom["spaces"] for i in sp["nodeIds"]}
    geom["nodes"] = [n for n in geom["nodes"] if n["id"] in used or n.get("attachments")]
ground = geom
first = drop_scene_objects(prefixed(geom, "L1-"))
first["imageUnderlay"] = None
half = prefixed(half_storey(geom), "L2-")
plan = {
    "schemaVersion": 2,
    "settings": {**base["settings"], "keywords": f"2.5-storey stack of {src.split('/')[-1]}: ground + typical first floor + stair-head half storey with open terrace"},
    "nodes": [], "segments": [], "spaces": [], "moodboards": base.get("moodboards", []),
    "layers": base.get("layers", []), "imageUnderlay": None, "activeLevelId": "L0",
    "levels": [
        {"id": "L0", "name": "Ground floor", "elevation": 0.0, "height": SLAB, **ground},
        {"id": "L1", "name": "First floor", "elevation": SLAB, "height": SLAB, **first},
        {"id": "L2", "name": "Terrace (half storey)", "elevation": 2 * SLAB, "height": SLAB, **half},
    ],
}
for k, v in base.items():  # any other project-level key (custom types …) rides at the top
    if k not in plan and k not in GEOM_KEYS: plan[k] = v
json.dump(plan, open(out, "w", encoding="utf-8"))
for l in plan["levels"]:
    atts = sum(len(x.get("attachments", [])) for key in ("nodes", "segments", "spaces") for x in l[key])
    print(f"{l['name']:24s} +{l['elevation']:.2f}  nodes {len(l['nodes']):4d}  segments {len(l['segments']):4d}  spaces {len(l['spaces']):3d}  objects {atts}")
print("slab", SLAB, "wrote", out)
