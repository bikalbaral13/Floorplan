"""S7 3D: the baked room (tools/bakeplan output, the same meshes the drawings use) -> a 3D model + snapshot images.
Runs INSIDE Blender (4.x), self-contained — no renderer skill scripts needed:

    blender -b --factory-startup --python tools/export_3d.py -- <baked.json> <out_dir> <CODE> [--res 1280x720] [--samples 32]

Writes <out_dir>/<CODE>.blend, <CODE>.fbx, <CODE>.glb and <CODE>_<camera>.png for every deck camera in the canvas
plus two corner views and one top view. Materials are the baked colours (Principled BSDF) — the look of the editor's
3D view, not a production render; the deck's materials stay on the canvas params for a full render later.
Frames: baked anchors / faces are metres in CANVAS axes — x east, y DOWN the sheet (south), z up. Blender gets them
flipped to y NORTH (y_world = -y_baked, normals recomputed), the frame the cameras use: a canvas camera at node px
(x, y) is at (x/ppm, -y/ppm) and its rotation r is a view direction in canvas axes, so the world direction is
(cos r, -sin r).
"""
import json, math, os, sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
BAKED, OUT, CODE = argv[0], os.path.abspath(argv[1]), argv[2]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
RES = [int(v) for v in opt("--res", "1280x720").split("x")]
SAMPLES = int(opt("--samples", "32"))
os.makedirs(OUT, exist_ok=True)
doc = json.load(open(BAKED, encoding="utf-8"))
ppm = float(doc.get("settings", {}).get("pixelsPerMeter") or 100)

# empty scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

mats = {}
def material(hex_colour, name):
    key = (hex_colour or "#cccccc").lower()
    if key in mats: return mats[key]
    h = key.lstrip("#")
    try: r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    except ValueError: r = g = b = 0.8
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    m = bpy.data.materials.new(f"{name} {key}")
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (lin(r), lin(g), lin(b), 1)
    bsdf.inputs["Roughness"].default_value = 0.6
    if name.lower().startswith(("glass", "glazing", "pane")):
        bsdf.inputs["Alpha"].default_value = 0.25
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    mats[key] = m
    return m

root = bpy.data.collections.new(CODE); scene.collection.children.link(root)
n_obj = n_face = 0
floors = []   # (area, x0, y0, x1, y1) of each room floor plate — the corner cameras stand in the largest
lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
for coll in ("nodes", "segments", "spaces"):
    for host in doc.get(coll, []):
        for a in host.get("attachments", []):
            b = a.get("baked")
            if not b or "camera" in (a.get("objectId") or ""):
                continue
            ax, ay = b.get("anchor", [0, 0])
            ay = -ay                                   # canvas y-down -> world y-north
            for mesh in b.get("meshes", []):
                verts, faces = [], []
                for f in mesh.get("faces", []):
                    idx = []
                    for p in f:
                        v = Vector((ax + p[0], ay - p[1], p[2] if len(p) > 2 else 0))
                        verts.append(v); idx.append(len(verts) - 1)
                        lo = Vector(map(min, lo, v)); hi = Vector(map(max, hi, v))
                    if len(idx) >= 3: faces.append(idx)
                if not faces: continue
                if (a.get("objectId") or "").startswith("room") and "floor" in (mesh.get("name") or "").lower():
                    xs = [verts[i].x for f in faces for i in f]; ys = [verts[i].y for f in faces for i in f]
                    floors.append(((max(xs) - min(xs)) * (max(ys) - min(ys)), min(xs), min(ys), max(xs), max(ys)))
                me = bpy.data.meshes.new(mesh.get("name") or "mesh")
                me.from_pydata([tuple(v) for v in verts], [], faces)
                me.validate(); me.update()
                import bmesh
                bm = bmesh.new(); bm.from_mesh(me)
                bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
                bmesh.ops.recalc_face_normals(bm, faces=bm.faces)   # the y flip mirrored the winding
                bm.to_mesh(me); bm.free()
                ob = bpy.data.objects.new(f"{a.get('params', {}).get('specId') or a.get('objectId', 'obj')} {mesh.get('name', '')}".strip(), me)
                ob.data.materials.append(material(mesh.get("color"), mesh.get("name") or "part"))
                root.objects.link(ob)
                n_obj += 1; n_face += len(faces)
