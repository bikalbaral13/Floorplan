"""S3 (Blender): shots.json → a walkthrough .blend. Never overwrites the source .blend (saves to out_blend).

job: {"blend", "out_blend", "shots": <walkthrough-shots/1>, "std": <standards>, "materials": "keep" | "palette", "lamps": {...} | null}
adds: one camera + look-at target per shot (bound to a timeline marker at its first frame), sun + moon + sky world
keyed per shot light, point lamps at lamp-like objects, emissive / glowing-window keys, moving prop stand-ins.
"""
import os, sys, re, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector
from _job import main

def frames(shot, fps):
    f0 = int(round(shot["start"] * fps)) + 1
    return f0, f0 + int(round(shot["duration"] * fps)) - 1

def principled(m):
    m.use_nodes = True
    b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if b is None:
        m.node_tree.nodes.clear()
        b = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled"); o = m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(b.outputs[0], o.inputs[0])
    return b

def palette(std):
    P = std["palette"]
    for m in bpy.data.materials:
        n = m.name.lower(); c = next((v for k, v in P["rules"] if k in n), P["default"])
        b = principled(m)
        for l in list(b.inputs["Base Color"].links): m.node_tree.links.remove(l)
        b.inputs["Base Color"].default_value = (*c[:3], 1); b.inputs["Roughness"].default_value = c[3]
        if any(k in n for k in std["glass_keywords"]): b.inputs["Metallic"].default_value = 0.6

def key_const(owner, attr, pairs):
    for f, v in pairs:
        setattr(owner, attr, v); owner.keyframe_insert(attr, frame=f)

def const_interp(idblock):
    ad = getattr(idblock, "animation_data", None)
    if ad and ad.action:
        for fc in ad.action.fcurves:
            for k in fc.keyframe_points: k.interpolation = "CONSTANT"

