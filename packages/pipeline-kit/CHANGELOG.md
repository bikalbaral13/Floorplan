# pipeline-kit — changelog

## 0.3.2 — 2026-10-15
- projpaths: the one place that knows the R2 project layout (Projects/project_creation.md): pipeline_dir =
  Projects/<PROJECT>/<n-phase>/<pipeline>/[<SUB>/], inputs/, handoff/, shared/, media/, archive/. Phase aliases
  ("design" → plan).
- sync: outputs.keep `to` may use {DIR} {OUT} {STEPS} {PROJECT}; run.json is <pipeline dir>/run.json (the previous
  one is copied to archive/<run_id>/) instead of Projects/<CODE>/runs/<pipeline>/<run_id>/; publish(project=) puts
  a floor's sub-project inside its project. Schemas are read from the pipeline's own schemas/ first — library/Schemas
  is only a fallback (it is being retired).
- state: library_path(code, pipeline, project, phase) → the pipeline folder; pack() records project + phase.
- schemas/pipeline.v1: keep `to` accepts the placeholders.

## 0.3.1 — 2026-10-11
- interop.plan_trace_to_canvas: declares every layer the canvas uses (wall, door, opening, 0) with `visible: true`,
  name, colour and order. The bare `{"id": "0"}` made the editor import the canvas as EMPTY (found when the Full
  Pipeline's project canvas was opened in the editor). test_kit checks it.

## 0.3.0 — 2026-10-11
- Merge of the two diverged 0.2.0 branches. From the app: r2, sync, runner --pull/--publish/--dry-run/--store. From the
  program/space-brief bundle: units, semver, standards, state, interop, paths.check_writable/save_text/sha256/inputs_snapshot,
  tasks.get (KeyError) + deps_done, vendor.py --bundle/--bundle-split/--from-bundle/--unpack.
- Line endings pinned to LF (.gitattributes): bundle sha256 is over the text, so CRLF checkouts broke --from-bundle.
- tests: test_kit.py (bundle branch) 28/28, test_kit_core.py (app branch) 13/13, test_sync.py 26/26.

## 0.2.0 — 2026-10-07
- r2 (stdlib SigV4 client, same conventions as tools/r2.mjs: x-amz-meta-sha256, no-cache; LocalStore for tests) and sync (pull R2 inputs to cache/, publish outputs.keep to Projects/<CODE>/ with gate waits, schema validation, digest skip, run.json run/1; dry run). Runner CLI: --pull / --publish / --dry-run / --store local:<dir>. sync.publish_stage(ctx) for a publish stage. tests/test_sync.py 26/26.
- schemas/pipeline.v1 + run.v1 (the three-places contract) and tests/test_schemas.py 26/26; pipeline.json added to the tracer, exterior and interior pipelines (no runner change). publish/ holds the library files staged for R2 (Schemas, Pipelines/index.json, Skills/Shared/pipeline-rules.md rules 13–15).

## 0.1.0 — 2026-10-06
- Extracted from the floorplan-tracer-pipeline (cleanest version) with the mesh pipelines' task-sheet / report variants as parameters: paths.Layout, tasks (configurable FIELDS), findings, report (log + item reports with history), stage.Ctx, runner (gates, FIXTURE, reset downstream, decisions). tests/test_kit.py 13/13; tools/vendor.py (copy + hash manifest + --check).
