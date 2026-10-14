---
name: Create a pipeline with its own UI
description: From a brief, make a NEW pipeline in the R2 library whose UI opens as a tab in the live editor — through the connector alone (pipelines.create / update / release), no app rebuild.
---

# Create a pipeline with its own UI

A pipeline made here is a folder in `Pipelines/<Phase>/<id>-pipeline/` plus a **UI** (an HTML page with its JS and
CSS) and **run steps**. The editor lists it in Import ▸ Pipeline, and `pipeline.run { pipeline: <id>, code }` opens the
UI as a full tab with the step bar (Approve / Request changes) above it. Its data is kept per project in
`Projects/<CODE>/<id>/state.json`.

## Steps

1. **Brief.** Ask the user (chat.ask, or viewer.form): what the pipeline is for, its phase (program, plan, build,
   present), what the user does in it, and which steps need their approval. Never answer for them.
2. **Check it is new.** `pipelines { op: "list" }`. If one fits already, improve it (step 6) instead.
3. **Write the UI from the template.** Read `Skills/Pipeline Creator/template/index.html`, `app.js`, `app.css` and
   adapt them: the panels (`TABS`), the collections, what each panel shows. Keep the rules below.
4. **Write the steps.** One per thing the user approves or Claude fills in:
   `{ id, title, panel, by: "claude" | "user" | "both", gate, hint }` — `panel` is a tab id your page's
   `PIPELINE_UI.tab(id)` shows (or `"app"`).
5. **Create it.** `pipelines { op: "create", id, title, phase, description, files: { "index.html", "app.js",
   "app.css" }, steps, seed? }`. Then open it for the user: `pipeline { op: "run", pipeline: id, code }`, fill the
   `by: "claude"` steps with `pipeline { op: "patch" }`, and wait for their approvals with
   `pipeline { op: "events", wait: true }`.
6. **Change it later.** `pipelines { op: "update", id, files: { changed files only }, note }` makes a PREVIEW
   version; show it with `pipeline { op: "run", …, channel: "preview" }`. Release it with
   `pipelines { op: "release", id }` **only after the user approves**. `op: "rollback"` goes back.

## Rules for the page (it runs in a sandboxed iframe)

- Talk to the editor only through `window.pipeline`:
  - `db.doc("col/id").set(d) / update(d) / delete() / get() / onSnapshot(cb)`, `db.collection("col").onSnapshot(cb)`,
    and `db.doc("brief/meta")` for the pipeline's meta. This is what Claude reads (`pipeline.state`) and changes live
    (`pipeline.patch { patch: { col: { id: doc } } }`).
  - `assets.upload(blob)` → `{ id }` (show it as `/_blob/<id>`), `downloads.save({ filename, data })`,
    `emit(type, data)` → an event Claude receives with `pipeline.events`.
  - `localStorage` works and is kept per project in R2.
- Set `window.PIPELINE_UI = { tab(id) }` so each step can show its panel.
- No access to the editor page, its cookies or tokens; no `window.parent` calls. External scripts only from
  cdnjs / jsdelivr / unpkg, with an exact version. Relative paths load the UI's own files.
- Files: text only (.html .js .css .json .md .svg .txt), under 3.5 MB together per call.
