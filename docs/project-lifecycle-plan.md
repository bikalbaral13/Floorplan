# One Project, Four Phases: plan (for discussion, nothing built yet)

Date: 2026-10-11. Status: proposal for discussion.

## 0. Where we stand today

| Phase | Pipeline(s) in the repo | Takes | Gives |
|---|---|---|---|
| Program | `public/program_pipeline` 0.5.0 (new) | site sketch/survey, brief Q&A (P2), rules Q&A (P3) | `plan_trace.json`, PROGRAM.md, area_statement.csv, qc.md |
| Plan/Design | `floorplan-tracer-pipeline`, `space-brief-pipeline` 0.5.0 (new), Improver / Moodboard / Material skills | canvas.v1 (or `plan_trace` via `from_program.py`), refs, library picks | improved canvas, scope.json, architect/client/modeler pages, brief decks (.pptx + spacebrief.json) |
| Build | `build-from-deck-pipeline` | **a .pptx deck** + a room the user picks | roombrief/1 → canvas, 2D, .blend |
| Present | Floorplan Renderer, `walkthrough-video-pipeline`, mesh pipelines | a .blend (+ script, camera path, audio) | stills, GLB, preview/final mp4 |

So a chain already exists end to end. It just has three seams where a person has to carry a file across by hand:

1. **Program → Plan:** `from_program.py` already does this. It is the cleanest of the three.
2. **Plan → Build:** Build reads a **pptx**, and Space Brief *writes* the pptx along with `spacebrief.json`. So the deck is a lossy middle step: Build re-parses slides to recover data that already existed as JSON. **This is the main seam to fix.**
3. **Build → Present:** the walkthrough needs a .blend, which the Renderer makes from the canvas. It works, but nothing records which canvas revision a video was made from.

Housekeeping found while copying the pipelines in:
- `packages/pipeline-kit` has diverged. Both copies say 0.2.0, but the repo copy has `r2.py` and the zip copy has `interop/semver/standards/state.py`. They need merging into one real 0.3.0.
- Self-tests on Windows: program_pipeline fails at `ZZ_C P2` (IndexError, then a missing `rules.json`). space-brief passes 33/37 (`test_brief_agent`, `test_fresh_project`, `test_project_state`, `test_from_program`). Most likely paths or encoding (the output also shows mojibake: `â€”`). This has to be fixed before anything is built on top.

## 1. The core idea: one project, one source of truth

You suggested one canvas JSON that every phase improves. I agree for **geometry and design**, with one change: **don't put everything inside the canvas.** We already hit 30 MB plans freezing the editor. Briefs, rules, BOQ, decks and videos are not canvas data.

**Recommendation: a project = a manifest + one canvas + sidecar files, all addressed by hash.**

```
Projects/<CODE>/                      ← R2 = SHARED (the only thing other people ever see)
  project.json                        manifest: code, title, typology, standards, phase states,
                                      members+roles, current canvas rev, every output's sha256 + "made from"
  canvas/
    current.json                      THE single source of truth (canvas/2)
    revs/r0007.json …                 immutable revisions; current.json points at one
  program/   plan_trace.json  PROGRAM.md  area_statement.csv  qc.md
  design/    scope.json  spacebrief.json  views/  decks/ (pptx = an export, not an input)
  build/     roombrief/*.json  boq.csv  drawings/*.dxf|pdf  model/<CODE>.blend
  present/   stills/  <CODE>.glb  walkthrough/{shots.json, final.mp4}  report.html
  inbox/<phase>/<user>/               files a user chose to share for a phase (uploads)
  qa/<phase>.json                     questions asked + answers given (who, when) → reproducible runs

work/<CODE>/                          ← LOCAL = PRIVATE (never synced unless you "share" a file)
  inputs/        raw uploads before sharing: sketches, voice notes, client PDFs
  runs/<phase>/  pipeline work dirs (temp from each pipeline.json)
  drafts/        canvas edits not yet committed as a rev
  secrets/       keys, nothing else
```

