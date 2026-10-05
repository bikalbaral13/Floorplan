# UL-27 — Velvet cushions in charcoal and pale grey

**Project:** RMD_FF · **Space:** Upper lounge · **Family:** SOFT_SET · **Host:** host

## Goal
Generate the mesh for this item (geometry only, no materials) with the `SOFT_SET` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/SOFT_SET/family.json` (recipe + parameter schema) and `families/SOFT_SET/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `SOFT_SET` is `spec`, implement `families/SOFT_SET/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-UL-27`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 15000, instances = 1, names `SM_FF_UL_27_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 250 × 250 × 150 mm · front faces — (rot_z 0°)
- #01 X 5400 · Y 6200 · Z host surface · rot 0°

