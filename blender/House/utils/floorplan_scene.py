"""
floorplan_scene.py — the parts of a baked canvas plan that are NOT geometry: the lamps, the cameras
and the scene itself.

WHY THIS IS SEPARATE FROM floorplan_json.py. A plan carries three kinds of thing and only one of
them is a mesh. Before this, the importer built the meshes and dropped the rest on the floor: a room
arrived with its fittings modelled and nothing emitting, its cameras drawn as little grey bodies and
no camera in the scene, and whatever view transform the .blend happened to open with.

READ METRICS, NOT PARAMS. Every parametric object publishes `baked.metrics` — a list of
`{name, value}` where the names are the object's own Output Metrics labels. A param is an INPUT whose
name belongs to the object's author and gets renamed; a metric is a published, labelled number. The
render script that this logic comes from used to read `coneAngle`, `ceilingHeight` and `tilt` off the
params, all three of which were later renamed in the object library, and every one then silently fell
back to a default — a 40 degree cone on every spot, a 2.7 m ceiling on every downlight and a gimbal
permanently at zero, with nothing in the log to say so. A metric label cannot fail that way.

FRAME. Blender is x east, y north, z up; the plan is x east, y SOUTH (down the page). So a plan
anchor (ax, ay) is at Blender (ax, -ay) — the same convention floorplan_json.py builds its meshes in.
"""

import math

import bpy
from mathutils import Vector

LM_PER_W_DEFAULT = 184.0   # 683 lm/W at peak x ~0.27 for a broadband white source


# ─────────────────────────────────────────────────────────────────────────────
# reading a baked attachment
# ─────────────────────────────────────────────────────────────────────────────

def metrics(att: dict) -> dict:
    """An attachment's Output Metrics, by label."""
    return {str(m.get("name")): m.get("value") for m in ((att.get("baked") or {}).get("metrics") or [])}


def M(att: dict, label: str, default=0.0) -> float:
    try:
        return float(metrics(att).get(label))
    except (TypeError, ValueError):
        return float(default)


def P(att: dict, *names, default=0.0):
    """A param, by any of several names. Only for what has no metric — and the fallback list exists so
    a rename in the object library degrades to the OLD name rather than to a silent default."""
    params = att.get("params") or {}
    for n in names:
        v = params.get(n)
        if v not in (None, ""):
            try:
                return float(v)
            except (TypeError, ValueError):
                return v
    return default


def stem_of(att: dict) -> str:
    return str(att.get("objectPath") or "").split("/")[-1].replace(".json", "").lower()


def find_look(hosts) -> tuple:
    """The plan's `render-look`, if it carries one: (metrics, params). It is a canvas-hosted object
    with no 3D geometry at all — a scene is not a thing in the scene — so it is found by name rather
    than by having produced a mesh."""
    for _kind, host in hosts:
        for att in host.get("attachments") or []:
            if str(att.get("objectPath") or "").endswith("render-look.json"):
                return metrics(att), (att.get("params") or {})
    return {}, {}


def looker(look: dict):
    """`L(label, default)` — a value out of the look, or the default."""
    def L(label, default):
        try:
            return float(look[label])
        except (KeyError, TypeError, ValueError):
            return default
    return L


# ─────────────────────────────────────────────────────────────────────────────
# lamps
# ─────────────────────────────────────────────────────────────────────────────

# Every fitting in the library publishes the same four metrics — `Dimmed output (lm)`,
# `Blender watts (W)`, `Lamp radius (m)`, `Emits light` — so one table serves all of them and a new
# fitting needs a row here, not a branch.
LAMP_KIND = {
    "downlight": "SPOT", "track-head": "SPOT", "wall-washer": "SPOT",
    "pendant": "POINT", "light-bulb": "POINT", "chandelier": "POINT", "floor-lamp": "POINT",
    "ceiling-fan": "POINT", "outdoor-light": "POINT",
    "led-strip": "AREA", "cove-light": "AREA", "linear-profile": "AREA", "light-panel": "AREA",
    "mirror": "AREA", "false-ceiling": "AREA", "daylight-portal": "AREA",
}
AREA_RUN = {"led-strip", "cove-light", "linear-profile", "wall-washer"}
_TYPE_TO_KIND = {"Point": "POINT", "Spot": "SPOT", "Area": "AREA", "Linear": "AREA",
                 "Directional": "SUN", "Sun": "SUN"}


