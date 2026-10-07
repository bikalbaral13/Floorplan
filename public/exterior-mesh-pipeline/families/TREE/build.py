"""TREE — instanced tree prototypes (built once at the origin, placed by instances).

NEEM     broad round crown: flared, slightly bent trunk; 5 primary limbs with secondary branches;
         foliage = jittered icosphere clumps at every branch tip + crown fill.
COCONUT  curved trunk with leaf-scar rings (alternating radii), bulb at the crown, 14 fronds
         (curved rachis tube + V-folded tapering leaflet ribbon), cluster of nuts.
ASHOKA   columnar (Polyalthia): straight trunk, 8 stacked drooping cone tiers, jittered.
LOD2 = detailed (Unreal LOD0); LOD1 = trunk cylinder + 1–3 low clumps / 8 frond cards.
Parts: Trunk, Branches, Foliage, Fruit (materials later). Seeded: same seed → same tree.
"""
import math, random
from mathutils import Vector, Matrix
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    rnd = random.Random(p["seed"]); sp = p["species"]; lod = int(p["lod"])
    M = {k: MB() for k in ("Trunk", "Branches", "Foliage", "Fruit")}
    {"NEEM": _neem, "COCONUT": _coconut, "ASHOKA": _ashoka}[sp](M, rnd, lod, p["height"])
    for k, mb in M.items():
        ob = part(root, coll, k, mb)
        if ob is not None and sp == "COCONUT" and k == "Foliage": ob["open_mesh_ok"] = True   # frond leaflets are single-sided ribbons
    return root

def _bent(rnd, h, n, lean):
    ang = rnd.uniform(0, 2 * math.pi); pts = []
    for i in range(n + 1):
        t = i / n; off = lean * (t ** 1.6)
        pts.append((math.cos(ang) * off + rnd.uniform(-0.02, 0.02), math.sin(ang) * off + rnd.uniform(-0.02, 0.02), h * t))
    return pts

def _neem(M, rnd, lod, H):
    th = H * 0.36
    if lod == 1:
        M["Trunk"].cyl(0, 0, -0.1, th + 0.4, 0.17, 6, 0.12)
        M["Foliage"].icosphere((0, 0, H * 0.62), H * 0.33, 2, (1.1, 1.1, 0.8), 0.12, rnd.randint(0, 999))
        return
    trunk = _bent(rnd, th, 8, 0.25); trunk[0] = (0, 0, -0.1)
    radii = [0.30, 0.22] + [0.2 - 0.07 * i / 6 for i in range(1, 8)]
    M["Trunk"].tube(trunk, radii[:len(trunk)], 14)
    top = Vector(trunk[-1]); tips = []
    for k in range(5):
        a = 2 * math.pi * k / 5 + rnd.uniform(-0.3, 0.3); el = rnd.uniform(0.55, 0.95); ln = H * rnd.uniform(0.28, 0.38)
        dirv = Vector((math.cos(a) * math.cos(el), math.sin(a) * math.cos(el), math.sin(el)))
        mid = top + dirv * ln * 0.5 + Vector((0, 0, 0.2)); end = top + dirv * ln
        M["Branches"].tube([top - Vector((0, 0, 0.2)), mid, end], [0.11, 0.075, 0.035], 8)
        tips.append(end)
        for j in range(3):
            a2 = a + rnd.uniform(-0.9, 0.9); e2 = el + rnd.uniform(-0.2, 0.35); l2 = ln * rnd.uniform(0.3, 0.5)
            st = top + (end - top) * rnd.uniform(0.45, 0.8)
            d2 = Vector((math.cos(a2) * math.cos(e2), math.sin(a2) * math.cos(e2), math.sin(e2)))
            e = st + d2 * l2; M["Branches"].tube([st, st + d2 * l2 * 0.5, e], [0.045, 0.03, 0.015], 6); tips.append(e)
    for t in tips:                                        # a clump of 3 lumps per branch tip reads as leaf masses
        for j in range(3):
            o = Vector((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(-0.15, 0.35))) * (H / 9)
            M["Foliage"].icosphere(tuple(t + o), rnd.uniform(0.55, 0.85) * H / 9.5, 2, (1.2, 1.2, 0.75), 0.2, rnd.randint(0, 9999))
    for k in range(6):
        a = rnd.uniform(0, 2 * math.pi); r = rnd.uniform(0, H * 0.18)
        M["Foliage"].icosphere((math.cos(a) * r, math.sin(a) * r, H * rnd.uniform(0.62, 0.86)), H * rnd.uniform(0.12, 0.16), 2, (1.2, 1.2, 0.8), 0.15, rnd.randint(0, 9999))

