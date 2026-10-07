"""Mesh quality pass: no live modifiers, merge by distance, consistent normals, sharp edges, smooth shading."""
import math
import bpy
import bmesh

def clean_mesh(ob, merge_dist=0.0, recalc=True, sharp_angle_deg=30.0, smooth=True):
    if ob.type != "MESH": return
    if ob.modifiers:
        dg = bpy.context.evaluated_depsgraph_get()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
        old = ob.data; ob.modifiers.clear(); ob.data = me
        if old.users == 0: bpy.data.meshes.remove(old)
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    if merge_dist > 0:                                   # off by default: MeshBuilder solids are exact, and welding
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge_dist)   # touching solids (cap on pier) makes non-manifold edges
    bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    if recalc: bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = smooth
    try: me.set_sharp_from_angle(angle=math.radians(sharp_angle_deg))
    except AttributeError:
        me.use_auto_smooth = True; me.auto_smooth_angle = math.radians(sharp_angle_deg)

def finish_tree(root, recalc=True, smooth=True):
    seen = set()
    for ob in [root] + list(root.children_recursive):
        if ob.type == "MESH" and ob.data.name not in seen:
            seen.add(ob.data.name)
            clean_mesh(ob, recalc=ob.get("recalc_normals", recalc), smooth=smooth)
