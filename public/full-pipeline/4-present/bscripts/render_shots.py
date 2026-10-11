"""S4 (Blender): render every shot of a built walkthrough .blend as its own clip + first/last keyframes.

job: {"blend", "out_dir", "preset": {engine, res, fps, aa, samples}, "shots": <walkthrough-shots/1>, "std": <standards>}
writes out_dir/shots/<ID>.mp4 and out_dir/keyframes/<ID>_first.png / _last.png.
WORKBENCH presets show material colours flat (fast, works headless without a GPU); CYCLES/EEVEE use the real light rig.
"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from _job import main

def frames(shot, fps):
    f0 = int(round(shot["start"] * fps)) + 1
    return f0, f0 + int(round(shot["duration"] * fps)) - 1

def run(j):
    s = bpy.context.scene; P = j["preset"]; std = j["std"]; doc = j["shots"]; fps = doc.get("fps", std["fps"])
    eng = P["engine"].upper()
    if eng == "WORKBENCH":
        for m in bpy.data.materials:
            b = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None) if m.use_nodes and m.node_tree else None
            if b: m.diffuse_color = (*b.inputs["Base Color"].default_value[:3], 1); m.roughness = b.inputs["Roughness"].default_value
        s.render.engine = "BLENDER_WORKBENCH"; sh = s.display.shading
        sh.light = "STUDIO"; sh.color_type = "MATERIAL"; sh.show_shadows = True; sh.shadow_intensity = 0.55
        sh.show_cavity = P.get("aa", "OFF") != "OFF"; sh.background_type = "WORLD"; s.display.render_aa = P.get("aa", "OFF")
        s.display.light_direction = (0.45, -0.35, 0.82)
    elif eng == "CYCLES":
        s.render.engine = "CYCLES"; s.cycles.samples = P.get("samples", 64); s.cycles.use_denoising = True; s.render.use_persistent_data = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            for t in ("OPTIX", "CUDA", "HIP", "METAL", "ONEAPI"):
                try:
                    prefs.compute_device_type = t; prefs.get_devices()
                    if any(d.type == t for d in prefs.devices):
                        for d in prefs.devices: d.use = True
                        s.cycles.device = "GPU"; break
                except Exception: pass
        except Exception: pass
    else:
        s.render.engine = "BLENDER_EEVEE_NEXT"; s.eevee.taa_render_samples = P.get("samples", 16)
    s.view_settings.view_transform = "AgX"; s.view_settings.look = "AgX - Base Contrast"
    s.render.resolution_x, s.render.resolution_y = P["res"]; s.render.resolution_percentage = 100
    step = max(1, round(fps / P.get("fps", fps))); s.frame_step = step; s.render.fps = round(fps / step)
    os.makedirs(os.path.join(j["out_dir"], "shots"), exist_ok=True); os.makedirs(os.path.join(j["out_dir"], "keyframes"), exist_ok=True)
    cams = {m.name[3:]: m.camera for m in s.timeline_markers if m.name.startswith("WT_")}
    done = []
    for shot in doc["shots"]:
        f0, f1 = frames(shot, fps); s.camera = cams[shot["id"]]
        if eng == "WORKBENCH" and s.world: s.world.color = std["workbench_world"].get(shot["light"], (0.5, 0.6, 0.8))
        s.view_settings.exposure = -2.2 if (eng == "WORKBENCH" and shot["light"] == "night") else 0
        s.render.image_settings.file_format = "PNG"
        for tag, f in (("first", f0), ("last", f1)):
            s.frame_set(f); s.render.filepath = os.path.join(j["out_dir"], "keyframes", f"{shot['id']}_{tag}.png"); bpy.ops.render.render(write_still=True)
        s.render.image_settings.file_format = "FFMPEG"; s.render.ffmpeg.format = "MPEG4"; s.render.ffmpeg.codec = "H264"
        s.render.ffmpeg.constant_rate_factor = "HIGH"; s.render.ffmpeg.audio_codec = "NONE"
        s.frame_start, s.frame_end = f0, f1
        s.render.filepath = os.path.join(j["out_dir"], "shots", f"{shot['id']}.mp4"); s.render.use_file_extension = False
        t = time.time(); bpy.ops.render.render(animation=True)
        done.append({"id": shot["id"], "clip": s.render.filepath, "seconds": round(time.time() - t, 1)})
    return {"shots": done, "res": P["res"], "fps": s.render.fps, "engine": eng}

main(run)
