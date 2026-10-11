# AGENTS.md — program pipeline

Read this first, then the project's `PROJECT.md`, then its `TASKS.csv`. Ask the user before every task.

```
program_pipeline  ──plan_trace.json──▶  space-brief-pipeline  ──brief deck / roombrief──▶  interior / build pipelines
 (what to build on the plot)            (design inputs per floor: views, schedule, client approvals)
                  └─plan_trace.json──▶  design_pipeline (rooms and furnishing)
```
Rules every pipeline follows: `library/Skills/Shared/pipeline-rules.md`. This file adds the program's own.

## 0. Shared with the other pipelines (pipeline_kit 0.2.0 — never edit the copies)
| Shared piece | Here | Same in space-brief |
|---|---|---|
| Plumbing: files, read-only inputs/, task sheet, REPORT.md, findings, units, version pins | `_vendor/pipeline_kit/` behind `core/paths, tasks, report, units, stage` | `_vendor/pipeline_kit/` |
| Firm standards (conventions + object preferences, `extends`) | `standards/` = byte copies of `library/Standards/` (SOURCE.json) | same files |
| Save / resume across chats, one projects registry | `tools/project_state.py` → `Projects/<CODE>/program/state.json`, `Projects/index.json` | `Projects/<CODE>/space-brief/state.json`, same index |
| Contract | `pipeline.json` (pipeline/1): outputs.keep → `Projects/<CODE>/program/` | its own pipeline.json |
| Hand-off | P6 `output/plan_trace.json` → `space-brief-pipeline/tools/from_program.py <trace> --level GF` (one brief per floor; walls, doors, openings rebuilt by `pipeline_kit.interop`) | |
Change shared code in the kit master (`packages/pipeline-kit`), run its tests, re-vendor both pipelines (`tools/vendor.py`).
Change a standards value in the library master (with the user's approval), then re-copy it into every pipeline.

## 1. The library you work with

| Level | Where | Versioned | Changed by |
|---|---|---|---|
| **Object** — stair, door, later ramp, lift, parking bay | `objects/<ID>/` object.json + object.py | yes, frozen copies in `versions/` | library work only, never inside a project |
| **Standards** — firm-wide object preferences (door 3', riser 7") | `standards/<SET>.json` | by file | the user / firm; a project picks a set |
| **Typology** — a kind of building program with options | `typologies/<ID>/` typology.json + generator.py (+ planner/, stages/) | yes, frozen copies in `versions/` | library work; projects only pin it |
| **Variant** — a project's change to a typology | `projects/<CODE>/typology/` (or `parcels/<P>/typology/`), `"extends": "<ID>@<ver>"` | own version | project work, promoted to the library when reused |
| **Stage** — a step in the task sheet | shared `stages/<ID>/`, typology-owned `typologies/<T>/stages/<ID>/` (`+<ID>` in a plan) | yes | library work |
| **Parameters** — the numbers of one project | `params.json`, `parcels/<P>/params.json`, `work/options/<ID>.json`, `work/selection.json` | provenance per value | the user, through you |

Run `python tools/catalog.py` to see what exists (versions, frozen versions, lineage, stage plans, functions).

## 2. Match every requirement before you build anything

When the user brings a project, a change request or a new input, classify **each requirement** with this ladder and stop at the first rung that satisfies it. Write the result in the brief (`typology_match`) or, for later changes, as a dated `[decision]` line in REPORT.md, and get the user's yes before acting.

1. **Parameter of the pinned typology** — the value fits the typology's parameter and range (a 14' court, door at 20%, 4" wider flights).
   → Project data: `params.json` (all options), `parcels/<P>/params.json`, `work/options/<ID>.json` (one option) or `work/selection.json` (the chosen one). Add `"lock": true` when the user says it is fixed. No code, no version.
2. **Object preference shared across projects** — "we always use 3'-6" doors", "our risers are 6.5"".
   → `standards/<SET>.json` (new set or edit, user's call) and `project.json → standards`. No code.
3. **Object parameter outside its range or a different object kind** — a 4'-6" flight, a spiral stair, a sliding door.
   → Object library: widen the range or add a parameter (minor version), or a new object (`objects/<NEW_ID>/`). Then the typology pins the new object version (its own minor version). Never patch an object inside a project.
4. **Typology behaviour the project needs, others may not** — an 11th option, a different court rule, an extra stage, unequal units.
   → **Variant**: `python tools/new_variant.py <CODE> --extends <ID>@<ver> --id <VARIANT_ID>`. Put only the differences in its typology.json / generator.py (missing functions fall back to `base`). Brief `typology_match.decision = "variant"`.
5. **The same change wanted by a second project** — promote it:
   - adds things without changing existing results (new option, new parameter whose default reproduces old output) → merge into the parent as a **minor** version (by hand, with a parity check that old fixtures still pass);
   - changes existing results → `python tools/promote_variant.py <CODE> --id <NEW_ID>` (registry status `implemented`), add tests, set `tested`.
6. **A different kind of building** — other unit count range, other access logic, multi-storey program, mixed use.
   → **New typology**: `python tools/new_typology.py <ID> --title "..." [--extends <ID>@<ver>]` (status `spec` → `implemented` → `tested`). Projects wait until it is `tested`.
7. **Different parts of the plot need different programs** (shops on the road, rentals behind) → **parcels**: create the project with `--parcels`; agree `work/parcels.json` (split, depths, typology per parcel) with the user; P1b adds each parcel's own stages.
8. **A different process** (parking layout, FSI check, vertical core) → a **stage**: typology-owned (`typologies/<T>/stages/<ID>`, `+<ID>` in its `stages` plan) when only that typology needs it; shared (`stages/<ID>`) when several do. Bump the typology version that adds it.

How to test a requirement against the library
- `python tools/fit.py <CODE> [--scope P]` → work/FIT.md: every typology's applicability (plot width / depth, road side, unit count, facings) + objects + standards.
- P2 writes the same candidates into its draft brief.
- For each requirement, name the rung and the evidence ("court 14' — parameter court_ft, range 0–20, rung 1"). Unsure between two rungs → choose the lower one and say so.
- Never stretch a rung: a value outside a parameter's range is rung 3 or 4, not "override the min".

## 3. Ask before every task
1. `python tools/run_task.py <CODE>` previews the next task (reads, writes, checks, typology lineage, blockers).
2. Run only with the user's go-ahead: `--task <ID> --approved "<their words, date>"`. One approval = one task.
3. Report status, findings and outputs, then stop. P5 approvals must name the option ("option E").
- The runner refuses a stage whose version does not satisfy the typology's `stage_versions`, or whose `requires` functions the typology lacks.

## 4. Stages
| Task | Scope | Output | Stops for the user when |
|---|---|---|---|
| P1-SITE | project | site.json | no inputs/site.json or work/site_trace.json |
| P1b-PARCELS | project | parcels/<P>/site.json, parcel.json, per-parcel rows | no work/parcels.json |
| P2-BRIEF | project or parcel | brief.json with `typology_match` | draft; no pin yet; typology defaults filled in |
| P3-RULES | project or parcel | rules.json | draft; a (new) typology needs rules not yet confirmed |
| P4-OPTIONS | project or parcel | options/<ID>/ (with provenance), output/OPTIONS.md | no option passes QC |
| P5-SELECT | project or parcel | selected.json, output/PARAMS.md | no selection; failing findings not accepted |
| P5b-STAIR_SCHEDULE | project or parcel | output/stair_schedule.csv (shared; TOWNHOME_RENTAL 0.2.0 still uses its own copy) | — |
| +P5c-AREA_VASTU | (VILLA_4BHK_G1) | output/area_statement_levels.csv, output/VASTU.md | — |
| P6-HANDOFF | project | output/plan_trace.json (merges parcels) | a scope has no selection |
| P7-QC | project | output/qc.md | — |

Re-running a done task resets every task downstream of it. Parcel tasks are named `<P>:P4-OPTIONS`.

## 5. Versions and upgrades
- A project / parcel pins `typology` + `typology_version` (or `variant`). Older versions load from `typologies/<ID>/versions/<ver>/` — never delete a frozen version a project still pins (`REGISTRY.json → projects`).
- `python tools/upgrade_typology.py <CODE> [--scope P] [--to <ver>]` regenerates the selection / options on both versions (migrating parameters with the new version's `migrate()`) and writes a diff. Show it; apply with `--approved`. The pin moves, the scope's tasks after P2 reset, P3 asks for any new rules.
- Planner settings files carry `typology_version`; P5 migrates older files and logs it.
- Changing an object, typology or stage: semver bump + CHANGELOG line + frozen copy of the old version if any project pins it + new fixture + `python tools/selftest.py`.
- Typologies with a planner keep `generator.py` and the planner's `compute()` at parity (selftest).

## 6. Parameters
Layers, lowest first: object defaults → typology defaults → standards set → site → rules (clamp values that came from the layers above) → project params.json → parcel params.json → option file → selection. Each resolved value keeps its provenance (option.json, selected.json, output/PARAMS.md).
- Value forms: plain, or `{"value": v, "lock": true, "note": "..."}`. A locked key can only change with `{"value": v, "unlock": "<user's reason>"}` — never add unlock without the user.
- Unknown keys are errors: a new key means rung 3, 4 or 6 in section 2, not a typo to silence.
- A user value below a rule is kept (it came after the rules) and QC fails it — then the user either changes it or accepts it in `work/selection.json → accepted` with a reason.
- A planner settings file supplies every parameter, so in a selection made from the planner every value's layer is `selection` and the earlier layers show "all overridden". That is correct: the planner screen is what the user approved.

### Tracing a parameter (which file, still true?)
Every option.json and selected.json carries `layers`: each layer's files with sha256, the keys it supplied and the keys that survived. A file read but fully overridden is still listed (survived 0).
- `python tools/trace_params.py <CODE> [--key court_ft]` — value, layer, file, changed since resolved, lock.
- `python tools/trace_params.py <CODE> --layers` — the manifest per selection.
- `python tools/trace_params.py --file standards/AADITHYAA.json` (or `projects/<CODE>/params.json`) — every project / scope / option that read it.
- `python tools/catalog.py` — usage index, STALE where a file changed after it was used.
- P7 fails when any manifest file (params, parcel params, option file, selection, standards, site, rules, brief, typology / object files) changed since P5. Answer: rerun P4/P5 with the user, or restore the file. Never edit a selection record by hand.

## 7. Rules
- `inputs/` is read-only (writes raise PermissionError). Readings of sketches go to `work/site_trace.json` with every guess in `assumptions`.
- rules.json defaults are placeholders: confirm the authority, source and each value with the user.
- REPORT.md is append-only; every manual decision gets a dated `[decision]` line.
- Never delete task rows; mark `skipped` with a reason.

## 8. Units and frames
Multi-level typologies (VILLA_4BHK_G1) put `level` on rooms and doors; hand one level per design project: `tools/handoff_to_design.py <CODE> --level GF`.
Typologies with any road side work in a drawing frame (road at the top, left / right as drawn) and convert to compass; P1 stores both (`left_ft` / `right_ft` and compass sides).
Program: feet (strings like `105'-6"` accepted). Site frame: x east from the west plot edge, y south from the road edge. Hand-off: mm, X east, Y north, origin = plot south-west corner; parcels are shifted into the plot frame; room codes are prefixed with the parcel code.

## 9. Tools
`new_project` · `set_typology` · `run_task` · `status` · `fit` · `catalog` · `trace_params` · `upgrade_typology` · `new_variant` · `promote_variant` · `new_typology` · `handoff_to_design` · `project_state` · `selftest` — Python 3.10+, no third-party packages.

## 10. Saving and resuming (chats)
A chat's working folder is wiped when the chat ends. After every approved task: `python tools/project_state.py pack <CODE>` and follow
`work/state/SAVE.md` (library `Projects/<CODE>/program/state.json` + `Projects/index.json`). Resume: read the index, read the state,
`tools/project_state.py unpack <file>`, ask the user to re-attach the inputs listed in RESTORE.md (P1 checks their sha256).
