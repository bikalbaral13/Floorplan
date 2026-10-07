"""KERB — precast kerb + concrete gutter swept along a road edge (road on the LEFT of the line).

Kerb 150 wide, face height = top_z - road_z, 30 mm chamfer on the road-side arris, 250 mm below
road level; gutter 300 wide, 4 mm proud of the asphalt. Kerb units 1.0 m with 6 mm V joints are cut
into the face as real geometry (the line is split into units; each unit is its own swept solid).
"""
import math
from core.geom import MB, empty_root, part

def _split(line, unit, gap):
    out = []; L = [math.dist(line[i], line[i + 1]) for i in range(len(line) - 1)]; tot = sum(L)
    if tot < unit * 0.5: return [line]
    n = max(1, round(tot / unit)); step = tot / n
    def at(s):
        for i, l in enumerate(L):
            if s <= l or i == len(L) - 1:
                t = s / l if l else 0; a, b = line[i], line[i + 1]
                return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t), i
            s -= l
    acc = [0]
    for l in L: acc.append(acc[-1] + l)
    for k in range(n):
        s0, s1 = k * step + gap / 2, (k + 1) * step - gap / 2
        p0, i0 = at(s0); p1, i1 = at(s1)
        out.append([p0] + [line[j] for j in range(i0 + 1, i1 + 1)] + [p1])
    return out

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    line = geo["line"]; h = p["top_z"] - p["road_z"]; z = p["road_z"]
    kerb, gut = MB(), MB()
    prof = [(0, -0.25), (0.15, -0.25), (0.15, h - 0.03), (0.12, h), (0, h)]
    for seg in _split(line, 1.0, 0.006):
        kerb.sweep([(x, y, z) for x, y in seg], prof)
    gut.sweep([(x, y, z) for x, y in line], [(0.15, -0.10), (0.45, -0.10), (0.45, 0.004), (0.15, 0.004)])
    part(root, coll, "Kerb", kerb); part(root, coll, "Gutter", gut)
    return root
