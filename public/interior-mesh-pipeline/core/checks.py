"""Geometry checks: manifold, triangles, bounds, overlaps, host snapping."""
import bpy
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

def mesh_stats(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data)
    out = {"object": ob.name, "tris": sum(len(f.verts) - 2 for f in bm.faces), "non_manifold_edges": sum(1 for e in bm.edges if not e.is_manifold)}
    bm.free(); return out

def asset_stats(root):
    rows = [mesh_stats(o) for o in [root] + list(root.children_recursive) if o.type == "MESH"]
    return {"tris": sum(r["tris"] for r in rows), "non_manifold_edges": sum(r["non_manifold_edges"] for r in rows), "parts": rows}

def _bvh(ob, shrink_mm=0.0):
    """BVH of an object in world space; shrink_mm pulls every vertex toward the object's centre so
    surfaces that only touch (a rug on a slab, a frame on a wall) are not reported as overlaps."""
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); me = ev.to_mesh()
    pts = [ob.matrix_world @ v.co for v in me.vertices]
    if shrink_mm and pts:
        c = sum(pts, Vector()) / len(pts); s = shrink_mm * 0.001
        pts = [p - (p - c).normalized() * s if (p - c).length > s else p for p in pts]
    t = BVHTree.FromPolygons(pts, [tuple(p.vertices) for p in me.polygons])
    ev.to_mesh_clear(); return t

def overlaps(asset_objs, others, tol_mm=1.0):
    """Polygon-level intersections between an asset's meshes and other meshes (contact within tol_mm ignored)."""
    mine = [o for o in asset_objs if o.type == "MESH"]
    names = {o.name for o in mine}
    trees = {o.name: _bvh(o, tol_mm) for o in mine}
    hits = []
    for other in others:
        if other.type != "MESH" or other.name in names:
            continue
        ot = _bvh(other)
        for o in mine:
            if trees[o.name].overlap(ot):
                hits.append(f"{o.name} ↔ {other.name}")
    return hits

def snap_to_host(root, exclude=()):
    """Drop an asset onto the first surface below its origin (for Z = 'host')."""
    o = root.matrix_world.translation.copy()
    dg = bpy.context.evaluated_depsgraph_get()
    hide = [x for x in [root] + list(root.children_recursive) + list(exclude)]
    for x in hide: x.hide_set(True)
    hit, loc, *_ = bpy.context.scene.ray_cast(dg, o + Vector((0, 0, 2.6)), Vector((0, 0, -1)))
    for x in hide: x.hide_set(False)
    if hit:
        root.matrix_world.translation.z = loc.z
    return hit