Rules:
- **Every phase reads `canvas/current.json` and writes a new rev.** It never edits a rev in place. Each rev records `{phase, pipeline@version, by, inputs:[sha…]}`, so "which plan was this video made from?" always has an answer.
- **The canvas carries a `phase` stamp on every element** (`origin: program|design|build`). A later phase can see what it may change and what it must respect. For example, Build must not move Program's walls without raising a finding.
- **Sidecars are referenced from the canvas, not inlined.** Example: a room points at `design/spacebrief.json#room/R3`.
- **Private → public is one explicit action** ("Share"). The default is private. The pipelines already declare `outputs.keep` (→ R2) and `temp` (→ local) in `pipeline.json`, so this is a single rule enforced by pipeline-kit, not something each pipeline invents.

### Alternative considered: everything in one canvas file
It's simpler to explain, but every phase would rewrite one big file, there would be no partial access per role, and videos/decks can't live in JSON anyway. Rejected.

## 2. The four phases as one flow, with people

```
 PROGRAM (client / owner)        PLAN/DESIGN (architect)              BUILD (modeler)               PRESENT (presenter / agent)
 ─────────────────────────       ───────────────────────────          ─────────────────────         ──────────────────────────
 idea + uploads (site photo,     gets r1 canvas + brief               gets design-approved rev      gets build-approved rev
 sketch, wishes)                 answers scope questions              uploads: specs, vendor        picks: stills / walkthrough /
 answers brief + rules Q&A       (form, never agent-answered)         sheets, structure data        report / deck
 agent runs program_pipeline     agent runs tracer? → space-brief     agent runs build pipeline     agent runs renderer →
 P1…P7                           → improver / moodboard / materials   (structure, BOQ, CPM,         walkthrough-video / report
                                 client + modeler pages for review    drawings, .blend)
 ▼ gate: client approves         ▼ gate: architect issues I1          ▼ gate: modeler signs off     ▼ gate: client accepts
 canvas r1 (from plan_trace)     canvas r2…rN + spacebrief            canvas rN+k + build/*         present/*
```

Each **gate** is a row in `project.json` → `phases.<id> = {state: open|in_review|approved, approved_by, rev}`. The next phase can start only from an approved rev. It can start early on a draft, but it must show a "based on unapproved rev" banner.

**Questions are files, not chat.** Every pipeline already asks questions at specific stages (program P2/P3, space-brief S3 scope, tracer scope form). Standardise them as `questions.v1` (id, text, type, options, default, why) and record answers in `qa/<phase>.json`. The app renders the form, a human answers it, and the agent never answers its own form (the existing rule). Re-running a phase with the same answers gives the same output.

### Seam fixes

1. **Program → Plan:** promote `from_program.py` to "create canvas r1". Also carry `area_statement` targets onto the rooms so Design can show "bedroom 2: 11.2 m², target 12".
2. **Plan → Build (the important one):** Build reads `design/spacebrief.json` + `canvas/current.json` directly. The pptx path stays as a *fallback importer* for decks that come from outside. Space Brief already has `archive.py`, which writes spacebrief/roombrief. Make roombrief/1 the shared contract and delete the slide parsing from the main path.
3. **Build → Present:** the Renderer takes `{canvas rev}` and writes `build/model/<CODE>.blend` stamped with that rev. The walkthrough reads only that file. Present outputs record the rev they came from.

## 3. Roles and sharing

| Role | Can see | Can upload to | Can approve |
|---|---|---|---|
| Owner/client | program/, design/ issued revs, present/ | inbox/program, comments everywhere | program gate, final present gate |
| Architect | everything | inbox/design | design gate (issues I1, I2…) |
| Modeler | design/ issued, build/ | inbox/build | build gate |
| Presenter | approved canvas, build/model, present/ | inbox/present | — |

- Implementation: R2 has no ACLs per object. So the shared side goes through **one small API** (the existing Vercel functions) that checks `project.json.members` and hands out signed URLs. Space Brief already has the pattern (`publish.json` with access rules, plus separate client/modeler pages). Generalise that and don't build a second system.
- Private stays private by construction: `work/` is outside `public/` and outside git (memory rule: work_dir outside public/), and it is never in a sync path.

