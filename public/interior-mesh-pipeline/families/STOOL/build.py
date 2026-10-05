"""Family STOOL — solid drum stool with eased edges and a slight waist. STATUS: implemented (reference family)."""
import math
from core import geom

def build(p, name, coll):
    R, H, e = p["L"] / 2, p["H"], 8
    prof = [(0, 0)]
    for i in range(4):
        a = -math.pi / 2 + (math.pi / 2) * i / 3; prof.append((R - e + e * math.cos(a), e + e * math.sin(a)))
    for i in range(1, 8):
        t = i / 8; prof.append((R * (1 - 0.04 * math.sin(math.pi * t)), e + (H - 2 * e) * t))
    for i in range(4):
        a = (math.pi / 2) * i / 3; prof.append((R - e + e * math.cos(a), H - e + e * math.sin(a)))
    prof.append((0, H))
    root = geom.empty_root(name, coll)
    bm = geom.new(); geom.revolve(bm, prof, segments=64); geom.to_object(name + "_body", bm, coll, root)
    return root
