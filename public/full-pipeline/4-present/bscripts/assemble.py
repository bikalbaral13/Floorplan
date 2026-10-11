"""S4 / S9 (Blender, empty file): join clips in the given order into one MP4 with the Video Sequencer (no ffmpeg needed).

job: {"clips": [paths in order], "out": "<file>.mp4", "audio": "<optional voiceover/music file>"}
Resolution and fps follow the first clip; clips with another size are scaled to fit.
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from _job import main

def run(j):
    s = bpy.context.scene; s.sequence_editor_create(); ed = s.sequence_editor
    strips = ed.strips if hasattr(ed, "strips") else ed.sequences
    f = 1; parts = []
    for i, p in enumerate(j["clips"]):
        st = strips.new_movie(f"c{i}_{os.path.basename(p)}"[:60], p, 1, f)
        if i == 0:
            e = st.elements[0]; s.render.resolution_x, s.render.resolution_y = e.orig_width, e.orig_height
            s.render.fps = round(st.fps); s.render.fps_base = 1
        parts.append({"clip": p, "start": f, "frames": st.frame_final_duration}); f = st.frame_final_end
    if j.get("audio"): strips.new_sound("audio", j["audio"], 2, 1)
    s.frame_start, s.frame_end = 1, f - 1; s.render.resolution_percentage = 100
    s.render.image_settings.file_format = "FFMPEG"; s.render.ffmpeg.format = "MPEG4"; s.render.ffmpeg.codec = "H264"
    s.render.ffmpeg.constant_rate_factor = "PERC_LOSSLESS"; s.render.ffmpeg.audio_codec = "AAC" if j.get("audio") else "NONE"
    s.render.filepath = j["out"]; s.render.use_file_extension = False
    bpy.ops.render.render(animation=True)
    return {"out": j["out"], "frames": f - 1, "fps": s.render.fps, "seconds": round((f - 1) / s.render.fps, 2),
            "res": [s.render.resolution_x, s.render.resolution_y], "parts": parts}

main(run)
