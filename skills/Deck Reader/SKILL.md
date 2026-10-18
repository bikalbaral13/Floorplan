---
id: deck-reader
name: Read a plan-phase deck into a room brief (roombrief/1)
category: Deck Reader
when: A .pptx or .pdf design deck has been handed over and one room has to be built from it — in a pipeline this is S1 Brief; on its own, whenever someone asks "what does this deck say about the reception".
tools: [Bash, Read]
files: [skill.json, curate-the-brief.md, tools/intake.py, tools/questions.py, tools/brief.py, tools/progress.py]
---

Everything downstream reads **only** `roombrief.json`. This skill is the one place that knows how a deck is laid out.

## Steps (skill.json)

| Step | Who | What |
|---|---|---|
| INTAKE | script | `intake.py <deck> <work>/deck` — slides (or PDF pages rendered to `pages/`), images, plan overlays → `deck.json`; `questions.py` → `questions.json` (project, room, ceiling height, a scale dimension) |
| ANSWER | **user** | answers the questions. The agent never answers them. |
| DRAFT | script | `brief.py <deck> "<project>" "<room>" roombrief.draft.json` — everything the deck says about that room |
| CURATE | agent | write `roombrief.curated.json` — see [curate-the-brief.md](curate-the-brief.md) |
| FINALIZE | script | `brief.py finalize draft curated roombrief.json` — fails if a room slide is not covered |
| APPROVE | **user** | approves the brief in the app's Brief tab |

## Deck reading facts (verified on the INFRA deck)

- One file can hold several projects; a cover slide opens a project.
- The floor plan is the picture repeated (cropped) on many slides; the crop gives the room window, and shapes drawn over it map back to plan pixels (`plan_overlays`, `points_px`).
- Swatches are solid-filled shapes (`fill`); red fills are callout arrows; filled freeforms on the plan are zone highlights.
- Classification is rule-based (`kind`: cover/divider/spec/dims/review/view/final_render/label); check the draft before curating.

## Progress

Scripts print `@@progress {"pct":…,"msg":…}` lines (`intake.py`: one per slide); the pipeline runner shows them live. In CURATE the agent reports through the pipeline (`stages/S1/agent-progress.json`, see the pipeline's AGENTS.md).