## 4. Codebase as a library, agent as the orchestrator

This is the shift you described. Make it explicit with three layers:

```
LIBRARY (R2 library/, versioned, mostly data + small pure code)
  Pipelines/<id>@<ver>/   pipeline.json · stages/*/stage.json + run.py + prompt.md · core/   ← the pipelines themselves
  Objects/<id>@<ver>.json params + python (see §5)
  Materials/ Standards/ Schemas/ Typologies/ Skills/ Moodboards/
  Kit/pipeline_kit@0.3.0  one shared copy; pipelines pin it (no more vendored drift)

AGENT (Claude Code locally, later a cloud worker)
  reads project.json → knows the phase, the rev, what's pending
  picks the pipeline for that phase → runs stages → stops at every question/approval
  writes outputs per pipeline.json keep/temp → commits a new canvas rev

APP (thin): show · ask · upload · approve · light edit   (§6)
```

- **One project registry:** `Projects/index.json` already exists from program_pipeline's `project_state.py pack`. Make it *the* registry for all four phases rather than one per pipeline.
- **Phase → pipeline mapping** lives in `pipeline.json.phase` (already present in all four), not in app code. `src/floorplan/phases.ts` becomes generated from the library, or just reads it.
- **Promotion:** `packages/LIBRARY_PROMOTION.json` (from the zip) is the start of "a project-local object/typology graduates to the library". Keep it.

## 5. Parametric objects: all like `bed_python.json`

Today there are three object formats:
1. Six-node Math Engine objects (most of R2 library/Objects).
2. `bed_python.json`: a `python` block run by Pyodide in a worker.
3. program_pipeline's `object.json` + `object.py`, with `place()` / `qc()` functions (DOOR_HINGED, STAIR_DOGLEG).

**Proposal: one format, `object/2`, merging 2 and 3:**

```json
{
  "id": "bed", "version": "2.0.0", "units": "m",
  "params": { "width": {"type":"number","default":1.8,"min":0.9,"max":2.2,"label":"Width"}, ... },
  "rule_keys": { "min_clearance": "bed_side_clearance_m" },
  "python": "def mesh(p): ...\ndef plan2d(p): ...\ndef place(p, ctx): ...\ndef qc(p, rules, F, ref): ...\ndef bom(p): ...",
  "materials": { "frame": "Materials/wood_oak@1" },
  "baked": { "<params-hash>": "Objects/_baked/bed/<hash>.glb" }
}
```

- **Every function is optional.** `mesh` = 3D, `plan2d` = symbol lines, `place` = where it goes (program/design), `qc` = rule checks, `bom` = quantities (build).
- **The same source runs everywhere:** Pyodide in the browser (preview), CPython in pipelines, and Blender's Python for renders. One truth, no JS re-implementation.
- **Speed:** cache by params hash (`baked`). The app shows the cached GLB/symbol instantly and only runs Python when a param changes. While a slider is being dragged, it shows the Basic box (the existing renderMode Basic) and runs Python when the slider is released.
- **Migration:** most six-node objects are deterministic graphs, so write a **graph → Python code generator** and run it over the whole library. Verify each object by comparing vertex counts and bounding boxes, with Blender renders side by side (`tools/pyobj` harness). Objects that don't convert cleanly get hand-ported (the known Math Engine traps live in the memory notes).

## 6. Retire the expression / Math Engine?

**Yes, retire it gradually.** If objects are Python and the agent writes the logic, a visual node-expression language in the app costs a lot and nobody needs it to author anything.

Steps:
1. **Freeze:** no new six-node objects; the Parametric Object Creator and Tool Creator skills emit object/2.
2. **Convert** the library with the code generator above. Keep the old file next to the new one until the comparison passes.
3. **Read-only fallback:** the editor keeps a minimal evaluator only for unconverted legacy objects, behind a lazy import so it costs nothing at load.
4. **Delete** `packages/engine` (5 MB), the flow/node editor UI and the engine-backed tools once the counter of unconverted objects reaches 0.

