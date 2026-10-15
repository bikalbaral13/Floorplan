# Project creation — folder hierarchy and `project/1`

Every project lives in R2 at the bucket root, `Projects/<CODE>/`. It holds **all** of that project's input and
output files: everything a user uploads and everything a pipeline, the editor or the viewer makes. Nothing
project-specific goes into `library/`, which holds reusable things only (objects, materials, pipelines).

Work moves through four phases: **Program → Plan/Design → Build → Present**. Each phase runs one or more
pipelines, and each phase can be done by a different person, who picks the project up from R2.

Paths are built in one place, never by hand: `pipeline_kit/projpaths.py` for pipelines and
`src/floorplan/projectPaths.ts` for the editor. If this file and those two disagree, fix them together.

## 1. Project code

- `<CODE>`: upper-case `A–Z`, `0–9`, `_`, at most 40 characters, for example `DEMO_VILLA`.
- It is unique in `Projects/index.json` and never changes after creation.
- A floor of a multi-storey project gets a **sub-code**: `<CODE>_<LEVEL>`, e.g. `DEMO_VILLA_GF`. A sub-code is never a
  folder of its own at the top: it lives inside its project's pipeline folder (§2).
- `Projects/_unassigned/` collects files made with no project open (viewer sessions, editor uploads).

## 2. Folder hierarchy

```
Projects/
├─ index.json                          registry of every project (projects-index/1)
├─ project_creation.md                 this file
└─ <CODE>/
   ├─ project.json                     the manifest (project/1, §3)
   ├─ inputs/                          what the client / user GIVES — read-only for pipelines
   │   ├─ drawings/                    PDF, DWG, DXF, scans, hand sketches
   │   ├─ decks/                       pptx, briefs, questionnaires
   │   ├─ images/                      site photos, underlays; images/references/ = space reference images
   │   ├─ designs/                     canvases brought in from elsewhere
   │   ├─ models/                      GLB, SKP, .blend given by the client
   │   └─ shared/<phase>/<person>/     a private local file made shared (`project.py share`)
   ├─ 1-program/  2-plan/  3-build/  4-present/
   │   └─ <pipeline>/                  e.g. 1-program/program/, 2-plan/space-brief/
   │       └─ [<SUB>/]                 only when the phase works per floor (2-plan/space-brief/DEMO_VILLA_GF/)
   │           ├─ run.json             the current run (run/1, §4)
   │           ├─ state.json           the pipeline project's packed text files (to resume on another machine)
   │           ├─ REPORT.md            the run report
   │           ├─ steps/               intermediate files; steps/app/ = an app's data (Space Brief)
   │           ├─ answers/             the files holding the user's answers (brief, rules, scope …)
   │           └─ output/              the FINAL deliverables (the pipeline.json outputs.keep)
   ├─ handoff/<phase>.json             what a finished phase hands the next one (§5)
   ├─ shared/                          the ONE project canvas
   │   ├─ canvas.json                  the latest revision (packed multi-level; opens in the editor as is)
   │   ├─ revisions/rNNNN.json         every revision, immutable
   │   ├─ index.json                   canvasrevs/1: who changed what, in which phase
   │   └─ rooms/<SUB>.room.canvas.json Build's furnished room canvases
   ├─ media/                           client-facing results
   │   ├─ renders/
   │   ├─ video/                       walkthrough films (editor report, Present uploads)
   │   └─ drawings/                    issued PDFs / DXFs
   ├─ viewer/<session>/                viewer / app sessions
   └─ archive/<run_id>/<n-phase>/<pipeline>/…   superseded run.json files — never silently deleted
```

The phase folder names are fixed: `1-program`, `2-plan`, `3-build`, `4-present`. A pipeline whose `pipeline.json`
says `"phase": "design"` is a Plan pipeline.

