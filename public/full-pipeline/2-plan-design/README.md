# Space Brief Pipeline (`space-brief` 0.5.0, phase `design`)

Replaces the instruction deck an architect hand-builds for a 3D modeler and a client. Give it the floor plan and the
reference images; it generates **the architect's app** with the views already drawn. The architect adds the design
inputs there — uploading, picking from the cloud library, generating with AI, or handing the briefing to an agent —
shares the client's and the modeler's pages, and clicks **Generate brief deck** whenever a numbered,
versioned deck is needed. The deck is an output of the app, not the working medium.

```
plan.canvas.json + refs ─▶ S1 intake · S2 geometry · S3 scope · S4 views · S5 schedule · S6 apps · S7 publish
                                                                                              │
              ┌──────────────────────────── one published brief ──────────────────────────────┘
              ▼
   architect.html  derived plan / RCP / elevations · spec, refs, options · Issue I1, I2 … · team · review
        │ elements from: Upload · Cloud library · Generate (AI)   ◀── briefing agent: one-shot or conversation → run (drafts, undo)
        │ shares ─▶ client.html   decide on issued revisions · comment on renders · download decks
        │ shares ─▶ modeler.html  punch list · mark fixed · issued spec · download decks
        └ Generate brief deck ─▶ v1, v2 … (frozen snapshot + .pptx + sha256, stored in the brief)
                                                                                              │
                                                    S8 archive (verify, parity) · S9 publish ◀┘  → Projects/<CODE>/brief/decks/
```

## Folder structure
```
space-brief-pipeline/
├─ PIPELINE_ROOT            marker the kit uses to find the root
├─ pipeline.json            pipeline/1 contract: inputs, library pins, outputs.keep → Projects/{CODE}/
├─ AGENTS.md                rules for the agent (read first)          VERSION · CHANGELOG.md
├─ agents/BRIEFING_AGENT.md the briefing agent's doc (one-shot / conversation, sources, patch ops, rules)
├─ _vendor/pipeline_kit/    pipeline_kit 0.2.0, vendored (KIT.json holds the hashes) — shared with the program pipeline
├─ core/                    the pipeline's own code, pure functions
│  ├─ geometry.py           canvas.v1 → geo.json (metres): walls, openings, spaces, objects, wall RUNS + viewing frames
│  ├─ draw.py               one drawing → SVG (apps) + PNG (deck)
│  ├─ views.py              plan, RCP, unfolded interior elevations; metre → sheet transforms
│  ├─ brief.py              element schedule (spacebrief/1) + references
│  ├─ apps.py               builds the 4 pages, local preview data, db seed batches, publish.json (with access rules)
│  ├─ library.py            cloud-library catalog (spacebrief-library/1) from inputs/library/
│  ├─ collect.py            the trust rules in Python (same as the apps; used for the parity check)
│  ├─ archive.py            decodes deck packages, checks sha256 + parity, writes spacebrief / roombrief
│  └─ ctx.py                stage context, schema validation
├─ stages/S1_INTAKE … S9_PUBLISH/    stage.json · run.py · prompt.md (agent stages)
├─ templates/app/           base.css · core.js · deck.js (in-browser deck builder) · architect.js · client.js · modeler.js · page.html · router.html
├─ schemas/                 spacebrief.v1 (master, to promote) · briefpatch.v1 · spacebriefrun.v1 · library.v1 · library/ (canvas, run, pipeline)
├─ standards/               DEFAULT · AADITHYAA = byte copies of library/Standards 1.0.0 (SOURCE.json) — shared with the program pipeline
├─ tools/                   run_task.py · new_project.py · from_program.py · selftest.py · summary_to_canvas.py · brief_agent.py · project_state.py
├─ tests/                   test_kit_vendored.py · test_trust.py · test_geometry.py · test_archive.py · test_brief_agent.py · test_fresh_project.py · test_project_state.py · test_from_program.py (+ fixtures/program)
└─ projects/<CODE>/         project.json · TASKS.csv · REPORT.md · inputs/{plan, refs, library} · scope.json · apps.json · decks.json · run.json
                            briefing/<session>/ (the architect's input to the agent, patch.json, run.json)
                            (fixture: projects/INFRA_RECEPTION — the Marian reception from the sample deck)
work dir (outside public/):  geo*.json · views/ · brief.json · refs/ · apps/{site,dbseed,publish.json} · archive/ · decks/ · publish/
```

