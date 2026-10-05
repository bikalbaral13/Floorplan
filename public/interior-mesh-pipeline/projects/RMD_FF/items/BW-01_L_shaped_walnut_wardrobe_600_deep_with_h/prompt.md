# BW-01 — L-shaped walnut wardrobe (600 deep) with hanging, drawers and shoe shelves

**Project:** RMD_FF · **Space:** Bedroom-1 walk-in wardrobe · **Family:** WARDROBE · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `WARDROBE` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/WARDROBE/family.json` (recipe + parameter schema) and `families/WARDROBE/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `WARDROBE` is `spec`, implement `families/WARDROBE/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-BW-01`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 2, names `SM_FF_BW_01_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 2035 × 600 × 2700 mm · front faces — (rot_z 0°)
- #01 X 11942 · Y 4000 · Z FFL+0 · rot 0°
- #02 X 12660 · Y 3190 · Z FFL+0 · rot 90°

