# Pipeline UI spec — pilot: space-brief

Status: pilot implemented (2026-10-14), full-tab dock. As built: steps in `tools/pipeline-app/pipelines/space-brief.json`
(schedule→board, review, issue, deck; publish with `publish.mjs --manifests`); the step bar + Approve/Request changes are
rendered by the host (PipelineTabs.tsx), so core.js is unchanged; MCP group `pipeline` (run, status, state, patch,
events, advance). Sections 1–3 below are the original draft.

## Goal

When Claude runs a pipeline from a prompt, the pipeline's own UI opens in the editor and stays live while the
pipeline runs. Claude and the user work on the same state: Claude fills it in, the user edits/approves in the UI,
and the pipeline only moves past a checkpoint when the user approves it. No more "run, then an artifact appears".

## What exists today (PipelineTabs.tsx)

- `library/Pipelines/apps.json` lists apps; templates (page.html, core.js, …) load from R2.
- The app mounts in a ShadowRoot via `window.__BRIEF_MOUNT__` (space-brief >= 0.6.0).
- State: `Projects/<CODE>/space-brief/app/state.json` (bucket root, outside the Library since 2026-10-15), saved by the R2 backend 800 ms after each change.
- Host → app: `BRIEF.tab(id)`, `BRIEF.selectCanvas(ids)`. App → host: `onTabs`, `onSelect`.
- Gaps: opened by hand (Import ▸ Pipeline), Claude can't drive it, the user's actions don't reach Claude, and the
  pipeline has no steps or checkpoints.

## 1. Manifest — `library/Pipelines/space-brief/pipeline.json`

```json
{
  "id": "space-brief",
  "version": "0.7.0",
  "phase": "program",
  "ui": { "app": "space-brief", "autoOpen": true, "dock": "tab" },
  "state": "Projects/{CODE}/space-brief/app/state.json",
  "steps": [
    { "id": "intake",   "title": "Project intake",      "panel": "meta",     "by": "user",   "gate": true  },
    { "id": "rooms",    "title": "Room schedule",       "panel": "rooms",    "by": "claude", "gate": true  },
    { "id": "adjacency","title": "Adjacencies",         "panel": "adjacency","by": "claude", "gate": false },
    { "id": "refs",     "title": "Reference images",    "panel": "refs",     "by": "both",   "gate": true  },
    { "id": "publish",  "title": "Brief → roombrief/1", "panel": "deck",     "by": "claude", "gate": true  }
  ],
  "outputs": ["Projects/{CODE}/space-brief/roombrief.json"]
}
```

- `ui.app` points at the existing `apps.json` entry, so templates aren't duplicated.
- `panel` = an existing BRIEF tab id. `by`: who fills the step in. `gate`: wait for user approval.
- Panel ids and steps are placeholders until checked against core.js COLS.

## 2. Run lifecycle

```
Claude: workflow.run { pipeline: "space-brief", code }
  → host opens/focuses the pipeline tab (autoOpen)    ← no manual Import
  → run record: Projects/<CODE>/space-brief/run.json  { step, status, history[] }
for each step:
  host: BRIEF.step(id)  → UI shows that panel + a step banner
  "claude" steps: Claude writes state via pipeline.patch → UI refreshes live
  "user" steps:   UI collects input; Claude waits
  gate: UI shows Approve / Request changes → event to Claude
  approved → next step; changes → Claude revises the same step
publish: outputs written, run.status = "done"
```

`run.json` is the single source of truth for progress, so a run survives a reload, and the user or Claude can
pick it up later.

## 3. Bridge API

App side (added to core.js, exposed on `window.BRIEF`):

| Call | Direction | Purpose |
|---|---|---|
| `step(id, info)` | host → app | show a step's panel and banner (title, by, gate) |
| `applyPatch(patch)` | host → app | merge Claude's change into `S`, then `refresh()` |
| `emit(type, data)` | app → host | user event: `approve`, `reject{note}`, `edit{path}`, `ask{text}` |
| `onStep(cb)` | host → app | optional: the app reacts to a step change |

Host side (PipelineTabs.tsx): forwards `emit` into the editor's chat/event queue (the same path `chat.ask` uses),
and applies incoming patches.

Claude side (new ops in the `workflow` MCP group, which already exists):

- `workflow.run { pipeline, code }` → `{ runId, step }`
- `workflow.patch { runId, patch }`: JSON merge-patch on state.json and a live push to the UI
- `workflow.events { runId, since }`: approvals, rejections and edits from the UI
- `workflow.advance { runId }`: next step; refused while a gate is unapproved

## 4. Rules

- Claude never approves a gate itself (same rule as forms: the user answers).
- Edits by both sides go through state.json. On a conflict the last writer wins per key, and the UI shows a
  "changed by Claude" highlight.
- `workflow.patch` sends a patch, never the whole state (connector local-first: keep tool args small).
- With no editor open, the run still works file-first; gates wait until the UI is opened.

## 5. Pilot work list

1. Write `pipeline.json` for space-brief; confirm the panel ids against core.js.
2. core.js 0.7.0: `step`, `applyPatch`, `emit`; step banner + Approve/Changes buttons.
3. PipelineTabs.tsx: open the tab from a run (not only from the dialog); forward events; apply patches.
4. MCP: `workflow.run/patch/events/advance` and a `run.json` writer.
5. Test: a prompt → the tab opens → Claude fills rooms → the user approves → roombrief.json is written.

## 6. Generalising

Any pipeline can have a UI if it ships an app in `apps.json` and declares `ui` + `steps` in `pipeline.json`. A
pipeline without a UI falls back to `viewer.form` for its gates.