def bearing_dir(rotation_deg, horizon_deg):
    """Plan bearing -> a unit vector. `rotation + 90` measured atan2(x, -y) is the convention the
    objects' own view cones are drawn with; the second angle is signed FROM THE HORIZON, negative
    pointing down — so a downlight is -90, not 0."""
    b = math.radians(float(rotation_deg or 0) + 90.0)
    t = math.radians(float(horizon_deg or 0))
    return Vector((math.sin(b) * math.cos(t), math.cos(b) * math.cos(t), math.sin(t)))


def aim(obj, direction: Vector):
    obj.rotation_euler = direction.normalized().to_track_quat("-Z", "Y").to_euler()


def _add_light(name, kind, location, energy, kelvin, collection, **kw):
    from . import bp_material as bpm
    data = bpy.data.lights.new(name, type=kind)
    data.energy = energy
    try:
        data.color = bpm.kelvin_rgb(kelvin)
    except Exception:                                    # an older bp_material without it
        pass
    for k, v in kw.items():
        if hasattr(data, k):
            try:
                setattr(data, k, v)
            except (TypeError, ValueError):
                pass
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    collection.objects.link(obj)
    return obj


def build_lights(hosts, collection, look: dict, look_params: dict, lm_per_w=LM_PER_W_DEFAULT,
                 fan_lumens=1400.0, log=print) -> dict:
    """One Blender lamp per emitting fitting. Returns a count per type."""
    L = looker(look)
    counts = {"sun": 0, "spot": 0, "point": 0, "area": 0}
    groups = {}
    sun_dir = None

    for _kind, host in hosts:
        for att in host.get("attachments") or []:
            stem = stem_of(att)
            baked = att.get("baked") or {}
            if not baked.get("anchor"):
                continue
            if stem not in LAMP_KIND and stem != "light":
                continue

            # `Emits light` is the double-count guard: a lit diffuser is not a light, and a fitting
            # whose geometry glows but whose lamp is off is exactly what `emitsLight = false` asks.
            if M(att, "Emits light", 1.0) < 0.5:
                continue

            ax, ay = float(baked["anchor"][0]), -float(baked["anchor"][1])
            label = (host.get("label") or host.get("id") or "")

            lm = M(att, "Output after gain (lm)", 0) or M(att, "Dimmed output (lm)", 0) or P(att, "lumens", default=0)
            if stem == "ceiling-fan" and not lm:
                lm = fan_lumens
            if not lm or lm <= 0:
                continue
            kelvin = (M(att, "Colour temperature dimmed (K)", 0) or M(att, "Colour temperature (K)", 0)
                      or P(att, "kelvin", default=3000))
            radius = M(att, "Lamp radius (m)", 0) or 0.03
            group = str((att.get("params") or {}).get("lightGroup") or stem)

            kind = LAMP_KIND.get(stem, "SPOT")
            if stem == "light":
                kind = _TYPE_TO_KIND.get(str(P(att, "type", default="Spot")), "SPOT")

            z = (M(att, "Mount elevation (m)", 0) or M(att, "Face elevation (m)", 0)
                 or M(att, "Cove top (m)", 0) or M(att, "Bottom elevation (m)", 0)
                 or P(att, "mountHeight", "ceilingHeight", default=2.7))
            nadir = M(att, "Aim from straight down (°)", 0) or P(att, "aimTilt", "tilt", default=0)
            cone = M(att, "Beam angle (°)", 0) or P(att, "beamAngle", "coneAngle", default=36)
            blend = M(att, "Beam blend", 0.3) or 0.3
            direction = bearing_dir(P(att, "rotation", default=0), nadir - 90.0)

            if kind == "SUN":
                # A SUN takes IRRADIANCE, not flux. The look's illuminance and solar position beat a
                # proxy object's lumens-over-area every time: it is a number anyone can check against
                # a light meter, and it cannot disagree with the date on the sheet.
                lux = float(look_params.get("sunIlluminance") or 0)
                if lux > 0:
                    energy = lux / lm_per_w
                    alt = math.radians(L("Sun altitude used (°)", 45.0))
                    az = math.radians(L("Sun azimuth used (°)", 225.0))
                    direction = Vector((-math.sin(az) * math.cos(alt), -math.cos(az) * math.cos(alt), -math.sin(alt)))
                    log(f"    sun {math.degrees(alt):.1f}° altitude, {math.degrees(az):.1f}° azimuth, {lux:.0f} lx")
                else:
                    area = max(P(att, "sizeLength", default=1.5) * P(att, "sizeWidth", default=2.1), 0.2)
                    energy = (lm / area) / lm_per_w
                obj = _add_light("Sun · daylight", "SUN",
                                 (ax - direction.x * 20, ay - direction.y * 20, z - direction.z * 20),
                                 energy, kelvin, collection,
                                 angle=math.radians(L("Sun disc size (°)", 0.526)))
                aim(obj, direction)
                sun_dir = direction
                counts["sun"] += 1
            elif kind == "AREA":
                run = M(att, "Run length (m)", 0) or M(att, "Halo run (m)", 0) or M(att, "Cove LED run (m)", 0)
                sx = (run or M(att, "Aperture length (m)", 0) or M(att, "Opening width (m)", 0)
                      or P(att, "sizeLength", default=0.6))
                sy = (M(att, "Aperture width (m)", 0) or M(att, "Opening height (m)", 0)
                      or (0.05 if stem in AREA_RUN else P(att, "sizeWidth", default=0.3)))
                up = (str((att.get("params") or {}).get("direction") or "") == "Up"
                      or stem in ("cove-light", "false-ceiling"))
                obj = _add_light(f"Area · {stem} · {label}", "AREA", (ax, ay, z), lm / lm_per_w, kelvin,
                                 collection, shape="RECTANGLE", size=max(0.02, sx), size_y=max(0.02, sy))
                aim(obj, Vector((0, 0, 1)) if up else (direction if nadir else Vector((0, 0, -1))))
                counts["area"] += 1
            elif kind == "POINT":
                _add_light(f"Point · {stem} · {label}", "POINT", (ax, ay, z), lm / lm_per_w, kelvin,
                           collection, shadow_soft_size=radius)
                counts["point"] += 1
            else:
                obj = _add_light(f"Spot · {stem} · {label}", "SPOT", (ax, ay, z), lm / lm_per_w, kelvin,
                                 collection, spot_size=math.radians(max(5.0, cone)), spot_blend=blend,
                                 shadow_soft_size=radius)
                aim(obj, direction)
                gobo = str((att.get("params") or {}).get("goboPath") or "")
                if gobo:
                    obj.data["bp_gobo"] = gobo
                counts["spot"] += 1
            groups[group] = groups.get(group, 0) + 1

    counts["groups"] = groups
    counts["sun_dir"] = sun_dir
    return counts


