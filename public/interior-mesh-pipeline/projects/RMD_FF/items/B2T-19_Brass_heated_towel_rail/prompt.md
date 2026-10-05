# B2T-19 — Brass heated towel rail

**Project:** RMD_FF · **Space:** Bedroom-2 toilet · **Family:** ACCESSORY · **Host:** host

## Goal
Generate the mesh for this item (geometry only, no materials) with the `ACCESSORY` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/ACCESSORY/family.json` (recipe + parameter schema) and `families/ACCESSORY/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `ACCESSORY` is `spec`, implement `families/ACCESSORY/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-B2T-19`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 15000, instances = 1, names `SM_FF_B2T_19_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 600 × 40 × 900 mm · front faces N (rot_z 180°)
- #01 X 6200 · Y 10271 · Z host surface · rot 180°

