# Skills ↔ Pipelines: sync plan (pilot: build-from-deck)

Status: **rev 2 (2026-10-18), implemented as build-from-deck 0.4.0** — decisions taken: flat skill folders (version in skill.json + release.json pins), standalone tracer pipeline kept, compose.py kept as the Improver's PLACE step, one approval per stage (S2's tracer keeps its own gates), progress read through the app every 3 s. Rev 2 adds live progress (§6). Rev 1 split the work into 10 stages and 6 skills. This revision follows your 5-stage proposal: each stage maps to one skill, and the pipeline itself is only the UI.

## 1. The new shape: five stages, five skills

| New stage | Skill | Replaces (0.3.7) | Skill exists? |
|---|---|---|---|
| **S1 Brief** | **Deck Reader** | S1_INTAKE + S2_DRAFT + S2_FINALIZE | **new**, built from `intake.py`, `questions.py`, `brief.py` |
| **S2 Plan** | **Floorplan Tracer** (trace + geometry) | S3_FROM_TRACER + S3_GEOMETRY | yes, in `library/Skills/Floorplan Tracer/` (24 files); geometry still to be moved in |
| **S3 Objects** | **Object Resolver** | S4_CATALOG + S4_CHECK (+ Objects review UI) | **new**, built from `catalog.mjs`, `resolve_check.py`, `review_apply.py`, `review.html` |
| **S4 Fit-out** | **Floorplan Improver** | S5_COMPOSE (and much more) | yes, in backups `Skills/Floorplan Improver/` (24 files) |
| **S5 3D** | **Floorplan Renderer** | S7_3D | yes, in backups `Skills/Floorplan Renderer/` (26 files) |

Dropped for now: S6_DRAWINGS (Drawing Set). It stays in 0.3.7 and can come back later as a skill placed between S4 and S5.

Every stage has the same three parts: **questions → work → approval**. The pipeline's job is to show those parts in its tabs and to refuse to start a stage until the stage before it is approved.

## 2. The three layers

```
Skill     HOW one job is done        library/Skills/<Name>/<version>/      versioned, immutable, own selftest
Pipeline  WHICH skills, order, UI    library/Pipelines/build/build-from-deck-pipeline/
Project   the actual run             Projects/<CODE>/3-build/build-from-deck/stages/S1…S5/
```

- A **skill** owns its scripts, agent instructions, questions, review files and checks. It never hard-codes a project path: it reads from and writes to the folders it is given.
- A **pipeline** owns the stage order, the mapping from project folders to each skill's inputs and outputs, the tabs, and the approval gate. It contains no domain scripts.

## 3. Stage by stage

### S1 Brief: Deck Reader *(new skill)*