# ─────────────────────────────────────────────────────────────────────────────
# cameras
# ─────────────────────────────────────────────────────────────────────────────

def build_cameras(hosts, collection, scene, log=print) -> list:
    """One Blender camera per `camera` object, in shot order, with the shot's own optics."""
    cams = []
    for _kind, host in hosts:
        for att in host.get("attachments") or []:
            if stem_of(att) != "camera":
                continue
            baked = att.get("baked") or {}
            if not baked.get("anchor"):
                continue
            if M(att, "In the render set", 1.0) < 0.5:
                continue
            p = att.get("params") or {}
            ax, ay = float(baked["anchor"][0]), -float(baked["anchor"][1])
            view = str(p.get("view") or "Perspective")
            # A Two-point perspective is an ordinary perspective with the tilt forced to zero, which
            # is what holds the verticals — and the object itself already zeroes it.
            tilt = 0.0 if view == "Two-point" else float(p.get("tilt") or 0)

            data = bpy.data.cameras.new(f"Cam {len(cams) + 1}")
            data.lens = float(p.get("focalLength") or 24)
            data.sensor_width = float(p.get("sensorWidth") or 36)
            data.sensor_fit = "HORIZONTAL"
            data.clip_start = max(0.001, M(att, "Near clip (m)", 0.05))
            # LENS SHIFT is the architectural control. Two-point keeps the verticals straight by
            # cropping the ceiling off; a vertical shift is how a tilt-shift lens gets it back.
            data.shift_x = M(att, "Lens shift X", 0.0)
            data.shift_y = M(att, "Lens shift Y", 0.0)
            fstop = M(att, "Aperture (f/)", 0)
            if fstop and M(att, "Depth of field", 0) >= 0.5:
                data.dof.use_dof = True
                data.dof.aperture_fstop = fstop
                data.dof.focus_distance = M(att, "Focus distance (m)", 4.0) or 4.0
                blades = int(M(att, "Aperture blades", 0))
                if blades >= 3:
                    data.dof.aperture_blades = blades

            shot = str(p.get("shotName") or "")
            obj = bpy.data.objects.new(f"Cam {len(cams) + 1} · {shot or view}", data)
            obj.location = (ax, ay, float(p.get("eyeHeight") or 1.5))
            aim(obj, bearing_dir(p.get("rotation"), tilt))
            obj["bp_view"] = view
            obj["bp_shot"] = shot
            obj["bp_order"] = M(att, "Shot order", 99)
            obj["bp_exposure"] = M(att, "Exposure offset (EV)", 0.0)
            obj["bp_clearance"] = M(att, "Minimum clearance (m)", 0.0)
            obj["bp_res"] = [int(M(att, "Render width (px)", 0)), int(M(att, "Render height (px)", 0))]
            collection.objects.link(obj)
            cams.append(obj)

    cams.sort(key=lambda c: float(c.get("bp_order", 99)))
    if cams:
        scene.camera = cams[0]
        first = cams[0]
        res = first.get("bp_res") or [0, 0]
        if res[0] and res[1]:
            scene.render.resolution_x, scene.render.resolution_y = int(res[0]), int(res[1])
    return cams


