# typologies

One folder per building typology: a parametric program generator the stages call through the pin of a project or parcel.

| File | Purpose |
|---|---|
| `typology.json` | id, version, `extends` (optional), frame, `road_sides_supported`, `applicability`, `objects` (pinned object versions + parameter mapping), `parameters` (own, or `"from_object": "slot.param"`), `site_params`, `rule_params` (clamps), `options`, `rule_defaults`, `brief_defaults`, `stages` (plan; `+ID` = own stage), `stage_versions`, `migrations` |
| `generator.py` | `generate(p, T)`, `render_svg(res, title, T)`, `to_plan_trace(res, project, T)`, `qc(res, rules, brief, T)`, `migrate(params, from_version)` — `T` is optional in signatures |
| `stages/<ID>/` | typology-owned stages (same contract as `stages/`) |
| `planner/` | optional app sharing the parameter file format |
| `versions/<x.y.z>/` | frozen older versions still pinned by projects |
| `README.md`, `CHANGELOG.md` | what it makes; semver history |

`extends`: a child typology (registered or a project variant) lists only what differs; `null` removes an inherited entry. Its generator gets the parent's as `base`; functions it does not define fall back to the parent. Lineage is recorded in every option / selection / hand-off.

`REGISTRY.json`: version, status (spec → implemented → tested), versions kept, planner, projects pinning it. Only `tested` typologies (or variants of them) run projects.

## Result contract (what shared stages read)
`generate()` returns at least `option`, `option_title`, `params`, `total` (built-up), `coverage_pct`, `warn`, `warn2`, and preferably
`schedule` (rows: code, name, level, kind, face, size, area_sqft), `headline`, `summary_lines`, `far`, `stair` (when the typology has a stair object).
Multi-level typologies add `levels` and put `level` on each plan_trace room / door. Older results that only have `units` are mapped by core/result.py.

| Typology | Version | Levels | Options | Own stages | Planner |
|---|---|---|---|---|---|
| TOWNHOME_RENTAL | 0.2.0 (0.1.0 frozen) | GF (+ future floors) | A–J | +P5b_STAIR_SCHEDULE | Town Home Rental Planner |
| VILLA_4BHK_G1 | 0.1.0 | GF, FF | A, B | +P5c_AREA_VASTU (uses shared P5b) | 4BHK Villa Planner |

A planner keeps its generator logic in one marked block so the self-test can hash it: if the hash differs from the parity fixture, re-export the fixture (and fix any mismatch) before release.
