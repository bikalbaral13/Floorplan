"""Test fixture: a simple 2BHK house, 2.5 storeys, in the multi-level plan format (schemaVersion 2).

10 x 9 m footprint, 50 px/m. Ground: living, kitchen, dining, toilet, stair. First: 2 bedrooms, toilet,
lobby, stair. Half storey (+6.0): study, stair head, L-shaped open terrace with 1 m parapets.
"""
import json, sys

PPM = 50
OX, OY = 100, 100          # px offset of the footprint origin
T = 0.2 * PPM              # wall thickness px


def P(x, y):
    return (round(OX + x * PPM, 3), round(OY + y * PPM, 3))


def level(lid, name, elev, height, rooms, openings, furniture, parapets=(), open_spaces=()):
    """rooms: [(label, x0,y0,x1,y1)]; openings: [(kind, x0,y0,x1,y1 of host line, centre-along, width)]."""
    # every rectangle edge, split at every breakpoint on that line
    xs, ys = set(), set()
    for _, x0, y0, x1, y1 in rooms:
        xs |= {x0, x1}; ys |= {y0, y1}
    units = set()
    for _, x0, y0, x1, y1 in rooms:
        for y in (y0, y1):
            pts = sorted(v for v in xs if x0 <= v <= x1)
            units |= {(a, y, b, y) for a, b in zip(pts, pts[1:])}
        for x in (x0, x1):
            pts = sorted(v for v in ys if y0 <= v <= y1)
            units |= {(x, a, x, b) for a, b in zip(pts, pts[1:])}
    pieces = []  # (kind, x0,y0,x1,y1, extra)
    for u in sorted(units):
        x0, y0, x1, y1 = u
        horiz = y0 == y1

        def on_unit(o):
            _, hx0, hy0, hx1, hy1, c, w = o
            if horiz != (hy0 == hy1): return False
            if horiz and hy0 != y0: return False
            if not horiz and hx0 != x0: return False
            lo, hi = (x0, x1) if horiz else (y0, y1)
            return lo <= c - w / 2 and c + w / 2 <= hi
        cuts = [o for o in openings if on_unit(o)]
        a0, a1 = (x0, x1) if horiz else (y0, y1)
        spans = []
        for kind, *_l, c, w in sorted(cuts, key=lambda o: o[5]):
            spans.append((c - w / 2, c + w / 2, kind))
        cur = a0
        for s0, s1, kind in spans:
            if s0 > cur: pieces.append(("wall", cur, s0))
            pieces.append((kind, s0, s1)); cur = s1
        if cur < a1: pieces.append(("wall", cur, a1))
        # convert the along-line spans back to 2D
        for i in range(len(pieces)):
            k, s0, s1 = pieces[i][:3]
            if len(pieces[i]) == 3:
                pieces[i] = (k, *((s0, y0, s1, y0) if horiz else (x0, s0, x0, s1)), {})
    for x0, y0, x1, y1 in parapets:
        pieces.append(("wall", x0, y0, x1, y1, {"extrude3dHeightM": 1.0, "extrude3dDir": "up", "label": "Parapet"}))

    nodes, nid = [], {}
    def node(x, y):
        k = P(x, y)
        if k not in nid:
            nid[k] = f"{lid}-n{len(nid)}"
            nodes.append({"id": nid[k], "x": k[0], "y": k[1], "layer": "0"})
        return nid[k]

    segs = []
    for i, (kind, x0, y0, x1, y1, extra) in enumerate(pieces):
        seg = {"id": f"{lid}-s{i}", "fromNodeId": node(x0, y0), "toNodeId": node(x1, y1), "layer": "0",
               "thickness": T, "color": "#334155", "mode": "fill", "method": "center", "segmentType": kind}
        if kind == "window": seg.update({"sillHeightM": 0.9, "lintelHeightM": 2.1})
        if kind == "door": seg.update({"lintelHeightM": 2.1})
        seg.update(extra)
        segs.append(seg)

    spaces = []
    for i, (label, x0, y0, x1, y1) in enumerate(rooms):
        ring = [node(x0, y0), node(x1, y0), node(x1, y1), node(x0, y1)]
        spaces.append({"id": f"{lid}-sp{i}", "nodeIds": ring, "layer": "0", "label": label, "showLabel": True,
                       "roomType": "room", "fill": "rgba(34,197,94,0.15)", "stroke": "#16A34A"})
    for j, (label, pts) in enumerate(open_spaces):
        spaces.append({"id": f"{lid}-open{j}", "nodeIds": [node(x, y) for x, y in pts], "layer": "0", "label": label,
                       "showLabel": True, "roomType": "room", "fill": "rgba(14,165,233,0.12)", "stroke": "#0EA5E9"})

    furn = []
    for i, (t, x, y, rot) in enumerate(furniture):
        px, py = P(x, y)
        furn.append({"id": f"{lid}-f{i}", "type": t, "x": px, "y": py, "rotation": rot, "scaleX": 1, "scaleY": 1, "layerId": "0"})

    return {"id": lid, "name": name, "elevation": elev, "height": height,
            "nodes": nodes, "segments": segs, "spaces": spaces, "furniture": furn, "imageUnderlay": None}