## Inputs: only the drawing and the references
* **Plan** — `canvas.v1` (the editor's Export JSON, or the tracer's hand-off), **or the program pipeline's
  `plan_trace.json`**: `python tools/from_program.py <plan_trace.json> --level GF` builds the canvas (walls on
  centrelines at the program's wall thickness, doors in their walls, named open connections as openings, no walls on
  the free sides of porches and balconies), takes the program project's title and standards set, records `upstream`
  (code, level, sha256, typology, option) and creates the brief `<CODE>_<LEVEL>`. Spaces must be closed. A raster or PDF
  goes through the Floorplan Tracer pipeline first. Without R2 keys, `tools/summary_to_canvas.py` rebuilds a canvas from
  the connector's `design get` summary (`--bare` strips deck-derived spec, so the fixture starts from the drawing alone).
* **References** — any images in `inputs/refs/`. `refs.csv` (optional) gives `title`, `url`, `tags` and `for`:
  `space:<label>/floor|ceiling`, `run:<letter>`, `object:<kind>`, `door:<words>`. Untagged images land in the
  architect's reference tray in the app.

* **Library mirror** (optional) — `inputs/library/Materials|Objects|Images/…`, the cloud-library items the Library
  picker offers (R2 sync or the connector; agents/BRIEFING_AGENT.md §7). Not spec input: nothing is applied until the
  architect (or the agent, on their instruction) picks an item.

## Element sources
| | Architect in the app | Briefing agent | Recorded |
|---|---|---|---|
| Upload | inspector → Upload (device files, several at once) | `ref` op | `refInfo.source=upload` |
| Cloud library | inspector → Library: *Use as specification*, *Add as client option*, *Use for <element>* (+ its finish) | `library` op | `lib.material` / `lib.object`, swatch with `source=library` |
| AI | inspector → Generate: prompt (prefilled from the spec), kind, how many → request | generates, `fulfil` op | `source=ai` + prompt + model |

A library object adds its default sizes only when the plan has not fixed the element's size. Badges show the source
on every picture, for the client too once issued.

## Briefing: yourself or the agent
The architect can fill the elements by hand, or hand the briefing over in the **Agent** tab — *everything at once*
(notes, sketches, photos, PDFs, voice notes, links) or *as a conversation* (one question at a time, quick replies);
*Ask me first* makes the agent propose before changing. The agent follows **agents/BRIEFING_AGENT.md**: it itemises the
input, writes a cited `spacebrief-patch/1`, and `tools/brief_agent.py compile` turns it into a `spacebrief-run/1`:
drafts only (issued revisions untouched), writes limited to elements / requests / agent thread, an exact undo, and the
elements it read (the app warns if the architect changed one since). The run arrives as a card with *Show changes* and
*Undo run*; the inspector marks agent-filled elements until they are issued. Offline: *Download for the agent* →
agent → *Load agent run…*. The fixture's trial copy has *Try the sample run* (a one-shot brief with a photo, a sketch
and a voice note → 14 elements, a new pendant, 2 AI images requested, 1 question).

## Derived views
Wall **runs** are maximal collinear chains of wall + opening segments; each run that faces a scoped space becomes one
unfolded interior elevation, seen from inside, lettered clockwise (A, B, …), all at one scale. Openings come from their
params (door head, sill/lintel, panes), furniture within 2.2 m is projected with its height, levels (FFL, FC, partition
head, soffit) come from scope.json. Levels the plan does not state come from library/Standards and are tagged.

## Permissions and versions (enforced, not advisory)
| Layer | Rule |
|---|---|
| Server (db rules in publish.json) | `brief/meta`, `elements`, `renders`, `pins`, `roster`, `issues`: **editors only**. `inputs/<uid>`: **only that person**. Everyone shared can read. |
| Sharing | client and modeler as **Contributor**; architects as **Editor**; never a public link (assets make it organisation-internal) |
| Roles | set by the architect in *Issue & team* (`roster/<uid>`); the owner is always architect; a typed name/email is never trusted |
| Trust | a decision counts only from a rostered **client**, a fix only from a rostered **modeler**; the rest is listed as ignored |
| Versions | architect edits are drafts; **Issue** snapshots changed elements (`issued`, rev+1) and logs `issues/<n>`; client and modeler see only issued revs; a decision binds to its rev and turns **stale** when a newer rev is issued; a fix older than the pin's reopen does not count |
| Build ↔ data | pages carry the run id; meta carries the run id; a mismatch shows a "republish" banner; S7 refuses a stale site hash |

