"""Test fixture: 2BHK house, 2.5 storeys, EVERYTHING a parametric library object.

Multi-level plan (schemaVersion 2) in the shapes the Floorplan Improver emits:
  walls     `line` segment + wall-with-math        (Objects/Architectural/wall.json, height = storey height)
  openings  `line` segment, isObjectOpening, + door-with-math / window-with-math
  furniture a node carrying the attachment + a zero-length marker segment + graphAttrs {"node-type":"object"}
  rooms     space + room-with-math + tessellation-with-math floor
Objects are referenced by `objectPath`, so the editor's importer fetches every definition from the Library.

usage: python make_house_pobj.py <out.json>
"""
import json, sys

PPM = 50
OX, OY = 100, 100
LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library"
OBJ = "Objects/Architectural/"


def P(x, y):
    return (round(OX + x * PPM, 3), round(OY + y * PPM, 3))


def level(lid, name, elev, height, rooms, openings, furniture, floors, parapets=(), open_spaces=()):
    nid, nodes, segs, spaces, ga = {}, [], [], [], {}
    n_att = [0]

    def att_id():
        n_att[0] += 1
        return f"{lid}-att{n_att[0]}"

    def node(x, y):
        k = P(x, y)
        if k not in nid:
            nid[k] = f"{lid}-n{len(nid)}"
            nodes.append({"id": nid[k], "x": k[0], "y": k[1], "layer": "0"})
        return nid[k]

    # unit edges of every room rectangle, split at every breakpoint on the line
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

    def add_seg(kind, x0, y0, x1, y1, wall_h=height, label=None):
        sid = f"{lid}-s{len(segs)}"
        length = abs(x1 - x0) + abs(y1 - y0)
        seg = {"id": sid, "fromNodeId": node(x0, y0), "toNodeId": node(x1, y1), "thickness": 0.2 * PPM,
               "color": "#1e293b", "mode": "fill", "method": "center", "segmentType": "line", "bufferStyle": "flat"}
        if kind == "wall":
            seg.update(layer="wall", attachments=[{"id": att_id(), "objectId": "wall-with-math", "objectPath": OBJ + "wall.json",
                       "params": {"thickness": 0.2, "height": wall_h, "mode": "Buffered", "hatch": False, "fitMode": "Fill segment"}, "t": 0.5, "flip": False}])
        elif kind == "door":
            seg.update(layer="door", isObjectOpening=True, attachments=[{"id": att_id(), "objectId": "door-with-math", "objectPath": OBJ + "door.json",
                       "params": {"width": round(length, 3), "leaves": "Single", "hinge": "left", "swing": "left", "openAngle": 90, "fitMode": "Fill segment", "frameDepth": 0.2, "lintelHeight": 2.1}, "t": 0.5, "flip": False}])
        elif kind == "window":
            seg.update(layer="window", isObjectOpening=True, attachments=[{"id": att_id(), "objectId": "window-with-math", "objectPath": OBJ + "window.json",
                       "params": {"width": round(length, 3), "fitMode": "Fill wall", "sillHeight": 0.9, "lintelHeight": 2.1, "wallDepth": 0.2, "panes": 2, "operation": "Casement", "showFrame": True}, "t": 0.5, "flip": False}])
        if label: seg["label"] = label
        segs.append(seg)

    for u in sorted(units):
        x0, y0, x1, y1 = u
        horiz = y0 == y1

        def on_unit(o):
            _, hx0, hy0, hx1, hy1, c, w = o
            if horiz != (hy0 == hy1): return False
            if (horiz and hy0 != y0) or (not horiz and hx0 != x0): return False
            lo, hi = (x0, x1) if horiz else (y0, y1)
            return lo <= c - w / 2 and c + w / 2 <= hi
        cur = x0 if horiz else y0
        end = x1 if horiz else y1
        for kind, *_h, c, w in sorted((o for o in openings if on_unit(o)), key=lambda o: o[5]):
            s0, s1 = c - w / 2, c + w / 2
            pt = (lambda a: (a, y0)) if horiz else (lambda a: (x0, a))
            if s0 > cur: add_seg("wall", *pt(cur), *pt(s0))
            add_seg(kind, *pt(s0), *pt(s1))
            cur = s1
        if cur < end:
            pt = (lambda a: (a, y0)) if horiz else (lambda a: (x0, a))
            add_seg("wall", *pt(cur), *pt(end))
    for x0, y0, x1, y1 in parapets:
        add_seg("wall", x0, y0, x1, y1, wall_h=1.0, label="Parapet")

    # rooms: space + room object + tile floor
    for i, (label, x0, y0, x1, y1) in enumerate(rooms):
        fl = floors.get(label, ("Square", 0.6, 0, "Finishes/marble.json"))
        spaces.append({"id": f"{lid}-sp{i}", "nodeIds": [node(x0, y0), node(x1, y0), node(x1, y1), node(x0, y1)], "layer": "space",
                       "label": label, "showLabel": True, "roomType": "room", "fill": "rgba(226,232,240,0.5)", "stroke": "#475569",
                       "attachments": [
                           {"id": att_id(), "objectId": "room-with-math", "objectPath": OBJ + "room.json", "params": {"color": "Grey"}, "t": 0, "flip": False},
                           {"id": att_id(), "objectId": "tessellation-with-math", "objectPath": OBJ + "tessellation.json", "t": 0.5, "flip": False,
                            "params": {"pattern": fl[0], "cellSize": fl[1], "cellLength": fl[2], "joint": 0.002, "angle": 0, "originCorner": "SW",
                                       "fitMode": "Clip to boundary", "height": 0.01, "materialPath": fl[3]}}]})
    for j, (label, pts) in enumerate(open_spaces):
        spaces.append({"id": f"{lid}-open{j}", "nodeIds": [node(x, y) for x, y in pts], "layer": "space", "label": label, "showLabel": True,
                       "roomType": "room", "fill": "rgba(14,165,233,0.12)", "stroke": "#0EA5E9",
                       "attachments": [{"id": att_id(), "objectId": "tessellation-with-math", "objectPath": OBJ + "tessellation.json", "t": 0.5, "flip": False,
                                        "params": {"pattern": "Square", "cellSize": 0.6, "cellLength": 0, "joint": 0.003, "angle": 0, "originCorner": "SW",
                                                   "fitMode": "Clip to boundary", "height": 0.01, "materialPath": "Masonry/stone.json"}}]})

    # furniture: node + attachment, marker segment, graphAttrs
    for stem, x, y, rot, params in furniture:
        n = f"{lid}-fn{len(ga)}"
        px, py = P(x, y)
        nodes.append({"id": n, "x": px, "y": py, "layer": "0", "attachments": [
            {"id": att_id(), "objectId": f"{stem}-with-math", "objectPath": f"{OBJ}{stem}.json",
             "params": {"rotation": rot, "anchorDir": "Center", "fitMode": "Off", **params}, "t": 0, "flip": False}]})
        mid = f"{lid}-obj{len(ga)}"
        segs.append({"id": mid, "fromNodeId": n, "toNodeId": n, "layer": "furniture", "thickness": 0.5, "color": "#1e293b",
                     "dashed": False, "mode": "line", "method": "center", "segmentType": "wall"})
        ga[f"{mid}:end|{mid}:start"] = {"node-type": "object"}

    return {"id": lid, "name": name, "elevation": elev, "height": height, "nodes": nodes, "segments": segs,
            "spaces": spaces, "imageUnderlay": None, "graphAttrs": {"nodes": ga}}