W, D, CY = 10, 9, 5
ground = level("L0", "Ground floor", 0.0, 3.0,
    rooms=[("LIVING", 0, 0, 6, CY), ("KITCHEN", 6, 0, 10, CY), ("TOILET", 0, CY, 3, D), ("DINING", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("door", 0, 0, 6, 0, 1.6, 1.0),        # main entrance
              ("window", 0, 0, 6, 0, 4.5, 1.5), ("window", 6, 0, 10, 0, 8.0, 1.2),
              ("window", 0, 0, 0, 5, 2.5, 1.5), ("window", 10, 0, 10, 5, 2.5, 1.2),
              ("window", 0, 5, 0, 9, 7.0, 0.6), ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0),
              ("door", 3, 5, 6, 5, 4.5, 0.9), ("door", 6, 5, 7, 5, 6.5, 0.8),
              ("door", 3, 5, 3, 9, 6.2, 0.75), ("door", 7, 5, 7, 9, 6.2, 0.9)],
    furniture=[("sofa", 3.0, 1.0, 0), ("table", 3.0, 2.6, 0), ("chair", 1.2, 2.6, 90),
               ("table", 5.0, 7.2, 0), ("chair", 4.5, 6.4, 0), ("chair", 5.5, 6.4, 0), ("chair", 4.5, 8.0, 180), ("chair", 5.5, 8.0, 180),
               ("table", 8.0, 4.2, 0)])
first = level("L1", "First floor", 3.0, 3.0,
    rooms=[("BEDROOM 1", 0, 0, 6, CY), ("BEDROOM 2", 6, 0, 10, CY), ("TOILET", 0, CY, 3, D), ("LOBBY", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("window", 0, 0, 6, 0, 4.5, 1.5), ("window", 0, 0, 0, 5, 2.5, 1.2),
              ("window", 6, 0, 10, 0, 8.0, 1.5), ("window", 10, 0, 10, 5, 2.5, 1.2),
              ("window", 0, 5, 0, 9, 7.0, 0.6), ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0),
              ("door", 3, 5, 6, 5, 4.5, 0.9), ("door", 6, 5, 7, 5, 6.5, 0.8),
              ("door", 3, 5, 3, 9, 6.2, 0.75), ("door", 7, 5, 7, 9, 6.2, 0.9)],
    furniture=[("bed", 3.0, 1.4, 0), ("chair", 5.2, 4.2, 0), ("table", 5.2, 3.5, 0),
               ("bed", 8.0, 1.6, 90), ("chair", 9.3, 4.2, 0)])
half = level("L2", "Terrace (half storey)", 6.0, 2.7,
    rooms=[("STUDY", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("door", 3, 5, 7, 5, 5.0, 0.9), ("door", 7, 5, 10, 5, 8.5, 0.9),
              ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0), ("window", 3, 5, 3, 9, 7.0, 1.0)],
    furniture=[("table", 5.0, 7.5, 0), ("chair", 5.0, 6.8, 0), ("sofa", 4.0, 8.4, 180)],
    parapets=[(0, 0, 10, 0), (0, 0, 0, 9), (0, 9, 3, 9), (10, 0, 10, 5)],
    open_spaces=[("OPEN TERRACE", [(0, 0), (10, 0), (10, 5), (3, 5), (3, 9), (0, 9)])])

plan = {
    "schemaVersion": 2,
    "settings": {"units": "m", "northbearing": 0, "pixelsPerMeter": PPM, "keywords": "test 2BHK, 2.5 storeys"},
    "nodes": [], "segments": [], "spaces": [], "moodboards": [],
    "layers": [{"id": "0", "name": "0", "color": "#334155", "visible": True, "locked": False, "order": 0}],
    "imageUnderlay": None,
    "activeLevelId": "L0",
    "levels": [ground, first, half],
}
out = sys.argv[1]
json.dump(plan, open(out, "w"), indent=1)
for l in plan["levels"]:
    kinds = {}
    for s in l["segments"]: kinds[s["segmentType"]] = kinds.get(s["segmentType"], 0) + 1
    print(l["name"], "+%.1f" % l["elevation"], kinds, len(l["spaces"]), "spaces", len(l["furniture"]), "furniture")
print("wrote", out)
