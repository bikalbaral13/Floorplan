# pipeline-kit

The shared plumbing of every BuilderPluss pipeline: task sheet, runner (preview / run / run-all, dependency waits, user gates, FIXTURE projects, reset downstream, decision log), stage folders, findings, reports, project layout with the work dir outside `public/`. Pure Python 3.10+, stdlib only.

- **Master:** this folder. Change it here, run `python tests/test_kit.py`, bump `pipeline_kit/VERSION`, add a CHANGELOG line.
- **Pipelines** carry a vendored copy: `python tools/vendor.py <pipeline root>` writes `<root>/_vendor/pipeline_kit` + `_vendor/KIT.json` (version + sha256 per file); `--check` reports drift; each pipeline's self-test fails on a hand-edited copy.
- **Published snapshot:** R2 `library/Pipelines/_kit/<version>/` (for agents and outside tools).

R2: every pipeline carries a `pipeline.json` (schema pipeline/1). `run_task.py <CODE> --pull` fetches R2 inputs into the work dir cache; `--publish [--dry-run]` uploads `outputs.keep` to `Projects/<CODE>/` (waiting for gates, validating schemas, skipping unchanged files) and writes `run.json`. Nothing outside `keep` is uploaded; `library/` is never written by a run.

Using it in a pipeline: put `_vendor` on `sys.path`, build a `paths.Layout(root)`, declare the task-sheet `FIELDS`, subclass `stage.Ctx` for pipeline conveniences, and run `runner.Runner(layout, FIELDS, stages_dir, ctx_class).cli(argv)`. See `public/floorplan-tracer-pipeline/core/` for a complete, minimal adoption.

| Pipeline | Kit | Since |
|---|---|---|
| floorplan-tracer-pipeline | 0.2.0 (paths, tasks, findings, report, stage, runner, r2, sync) | 2026-10-06; sync 2026-10-07 |
| exterior-mesh-pipeline | — (next: paths / tasks / report / findings; its Blender task types later) | |
| interior-mesh-pipeline | — | |
| program_pipeline | — | |