Files that must stay private (scratch, caches, licensed sources) are never uploaded. They stay on the worker's
machine: the pipeline's local `projects/<SUB>/inputs/` and its work dir (`pipeline-work/…`).

## 3. `project.json` — schema `project/1`

Written by `python tools/project.py new` (Full Pipeline) and updated at every save, handover and resume.

```json
{
  "schema": "project/1",
  "code": "DEMO_VILLA",
  "title": "Demo Villa",
  "created": "2026-10-15T10:00:00+00:00",
  "created_by": "Asha",
  "owner": "Asha",
  "current": "plan",
  "kit": "0.3.2",
  "full_pipeline": "0.1.0",
  "members": { "Asha": "owner", "Ravi": "architect", "Kiran": "modeler" },
  "inputs": [ { "path": "inputs/drawings/GF.pdf", "sha256": "…", "bytes": 482113, "added": "…", "by": "Asha" } ],
  "phases": {
    "program": { "status": "handed_over", "codes": ["DEMO_VILLA"], "handed_over_by": "Asha", "handed_over": "…",
                 "handoff": "Projects/DEMO_VILLA/handoff/program.json", "outputs": ["…"], "answers": ["…"], "canvas_rev": 1 },
    "plan":    { "status": "open", "codes": ["DEMO_VILLA_GF", "DEMO_VILLA_FF"], "started_by": "Ravi", "based_on_rev": 1 },
    "build":   { "status": "waiting", "codes": [] },
    "present": { "status": "waiting", "codes": [] }
  },
  "history": [ { "at": "…", "by": "Asha", "event": "new", "phase": "program" } ]
}
```

| key | meaning |
|---|---|
| `schema` | always `"project/1"` (projects made before 2026-10-15 say `fullproject/1` — same fields) |
| `code`, `title` | §1; a human name |
| `created`, `created_by`, `owner` | ISO-8601 UTC time; who made it; who owns it |
| `current` | the phase now open: `program` \| `plan` \| `build` \| `present` \| `done` |
| `members` | `{name: role}` — roles `owner client architect modeler presenter`; only the phase's roles may act in it |
| `inputs[]` | the files in `inputs/`, with sha256 — listed by whoever adds them (§8 step 3), never by a pipeline. The editor's own uploads are not listed here yet |
| `phases.<p>.status` | `waiting` → `ready` (previous phase handed over) → `open` → `handed_over` |
| `phases.<p>.codes` | the pipeline projects of the phase: `[CODE]`, or one sub-code per floor |
| `phases.<p>.handoff` | the handoff file written when the phase was handed over |
| `phases.<p>.forced`, `excluded` | a handover with open tasks (`--force` + reason), floors left out (`--only` + why) |
| `history[]` | every new / save / resume / handover / share / member change |

`Projects/index.json` (projects-index/1) keeps one line per pipeline project: `{ "<CODE or SUB>": { title, pipelines:
{ <pipeline>: { state, updated, version, next_task, summary } } } }`.

## 4. `run.json` — schema `run/1` (one per pipeline folder)

```json
{
  "schema": "run/1", "run_id": "20261015T130000Z", "project": "DEMO_VILLA_GF",
  "pipeline": { "id": "space-brief", "version": "0.7.7", "kit": "0.3.2" },
  "agent": "Ravi", "started": "2026-10-15T13:00:00Z", "finished": "2026-10-15T13:20:00Z", "status": "done",
  "inputs": [ { "id": "plan", "key": "Projects/DEMO_VILLA/1-program/program/output/plan_trace.json", "sha256": "…" } ],
  "library": [ { "path": "library/Pipelines/_kit/", "version": "0.3.2", "source": "vendored" } ],
  "outputs": [ { "id": "roombrief", "key": "Projects/DEMO_VILLA/2-plan/space-brief/DEMO_VILLA_GF/output/roombrief.json", "sha256": "…", "bytes": 1234 } ],
  "tasks": [ { "task_id": "S1_INTAKE", "status": "done" } ]
}
```

