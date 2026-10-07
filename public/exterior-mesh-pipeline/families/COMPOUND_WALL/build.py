"""COMPOUND_WALL — masonry boundary / plot wall along a polyline.

Footing course (300 below to 100 above base, 75 mm wider each side), wall body to height - 60,
weathered coping (35 mm overhang), piers at every corner and every pier_spacing (pier × pier, rising
100 mm above the coping, or above the railing) with a moulded cap block and a pyramid top, and an
optional MS railing on the coping between piers (40×40 top rail, 30×10 bottom rail, 16 mm square
balusters at 120 mm with spear tips).
"""
import math
from core.geom import MB, empty_root, part

def _piers(line, spacing):
    pts = []
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]; L = math.dist(a, b)
        if L < 1e-6: continue
        d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        n = max(1, round(L / spacing))
        for k in range(n + (1 if i == len(line) - 2 else 0)):
            s = L * k / n; pts.append(((a[0] + d[0] * s, a[1] + d[1] * s), d, i, s))
    return pts

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    line = geo["line"]; t = p["thickness"]; h = p["height"]; z = p["base_z"]; pr = p["pier"]; rh = p["railing_h"]
    closed = len(line) > 3 and math.dist(line[0], line[-1]) < 1e-4
    if closed: line = line[:-1]
    path = [(x, y, z) for x, y in line]
    M = {k: MB() for k in ("Footing", "Wall", "Coping", "Piers", "PierCaps", "Railing")}
    M["Footing"].sweep(path, [(-t / 2 - 0.075, -0.3), (t / 2 + 0.075, -0.3), (t / 2 + 0.075, 0.1), (-t / 2 - 0.075, 0.1)], closed=closed)
    M["Wall"].sweep(path, [(-t / 2, 0.1), (t / 2, 0.1), (t / 2, h - 0.06), (-t / 2, h - 0.06)], closed=closed)
    M["Coping"].sweep([(x, y, z + h - 0.06) for x, y in line], [(-t / 2 - 0.035, 0), (t / 2 + 0.035, 0), (t / 2 + 0.035, 0.04), (0, 0.065), (-t / 2 - 0.035, 0.04)], closed=closed)
    top = z + h + 0.10 + (rh if rh > 0 else 0)
    piers = _piers(line + ([line[0]] if closed else []), p["pier_spacing"])
    for c, d, i, s in piers:
        M["Piers"].ocbox(c, d, pr, pr, z - 0.3, top)
        M["PierCaps"].ocbox(c, d, pr + 0.09, pr + 0.09, top, top + 0.05)
        M["PierCaps"].ocbox(c, d, pr + 0.09, pr + 0.09, top + 0.05, top + 0.09, pr + 0.05, pr + 0.05)
        M["PierCaps"].opyramid(c, d, pr + 0.05, pr + 0.05, top + 0.09, 0.12)
    if rh > 0:
        R = M["Railing"]; zc = z + h + 0.005
        for k in range(len(piers) - 1):
            (c0, d, i0, s0), (c1, _, i1, s1) = piers[k], piers[k + 1]
            if i0 != i1 and not (s1 == 0): continue
            L = math.dist(c0, c1); g = pr / 2 + 0.02
            if L - 2 * g < 0.2: continue
            a = (c0[0] + d[0] * g, c0[1] + d[1] * g); b = (c1[0] - d[0] * g, c1[1] - d[1] * g)
            R.obox(a, b, 0, L - 2 * g, -0.015, 0.015, zc, zc + 0.04)                       # bottom rail
            R.obox(a, b, 0, L - 2 * g, -0.02, 0.02, zc + rh - 0.04, zc + rh)               # top rail
            nb = max(1, int((L - 2 * g) / 0.12))
            for m in range(nb):
                s = (L - 2 * g) * (m + 0.5) / nb
                R.obox(a, b, s - 0.008, s + 0.008, -0.008, 0.008, zc + 0.04, zc + rh + 0.06)
                pc = (a[0] + d[0] * s, a[1] + d[1] * s); R.opyramid(pc, d, 0.026, 0.026, zc + rh + 0.06, 0.06)
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
