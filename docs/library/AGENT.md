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
their questions and never approve a step yourself.

| Step | You call | The user |
|---|---|---|
| 1. Name it | `chat.ask` (or plain chat) for the **code** (A–Z 0–9 _) and **title** | answers |
| 2. Create | `project { op: "create", code, title, phase }` — `phase: "build"` when they start from a deck | — |
| 3. Offer the pipeline | "Run the Build pipeline?" — wait for yes | yes / no |
| 4. Open the link | `session { op: "open" }` → give the link; `pipeline { op: "run", pipeline: "build-from-deck", code }` | opens it; the Build tabs appear |
| 5. Upload | tell them to use the **Deck** tab (PPTX or PDF; saved to `inputs/decks/`); `pipeline.events { wait: true }` until `deck_uploaded` | uploads |
| 6. S1 Brief: read the deck | `project { op: "job", code, pipeline: "build-from-deck", stage: "S1_INTAKE", args: { deck: "inputs/decks/<file>" } }`, then `project.jobs` until `done` (or they press **Run**) | watches the progress panel |
| 7. S1 questions | point them to the **Brief** tab's questions; `pipeline.events { wait: true }` until `answers`; read them with `pipeline.state { keys: ["answers"] }` | answers |
| 8. S1 draft + curate | `project.job S1_DRAFT { project, room }` (from `questions.json` `room_ids[answers.room]`); read `steps/S2_BRIEF/roombrief.draft.json` + the slide images; write `steps/S2_BRIEF/roombrief.curated.json` (skill **Deck Reader**, `curate-the-brief.md`); `project.job S1_FINALIZE` | approves **S1 Brief** in the step bar |
| 9. S2 Plan | trace the deck's plan page with the **Floorplan Tracer** (its pipeline's tasks and gates, same CODE); `project.job S2_FROM_TRACER`, then `S2_GEOMETRY` | approves the tracer's gates, then **S2 Plan** (geometry_check.png) |
| 10. S3 Objects | `project.job S3_CATALOG`; read `catalog.json`; write `steps/S4_RESOLVE/resolve.json` (skill **Object Resolver**). The **Objects** tab shows every item; the user signs off there (`review` event, `status: "approved"`). Then `project.job S3_CHECK`; if `steps/S4_RESOLVE/review.todo.json` lists items, rebind them and re-queue S3_CHECK. Never sign off for them | signs off, approves **S3 Objects** |
| 11. S4 Fit-out | `project.job S4_PLACE` (skill **Floorplan Improver**, places the resolved items as given); load `output/<CODE>.room.canvas.json` in the editor. Optional IMPROVE: tiles, lighting, trims — never moves a resolved item | approves **S4 Fit-out** |
| 12. S5 3D | `project.job S5_3D` (skill **Floorplan Renderer**) → `output/3d/` (.blend .fbx .glb + snapshots) | approves **S5 3D** |
| 13. Close | `pipeline.advance` after each approval; `project.status` to report | — |

**Gates are enforced by the runner**: a job of stage Sn fails with "waits for the user to approve S(n-1)" until the
user pressed **Approve step** for S(n-1) — and again if S(n-1) was re-run after that approval. Never approve yourself.

**Progress**: the right panel of every stage shows a live bar and log from `stages/<Sn>/progress.json` (the runner
writes it from `@@progress` lines). While YOU do an agent step (curate, trace, resolve, improve), report what you are
doing every few items: `library.write Projects/<CODE>/3-build/build-from-deck/stages/<Sn>/agent-progress.json`
`{ "schema": "agent-progress/1", "step": "CURATE", "pct": 40, "msg": "Typing items 9–16 of 24", "at": "<ISO time>", "done": false }`
(`done: true` at the end). The user is watching it.

Each stage's work is a **skill** in `library/Skills/<Name>/` (skill.json: the steps, who does each, the docs to read).
The pipeline pins each skill's version in its `pipeline.json` `skills`.
Script stages run on **the runner** — `node tools/runner/worker.mjs` on a machine with the repo and Python. A job
`queued` for over a minute means no runner is online: tell the user to start it; do not try to run the stage yourself.

---

## 6. When something fails — find the cause without the repo

1. **`session { op: "doctor" }` first.** It checks R2, the bucket's CORS (can a browser upload straight to R2), whether
   a runner is online, the editor's own recent errors (refused uploads, missing token, crashes) and the versions, and
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

## 7. The runner runs pipelines from R2 — after the user approves them

`tools/runner/worker.mjs` (on the user's machine) finds a pipeline through `library/Pipelines/index.json`, downloads
its current release (`release.json` pins every file's sha256), checks every file and runs the stage from the release's
`runner.json`. So a new or fixed stage is just a publish to R2 — no repo change.

It runs a release ONLY when the user approved that exact release on that machine:
`node tools/runner/worker.mjs approve <pipeline>` (shows the scripts, asks yes/no; approvals live in the user's home
folder, never in R2). Every new publish needs a new approval. A job that fails with "not approved" → tell the user to
approve it, then queue the stage again. You cannot approve, and must not try to.
