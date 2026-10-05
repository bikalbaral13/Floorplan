# VO-04 — Low-iron glass balustrade with bronze handrail and clamps

**Project:** RMD_FF · **Space:** Void over GF lounge · **Family:** BALUSTRADE_GLASS · **Host:** floor

## Goal
Generate the mesh for this item (geometry only, no materials) with the `BALUSTRADE_GLASS` family, place every instance and report.

## Inputs
- `item.json` (this folder): size, parameters, placements, facing, notes.
- `families/BALUSTRADE_GLASS/family.json` (recipe + parameter schema) and `families/BALUSTRADE_GLASS/build.py` (generator).
- Core library: `core/` (geom, finish, place, checks, report). Read `AGENTS.md` first.

## Steps
1. Check `families/REGISTRY.json`: if `BALUSTRADE_GLASS` is `spec`, implement `families/BALUSTRADE_GLASS/build.py` from the recipe (core.geom only), add `test_values`, bump the family version, update its CHANGELOG and REGISTRY, run the family verify task.
2. In Blender run: `exec(compile(open(P).read(), P, "exec"), {"__file__": P, "__name__": "__main__"})` with `P` = full path of this folder's `build.py`.
3. Read `report.md`: status must be `ok`; fix non-manifold parts, triangle budget or overlaps in the FAMILY (not by hand), then rerun.
4. Update `TASKS.csv` (task `P2-ITEM-VO-04`) and append a line to the project `REPORT.md` (done automatically by the task runner).

## Acceptance
Closed manifold solids (open edges allowed only for cards / curtains / sheets: `open_mesh_ok`), modifiers baked, scale 1, UVs present, triangles ≤ 60000, instances = 1, names `SM_FF_VO_04_NN`, no unexplained overlaps.

## Size & placement (from item.json)
L × W × H = 3718 × 40 × 1100 mm · front faces E (rot_z 90°)
- #01 X 9290 · Y 6418 · Z FFL+0 · rot 90°

