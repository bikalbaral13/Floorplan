# program_pipeline — changelog

## 0.5.0 — 2026-10-11
- Shared plumbing: runs on pipeline_kit 0.2.0 (vendored, hash-checked). core/paths, tasks, report, units and the
  finding / result / version helpers in core/stage are now this pipeline's names over the kit — typologies, objects,
  stages and their results are unchanged (all 110 earlier checks pass). REPORT.md timestamps are ISO; a re-run now
  also resets failed / blocked downstream tasks (kit rule).
- Standards: standards/DEFAULT.json and AADITHYAA.json are byte copies of library/Standards 1.0.0 (one file per set
  for conventions + object preferences, shared with space-brief); loaded with pipeline_kit.standards. DEFAULT's object
  values equal the typology defaults, so results do not change.
- pipeline.json (pipeline/1): outputs.keep → Projects/<CODE>/program/ (plan_trace.json, PROGRAM.md, area statement,
  PARAMS.md, qc.md). tools/project_state.py: save / resume through the library, shared Projects/index.json.
- Hand-off to the design brief: space-brief-pipeline/tools/from_program.py turns output/plan_trace.json into the
  editor plan per floor (pipeline_kit.interop). Self-test 117 checks (+ kit copy, standards, contract, plan_trace.v1 schema, villa GF/FF
  plan → canvas with every door, save and restore).
- P6_HANDOFF 0.2.1: room keys without a value are left out (not null), so plan_trace.json validates against
  library/Schemas/plan_trace.v1 (the villa's porch / balcony carried ceiling_mm: null).

## 0.4.1 — 2026-10-06
- 4BHK Villa Planner (typologies/VILLA_4BHK_G1/planner/): JS twin of the villa generator at parity (48 cases incl. polygons, doors, warnings, QC fails), hash-checked against the fixture.
- Self-test checks the parameter contract of every typology with a planner. 110 checks.

## 0.4.0 — 2026-10-06
- New typology VILLA_4BHK_G1 0.1.0 (premium 4BHK G+1, 30' x 40', any road side, vastu-aware) with own stage P5c_AREA_VASTU.
- Generic result contract (core/result.py: schedule, headline, summary_lines, far); P4 / P6 / P7 use it; old results still read.
- P1 0.3.0: any road side (compass or left/right sides). P5 site match follows the typology's site_params.
- P5b_STAIR_SCHEDULE promoted to a shared stage (second typology needs it).
- handoff_to_design --level for multi-level traces. Self-test 106 checks.

## 0.3.0 — 2026-10-06
- Parameter traceability: layer manifests (files + sha256, supplied / survived keys) in every option.json and selected.json; output/PARAMS.md lists them.
- P7 fails on any manifest file changed since P5 (stages P4, P5, P7 at 0.3.0).
- tools/trace_params.py (by key, by layer, by file across projects); catalog usage index with STALE flags.
- Typology layer hashes typology.json + generator.py; object layer hashes object.json + object.py.

## 0.2.0 — 2026-10-06
- Object library (`objects/`): STAIR_DOGLEG, DOOR_HINGED 0.1.0; standards sets (`standards/`).
- Typologies: version pinning with frozen versions, `extends` (registered and project variants), object-inherited parameters, rule clamps, applicability, stage plans with typology-owned stages, migrate().
- Layered parameters with provenance, locks / unlock, per-option files.
- Scopes and parcels (P1b_PARCELS), merged hand-off and QC.
- P2 records a typology match decision (existing / variant / new) with fit candidates; P3 asks for rules a new version needs.
- Tools: set_typology, upgrade_typology, new_variant, promote_variant, new_typology, fit, catalog. Self-test rewritten.
- TOWNHOME_RENTAL 0.2.0 (objects, door width, P5b stair schedule); 0.1.0 frozen. Planner 0.2.0 (door width).

## 0.1.0 — 2026-10-06
- Scaffold: core, stages P1–P7, TOWNHOME_RENTAL 0.1.0 with the Town Home Rental Planner.
