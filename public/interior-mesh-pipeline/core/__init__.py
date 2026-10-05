"""core — shared library for the interior mesh pipeline (geometry only).

Modules
    paths    root / project / family / item locations
    params   family schemas: load, merge defaults with item values, validate
    geom     bmesh builders: boxes, rounded boxes, cylinders, revolves, sweeps, grids
    finish   mesh quality: normals, merge, UVs (real-world box), sharp edges, apply
    place    plan → world, facing rotation, collections, instancing, naming
    checks   manifold, triangle count, bounds, overlaps, host snapping
    tasks    project task sheet (TASKS.csv): read, next runnable task, status updates
    report   item report (report.md + report.json) and project log

Pure-Python modules (paths, params, tasks, report) import without Blender;
geom / finish / place / checks need bpy.
"""
import os as _os
__version__ = open(_os.path.join(_os.path.dirname(__file__), "VERSION")).read().strip()
