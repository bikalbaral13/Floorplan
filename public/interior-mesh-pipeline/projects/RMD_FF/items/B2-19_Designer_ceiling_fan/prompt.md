# B2-19 — Designer ceiling fan

**Project:** RMD_FF · **Space:** Bedroom-2 (+ vestibule) · **Family:** CEILING_FAN · **Host:** ceiling

## Goal
Generate the mesh for this item (geometry only, no materials) with the `CEILING_FAN` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/CEILING_FAN/family.json` (recipe + parameter schema) and `families/CEILING_FAN/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `CEILING_FAN` is `spec`, implement `families/CEILING_FAN/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-B2-19`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 15000, instances = 1, names `SM_FF_B2_19_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 1100 × 1100 × 400 mm · front faces — (rot_z 0°)
- #01 X 9410 · Y 10300 · Z FFL+2750 · rot 0°

