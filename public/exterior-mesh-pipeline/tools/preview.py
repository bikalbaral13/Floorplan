"""Quick visual proof: render the current scene (or one collection / object tree) to PNG with Workbench.

    from tools.preview import render
    render(r"out.png", target="VERIFY_BUILDING", view="iso", size=(1600, 1000))

view: iso (south-east, 35° down) | top | front (from the south). Cavity + outline shading, matcap-free
studio light, random object colours so separate parts read. Instances are rendered (collection
instances are evaluated); hidden PROTOTYPES are not.
"""
import math
import bpy
from mathutils import Vector

def _bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get(); lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for inst in dg.object_instances:
        ob = inst.object
        if ob.type != "MESH" or (objs is not None and inst.instance_object and inst.instance_object.name not in objs and ob.name not in objs) or (objs is not None and not inst.is_instance and ob.name not in objs):
            continue
        M = inst.matrix_world
        for c in ob.bound_box:
            w = M @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

PART_COLORS = [("Glass", (0.35, 0.55, 0.7)), ("Lawn", (0.38, 0.55, 0.25)), ("Foliage", (0.25, 0.45, 0.2)), ("Trunk", (0.4, 0.3, 0.2)), ("Branches", (0.4, 0.3, 0.2)),
               ("Asphalt", (0.18, 0.18, 0.2)), ("Base", (0.25, 0.25, 0.27)), ("Ground", (0.55, 0.45, 0.35)), ("EarthDumps", (0.5, 0.38, 0.26)), ("Pavers", (0.6, 0.5, 0.45)),
               ("Concrete", (0.62, 0.62, 0.6)), ("Kerb", (0.75, 0.75, 0.72)), ("Gutter", (0.6, 0.6, 0.58)), ("Edging", (0.6, 0.32, 0.25)), ("Plinth", (0.5, 0.45, 0.4)),
               ("WinFrame", (0.3, 0.22, 0.15)), ("DoorLeaf", (0.45, 0.28, 0.15)), ("DoorFrame", (0.3, 0.22, 0.15)), ("Rail", (0.15, 0.15, 0.15)), ("Railing", (0.15, 0.15, 0.15)),
               ("Bars", (0.15, 0.15, 0.15)), ("Leaf", (0.15, 0.15, 0.15)), ("Leaves", (0.15, 0.15, 0.15)), ("Hardware", (0.7, 0.6, 0.3)), ("Chajja", (0.82, 0.8, 0.75)),
               ("Sill", (0.7, 0.68, 0.62)), ("Coping", (0.78, 0.76, 0.7)), ("PierCaps", (0.78, 0.76, 0.7)), ("Slabs", (0.85, 0.83, 0.78)), ("Roof", (0.7, 0.68, 0.64)),
               ("Screed", (0.6, 0.58, 0.55)), ("Walls", (0.93, 0.88, 0.8)), ("Wall", (0.85, 0.8, 0.72)), ("Parapet", (0.92, 0.87, 0.79)), ("Piers", (0.8, 0.74, 0.66))]

def color_parts():
    """Object colours by part name (for color='OBJECT' previews only; not materials)."""
    for o in bpy.data.objects:
        if o.type != "MESH": continue
        for key, c in PART_COLORS:
            if o.name.endswith("_" + key): o.color = (*c, 1.0); break

def render(path, target=None, view="iso", size=(1600, 1000), color="RANDOM", ortho=False, focus=None, cam_dist=None):
    sc = bpy.context.scene
    if color == "OBJECT": color_parts()
    objs = None
    if target:
        c = bpy.data.collections.get(target)
        objs = {o.name for o in c.all_objects} if c else {o.name for o in [bpy.data.objects[target]] + list(bpy.data.objects[target].children_recursive)}
    lo, hi = (Vector(focus[0]), Vector(focus[1])) if focus else _bounds(objs)
    ctr = (lo + hi) / 2; rad = max((hi - lo).length / 2, 1.0)
    cam_d = bpy.data.cameras.get("PREVIEW_CAM") or bpy.data.cameras.new("PREVIEW_CAM")
    cam = bpy.data.objects.get("PREVIEW_CAM") or bpy.data.objects.new("PREVIEW_CAM", cam_d)
    if cam.name not in sc.collection.objects: sc.collection.objects.link(cam)
    dirs = {"iso": Vector((1.0, -1.25, 0.95)), "top": Vector((0, -0.001, 1)), "front": Vector((0.0, -1, 0.18)), "iso_nw": Vector((-1.0, 1.2, 0.9))}
    d = dirs.get(view, dirs["iso"]).normalized()
    cam_d.lens = 50; cam_d.clip_end = rad * 20; cam_d.clip_start = 0.05
    if ortho or view == "top":
        cam_d.type = "ORTHO"; cam_d.ortho_scale = rad * 2.1
    else:
        cam_d.type = "PERSP"
    cam.location = ctr + d * (cam_dist or rad * (2.6 if cam_d.type == "PERSP" else 4))
    cam.rotation_euler = (ctr - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"; sh.color_type = color; sh.show_cavity = True; sh.cavity_type = "BOTH"
    sh.show_object_outline = True; sh.show_shadows = True; sh.shadow_intensity = 0.35
    sc.display.shading.show_backface_culling = False
    sc.render.resolution_x, sc.render.resolution_y = size; sc.render.film_transparent = False
    sc.world = sc.world or bpy.data.worlds.new("W")
    hidden = []
    if objs is not None:                                      # isolate the target: hide everything else for this render
        protos = bpy.data.collections.get("PROTOTYPES"); keep = {o.name for o in protos.all_objects} if protos else set()   # instances draw these
        for o in sc.objects:
            if o.name not in objs and o.name not in keep and o.name != cam.name and not o.hide_render: o.hide_render = True; hidden.append(o)
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
    return path
