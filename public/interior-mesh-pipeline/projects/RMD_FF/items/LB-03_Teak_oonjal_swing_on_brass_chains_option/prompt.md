# LB-03 — Teak oonjal (swing) on brass chains (optional)

**Project:** RMD_FF · **Space:** Large balcony · **Family:** SWING_OONJAL · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `SWING_OONJAL` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/SWING_OONJAL/family.json` (recipe + parameter schema) and `families/SWING_OONJAL/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `SWING_OONJAL` is `spec`, implement `families/SWING_OONJAL/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-LB-03`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 1, names `SM_FF_LB_03_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 2000 × 1200 × 2400 mm · front faces — (rot_z 0°)
- #01 X 2000 · Y 11500 · Z FFL+0 · rot 0°

**Fit note:** A-frame footprint 2000×1200
