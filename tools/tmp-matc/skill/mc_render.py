# mc_render.py — render a material/1 JSON (with blenderGraph) on a swatch, low quality, headless.
#
#   blender -b --python mc_render.py -- <material.json> <ABS out dir>
#           [--shape plane|cube|sphere] [--size 2.0] [--view top|persp|both]
#           [--samples 16] [--res 512] [--yaw DEG] [--look standard|agx] [--blend]
#
# Writes <out>/<id>_top.png and/or <out>/<id>_persp.png (and <id>.blend with --blend).
# Pure bpy + the sibling mc_build.py. Cycles CPU: EEVEE Next renders flat magenta in background mode.

import bpy, sys, os, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
if len(argv) < 2:
    raise SystemExit("usage: blender -b --python mc_render.py -- <material.json> <out dir> [flags]")
src, out_dir = os.path.abspath(argv[0]), os.path.abspath(argv[1])   # relative paths land on the drive root
opt = {argv[i][2:]: (argv[i + 1] if i + 1 < len(argv) and not argv[i + 1].startswith("--") else "1")
       for i in range(2, len(argv)) if argv[i].startswith("--")}
shape = opt.get("shape", "plane")
size = float(opt.get("size", 2.0))
view = opt.get("view", "both")
samples = int(opt.get("samples", 16))
res = int(opt.get("res", 512))
yaw = math.radians(float(opt.get("yaw", 0)))
os.makedirs(out_dir, exist_ok=True)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import mc_build  # noqa: E402

definition = json.load(open(src, encoding="utf-8"))
mid = definition.get("id", os.path.splitext(os.path.basename(src))[0])

bpy.ops.wm.read_factory_settings(use_empty=True)
mat = mc_build.build(definition, mid)

# ── the swatch ──
if shape == "cube":
    bpy.ops.mesh.primitive_cube_add(size=size * 0.5, location=(0, 0, size * 0.25))
    ob = bpy.context.object
    bev = ob.modifiers.new("bevel", "BEVEL"); bev.width = size * 0.02; bev.segments = 4
elif shape == "sphere":
    bpy.ops.mesh.primitive_uv_sphere_add(radius=size * 0.3, location=(0, 0, size * 0.3), segments=64, ring_count=32)
    ob = bpy.context.object
    bpy.ops.object.shade_smooth()
else:
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 0, 0))
    ob = bpy.context.object
ob.data.materials.append(mat)
if shape != "plane":   # a neutral floor under a cube / sphere
    bpy.ops.mesh.primitive_plane_add(size=size * 6, location=(0, 0, 0))
    fl = bpy.context.object
    fm = bpy.data.materials.new("floor"); fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.5, 0.5, 1)
    fl.data.materials.append(fm)

# ── light: a soft sky plus one sun low enough to rake across a surface and show its bump ──
world = bpy.data.worlds.new("w"); bpy.context.scene.world = world; world.use_nodes = True
bg = world.node_tree.nodes["Background"]
# NEUTRAL white: a bluish sky reflecting in a coat turns a honey oak grey-pink, and this swatch exists to
# check colour against a photo.
bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1); bg.inputs["Strength"].default_value = 0.8
bpy.ops.object.light_add(type="SUN", location=(0, 0, 5))
sun = bpy.context.object; sun.data.energy = 3.0; sun.data.angle = math.radians(4)
sun.rotation_euler = (math.radians(50), 0, math.radians(35))

sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"
sc.cycles.samples = samples; sc.cycles.use_denoising = True
# STANDARD, not AgX, by default: under a neutral light a base colour then renders close to its own hex,
# which is what makes a numeric comparison with the photo mean anything. AgX (what the room renders use)
# desaturates bright colours ~10 %; check with --look agx before calling a material finished.
if opt.get("look", "standard") == "agx":
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Base Contrast"
else:
    sc.view_settings.view_transform = "Standard"


def aim(o, tgt):
    o.rotation_euler = (Vector(tgt) - o.location).to_track_quat("-Z", "Y").to_euler()


def shoot(tag, loc, tgt, ortho=None, lens=35, aspect=1.0):
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object; aim(cam, tgt)
    if ortho:
        cam.data.type = "ORTHO"; cam.data.ortho_scale = ortho
    else:
        cam.data.lens = lens
    sc.camera = cam
    sc.render.resolution_x = res; sc.render.resolution_y = int(res * aspect)
    sc.render.filepath = os.path.join(out_dir, f"{mid}_{tag}.png")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", sc.render.filepath)


if view in ("top", "both"):
    # straight down on a flat swatch; a 3/4 look at a cube or sphere
    if shape == "plane":
        shoot("top", (0, 0, 5), (0, 0, 0), ortho=size * 0.98)
    else:
        shoot("top", (size * 1.1, -size * 1.1, size * 0.9), (0, 0, size * 0.2), lens=50)
if view in ("persp", "both") and shape == "plane":
    # low and long, like a photographed floor or wall: shows the gloss and the pattern foreshortened
    # --yaw turns the camera about the swatch so a directional pattern (planks, grain, weave) crosses the
    # frame at the same angle as in the reference photo — the comparison's orientation number needs that
    cy, sy = math.cos(yaw), math.sin(yaw)
    shoot("persp", (size * 0.62 * sy, -size * 0.62 * cy, size * 0.28), (-size * 0.1 * sy, size * 0.1 * cy, 0), lens=24, aspect=1.25)
if "blend" in opt:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out_dir, f"{mid}.blend"))
