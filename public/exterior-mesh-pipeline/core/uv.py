"""UV maps for Unreal.

UV0  "UVMap"     real-world tiling (1 unit = 1 m). Built by core.geom (path-follow on sweeps,
                 oriented planar elsewhere). Material scale is set in the engine, never by rescaling UVs.
UV1  "Lightmap"  Smart UV Project (angle 66°, island margin) + pack, one 0–1 square per mesh, no overlaps.
                 Large open surfaces (terrain) use a normalised top projection instead (flag uv1="planar").
Shared meshes (prototypes, linked duplicates) are unwrapped once.
"""
import math
import bpy
import bmesh

def _ensure(me, name):
    return me.uv_layers.get(name) or me.uv_layers.new(name=name)

def planar_lightmap(ob):
    me = ob.data; lay = _ensure(me, "Lightmap")
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]
    x0, y0 = min(xs), min(ys); s = max(max(xs) - x0, max(ys) - y0) or 1.0
    for l in me.loops:
        c = me.vertices[l.vertex_index].co; lay.data[l.index].uv = (0.005 + 0.99 * (c.x - x0) / s, 0.005 + 0.99 * (c.y - y0) / s)

def smart_lightmap(ob, angle=66.0, margin=0.004):
    me = ob.data
    lay = _ensure(me, "Lightmap"); me.uv_layers.active = lay
    vl = bpy.context.view_layer
    for o in list(bpy.context.selected_objects): o.select_set(False)
    temp = ob.name not in vl.objects                      # prototypes live in an excluded collection
    if temp: bpy.context.scene.collection.objects.link(ob)
    hidden = ob.hide_get()
    if hidden: ob.hide_set(False)
    vl.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    try: bpy.ops.uv.pack_islands(rotate=True, margin=margin)
    except TypeError: bpy.ops.uv.pack_islands(margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    ob.select_set(False)
    if hidden: ob.hide_set(True)
    if temp: bpy.context.scene.collection.objects.unlink(ob)
    me.uv_layers.active = me.uv_layers["UVMap"]
    me.uv_layers["UVMap"].active_render = True

def lightmap_tree(root):
    """UV1 for every unique mesh under root. Returns the number of meshes unwrapped."""
    done = set()
    for ob in [root] + list(root.children_recursive):
        if ob.type != "MESH" or ob.data.name in done: continue
        done.add(ob.data.name)
        if ob.get("uv1") == "planar": planar_lightmap(ob)
        else: smart_lightmap(ob)
    return len(done)
