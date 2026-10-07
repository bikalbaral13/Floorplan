"""RAMP — two-lane vehicle ramp between two levels, world coordinates.

Geometry: top edge [t0, t1] at z_top and bottom edge [b0, b1] at z_bottom; t0–b0 and t1–b1 are the
long sides. Built INSIDE the footprint (the slabs above have an opening of exactly this footprint):
  Slab        200 mm inclined RC slab (surface z_top → z_bottom, soffit parallel)
  Grooves     anti-skid ribs 30 × 12 mm every 300 mm across each lane, following the slope
  Curbs       300 × 150 wheel-guard curbs on both sides + a 300 mm median (two lanes)
  SideWalls   200 mm walls on both long sides, from under the slab up to z_top + guard_h
              (retaining + guard parapet around the opening), weathered coping on top
  EndGuard    over the bottom end: a downstand / guard from z_bottom + headroom up to z_top + guard_h,
              so the opening edge on the upper level is guarded while vehicles pass below
"""
import math
from core.geom import MB, empty_root, part, ring_area

def _lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)

def _quad_solid(mb, pts, z_top, thick):
    """4 corners (xy) with a top z per corner → closed solid of vertical thickness `thick` below them."""
    order = [0, 1, 2, 3] if ring_area(pts) > 0 else [3, 2, 1, 0]
    P = [pts[i] for i in order]; Z = [z_top[i] for i in order]
    mb.hexa([(x, y, z - thick) for (x, y), z in zip(P, Z)] + [(x, y, z) for (x, y), z in zip(P, Z)])

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    (t0, t1), (b0, b1) = geo["top"], geo["bottom"]; zt, zb, gh = p["z_top"], p["z_bottom"], p["guard_h"]
    W = math.dist(t0, t1); Lr = math.dist(t0, b0)
    M = {k: MB() for k in ("Slab", "Grooves", "Curbs", "SideWalls", "Coping", "EndGuard")}
    z = lambda f: zt + (zb - zt) * f                                         # surface level at fraction f along the ramp
    pt = lambda f, s: _lerp(_lerp(t0, t1, s), _lerp(b0, b1, s), f)           # s across 0 (t0 side) … 1 (t1 side)
    sw = 0.2 / W; cu = 0.3 / W
    _quad_solid(M["Slab"], [pt(0, sw), pt(0, 1 - sw), pt(1, 1 - sw), pt(1, sw)], [z(0), z(0), z(1), z(1)], 0.2)
    for s0, s1 in ((sw, sw + cu), (1 - sw - cu, 1 - sw), (0.5 - cu / 2, 0.5 + cu / 2)):            # side curbs + median
        _quad_solid(M["Curbs"], [pt(0, s0), pt(0, s1), pt(1, s1), pt(1, s0)], [z(0) + 0.15] * 2 + [z(1) + 0.15] * 2, 0.15)
    n = int(Lr / 0.3)
    for k in range(1, n):
        f0 = (k * 0.3 - 0.015) / Lr; f1 = (k * 0.3 + 0.015) / Lr
        for s0, s1 in ((sw + cu, 0.5 - cu / 2), (0.5 + cu / 2, 1 - sw - cu)):
            _quad_solid(M["Grooves"], [pt(f0, s0), pt(f0, s1), pt(f1, s1), pt(f1, s0)], [z(f0) + 0.012] * 2 + [z(f1) + 0.012] * 2, 0.012)
    top_z = zt + gh
    for s0, s1 in ((0, sw), (1 - sw, 1)):
        P = [pt(0, s0), pt(0, s1), pt(1, s1), pt(1, s0)]
        order = [0, 1, 2, 3] if ring_area(P) > 0 else [3, 2, 1, 0]
        Q = [P[i] for i in order]; B = [[z(0) - 0.25, z(0) - 0.25, z(1) - 0.25, z(1) - 0.25][i] for i in order]
        M["SideWalls"].hexa([(x, y, b) for (x, y), b in zip(Q, B)] + [(x, y, top_z) for x, y in Q])
        a, c = pt(0, (s0 + s1) / 2), pt(1, (s0 + s1) / 2)
        M["Coping"].sweep([(a[0], a[1], top_z), (c[0], c[1], top_z)], [(-0.135, 0), (0.135, 0), (0.135, 0.04), (0, 0.06), (-0.135, 0.04)])
    zl = max(zb + 2.2, zt - 0.6)                                                                  # keep 2.2 m headroom at the exit
    if top_z > zl:
        P = [pt(1 - 0.2 / Lr, sw), pt(1 - 0.2 / Lr, 1 - sw), pt(1, 1 - sw), pt(1, sw)]
        _quad_solid(M["EndGuard"], P, [top_z] * 4, top_z - zl)
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
