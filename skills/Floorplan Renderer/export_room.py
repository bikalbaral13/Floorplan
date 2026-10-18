"""Cut ONE room out of a whole-floor render .blend and export it three ways — .blend, .glb, .dae/.obj.
The .skp is written afterwards, headlessly, by dump_for_skp.py + write_skp.py (no SketchUp window).

blender -b <floor>.blend -P export_room.py -- <out dir> --room "BEDROOM 3" [--name NE_Bedroom]
        [--box x0,x1,y0,y1] [--also x0,x1,y0,y1] [--pad 0.25] [--cams "NE Bedroom"]

  --room   the space label; its floor plate (Spaces collection, label after the '·') gives the box
  --box    override the box with the room's INTERIOR faces, Blender metres (an L-shaped plate would
           otherwise drag the en-suite's fixtures in)
  --also   a second box kept too — an entry strip, an alcove
  --cams   keep cameras whose name starts with this; default: every camera inside the box

Keeps: visible meshes whose bbox CENTRE is inside the (padded) box, structural rows (walls, columns,
doors, windows) that merely overlap it, lamps inside it, the sun. Deletes everything else, purges.
  → <name>.blend  procedural materials, lamps, cameras, render settings — the master
  → <name>.glb    procedurals baked to 1 m swatches (glTF cannot carry a procedural — arrives WHITE)
  → <name>.dae / .obj + textures/   exchange copies; the .skp is built from the same swatches"""
import bpy, sys, os, re, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[0])


def flag(n, d=None):
    return argv[argv.index(n) + 1] if n in argv else d


os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)
scene = bpy.context.scene
log = lambda *a: print("[ex]", *a)
NAME = flag("--name", "Room")
PAD = float(flag("--pad", 0.25))


def bb(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [min(p[i] for p in pts) for i in range(3)] + [max(p[i] for p in pts) for i in range(3)]


def parse_box(s):
    return tuple(float(v) for v in s.split(",")) if s else None


ROOM = parse_box(flag("--box"))
if ROOM is None:
    want = (flag("--room") or "").strip().lower()
    plate = next((o for o in bpy.data.objects if o.type == "MESH" and o.name.startswith("Room ·")
                  and o.name.split("·")[-1].strip().lower() == want), None)
    if plate is None:
        labels = sorted({o.name.split("·")[-1].strip() for o in bpy.data.objects if o.name.startswith("Room ·")})
        sys.exit(f"[ex] no floor plate for --room {want!r}. Have: {labels}")
    b = bb(plate); ROOM = (b[0], b[3], b[1], b[4])
ENTRY = parse_box(flag("--also")) or ROOM
CAMS = flag("--cams")
log("box", [round(v, 2) for v in ROOM], "also", [round(v, 2) for v in ENTRY])


def inside(x, y, box, pad):
    return box[0] - pad <= x <= box[1] + pad and box[2] - pad <= y <= box[3] + pad


def overlaps(b, box, pad):
    return b[3] > box[0] - pad and b[0] < box[1] + pad and b[4] > box[2] - pad and b[1] < box[3] + pad


keep = set()
for o in bpy.data.objects:
    if o.type == "MESH":
        if o.hide_render:
            continue
        b = bb(o)
        cx, cy = (b[0] + b[3]) / 2, (b[1] + b[4]) / 2
        structural = o.name.startswith(("Wall ·", "Column ·", "Window ·", "Door ·"))
        if inside(cx, cy, ROOM, PAD) or inside(cx, cy, ENTRY, 0.1) or (structural and overlaps(b, ROOM, 0.05)):
            keep.add(o)
    elif o.type == "LIGHT":
        if o.data.type == "SUN" or inside(o.location.x, o.location.y, ROOM, 0.3) or inside(o.location.x, o.location.y, ENTRY, 0.1):
            if not o.hide_render:
                keep.add(o)
    elif o.type == "CAMERA":
        if (CAMS and o.name.startswith(CAMS)) or (not CAMS and o.data.type != "ORTHO" and inside(o.location.x, o.location.y, ROOM, 0.05)):
            keep.add(o)

drop = [o for o in bpy.data.objects if o not in keep]
for o in drop:
    bpy.data.objects.remove(o, do_unlink=True)
for c in list(bpy.data.collections):
    if not c.all_objects:
        bpy.data.collections.remove(c)
bpy.ops.outliner.orphans_purge(do_recursive=True)
scene.camera = next((o for o in bpy.data.objects if o.type == "CAMERA"), None)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
log(f"kept {len(meshes)} meshes, {sum(o.type == 'LIGHT' for o in bpy.data.objects)} lights, "
    f"{sum(o.type == 'CAMERA' for o in bpy.data.objects)} cameras, {len(bpy.data.materials)} materials")
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{NAME}.blend"), compress=True)
log("saved blend")

# ── exchange formats: flatten procedurals (render_plan.py's own flatten_for_gltf, reused verbatim)
src = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_plan.py"), encoding="utf8").read()
fn = re.search(r"^def flatten_for_gltf\(.*?(?=^\S)", src, re.S | re.M).group(0)
exec(fn, globals())

# architectural glass is a Light Path trick no exchange format understands → a plain transmissive pane
glass = bpy.data.materials.new("Glass")
glass.use_nodes = True
g = glass.node_tree.nodes["Principled BSDF"]
g.inputs["Base Color"].default_value = (0.85, 0.92, 0.92, 1)
g.inputs["Transmission Weight"].default_value = 1.0
g.inputs["Roughness"].default_value = 0.02
g.inputs["Alpha"].default_value = 0.25
glass.diffuse_color = (0.85, 0.92, 0.92, 0.25)
for o in meshes:
    for s in o.material_slots:
        if s.material and s.material.name.startswith("Glass — architectural"):
            s.material = glass

flatten_for_gltf(size=512, span=1.0, bake=True)
for img in bpy.data.images:
    if img.name.startswith("bake"):
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", img.name).strip("_") + ".png"
        path = os.path.join(OUT, "textures", safe)
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
        img.filepath = path

bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{NAME}.glb"), export_format="GLB",
                          export_apply=True, export_cameras=True, export_lights=True, use_visible=False)
log("saved glb")

# SketchUp: no lamps/cameras, modifiers applied, Z up in metres
for o in [o for o in bpy.data.objects if o.type != "MESH"]:
    bpy.data.objects.remove(o, do_unlink=True)
if hasattr(bpy.ops.wm, "collada_export"):
    bpy.ops.wm.collada_export(filepath=os.path.join(OUT, f"{NAME}.dae"), apply_modifiers=True,
                              export_mesh_type_selection="render", use_texture_copies=True,
                              triangulate=False, export_global_up_selection="Z", export_global_forward_selection="Y")
    log("saved dae")
else:
    log("! no COLLADA exporter in this Blender")
bpy.ops.wm.obj_export(filepath=os.path.join(OUT, f"{NAME}.obj"), apply_modifiers=True,
                      export_eval_mode="DAG_EVAL_RENDER", path_mode="COPY", forward_axis="Y", up_axis="Z")
log("saved obj")
