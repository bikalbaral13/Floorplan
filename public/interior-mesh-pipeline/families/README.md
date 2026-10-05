# families

One folder per parametric mesh family: `family.json` (schema + recipe + test_values), `build.py` (generator), `CHANGELOG.md`.
`REGISTRY.json` lists every family with `status` (spec → implemented → tested), `version`, `host` and the `projects` that use it.

Contract: `build(p, name, coll) -> root` at the origin, Z up, front −Y, pivot per `family.json`. Geometry only. See AGENTS.md §4 for versioning and how to add or change a family.

Reference implementations (copy their style): TABLE_ROUND, TABLE_DRUM, POUF_ROUND, STOOL, RUG, ART_FRAME.
All other families start as `spec`: the recipe in family.json is the build brief.
