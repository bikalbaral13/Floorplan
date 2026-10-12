# AGENT.md — the BuilderPluss library

Read this first. `library/` in R2 is a complete, self-contained workspace: the data, the playbooks (skills),
the engine that computes geometry, and the viewer that shows results. **No editor app is needed.**

Public read: `https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library/<path>`
Source of this file: `docs/library/AGENT.md` in the Floorplan repo (edit there, then re-upload).

---

## 1. How to work (viewer-first, file-first)

1. **Open the viewer.** Connector: `viewer { op: "open", src? }` → give the user the link. The viewer
   (`Viewer/v1/index.html`) shows any design as **JSON · 2D · 3D**.
2. **Pick a skill** for anything beyond one small edit: `skills { op: "list" }` → `skills { op: "read" }`,
   then follow it. Skills live in `Skills/<name>/*.md`.
3. **Work on files, not on a canvas.** Build or change the design JSON as a whole; save it once
   (`design { op: "load", path, design }`, or straight to R2 if you have local keys via `tools/r2.mjs`).
4. **Show it:** `viewer { op: "show", session, src }`. **Check it:** `viewer { op: "snapshot", session }`.
5. **Ask the user, never yourself:** `viewer { op: "form", … }`, then poll `viewer { op: "events" }`
   for their answers (and for what they clicked).
6. Long calls may return `{ pending: true, ticket }` → call `await_result` with the ticket.

Without the connector (local agent with R2 keys): same files, same order — write with `tools/r2.mjs`,
show with a viewer link `Viewer/v1/index.html?src=<path>`.

---

## 2. What is where

| Folder | What | Notes |
|---|---|---|
| `Designs/` | Design JSONs (schemaVersion 2: `levels[]` of nodes/segments/spaces) | `<name>.view.json` next to one = baked object shapes for the viewer |
| `Master Plans/` | Site plans; `*_grouped.json` = schemaVersion 3 (`groups[]`, one canvas per plot) | Viewer reads both |
| `Objects/` | Parametric objects (six-node Math Engine spine), by discipline | Placed as `attachments` on nodes/segments/spaces |
| `Materials/` | material/1: procedural + `pbr.baseColor` + plan2d + dxf | Referenced by `params.materialPath` |
| `Moodboards/` | moodboard/1 picks per room | Plan key `moodboards` |
| `Skills/` | Playbooks (md + scripts): Tracer, Improver, Renderer, Object/Material/Moodboard/Tool Creator, … | `Skills/index.json` |
| `Pipelines/` | Runnable pipelines + `_kit` (shared code), e.g. `full-pipeline` | `Pipelines/README.md`, `index.json` |
| `Workflows/` | Saved flows, run by path (`workflow { op: "run", path }`) | |
| `Tools/` | Six-node tools (LIVE / COMMIT rows) | Tools never attach; objects do |
| `Engine/` | **The engine**: `Engine/<ver>/engine.js` (evaluate + geometry), `latest.json` | Immutable versions, sha256 in `manifest.json` |
| `Viewer/` | **The viewer**: `Viewer/v1/index.html`, `designs.json` (design list) | Open with `?src=` or `?session=&api=` |
| `Schemas/`, `Standards/`, `Rules/`, `Fixtures/` | Shared definitions, standards, rule sets, test fixtures | |
| `Images/`, `HDRI/`, `Glbs/`, `Video/` | Underlays, environment maps, loose models, media | Underlays reference `Images/` URLs, never data URLs |
| `Families/` | Shared mesh families (planned, see docs/library-families.md) | |
| `Projects/` | Project folders handed person → person | `Projects/index.json` |
| `index.json` | Machine index of agents, designs, objects, skills, tools, workflows | |
| `_versions/`, `_audit/` | Kept by the save path: old copies and save records | Do not write by hand |

---

## 3. Rules that save hours

- **Coordinates:** plan x east, **y south (down the page)**, z up. Design coordinates are pixels;
  `settings.pixelsPerMeter` (usually 100) converts. Object params are metres.
- **renderMode:** objects saved as `"Nothing"` produce no geometry — bake with `"Full"` (the viewer bake does).
- **Bake before showing real shapes:** `node tools/viewer/bake.mjs Designs/<name>.json --upload` writes
  `<name>.view.json` (gzip). Without it the viewer shows boxes.
- **Engine changes = new version:** commit, then `node tools/engine/publish.mjs <x.y.z>`. Never overwrite a
  published version. A design may pin `settings.engineVersion`.
- **Never** put keys or `.env` in the library — the bucket is publicly readable.
- **Big files** (designs > a few MB): pass paths, not contents, through tool calls.
- **Questionnaires are answered by the user**, never filled in by the agent.

---

## 4. Viewer quick reference

`Viewer/v1/index.html`
- `?src=Designs/X.json` — open a design (or a master plan); `&view=json|d2|d3|all`
- `?session=<id>&api=<app>/__relay` — follow an agent session (what `viewer.open` returns)
- no parameters — the list of designs (`Viewer/v1/designs.json`; ● = baked)
- Click an object → its parameters; edit one → live re-evaluation with the R2 engine (preview, not saved).