# ─────────────────────────────────────────────────────────────────────────────
# the scene
# ─────────────────────────────────────────────────────────────────────────────

def apply_look(scene, look: dict, look_params: dict, sun_dir=None, log=print):
    """Engine, sampling, world and post, from the plan's own `render-look`."""
    L = looker(look)

    scene.render.engine = "CYCLES"
    try:
        scene.cycles.samples = int(L("Samples", 128))
        scene.cycles.use_denoising = L("Denoise", 1.0) >= 0.5
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = L("Adaptive threshold", 0.01)
        scene.cycles.max_bounces = int(L("Total bounces", 12))
        scene.cycles.diffuse_bounces = int(L("Diffuse bounces", 4))
        scene.cycles.glossy_bounces = int(L("Glossy bounces", 4))
        scene.cycles.transmission_bounces = int(L("Transmission bounces", 12))
        scene.cycles.caustics_reflective = L("Reflective caustics", 0.0) >= 0.5
        scene.cycles.caustics_refractive = L("Refractive caustics", 0.0) >= 0.5
        clamp = L("Clamp indirect", 0.0)
        if clamp:
            scene.cycles.sample_clamp_indirect = clamp
        ao = L("Ambient occlusion", 0.0)
        if ao:
            scene.cycles.use_fast_gi = True
            scene.cycles.ao_factor = ao
    except AttributeError:
        log("    ! Cycles properties unavailable — leaving the engine settings alone")

    # Colour management. The look enum is carried VERBATIM: Blender's is "AgX - Base Contrast",
    # there is no "AgX - Medium Contrast", and a near miss fails silently.
    scene.view_settings.view_transform = str(look_params.get("viewTransform") or "AgX")
    blender_look = str(look_params.get("blenderLook") or "")
    if blender_look:
        try:
            scene.view_settings.look = blender_look
        except (TypeError, ValueError):
            log(f'    ! look "{blender_look}" is not available in this Blender')
    try:
        scene.view_settings.exposure = float(look_params.get("exposureEV", 0.0))
    except (TypeError, ValueError):
        pass

    _world(scene, look, look_params, sun_dir, log)
    _compositor(scene, look, log)


