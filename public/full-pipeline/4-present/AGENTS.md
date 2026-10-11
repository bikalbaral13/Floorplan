# AGENTS.md — how to work in the walkthrough video pipeline

This pipeline turns **any .blend + a script + a camera-path drawing** into a **walkthrough film**: a Blender
walkthrough with real cameras (the consistency layer: geometry, paths and timing are fixed), a fast preview, and
then **AI-generated realistic clips** (Krea / Seedance) that follow those Blender clips shot by shot, joined into
one video. It sits in the **Present** phase, downstream of the exterior / interior mesh pipelines.

Read in this order: **this file → `projects/<CODE>/PROJECT.md` → `projects/<CODE>/TASKS.csv` → the stage's `prompt.md`.**

---

## 1. Layout

```
PIPELINE_ROOT            marker — never delete
AGENTS.md README.md CHANGELOG.md pipeline.json
core/                    paths · tasks · stage (Ctx) · shots (model + checks) · blender (headless runner) · krea (REST client)
bscripts/                code that runs INSIDE Blender: inspect_scene · build_walkthrough · render_shots · assemble
stages/S0…S10/           stage.json + run.py (+ prompt.md for agent stages, scope.questions.json for S0)
standards/DEFAULT.json   render presets, AI model limits, house style, lighting, palette, Krea settings, check limits
tools/                   run_task · new_project · status · selftest (+ _write_stage_meta)
tests/fixtures/          Kingswood exterior shot list + prompts (known-good)
_vendor/pipeline_kit     vendored kit — NEVER hand-edit
projects/<CODE>/         project.json PROJECT.md TASKS.csv REPORT.md scope.json intake.json shots.json
                         build.json preview.json prompts.json prompts.preview.md budget.json jobs.json final.json handoff.json
<work_dir>/              intake/ jobs/ output/{<CODE>_walkthrough.blend, preview/, <CODE>_preview.mp4, ai/, <CODE>_final.mp4}
                         (project.json → work_dir, default <repo>/pipeline-work/walkthrough/<CODE> — OUTSIDE public/)
```

## 2. Stages

| Stage | Kind | Who | Output |
|---|---|---|---|
| S0_SCOPE | script | **user answers** scope.json (then `--approved`) | scope.json |
| S1_INTAKE | blender | script | intake.json, top-down plan |
| S2_SHOTLIST | agent | **you** write shots.json (`prompt.md`) | shots.json |
| S3_BUILD | blender | script | `<CODE>_walkthrough.blend` |
| S4_PREVIEW | blender | script | per-shot clips + keyframes, `<CODE>_preview.mp4` |
| S5_PREVIEW_REVIEW | **gate** | user | preview approved |
| S6_PROMPTS | agent | **you** write prompt bodies (`prompt.md`) | prompts.json, prompts.preview.md |
| S7_BUDGET | **gate** | user approves the spend | budget.json |
| S8_GENERATE | script (+ agent in connector mode) | script / you via the Krea connector | jobs.json, `ai/<ID>.mp4` |
| S9_ASSEMBLE | blender | script | `<CODE>_final.mp4` |
| S10_REVIEW | **gate** | user | handoff.json |

Run: `python tools/run_task.py <CODE>` (preview next) · `--task <ID>` · `--all` (stops at agent stages and gates).

## 3. Branches

- **coverage** `exterior | interior | both`: the shot list may only use what the model contains. Scripted scenes the
  model cannot show are dropped or substituted, never invented; list them in PROJECT.md (S2).
- **materials** `keep | palette`: keep the .blend's materials, or recolour a flat massing model from the standards palette.
- **ai_mode** `connector | api`: connector = you submit through the Krea MCP connector (tested); api = `core/krea.py`
  with `$KREA_API_KEY` (paths not yet verified: `standards.krea.verified`).
- **ai_provider** `none`: stop after S5 — the Blender preview is the deliverable.

## 4. Model conventions

- Metres, seconds, the .blend's own axes (Z up). Shots run back-to-back from 0 s; durations are whole seconds within the model's limits.
- Provenance on every shot: `src` = measured · derived · convention · user.
- One shared style prefix / suffix and one seed for every clip. Per-shot wording goes in the body only.
- The source .blend is opened read-only; the walkthrough is saved as a new file in the work dir.
- Preview clips must be ≥ the model's `min_ref_pixels` (960×540 'low' preset is the default) — they are the AI references.

## 5. Scope boundaries

- Modelling, furnishing and materials belong to the mesh pipelines and the Floorplan Renderer, not here.
- Voiceover recording / music composition are inputs (`audio_file`), not generated here.
- This pipeline never buys credits, changes plans or signs in anywhere. When generation is out of credits it **blocks** and tells the user.

## 6. Delivery

Local-first: everything runs on the user's PC. Generation spends credits only after the **S7** gate; outputs are
published to `Projects/{CODE}/walkthrough/` only after **S10** (`python tools/run_task.py <CODE> --publish`).

## 7. Changing things

Rules → `core/shots.py` checks + a negative case in `tools/selftest.py`; conventions → `standards/`; Blender
behaviour → `bscripts/`; stage text → edit `tools/_write_stage_meta.py` and rerun it. Bump `core/VERSION` +
`pipeline.json → version`, add a CHANGELOG line, run `python tools/selftest.py --blender`.

**Never answer the scope, approve a preview, approve a spend or approve the final video on the user's behalf.**