## Open questions

- Where the UI docks: a full tab (default) or a side panel during chat?
- Should "both" steps lock the panel while Claude is writing?
- Should run history be kept for undo?

## Update 2026-10-14 — pipelines 0.7.6 (frame mode)

- R2 `Pipelines/program-pipeline` and `Pipelines/space-brief-pipeline` replaced from builderpluss-pipelines-0.7.6.zip
  (backup of the old copies: `backups/r2-pipelines-2026-10-14/`, git-ignored).
- space-brief 0.7.6 dropped `__BRIEF_MOUNT__`. The editor now runs it in an iframe (`mode: "frame", kind: "brief"`) and
  supplies the `window.claude.use('db' | 'assets' | 'downloads')` hook the app already speaks — the store is saved to the
  same `Projects/<CODE>/space-brief/app/state.json`. No change to the pipeline's code.
- program 0.5.0: `kind: "page"`, the project's typology planner (`typologies/REGISTRY.json`) in an iframe; no shared
  store, so `pipeline_patch/state` refuse — its stages run locally, the step bar carries the approvals.
- Step files moved to `library/Pipelines/apps/<id>/steps.json` (source `tools/pipeline-app/pipelines/`).

## Update 2026-10-14 — pipelines created through the connector, sandboxed UIs

- **Create from the connector.** Tool group `pipelines` (server/pipelinesMcp.mjs, hosted library connector):
  `list`, `create` (pipeline folder in `Pipelines/<Phase>/<id>-pipeline/`, UI as version 0.1.0 in
  `Pipelines/apps/<id>/<version>/` with `steps.json` + `seed.json`, registered in apps.json + index.json),
  `update` (new PREVIEW version = stable + changed files), `release` (user-approved), `rollback`. Version folders are
  never rewritten; only kind "app" pipelines can be updated. Skill: `Skills/Pipeline Creator` (playbook + template).
- **Sandboxed frames.** Every pipeline UI runs in `<iframe sandbox="allow-scripts …">` (no same-origin): no access to
  the editor's DOM, storage or tokens. `src/floorplan/pipelineFrame.ts` injects a shim (window.claude.use,
  window.pipeline, a per-project localStorage) and the editor answers its postMessage calls. Files load from the
  bucket's public URL (a sandboxed frame cannot reach /__r2 on a local dev host).
- **Dev header.** vite.config.ts COEP `require-corp` → `credentialless`: still cross-origin isolated (web-ifc MT), and
  lets the frames load the bucket's files (r2.dev sends no CORP). Production sends no COEP.
- `pipeline.run { channel: "preview" }` opens the preview version; the step bar shows `v<version>` (· preview).
- Test pipeline: `site-checklist` (Program), project TEST01.

## Update 2026-10-14 — pipeline tabs in the right-hand panel

- The canvas (middle) always shows the drawing. A loaded pipeline's tabs sit in the **right-hand panel header beside
  Properties** (space-brief: Properties · Schedule · Issues · Brief deck); the page and the run's step bar render
  inside that panel (34rem wide while a pipeline tab is open). The top bar shows only the loaded pipeline's chip.
  A run step opens the panel on its tab (`onReveal`).
- space-brief **0.7.7**: hosted mode (`build.host = "builderpluss"`) drops its Drawings and Agent tabs (the editor's
  canvas and chat do those) and keeps element clicks on the current tab. Standalone unchanged.
- Pipeline Creator: pages are right-panel tabs — no drawing view, no chat tab, ~540 px wide, tabs declared with
  `window.pipeline.setTabs(...)`. Template updated.
- `publish.mjs --templates` now MERGES apps.json by id (it had overwritten connector-created entries).


## window.pipeline additions (2026-10-15)
- `pipeline.assets.upload(blob, { name, target: "inputs/decks" })` — a user file into `Projects/<CODE>/inputs/<kind>/`
  (kinds: drawings, decks, images, designs, models, moodboards), sent straight to R2 through a pre-signed URL and
  listed in `project.json` `inputs[]`. Without `target` it is the app's own upload (its data folder), as before.
- `pipeline.read(path)`, `pipeline.list(path)`, `pipeline.url(path)` — the project's files, paths relative to
  `Projects/<CODE>/` (`pipeline.dir` = this pipeline's folder, e.g. `3-build/build-from-deck/`).
- `pipeline.job(stage, args)` — queue a runner stage: `<pipeline dir>/jobs/<STAGE>.json` (runner-job/1), picked up by
  `tools/runner/worker.mjs`. Example app: `tools/pipeline-app/apps/build-from-deck/`.

## Host v1 (2026-10-15)
- `pipeline.host` = `{ version: "1.0.0", capabilities: [...], config }` — check a capability before using a call;
  `config` = `library/Config/app.json` with `pipelines.<id>` merged in.
- `assets.upload(blob, { name, target, onProgress(loaded, total) })` — any size, straight to R2 (presigned PUT, multipart
  above 64 MB, 3 parts in flight). A failure rejects with `{ code, message }`, code = cors | token | expired | network | server.
- `write(path, content)`, `del(path)` — one project file (paths relative to `Projects/<CODE>/`; the manifest cannot be deleted).
- `cancelJob(stage)` — a queued runner job → cancelled. `openCanvas(path)` — load a project canvas in the editor.
  `notify(message, level)` — a toast (info | success | warning | error).
- Server routes behind it: `/__r2/upload-plan`, `/upload-complete`, `/upload-abort`, `/upload-done` (lists an inputs/ file
  in project.json), `/log` (the editor's errors → relay/logs/). Upload links (`project.upload_link`) → `/upload.html?g=<grant>`.
