---
id: trace-live-in-build
name: S2 Plan in Build from Deck — trace live on the canvas, one canvas per sub-step
category: Floorplan Tracer
when: build-from-deck S2 Plan, after S1 is approved. The input is the plan crop S1 filed (inputs/images/<source>/<board>/plan/plan.png, or the deck's plan picture). Replaces the hand-off to the separate floorplan-tracer pipeline.
---

S2 has four sub-steps in the app's **S2 Plan** tab. Each one ends with a canvas file that you write AND load on the
live canvas (`design.load { path, design }`), and a store doc the user fills in the tab. Never fill a doc yourself and
never approve S2. Read the user's input with `pipeline.events { since }` (type `s2`, data `{ doc, data }`) or
`pipeline.state`. Report each step to `stages/S2/agent-progress.json` (`agent-progress/1`: step, pct, msg, at, done)
with the step ids below — the tab's progress card and each sub-step header read them.

All paths below are under `Projects/<CODE>/3-build/build-from-deck/steps/`.

| Sub-step | Your step id | You do | Canvas you write + load | The user's doc |
|---|---|---|---|---|
| 1 · Overlay, scale and north | `UNDERLAY` | Put the plan crop on the canvas as an underlay (`underlay` tool), fit to page, no walls yet. When `s2/scale` arrives: set the underlay's scale from `ref_mm` over the reference's pixel length (a door leaf, or a printed dimension — see calibrate-scale-from-printed-dimensions.md) and the plan's north from `north_deg` (0 = page-up). | `S2_PLAN/1-overlay.canvas.json` | `s2/scale`: ref_kind, ref_what, ref_mm, north_deg |
| 2 · Walls, doors and windows | `WALLS` | Trace walls (centre-lines + thickness from the bands, measure-wall-bands-from-pixels.md), then doors and windows by zoom (read-openings-and-fixtures-by-zoom.md). Snapshot to `S2_PLAN/walls.png`. On `s2/walls` with `ok: false`, apply `note`, rewrite and reload the canvas, snapshot again. | `S2_PLAN/2-walls.canvas.json` | `s2/walls`: ok, note |
| 3 · Objects | `OBJECTS` | Trace every piece of furniture / fixture drawn on the plan as an object at its plan position and size (match it to the S1 crops and the room brief items). Snapshot to `S2_PLAN/objects.png`. Same loop on `s2/objects`. | `S2_PLAN/3-objects.canvas.json` | `s2/objects`: ok, note |
| 4 · New objects, materials, improvements | — | Apply `s2/more`: `add_objects` / `objects_note` become new items for S3, `add_materials` / `materials_note` new materials, `improve` any edits. Write the final plan, then queue S2_GEOMETRY. | `S2_PLAN/4-plan.canvas.json` | `s2/more`: add_objects, objects_note, add_materials, materials_note, improve |

Rules:
- One canvas file per sub-step, each a complete canvas (not a diff), so the user can step back to any of them with
  **Show on canvas**. A rewrite after feedback overwrites that sub-step's file.
- Write the file first, then load it: the tab opens a NEW canvas file on the canvas by itself; `design.load` makes
  it live for the open editor too.
- Wait for the user's doc before moving to the next sub-step. "Looks right" (`ok: true`) moves on; a note means change
  and show again.
- Keep the scale and north from sub-step 1 in every later canvas.
