"""Family POUF_ROUND — soft revolved drum: rounded foot, slight side bulge, big rounded top edge, crowned seat.
STATUS: implemented (reference family). Pivot bottom-centre."""
import math
from core import geom

def build(p, name, coll):
    R, H = p["L"] / 2, p["H"]
    top_r = min(p.get("bevel", 60), H / 2 - 10, R / 2)
    foot_r, bulge, crown = 20, min(6, R * 0.03), min(12, H * 0.05)
    prof = [(0, 0)]
    for i in range(5):                                              # rounded foot
        a = -math.pi / 2 + (math.pi / 2) * i / 4
        prof.append((R - foot_r + foot_r * math.cos(a), foot_r + foot_r * math.sin(a)))
    zs, ze = foot_r, H - crown - top_r
    for i in range(1, 8):                                           # bulging side
        t = i / 8; prof.append((R + bulge * math.sin(math.pi * t), zs + (ze - zs) * t))
    for i in range(9):                                              # rounded top edge
        a = (math.pi / 2) * i / 8
        prof.append((R - top_r + top_r * math.cos(a), ze + top_r * math.sin(a)))
    for i in range(1, 6):                                           # crowned seat
        t = i / 5; r = (R - top_r) * (1 - t); prof.append((r, H - crown + crown * math.sin(math.pi / 2 * t)))
    root = geom.empty_root(name, coll)
    bm = geom.new(); geom.revolve(bm, prof, segments=96); geom.to_object(name + "_body", bm, coll, root)
    return root
