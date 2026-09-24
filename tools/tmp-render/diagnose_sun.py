"""Why is the room dark? Measure, do not guess.

    blender -b --python tools/tmp-render/diagnose_sun.py -- <imported.blend>

Asks three questions in order, because they have different answers:
  1. Where is the sun pointing, and how strong is it really?
  2. From a point standing in the middle of the room, is there a clear line to the sun — and if not,
     WHAT is in the way?
  3. What does the room actually receive: a Workbench top view and a flat-lit shot, which separate
     "there is no light" from "the grading ate it".
"""
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(argv[0]))
scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()

print("\n=== 1. the sun ===")
suns = [o for o in bpy.data.objects if o.type == "LIGHT" and o.data.type == "SUN"]
for s in suns:
    d = (s.matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    print(f"  {s.name}: {s.data.energy:.1f} W/m²  direction {tuple(round(c, 3) for c in d)}  "
          f"(travels {'+X east' if d.x > 0 else '-X west'}, {'down' if d.z < 0 else 'UP — wrong'})")
    print(f"  angle {s.data.angle:.5f} rad  colour {tuple(round(c, 2) for c in s.data.color)}")

print("\n=== 2. room extents, and the line to the sun ===")
meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.hide_render]
room = [o for o in meshes if "Room" in o.name or "Wall" in o.name]
if room:
    xs = [v[0] for o in room for v in o.bound_box_world] if hasattr(room[0], "bound_box_world") else []
mn = Vector((1e9, 1e9, 1e9)); mx = Vector((-1e9, -1e9, -1e9))
for o in room:
    for corner in o.bound_box:
        w = o.matrix_world @ Vector(corner)
        mn = Vector((min(mn.x, w.x), min(mn.y, w.y), min(mn.z, w.z)))
        mx = Vector((max(mx.x, w.x), max(mx.y, w.y), max(mx.z, w.z)))
print(f"  walls + room span X {mn.x:.2f}..{mx.x:.2f}  Y {mn.y:.2f}..{mx.y:.2f}  Z {mn.z:.2f}..{mx.z:.2f}")
centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, 1.2))
print(f"  standing at {tuple(round(c, 2) for c in centre)}")

if suns:
    d = (suns[0].matrix_world.to_quaternion() @ Vector((0, 0, -1))).normalized()
    toward_sun = -d
    for label, origin in (("room centre", centre),
                          ("just inside the window", Vector((mn.x + 0.35, (mn.y + mx.y) / 2, 1.2)))):
        hit, loc, nor, idx, obj, _ = scene.ray_cast(dg, origin + toward_sun * 0.02, toward_sun, distance=400)
        if hit:
            print(f"  {label}: BLOCKED at {(loc - origin).length:.2f} m by '{obj.name}'")
        else:
            print(f"  {label}: clear line to the sun")

print("\n=== 3. what is in the room's airspace ===")
big = sorted(meshes, key=lambda o: -max((o.matrix_world @ Vector(c)).length for c in o.bound_box))[:6]
for o in big:
    corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
    bx = (min(c.x for c in corners), max(c.x for c in corners))
    by = (min(c.y for c in corners), max(c.y for c in corners))
    bz = (min(c.z for c in corners), max(c.z for c in corners))
    print(f"  {o.name[:46]:46} X {bx[0]:8.1f}..{bx[1]:7.1f}  Y {by[0]:8.1f}..{by[1]:7.1f}  Z {bz[0]:6.1f}..{bz[1]:6.1f}")

print("\n=== 4. flat-lit control render ===")
# Workbench with no grading: if the room is visible here and black in Cycles, the problem is light,
# not geometry. If it is black here too, the camera is inside something.
out = os.path.join(os.path.dirname(os.path.abspath(argv[0])), "diag_workbench.png")
scene.render.engine = "BLENDER_WORKBENCH"
scene.view_settings.view_transform = "Standard"
scene.view_settings.exposure = 0
scene.use_nodes = False
scene.render.resolution_x, scene.render.resolution_y = 720, 405
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("  wrote", out)
