"""S7 GLB: the final <CODE>.blend (after deck_pass) -> <CODE>.glb. Runs INSIDE Blender; never saves the .blend.

    blender -b <CODE>.blend --python tools/export_glb.py -- <renderer_dir>/render_plan.py <out.glb>

glTF cannot carry a procedural material (it arrives WHITE), so every procedural is baked to a 1 m swatch
by the Floorplan Renderer's own `flatten_for_gltf()` — read from render_plan.py's source and executed here,
not copied, so there is one version of it. Text objects (the logo) are converted to meshes first: the glTF
exporter writes meshes, not curves. Helper rows (camera bodies, cones) are hide_render and stay out.
"""
import os, sys
import bpy

argv = sys.argv[sys.argv.index("--") + 1:]
RENDER_PLAN, OUT = argv[0], os.path.abspath(argv[1])
scene = bpy.context.scene


def log(msg):
    print(f"[glb] {msg}", flush=True)


src = open(RENDER_PLAN, encoding="utf-8").read()
start = src.index("def flatten_for_gltf(")
end = src.index("\n# ──", start)
exec(src[start:end], globals())  # defines flatten_for_gltf(size, span, bake) using bpy / scene / log

texts = [o for o in bpy.data.objects if o.type == "FONT" and not o.hide_render]
for o in texts:
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
log(f"converted {len(texts)} text object(s) to mesh")

flatten_for_gltf(bake=True)
bpy.ops.object.select_all(action="DESELECT")
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_renderable=True, export_apply=True,
                          export_cameras=True, export_lights=True, export_yup=True)
log(f"exported {OUT} ({os.path.getsize(OUT) / 1e6:.1f} MB)")
