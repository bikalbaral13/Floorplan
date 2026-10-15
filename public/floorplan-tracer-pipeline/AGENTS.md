# AGENTS.md — the Floorplan Tracer pipeline

Turns a **measured drawing** (JPEG / PNG / PDF) or a **photo of a hand sketch** into a correct plan, as an
**app-independent model** (`plan.json`, tracer-plan/1) — then exports it (canvas JSON for the BuilderPluss
editor, SVG, an overlay on the source, `plan_trace.json` for the design / program pipelines). Phase: **Plan**.
It merges the *Floorplan Tracer* and *Scribble to Floorplan* skills: one pipeline, two reading branches, one
shared back half. Read this file → `projects/<CODE>/PROJECT.md` → `TASKS.csv` → the stage's `prompt.md`.

## 1. Layout
```
PIPELINE_ROOT  AGENTS.md  README.md  CHANGELOG.md
core/        paths units model (tracer-plan/1) layout (tracer-layout/1) build dims stage tasks report
stages/      S0_SCOPE … S8_REVIEW — stage.json + run.py (+ prompt.md for agent stages)
checks/      plan_checks.py — the skills' lessons as checks
exporters/   canvas.py (the ONLY code that knows the editor format) · drawing.py (SVG, overlay) · plan_trace.py
standards/   DEFAULT.json — conventions used when the source is silent (tagged src=convention), check limits,
             symbol legend, the canvas library's measured fixture-back tables
tools/       run_task status new_project selftest · wallbands grid_crops pdf_intake (measurement / reading aids)
_vendor/     pipeline_kit (shared task sheet, runner, stages, reports, work dir) — vendored from the app repo
             packages/pipeline-kit; KIT.json holds its hashes. NEVER edit it here: change the master, run its tests,
             re-vendor (`python packages/pipeline-kit/tools/vendor.py <this folder>`), run tools/selftest.py
             import_canvas plan_to_layout (bring existing traces in as fixtures)
tests/fixtures/  Windsor B1 (drawing), Scribble 2BHK (sketch)
projects/<CODE>/ project.json scope.json reading.json dims.json layout.json plan.json accepted.json handoff.json
                 TASKS.csv REPORT.md inputs/        heavy files → project.json → work_dir (outside public/)
```

## 2. Stages
| Stage | Kind | Who | Output |
|---|---|---|---|
| S0_SCOPE | script | **user answers** scope.json; finishes only with `--approved "<their words>"` | scope.json |
| S1_INTAKE | script | images copied / PDF regions cropped (pdf_intake); **user confirms** the manifest | work/manifest.json |
| S2_READ | agent | drawing: measure, zoom-read, printed pairs → scale fit · sketch: given / drawn / inferred, block diagram, **user confirms** | reading.json, work/calib.json |
| S3_DIMENSIONS | script | closes sketch chains / solves drawing centrelines from printed spans | work/dims.resolved.json |
| S4_LAYOUT | agent | writes the layout spec on the grid / calibrated frame | layout.json |
| S5_BUILD | script | layout → plan model | plan.json |
| S6_VERIFY | script | every check; fails block unless `accepted.json` carries the user's reason | work/qc.md |
| S7_EXPORT | script | canvas / SVG / overlay / plan_trace + canvas round trip | work/out/* |
| S8_REVIEW | gate | **the user approves** | handoff.json |

The runner is the shared pipeline_kit runner (same rules in every pipeline; see R2 `library/Skills/Shared/pipeline-rules.md`). `python tools/run_task.py <CODE>` previews · `--task S5_BUILD` runs · `--all` runs script stages until an agent stage or a gate needs input. Re-running a done task resets everything downstream. **Never answer a scope, confirm a manifest, confirm a sketch reading or approve a review on the user's behalf.** Fixture projects (`project.json → fixture: true`) take approvals that start with `FIXTURE` so nobody mistakes them for a user decision.

## 3. The two branches
- **Drawing** — traced pixel for pixel. The geometry is authored in the IMAGE frame (`frame.type = image`, px/m, origin) with ONE centreline constant per wall line; printed room sizes calibrate the scale (least squares, residual per pair) and can place the wall lines (S3 solve) so every printed room reads exact. The user may own the scale — then it is only cross-checked, never redone.
- **Sketch** — derived, not traced. The dimension chain (`dims.json`) is the constants module: outer → c-c, known bays, fitted bays, off-grid partitions as expressions; the layout references grid names only. Hierarchy (hall / kitchen > every bedroom), wet rooms on an outside wall, circulation and doors-to-one-side are checked.

## 4. The model's conventions (core/model.py)
Metres, X east, Y north. Walls and openings are centreline pieces a→b with thickness; openings are pre-cut gaps. Door `hinge` = end a|b, `swing` = L|R of a→b. Space rings on centrelines; `clear` = face-to-face size (what a printed size means); `net_area` = ring minus bands. Fixtures by `back` compass. Every element carries `src` (measured · derived · convention · user · sketch · imported).

## 5. Scope boundaries (moved out on purpose)
Furnishing empty rooms → **Design** (Floorplan Improver). A designed structural grid with footings → **Build**. Authoring missing library objects → library work. The tracer places only what is DRAWN, and lists what it could not place.

## 6. Delivery — local first, the editor only at the end
The live editor connector is slow; every call waits on a browser tab and every payload passes through the model. So:
- **Run every stage locally** (this folder + `python tools/run_task.py`). Read standards, objects and skills from R2 directly (`tools/r2.mjs` → `getObjectText` / `listObjects` in the app repo), not through the connector.
- **Never draw on the live canvas while tracing**, and never pass a plan JSON or an image through a connector tool argument (no inline `design`, no base64 / data-URL underlays).
- **One editor step, last**, after S7_EXPORT: upload the source image to R2 `Projects/<CODE>/inputs/<CODE>.<ext>`, set the canvas `imageUnderlay.src` to its public R2 URL, upload the canvas to `library/Designs/<CODE>.json` (`r2.mjs → putObject`), then open the editor on that design — one call, by path.
- The user still answers S0, confirms S1 (and a sketch reading) and approves S8; working locally changes where the work runs, not who decides.
- An agent with only the connector (no local files, no R2 keys) cannot run this pipeline — say so and have it run from Claude Code.

## 7. Changing things
Rules live in `checks/` (a lesson becomes a check + a fixture case in `tools/selftest.py`), conventions in `standards/`, the editor format only in `exporters/canvas.py`. Bump `core/VERSION` / a stage's version + CHANGELOG line; run `python tools/selftest.py` (all must pass). Not yet built (v0.1): multi-sheet level alignment beyond per-level frames, master-plan groups, DXF export, oblique walls in `plan_to_layout`.
