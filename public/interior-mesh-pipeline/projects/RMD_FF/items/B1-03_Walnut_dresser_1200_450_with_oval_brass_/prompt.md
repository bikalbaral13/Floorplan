# B1-03 — Walnut dresser 1200×450 with oval brass mirror

**Project:** RMD_FF · **Space:** Bedroom-1 · **Family:** DRESSER · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `DRESSER` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/DRESSER/family.json` (recipe + parameter schema) and `families/DRESSER/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `DRESSER` is `spec`, implement `families/DRESSER/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-B1-03`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 1, names `SM_FF_B1_03_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 1200 × 450 × 800 mm · front faces E (rot_z 90°)
- #01 X 6835 · Y 1900 · Z FFL+0 · rot 90°

