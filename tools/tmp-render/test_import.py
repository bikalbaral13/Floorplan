"""Headless test of the addon's Floor Plan button.

    blender -b --python tools/tmp-render/test_import.py -- <baked.json> [--save out.blend] [--render out.png]

Enables the House addon, calls `builderplus.parametric_floor_plan` exactly as the button does, and
then checks what actually landed: objects, materials that are more than a flat colour, lamps with
real energies, cameras with a lens shift, and a scene whose view transform came from the plan.
"""
import os
import sys

import bpy
import addon_utils

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PLAN = argv[0] if argv else ""
SAVE = argv[argv.index("--save") + 1] if "--save" in argv else ""
RENDER = argv[argv.index("--render") + 1] if "--render" in argv else ""
SAMPLES = int(argv[argv.index("--samples") + 1]) if "--samples" in argv else 24
RES = int(argv[argv.index("--res") + 1]) if "--res" in argv else 720

bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("House", default_set=False, persistent=True)

print("\n=== import ===")
res = bpy.ops.builderplus.parametric_floor_plan(filepath=os.path.abspath(PLAN))
print("operator:", res)

scene = bpy.context.scene
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
lights = [o for o in bpy.data.objects if o.type == "LIGHT"]
cams = [o for o in bpy.data.objects if o.type == "CAMERA"]
hidden = [o for o in meshes if o.hide_render]

# A material is "real" when it is more than a Principled with a flat colour on it — which is the
# whole point of the upgrade, so it is the thing worth counting.
rich = [m for m in bpy.data.materials if m.use_nodes and len(m.node_tree.nodes) > 3]
bevelled = [m for m in bpy.data.materials if m.use_nodes and any(n.type == "BEVEL" for n in m.node_tree.nodes)]
bumped = [m for m in bpy.data.materials if m.use_nodes and any(n.type == "BUMP" for n in m.node_tree.nodes)]
emissive = [m for m in bpy.data.materials if m.use_nodes and any(
    n.type == "BSDF_PRINCIPLED" and n.inputs.get("Emission Strength") and n.inputs["Emission Strength"].default_value > 0
    for n in m.node_tree.nodes)]

print("\n=== what landed ===")
print(f"  meshes        {len(meshes)}  ({len(hidden)} hidden from the render)")
print(f"  materials     {len(bpy.data.materials)}  — {len(rich)} with a real node tree, "
      f"{len(bevelled)} bevelled, {len(bumped)} bumped, {len(emissive)} emissive")
print(f"  lights        {len(lights)}")
for lo in sorted(lights, key=lambda o: o.name)[:14]:
    print(f"      {lo.name[:44]:44} {lo.data.type:5} {lo.data.energy:9.3f} W  "
          f"rgb {tuple(round(c, 2) for c in lo.data.color)}")
print(f"  cameras       {len(cams)}")
for c in cams:
    print(f"      {c.name[:40]:40} shift ({c.data.shift_x:+.3f}, {c.data.shift_y:+.3f})  "
          f"clip {c.data.clip_start:.3f}  dof {'f/%.1f' % c.data.dof.aperture_fstop if c.data.dof.use_dof else 'off'}")
print(f"  scene camera  {scene.camera.name if scene.camera else '(none)'}")
print(f"  engine        {scene.render.engine}  {getattr(scene.cycles, 'samples', '?')} samples")
print(f"  view          {scene.view_settings.view_transform} / {scene.view_settings.look} "
      f"exposure {scene.view_settings.exposure:+.2f}")
print(f"  world         {scene.world.name if scene.world else '(none)'}")
print(f"  compositor    {'on, ' + str(len(scene.node_tree.nodes)) + ' nodes' if scene.use_nodes and scene.node_tree else 'off'}")
print(f"  resolution    {scene.render.resolution_x} x {scene.render.resolution_y}")

fails = []
if len(meshes) < 100:
    fails.append(f"only {len(meshes)} meshes")
if not lights:
    fails.append("no lights")
if not cams:
    fails.append("no cameras")
if not bevelled:
    fails.append("no material carries a Bevel node — the surface block did not run")
if not emissive:
    fails.append("nothing is emissive")
if scene.render.engine != "CYCLES":
    fails.append("the look did not set the engine")
print("\n" + (("FAIL: " + "; ".join(fails)) if fails else "all checks passed"))

if SAVE:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(SAVE))
    print("saved     ", os.path.abspath(SAVE))
if RENDER and scene.camera:
    scene.cycles.samples = SAMPLES
    scene.cycles.device = "CPU"
    ratio = scene.render.resolution_x / max(1, scene.render.resolution_y)
    scene.render.resolution_x, scene.render.resolution_y = RES, int(round(RES / ratio))
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = os.path.abspath(RENDER)
    bpy.ops.render.render(write_still=True)
    print("rendered  ", os.path.abspath(RENDER))
