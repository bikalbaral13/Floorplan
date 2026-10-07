"""S1 (Blender): inventory of any .blend + a top-down Workbench plan for authoring the shot list.

job: {"blend", "topdown_png", "inventory_json", "res": 1400}
writes inventory_json: bbox (metres, world), counts by type, collections (render-visible or excluded), object names,
materials, cameras, objects matching lamp-ish names, interior hints, and the plan's pixel ↔ world mapping.
"""
import os, sys, re, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, mathutils
from _job import main

def visible(o):
    return o.visible_get() if hasattr(o, "visible_get") else not o.hide_render

def run(j):
    s = bpy.context.scene; vl = bpy.context.view_layer
    lo = mathutils.Vector((1e18,) * 3); hi = -lo; counts = {}
    names = []
    deps = bpy.context.evaluated_depsgraph_get()
    for inst in deps.object_instances:                       # includes collection instances
        o = inst.object
        if o.type != "MESH": continue
        for v in o.bound_box:
            w = inst.matrix_world @ mathutils.Vector(v)
            lo = mathutils.Vector(map(min, lo, w)); hi = mathutils.Vector(map(max, hi, w))
    for o in s.objects:
        counts[o.type] = counts.get(o.type, 0) + 1; names.append(o.name)
    def walk(lc, out):
        out.append({"name": lc.name, "excluded": lc.exclude, "objects": len(lc.collection.objects)})
        for c in lc.children: walk(c, out)
        return out
    cols = walk(vl.layer_collection, [])
    lamps = [o.name for o in s.objects if re.search(r"light|lamp", o.name, re.I)]
    interior = [o.name for o in s.objects if re.search(r"interior|furniture|sofa|bed|kitchen|_INT", o.name, re.I)]
    # top-down plan
    cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2; size = max(hi.x - lo.x, hi.y - lo.y) * 1.05
    cd = bpy.data.cameras.new("_TOPDOWN"); cd.type = "ORTHO"; cd.ortho_scale = size; cd.clip_end = 1e5
    cam = bpy.data.objects.new("_TOPDOWN", cd); s.collection.objects.link(cam)
    cam.location = (cx, cy, hi.z + 100); cam.rotation_euler = (0, 0, 0); s.camera = cam
    s.render.engine = "BLENDER_WORKBENCH"; sh = s.display.shading
    sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_shadows = True; sh.show_cavity = True
    s.render.resolution_x = s.render.resolution_y = j.get("res", 1400); s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "PNG"; s.render.filepath = j["topdown_png"]
    bpy.ops.render.render(write_still=True)
    px = j.get("res", 1400); m_per_px = size / px
    inv = {"schema": "walkthrough-inventory/1", "blend": bpy.data.filepath, "units": s.unit_settings.system, "scale_length": s.unit_settings.scale_length,
           "bbox": [list(map(lambda v: round(v, 2), lo)), list(map(lambda v: round(v, 2), hi))], "counts": counts,
           "collections": cols, "objects": names[:20000], "materials": [m.name for m in bpy.data.materials],
           "cameras": [o.name for o in s.objects if o.type == "CAMERA"], "lamp_like": lamps, "interior_hints": interior[:200],
           "topdown": {"png": j["topdown_png"], "px": px, "center": [cx, cy], "m_per_px": m_per_px,
                       "to_world": "x = cx + (px_x - px/2) * m_per_px ; y = cy - (px_y - px/2) * m_per_px"}}
    with open(j["inventory_json"], "w", encoding="utf-8") as f: json.dump(inv, f, indent=1)
    return {"bbox": inv["bbox"], "objects": len(names), "lamp_like": len(lamps), "interior_hints": len(interior)}

main(run)