def _coconut(M, rnd, lod, H):
    lean = rnd.uniform(0.4, 1.1); trunk = _bent(rnd, H, 22 if lod >= 2 else 4, lean)
    trunk[0] = (0, 0, -0.1)
    if lod >= 2:
        radii = [0.22 if i == 0 else (0.155 - 0.03 * i / 22) * (1.07 if i % 2 else 1.0) for i in range(23)]
    else:
        radii = [0.2, 0.15, 0.14, 0.13, 0.12]
    M["Trunk"].tube(trunk, radii, 12 if lod >= 2 else 6)
    crown = Vector(trunk[-1])
    if lod >= 2: M["Trunk"].icosphere(tuple(crown + Vector((0, 0, 0.1))), 0.22, 2, (1, 1, 1.4))
    nf = 14 if lod >= 2 else 8
    for k in range(nf):
        a = 2 * math.pi * k / nf + rnd.uniform(-0.15, 0.15); el = rnd.uniform(-0.1, 0.9) if k % 2 else rnd.uniform(0.3, 1.1)
        L = rnd.uniform(3.2, 4.2); seg = 10 if lod >= 2 else 3
        pts = []
        for i in range(seg + 1):
            t = i / seg; drop = (t ** 2) * 1.6
            pts.append(crown + Vector((math.cos(a) * math.cos(el) * L * t, math.sin(a) * math.cos(el) * L * t, math.sin(el) * L * t - drop)))
        if lod >= 2: M["Branches"].tube(pts, [0.035 * (1 - 0.8 * i / seg) + 0.006 for i in range(seg + 1)], 5)
        side = Vector((-math.sin(a), math.cos(a), 0))
        F = M["Foliage"]; prev = None
        for i in range(1, seg + 1):
            t = i / seg; w = 0.55 * math.sin(math.pi * min(1, t * 1.1)) + 0.05; fold = 0.18 * w
            c = pts[i]; l = F.vert(c - side * w + Vector((0, 0, -fold))); m = F.vert(c + Vector((0, 0, 0.01))); r = F.vert(c + side * w + Vector((0, 0, -fold)))
            if prev:
                pl, pm, pr = prev
                F.face((pl, pm, m, l)); F.face((pm, pr, r, m))
            prev = (l, m, r)
    if lod >= 2:
        for k in range(7):
            a = rnd.uniform(0, 2 * math.pi)
            M["Fruit"].icosphere(tuple(crown + Vector((math.cos(a) * 0.25, math.sin(a) * 0.25, -0.25 - rnd.uniform(0, 0.15)))), 0.11, 1, (1, 1, 1.2))

def _ashoka(M, rnd, lod, H):
    M["Trunk"].cyl(0, 0, -0.1, H * 0.95, 0.14, 10 if lod >= 2 else 6, 0.05)
    tiers = 8 if lod >= 2 else 3
    for k in range(tiers):
        t = k / tiers; z0 = H * (0.12 + 0.82 * t); r = H * 0.16 * (1 - t * 0.75) + 0.15; hh = H * 0.82 / tiers * 1.5
        bm = MB(); seg = 14 if lod >= 2 else 8
        ring = [bm.vert((math.cos(2 * math.pi * m / seg) * r * rnd.uniform(0.85, 1.12), math.sin(2 * math.pi * m / seg) * r * rnd.uniform(0.85, 1.12), z0 + rnd.uniform(-0.06, 0.06))) for m in range(seg)]
        mid = [bm.vert((math.cos(2 * math.pi * (m + 0.5) / seg) * r * 0.55, math.sin(2 * math.pi * (m + 0.5) / seg) * r * 0.55, z0 + hh * 0.55)) for m in range(seg)]
        tip = bm.vert((rnd.uniform(-0.05, 0.05), rnd.uniform(-0.05, 0.05), z0 + hh))
        inner = bm.vert((0, 0, z0 + hh * 0.15))
        for m in range(seg):
            m2 = (m + 1) % seg
            bm.face((ring[m], ring[m2], mid[m])); bm.face((mid[m], ring[m2], mid[m2])); bm.face((mid[m], mid[m2], tip))
            bm.face((ring[m2], ring[m], inner))
        M["Foliage"].merge(bm)
