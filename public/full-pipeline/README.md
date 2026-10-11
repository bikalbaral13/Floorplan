# Full Pipeline (0.1.0)

One project, four phases, handed from person to person through R2. The four phase pipelines are copies of the
standalone ones (which stay untouched next to this folder), on **one** shared kit, `pipeline_kit` 0.3.0.

```
 PROGRAM            PLAN/DESIGN              BUILD                    PRESENT
 1-program/         2-plan-design/           3-build/                 4-present/
 program 0.5.0      space-brief 0.5.0        build-from-deck 0.2.0    walkthrough-video
 owner / client     architect                modeler                  presenter
   │ plan_trace.json   │ roombrief.json         │ <CODE>.blend
   └──── R2 ──────────►└──── R2 ───────────────►└──── R2 ──────────────►
        Projects/<CODE>/program/   Projects/<SUB>/brief/   Projects/<SUB>/build/
```

## Handing a project over
```bash
# Asha (owner) on her machine
python tools/project.py new ZZ_E --title "30x40 villa" --by Asha
cd 1-program && python tools/run_task.py ZZ_E          # P1 … P7; Asha answers the P2 brief and P3 rules
python tools/project.py handover ZZ_E --by Asha --note "client approved option K"

# Ravi (architect) on another machine
python tools/project.py resume ZZ_E --by Ravi          # pulls plan_trace, makes one brief per floor (ZZ_E_GF, ZZ_E_FF)
cd 2-plan-design && python tools/run_task.py ZZ_E_GF
python tools/project.py save ZZ_E --by Ravi --note "GF scope half done"   # stop for the day; anyone can continue
python tools/project.py handover ZZ_E --by Ravi        # only when every task is done (or --force "why", recorded)

# Kiran (modeler), then Dev (presenter): the same resume / handover
python tools/project.py status ZZ_E                    # who did what, what is open, what is next
python tools/project.py member ZZ_E add Ravi architect --by Asha   # roles: owner client architect modeler presenter
python tools/project.py revs ZZ_E                      # canvas revisions: phase, person, which levels changed
python tools/project.py canvas ZZ_E --out zz_e.json    # the project canvas, ready for Files ▸ Import JSON
python tools/project.py share ZZ_E site_photo.jpg --by Asha   # make one private file shared (inbox/<phase>/<person>/)
```
`--store local:<folder>` replaces R2 (offline, tests); `--dry-run` uploads nothing. R2 keys come from env or `.env`.

## The single source of truth: one canvas
`Projects/<CODE>/canvas/current.json` is ONE packed multi-level canvas (the editor's own levels format — GF active,
FF … under `levels[].model`), so it opens as-is. Every handover commits an immutable revision
(`canvas/revs/rNNNN.json`) and logs it in `canvas/index.json`: phase, person, parent, sources, sha256, element counts
per level and the change against the parent. Program makes the levels from plan_trace; Plan/Design replaces each
floor with its brief's canvas; Build's furnished room canvases are linked as `canvas/rooms/<SUB>.room.canvas.json`
(a room is not a whole floor). Each phase records `based_on_rev`; the answers behind a phase are copied to
`qa/<phase>/<SUB>/`.

## What is shared and what stays private
| Shared — R2 `Projects/<CODE>/` | Private — this machine |
|---|---|
| `project.json` manifest (fullproject/1): phases, codes, who/when, notes, forced reasons, history | `projects/<SUB>/inputs/` (uploads: sketches, PDFs, photos) |
| each phase's `outputs.keep` from its `pipeline.json` | work dirs (`<repo>/pipeline-work/…`, outside `public/`) |
| each phase project's text state `Projects/<SUB>/<pipeline>/state.json` (+ `Projects/index.json`) | everything not listed in `outputs.keep` |
| `runs/<pipeline>/<run_id>/run.json` | |
| `inbox/<phase>/<person>/…` — only files someone chose to `share` | |

`share_inputs` in `full.json` lists the generated inputs a phase cannot run without (Plan/Design's
`inputs/plan.canvas.json`, made from the program's plan_trace); they travel with the state.

## Folder
```
full-pipeline/
├─ full.json           full-pipeline/1: phases, folders, bridges (what the next phase pulls), rules
├─ tools/project.py    new · status · save · handover · resume · share · list
├─ tools/selftest.py   every phase's self-test + kit drift + tests/test_handover.py
├─ tools/canvas_store.py    the project canvas: pack/unpack levels, commit revisions, room sidecars
├─ tests/test_handover.py   two machines, five people, four phases through a local store (28 checks)
├─ _vendor/pipeline_kit     kit 0.3.0 (master: packages/pipeline-kit)
├─ 1-program/  2-plan-design/  3-build/  4-present/   phase pipelines (each runs on its own too)
```

## Differences from the standalone pipelines
- All on kit **0.3.0** (`packages/pipeline-kit`, the merge of the two 0.2.0 branches); `pipeline.json` pins updated.
- **Windows:** every text read/write is UTF-8 (`encoding="utf-8"`), tests print UTF-8, and one Python 3.12-only
  f-string in `2-plan-design/core/draw.py` is 3.11-safe. These were the self-test failures of the standalone copies.
- Work dirs one level deeper (`../../../../../pipeline-work/…`); new projects use `pipeline-work/full/<CODE>/<phase>`.
- **Build** has a real `pipeline/1` contract (outputs.keep → `Projects/<SUB>/build/`), a task sheet, and reads
  `roombrief.json` from Plan/Design; the .pptx deck path is the fallback for outside decks (S1–S2 skipped when bridged).
  Its old command and stage list is `3-build/STAGES.json`.
- Program publishes its `project.json` too, so Plan/Design gets the standards set on another machine.

## Before the first real (R2) handover
`library/Schemas/` in R2 has run.v1, pipeline.v1, plan_trace.v1 and canvas.v1, but **not** `spacebrief.v1`,
`roombrief.v1` and the walkthrough schemas. Publishing validates against them, so those phases' handovers will
report `invalid` until the schemas are promoted to the library (a library write, needs approval).
