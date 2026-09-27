"""3BHK, 4.5 storeys (G+3 typical floors + stair-head half storey with open terrace). Walls, doors, windows only.

14 x 10 m footprint. Front: bedroom 1, living, kitchen/dining. Central lobby. Back: bedroom 2, toilet, stair, toilet, bedroom 3.
Reuses level() from make_house.py.  usage: python make_3bhk.py out.json
"""
import json, sys
src = open(__file__.replace("make_3bhk.py", "make_house.py"), encoding="utf-8").read()
exec(src[:src.index("W, D, CY")])

H = 3.0
ROOMS = [("BEDROOM 1", 0, 0, 4, 4.5), ("LIVING", 4, 0, 9.5, 4.5), ("KITCHEN / DINING", 9.5, 0, 14, 4.5),
         ("LOBBY", 0, 4.5, 14, 6),
         ("BEDROOM 2", 0, 6, 4, 10), ("TOILET 1", 4, 6, 5.8, 10), ("STAIRCASE", 5.8, 6, 8.8, 10),
         ("TOILET 2", 8.8, 6, 10.6, 10), ("BEDROOM 3", 10.6, 6, 14, 10)]
OPEN = [("door", 0, 4.5, 14, 4.5, 2.0, 0.9), ("door", 0, 4.5, 14, 4.5, 7.3, 1.2), ("door", 0, 4.5, 14, 4.5, 12.3, 0.9),
        ("door", 0, 6, 14, 6, 2.0, 0.9), ("door", 0, 6, 14, 6, 4.9, 0.75), ("door", 0, 6, 14, 6, 7.3, 1.2),
        ("door", 0, 6, 14, 6, 10.05, 0.7), ("door", 0, 6, 14, 6, 12.3, 0.9),
        ("window", 0, 0, 14, 0, 2.0, 1.5), ("window", 0, 0, 14, 0, 7.3, 2.0), ("window", 0, 0, 14, 0, 12.3, 1.5),
        ("window", 0, 10, 14, 10, 2.0, 1.5), ("window", 0, 10, 14, 10, 4.9, 0.6), ("window", 0, 10, 14, 10, 7.3, 1.2),
        ("window", 0, 10, 14, 10, 10.05, 0.6), ("window", 0, 10, 14, 10, 12.3, 1.5),
        ("window", 0, 0, 0, 10, 2.25, 1.2), ("window", 0, 0, 0, 10, 8.0, 1.2),
        ("window", 14, 0, 14, 10, 2.25, 1.2), ("window", 14, 0, 14, 10, 8.0, 1.2)]
ENTRY = [("door", 14, 0, 14, 10, 5.25, 1.0)]

names = ["Ground floor", "First floor", "Second floor", "Third floor"]
levels = [level(f"L{i}", n, i * H, H, ROOMS, OPEN + (ENTRY if i == 0 else [("window", 14, 0, 14, 10, 5.25, 1.0)]), [])
          for i, n in enumerate(names)]
levels.append(level("L4", "Terrace (half storey)", 4 * H, 2.7,
    rooms=[("STAIRCASE", 5.8, 6, 8.8, 10)],
    openings=[("door", 5.8, 6, 8.8, 6, 7.3, 1.0), ("window", 5.8, 10, 8.8, 10, 7.3, 1.2)],
    furniture=[],
    parapets=[(0, 0, 14, 0), (14, 0, 14, 10), (0, 0, 0, 10), (0, 10, 5.8, 10), (8.8, 10, 14, 10)],
    open_spaces=[("OPEN TERRACE", [(0, 0), (14, 0), (14, 10), (8.8, 10), (8.8, 6), (5.8, 6), (5.8, 10), (0, 10)])]))
for l in levels: l.pop("furniture")

# parametric objects on every segment (same shapes as make_house_pobj.py): wall / door / window -with-math
LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library"
OBJ = "Objects/Architectural/"
for l in levels:
    N = {n["id"]: n for n in l["nodes"]}
    for i, s in enumerate(l["segments"]):
        a, b = N[s["fromNodeId"]], N[s["toNodeId"]]
        length = round((abs(a["x"] - b["x"]) + abs(a["y"] - b["y"])) / PPM, 3)
        kind = s.pop("segmentType")
        for k in ("sillHeightM", "lintelHeightM", "extrude3dHeightM", "extrude3dDir"): s.pop(k, None)
        s.update(segmentType="line", bufferStyle="flat", color="#1e293b", layer=kind)
        aid = f"{s['id']}-att"
        if kind == "wall":
            h = 1.0 if s.get("label") == "Parapet" else l["height"]
            s["attachments"] = [{"id": aid, "objectId": "wall-with-math", "objectPath": OBJ + "wall.json", "t": 0.5, "flip": False,
                                 "params": {"thickness": 0.2, "height": h, "mode": "Buffered", "hatch": False, "fitMode": "Fill segment"}}]
        elif kind == "door":
            s.update(isObjectOpening=True, attachments=[{"id": aid, "objectId": "door-with-math", "objectPath": OBJ + "door.json", "t": 0.5, "flip": False,
                     "params": {"width": length, "leaves": "Double" if length >= 1.2 else "Single", "hinge": "left", "swing": "left", "openAngle": 90,
                                "fitMode": "Fill segment", "frameDepth": 0.2, "lintelHeight": 2.1}}])
        else:
            s.update(isObjectOpening=True, attachments=[{"id": aid, "objectId": "window-with-math", "objectPath": OBJ + "window.json", "t": 0.5, "flip": False,
                     "params": {"width": length, "fitMode": "Fill wall", "sillHeight": 1.8 if length <= 0.6 else 0.9, "lintelHeight": 2.1,
                                "wallDepth": 0.2, "panes": 2, "operation": "Casement", "showFrame": True}}])

plan = {"schemaVersion": 2,
        "settings": {"library_path": LIB, "units": "m", "northbearing": 0, "pixelsPerMeter": PPM, "keywords": "3BHK, 4.5 storeys, walls/doors/windows"},
        "nodes": [], "segments": [], "spaces": [], "moodboards": [],
        "layers": [{"id": i, "name": n, "color": c, "visible": True, "locked": False, "order": k} for k, (i, n, c) in enumerate(
            [("0", "0", "#334155"), ("wall", "Wall", "#1e293b"), ("door", "Door", "#b45309"), ("window", "Window", "#0284c7")])],
        "imageUnderlay": None, "activeLevelId": "L0", "levels": levels}
json.dump(plan, open(sys.argv[1], "w"), indent=1)
for l in levels:
    k = {}
    for s in l["segments"]: o = s["attachments"][0]["objectId"]; k[o] = k.get(o, 0) + 1
    print(l["name"], "+%.1f" % l["elevation"], k, len(l["spaces"]), "spaces")