bpy.ops.object.select_all(action="SELECT") if bpy.context.view_layer.objects else None
for ob in root.objects:   # merge coincident vertices so smooth surfaces and FBX normals behave
    pass
print(f"{CODE}: {n_obj} mesh objects, {n_face} faces; bounds {tuple(round(c, 2) for c in lo)} .. {tuple(round(c, 2) for c in hi)}")

# light: sky + sun + a soft fill under the ceiling
world = bpy.data.worlds.new("sky"); scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.82, 0.86, 0.92, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")); sun.data.energy = 2.5
sun.rotation_euler = (math.radians(50), 0, math.radians(35)); scene.collection.objects.link(sun)
centre = (lo + hi) / 2
fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA")); fill.data.energy = 600; fill.data.size = max(hi.x - lo.x, hi.y - lo.y)
fill.location = (centre.x, centre.y, min(hi.z, 2.6) - 0.05); scene.collection.objects.link(fill)

cams = []
def add_camera(name, at, look, lens=20, ortho=None):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    if ortho: cd.type = "ORTHO"; cd.ortho_scale = ortho
    ob = bpy.data.objects.new(name, cd); scene.collection.objects.link(ob)
    ob.location = at
    d = Vector(look) - Vector(at)
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cams.append(ob)

# the deck's cameras from the canvas (node px -> world m), eye height from their params
for host in doc.get("nodes", []):
    for a in host.get("attachments", []):
        if "camera" not in (a.get("objectId") or ""): continue
        p = a.get("params", {})
        x, y = host["x"] / ppm, -host["y"] / ppm
        r = math.radians(float(p.get("rotation", 0)))
        eye = float(p.get("eyeHeight", 1.6))
        name = (p.get("name") or p.get("label") or host.get("id") or "CAM").split(" ")[0].replace("/", "-")
        add_camera(name if name.upper().startswith("CAM") else f"CAM-{name}", (x, y, eye), (x + math.cos(r), y - math.sin(r), eye - 0.08), float(p.get("focalLength", 20)))
# two corner views + a top view, always
eye = 1.6
_, fx0, fy0, fx1, fy1 = max(floors) if floors else (0, lo.x, lo.y, hi.x, hi.y)
rc = Vector(((fx0 + fx1) / 2, (fy0 + fy1) / 2, 1.0))
add_camera("CORNER-NW", (fx0 + 1.2, fy1 - 1.2, eye), rc)   # 1.2 m clears a corner column
add_camera("CORNER-SE", (fx1 - 1.2, fy0 + 1.2, eye), rc)
add_camera("TOP", (centre.x, centre.y, 25), (centre.x, centre.y, 0), ortho=max(hi.x - lo.x, hi.y - lo.y) * 1.15)

# render settings
# Cycles on the CPU: Eevee needs a GPU context to compile shaders and renders everything magenta when run headless
eng = "CYCLES"
scene.render.engine = eng
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
try: scene.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception: pass
scene.render.resolution_x, scene.render.resolution_y = RES
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX" if "AgX" in [v.identifier for v in scene.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"

shots = []
for cam in cams:
    # the TOP view hides the ceiling objects (anything above 2.0 m) so the plan reads
    hidden = []
    if cam.name == "TOP":
        for ob in root.objects:
            zs = [(ob.matrix_world @ v.co).z for v in ob.data.vertices]
            if zs and min(zs) > 2.0: ob.hide_render = True; hidden.append(ob)
    scene.camera = cam
    scene.render.filepath = os.path.join(OUT, f"{CODE}_{cam.name}.png")
    bpy.ops.render.render(write_still=True)
    for ob in hidden: ob.hide_render = False
    shots.append(os.path.basename(scene.render.filepath))
print(f"snapshots ({eng}): {', '.join(shots)}")

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f"{CODE}.blend"))
bpy.ops.object.select_all(action="DESELECT")
for ob in root.objects: ob.select_set(True)
bpy.ops.export_scene.fbx(filepath=os.path.join(OUT, f"{CODE}.fbx"), use_selection=True, apply_scale_options="FBX_SCALE_ALL", axis_forward="-Z", axis_up="Y")
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, f"{CODE}.glb"), export_format="GLB", use_selection=True)
print(f"wrote {CODE}.blend, {CODE}.fbx, {CODE}.glb -> {OUT}")
