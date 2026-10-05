"""Family TABLE_ROUND — round top on a drum or pedestal base. STATUS: implemented (reference family).
Contract: build(p, name, coll) -> root at origin, Z up, front -Y, pivot bottom-centre. Geometry only.
"""
import math, re
from core import geom

def _num(v, default):
    m = re.search(r"[\d.]+", str(v)); return float(m.group()) if m else default

def eased_disc_profile(R, z0, z1, e, steps=4):
    """(r, z) profile of a disc from z0 to z1 with eased (rounded) top and bottom edges of radius e."""
    e = min(e, (z1 - z0) / 2 - 0.1, R / 4)
    prof = [(0, z0)]
    for i in range(steps + 1):                       # bottom edge arc
        a = -math.pi / 2 + (math.pi / 2) * i / steps
        prof.append((R - e + e * math.cos(a), z0 + e + e * math.sin(a)))
    for i in range(steps + 1):                       # top edge arc
        a = (math.pi / 2) * i / steps
        prof.append((R - e + e * math.cos(a), z1 - e + e * math.sin(a)))
    prof.append((0, z1))
    return prof

def build(p, name, coll):
    R, H, tt = p["L"] / 2, p["H"], p["top_t"]
    e = _num(p.get("edge"), 6)
    root = geom.empty_root(name, coll)
    bm = geom.new(); geom.revolve(bm, eased_disc_profile(R, H - tt, H, e), segments=96)
    geom.to_object(name + "_top", bm, coll, root)
    base = str(p.get("base", "drum")).lower()
    bm = geom.new()
    if "pedestal" in base:
        geom.revolve(bm, eased_disc_profile(0.3 * p["L"], 0, 20, 4), segments=64)
        geom.cylinder(bm, 0, 0, 20, H - tt - 20, 70, segments=48)
    else:
        geom.revolve(bm, eased_disc_profile(0.45 * p["L"], 0, H - tt, 3), segments=96)
    geom.to_object(name + "_base", bm, coll, root)
    return root
