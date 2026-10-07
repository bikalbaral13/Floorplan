"""GROUND_PATCH — lawn / pavers / concrete surface block on a polygon with an edging swept round it.

Body: prism_holes from top_z - 0.25 to top_z (lawn sits 150 mm above the road at +0.15 by default).
Edging (inside the polygon): brick-on-edge (115 wide, 30 mm proud, softened top) or a precast
concrete kerb (100 wide, 120 proud); none for driveways (they butt the lawn edging).
"""
from core.geom import MB, empty_root, part, ccw, cw

EDGES = {
    "brick": [(0, -0.15), (0.115, -0.15), (0.115, 0.03), (0.105, 0.04), (0.01, 0.04), (0, 0.03)],
    "kerb": [(0, -0.2), (0.1, -0.2), (0.1, 0.10), (0.08, 0.12), (0, 0.12)],
}

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    body, edge = MB(), MB(); top = p["top_z"]
    for outer, holes in geo["polygons"]:
        body.prism_holes(outer, holes, top - 0.25, top)
        prof = EDGES.get(p["edge"])
        if prof:
            prof = [(u, top + v) for u, v in prof]
            for ring in [ccw(outer)] + [cw(h) for h in holes]:
                edge.sweep([(x, y, 0.0) for x, y in ring], prof, closed=True)
    part(root, coll, p["surface"].capitalize(), body); part(root, coll, "Edging", edge)
    return root
