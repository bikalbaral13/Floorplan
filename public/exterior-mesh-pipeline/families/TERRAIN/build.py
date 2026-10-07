"""TERRAIN — flat site ground with fine roughness, plus separate closed earth dumps (heaps).

Surface: regular grid (cell m) over bounds, minus cells inside geometry.holes (basement footprints), at base_z with 3-octave Perlin roughness (± roughness m).
It stays below every built surface (roads 0.00, plots +0.15) so nothing z-fights; under them it is
simply hidden. Dumps: closed radial meshes (rings × segments) with a smooth bell profile, lumpy
noise and a sunken base ring, placed by the adapter in the free margin only.
"""
import math
from mathutils import Vector, noise
from core.geom import MB, empty_root, part

def _rough(x, y, seed, amp):
    f = 0.0
    for k, (fr, w) in enumerate(((0.07, 0.55), (0.35, 0.30), (1.6, 0.15))):
        f += w * noise.noise(Vector((x * fr + seed * 13.1, y * fr - seed * 7.7, k * 3.3)))
    return f * amp

def _inside(x, y, ring):
    c = False; n = len(ring)
    for i in range(n):
        (x1, y1), (x2, y2) = ring[i], ring[(i + 1) % n]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1): c = not c
    return c

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    x0, y0, x1, y1 = geo["bounds"]; c = p["cell"]; s = p["seed"]
    nx, ny = max(2, int(math.ceil((x1 - x0) / c))), max(2, int(math.ceil((y1 - y0) / c)))
    g = MB(); idx = {}
    for j in range(ny + 1):
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx; y = y0 + (y1 - y0) * j / ny
            idx[i, j] = g.vert((x, y, p["base_z"] + _rough(x, y, s, p["roughness"])))
    holes = [o for o, _ in geo.get("holes", [])]               # basement footprints: no ground inside (ramp openings stay open)
    for j in range(ny):
        for i in range(nx):
            cx, cy = x0 + (x1 - x0) * (i + 0.5) / nx, y0 + (y1 - y0) * (j + 0.5) / ny
            if any(_inside(cx, cy, h) for h in holes): continue
            g.face((idx[i, j], idx[i + 1, j], idx[i + 1, j + 1], idx[i, j + 1]))
    ob = part(root, coll, "Ground", g); ob["open_mesh_ok"] = True; ob["recalc_normals"] = False; ob["uv1"] = "planar"
    dmp = MB()
    for (cx, cy, r, h, sd) in geo.get("dumps", []):
        rings, seg = 10, 28; base = p["base_z"] - 0.12
        ids = []
        for k in range(rings + 1):
            t = k / rings; rr = r * (1 - t) if k < rings else 0.0
            row = []
            for m in range(seg if k < rings else 1):
                a = 2 * math.pi * m / seg
                wob = 1 + 0.12 * noise.noise(Vector((math.cos(a) * 2 + sd, math.sin(a) * 2, t * 2)))
                px, py = cx + math.cos(a) * rr * wob, cy + math.sin(a) * rr * wob
                prof = (1 - (1 - t) ** 2) ** 1.6 if k else 0.0
                z = base + 0.12 + h * prof + (0.05 * h * noise.noise(Vector((px * 1.7, py * 1.7, sd))) if 0 < k < rings else 0)
                row.append(dmp.vert((px, py, z if k else base)))
            ids.append(row)
        for k in range(rings - 1):
            A, B = ids[k], ids[k + 1]
            for m in range(seg):
                dmp.face((A[m], A[(m + 1) % seg], B[(m + 1) % seg], B[m]))
        top = ids[rings][0]; A = ids[rings - 1]
        for m in range(seg): dmp.face((A[m], A[(m + 1) % seg], top))
        dmp.face(ids[0][::-1])
    part(root, coll, "EarthDumps", dmp)
    return root
