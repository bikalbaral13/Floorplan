"""python tests/test_geometry.py — wall runs, viewing frames and elevation lettering on a synthetic room."""
import os, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from core import geometry as G
res = []
def check(c, m): res.append((bool(c), m))
ppm = 50
def node(i, x, y): return {"id": i, "x": x * ppm, "y": y * ppm}
def wall(i, a, b, extra=None):
    att = [{"id": i + "w", "objectId": "wall-with-math", "objectPath": "x", "params": {"height": 3.0}}] + ([extra] if extra else [])
    return {"id": i, "fromNodeId": a, "toNodeId": b, "thickness": 0.15 * ppm, "attachments": att}
# 6 x 4 room, door cut into the south wall (y = 4, plan y-down), y up the screen = north
nodes = [node("a", 0, 0), node("b", 6, 0), node("c", 6, 4), node("d1", 4, 4), node("d2", 3, 4), node("e", 0, 4)]
door = {"id": "dr", "objectId": "door-with-math", "objectPath": "x", "params": {"lintelHeight": 2.1}}
segs = [wall("n", "a", "b"), wall("e", "b", "c"), wall("s1", "c", "d1"), wall("sd", "d1", "d2", door), wall("s2", "d2", "e"), wall("w", "e", "a")]
canvas = {"schemaVersion": 1, "settings": {"pixelsPerMeter": ppm}, "nodes": nodes, "segments": segs, "spaces": [{"id": "r", "nodeIds": ["a", "b", "c", "e"], "label": "Room"}]}
g = G.build(canvas)
check(len(g["runs"]) == 4, f"four walls -> four runs (got {len(g['runs'])})")
south = next(r for r in g["runs"] if r["looks"] == "south")
check(len(south["walls"]) == 3 and abs(south["length"] - 6) < 1e-6, "the door and its two wall pieces chain into one 6 m run")
check({r["looks"] for r in g["runs"]} == {"north", "south", "east", "west"}, "each run is named by the direction the viewer looks")
n = next(r for r in g["runs"] if r["looks"] == "north")
check(n["frame"]["right"] == [1.0, 0.0] or n["frame"]["right"] == [1, 0], "looking north, the viewer's right is +x (east)")
check(n["frame"]["inward"][1] > 0, "the north wall's inward normal points into the room (y-down: +y)")
check(sorted(r["letter"] for r in g["runs"]) == list("ABCD"), "elevations are lettered A..D")
check(abs(g["spaces"][0]["area"] - 24) < 1e-6, "space area in m²")
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
