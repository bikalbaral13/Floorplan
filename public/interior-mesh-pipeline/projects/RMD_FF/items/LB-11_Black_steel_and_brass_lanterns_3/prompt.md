# LB-11 — Black-steel and brass lanterns ×3

**Project:** RMD_FF · **Space:** Large balcony · **Family:** LANTERN · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `LANTERN` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/LANTERN/family.json` (recipe + parameter schema) and `families/LANTERN/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `LANTERN` is `spec`, implement `families/LANTERN/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-LB-11`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 15000, instances = 3, names `SM_FF_LB_11_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 220 × 220 × 450 mm · front faces — (rot_z 0°)
- #01 X 3300 · Y 11500 · Z FFL+0 · rot 0°
- #02 X 3300 · Y 11250 · Z FFL+0 · rot 0°
- #03 X 3300 · Y 11000 · Z FFL+0 · rot 0°