What you lose: live in-app formula editing by non-programmers. What replaces it: "ask the agent to change the object" plus a param form. Tools (the LIVE/COMMIT rows) need the same treatment: tools become Python functions the agent or app calls.

Risks:
- Pyodide's first load is about 10 MB and takes 2–3 s. Load it lazily and only when a param actually changes; baked caches cover viewing.
- Very large plans: the 15 px/m LOD and baked GLBs stay. Python never runs per frame.

## 7. Make the app light

Target: the app is a **viewer + light editor + forms + inbox + approvals**. Heavy work runs in pipelines.

| Keep in the app | Move out to pipelines / agent | Candidates to remove (to audit with a bundle report) |
|---|---|---|
| Konva 2D canvas, light edits (move/rotate/params) | room detection, union, insets (Python, pipeline-kit) | `packages/engine` + flow/xyflow node editor (§6) |
| three.js viewer of baked GLB | house design engine `src/houseDesign` (BOQ, CPM, drawings) → Build pipeline | `@huggingface/transformers` (in-browser ML) |
| upload, questions form, comments, approve | AI chat inside the browser (`ai`, `@ai-sdk/google`) → agent | `@thatopen/*` (IFC) unless IFC import is a must |
| project/phase dashboard | simulated annealing / layout algorithms → Program pipeline | duplicate UI libs, unused radix pieces |
| Pyodide (lazy) for object preview | exports (DXF, HTML report) → pipelines (dxfplan already exists) | |

Measure first: run `vite build` with a bundle visualizer and record the size and load time on the 3BHK and a 30 MB plan. Set targets, e.g. initial JS under 1.5 MB gzip and under 2 s to first canvas. Then cut in the order of the table.

## 8. The app screens after the change

1. **Projects** – list from `Projects/index.json`: phase badges and who it is waiting on.
2. **Project** – a four-step header (Program · Plan/Design · Build · Present; the toggle we just made becomes this). Each step shows: inputs (inbox), questions (form), run status (agent), outputs, approve button.
3. **Canvas** – the current rev with a rev slider/diff ("what did Build change?").
4. **Share** – per-file Private/Shared switch, members and roles.

The agent connection stays as it is today (bridge/MCP). The app only shows status; it never orchestrates.

## 9. Order of work (milestones)

| # | Milestone | Done when |
|---|---|---|
| M0 | Housekeeping | pipeline-kit merged into 0.3.0; both new pipelines pass self-test on Windows; manifests in Navigator (done) |
| M1 | Project format | `project.json` + `canvas/revs` + `qa/` schema in library/Schemas; pipeline-kit has `open_project / commit_rev / share(file)`; private/shared enforced from `pipeline.json` |
| M2 | Program → Design wired | new project → program P1–P7 → r1 canvas → space-brief runs on it (AD_VL01 as pilot) |
| M3 | Design → Build wired | Build reads spacebrief.json + canvas directly; pptx only as fallback; INFRA_RECEPTION gives the same result both ways |
| M4 | Build → Present wired | Renderer stamps the rev; walkthrough + report from it; one pilot project goes through all four phases |
| M5 | Roles + sharing | members/roles in project.json, signed-URL API, client/modeler pages from space-brief generalised to all phases |
| M6 | object/2 | schema, Pyodide/CPython/Blender runners, bake cache; bed + door + stair as reference objects |
| M7 | Engine retirement | code generator over the library, parity report, engine lazy-loaded → deleted |
| M8 | Slim app | bundle audit, remove/move per §7, new project/phase screens |

M1–M4 deliver the integrated product; M6–M8 make it light. They can overlap after M1.

## 10. Decisions I need from you

