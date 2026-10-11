"""S7 deck pass: the .blend from the Floorplan Renderer -> the deck's room. Runs INSIDE Blender.

    blender -b <plan.v2.blend> --python tools/deck_pass.py -- <project_dir> <deck_dir> <out.blend> [--stills <dir>] [--res 960] [--samples 24]

What the canvas cannot say and the deck does, applied by reading roombrief/resolve (never hard-coded):
  - exposed ceiling: a painted soffit plate over the room outline at the trace's level height
  - logo: the signage object's letter BLOCKS replaced by real extruded text (`text` param), same height /
    depth / colour, and its halo row made emissive (deck: dark blue, backlit)
  - TV screens: an emissive image (deck: "add some image to the TV display")
  - render settings for low-quality previews (Cycles CPU, OIDN, AgX), one still per deck camera
Positions are read from the baked objects' world bounding boxes (plan geometry has its coordinates baked
in; obj.location is always the origin).
"""
import json, math, os, sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
P, DECK, OUT = Path(argv[0]), Path(argv[1]), os.path.abspath(argv[2])
flag = lambda n, d=None, c=str: c(argv[argv.index(f"--{n}") + 1]) if f"--{n}" in argv else d
STILLS = flag("stills")
RES, SPP = flag("res", 960, int), flag("samples", 24, int)

brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
trace = json.loads((P / "trace.px.json").read_text(encoding="utf-8"))
items = {i["id"]: i for i in brief["items"]}
m = trace["scale"]["ref_mm"] / 1000 / math.dist(*trace["scale"]["ref_px"])
ox, oy = trace["origin_px"]
W = lambda p: ((p[0] - ox) * m, (oy - p[1]) * m)
H = trace["level"]["height_m"]
log = []


def mat(name, color, strength=0.0, rough=0.6, image=None):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    b = mt.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    if strength:
        b.inputs["Emission Color"].default_value = (*color, 1)
        b.inputs["Emission Strength"].default_value = strength
    if image:
        tex = mt.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(image)
        mt.node_tree.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        mt.node_tree.links.new(tex.outputs["Color"], b.inputs["Emission Color"])
    return mt


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def world_verts(o):
    return [o.matrix_world @ v.co for v in o.data.vertices]


def objs(stem, row=None):
    out = []
    for o in bpy.data.objects:
        if o.type != "MESH":
            continue
        # bp_row is the render PRIMITIVE id (p3_let); the row's NAME is in the object name ("Logo Signage · Letters · …")
        if stem in str(o.get("bp_object", "")) and (row is None or f"· {row.lower()}" in o.name.lower()
                                                     or row.lower() in str(o.get("bp_row", "")).lower()):
            out.append(o)
    return out


# ── 1. exposed ceiling ──────────────────────────────────────────────────────────────────────────────
ring = []
for w in trace["walls"]:
    for p in (w["a"], w["b"]):
        q = W(p)
        if q not in ring:
            ring.append(q)
cx = sum(p[0] for p in ring) / len(ring)
cy = sum(p[1] for p in ring) / len(ring)
ring.sort(key=lambda p: math.atan2(p[1] - cy, p[0] - cx))
me = bpy.data.meshes.new("Ceiling soffit")
me.from_pydata([(x, y, H) for x, y in ring], [], [list(range(len(ring)))[::-1]])
ceil = bpy.data.objects.new("Ceiling soffit (exposed, painted white) · CL-02", me)
ceil.data.materials.append(mat("deck.soffit.white", srgb("#F2F2EF"), rough=0.85))
ceil["bp_object"] = "deck-pass"
bpy.context.scene.collection.objects.link(ceil)
log.append(f"ceiling: soffit over {len(ring)}-gon at +{H:.2f}")