CY, D = 5, 9
WOOD = ("Brick", 0.2, 1.2, "Finishes/light-oak.json")
WET = ("Square", 0.3, 0, "Finishes/ceramic.json")
ground = level("L0", "Ground floor", 0.0, 3.0,
    rooms=[("LIVING", 0, 0, 6, CY), ("KITCHEN", 6, 0, 10, CY), ("TOILET", 0, CY, 3, D), ("DINING", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("door", 0, 0, 6, 0, 1.6, 1.0),
              ("window", 0, 0, 6, 0, 4.5, 1.5), ("window", 6, 0, 10, 0, 8.0, 1.2),
              ("window", 0, 0, 0, 5, 2.5, 1.5), ("window", 10, 0, 10, 5, 2.5, 1.2),
              ("window", 0, 5, 0, 9, 7.0, 0.6), ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0),
              ("door", 3, 5, 6, 5, 4.5, 0.9), ("door", 6, 5, 7, 5, 6.5, 0.8),
              ("door", 3, 5, 3, 9, 6.2, 0.75), ("door", 7, 5, 7, 9, 6.2, 0.9)],
    floors={"TOILET": WET, "KITCHEN": ("Square", 0.6, 0, "Finishes/marble.json")},
    furniture=[("sofa", 3.0, 4.3, 0, {}), ("table", 3.0, 3.0, 0, {"length": 1.0, "width": 0.5}), ("tv-unit", 3.0, 0.35, 180, {}),
               ("rug", 3.0, 3.0, 0, {}), ("plant-potted", 5.5, 0.5, 0, {}),
               ("kitchen-counter", 8.0, 0.4, 180, {"length": 3.4}), ("stove", 8.6, 0.4, 180, {}), ("refrigerator", 9.5, 4.4, 0, {}),
               ("table", 5.0, 7.2, 0, {"length": 1.6, "width": 0.9}), ("chair", 4.5, 6.5, 180, {}), ("chair", 5.5, 6.5, 180, {}),
               ("chair", 4.5, 7.9, 0, {}), ("chair", 5.5, 7.9, 0, {}),
               ("toilet", 0.45, 8.3, 0, {}), ("washbasin", 2.6, 8.7, 90, {}), ("ceiling-fan", 3.0, 2.5, 0, {})])
