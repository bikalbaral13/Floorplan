"""Self-test only (Blender): a tiny scene — ground, a box building with glass, one lamp post — saved to job['out']."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from _job import main

def run(j):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    def box(name, size, loc, mat):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.object; o.name = name; o.scale = size
        m = bpy.data.materials.get(mat) or bpy.data.materials.new(mat); o.data.materials.append(m); return o
    box("Ground", (60, 60, 0.1), (0, 0, -0.05), "M_Ground"); box("House_Walls", (10, 8, 6), (0, 0, 3), "M_Walls")
    box("House_Glass", (4, 0.1, 2), (0, -4.05, 3), "M_Glass"); box("LIGHT_001", (0.15, 0.15, 5), (6, -6, 2.5), "M_Pole")
    bpy.ops.wm.save_as_mainfile(filepath=j["out"])
    return {"out": j["out"]}

main(run)
