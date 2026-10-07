# library/Schemas — the hand-off formats between pipelines

JSON Schema (draft 2020-12) + one REAL example per format (`examples/`), every example validated when published. Adapters and pipelines validate inputs and outputs against these, so a wrong field fails at the hand-off instead of three phases later.

| Schema | What | Producer → consumer |
|---|---|---|
| `canvas.v1` | the editor's standard plan JSON (key fields; structure only) | editor, Floorplan Tracer S7 → editor, all adapters |
| `tracer-plan.v1` | Floorplan Tracer neutral plan model | tracer S5 → tracer checks / exporters |
| `tracer-layout.v1` | what the tracer's agent stages author | tracer S4 → S5 |
| `plan_trace.v1` | program → design hand-off (flat, mm) | program_pipeline P6 → design_pipeline |
| `plan_trace-tracer.v0` | the tracer's plan_trace — **diverges** from plan_trace.v1 (levels[]); to reconcile | tracer S7 → Design phase |
| `masterplan.v1` | designs placed on a site | tracer master-plan route → exterior pipeline |
| `building.v1` | exterior envelope geometry of a design | exterior adapter → BUILDING family |
| `instances.v1` | prototype placements | exterior plan_to_project → Blender / Unreal export |
| `material-binding.v1` | material_key → Materials file per family | (design / moodboard) → mesh exporters |
| `family.v2` | shared mesh family (target format, not yet in use) | library/Families |
| `pipeline.v1` | a pipeline's contract: inputs, library pins, what it keeps (→ `Projects/<CODE>/`) and what is temp | each pipeline's `pipeline.json` → agents, the kit's publish stage |
| `run.v1` | record of one run: inputs, library versions, outputs with sha256, task statuses, approvals | publish stage → `Projects/<CODE>/runs/<pipeline>/<run_id>/run.json` |

Validation evidence (2026-10-06): all 10 examples valid; 8 deliberate breakages caught (unknown opening kind, wall without thickness, canvas without settings, **attachment without id**, wall out = 2, instance without prototype, wrong schema version, family in mm); `canvas.v1` accepts all 11 real canvas files in the app repo (single / multi-level / improved).
Change rule: a breaking change is a new file (`*.v2`); never edit a published version so that existing files stop validating.

Added 2026-10-07: `pipeline.v1`, `run.v1` (masters in the app repo `packages/pipeline-kit/schemas/`). Evidence: the 3 real pipeline.json files valid; tracer keep-paths resolve on WINDSOR_B1; a run.json built from the real WINDSOR_B1 run valid; 11 deliberate breakages caught (incl. keep or run output keyed into library/, promotion without approval). `packages/pipeline-kit/tests/test_schemas.py` 26/26.
