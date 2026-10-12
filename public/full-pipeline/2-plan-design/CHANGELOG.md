# space-brief — changelog

## 0.6.0 — 2026-10-12
- **Mountable app.** templates/app/core.js reads an optional `window.__BRIEF_MOUNT__` {root, host, build, base, backend,
  user, onTabs, onSelect}: a host app (the BuilderPluss editor, Import ▸ Pipeline) mounts the role page into a
  ShadowRoot, supplies its own backend (the editor saves to R2) and gets the tab list and element selection through
  callbacks. `window.BRIEF` adds `tab(id)`, `canvasIds(element)` and `selectCanvas(ids)`. Without a mount every page
  behaves as before (standalone, local preview, published).
- **Elements know their canvas ids.** A wall run's origin now lists its segments (`origin.walls`), so every
  plan-derived element maps to canvas segment / space / attachment ids.

## 0.5.0 — 2026-10-11
- **Program → brief hand-off**: tools/from_program.py turns the program pipeline's plan_trace.json into a brief per
  floor (pipeline_kit.interop: walls on centrelines, doors, open connections, open-air rooms), with the program
  project's title, standards set and an `upstream` record. tests/test_from_program.py runs the villa fixture's GF and
  FF through S1 → S6.
- **Shared with the program pipeline**: pipeline_kit 0.2.0 (was 0.1.0); standards/ = byte copies of library/Standards
  DEFAULT + AADITHYAA 1.0.0 (was a subset of DEFAULT), read with pipeline_kit.standards (`extends` merged);
  save / resume on pipeline_kit.state — bundles are `pipeline-project/1` (0.4.0 bundles still restore), one
  Projects/index.json entry per project lists every pipeline. Selftest 37 checks.

## 0.4.0 — 2026-10-11
- **Save and resume across chats.** tools/project_state.py packs the project folder (scope, links, task list, plan,
  briefing sessions — ~30–55 kB) into `Projects/<CODE>/space-brief/state.json` in the BuilderPluss library and keeps a
  registry of every project and its brief link in `Projects/index.json`, written through the connector. Resume unpacks
  it and fetches references and the library catalog back from the published brief (images never travel through the
  connector); restored references keep their ids (`inputs/refs/refs.ids.json`), so reruns republish to the same link.
  S6/S1 accept a saved catalog (`inputs/library.catalog.json`) when there is no mirror. Save points: S3, S7, S8,
  every briefing session. tests/test_project_state.py (10/10) runs the full save → restore → rerun round trip.
- INFRA_RECEPTION saved to the library as the first entry of `Projects/index.json`.

## 0.3.1 — 2026-10-10
- Fix: S6_APPS crashed on every non-fixture project (a fixture-only `import shutil` shadowed the module). Found by a
  step-by-step chat simulation on a fresh project. New tests/test_fresh_project.py runs a new, non-fixture project
  S1 → S6 in a temp copy as part of selftest (33 checks).

## 0.3.0 — 2026-10-10
- **Three sources for an element's content** in the architect app: *Upload* (device files), *Library* (cloud-library
  materials, objects and images — a material fills the spec with name, finish and colour plus a swatch; an object
  links the model, its finish and its default sizes unless the plan fixes the size), and *Generate* (AI image
  requests the briefing agent fulfils). Every picture keeps its source (`refInfo`) and shows it as a badge; AI images
  keep prompt and model. `lib` and `refInfo` are part of the issued snapshot.
- **Briefing agent**: the architect can brief by hand or hand the briefing to an agent — everything at once or as a
  conversation — from the new **Agent** tab (messages with attachments, *Fill as drafts* / *Ask me first*, quick-reply
  questions), a briefing folder, or a chat. agents/BRIEFING_AGENT.md is the agent's doc. tools/brief_agent.py
  (`context`, `compile`, `check`) turns a cited `spacebrief-patch/1` into a `spacebrief-run/1`: drafts only, exact
  undo, write lanes enforced; the app applies runs (live via ArtifactData, or *Load agent run…* offline) with the same
  checks, warns on conflicts, and offers *Undo run*.
- core/library.py builds the catalog (`spacebrief-library/1`) from `inputs/library/` (S6 → site/data/library.json);
  S1 records the mirror. New schemas: briefpatch.v1, spacebriefrun.v1, library.v1. tests/test_brief_agent.py 25/25
  (incl. app ↔ tool parity of refKey and library picks). FIXTURE: a 30-material / 20-object library mirror and a
  one-shot agent session compiled at S6 into the trial copy's *Try the sample run*.
- The "Next steps" checklist is removed from the app. Issue & team and the export carry the new collections.

## 0.2.0 — 2026-10-09
- The brief deck moves into the architect's app: **Generate brief deck** builds a numbered version (v1, v2 …) in the
  browser from the current issue, stores it as a package (frozen snapshot + .pptx + sha256) and lets the architect,
  client and modeler download any version (integrity-checked). templates/app/deck.js replaces core/deck.py.
- Stages S8_COLLECT, S9_FREEZE, S10_DECK, S11_PUBLISH → S8_ARCHIVE (verify sha256, re-judge the frozen data in Python
  for parity, write .pptx / spacebrief / roombrief per version) and S9_PUBLISH. outputs.keep updated.
- FIXTURE inputs now feed only the local preview (data/local.json), never the live store. tests/test_archive.py 6/6.

## 0.1.0 — 2026-10-09
- First version. Eleven stages on pipeline_kit 0.1.0 (vendored): intake, geometry, scope gate, derived views (plan, RCP,
  interior elevations per wall run), schedule seed (spacebrief/1), generated role apps (router + architect / client /
  modeler) with db access rules, publish + seed, collect, freeze gate, detailed deck (.pptx) + roombrief, publish with run/1.
- Trust rules shared by templates/app/core.js and core/collect.py (tests/test_trust.py 20/20). Independent review fixes
  before release: escaped all values read from other people's input, inputs doc never overwritten before it has loaded,
  failed writes resync, typing survives live refreshes, option picks keyed per revision, element ids derived from origin.
- Fixture INFRA_RECEPTION (Marian reception, from the sample deck): 2 spaces, 5 elevations, 18 elements, 22 references;
  FIXTURE inputs exercise approved / pending / stale / changes, a reopened pin, and an ignored non-client approval.
