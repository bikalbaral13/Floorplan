"""GATE_SWING — plot gate: two pillars with caps and a closed double swing gate.

Each leaf: 50×50 frame, 350 mm sheet panel at the bottom, 16 mm square bars at 110, an arched top
rail rising 150 mm to the centre, barrel hinges on the pillar side, a drop bolt and a latch plate.
Centre / heading from the adapter (heading = direction of the plot front line).
"""
import math
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    cx, cy = geo["center"]; hd = math.radians(geo["heading"]); d = (math.cos(hd), math.sin(hd)); n = (-d[1], d[0])
    w, h, pw, z = p["width"], p["height"], p["pillar"], p["base_z"]
    M = {k: MB() for k in ("Pillars", "PillarCaps", "Leaves", "Bars", "Panel", "Hardware")}
    for sgn in (-1, 1):
        c = (cx + d[0] * sgn * (w / 2 + pw / 2), cy + d[1] * sgn * (w / 2 + pw / 2))
        M["Pillars"].ocbox(c, d, pw, pw, z - 0.3, z + h + 0.25)
        M["PillarCaps"].ocbox(c, d, pw + 0.1, pw + 0.1, z + h + 0.25, z + h + 0.31)
        M["PillarCaps"].ocbox(c, d, pw + 0.1, pw + 0.1, z + h + 0.31, z + h + 0.36, pw + 0.04, pw + 0.04)
        M["PillarCaps"].opyramid(c, d, pw + 0.04, pw + 0.04, z + h + 0.36, 0.14)
    a = (cx - d[0] * w / 2, cy - d[1] * w / 2); b = (cx + d[0] * w / 2, cy + d[1] * w / 2)
    lw = w / 2 - 0.02; F = M["Leaves"]
    for k in range(2):
        s0 = 0.01 if k == 0 else w / 2 + 0.01; s1 = s0 + lw
        F.obox(a, b, s0, s1, -0.025, 0.025, z + 0.06, z + 0.11)
        F.obox(a, b, s0, s0 + 0.05, -0.025, 0.025, z + 0.06, z + h); F.obox(a, b, s1 - 0.05, s1, -0.025, 0.025, z + 0.06, z + h)
        F.obox(a, b, s0 + 0.05, s1 - 0.05, -0.02, 0.02, z + 0.45, z + 0.49)
        M["Panel"].obox(a, b, s0 + 0.05, s1 - 0.05, -0.003, 0.003, z + 0.11, z + 0.45)
        # arched top rail: peak at the centre (gate meeting edge)
        arc = []
        for m in range(13):
            s = s0 + (s1 - s0) * m / 12; rise = 0.15 * (math.sin(math.pi / 2 * ((s - s0) / (s1 - s0) if k == 0 else (s1 - s) / (s1 - s0))))
            arc.append((a[0] + d[0] * s, a[1] + d[1] * s, z + h - 0.15 + rise))
        F.sweep(arc, [(-0.025, -0.05), (0.025, -0.05), (0.025, 0.0), (-0.025, 0.0)])
        nb = max(1, int((s1 - s0 - 0.1) / 0.11))
        for m in range(nb):
            s = s0 + 0.05 + (s1 - s0 - 0.1) * (m + 0.5) / nb
            rise = 0.15 * math.sin(math.pi / 2 * ((s - s0) / (s1 - s0) if k == 0 else (s1 - s) / (s1 - s0)))
            M["Bars"].obox(a, b, s - 0.008, s + 0.008, -0.008, 0.008, z + 0.49, z + h - 0.15 + rise - 0.05)
        hs = s0 + 0.025 if k == 0 else s1 - 0.025
        for zz in (z + 0.3, z + h - 0.35):
            hc = (a[0] + d[0] * hs + n[0] * 0.035, a[1] + d[1] * hs + n[1] * 0.035)
            M["Hardware"].cyl(hc[0], hc[1], zz, 0.12, 0.018, 10)
    mid = (cx + n[0] * 0.03, cy + n[1] * 0.03)
    M["Hardware"].ocbox(mid, d, 0.1, 0.012, z + 1.0, z + 1.12)
    db = (cx - d[0] * 0.06 + n[0] * 0.035, cy - d[1] * 0.06 + n[1] * 0.035)
    M["Hardware"].cyl(db[0], db[1], z + 0.02, 0.5, 0.01, 8)
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
