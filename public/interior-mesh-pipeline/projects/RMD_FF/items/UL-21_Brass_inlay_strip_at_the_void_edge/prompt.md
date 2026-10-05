# UL-21 — Brass inlay strip at the void edge

**Project:** RMD_FF · **Space:** Upper lounge · **Family:** INLAY_STRIP · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `INLAY_STRIP` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/INLAY_STRIP/family.json` (recipe + parameter schema) and `families/INLAY_STRIP/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `INLAY_STRIP` is `spec`, implement `families/INLAY_STRIP/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-UL-21`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 1, names `SM_FF_UL_21_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 3718 × 32 × 5 mm · front faces W (rot_z 270°)
- #01 X 9246 · Y 6418 · Z FFL+0 · rot 270°

