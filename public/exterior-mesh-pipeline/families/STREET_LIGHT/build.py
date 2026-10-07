"""STREET_LIGHT — instanced street light prototype; arm reaches along local +X (instance rotation
points it over the road). Concrete pedestal (chamfered), base plate with 4 anchor bolts + nuts,
octagonal tapered pole, swan-neck arm, LED luminaire housing with heat-sink fins, flat lens."""
import math
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    H, arm, lod = p["height"], p["arm"], int(p["lod"])
    M = {k: MB() for k in ("Pedestal", "Plate", "Pole", "Arm", "Housing", "Lens")}
    M["Pedestal"].ocbox((0, 0), (1, 0), 0.45, 0.45, -0.3, 0.45, 0.36, 0.36)
    M["Pedestal"].ocbox((0, 0), (1, 0), 0.36, 0.36, 0.45, 0.5, 0.33, 0.33)
    M["Plate"].ocbox((0, 0), (1, 0), 0.3, 0.3, 0.5, 0.52)
    if lod >= 2:
        for sx in (-1, 1):
            for sy in (-1, 1):
                M["Plate"].cyl(sx * 0.11, sy * 0.11, 0.52, 0.07, 0.012, 8)
                M["Plate"].tube([(sx * 0.11, sy * 0.11, 0.52), (sx * 0.11, sy * 0.11, 0.545)], [0.022, 0.022], 6)
    seg = 8 if lod >= 2 else 6
    M["Pole"].tube([(0, 0, 0.52), (0, 0, H * 0.5), (0, 0, H)], [0.085, 0.07, 0.05], seg)
    pts = [(0, 0, H - 0.1), (0.15, 0, H + 0.12), (0.4, 0, H + 0.25), (arm, 0, H + 0.3)]
    M["Arm"].tube(pts, [0.045, 0.04, 0.035, 0.03], seg)
    hx = arm + 0.3
    M["Housing"].hexa([(arm - 0.02, -0.13, H + 0.22), (hx + 0.25, -0.12, H + 0.25), (hx + 0.25, 0.12, H + 0.25), (arm - 0.02, 0.13, H + 0.22),
                       (arm - 0.02, -0.11, H + 0.36), (hx + 0.2, -0.1, H + 0.31), (hx + 0.2, 0.1, H + 0.31), (arm - 0.02, 0.11, H + 0.36)])
    if lod >= 2:
        for k in range(7):
            x = arm + 0.08 + k * 0.09
            M["Housing"].obox((x, -0.09), (x, 0.09), 0, 0.18, -0.006, 0.006, H + 0.3 - 0.06 * (x - arm) / (hx + 0.2 - arm), H + 0.36 - 0.05 * (x - arm) / (hx + 0.2 - arm))
    M["Lens"].hexa([(arm + 0.08, -0.1, H + 0.215), (hx + 0.18, -0.09, H + 0.24), (hx + 0.18, 0.09, H + 0.24), (arm + 0.08, 0.1, H + 0.215),
                    (arm + 0.08, -0.1, H + 0.225), (hx + 0.18, -0.09, H + 0.25), (hx + 0.18, 0.09, H + 0.25), (arm + 0.08, 0.1, H + 0.225)])
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
