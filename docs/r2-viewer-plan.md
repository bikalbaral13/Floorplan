# R2 Viewer — plan (proposed, not started)

A single static HTML viewer hosted in R2 that shows any design JSON in three panes —
**JSON · 2D · 3D** — one at a time or all together. No app needed to *view* a design.
Parametric objects are added later through JavaScript object code run inside the viewer.

Status: **Phase 1 built** (2026-10-12) — `tools/viewer/index.html`, published by `node tools/viewer/publish.mjs` to `library/Viewer/v1/index.html`. Phase 2 built — `node tools/viewer/bake.mjs Designs/<name>.json --upload` writes `<name>.view.json` (gzip) next to the design; baked mesh JSON from the app's evaluator rather than GLB. Phase 3 built — the app's evaluator bundled as `library/Viewer/v1/objects.js` (`node tools/viewer/runtime/build.mjs`, 593 KB) runs in a module Worker; selecting an object opens editable params and re-evaluates it live (chair ~2 s, bed ~12 s), preview only. This replaced the planned `spine2js`: the Math Engine is already JS, so bundling it gives engine parity by construction. Per-object JS is only needed if the engine is ever retired.

---

## Goal

- Agents write JSON to R2 → hand back a link → the user sees it. No editor tab, no MCP session.
- One link format: `<r2-public>/viewer/v1/index.html?src=Designs/Villa1.json`
- Does **not** replace the editing app. View + light preview only.

## Non-goals (for now)

- Drawing / editing geometry, questionnaires, MCP live control.
- Python objects running live in the browser (Pyodide stays out).
- Full materials / render quality (that stays in the Blender pipeline).

---

## Phase 1 — Static three-pane viewer (boxes)

**Deliverable:** `R2: viewer/v1/index.html` (one file, three.js from CDN).

| Pane | Content |
|---|---|
| JSON | Collapsible tree of the design; search; click a node → select element |
| 2D | SVG/canvas top view: walls, rooms (+names/areas), doors, windows, object footprints, layer toggles, level switch |
| 3D | three.js: extruded walls, slabs, openings as gaps, objects as size-param boxes (= Render Mode *Basic*), orbit camera |

- Layout toggle: `[JSON] [2D] [3D] [All]`, remembered per viewer.
- Cross-highlight: select in any pane → highlighted in the other two.
- Loads from `?src=` (R2 path or presigned URL); drag-and-drop a local JSON as fallback.
- Upload via `tools/r2.mjs putObject`.

**R2 setup:** public read (or presigned links) on `viewer/` and `Designs/`; CORS GET on the bucket.

**Test:** Villa 1 (improved) + one large plan for load time.
**Done when:** both open by link, three panes agree, large plan stays interactive.

## Phase 2 — Baked geometry fallback

- If an object has a baked GLB (from the Renderer / pyobj pipelines), the 3D pane shows it instead of a box.
- Order per object: **JS → baked GLB → box**. The viewer never fails on an object.

## Phase 3 — Parametric objects in JS (pilot: bed)

1. **Mesh contract** (shared by JS, Python and baked output):
   `{ vertices, faces, materialSlots, planOutline? }` in metres, object-local.
2. **Object JSON** gains a `js` entry (inline or `Objects/<name>.js`) + a code version.
3. **`spine2js`** next to `spine2py` in `packages/pyobject`: Math Engine → JS, with the
   same parity tests (engine vs Python vs JS within tolerance).
4. **Viewer runtime:** object code runs in a Web Worker (no network/DOM) — params in, mesh out.
   Cache by `(object, version, params)`; identical instances share geometry (InstancedMesh).
5. **Param panel:** select an object → sliders/toggles from its param schema → live update
   in 2D and 3D. Preview only, not saved.

**Done when:** the bed renders its real shape, param changes update instantly,
JS output matches engine output in parity tests.

## Phase 4 — Roll-out

- Generate JS for the rest of the object library via `spine2js`; hand-written new objects in JS first.
- Python output stays for Blender; Blender keeps working from Python or baked meshes.
- Optional later: save edited params back to R2 (needs auth → small Cloudflare Worker).

---

## Decisions needed

1. **Access:** public `Designs/` path vs private + presigned links (expiring) vs a small Worker for stable private links.
2. **Scope to start:** Phase 1 only, or Phases 1+2 together.
3. **Object language direction:** JS added as a second generated output (recommended) vs replacing Python.
4. **Hosting:** R2 only, or also publish as a Claude Artifact for sharing.

## Risks

| Risk | Mitigation |
|---|---|
| Running object code from R2 | Worker sandbox; only load from `library/Objects`; versioned |
| 30 MB plans | Boxes + instancing + 2D-only first paint; same LOD idea as the app |
| JSON schema drift vs app | Viewer reads only stable fields; test against the 8 Ramanadhapuram designs |
| JS/Python/engine divergence | One source (Math Engine) + parity tests for all three |

## Rough size

- Phase 1: one HTML file, a few hundred lines — small.
- Phase 2: small.
- Phase 3: medium (spine2js + worker + param panel).
- Phase 4: depends on library size; mostly mechanical once spine2js passes parity.