first = level("L1", "First floor", 3.0, 3.0,
    rooms=[("BEDROOM 1", 0, 0, 6, CY), ("BEDROOM 2", 6, 0, 10, CY), ("TOILET", 0, CY, 3, D), ("LOBBY", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("window", 0, 0, 6, 0, 4.5, 1.5), ("window", 0, 0, 0, 5, 2.5, 1.2),
              ("window", 6, 0, 10, 0, 8.0, 1.5), ("window", 10, 0, 10, 5, 2.5, 1.2),
              ("window", 0, 5, 0, 9, 7.0, 0.6), ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0),
              ("door", 3, 5, 6, 5, 4.5, 0.9), ("door", 6, 5, 7, 5, 6.5, 0.8),
              ("door", 3, 5, 3, 9, 6.2, 0.75), ("door", 7, 5, 7, 9, 6.2, 0.9)],
    floors={"BEDROOM 1": WOOD, "BEDROOM 2": WOOD, "TOILET": WET},
    furniture=[("bed", 2.2, 2.0, 0, {}), ("nightstand", 2.2, 0.3, 0, {}), ("wardrobe", 5.0, 0.35, 180, {"length": 1.6}),
               ("bed", 8.0, 2.0, 0, {}), ("wardrobe", 9.6, 3.8, 90, {"length": 1.2}), ("desk", 7.0, 4.6, 0, {}), ("chair", 7.0, 4.0, 0, {}),
               ("toilet", 0.45, 8.3, 0, {}), ("washbasin", 2.6, 8.7, 90, {}), ("shower", 0.6, 5.7, 0, {}),
               ("ceiling-fan", 3.0, 2.5, 0, {}), ("ceiling-fan", 8.0, 2.5, 0, {})])
half = level("L2", "Terrace (half storey)", 6.0, 2.7,
    rooms=[("STUDY", 3, CY, 7, D), ("STAIRCASE", 7, CY, 10, D)],
    openings=[("door", 3, 5, 7, 5, 5.0, 0.9), ("door", 7, 5, 10, 5, 8.5, 0.9),
              ("window", 3, 9, 7, 9, 5.0, 1.2), ("window", 10, 5, 10, 9, 7.0, 1.0), ("window", 3, 5, 3, 9, 7.0, 1.0)],
    floors={"STUDY": WOOD},
    furniture=[("desk", 5.0, 8.5, 180, {}), ("chair", 5.0, 7.8, 180, {}), ("shelf", 6.7, 7.0, 90, {}), ("armchair", 3.8, 5.8, 0, {}),
               ("planter-box", 1.0, 0.5, 0, {}), ("planter-box", 9.0, 0.5, 0, {}), ("plant-potted", 2.0, 2.0, 0, {})],
    parapets=[(0, 0, 10, 0), (0, 0, 0, 9), (0, 9, 3, 9), (10, 0, 10, 5)],
    open_spaces=[("OPEN TERRACE", [(0, 0), (10, 0), (10, 5), (3, 5), (3, 9), (0, 9)])])

layers = [{"id": i, "name": n, "color": c, "visible": True, "locked": False, "order": k}
          for k, (i, n, c) in enumerate([("0", "0", "#334155"), ("wall", "Wall", "#1e293b"), ("door", "Door", "#b45309"),
                                         ("window", "Window", "#0284c7"), ("space", "Space", "#16a34a"), ("furniture", "Furniture", "#7c3aed")])]
plan = {"schemaVersion": 2,
        "settings": {"library_path": LIB, "units": "m", "northbearing": 0, "pixelsPerMeter": PPM, "keywords": "test 2BHK, 2.5 storeys, parametric objects"},
        "nodes": [], "segments": [], "spaces": [], "moodboards": [], "layers": layers, "imageUnderlay": None,
        "activeLevelId": "L0", "levels": [ground, first, half]}
json.dump(plan, open(sys.argv[1], "w"), indent=1)
for l in plan["levels"]:
    c = {}
    for s in l["segments"] + l["spaces"] + l["nodes"]:
        for a in s.get("attachments", []): c[a["objectId"].replace("-with-math", "")] = c.get(a["objectId"].replace("-with-math", ""), 0) + 1
    print(l["name"], "+%.1f" % l["elevation"], sum(c.values()), "objects:", dict(sorted(c.items())))
print("wrote", sys.argv[1])
