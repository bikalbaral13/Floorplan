# AGENT.md — the BuilderPluss bucket

Read this first. The R2 bucket has two parts and nothing else matters:

| Prefix | Holds | Rule |
|---|---|---|
| `library/` | **Reusable** things: objects, materials, pipelines | Never put one project's files here |
| `Projects/` | **Everything one project uploads or produces** | Layout: `Projects/project_creation.md` |

(`relay/` is the connector's own scratch queue — ignore it.)

Public read: `https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/<key>` (e.g. `…/library/Objects/…`, `…/Projects/<CODE>/…`).
Source of this file: `docs/library/AGENT.md` in the Floorplan repo (edit there, then re-upload).

---

## 1. How to work

0. **Open the live editor:** `session { op: "open" }` → give the user the link. It is what they see; there is no R2
   viewer any more (the `viewer`, `skills` and `workflow` tool groups are retired and hidden).
1. **Find the project.** `Projects/index.json` lists every project; `Projects/<CODE>/project.json` says which phase it
   is in and who is working on it. A new project: follow `Projects/project_creation.md` §7.
2. **Find the pipeline** for the phase in `library/Pipelines/index.json` (by `phase` and `path` — never a hard-coded
   folder). Read its `AGENTS.md` and `pipeline.json`, then run it.
3. **Write only where the layout says** (§3). Inputs the user gives go to `Projects/<CODE>/inputs/`; what a pipeline
   makes goes to its own folder `Projects/<CODE>/<n-phase>/<pipeline>/`.
4. **Ask the user, never yourself.** Questionnaires and approvals are answered by the user.
5. Long connector calls may return `{ pending: true, ticket }` → call `await_result` with the ticket.

Without the connector (a local agent with R2 keys): same files, same order — read and write with `tools/r2.mjs`.

---

## 2. `library/` — what is where

| Folder | What | Read first |
|---|---|---|
| `Objects/` | Parametric objects (six-node Math Engine spine), one folder per discipline. Placed on a canvas as `attachments` on nodes / segments / spaces | `Objects/README.md` |
| `Materials/` | `material/1` materials: Blender procedural + `pbr` + `surface` + `plan2d` + `dxf`, by category. Objects point at one through `params.materialPath` | `Materials/README.md` |
| `Pipelines/` | Runnable pipelines by phase: `Program/`, `Plan/`, `Build/`, `Present/` (`<id>-pipeline/` each, with `release.json`); `_kit/` = pipeline_kit; `apps/` + `apps.json` = the UIs the editor opens as tabs | `Pipelines/README.md`, `Pipelines/index.json` |
| `index.json` | What is in the library: per folder → categories, file counts, bytes (`tools/library-index.mjs`) | |
| `_versions/`, `_audit/` | Kept by the save path: old copies, save records | Do not write by hand |

The evaluator for objects is built into the editor (`packages/engine` in the repo); objects carry their graph, not
the engine.

---

## 3. `Projects/<CODE>/` — the project layout (short form)

```
project.json                       project/1: phases, members, history
inputs/<drawings|decks|images|designs|models|shared>/   what the user gives — pipelines only read it
1-program/  2-plan/  3-build/  4-present/
  <pipeline>/[<SUB>/]              run.json · state.json · steps/ · output/ · answers/   (SUB = one floor, e.g. CODE_GF)
handoff/<phase>.json               what a finished phase hands the next one (files + sha256)
shared/canvas.json                 the ONE project canvas; shared/revisions/, shared/index.json, shared/rooms/
media/<renders|video|drawings>/    client-facing results
viewer/<session>/                  viewer / app sessions
archive/<run_id>/                  superseded run.json files
```

Full rules, schemas and the creation steps: `Projects/project_creation.md`. Paths are built in one place —
`pipeline_kit/projpaths.py` (pipelines) and `src/floorplan/projectPaths.ts` (editor) — so they never drift.

---

## 4. Rules that save hours

- **Coordinates:** plan x east, **y south (down the page)**, z up. Canvas coordinates are pixels;
  `settings.pixelsPerMeter` (usually 100) converts. Object params are metres.
- **renderMode:** objects saved as `"Nothing"` produce no geometry; `"Basic"` is a size box; `"Full"` evaluates.
- **Images in a canvas** reference a `Projects/<CODE>/inputs/…` (or `media/…`) URL — never a data URL, never `library/`.
- **Never** put keys or `.env` in the bucket — it is publicly readable.
- **Big files** (canvases > a few MB): pass paths, not contents, through tool calls.
- **Nothing is deleted without the user.** A rerun moves the previous `run.json` to `archive/`.

---

## 5. From "create a project" to a finished pipeline (connector only)

The user talks to you in claude.ai; everything they SEE and DO happens in the live editor link. You never answer
their questions and never approve a step yourself. Nothing here needs the code repo or a machine: script stages run
in the cloud (§7). Build from Deck 0.6 has three stages; the details of each are in the pipeline's `AGENTS.md`
(`library/Pipelines/Build/build-from-deck-pipeline/`) and the skills it names (`library/Skills/<Name>/`).

| Step | You call | The user |
|---|---|---|
| 1. Name it | `chat.ask` (or plain chat) for the **code** (A–Z 0–9 _) and **title** | answers |
| 2. Create | `project { op: "create", code, title, phase: "build" }` | — |
| 3. Open the link | `session { op: "open" }` → give the link; `pipeline { op: "run", pipeline: "build-from-deck", code }` | opens it; the Build tabs appear |
| 4. Upload | the **S1 Read** tab takes a PPTX, PDF or a moodboard IMAGE (saved to `inputs/decks/`). No editor? `project { op: "upload_link", code }` | uploads |
| 5. Read the deck | `project { op: "job", code, pipeline: "build-from-deck", stage: "S1_INTAKE", args: { deck: "inputs/decks/<file>" } }` (or they press **Run**); poll `project.jobs` until `done` | — |
| 5b. Image deck only | `deck.json` says `needs_panels`: mark the panels (Deck Reader `read-an-image-deck.md`) from `steps/S1_INTAKE/pages/page-01.png` → `library.write steps/S1_INTAKE/panels.json`; then `project.job S1_PANELS` | — |
| 6. Questions | the user picks the floorplan + room in the S1 tab; `pipeline.events { wait: true }`; read `pipeline.state { keys: ["answers"] }` | answers |
| 7. Draft + curate | `project.job S1_DRAFT { project, room }` → read `steps/S2_BRIEF/roombrief.draft.json` + the crops → write `steps/S2_BRIEF/roombrief.curated.json` (Deck Reader `curate-the-brief.md`) → `project.job S1_FINALIZE` | approves **S1 Read** |
| 8. Design live | S2: on the live canvas, five sub-steps (overlay/scale/north → walls → library objects → materials → lighting + additions), one canvas each at `steps/S2_PLAN/<n>-*.canvas.json` (`design.load` / `design.edit`); Floorplan Tracer skill `trace-live-in-build.md`. Wait for each sub-step answer (`s2/scale` … `s2/more`) with `pipeline.events { wait: true }` | answers each, approves **S2 Design** |
| 9. 3D | S3 runs in the editor: the user clicks **Export 3D** (→ `output/<CODE>.glb` + snapshots); no runner, no Blender | exports, approves **S3 3D** |
| 10. Close | `pipeline.advance` after each approval; `project.status` to report | — |

A job of stage Sn fails until the user approved S(n-1) in the step bar. `pending: true` → `await_result`.

---

## 6. When something fails — find the cause without the repo

1. **`session { op: "doctor" }` first.** It checks R2, the bucket's CORS (can a browser upload straight to R2), whether
   a machine runner is online, the editor's own recent errors (refused uploads, missing token, crashes) and the versions, and
   says what to fix. Most failures are setup, fixed without code.
2. **Big files:** the editor uploads any size straight to R2 (multipart above 64 MB) once the bucket's CORS rule is in
   place (Cloudflare ▸ R2 ▸ bucket ▸ Settings ▸ CORS; rule in the repo's `docs/r2-cors.json`). For a user without the
   editor, or until CORS is set: `project { op: "upload_link", code, kind: "decks" }` → a link they open to upload.
3. **Change behaviour from R2:** `library/Config/app.json` (read by the editor at start-up; pipeline UIs get it as
   `window.pipeline.host.config`), the pipeline's app files (`pipelines.update` → preview → `release` after the user
   approves), its `runner.json` and docs.
4. **Only when the editor's CODE must change:** `app { op: "request", title, problem, evidence, proposal }` writes it to
   `library/Requests/` for the developer; `app.requests` lists the open ones. Do not try to work around app bugs.

A pipeline UI checks `window.pipeline.host.capabilities` before using a call — host v1: db, upload-any-size,
upload-progress, read, list, write, delete, url, job, cancel-job, open-canvas, notify, emit, tabs, downloads.

## 7. Where script stages run

**The cloud runner (default).** `project.job` and the app's **Run** button queue `jobs/<STAGE>.json` and start the
cloud runner in the editor's own deployment (`/__run`). It fetches the pipeline's current release from R2
(`release.json` pins every file's sha256; only the skill the stage uses is downloaded), checks the release is
approved, checks the stage gate, runs the Python, writes the outputs and `stages/<Sn>/progress.json`. A job is
usually `running` within seconds; a cold start takes ~30 s more. Limits: Python only, the packages the deployment
ships, 300 s per step.

**Approval.** Each release is approved by its publisher when it is published (`library/Pipelines/approvals/<id>.json`,
signed with a key only the publisher and the deployment hold). A job failing "not approved for the cloud runner"
means a release was published without it: tell the user to ask the publisher. You cannot approve, and must not try.

**The machine runner (heavy stages).** A stage marked `"host": "runner"` in `runner.json` (Blender, GPU, long renders)
waits for `node tools/runner/worker.mjs` on a machine with the repo; that machine approves releases itself
(`worker.mjs approve <pipeline>`). Build from Deck 0.6 has no such stage.
