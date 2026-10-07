# pipeline-kit — changelog

## 0.2.0 — 2026-10-07
- r2 (stdlib SigV4 client, same conventions as tools/r2.mjs: x-amz-meta-sha256, no-cache; LocalStore for tests) and sync (pull R2 inputs to cache/, publish outputs.keep to Projects/<CODE>/ with gate waits, schema validation, digest skip, run.json run/1; dry run). Runner CLI: --pull / --publish / --dry-run / --store local:<dir>. sync.publish_stage(ctx) for a publish stage. tests/test_sync.py 26/26.
- schemas/pipeline.v1 + run.v1 (the three-places contract) and tests/test_schemas.py 26/26; pipeline.json added to the tracer, exterior and interior pipelines (no runner change). publish/ holds the library files staged for R2 (Schemas, Pipelines/index.json, Skills/Shared/pipeline-rules.md rules 13–15).

## 0.1.0 — 2026-10-06
- Extracted from the floorplan-tracer-pipeline (cleanest version) with the mesh pipelines' task-sheet / report variants as parameters: paths.Layout, tasks (configurable FIELDS), findings, report (log + item reports with history), stage.Ctx, runner (gates, FIXTURE, reset downstream, decisions). tests/test_kit.py 13/13; tools/vendor.py (copy + hash manifest + --check).
