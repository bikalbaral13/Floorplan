"""MeshBuilder — exact, quad-first geometry in METRES (Blender units), written straight to mesh data.

Every builder appends closed solids (unless stated) with consistent winding; finish.clean_mesh
recalculates normals anyway. UV0 is real-world (1 UV unit = 1 m): faces built by sweeps carry a
path-follow UV (U along the path, V around the profile); every other face gets an oriented planar
projection (horizontal faces → XY, vertical faces → horizontal tangent × Z) at to_object time.
"""
import math
import bpy
import bmesh
from mathutils import Vector, geometry

Z = Vector((0, 0, 1))

def _v2(p): return Vector((p[0], p[1]))

def ring_area(ring):
    return sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring))) / 2

def ccw(ring):
    return list(ring) if ring_area(ring) > 0 else list(reversed(ring))

def cw(ring):
    return list(reversed(ccw(ring)))

class MB:
    def __init__(self):
        self.v, self.f, self.fuv = [], [], []

    # ---- primitives -------------------------------------------------------------------------
    def vert(self, co):
        self.v.append(tuple(float(c) for c in co)); return len(self.v) - 1

    def face(self, idx, uvs=None):
        if len(set(idx)) < 3: return
        self.f.append(tuple(idx)); self.fuv.append(uvs)

    def hexa(self, p):
        """8 corner points: bottom ring p0..p3 CCW seen from above, top ring p4..p7 above them."""
        i = [self.vert(x) for x in p]
        for q in ((i[3], i[2], i[1], i[0]), (i[4], i[5], i[6], i[7]), (i[0], i[1], i[5], i[4]),
                  (i[1], i[2], i[6], i[5]), (i[2], i[3], i[7], i[6]), (i[3], i[0], i[4], i[7])):
            self.face(q)

    def box(self, x0, y0, z0, x1, y1, z1):
        x0, x1 = min(x0, x1), max(x0, x1); y0, y1 = min(y0, y1), max(y0, y1); z0, z1 = min(z0, z1), max(z0, z1)
        self.hexa([(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0), (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])

    def frame(self, a, b):
        """Unit direction d along a→b (XY) and its left normal n; returns (A, d, n, L)."""
        A, B = _v2(a), _v2(b); d = B - A; L = d.length
        d = d / L if L > 1e-9 else Vector((1, 0)); n = Vector((-d.y, d.x))
        return A, d, n, L

    def obox(self, a, b, t0, t1, s0, s1, z0, z1, top_shift=(0.0, 0.0)):
        """Box in the frame of segment a→b: t (along) from t0 to t1, s (left normal) from s0 to s1.
        top_shift=(ds0, ds1) moves the top face edges across (tapers / weathered tops)."""
        A, d, n, L = self.frame(a, b)
        P = lambda t, s, z: tuple(A + d * t + n * s) + (z,)
        self.hexa([P(t0, s0, z0), P(t1, s0, z0), P(t1, s1, z0), P(t0, s1, z0),
                   P(t0, s0 + top_shift[0], z1), P(t1, s0 + top_shift[0], z1), P(t1, s1 + top_shift[1], z1), P(t0, s1 + top_shift[1], z1)])

    def prism(self, ring, z0, z1):
        """Vertical extrusion of a simple polygon (any orientation) between z0 and z1, ngon caps."""
        r = ccw(ring); n = len(r)
        b = [self.vert((x, y, z0)) for x, y in r]; t = [self.vert((x, y, z1)) for x, y in r]
        self.face(list(reversed(b))); self.face(t)
        for i in range(n):
            j = (i + 1) % n; self.face((b[i], b[j], t[j], t[i]))

    def prism_holes(self, outer, holes, z0, z1, top=True, bottom=True, sides=True):
        """Extrusion of a polygon with holes; caps triangulated (tessellate_polygon), sides quads."""
        o = ccw(outer); hs = [cw(h) for h in holes]
        rings = [o] + hs
        flat = [p for r in rings for p in r]
        tris = geometry.tessellate_polygon([[Vector((x, y, 0)) for x, y in r] for r in rings])
        bi = [self.vert((x, y, z0)) for x, y in flat]; ti = [self.vert((x, y, z1)) for x, y in flat]
        for a, b, c in tris:
            pa, pb, pc = flat[a], flat[b], flat[c]
            up = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]) > 0
            if top: self.face((ti[a], ti[b], ti[c]) if up else (ti[a], ti[c], ti[b]))
            if bottom: self.face((bi[a], bi[c], bi[b]) if up else (bi[a], bi[b], bi[c]))
        if sides:
            k = 0
            for r in rings:
                m = len(r)
                for i in range(m):
                    j = (i + 1) % m; self.face((bi[k + i], bi[k + j], ti[k + j], ti[k + i]))
                k += m

    # ---- sweeps ---------------------------------------------------------------------------------
    def sweep(self, path, profile, closed=False, caps=True, miter_limit=4.0):
        """Sweep a closed 2-D profile [(u, v)] along a polyline path [(x, y, z)].
        u = offset to the LEFT of the path (XY, mitred at corners), v = up. Path-follow UV:
        U = distance along the path, V = distance around the profile (both metres)."""
        P = [Vector((p[0], p[1], p[2] if len(p) > 2 else 0.0)) for p in path]
        if closed and (P[0] - P[-1]).length < 1e-6: P = P[:-1]
        n = len(P); m = len(profile)
        if n < 2: return
        lefts, scales = [], []
        for i in range(n):
            dp = (P[i] - P[i - 1]) if (closed or i > 0) else (P[1] - P[0])
            dn = (P[(i + 1) % n] - P[i]) if (closed or i < n - 1) else (P[-1] - P[-2])
            dp = Vector((dp.x, dp.y)).normalized(); dn = Vector((dn.x, dn.y)).normalized()
            lp, ln = Vector((-dp.y, dp.x)), Vector((-dn.y, dn.x))
            mi = (lp + ln); mi = mi.normalized() if mi.length > 1e-6 else lp
            sc = 1.0 / max(1.0 / miter_limit, mi.dot(lp))
            lefts.append(mi); scales.append(sc)
        rings = []
        for i in range(n):
            l3 = Vector((lefts[i].x, lefts[i].y, 0)) * scales[i]
            rings.append([self.vert(P[i] + l3 * u + Z * v) for u, v in profile])
        su = [0.0]
        for i in range(1, n + (1 if closed else 0)):
            su.append(su[-1] + (P[i % n] - P[i - 1]).length)
        sv = [0.0]
        for k in range(1, m + 1):
            a, b = profile[k - 1], profile[k % m]; sv.append(sv[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        cw_prof = ring_area(profile) < 0
        segs = n if closed else n - 1
        for i in range(segs):
            A, B = rings[i], rings[(i + 1) % n]
            for k in range(m):
                k2 = (k + 1) % m
                q = (A[k], B[k], B[k2], A[k2]); uv = [(su[i], sv[k]), (su[i + 1], sv[k]), (su[i + 1], sv[k + 1]), (su[i], sv[k + 1])]
                if cw_prof: q = q[::-1]; uv = uv[::-1]
                self.face(q, uv)
        if caps and not closed:
            s, e = rings[0], rings[-1]
            self.face(s[::-1] if not cw_prof else s); self.face(e if not cw_prof else e[::-1])

    def tube(self, pts, radii, seg=12, cap0=True, cap1=True, uv=True):
        """Round tube along a 3-D polyline with a radius per point (parallel-transport frames)."""
        P = [Vector(p) for p in pts]; n = len(P)
        if isinstance(radii, (int, float)): radii = [radii] * n
        T = [(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized() for i in range(n)]
        U = T[0].orthogonal().normalized(); frames = []
        for i in range(n):
            if i:
                axis = T[i - 1].cross(T[i])
                if axis.length > 1e-8:
                    ang = T[i - 1].angle(T[i]); from mathutils import Matrix
                    U = (Matrix.Rotation(ang, 3, axis.normalized()) @ U).normalized()
            frames.append((U, T[i].cross(U)))
        rings = [[self.vert(P[i] + (frames[i][0] * math.cos(2 * math.pi * k / seg) + frames[i][1] * math.sin(2 * math.pi * k / seg)) * radii[i])
                  for k in range(seg)] for i in range(n)]
        acc = [0.0]
        for i in range(1, n): acc.append(acc[-1] + (P[i] - P[i - 1]).length)
        for i in range(n - 1):
            A, B = rings[i], rings[i + 1]; circ = 2 * math.pi * max(radii[i], 1e-4)
            for k in range(seg):
                k2 = (k + 1) % seg
                self.face((A[k], A[k2], B[k2], B[k]), [(circ * k / seg, acc[i]), (circ * (k + 1) / seg, acc[i]), (circ * (k + 1) / seg, acc[i + 1]), (circ * k / seg, acc[i + 1])] if uv else None)
        if cap0: self.face(rings[0][::-1])
        if cap1: self.face(rings[-1])
        return rings

    def cyl(self, cx, cy, z0, h, r, seg=16, r2=None):
        self.tube([(cx, cy, z0), (cx, cy, z0 + h)], [r, r if r2 is None else r2], seg)

    def frustum_box(self, cx, cy, z0, z1, w0, d0, w1, d1):
        """Rectangular frustum (pier caps, plinth blocks)."""
        self.hexa([(cx - w0 / 2, cy - d0 / 2, z0), (cx + w0 / 2, cy - d0 / 2, z0), (cx + w0 / 2, cy + d0 / 2, z0), (cx - w0 / 2, cy + d0 / 2, z0),
                   (cx - w1 / 2, cy - d1 / 2, z1), (cx + w1 / 2, cy - d1 / 2, z1), (cx + w1 / 2, cy + d1 / 2, z1), (cx - w1 / 2, cy + d1 / 2, z1)])

    def pyramid(self, cx, cy, z0, w, d, h):
        a = [self.vert(p) for p in ((cx - w / 2, cy - d / 2, z0), (cx + w / 2, cy - d / 2, z0), (cx + w / 2, cy + d / 2, z0), (cx - w / 2, cy + d / 2, z0))]
        t = self.vert((cx, cy, z0 + h)); self.face(a[::-1])
        for i in range(4): self.face((a[i], a[(i + 1) % 4], t))

    def opyramid(self, c, d, w, dp, z0, h):
        """Pyramid on a w × dp base centred at c, base edges along unit direction d (XY)."""
        d = _v2(d).normalized(); n = Vector((-d.y, d.x)); C = _v2(c)
        a = [self.vert(tuple(C + d * sx * w / 2 + n * sy * dp / 2) + (z0,)) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        t = self.vert(tuple(C) + (z0 + h,)); self.face(a[::-1])
        for i in range(4): self.face((a[i], a[(i + 1) % 4], t))

    def ocbox(self, c, d, w, dp, z0, z1, w1=None, dp1=None):
        """Box (or frustum when w1/dp1 given) centred at c, oriented along unit direction d."""
        d = _v2(d).normalized(); n = Vector((-d.y, d.x)); C = _v2(c); w1 = w if w1 is None else w1; dp1 = dp if dp1 is None else dp1
        P = lambda sx, sy, ww, dd, z: tuple(C + d * sx * ww / 2 + n * sy * dd / 2) + (z,)
        self.hexa([P(-1, -1, w, dp, z0), P(1, -1, w, dp, z0), P(1, 1, w, dp, z0), P(-1, 1, w, dp, z0),
                   P(-1, -1, w1, dp1, z1), P(1, -1, w1, dp1, z1), P(1, 1, w1, dp1, z1), P(-1, 1, w1, dp1, z1)])

    def add_bmesh(self, bm, matrix=None):
        base = len(self.v)
        for vv in bm.verts: self.v.append(tuple(matrix @ vv.co if matrix else vv.co))
        for f in bm.faces: self.face([base + vv.index for vv in f.verts])
        bm.free()

    def icosphere(self, center, radius, subdiv=2, scale=(1, 1, 1), jitter=0.0, seed=0):
        import random
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
        rnd = random.Random(seed); bm.verts.index_update()
        for v in bm.verts:
            k = 1.0 + (rnd.uniform(-jitter, jitter) if jitter else 0.0)
            v.co = Vector((center[0] + v.co.x * radius * scale[0] * k, center[1] + v.co.y * radius * scale[1] * k, center[2] + v.co.z * radius * scale[2] * k))
        self.add_bmesh(bm)

    def merge(self, other):
        base = len(self.v); self.v += other.v
        for f, uv in zip(other.f, other.fuv): self.f.append(tuple(i + base for i in f)); self.fuv.append(uv)

    # ---- output ---------------------------------------------------------------------------------
    def to_object(self, name, coll, parent=None):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f); me.validate(clean_customdata=False)
        uvl = me.uv_layers.new(name="UVMap")
        if len(me.polygons) == len(self.f):          # validate() may drop degenerate faces; then fall back to planar UVs
            for p, uv in zip(me.polygons, self.fuv):
                if uv and len(uv) == p.loop_total:
                    for k, li in enumerate(p.loop_indices): uvl.data[li].uv = uv[k]
                else: _planar(me, p, uvl)
        else:
            for p in me.polygons: _planar(me, p, uvl)
        ob = bpy.data.objects.new(name, me); coll.objects.link(ob)
        if parent is not None: ob.parent = parent
        return ob

def _planar(me, p, uvl):
    n = p.normal
    if abs(n.z) > 0.7:
        for li in p.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co; uvl.data[li].uv = (c.x, c.y)
    else:
        t = Z.cross(n); t = t.normalized() if t.length > 1e-6 else Vector((1, 0, 0))
        for li in p.loop_indices:
            c = me.vertices[me.loops[li].vertex_index].co; uvl.data[li].uv = (c.dot(t), c.z)

def empty_root(name, coll, parent=None, size=0.5):
    ob = bpy.data.objects.new(name, None); ob.empty_display_type = "PLAIN_AXES"; ob.empty_display_size = size
    coll.objects.link(ob)
    if parent is not None: ob.parent = parent
    return ob

def part(root, coll, name, mb):
    """Write a builder as a child part of root (named <root>_<name>); skip empty builders."""
    if not mb.f: return None
    return mb.to_object(f"{root.name}_{name}", coll, root)