# ── 2. logo: blocks -> extruded text, halo emissive ─────────────────────────────────────────────────
lg = items.get("WL-02", {}).get("params", {})
letters = objs("logo-signage", "Letters")
if letters:
    vs = [v for o in letters for v in world_verts(o)]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    # the run direction is the longest horizontal spread of the blocks; the face normal is horizontal and
    # perpendicular to it, pointing away from the wall (toward the room centre)
    pts = sorted(vs, key=lambda v: v.x + v.y)
    run = (pts[-1] - pts[0]); run.z = 0; run.normalize()
    nrm = Vector((-run.y, run.x, 0))
    mid = (lo + hi) / 2
    if (Vector((cx, cy, mid.z)) - mid).dot(nrm) < 0:
        nrm = -nrm
    if run.cross(nrm).z < 0:  # read left->right from the room
        run = -run
    height = hi.z - lo.z
    curve = bpy.data.curves.new("logo text", "FONT")
    curve.body = str(lg.get("text", "MARIAN"))
    curve.align_x, curve.align_y = "CENTER", "CENTER"
    curve.size = height * 1.35
    curve.extrude = 0.02
    txt = bpy.data.objects.new("Logo text · WL-02", curve)
    bpy.context.scene.collection.objects.link(txt)
    txt.location = mid + nrm * 0.02
    # a text object rotated 90 deg about X faces local -Y: turn it so -Y points along the room-side normal
    txt.rotation_euler = (math.pi / 2, 0, math.atan2(nrm.x, -nrm.y))
    txt.data.materials.append(mat("deck.logo.darkblue", srgb(lg.get("colour", "#0B2D6B")), rough=0.3))
    for o in letters:
        o.hide_render = o.hide_viewport = True
    log.append(f"logo: '{curve.body}' {height:.2f} m text replaces {len(letters)} block object(s)")
for o in objs("logo-signage", "Halo"):
    o.data.materials.clear()
    # S8: at strength 12 the halo washed the dark-blue letters white
    o.data.materials.append(mat("deck.logo.halo", srgb("#FFF1DC"), strength=3.0))
    log.append("logo: halo emissive (backlit)")

# ── 3. TV screens ───────────────────────────────────────────────────────────────────────────────────
views = [f for v in brief.get("views", []) for f in v.get("images", [])]
img = str(DECK / views[0]) if views else None
for o in objs("tv", "Screen"):
    o.data.materials.clear()
    o.data.materials.append(mat("deck.tv.screen", (0.9, 0.9, 0.9), strength=2.5, rough=0.2, image=img))
    uv = o.data.uv_layers.new() if not o.data.uv_layers else o.data.uv_layers[0]
    log.append("tv: screen shows a deck image")

# ── 3b. name the cameras after the deck shots (nearest resolve.json camera position) ───────────────────
res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
for cam in [o for o in bpy.data.objects if o.type == "CAMERA" and o.data.type == "PERSP"]:
    best = min(res.get("cameras", []), key=lambda c: (Vector((*W(c["at_px"]), 0)) - Vector((cam.location.x, cam.location.y, 0))).length, default=None)
    if best and (Vector((*W(best["at_px"]), 0)) - Vector((cam.location.x, cam.location.y, 0))).length < 0.3:
        cam.name = f"{best['id']} · {best['name']}"
        log.append(f"camera {cam.name}")

# ── 4. scene + render settings for previews ─────────────────────────────────────────────────────────
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SPP
sc.cycles.use_adaptive_sampling = True
sc.cycles.use_denoising = True
sc.cycles.denoiser = "OPENIMAGEDENOISE"
sc.cycles.max_bounces = 6
sc.cycles.caustics_reflective = sc.cycles.caustics_refractive = False
sc.cycles.sample_clamp_indirect = 6
sc.render.resolution_x, sc.render.resolution_y = RES, int(RES * 9 / 16)
sc.render.resolution_percentage = 100
sc.view_settings.view_transform = "AgX"
try:
    sc.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    pass
sc.view_settings.exposure = flag("exposure", 0.6, float)
if sc.world is None:
    sc.world = bpy.data.worlds.new("World")
sc.world.use_nodes = True
bg = sc.world.node_tree.nodes.get("Background")
if bg:
    bg.inputs["Color"].default_value = (0.8, 0.82, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.6

bpy.ops.wm.save_as_mainfile(filepath=OUT)
log.append(f"saved {OUT}")
print("\n".join("[deck] " + l for l in log))

if STILLS:
    os.makedirs(STILLS, exist_ok=True)
    cams = [o for o in bpy.data.objects if o.type == "CAMERA" and o.data.type == "PERSP"]
    only = flag("only")
    for cam in cams:
        if only and only not in cam.name:
            continue
        sc.camera = cam
        name = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in cam.name)[:60]
        sc.render.filepath = os.path.join(os.path.abspath(STILLS), f"{name}.png")
        bpy.ops.render.render(write_still=True)
        print(f"[deck] still {sc.render.filepath}")
