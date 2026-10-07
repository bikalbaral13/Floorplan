"""BASEMENT — one basement level in world coordinates.

Slab: the level's floor (slab thick, openings where a ramp leaves it). Deck: the roof slab over the top
basement, just under the ground surfaces (openings over ramps from ground). Walls: every wall segment of
the level from the floor to wall_top (the underside of the slab above), split into Retaining (≥ 0.3 m,
the perimeter) and Walls (cores, partitions); each runs t/2 past both ends so corners close.
Parking: per stall, 100 mm painted lines (3 mm proud) on the two long sides and the head end, set
INSIDE the stall so neighbouring stalls never overlap, the aisle end left open; and a chamfered
precast wheel stop 1.65 m × 150 × 100 set 750 mm from the head end.
"""
import math
from core.geom import MB, empty_root, part, ccw

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    M = {k: MB() for k in ("Slab", "Deck", "Retaining", "Walls", "Markings", "WheelStops")}
    fz = p["floor_z"]
    for o, h in geo["floor"]: M["Slab"].prism_holes(o, h, fz - p["slab"], fz)
    for o, h in geo.get("deck", []): M["Deck"].prism_holes(o, h, p["deck_top"] - p["deck"], p["deck_top"])
    for w in geo["walls"]:
        t = w["t"]; L = math.dist(w["a"], w["b"])
        (M["Retaining"] if t >= 0.29 else M["Walls"]).obox(w["a"], w["b"], -t / 2, L + t / 2, -t / 2, t / 2, fz, p["wall_top"])
    for bay in geo.get("bays", []):
        ring = bay["ring"]; cw = ccw(ring) == list(ring)
        n = len(ring)
        for i in range(n):
            if i == bay["open"]: continue
            a, b = ring[i], ring[(i + 1) % n]
            L = math.dist(a, b)
            s0, s1 = (0.0, 0.10) if cw else (-0.10, 0.0)                     # inside the stall (left of a CCW edge)
            M["Markings"].obox(a, b, 0, L, s0, s1, fz, fz + 0.003)
        a, b = ring[bay["head"]], ring[(bay["head"] + 1) % n]
        hx, hy = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        cx, cy = sum(q[0] for q in ring) / n, sum(q[1] for q in ring) / n
        dx, dy = cx - hx, cy - hy; dl = math.hypot(dx, dy) or 1
        c = (hx + dx / dl * 0.75, hy + dy / dl * 0.75)
        M["WheelStops"].ocbox(c, (b[0] - a[0], b[1] - a[1]), 1.65, 0.15, fz, fz + 0.10, 1.6, 0.09)
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
