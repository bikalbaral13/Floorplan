"""core — shared library for the exterior mesh pipeline (geometry only, metres).

Pure Python (import anywhere)
    paths    root / project / family / item locations
    params   family schemas: load, merge defaults with item values, validate
    tasks    project task sheet (TASKS.csv): read, next runnable task, status updates
    report   item report (report.md + report.json) and project log
    plan2d   2-D helpers for the adapters (needs shapely; system Python only)

Need Blender (bpy / bmesh)
    geom     MeshBuilder: boxes, oriented boxes, prisms with holes, profile sweeps, tubes, spheres
    uv       UV0 real-world (box / path-follow, built in) and UV1 lightmap (Smart UV Project + pack)
    finish   mesh quality: merge, normals, sharp edges, shading, no live modifiers
    place    collections, prototype collections, collection instances, transforms
    checks   triangles, manifold, UV1 overlaps, texel density, instance counts
"""
import os as _os
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION")).read().strip()