1. **Single source of truth:** OK with *manifest + one canvas + sidecars* (my recommendation), or do you really want everything inside one canvas file?
2. **Where pipelines run:** on the user's machine via Claude Code only (simplest, private stays local naturally), or also a cloud worker so a client can trigger the Program phase without a local setup?
3. **Accounts/roles:** is there a login system to build on, or start with per-project secret share links (like space-brief's pages)?
4. **Math Engine:** OK to freeze now and delete after conversion, accepting that formula editing moves to "ask the agent"?
5. **IFC (`@thatopen`) and in-browser AI chat:** keep or remove?
6. **Units:** program_pipeline works in feet and canvas/space-brief in metres. Should canvas/2 be metres everywhere, with feet only at display and input time? (I recommend yes.)

---

## 11. Status after the first pass (2026-10-11)

Decisions taken without asking (the user asked for M0–M8 in one go): manifest + one canvas + sidecars; pipelines run
on the user's machine through Claude Code (cloud worker later); roles are self-declared names checked against the
manifest (no signed requests yet); IFC and in-browser AI are kept but load lazily; units unchanged (canvas metres).

| # | Milestone | State | Evidence |
|---|---|---|---|
| M0 | Housekeeping | **done** | pipeline-kit 0.3.1 = both 0.2.0 branches merged (29 + 13 + 26 tests); Full Pipeline phases green on Windows (Program ALL PASS, Plan/Design 37/37, Present 28/28) |
| M1 | Project format | **done** | `project.json` (fullproject/1), ONE packed multi-level canvas with revisions (`tools/canvas_store.py`), `qa/` answers |
| M2 | Program → Plan/Design | **done** | handover publishes plan_trace; resume builds one brief per floor via from_program |
| M3 | Plan/Design → Build | **done** | Build reads `roombrief.json` from Plan/Design; deck intake S1–S2 skipped; Build has a pipeline/1 contract |
| M4 | Build → Present | **done** | Present receives the Build `.blend` in its work dir; phases record `based_on_rev` |
| M5 | Roles + sharing | **done (CLI)** | members/roles in the manifest, owner-only membership, role-per-phase checks; signed URLs not built |
| M6 | object/2 | **done** | `packages/pyobject` (schema, runner, checks); program door/stair converted; editor honours renderMode, host, planColors, metrics, material defaults for Python objects |
| M7 | Engine retirement | **converter done, deletion NOT done** | spine2py: 124/138 live R2 objects convert; parity vs the engine on every 2D point / 3D vertex / metric (3983/3983 cases on tools/tmp-pobj; live library in parity_report_r2_library.json). Pyodide is too slow to evaluate on load (door ≈ 1 s, soft furniture seconds) → bake (`pyobject.bake`) + worker pool; the engine stays as the app's fast evaluator and geometry library |
| M8 | Slim app | **first cut done** | lazy routes: first load 10.77 MB → 0.35 MB raw (2.48 → 0.11 MB gzip); editor route 3.57 MB raw / 1.10 MB gzip with three.js and the AI SDK out of it; Project panel in the Navigator |

### Bugs found and fixed on the way
- Windows: text IO without `encoding="utf-8"` (cp1252) broke both new pipelines' self-tests; Python 3.12-only f-string in space-brief draw.py; console printing of → ✓.
- pipeline-kit bundle hashes broke on CRLF checkouts (`.gitattributes` now pins LF).
- `interop.plan_trace_to_canvas` declared only `{"id": "0"}` as layers → the editor imported Program canvases EMPTY (fixed in kit 0.3.1; the standalone program/space-brief pipelines still vendor 0.2.0 and still have it).
- Work dirs one level deeper in the Full Pipeline would have landed inside `public/`.

### Next
1. Promote `spacebrief.v1`, `roombrief.v1`, walkthrough schemas to R2 `library/Schemas/` (needs the user's OK) so real handovers validate.
2. Bake on handover: `project.py handover` runs `pyobject.bake` on the canvas so every opened revision is instant.
3. Port the remaining builtins (2D/3D booleans, mcyl, bezier family) → the last 4 objects; detection / image / canvas objects stay engine-side by design.
4. Lazy-load FlowOverlay (@xyflow + flow evaluator) — the editor chunk is still 2.8 MB.
5. Signed share links (Vercel function checking `members`) before clients get access.
