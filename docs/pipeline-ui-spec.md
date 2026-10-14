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
- State: `library/Projects/<CODE>/space-brief/app/state.json`, saved by the R2 backend 800 ms after each change.
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