def run(j):
    s = bpy.context.scene; std = j["std"]; doc = j["shots"]; fps = doc.get("fps", std["fps"])
    shots = doc["shots"]; L = std["lighting"]
    s.render.fps = fps; s.frame_start = 1; s.frame_end = frames(shots[-1], fps)[1]
    if j.get("materials") == "palette": palette(std)
    # per-shot light keys (constant between shots)
    spans = [(frames(sh, fps)[0], L[sh["light"]]) for sh in shots]
    w = s.world or bpy.data.worlds.new("WT_World"); s.world = w; w.use_nodes = True; nt = w.node_tree; nt.nodes.clear()
    sky = nt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"
    bg = nt.nodes.new("ShaderNodeBackground"); out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(sky.outputs[0], bg.inputs[0]); nt.links.new(bg.outputs[0], out.inputs[0])
    first = spans[0][1]; sky.sun_elevation = math.radians(first["sun_elevation_deg"]); sky.sun_rotation = math.radians(first["sun_heading_deg"])
    sun_d = bpy.data.lights.new("WT_SUN", "SUN"); sun_d.angle = math.radians(2)
    sun = bpy.data.objects.new("WT_SUN", sun_d); s.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(90 - first["sun_elevation_deg"]), 0, math.radians(first["sun_heading_deg"] - 180))
    moon_d = bpy.data.lights.new("WT_MOON", "SUN"); moon_d.color = (0.55, 0.65, 1.0)
    moon = bpy.data.objects.new("WT_MOON", moon_d); s.collection.objects.link(moon); moon.rotation_euler = (math.radians(40), 0, math.radians(200))
    lamp_d = bpy.data.lights.new("WT_LAMP", "POINT"); lamp_d.color = (1, 0.75, 0.45); lamp_d.shadow_soft_size = 0.3
    glow = []
    for m in bpy.data.materials:
        n = m.name.lower()
        if any(k in n for k in std["glass_keywords"] + std["emissive_keywords"]):
            b = principled(m); b.inputs["Emission Color"].default_value = (1, 0.78, 0.5, 1); glow.append((m, b, any(k in n for k in std["emissive_keywords"])))
    for f, lt in spans:
        key_const(sun_d, "energy", [(f, lt["sun_energy"])]); key_const(sun_d, "color", [(f, lt["sun_color"])])
        key_const(moon_d, "energy", [(f, lt.get("moon_energy", 0))]); key_const(lamp_d, "energy", [(f, lt["lamps_w"])])
        key_const(bg.inputs[1], "default_value", [(f, lt["world_strength"])])
        for m, b, emissive in glow:
            v = (8 if lt["lamps_w"] else 0) if emissive else lt["windows_glow"]
            key_const(b.inputs["Emission Strength"], "default_value", [(f, v)])
    for idb in [sun_d, moon_d, lamp_d, w.node_tree] + [m.node_tree for m, _, _ in glow]: const_interp(idb)
    # lamps
    lc = {**std["lamp_defaults"], **(j.get("lamps") or doc.get("lamps") or {})}; n_lamps = 0
    if lc.get("object_pattern"):
        pat = re.compile(lc["object_pattern"], re.I)
        for o in list(s.objects):
            if o.type in ("EMPTY", "MESH") and pat.search(o.name) and o.parent is None and o.visible_get():
                L_ = bpy.data.objects.new("WT_PL_" + o.name, lamp_d); s.collection.objects.link(L_)
                L_.location = o.matrix_world.translation + Vector((0, 0, lc["height_m"])); n_lamps += 1
    # props (moving stand-ins)
    props = {}
    for p in doc.get("props", []):
        root = bpy.data.objects.new(p["id"], None); s.collection.objects.link(root); props[p["id"]] = root
        if p.get("type") == "car":
            for nm, dim, loc in (("body", (1.9, 4.7, 0.75), (0, 0, 0.65)), ("cabin", (1.7, 2.6, 0.6), (0, -0.3, 1.3))):
                bpy.ops.mesh.primitive_cube_add(size=1, location=loc); b = bpy.context.object; b.name = f"{p['id']}_{nm}"; b.scale = dim; b.parent = root
                mat = bpy.data.materials.new(b.name); bb = principled(mat); bb.inputs["Base Color"].default_value = (0.02, 0.02, 0.025, 1)
                bb.inputs["Metallic"].default_value = 0.7; bb.inputs["Roughness"].default_value = 0.25; b.data.materials.append(mat)
        for t, x, y in p["keys"]:
            root.location = (x, y, 0); root.keyframe_insert("location", frame=int(round(t * fps)) + 1)
        if len(p["keys"]) >= 2:
            (t0, x0, y0), (t1, x1, y1) = p["keys"][0], p["keys"][1]
            root.rotation_euler = (0, 0, math.atan2(y1 - y0, x1 - x0) - math.pi / 2)
    # cameras
    for m in list(s.timeline_markers):
        if m.name.startswith("WT_"): s.timeline_markers.remove(m)
    made = []
    for sh in shots:
        f0, f1 = frames(sh, fps); name = f"{sh['id']}_{sh.get('name', '')}".strip("_").replace(" ", "")
        cd = bpy.data.cameras.new("CAM_" + name); cd.lens = sh["lens"]; cd.clip_end = 5000
        c = bpy.data.objects.new("CAM_" + name, cd); s.collection.objects.link(c)
        cam = sh["camera"]
        if cam["type"] == "path":
            ks = cam["keys"]
            for i, p in enumerate(ks):
                c.location = p; c.keyframe_insert("location", frame=f0 + (f1 - f0) * i / (len(ks) - 1))
        else:
            n = max(8, int(abs(cam["sweep_deg"]) / 12))
            for i in range(n + 1):
                a = math.radians(cam["start_deg"] + cam["sweep_deg"] * i / n); z = cam["z"][0] + (cam["z"][1] - cam["z"][0]) * i / n
                c.location = (cam["center"][0] + cam["radius"] * math.cos(a), cam["center"][1] + cam["radius"] * math.sin(a), z)
                c.keyframe_insert("location", frame=f0 + (f1 - f0) * i / n)
        tc = c.constraints.new("TRACK_TO"); tc.track_axis = "TRACK_NEGATIVE_Z"; tc.up_axis = "UP_Y"
        tg = sh["target"]
        if "object" in tg: tc.target = props.get(tg["object"]) or s.objects[tg["object"]]
        else:
            t = bpy.data.objects.new("TGT_" + name, None); s.collection.objects.link(t); tc.target = t
            ks = tg["keys"]
            for i, p in enumerate(ks):
                t.location = p; t.keyframe_insert("location", frame=f0 + (f1 - f0) * i / max(1, len(ks) - 1))
        mk = s.timeline_markers.new("WT_" + sh["id"], frame=f0); mk.camera = c
        made.append({"id": sh["id"], "camera": c.name, "frames": [f0, f1]})
    s.camera = bpy.data.objects[made[0]["camera"]]
    bpy.ops.wm.save_as_mainfile(filepath=j["out_blend"], copy=False)
    return {"out_blend": j["out_blend"], "shots": made, "lamps": n_lamps, "props": list(props), "frame_end": s.frame_end, "glow_materials": len(glow)}

main(run)
