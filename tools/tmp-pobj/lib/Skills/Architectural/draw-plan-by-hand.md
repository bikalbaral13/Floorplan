---
id: draw-plan-by-hand
name: Draw a plan by hand (fallback)
category: Architectural
when: The plan cannot be expressed by the workflow — an irregular envelope traced from an underlay, or a one-off partition added to an existing plan.
tools: [draw_segment, place_opening, apply_model]
---

This is the fallback, not the default. Reach for it only when `run-floorplan-workflow` cannot express the plan.

- `draw_segment` with `segmentType: "wall"` for the envelope and partitions. Draw **closed loops** — a closed loop auto-detects a Space.
- Keep exterior runs **0.23 m** and interior **0.12 m**.
- `place_opening` cuts a door or window INTO the nearest wall (it splits the host and marks the opening). That is the right tool when adding one opening to an existing plan, not when generating a whole layout.

**Do not place openings by eye when a workflow can carve them.**
