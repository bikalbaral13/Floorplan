# MB-23 — Floor lamp

**Project:** RMD_FF · **Space:** Master bedroom · **Family:** LIGHT_FLOOR_LAMP · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `LIGHT_FLOOR_LAMP` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/LIGHT_FLOOR_LAMP/family.json` (recipe + parameter schema) and `families/LIGHT_FLOOR_LAMP/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `LIGHT_FLOOR_LAMP` is `spec`, implement `families/LIGHT_FLOOR_LAMP/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-MB-23`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 15000, instances = 1, names `SM_FF_MB_23_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 300 × 300 × 1500 mm · front faces — (rot_z 0°)
- #01 X 2650 · Y 7750 · Z FFL+0 · rot 0°

