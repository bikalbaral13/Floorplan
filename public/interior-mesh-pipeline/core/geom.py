"""bmesh geometry builders. All inputs in millimetres; meshes are created in metres."""
import math
import bpy
import bmesh
from mathutils import Vector

MM = 0.001

def new():
    return bmesh.new()

def box(bm, x0, y0, z0, x1, y1, z1):
    """Axis-aligned box from min to max corner (mm). Returns its verts."""
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r["verts"]:
        v.co = Vector((x0 if v.co.x < 0 else x1, y0 if v.co.y < 0 else y1, z0 if v.co.z < 0 else z1)) * MM
    return r["verts"]

def rounded_box(bm, x0, y0, z0, x1, y1, z1, radius, segments=4):
    """Box with all edges bevelled by radius (mm)."""
    vs = box(bm, x0, y0, z0, x1, y1, z1)
    edges = list({e for v in vs for e in v.link_edges})
    r = min(radius, 0.49 * min(x1 - x0, y1 - y0, z1 - z0))
    if r > 0:
        bmesh.ops.bevel(bm, geom=edges, offset=r * MM, segments=segments, profile=0.5, affect="EDGES", clamp_overlap=True)
    return vs

def cylinder(bm, cx, cy, z0, h, r_bottom, r_top=None, segments=48, caps=True):
    r = bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segments,
                              radius1=r_bottom * MM, radius2=(r_bottom if r_top is None else r_top) * MM, depth=h * MM)
    bmesh.ops.translate(bm, verts=r["verts"], vec=Vector((cx, cy, z0 + h / 2)) * MM)
    return r["verts"]

def revolve(bm, profile, segments=64, cx=0.0, cy=0.0):
    """Revolve a closed-or-open (r, z) profile (mm, bottom → top) around Z.
    Points with r == 0 are collapsed onto the axis (closed solid ends)."""
    n = len(profile)
    rings = [[bm.verts.new(Vector((cx + r * math.cos(2 * math.pi * i / segments), cy + r * math.sin(2 * math.pi * i / segments), z)) * MM)
              for r, z in profile] for i in range(segments)]
    for i in range(segments):
        A, B = rings[i], rings[(i + 1) % segments]
        for k in range(n - 1):
            bm.faces.new((A[k], B[k], B[k + 1], A[k + 1]))
    bmesh.ops.remove_doubles(bm, verts=[v for ring in rings for v in ring], dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges)
    return rings

def sweep_tube(bm, points_mm, radius, segments=12, closed=False):
    """Tube of given radius (mm) along a polyline (mm); open tubes are capped."""
    pts = [Vector(p) for p in points_mm]
    rings = []
    for i, p in enumerate(pts):
        t = (pts[(i + 1) % len(pts)] - pts[i - 1]) if closed else (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)])
        t.normalize(); u = t.orthogonal().normalized(); w = t.cross(u)
        rings.append([bm.verts.new((p + (u * math.cos(2 * math.pi * k / segments) + w * math.sin(2 * math.pi * k / segments)) * radius) * MM)
                      for k in range(segments)])
    last = len(rings) if closed else len(rings) - 1
    for i in range(last):
        A, B = rings[i], rings[(i + 1) % len(rings)]
        for k in range(segments):
            bm.faces.new((A[k], A[(k + 1) % segments], B[(k + 1) % segments], B[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    return rings

def grid(bm, x0, y0, x1, y1, z, nx, ny):
    r = bmesh.ops.create_grid(bm, x_segments=nx, y_segments=ny, size=0.5)
    for v in r["verts"]:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z)) * MM
    return r["verts"]

def to_object(name, bm, collection=None, parent=None):
    """Write the bmesh to a new mesh object (frees the bmesh)."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    (collection or bpy.context.scene.collection).objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob

def empty_root(name, collection=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = "PLAIN_AXES"; ob.empty_display_size = 0.2
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob
