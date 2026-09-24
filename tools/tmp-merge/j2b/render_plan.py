"""render_plan.py — a baked canvas plan becomes a render-ready .blend, a set of stills and a GLB.

    blender -b --python render_plan.py -- <baked.json> --out <dir> [flags]

WHAT IT BUILDS. One mesh object per baked render row, not one per attachment: a wardrobe arrives as seven
objects (carcass, doors, grooves, end panels, mirror, rail, shelves) rather than one with seven material
slots. Seven objects cost nothing in a path tracer, and they are what makes a material swap, a hide, or a
per-part UV scale a one-liner instead of a polygon-index hunt.

FOUR THINGS THE PLAN DOES NOT SAY and this script decides:

  1. Lights. The plan's downlights, pendants and the Directional light are GEOMETRY — the object library
     draws a housing and a beam cone and explicitly does no photometry. Their parameters, though, carry
     real lumens, kelvin and beam angles, so every fixture here becomes a real Blender lamp placed at the
     geometry's own anchor. lm -> W divides by `LM_PER_W`: 683 lm/W at peak times the ~0.27 luminous
     efficiency of a broadband white source. Tune it with --lm-per-w; do not tune it per fixture.
  2. Cameras. Same story: the four camera objects carry focal length, sensor width and eye height. Bearing
     is `rotation + 90` measured atan2(x, -y), the convention the objects' own view cones use.
  3. Helpers. Camera bodies, tripods, blue view cones and amber aim tubes are drawing aids. They stay in
     the file, in a Helpers collection, with hide_render set — the .blend still documents where each shot
     was framed from, and none of it reaches the render or the GLB.
  4. World. A Nishita sky with the sun disc OFF, aligned to the Directional light's own bearing. The disc
     is off because the SUN lamp already does the direct light; leaving both on doubles it.

ENGINE. Cycles, CPU. EEVEE Next renders flat magenta in background mode on a machine with no GPU, which
is what this one is; the failure is silent and looks like a material bug, so it is not offered.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp_materials as bpm   # noqa: E402

# ── arguments ────────────────────────────────────────────────────────────────
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    raise SystemExit("usage: blender -b --python render_plan.py -- <baked.json> --out <dir> [flags]")


def flag(name, default=None, cast=str):
    key = f"--{name}"
    if key in argv:
        i = argv.index(key)
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            return cast(argv[i + 1])
    return default


def has(name):
    return f"--{name}" in argv


PLAN_FILE = argv[0]
# Absolute, always: Blender resolves a relative render path against its own notion of the working
# directory, which in background mode is the drive root — a still would land in C:\out and never be found.
OUT = os.path.abspath(flag("out", os.path.dirname(os.path.abspath(PLAN_FILE))))
SAMPLES = flag("samples", 64, int)
WIDTH = flag("res", 1280, int)
LM_PER_W = flag("lm-per-w", 184.0, float)
SUN_SCALE = flag("sun", 1.0, float)
SKY_STRENGTH = flag("sky", 1.0, float)
EXPOSURE = flag("exposure", 0.0, float)
# A ceiling fan states `lightKit` / `ringLight` and a kelvin but NO lumen figure — the object draws a
# diffuser and leaves the photometry out. Ignoring it leaves the room's central fitting glowing and
# emitting nothing, so it gets a stated default rather than silence.
FAN_LM = flag("fan-lumens", 1400.0, float)
ONLY_CAM = flag("camera", None)
# A plan view is a CUT, not a photograph from the ceiling. Without one the false ceilings, the
# cove bands and the cornices are simply the nearest surface to an overhead camera and the rooms
# come back as white rectangles. Hiding everything whose LOWEST vertex is above the cut leaves
# the walls (they start at the floor), the furniture and the fittings, and takes the lid off.
CUT_Z = flag("cut", None, float)
os.makedirs(OUT, exist_ok=True)

with open(PLAN_FILE, "r", encoding="utf-8") as f:
    plan = json.load(f)
MATERIALS = plan.get("materials") or {}
log = lambda *a: print("[bp]", *a)

# ── scene reset ──────────────────────────────────────────────────────────────
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpm.clear_cache()

STEM = lambda att: str(att.get("objectPath") or "").split("/")[-1].replace(".json", "").lower()


def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or scene.collection).children.link(col)
    return col


ROOT = collection(os.path.splitext(os.path.basename(PLAN_FILE))[0].replace(".baked", ""))
COLS = {k: collection(k, ROOT) for k in ("Walls", "Doors", "Windows", "Spaces", "Objects", "Helpers", "Lighting", "Cameras")}

hosts = [("segment", h) for h in plan.get("segments", [])] + \
        [("node", h) for h in plan.get("nodes", [])] + \
        [("space", h) for h in plan.get("spaces", [])]
if not any(a.get("baked") for _, h in hosts for a in (h.get("attachments") or [])):
    raise SystemExit("! this plan carries no baked geometry — run bake_plan.mjs on it first")


# ── geometry ─────────────────────────────────────────────────────────────────
def uv_project(mesh, scale=1.0):
    """Planar UVs in metres, chosen per face by its dominant normal axis. Two things need them: an image
    map in a material (a procedural does not — it reads world Position), and glTF, which has no concept of
    either and would otherwise export an untextured factor. Scale is metres per UV unit, so a 1 m tile is
    1 m on the wall and on the floor, and the seam between them is where the normal flips."""
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        n = poly.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if az >= ax and az >= ay:
                u, v = co.x, co.y
            elif ax >= ay:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[li].uv = (u / scale, v / scale)


def build_part(name, anchor, part, col, props):
    """One object from one baked render row. Rings are anchor-relative metres, z up; Blender's y runs the
    other way from the canvas's, which is the whole of the frame conversion."""
    ax, ay = float(anchor[0]), float(anchor[1])
    verts, faces, index = [], [], {}

    def vid(p):
        key = (round(ax + p[0], 5), round(-(ay + p[1]), 5), round(p[2], 5))
        i = index.get(key)
        if i is None:
            i = len(verts)
            verts.append(key)
            index[key] = i
        return i

    for ring in part.get("faces") or []:
        if len(ring) < 3:
            continue
        idx = [vid(p) for p in ring]
        clean = [i for k, i in enumerate(idx) if k == 0 or i != idx[k - 1]]
        if clean and clean[0] == clean[-1]:
            clean = clean[:-1]
        if len(clean) >= 3 and len(set(clean)) == len(clean):
            faces.append(clean)
    if not faces:
        return None

    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    uv_project(mesh)
    mesh.shade_flat()      # the default; the curved rows are promoted below, once, in one operator call

    obj = bpy.data.objects.new(name, mesh)
    col.objects.link(obj)
    for k, v in props.items():
        if v is not None:
            obj[k] = v if isinstance(v, (int, float, str, bool)) else json.dumps(v)
    return obj


def material_for(part):
    """The row's library material, tinted if the finishes file said so; its flat colour if it has none."""
    path = part.get("material")
    definition = MATERIALS.get(path) if path else None
    if definition is None:
        alpha = 0.35 if "glaz" in (part.get("name") or "").lower() else 1.0
        return bpm.flat_material(part.get("color") or "#94a3b8", alpha)
    tint = part.get("tint")
    kelvin = part.get("kelvin") if part.get("emissive") else None
    title = definition.get("title") or definition.get("id") or "material"
    label = f"{title}{' · ' + tint if tint else ''}"
    return bpm.material_from_def(definition, part.get("color") or "#94a3b8", label, tint=tint, emissive_kelvin=kelvin)


KIND_COL = {"wall": "Walls", "door": "Doors", "window": "Windows", "room": "Spaces"}
stats = {"objects": 0, "faces": 0, "helpers": 0, "empty": 0}

for host_kind, host in hosts:
    label = (host.get("label") or "").strip() or host.get("id") or ""
    for att in host.get("attachments") or []:
        baked = att.get("baked") or {}
        if not baked.get("anchor"):
            continue
        stem = STEM(att)
        # A fixture's own colour temperature travels to its emissive rows, so a 2700 K pendant diffuser and
        # a 3000 K downlight lens do not both glow at the library default.
        kelvin = (att.get("params") or {}).get("kelvin")
        target = COLS.get(KIND_COL.get(stem, ""), None) or collection(stem.replace("-", " ").title(), COLS["Objects"])
        for part in baked.get("meshes") or []:
            hidden = part.get("render") is False
            if kelvin and part.get("emissive"):
                part["kelvin"] = kelvin
            name = f"{stem.replace('-', ' ').title()} · {part.get('name') or part.get('id')} · {label}"
            obj = build_part(name, baked["anchor"], part, COLS["Helpers"] if hidden else target, {
                "bp_host": host_kind, "bp_host_id": host.get("id"), "bp_object": att.get("objectPath"),
                "bp_row": part.get("id"), "bp_surface": part.get("surface"), "bp_material": part.get("material"),
            })
            if obj is None:
                stats["empty"] += 1
                continue
            obj.data.materials.append(material_for(part))
            if hidden:
                obj.hide_render = True
                obj.hide_viewport = False
                stats["helpers"] += 1
            stats["objects"] += 1
            stats["faces"] += len(obj.data.polygons)

# ── smooth the curved rows ───────────────────────────────────────────────────
# A parametric "cylinder" is a 24-sided prism and a drape is a swept polyline: flat-shaded they read as
# origami. Auto-smooth by angle is the only correct answer — plain smooth shading would round the corners
# of every box too. The row count is the discriminator: a box is six faces, a swept solid is hundreds.
curved = [o for o in bpy.data.objects if o.type == "MESH" and len(o.data.polygons) >= 60]
if curved:
    for o in bpy.data.objects:
        o.select_set(False)
    for o in curved:
        o.select_set(True)
    bpy.context.view_layer.objects.active = curved[0]
    try:
        bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    except (AttributeError, RuntimeError, TypeError) as exc:      # noqa: BLE001
        log(f"! auto-smooth unavailable ({exc}) — leaving the curved rows flat")
    for o in curved:
        o.select_set(False)
log(f"smoothed  {len(curved)} curved objects")

log(f"geometry  {stats['objects']} objects, {stats['faces']} faces, {stats['helpers']} helpers hidden, {stats['empty']} empty")
log(f"materials {len(bpy.data.materials)} unique from {len(MATERIALS)} definitions")


# ── lights ───────────────────────────────────────────────────────────────────
def bearing_dir(rotation_deg, tilt_deg):
    """Plan bearing -> a unit vector in Blender space. `rotation + 90` measured atan2(x, -y) is the
    convention the camera objects' view cones are drawn with, checked against all four of them; tilt is
    signed from the horizon, negative pointing down."""
    b = math.radians(float(rotation_deg or 0) + 90.0)
    t = math.radians(float(tilt_deg or 0))
    return Vector((math.sin(b) * math.cos(t), math.cos(b) * math.cos(t), math.sin(t)))


def aim(obj, direction):
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def add_light(name, kind, location, energy, kelvin, **kw):
    data = bpy.data.lights.new(name, type=kind)
    data.energy = energy
    data.color = bpm.kelvin_rgb(kelvin)
    for k, v in kw.items():
        if hasattr(data, k):
            setattr(data, k, v)
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    COLS["Lighting"].objects.link(obj)
    return obj


# Every fixture that actually emits. The original four missed every LINEAR source in the library —
# a cove at 900 lm/m over a 14 m perimeter is 12 600 lm, routinely the largest lamp in the room, and
# it was silently not a light at all. These state lumensPerMetre rather than lumens, so their flux is
# computed from the run they sit on.
LAMP_STEMS = ("light", "downlight", "pendant", "ceiling-fan",
              "false-ceiling", "cove-light", "led-strip", "curtain-pelmet",
              "light-panel", "chandelier", "outdoor-light", "wall-washer", "track-head",
              "mirror", "upholstered-panel", "floor-lamp", "light-bulb")

lamps = {"sun": 0, "spot": 0, "point": 0, "area": 0}
sun_dir = None
for host_kind, host in hosts:
    for att in host.get("attachments") or []:
        stem, p, baked = STEM(att), att.get("params") or {}, att.get("baked") or {}
        if not baked.get("anchor") or stem not in LAMP_STEMS:
            continue
        ax, ay = float(baked["anchor"][0]), -float(baked["anchor"][1])
        lm = float(p.get("lumens") or 0)
        k = float(p.get("kelvin") or 3000)

        if stem == "light":
            kind = str(p.get("type") or "Spot")
            direction = bearing_dir(p.get("rotation"), p.get("aimTilt", -25))
            h = float(p.get("mountHeight") or 2.4)
            if kind == "Directional":
                # Irradiance, not flux: a sun's strength is W/m², so the lumens are divided by the emitting
                # area first. Stood back along its own ray so its shadow camera covers the room.
                area = max(float(p.get("sizeLength") or 1.5) * float(p.get("sizeWidth") or 2.1), 0.2)
                sun = add_light("Sun · daylight", "SUN", (ax - direction.x * 6, ay - direction.y * 6, h - direction.z * 6),
                                (lm / area) / LM_PER_W * SUN_SCALE, k, angle=math.radians(2.0))
                aim(sun, direction)
                sun_dir = direction
                lamps["sun"] += 1
            elif kind in ("Area", "Linear"):
                obj = add_light("Area · " + (host.get("label") or host.get("id") or ""), "AREA", (ax, ay, h),
                                lm / LM_PER_W, k, shape="RECTANGLE",
                                size=float(p.get("sizeLength") or 0.6), size_y=float(p.get("sizeWidth") or 0.3))
                aim(obj, direction)
                lamps["area"] += 1
            elif kind == "Point":
                add_light("Point · " + (host.get("label") or host.get("id") or ""), "POINT", (ax, ay, h), lm / LM_PER_W, k, shadow_soft_size=0.05)
                lamps["point"] += 1
            else:
                obj = add_light("Spot · " + (host.get("label") or host.get("id") or ""), "SPOT", (ax, ay, h), lm / LM_PER_W, k,
                                spot_size=math.radians(float(p.get("beamAngle") or p.get("coneAngle") or 40)), spot_blend=0.3, shadow_soft_size=0.04)
                aim(obj, direction)
                lamps["spot"] += 1

        elif stem == "downlight":
            # Aim measured from straight DOWN, which is how the object states its gimbal tilt.
            # The object library renamed ceilingHeight -> mountHeight and tilt -> aimTilt. Reading only
            # the old name silently drops every downlight to the 2.7 default: on a 3.0 m slab with a
            # 2.77 panel soffit that is 70 mm of error on all 41 of them, and it reads as a flat room.
            z = float(p.get("mountHeight") or p.get("ceilingHeight") or 2.7) - float(p.get("housingHeight") or 0.09) * 0.4
            tilt = math.radians(float(p.get("aimTilt") or p.get("tilt") or 0))
            b = math.radians(float(p.get("rotation") or 0) + 90.0)
            direction = Vector((math.sin(b) * math.sin(tilt), math.cos(b) * math.sin(tilt), -math.cos(tilt)))
            obj = add_light(f"Downlight · {host.get('id')}", "SPOT", (ax, ay, z), lm / LM_PER_W, k,
                            spot_size=math.radians(float(p.get("beamAngle") or 36)), spot_blend=0.35,
                            shadow_soft_size=float(p.get("aperture") or 0.075) / 2)
            aim(obj, direction)
            lamps["spot"] += 1

        elif stem == "pendant":
            z = float(p.get("bottomHeight") or 1.2) + float(p.get("bodyLength") or 0.3) * 0.4
            add_light(f"Pendant · {host.get('id')}", "POINT", (ax, ay, z), lm / LM_PER_W, k,
                      shadow_soft_size=max(float(p.get("diameter") or 0.05) / 2, 0.02))
            lamps["point"] += 1

        elif stem == "ceiling-fan" and (lm or p.get("lightKit") or p.get("ringLight")):
            z = float(p.get("ceilingHeight") or p.get("soffit") or 2.9) - float(p.get("rodLength") or 0.3) - 0.05
            add_light(f"Fan light · {host.get('id')}", "POINT", (ax, ay, z), (lm or FAN_LM) / LM_PER_W, k,
                      shadow_soft_size=float(p.get("ringDia") or 0.35) / 2)
            lamps["point"] += 1
            if not lm:
                log(f"          fan light kit has no lumens — assumed {FAN_LM:.0f} lm (--fan-lumens)")

        else:
            # Everything else that emits. A linear source states lumens PER METRE and the run it sits on
            # comes from the baked extent, so the flux is length x lumensPerMetre. An AREA lamp the size
            # of the run is what a cove actually is — a point lamp there reads as a hotspot on the band.
            if not bool(p.get("emitsLight", True)):
                continue
            lpm = float(p.get("lumensPerMetre") or 0)
            ext = baked.get("extent") or {}
            run = 0.0
            try:
                run = max(float(ext.get("length") or 0), float(ext.get("width") or 0))
            except Exception:
                run = 0.0
            if not run:
                run = float(p.get("length") or p.get("panelLength") or 1.0)
            flux = lm or (lpm * max(run, 0.2))
            if flux <= 0:
                continue
            dim = float(p.get("dimLevel") or 100) / 100.0
            flux *= max(dim, 0.05)
            # A cove throws UP at the soffit; a panel, a mirror halo and a pelmet throw into the room.
            if stem in ("false-ceiling", "cove-light", "led-strip"):
                z = float(p.get("bandSoffit") or p.get("slabHeight") or p.get("mountHeight") or 2.6) - 0.06
                obj = add_light(f"Cove . {host.get('id')}", "AREA", (ax, ay, z), flux / LM_PER_W, k,
                                shape="RECTANGLE", size=max(run, 0.3), size_y=0.06)
                obj.rotation_euler = (0.0, 0.0, 0.0)          # +Z, straight up into the soffit
                lamps["area"] += 1
            else:
                z = float(p.get("mountHeight") or p.get("centreHeight") or p.get("sillHeight") or 1.6)
                obj = add_light(f"{stem} . {host.get('id')}", "AREA", (ax, ay, z), flux / LM_PER_W, k,
                                shape="RECTANGLE", size=max(run, 0.2), size_y=max(float(p.get("height") or 0.3), 0.1))
                aim(obj, bearing_dir(p.get("rotation"), -20))
                lamps["area"] += 1

log(f"lights    {lamps['sun']} sun, {lamps['spot']} spot, {lamps['point']} point, {lamps['area']} area  (lm/W {LM_PER_W:.0f})")


# ── cameras ──────────────────────────────────────────────────────────────────
ASPECT = {"16:9": 16 / 9, "3:2": 3 / 2, "4:3": 4 / 3, "1:1": 1.0, "2:1": 2.0, "21:9": 21 / 9}
cameras = []
for host_kind, host in hosts:
    for att in host.get("attachments") or []:
        if STEM(att) != "camera":
            continue
        baked, p = att.get("baked") or {}, att.get("params") or {}
        if not baked.get("anchor"):
            continue
        ax, ay = float(baked["anchor"][0]), -float(baked["anchor"][1])
        view = str(p.get("view") or "Perspective")
        # A Two-point perspective is an ordinary perspective with the tilt forced to zero — that is what
        # keeps the verticals vertical, and the object itself already zeroes it.
        tilt = 0.0 if view == "Two-point" else float(p.get("tilt") or 0)
        direction = bearing_dir(p.get("rotation"), tilt)
        data = bpy.data.cameras.new(f"Cam {len(cameras) + 1}")
        # The camera object has always offered an Orthographic view; nothing here honoured it, so a plan
        # view had to be faked with a long lens from very high up and still showed perspective at the
        # edges. ortho_scale is the WIDTH the frame covers, in metres.
        if view == "Orthographic":
            data.type = "ORTHO"
            data.ortho_scale = float(p.get("orthoScale") or p.get("targetDistance") or 12.0)
        else:
            data.lens = float(p.get("focalLength") or 24)
        data.sensor_width = float(p.get("sensorWidth") or 36)
        data.sensor_fit = "HORIZONTAL"
        data.clip_start = 0.02
        obj = bpy.data.objects.new(f"Cam {len(cameras) + 1} · {view}", data)
        obj.location = (ax, ay, float(p.get("eyeHeight") or 1.5))
        aim(obj, direction)
        obj["bp_view"] = view
        obj["bp_aspect"] = str(p.get("aspect") or "16:9")
        COLS["Cameras"].objects.link(obj)
        cameras.append(obj)

if not cameras:
    data = bpy.data.cameras.new("Cam fallback")
    obj = bpy.data.objects.new("Cam fallback", data)
    obj.location = (0, 0, 1.5)
    COLS["Cameras"].objects.link(obj)
    cameras.append(obj)
scene.camera = cameras[0]
log(f"cameras   {len(cameras)}")

if CUT_Z is not None:
    cut = 0
    for obj in list(bpy.data.objects):
        if obj.type != "MESH" or obj.hide_render or not obj.data.vertices:
            continue
        zmin = min((obj.matrix_world @ v.co).z for v in obj.data.vertices)
        if zmin > CUT_Z:
            obj.hide_render = True
            obj.hide_viewport = True
            cut += 1
    log(f"cut       {cut} objects hidden above z={CUT_Z:.2f} m")


# ── world ────────────────────────────────────────────────────────────────────
world = bpy.data.worlds.new("Sky")
world.use_nodes = True
scene.world = world
nt = world.node_tree
bg = nt.nodes.get("Background")
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_disc = False                      # the SUN lamp already does the direct light
if sun_dir is not None:
    sky.sun_elevation = math.asin(max(-0.99, min(0.99, -sun_dir.z)))
    sky.sun_rotation = math.atan2(-sun_dir.x, -sun_dir.y)
else:
    sky.sun_elevation = math.radians(35)
nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
bg.inputs["Strength"].default_value = SKY_STRENGTH


# ── render settings ──────────────────────────────────────────────────────────
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"               # EEVEE Next is magenta headless on a GPU-less box
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.cycles.denoiser = "OPENIMAGEDENOISE"
scene.cycles.use_adaptive_sampling = True
scene.cycles.adaptive_threshold = 0.01
scene.cycles.max_bounces = 8
scene.cycles.transmission_bounces = 8
scene.cycles.transparent_max_bounces = 8
scene.cycles.caustics_reflective = False
scene.cycles.caustics_refractive = False
scene.render.use_persistent_data = True
scene.render.film_transparent = False
scene.render.image_settings.file_format = "PNG"
scene.view_settings.view_transform = "AgX"
try:
    scene.view_settings.look = "AgX - Base Contrast"
except TypeError:
    pass
scene.view_settings.exposure = EXPOSURE

# The saved file has to be ready to render as it stands — someone opening it and pressing F12 should get
# the same picture this script does, at the same size, in the same place. Blender's 1920x1080 default would
# not match the camera's own aspect.
scene.render.resolution_x = WIDTH
scene.render.resolution_y = int(round(WIDTH / ASPECT.get(cameras[0].get("bp_aspect", "16:9"), 16 / 9)))
scene.render.filepath = os.path.join(OUT, "view1.png")

blend_path = os.path.join(OUT, os.path.splitext(os.path.basename(PLAN_FILE))[0].replace(".baked", "") + ".blend")
bpy.ops.wm.save_as_mainfile(filepath=blend_path)
log(f"saved     {blend_path}")

