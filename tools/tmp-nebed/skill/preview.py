"""Quick look: add/aim the hero camera and render a small preview.
blender -b <in.blend> -P preview.py -- <out.png> [pct] [spp] [camname]"""
import bpy, sys, math, mathutils

argv = sys.argv[sys.argv.index("--") + 1:]
out = argv[0]
pct = int(argv[1]) if len(argv) > 1 else 30
spp = int(argv[2]) if len(argv) > 2 else 12
camname = argv[3] if len(argv) > 3 else "Hero"

sc = bpy.context.scene
cam = bpy.data.objects.get(camname)
if cam is None:
    cd = bpy.data.cameras.new("Hero")
    cam = bpy.data.objects.new("Hero", cd)
    sc.collection.objects.link(cam)
    cam.location = (2.40, -2.30, 1.20)
    cam.rotation_euler = (math.radians(90), 0, math.radians(137))
    cd.lens = 16; cd.sensor_width = 36; cd.clip_start = 0.05
sc.camera = cam
r = sc.render
r.engine = "CYCLES"; sc.cycles.device = "CPU"
r.resolution_x, r.resolution_y, r.resolution_percentage = 1600, 1000, pct
sc.cycles.samples = spp; sc.cycles.time_limit = 0
sc.cycles.use_denoising = True
r.filepath = out
r.image_settings.file_format = "PNG"
bpy.ops.render.render(write_still=True)
print("[pv] wrote", out)
