# Shared library plan — what lives in R2 vs inside each pipeline

Pipelines: Floorplan Tracer (Plan), Interior Mesh (Present), Exterior Mesh (Present); program_pipeline may join.
Principles: share what is identical; **data** lives in R2; shared **code** is mastered in repo packages and published to R2; pipelines reference + pin, never copy; one-way publish (master → verify → publish with the user's approval); nothing switches until a pipeline runs from the shared copy with identical output.

| Phase | Work | Status |
|---|---|---|
| **A. Data** | `library/Standards`, `Rules` (drafts, unconfirmed), `Schemas` (10 + examples), `Fixtures` (4), `Pipelines/index.json`, `Skills/Shared/pipeline-rules.md` | **done 2026-10-06** — 52 files, verified byte-identical from the public URL; pipelines unchanged (tracer selftest 18/18) |
| B. Pipeline kit | `packages/pipeline-kit` (task sheet, runner, stages, reports, work dir, gates) from the tracer; tracer → exterior → interior switch | **tracer done 2026-10-06** — kit 0.1.0 (tests 13/13), vendored with hash check; tracer rebuilt both fixtures through the kit runner with byte-identical outputs, selftest 19/19; snapshot in R2 `Pipelines/_kit/0.1.0` (tests pass from the download). Exterior / interior: next |
| C. canvas_io | one canvas reader/writer (tracer exporter + importer); exterior adapter + planned interior canvas adapter use it; reconcile `plan_trace` (v1 flat vs tracer levels[]) | |
| D. famlib + Blender adapter | pure MeshBuilder + revolve/bevel; finishing / UV1 / FBX / Unreal in one place | |
| E. Families family/2 | new families written in the shared format; convert existing ones when a 2nd consumer needs them; PY_OBJECT | see `docs/library-families.md` |
| **Step 1–2 (R2 places)** | `pipeline/1` + `run/1` schemas, `pipeline.json` in tracer / exterior / interior, rules 13–15 (three places: `library/` reusable · `Projects/<CODE>/` lasting · work dir temp) — published 2026-10-07. Kit 0.2.0: `r2` + `sync` (pull / publish / dry run / digest skip / schema check / run.json), tests 26/26; WINDSOR_B1 published to `Projects/WINDSOR_B1/` (8 files byte-identical) | **done 2026-10-07** — next: step 3 move interior outputs out of `public/` |
| F. Clean-up | AGENTS.md reference shared rules; local copies removed; app reads `Pipelines/index.json` | |

Phase A notes
- Standards/DEFAULT merges tracer DEFAULT, exterior ground table, interior / exterior frame conventions, program objects, the measured fixture-back table, the symbol legend; AADITHYAA extends it.
- Rules are DRAFTS gathered from pipeline defaults (NBC 2016 Part 3 as quoted, program plot placeholders) — every value `unconfirmed`; a jurisdiction file needs the user's confirmation.
- Schemas: 8 deliberate breakages caught; `canvas.v1` accepts all 11 real canvas files in the repo. Found: two different `plan_trace` formats (program flat v1 vs tracer levels) — published both, reconcile in phase C.
- Pipelines still read their LOCAL standards / fixtures; they switch in later phases.
