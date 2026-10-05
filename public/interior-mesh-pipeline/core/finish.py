"""Mesh quality pass: bake modifiers, merge, normals, real-world box UVs, sharp edges."""
import math
import bpy
import bmesh

def clean_mesh(ob, merge_dist_mm=0.01, uv=True, sharp_angle_deg=30.0):
    if ob.type != "MESH":
        return
    if ob.modifiers:                                    # bake modifiers — no live modifiers in outputs
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        old = ob.data; ob.modifiers.clear(); ob.data = me
        if old.users == 0:
            bpy.data.meshes.remove(old)
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist_mm * 0.001)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if uv:
        layer = bm.loops.layers.uv.get("UVMap") or bm.loops.layers.uv.new("UVMap")
        for f in bm.faces:
            ax = max(range(3), key=lambda i: abs(f.normal[i]))
            for l in f.loops:
                c = l.vert.co
                l[layer].uv = (c.y, c.z) if ax == 0 else ((c.x, c.z) if ax == 1 else (c.x, c.y))
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(sharp_angle_deg))
    except AttributeError:                              # Blender < 4.1
        me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(sharp_angle_deg)

def finish_asset(root):
    for ob in [root] + list(root.children_recursive):
        clean_mesh(ob)