A rerun first copies the previous `run.json` to `archive/<its run_id>/…`. A file whose sha256 already matches in R2
is not uploaded again.

## 5. Handoff — `handoff/<phase>.json` (schema `handoff/1`)

```json
{ "schema": "handoff/1", "from": "program", "to": "plan", "by": "Asha", "at": "2026-10-15T12:00:00+00:00",
  "codes": ["DEMO_VILLA"],
  "files": [ { "path": "Projects/DEMO_VILLA/1-program/program/output/plan_trace.json", "sha256": "…", "role": "plan_trace", "code": "DEMO_VILLA" } ],
  "notes": "GF only; FF to follow" }
```

The next phase reads the previous phase's `output/` (the files the handoff lists). It never reads another
pipeline's `steps/`.

## 6. Who writes where

| Writer | Writes to |
|---|---|
| A pipeline's publish (`run_task.py --publish`, `project.py handover`) | `<n-phase>/<pipeline>/[<SUB>/]output/`, `run.json`, `REPORT.md` |
| `project.py save` / `handover` | `…/<pipeline>/[<SUB>/]state.json`, `answers/`, `handoff/<phase>.json`, `shared/`, `project.json`, `Projects/index.json` |
| `project.py share <file>` | `inputs/shared/<phase>/<person>/` |
| Build `tools/publish.mjs` | `3-build/build-from-deck/output/` (canvas, images/, drawings/) |
| Editor: pipeline tab (Space Brief, connector-made apps) | `<n-phase>/<pipeline>/run.json`, `state.json`, `storage.json`, `steps/app/` |
| Editor: space reference image upload | `inputs/images/references/` |
| Editor: walkthrough video (report, Present upload) | `media/video/` |
| Editor: Library tree upload | the folder the user picked |
| Viewer / connector sessions | `viewer/<session>/` |
| `tools/pipeline-app/publish.mjs <CODE>` | `<n-phase>/<pipeline>/steps/app/` |

The project the editor writes to is the one open in the Project panel; with none open, `Projects/_unassigned/`.

## 7. Rules

1. **`inputs/` is read-only for pipelines.** A pipeline that needs a converted copy writes it under its own `steps/`.
2. **A pipeline writes only inside its own `<n-phase>/<pipeline>/` folder**, plus `shared/` (through a canvas
   revision), `handoff/` (at handover) and `media/` for client-facing results.
3. **Phases connect only through `output/` and `handoff/`.** A phase is handed over once its handoff file exists, and
   `project.json` is updated in the same step.
4. **One current run per pipeline.** The previous `run.json` moves to `archive/`.
5. **Every file the project records carries a sha256**: `project.json` inputs, `run.json` inputs and outputs, handoffs.
6. **Canvases refer to images by their `Projects/<CODE>/…` URL**, never by a `library/` URL or a data URL.
7. **Nothing is deleted without the user.**

## 8. Creating a project — steps

1. Choose `<CODE>`; check it is not already in `Projects/index.json`.
2. `python tools/project.py new <CODE> --title "…" --by <you>` (in `public/full-pipeline`). It writes
   `Projects/<CODE>/project.json` (Program `open`, the rest `waiting`; you are the owner) and sets up Program locally.
3. Upload the client's files to `inputs/<kind>/` and list each in `project.json.inputs[]` with its sha256.
4. Add members: `project.py member <CODE> add <name> <role> --by <owner>`.
5. Run the Program pipeline (`python tools/run_task.py <CODE>` in `1-program/`); the user answers its questions.
6. `project.py handover <CODE> --by <you>`: publishes `1-program/program/output/`, writes `handoff/program.json`,
   the first canvas revision in `shared/`, and marks Plan/Design `ready`.
7. The next person runs `project.py resume <CODE> --by <them>` and continues with Plan/Design.

R2 has no real folders: nothing is created up front, and each folder appears when its first file is written.