# ── GLB ──────────────────────────────────────────────────────────────────────
# glTF HAS NO PROCEDURALS. The exporter walks the node tree, finds a Wave feeding Base Color, does not know
# what to do with it and writes no baseColorFactor at all — the model arrives WHITE, which is worse than
# flat. So every material is flattened for the GLB and for the GLB only: this runs after the .blend is
# saved and after the stills, so the file on disk and the render keep the real shaders.
#
# Two ways to flatten, chosen per material:
#   BAKE   a 1 m square swatch of the procedural into a 512 px image, wired through the metre-scaled UVs
#          the geometry already carries — so a 1 m crop of marble lands on 1 m of floor. It tiles with a
#          seam every metre, which a GLB preview can live with and a Cycles render never sees.
#   FLAT   metals and pbr-only materials. A DIFFUSE bake of a metal is BLACK — metals have no diffuse
#          lobe — so baking them would be an actively wrong answer. They take their base colour as a factor.
def flatten_for_gltf(size=512, span=1.0, bake=True):
    baked_n = flat_n = 0
    mats = {slot.material for obj in bpy.data.objects
            if obj.type == "MESH" and not obj.hide_render
            for slot in obj.material_slots if slot.material}

    scene.cycles.bake_type = "DIFFUSE"
    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = False
    scene.render.bake.use_pass_color = True
    scene.render.bake.margin = 8
    keep_samples, scene.cycles.samples = scene.cycles.samples, 1

    quad = bpy.data.meshes.new("bp_swatch")
    quad.from_pydata([(0, 0, 0), (span, 0, 0), (span, span, 0), (0, span, 0)], [], [[0, 1, 2, 3]])
    quad.update()
    uv = quad.uv_layers.new(name="UVMap")
    for i, co in enumerate([(0, 0), (1, 0), (1, 1), (0, 1)]):
        uv.data[i].uv = co
    plate = bpy.data.objects.new("bp_swatch", quad)
    scene.collection.objects.link(plate)

    for mat in sorted(mats, key=lambda m: m.name):
        tree = mat.node_tree
        bsdf = tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        link = next((l for l in tree.links if l.to_socket == bsdf.inputs["Base Color"]), None)
        metallic = bsdf.inputs["Metallic"].default_value
        if link is None and metallic <= 0.5:
            continue                                   # already a plain factor — the exporter handles it
        source = link.from_socket if link else None

        if bake and source is not None and metallic <= 0.5:
            img = bpy.data.images.new(f"bake · {mat.name}", size, size, alpha=False)
            node = tree.nodes.new("ShaderNodeTexImage")
            node.image = img
            node.location = (-320, -320)
            tree.nodes.active = node
            plate.data.materials.clear()
            plate.data.materials.append(mat)
            for o in bpy.data.objects:
                o.select_set(False)
            plate.select_set(True)
            bpy.context.view_layer.objects.active = plate
            try:
                bpy.ops.object.bake(type="DIFFUSE")
                img.pack()
                tree.links.remove(link)
                tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
                baked_n += 1
                continue
            except RuntimeError as exc:                          # noqa: BLE001
                log(f"! bake {mat.name}: {exc}")

        # FLAT: the material's own recorded colour, which `bp_materials` left on `diffuse_color`.
        if link is not None:
            tree.links.remove(link)
        bsdf.inputs["Base Color"].default_value = tuple(mat.diffuse_color)
        flat_n += 1

    bpy.data.objects.remove(plate, do_unlink=True)
    scene.cycles.samples = keep_samples
    log(f"flattened {baked_n} materials baked to swatches, {flat_n} to flat factors")


# ── stills ───────────────────────────────────────────────────────────────────
if not has("no-render"):
    for i, cam in enumerate(cameras, 1):
        if ONLY_CAM and ONLY_CAM not in (str(i), cam.name):
            continue
        scene.camera = cam
        ratio = ASPECT.get(cam.get("bp_aspect", "16:9"), 16 / 9)
        scene.render.resolution_x = WIDTH
        scene.render.resolution_y = int(round(WIDTH / ratio))
        scene.render.filepath = os.path.join(OUT, f"view{i}.png")
        log(f"render    view{i}  {scene.render.resolution_x}x{scene.render.resolution_y}  {SAMPLES} samples  ({cam.name})")
        bpy.ops.render.render(write_still=True)
        log(f"          -> {scene.render.filepath}")

# ── GLB ──────────────────────────────────────────────────────────────────────
if not has("no-glb"):
    glb = os.path.splitext(blend_path)[0] + ".glb"
    flatten_for_gltf(bake=not has("glb-flat"))
    try:
        bpy.ops.export_scene.gltf(
            filepath=glb, export_format="GLB", use_renderable=True, export_apply=True,
            export_cameras=True, export_lights=True, export_yup=True,
        )
        log(f"exported  {glb}  ({os.path.getsize(glb) / 1e6:.1f} MB)")
    except Exception as exc:                                   # noqa: BLE001
        log(f"! glb export failed: {exc}")

log("done")