def _world(scene, look, look_params, sun_dir, log):
    L = looker(look)
    world = bpy.data.worlds.get("BP Sky") or bpy.data.worlds.new("BP Sky")
    world.use_nodes = True
    scene.world = world
    nt = world.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputWorld")
    out.location = (300, 0)
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.location = (100, 0)
    bg.inputs["Strength"].default_value = L("World strength", 1.0)
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])

    world_kind = str(look_params.get("worldType") or "Sky")
    if world_kind == "Flat":
        bg.inputs["Color"].default_value = (0.32, 0.38, 0.45, 1.0)
        log("    world flat")
        return

    sky = nt.nodes.new("ShaderNodeTexSky")
    sky.location = (-150, 0)
    try:
        sky.sky_type = "NISHITA"
        # THE SUN DISC. It is off when a SUN lamp is already doing the direct light, because two suns
        # is two suns — and ON when the plan asks for it and there is nothing to double. Hardcoding it
        # off is why no render out of this pipeline ever had a sunbeam with an edge in it.
        sky.sun_disc = bool(L("Sun disc", 0.0)) and sun_dir is None
        sky.sun_size = math.radians(max(0.05, L("Sun disc size (°)", 0.526)))
        sky.turbidity = max(1.0, L("Sky turbidity", 2.2))
        sky.ground_albedo = L("Ground albedo", 0.22)
        if sun_dir is not None:
            sky.sun_elevation = math.asin(max(-0.99, min(0.99, -sun_dir.z)))
            sky.sun_rotation = math.atan2(-sun_dir.x, -sun_dir.y)
        else:
            sky.sun_elevation = math.radians(L("Sun altitude used (°)", 35.0))
            sky.sun_rotation = math.radians(L("Sun azimuth used (°)", 135.0))
    except (AttributeError, TypeError, ValueError) as exc:
        log(f"    ! sky node incomplete ({exc})")
    nt.links.new(sky.outputs["Color"], bg.inputs["Color"])
    log(f"    world Nishita sky, disc {'on' if getattr(sky, 'sun_disc', False) else 'off'}, strength {bg.inputs['Strength'].default_value:.2f}")


def _compositor(scene, look, log):
    """Glare, white balance and a vignette.

    A source brighter than the display can show has to BLOOM into its surroundings or it flattens
    into a white shape — the blown cove in the earlier renders was a glare problem, not an exposure
    one. And a warm room graded with no white balance renders as orange juice, because the eye adapts
    to a warm interior and a camera does not."""
    from . import bp_material as bpm
    L = looker(look)
    thr, wb, vig = L("Glare threshold", 0.0), L("White balance (K)", 0.0), L("Vignette", 0.0)
    if not (thr or wb or vig):
        return
    scene.use_nodes = True
    nt = scene.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    rl = nt.nodes.new("CompositorNodeRLayers"); rl.location = (-600, 0)
    comp = nt.nodes.new("CompositorNodeComposite"); comp.location = (600, 0)
    src = rl.outputs["Image"]

    if thr:
        g = nt.nodes.new("CompositorNodeGlare"); g.location = (-380, 0)
        g.glare_type = "FOG_GLOW"
        g.quality = "MEDIUM"
        g.threshold = thr
        g.size = int(L("Glare size", 7))
        g.mix = -0.55
        nt.links.new(src, g.inputs["Image"]); src = g.outputs["Image"]
    if wb:
        r, gg, b = bpm.kelvin_rgb(wb)
        cb = nt.nodes.new("CompositorNodeColorBalance"); cb.location = (-160, 0)
        cb.correction_method = "OFFSET_POWER_SLOPE"
        cb.slope = (1.0 / max(0.05, r), 1.0 / max(0.05, gg), 1.0 / max(0.05, b))
        nt.links.new(src, cb.inputs["Image"]); src = cb.outputs["Image"]
    if vig:
        el = nt.nodes.new("CompositorNodeEllipseMask"); el.location = (-380, -280)
        el.width, el.height = 0.9, 0.9
        bl = nt.nodes.new("CompositorNodeBlur"); bl.location = (-160, -280)
        bl.size_x = bl.size_y = 220
        mix = nt.nodes.new("CompositorNodeMixRGB"); mix.location = (120, 0)
        mix.blend_type = "MULTIPLY"
        mix.inputs["Fac"].default_value = vig
        nt.links.new(el.outputs["Mask"], bl.inputs["Image"])
        nt.links.new(src, mix.inputs[1])
        nt.links.new(bl.outputs["Image"], mix.inputs[2])
        src = mix.outputs["Image"]
    nt.links.new(src, comp.inputs["Image"])
    log(f"    post glare {thr or 'off'}, white balance {int(wb) if wb else 'off'} K, vignette {vig or 'off'}")
