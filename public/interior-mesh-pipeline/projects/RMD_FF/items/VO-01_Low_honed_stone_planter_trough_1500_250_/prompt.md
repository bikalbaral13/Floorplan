# VO-01 — Low honed-stone planter trough 1500×250 at the balustrade corner

**Project:** RMD_FF · **Space:** Void over GF lounge · **Family:** PLANTER_TROUGH · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `PLANTER_TROUGH` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/PLANTER_TROUGH/family.json` (recipe + parameter schema) and `families/PLANTER_TROUGH/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `PLANTER_TROUGH` is `spec`, implement `families/PLANTER_TROUGH/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-VO-01`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 1, names `SM_FF_VO_01_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 1500 × 250 × 400 mm · front faces — (rot_z 0°)
- #01 X 9162 · Y 7050 · Z FFL+0 · rot 90°

**Fit note:** on the lounge side of the balustrade (the void has no floor)
