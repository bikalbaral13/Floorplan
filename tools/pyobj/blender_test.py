"""blender -b --python blender_test.py -- <out.png> [params.json]
Builds the bed from bed_python.build() (the SAME file the editor runs), clay material, wall + floor, low-sample
Cycles render from roughly the reference camera."""
import bpy, sys, os, json, math, importlib.util
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = argv[0] if argv else "render.png"
params = json.load(open(argv[1])) if len(argv) > 1 else {}
cam_arg = json.loads(argv[2]) if len(argv) > 2 else None

here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("bed_python", os.path.join(here, "bed_python.py"))
bp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bp)
res = bp.build(params)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def mat(name, rgb, rough=0.75):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m

clay = mat("clay", (0.30, 0.30, 0.30))
COLOUR = "--clay" not in sys.argv
def hex_lin(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
mats = {}
def mesh_mat(m):
    if not COLOUR:
        return clay
    key = m["name"]
    if key not in mats:
        rough = 0.95 if m.get("material", "").endswith(("boucle.json", "wool.json")) else 0.6 if "velvet" in m.get("material", "") else 0.8
        mats[key] = mat(key, hex_lin(m.get("color", "#999999")), rough)
    return mats[key]
wall_mat = mat("wall", hex_lin("#d9d6d0") if COLOUR else (0.30, 0.30, 0.30), 0.9)
floor_mat = mat("floor", hex_lin("#bdb5aa") if COLOUR else (0.30, 0.30, 0.30), 0.7)

for m in res["meshes"]:
    me = bpy.data.meshes.new(m["name"])
    p = m["positions"]; ix = m["indices"]
    verts = [(p[i], p[i + 1], p[i + 2]) for i in range(0, len(p), 3)]
    faces = [(ix[i], ix[i + 1], ix[i + 2]) for i in range(0, len(ix), 3)]
    me.from_pydata(verts, [], faces)
    me.update()
    for poly in me.polygons:
        poly.use_smooth = True
    ob = bpy.data.objects.new(m["name"], me)
    ob.data.materials.append(mesh_mat(m))
    scene.collection.objects.link(ob)

# room: floor + wall behind the head (y = -L/2) and a side wall
L = float(params.get("length", bp.DEFAULTS["length"]))
hb_t = float(params.get("headboardThk", bp.DEFAULTS.get("headboardThk", 0))) if params.get("headboardStyle", bp.DEFAULTS.get("headboardStyle", "None")) != "None" else 0.0
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
bpy.context.object.data.materials.append(floor_mat)
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, -L / 2 - hb_t - 0.005, 0), rotation=(math.pi / 2, 0, 0))
bpy.context.object.data.materials.append(wall_mat)

# light: big soft area light + world
bpy.ops.object.light_add(type="AREA", location=(-2.5, 3.0, 4.0))
lt = bpy.context.object
lt.data.energy = 700
lt.data.size = 5
lt.rotation_euler = (math.radians(45), 0, math.radians(200))
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.45

# camera
cam_data = bpy.data.cameras.new("cam"); cam_data.lens = 35
cam = bpy.data.objects.new("cam", cam_data); scene.collection.objects.link(cam); scene.camera = cam
loc = Vector(cam_arg["loc"]) if cam_arg else Vector((1.55, 2.95, 1.35))
tgt = Vector(cam_arg["tgt"]) if cam_arg else Vector((-0.25, -0.25, 0.38))
cam.location = loc
cam.rotation_euler = (tgt - loc).to_track_quat("-Z", "Y").to_euler()

scene.render.engine = "CYCLES"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"
scene.render.resolution_x, scene.render.resolution_y = 700, 490
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("STATS", json.dumps(res["stats"]))