- **In:** the deck (`.pptx` / `.pdf`), or an existing `roombrief.json` from Plan/Design, in which case most of this stage is skipped.
- **Questions:** which project and room to build (room picker; today's `questions.json` from `questions.py`); anything the deck leaves out, such as ceiling height, budget band or style words.
- **Work:** `intake.py` extracts the slides; `brief.py` drafts the brief; the **agent curates** it (typed params per item, zones, cameras, checks, using the instructions today's `next:` hint gives); `brief.py finalize` checks every room slide is covered.
- **Review:** the Brief tab shows the room's items, zones and cameras next to the slide images.
- **Out:** `roombrief.json` (roombrief.v1), the slide images, and the plan-page image for S2.
- **To build:** `skill.json`, `SKILL.md`, `curate-the-brief.md` (the agent step written down properly), `questions/room.json`, `questions/gaps.json`, and a selftest that runs the INFRA deck through to the 0.3.7 `roombrief.json`.

### S2 Plan: Floorplan Tracer, trace and geometry together

- **In:** the plan image or PDF page (from S1, or uploaded), plus `roombrief.json` for room names and the expected outline.
- **Questions:** the tracer's existing scope form (`trace-scope.questions.json`, 20 questions). Questions S1 already answered (which room, which sheet, the deliverable) are **prefilled** for the user to confirm, not asked again. The scale question appears only if the plan has no printed dimension.
- **Work:** the tracer's existing steps (scope → intake → read → dimensions → layout → build → verify), then **geometry**: `from_tracer.py` + `geometry.py` turn the trace into walls, openings, zones and the room canvas.
- **Approval points:** two inside this stage, both required. (a) Scale and dimensions confirmed. (b) The overlay proof plus `geometry_check.png` accepted. Splitting at (a) means a wrong scale is caught before the whole build runs.
- **Out:** `plan.json`, `trace.px.json`, `<CODE>.canvas.json` (empty room: walls, openings, zones), the overlay PNG.
- **To build:** move `from_tracer.py` and `geometry.py` into the skill (`geometry/`) with a doc `turn-the-trace-into-room-geometry.md`. Move the tracer pipeline's `stages/S0…S8` scripts and its selftest into the skill, so the skill is the only copy. Add `skill.json`.

### S3 Objects: Object Resolver *(new skill)*

- **In:** `roombrief.json` (the items), the S2 canvas (where they can go), and a snapshot of the library catalog.
- **Questions:** for each brief item where the agent can't decide between candidate objects or materials, the user picks one. The review UI already does this.
- **Work:** `catalog.mjs` snapshots the library; the **agent** writes `resolve.json` (item → object, real param ids, host, materials); `resolve_check.py` checks every binding is real. Missing object → call **Parametric Object Creator**. Missing finish → **Material Creator**.
- **Review:** today's Objects review UI (`review.html`): each item, its bound object and material, accept / swap / omit.
- **Out:** `resolve.json`, i.e. the **locked selections**.
- **To build:** `skill.json`, `SKILL.md`, `resolve-items-to-objects.md` (the agent step written down), the review UI, and the selftest.

### S4 Fit-out: Floorplan Improver

This is where S3 and the Improver overlap, and it is the most important rule in this plan: Improver's `choose-the-fitout-set` also picks furniture. In this pipeline **S3's `resolve.json` is locked**. The Improver places those objects as given and only adds what the brief did not list:
- floors and tiles (`lay-out-tiles-and-floor-finishes`)
- lighting (`light-the-rooms`)
- ceiling, cornice, skirting and curtains (`dress-ceiling-walls-and-trims`)
- services and the render kit (`wire-services-and-render-kit`)
- moodboard restyling (`apply-moodboard-to-modelling-plans`)

- **In:** the S2 canvas, `resolve.json` (locked), `roombrief.json`, optionally a moodboard.
- **Questions:** the Improver's scope form (`improve-scope.questions.json`) and the moodboard pick (`choose-the-moodboard`). The questions about which furniture to include are **hidden** when a `resolve.json` is supplied.
- **Work:** `improve.mjs` with an option to respect the locked items (to add: `--locked resolve.json`). This replaces `compose.py` for placement. The Improver's own verify step (`verify-the-improvement`, facecheck/meshcheck) is the check.
- **Review:** the Room tab: the furnished canvas in the editor plus the overlay.
- **Out:** `<CODE>.room.canvas.json`, furnished, tiled, lit and ready to render.
- **To build:** `skill.json`, the `--locked` option, and a decision on `compose.py` (§9, decision 3).

### S5 3D: Floorplan Renderer

- **In:** the S4 room canvas.
- **Questions:** which cameras (from the deck's cameras in the brief, plus two corners and top as today), resolution / sample count / CPU-fast mode, and which export formats (`.blend` / `.glb` / `.fbx` / `.skp`).
- **Work:** `bake_plan.mjs` → `enrich_plan.mjs` → `render_plan.py` (Blender headless on the runner) → `export_room.py`.
- **Review:** stills in the 3D tab next to the deck's reference slides; the user accepts or asks for another pass (lighting, framing) with notes.
- **Out:** `output/3d/*.blend|.glb|.fbx`, `renders/*.png`.
- **To build:** `skill.json` only. The skill is already complete. Check that S7_3D's camera handling from the deck moves into it (`frame-the-shot.md`).

## 4. The skill manifest: `skill.json` (`skill/1`)

```jsonc
{
  "schema": "skill/1",
  "id": "floorplan-tracer", "version": "1.0.0", "entry": "SKILL.md",
  "inputs":  { "image": { "type": "image|pdf", "required": true },
               "brief": { "type": "roombrief.v1" } },
  "outputs": { "canvas": { "file": "canvas.json", "schema": "canvas.v1" },
               "proof":  { "file": "overlay.png", "review": true } },
  "questions": [ { "file": "trace-scope.questions.json",
                   "prefill": { "which_plan": "brief.room", "deliverable": "'room-canvas'" } } ],
  "steps": [
    { "id": "SCOPE",  "kind": "user",   "gate": "answers" },
    { "id": "INTAKE", "kind": "script", "run": [["python","pdf/intake.py","{IN:image}","{WORK}"]] },
    { "id": "READ",   "kind": "agent",  "doc": "read-openings-and-fixtures-by-zoom.md" },
    { "id": "DIMS",   "kind": "agent",  "doc": "calibrate-scale-from-printed-dimensions.md", "gate": "approve", "review": ["scale.txt"] },
    { "id": "BUILD",  "kind": "script", "run": [["node","multi/build.mjs","{WORK}"]] },
    { "id": "GEOM",   "kind": "script", "run": [["python","geometry/geometry.py","{WORK}"]] },
    { "id": "VERIFY", "kind": "script", "run": [["python","multi/overlay.py","{WORK}"]],
                      "gate": "approve", "review": ["overlay.png","geometry_check.png"] }
  ],
  "selftest": "tests/run.mjs"
}
```

- `kind` is `user` (a form), `script` (the runner runs it) or `agent` (Claude follows `doc`). This tells the pipeline whether to queue a `project.job` or hand the step to the agent.
- `gate` is `answers` or `approve`. `prefill` takes answers from earlier stages, so the user confirms them instead of answering twice.

## 5. The approval gate (`gate/1`), the same for all five stages

```
pending → asking → running → review → approved
                      ↑          │
                      └─ changes ┘   ("request changes" + the user's notes → rerun)
```

Files per stage: `Projects/<CODE>/3-build/build-from-deck/stages/S<n>/`

| File | Written by | Holds |
|---|---|---|
| `questions.json` | the skill | the form (existing questions schema) |
| `answers.json` | **the user**, through the app | their answers; never written by the agent |
| `outputs/` | runner or agent | results |
| `approval.json` | **the user**, through the app | `{ by, at, words, outputsHash }`; a skill with two gates (S2) writes `approval.<step>.json` |

Runner rules:
1. A stage does not start until the previous stage's approval exists **and** its `outputsHash` still matches the current outputs.
2. Rerunning a stage marks everything after it **stale** (shown in the tabs). The user has to re-approve those stages; the runner never re-approves them automatically.
3. Only an app click or the user's quoted chat words count as approval. The agent never approves.

The app draws the same strip at the top of every tab: **Questions · Run · Review · Approve / Request changes**. There are five tabs: Brief, Plan, Objects, Fit-out, 3D.

## 6. Live progress in the right-side panel

While a stage runs, the right-side panel of the pipeline app shows what is happening now, how far along it is, and a running log:

```
S2 Plan · Floorplan Tracer 1.0.0                         ████████░░░░  64 %   ~2 min left
  ✓ SCOPE    answers confirmed                                    0:12
  ✓ INTAKE   PDF page 3 → 4961×3508 px                            0:21
  ✓ READ     14 openings, 6 fixtures read                         1:48   (Claude)
  ⏸ DIMS     waiting for your approval — scale 1:50 (from 3 printed dims)
  ▸ BUILD    Building walls… 38 / 52 segments                      0:09
  · GEOM
  · VERIFY
  ───────────────────────────────────────────────────────────────
  12:04:31  Building walls… 38 / 52 segments
  12:04:28  Snapped 4 T-junctions
  12:04:22  Wall bands measured: 52 bands, median 230 mm
  …                                          last update 3 s ago · checking every 3 s
```

### 6.1 Where progress comes from: one file per stage

`stages/S<n>/progress.json` (`progress/1`). It is small and rewritten in place; only the job and the app read it.

```jsonc
{
  "schema": "progress/1", "stage": "S2", "skill": "floorplan-tracer@1.0.0",
  "state": "running",            // pending | asking | running | waiting_approval | review | approved | failed | stale
  "pct": 64, "eta_s": 120,
  "step": { "id": "BUILD", "pct": 73, "msg": "Building walls… 38 / 52 segments" },
  "steps": [ { "id": "SCOPE", "state": "done", "secs": 12, "summary": "answers confirmed" }, "…" ],
  "log": [ { "t": "2026-10-18T12:04:31Z", "level": "info", "msg": "Building walls… 38 / 52 segments" } ],   // last 100 lines
  "updated": "2026-10-18T12:04:31Z", "heartbeat": "2026-10-18T12:04:31Z"
}
```

The full log stays in the job file, as it does today (`jobs/<STAGE>.json` keeps the last 200 lines). `progress.json` holds only what the panel needs.

### 6.2 How each kind of step reports

| Step kind | Who reports | How |
|---|---|---|
| `script` | the script itself | Prints lines like `@@progress {"pct":73,"msg":"Building walls… 38 / 52 segments"}` to stdout. `worker.mjs` already captures stdout (`runCmd` → `log`). It picks out `@@progress` lines and updates `progress.json`, writing at most once every 2 s. Any other stdout line becomes a plain log line. A script that never reports still shows its log and the step's elapsed time; its percentage jumps from 0 to 100 when it finishes. |
| `agent` | Claude | Before and during each agent step, Claude writes a short message ("Reading openings by zoom: zone 3 of 6") through a new `project { op: "progress", code, stage, pct, msg }` call. The connector writes it into `progress.json`. The skill doc lists the checkpoints, e.g. "report after each zone", so the reports don't depend on Claude remembering. |
| `user` | the app | The state becomes `asking` or `waiting_approval` with the question or review it is waiting on. The bar pauses and shows ⏸. Time spent waiting for the user is not counted in the ETA. |

A small helper ships with every skill for scripts to use: `progress.py` / `progress.mjs`, with `report(pct, msg)` and `step_done(summary)`. All skills then report the same way.

### 6.3 Stage percentage

- Each step in `skill.json` gets a `weight`, its typical share of the stage's running time (e.g. `READ: 35`, `BUILD: 10`).
- Stage % = sum of finished steps' weights, plus the running step's weight × its %, divided by the total weight.
- **Learned weights:** after every run the runner adds each step's actual time to `library/Skills/<id>/stats.json`. Once there are 3 or more runs, those averages replace the hand-set weights. The ETA comes from the same file. Before 3 runs, no ETA is shown, so it doesn't promise a time it can't back up.

### 6.4 Polling

| App state | Checks `progress.json` every |
|---|---|
| Stage running, panel visible | **3 s** |
| Stage running, tab hidden | 15 s |
| Waiting for the user / idle | 30 s, or immediately on returning to the tab |

- The relay takes about 1.9 s per call (see the Relay latency note), so 3 s is the practical minimum. The app reads `progress.json` straight from R2 with a presigned GET (`r2.mjs presignUrl`) instead of through the relay. That makes each check cheap and keeps the relay free for real work. It uses `If-None-Match`, so nothing is downloaded when the file hasn't changed.
- **Stalled detection:** if `heartbeat` (already written every 20 s by the worker) is more than 60 s old, the panel says *"Runner not responding — is `node tools/runner/worker.mjs` running?"* If a queued job is never picked up within 60 s, it says *"No runner online"*. This matches the connector's existing rule.
- Later, if the relay moves to Upstash (sub-second), progress can switch to push over SSE. The file format stays the same.

### 6.5 Panel behaviour

- The panel opens on whichever stage is current. Earlier stages fold up into one line each: ✓ name, total time, who approved it and when.
- Each step's line expands to show its log lines. **Failed** steps open automatically, showing the error and the last 20 lines, plus a *Retry step* button that reruns only that step.
- A stage marked stale shows why: *"S2 was re-run at 12:10, re-approve S3"*.
- Cost per stage (time, Claude tokens, INR) comes from the existing `usage.json` / Runner tab and is shown on the folded line.

## 7. How the pipeline calls a skill

`pipeline.json` (build-from-deck 0.4.0):

```jsonc
"skills": {
  "deck":     { "id": "deck-reader",        "version": "1.0.0" },
  "tracer":   { "id": "floorplan-tracer",   "version": "1.0.0" },
  "resolver": { "id": "object-resolver",    "version": "1.0.0" },
  "improver": { "id": "floorplan-improver", "version": "1.0.0" },
  "renderer": { "id": "floorplan-renderer", "version": "1.0.0" }
},
"stages": [
  { "id": "S1", "tab": "Brief",   "uses": "deck",     "in": { "deck": "inputs/decks/{ARG:deck}" } },
  { "id": "S2", "tab": "Plan",    "uses": "tracer",   "in": { "image": "{S1}plan-page.png", "brief": "{S1}roombrief.json" } },
  { "id": "S3", "tab": "Objects", "uses": "resolver", "in": { "brief": "{S1}roombrief.json", "canvas": "{S2}canvas.json" } },
  { "id": "S4", "tab": "Fit-out", "uses": "improver", "in": { "canvas": "{S2}canvas.json", "locked": "{S3}resolve.json", "brief": "{S1}roombrief.json" } },
  { "id": "S5", "tab": "3D",      "uses": "renderer", "in": { "canvas": "{S4}room.canvas.json", "cameras": "{S1}roombrief.json#cameras" } }
]
```

The runner downloads each pinned skill to `pipeline-work/skill-cache/<id>/<version>-<sha>/` (checking its sha256, as Engine-in-R2 does), then expands the stage into the skill's steps. Script steps become runner jobs; agent steps go to Claude. The pipeline folder keeps only `pipeline.json`, `AGENTS.md` and the app.

## 8. Rollout

| Phase | What | Done when |
|---|---|---|
| **P0** Skills in R2 | Copy Floorplan Improver and Floorplan Renderer from backups to `library/Skills/` (same way as the tracer). Add `skill.json` to all three; decide on version folders | `list_skills` shows all three; each manifest passes `tools/skills/validate.mjs` |
| **P1** Tracer complete | Move geometry and the tracer pipeline's S0–S8 scripts and selftest into the tracer skill | Selftest 18/18 from the skill; geometry matches 0.3.7 on INFRA Reception |
| **P2** Gate + `uses:` + progress | `gate/1` files, stale tracking, skill cache, prefill; `progress/1` + `@@progress` parsing in worker.mjs + `project.progress` op + the right-side progress panel; the strip and five tabs | Stage S2 alone runs inside build-from-deck from the skill, with both approval points |
| **P3** Deck Reader | New skill from S1/S2 | `roombrief.json` identical to 0.3.7 |
| **P4** Object Resolver | New skill from S4 | `resolve.json` + review UI work from the skill |
| **P5** Improver with locked items | `--locked resolve.json`, hide the furniture-choice questions | Fit-out keeps every resolved item; adds tiles/lights/trims |
| **P6** Renderer + 0.4.0 release | Move S7's camera handling in; publish build-from-deck 0.4.0 with five stages | INFRA Reception end to end with five approvals; renders comparable to 0.3.7 |

Regression check at every phase: run INFRA Reception and compare against the 0.3.7 outputs. Only intended changes are allowed.

## 9. Decisions for you

1. **Version folders:** `library/Skills/<Name>/1.0.0/` (recommended, lets a pipeline pin a version) or keep the flat folders?
2. **The standalone tracer pipeline:** keep it as a thin app over the skill (for tracing on its own) or retire it?
3. **`compose.py`:** retire it in favour of Improver placement (recommended), or keep it as the Improver's "place locked items" step?
4. **Two approval points in S2** (scale, then overlay + geometry), or one at the end?
5. **S4 without a moodboard:** use the default board automatically, or always ask?
6. **Progress checks:** 3 s while running, read straight from R2 (recommended), or through the connector at about 5 s?
7. **Pilot stop:** review after P2 (the tracer running inside build-from-deck), or continue straight to P6?
