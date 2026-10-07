"""SHRUB — instanced shrub prototype: 4–6 jittered clumps over a short woody base (LOD2), or 2 clumps (LOD1)."""
import math, random
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    rnd = random.Random(p["seed"]); h = p["height"]; lod = int(p["lod"])
    stems, fol = MB(), MB()
    n = rnd.randint(4, 6) if lod >= 2 else 2
    for k in range(n):
        a = 2 * math.pi * k / n + rnd.uniform(-0.4, 0.4); r = rnd.uniform(0.08, 0.22) if k else 0
        c = (math.cos(a) * r, math.sin(a) * r, h * rnd.uniform(0.45, 0.62))
        fol.icosphere(c, h * rnd.uniform(0.32, 0.42), 2 if lod >= 2 else 1, (1.15, 1.15, 0.9), 0.18, rnd.randint(0, 9999))
        if lod >= 2: stems.tube([(0, 0, -0.05), (c[0] * 0.6, c[1] * 0.6, c[2] * 0.6)], [0.02, 0.01], 5)
    part(root, coll, "Stems", stems); part(root, coll, "Foliage", fol)
    return root