Proven on the published fixture: at Contributor level, reading `elements` works; writing `elements/…` and
`inputs/<someone else>` is refused.

## The brief deck (Generate brief deck)
* Built **in the architect's browser** (PptxGenJS 3.12.0 from the CDN allowlist) from a frozen snapshot of the current
  **issue**: issued revisions, the client's decision on each (judged by the trust rules), the review rounds with their
  numbered comments, open items, and the sheets drawn with every element. Unissued drafts are listed as excluded.
* Numbered **v1, v2 …** per brief; filename `<CODE>_brief_I<issue>_v<k>.pptx`; every slide carries project, space,
  issue, version and sheet number; v2+ opens with *What changed since v(k−1)*.
* Stored in the brief as one package (snapshot + .pptx + sha256) — the brief's file store does not take .pptx, so the
  bytes travel base64 inside JSON. Anyone on the brief downloads any version; the app re-checks the sha256 first.
* The architect's click is the sign-off: `decks/<k>` records who, when, the note, the counts and the hash.

## Outputs (pipeline.json → outputs.keep, published to `Projects/{CODE}/`)
`brief/views/*.svg|png` · `brief/scope.json` · `brief/apps.json` (the live brief's link) · `brief/decks.json` (every
version) · `brief/decks/<CODE>_brief_I<n>_v<k>.pptx` + `.spacebrief.json` (spacebrief/1 as frozen in that version) ·
`brief/roombrief.json` (latest version, for build-from-deck) · `runs/space-brief/<run_id>/run.json` (run/1) · `REPORT.md`.

## Where a project lives (and where its brief link is stored)
| What | Where |
|---|---|
| The live brief (elements, decisions, comments, decks, agent thread) | the published brief itself — its link |
| The brief link | `projects/<CODE>/apps.json → url` (written at S7); the library registry **`Projects/index.json`** (every project: title, brief link, next task, deck versions, last saved); `Projects/<CODE>/brief/apps.json` after S9; and the publisher's artifact gallery |
| The project folder (scope, links, task list, plan, briefing sessions) | locally `projects/<CODE>/`; saved to the library as **`Projects/<CODE>/space-brief/state.json`** (`tools/project_state.py pack`) |
| References and library catalog for a rerun | restored from the published brief (`project_state.py unpack` → RESTORE.md) |

In a new chat: *"which projects do we have?"* reads the registry; *"continue INFRA_RECEPTION"* restores the folder and
carries on (AGENTS.md → Saving and resuming). tests/test_project_state.py proves a restored project reruns to the
same reference ids, elements and links.

## Known gaps (0.5.0)
* **R2 upload**: S9 stages `Projects/<CODE>/…` locally; set `BP_R2_UPLOAD` (e.g. `node tools/r2.mjs put {src} {key}` in
  the app repo) to upload.
* **roombrief zones are in metres** (`points_m`); build-from-deck's adapter reads `points_px` today — add a metre branch
  there, or convert, before chaining.
* **Renders are uploaded by the architect** (uploading needs the editor level). If the modeler should upload, make them
  an Editor and accept that they could then also edit the spec.
* The elevation sweep is projection-only (no hidden-line removal for furniture behind furniture); curved walls are
  treated as straight segments.
* Not run here: the apps inside claude.ai with real client/modeler accounts, and the deck library loading from the CDN
  (the CDN is unreachable from the build machine; the same library was served locally for the browser test). The
  role pages and deck generation were exercised locally in Chromium with the same code; the store, rules and seed live.
* **Program hand-off**: the program's trace has no windows and no furniture yet, so a brief built from it starts with
  walls, doors and openings only; the program's rooms are drawn as walled unless the trace names them as open.
* **AI images need an image tool connected to the agent's session** (e.g. Krea). Without one, requests stay queued
  and the agent says so. The fixture's sample run queues its two images; none were generated for it.
* **The Agent tab is a mailbox, not a live chat**: the agent acts when someone asks it to (a chat, a scheduled task).
  A scheduled task that checks `agent/*` and `requests/*` would make it feel live.
* Library images: the fixture mirror has materials and objects only; library photos appear once the mirror holds
  `Images/…` files. Agent swatches (Pillow) are simpler than the app's canvas swatches.
* Deck packages are capped at 20 MB (about 14 MB of .pptx); very image-heavy briefs need smaller references.
