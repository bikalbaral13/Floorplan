# LB-01 — Teak lounge chairs ×2 with Sunbrella cushions

**Project:** RMD_FF · **Space:** Large balcony · **Family:** OUTDOOR_LOUNGE_CHAIR · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `OUTDOOR_LOUNGE_CHAIR` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/OUTDOOR_LOUNGE_CHAIR/family.json` (recipe + parameter schema) and `families/OUTDOOR_LOUNGE_CHAIR/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `OUTDOOR_LOUNGE_CHAIR` is `spec`, implement `families/OUTDOOR_LOUNGE_CHAIR/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-LB-01`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 2, names `SM_FF_LB_01_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 800 × 800 × 750 mm · front faces E (rot_z 90°)
- #01 X 1300 · Y 9900 · Z FFL+0 · rot 90°
- #02 X 2900 · Y 9900 · Z FFL+0 · rot 90°

