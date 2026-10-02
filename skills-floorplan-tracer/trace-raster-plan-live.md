---
id: trace-raster-plan-live
name: Trace a raster floorplan onto the live canvas, the user setting up and correcting, the agent measuring and drawing
category: Floorplan Tracer
when: The user hands over a raster floorplan AND wants it traced in the app where they can see and correct it — rather than receive a finished JSON. Use `trace-raster-plan-to-canvas` instead when they just want the result.
tools: [Bash, Read, begin_step, checkpoint, get_changes_since, get_state, import_objects, analyze_underlay, apply_model, list_draw_tools, draw_segment, place_opening, place_object, attach_segment_object, attach_space_object, style_segments, delete_entities, export_plan, list_spaces, snapshot_canvas]
requires: [work-one-step-at-a-time, calibrate-scale-from-printed-dimensions, measure-wall-bands-from-pixels, read-openings-and-fixtures-by-zoom, verify-trace-overlay-and-areas]
---

**A PDF?** Run `pdf-intake` first and trace its confirmed crop; Import Image takes the crop, not the PDF. A `multi-level` or `masterplan` set is not a live job: route it as `pdf-intake` says.

Same measurement and arithmetic as `trace-raster-plan-to-canvas`; the difference is that the geometry lands
on the **live canvas** and the work is split by who is actually faster at it. Two gated cards, not eight.
Follow `work-one-step-at-a-time` for the gate mechanics.

## Over the hosted link (Connect Claude): pending results and `await_result`

When the user connected with the editor's **Connect Claude** button, your `floorplan` server is the hosted
relay (`…/mcp`), not the local bridge. Same tools, one difference: a call the editor has not answered within
about 50 seconds returns `{ "pending": true, "ticket": "c_…", "tool": "…" }` instead of blocking. That is
normal for a `checkpoint` (the user is still reading the card) and for a big `apply_model`. Call
**`await_result`** with the ticket, and keep calling it until it returns the real result; do not re-issue
the original call, or it would run twice. Each call takes about 2–3 s end to end, so prefer whole-model
builds (`apply_model`) to hundreds of small draw calls. `EDITOR_NOT_CONNECTED` means the tab is closed or
hidden: ask the user to bring it back. `TAB_CHANGED` means the tab reloaded mid-call: read
`get_changes_since` before retrying a drawing call.

## Who does what, and why

**A human is faster at anything that is one look and one click.** Setting a scale on a printed dimension at
zoom, clicking the north arrow, flipping a hinge, rotating a bed, renaming a room, deleting a stray. The
agent does these slowly — bridge round-trips, crops read at 8× — and sometimes wrongly.

**The agent is faster at anything that is many measurements and many draws.** Fifty wall centrelines from
band scans, twenty opening gaps, thirty furniture centres, the area table, the export, the run document.

Measured on the casa1 run under the old all-agent flow: the agent spent 2 m 56 s fitting a scale, the user
spent 3 m 25 s on its card, and then **calibrated it themselves anyway**. Six and a half minutes for ninety
seconds of Set Scale. That is the whole argument for the split below.

## Stage A — the user sets up (agent idle, ~2 min, NO card)

Give this checklist and then wait. Do not draw, do not measure, do not place the underlay.

1. Open **one** tab at `/floorplan-editor?agent=1` — the landing→editor link drops the query, and a second
   bridge-enabled tab steals the latch.
2. **Import the image** through the app (File ▸ Import Image). Much better than the bridge's inline data
   URL: no 150 KB base64 hop, and the underlay is where the user put it.
3. **Set Scale** at zoom on a clearly printed dimension. This is the one number everything inherits, and
   they can zoom; you cannot do it better.
4. **Set North** on the sheet's north arrow — or say "leave it at 0°". Geometry does not depend on it, so
   never block on it.
5. Optionally: wall thickness convention — "as printed" (measure the bands) or "standard 230/115 mm".
6. They say "go". **That message is the calibration card** — no bridge checkpoint for stage A.

If they ask you to calibrate instead, do it (`calibrate-scale-from-printed-dimensions`) and report the
residuals — but offer stage A first.

## Stage B — the agent draws everything (one card, ~3 min)

`begin_step` "B — draw" (`of: 3`). Then, before anything else:

**Read the mapping from the live underlay, never from your own calibration.** `analyze_underlay` returns the
traced hull's corners in image-grid units (0–1000 per axis) *and* in world metres; two corners per axis give
the affine map exactly. Re-derive it at the start of every stage — the user's Set Scale is invisible to the
revision log, so this is the only way to know it.

**Cross-check the scale in one line, not a card.** Measure two or three printed dimensions against the live
mapping and report: *"your scale reads a printed 12'0" as 4.08 m — 11.6% over the printed dimensions, so
areas will read ~25% high."* On casa1 that was true and intended. State it; do not argue, do not block.

**Measure once, into a file.** `measurements.mjs` holds every wall centreline, every opening span and every
object centre in image pixels. Each stage draws from it. That is what makes "redo" cheap: `clear_canvas` +
replay, not a second afternoon. Copy the scan scripts from `floorplan-tracer-scripts` rather than writing
them fresh — the first run was slow almost entirely because they were written from scratch.

### Build the plan as ONE model, then `apply_model` it — do not draw it call by call

**This is the single biggest time saving in the run, and it is measured.** Building casa1 as a
`FloorPlanModel` and applying it took **0.05 s** (0.02 s to build 104 walls + 32 node objects, 0.03 s to
apply). The identical plan built with granular tools took **9 m 54 s**. A round-trip test — tools build a
plan, `get_plan`, `clear_canvas`, `apply_model` the same JSON back — comes out **byte-identical**: walls,
opening pieces, segment attachments and `nodeMeta` all survive, and the **underlay is preserved**.

Call `import_objects` and `list_draw_tools` first: object ids are **foreign keys**, and every attachment's
`params` must be seeded from that object's own defaults (then overridden). An id that is not loaded renders
as "(missing)".

Assemble, in image pixels, converting once with the live mapping (`canvas px = world metres × ppm`, and take
**ppm from `get_state`** — `apply_model` does not set it):

- **Walls** — every centreline, thickness from the band width or the user's convention, with each opening's
  span **cut out of the run**: emit `pre`, then the opening piece, then `post`. The pieces share endpoints,
  and that sharing is what closes the rooms. Put `hatch` / `hatchStyle` / `hatchSpacing` / `hatchAngle` on
  the wall record itself.
- **Openings** — the middle piece carries `isObjectOpening: true` and an attachment to `door-with-math` /
  `window-with-math` with `width` set to the measured span and `fitMode: "Fill segment"`. Use a **default
  handing** and let the user flip what is wrong in stage C; reading arcs at 8× cost 6 m 50 s on casa1 and
  was still wrong once. An opening that does **not** lie on a declared wall line (a doorway between two wall
  ends) needs its **own standalone piece** emitted — two of casa1's twelve doors were lost the first time
  because the builder only cut openings out of lines it already had.
- **The Wall object** — a `wall-with-math` attachment on every plain wall piece, `thickness` matching the
  segment. `draw_segment` gives the mitered band but NOT the object, and the hatch renders from the object.
- **Furniture and fixtures** — a **degenerate marker wall** (start == end, `segmentType: "line"`) per piece,
  plus a `nodeMeta` entry keyed `"<wallId>:end|<wallId>:start"` carrying the object attachment. Sizes from
  the blob boxes, **rotation 0**; the user rotates what faces wrong in a second.
- `rooms: []` **always** — spaces auto-detect from the closed loops after the apply.

Then, and only then, the handful of calls that cannot go in the model:

- **Spaces** — `list_spaces`, `attach_space_object` the Room object to each, and build the areas table
  against the printed L×B. (~14 calls on casa1; ~10 s.)

**Granular tools are for CORRECTIONS, not for building.** After stage C the user's edits exist on the
canvas, and `apply_model` replaces the whole plan — so from that point on, flipping one hinge is one
`place_opening`, never a rewrite. The rule is: **one import for the bulk while nothing of theirs exists;
tools for everything after.**

One card closes stage B, and its `ask` opens stage C:

> Is anything the **wrong kind or missing**? And edit freely now — flip hinges, rotate furniture, rename
> rooms, drag or delete anything. I read your edits when you continue.

Report in the `summary`: counts drawn, the scale cross-check line, the areas table, and every judgement you
made (which symbol you read as what, which handing you defaulted to).

## Stage C — the user corrects (agent idle, happens while B's card is open)

A checkpoint card blocks the agent but not the canvas: **the user edits while it is open, and those edits
come back in `userEdits`.** So stage C needs no card of its own. What it needs is for stage B's card to
*invite* editing rather than only ask a question — the wording above.

Things the user does far faster than you: flip a hinge, rotate furniture, rename rooms (the bridge cannot
rename a space at all), delete a stray, drag a wall that reads wrong, fix the scale if the cross-check
bothered them.

When they continue, read `get_changes_since` and act:

- **If their edits and notes need no work from you** — go straight to stage D. This is the common case.
- **If they do** ("that's a window, not a door", "no wall there", "missing a wardrobe") — `begin_step`
  "C — corrections", apply exactly those, and raise one short card showing what changed. Then stage D.

Ground rules, unchanged: a wall they moved sets the room — re-solve the neighbours off *their* position,
never re-derive and overwrite. A wall they deleted was not there; drop it from `measurements.mjs` too, so a
replay does not resurrect it. Their notes outrank your pixels. If an edit contradicts a printed dimension,
draw what they drew and say so in one sentence with both numbers.

**What the revision log does NOT see:** scale, north, and space names. Re-read those from
`analyze_underlay`, `export_plan` and `list_spaces` — do not expect `userEdits` to list a rename.

## Stage D — the agent delivers (final card, ~1 min)

`begin_step` "D — deliver". Verify, then ship:

1. Every room closes — `list_spaces` against the printed L×B, and say which rooms are still merged.
2. `export_plan` — the exact bytes the app's Export JSON writes. **Check the export before uploading**:
   segment count, space count, and that `wall-with-math`, the doors and the windows are actually in it.
   Refuse to upload if they are not.
3. Point `imageUnderlay.src` at the Library image, fill `settings.source` (image, pixels, px/ft, px/m,
   route, calibration — say whose scale it is), save to `library/Designs/<Name>.json`, copy to the repo root,
   keep the data-URL variant locally.
4. **Re-import the delivered file** through the app's hidden `.json` input in a fresh tab with the bridge
   OFF (`localStorage.removeItem("bp.agentBridge")`) and compare Nodes / Edges / Areas with the live canvas.
5. Final card with `final: true`: scale (whose), per-room deltas, every user edit you built on, everything
   still guessed.

## The geometric rules still apply

From `author-plan-graph-in-image-pixels`, unchanged: shared nodes at every junction; both walls ending on
the shared centreline node at a 90° bend or T, no stub past the junction; short wall pieces only between an
opening's jamb and a junction; opening pieces carrying no Wall attachment but keeping thickness +
`bufferStyle` + `isObjectOpening`; `segmentType: "line"` so the 3D canvas never extrudes them; space rings
on centrelines, because the editor insets each edge when it labels the space.

Handing on `door-with-math` is viewed from the **swing side**, not the segment direction: on a piece drawn
start→end, `hinge:"right"` is the end node, but `swing:"left"` mirrors it — the effective hinge is
`(hinge==="right") XOR (swing==="left")`. Place one door, snapshot, confirm, then the rest.

Thin balcony parapets (~4 px) sit where the **ink outline** says, not where the band scan puts them, and a
printed balcony size is usually its outer dimension — expect ~10% under on those and say so.

## Mechanics that bite

- **Never edit the app's source during a live run.** Adding a hook to `FloorPlanEditor.tsx` makes Fast
  Refresh remount the editor and the canvas is gone (casa1: rev 318, −184 walls, scale reset). Export first,
  edit after. Handlers added to the bridge effect must read component callbacks through a **ref** — the
  effect re-runs on every refresh and a captured closure exports that moment's plan.
- **A re-import does not restore the object library.** Call `import_objects` again before
  `attach_segment_object`, or it fails with "not in the loaded library".
- `snapshot_canvas` straight after a restyle is stale — pause ≥ 0.9 s. It also refuses while only the
  underlay exists, which is why stage A has no snapshot.
- Drive `/enqueue` from `node:http`, not `fetch`: undici's 300 s headers timeout kills a checkpoint call long
  before the bridge's 30-minute budget.
- Step-gate state lives in the bridge process; a restart disarms it. Re-`begin_step` and carry on — the
  canvas is the record.
- **If the user stops answering**, the card times out after 30 minutes. Do not carry on without them; report
  which stage is open so the run resumes from `get_state`.

## Time the run and document it

Two clocks per stage — agent time (measuring and drawing) and user time (the card open) — plus a snapshot
per stage and every card's ask, answer and `userEdits`. Write the run document beside the design
(`library/Designs/<Name>_run/runlog.md`) with the snapshots and the raw timing JSON.

Reference points, all measured: cyber1 (all-agent, ten cards, tool-built) ≈ 2 h. casa1 (phased, eight
cards, tool-built) ≈ 21 min agent + 6 min user — of which **9 m 54 s was drawing the plan call by call**
and 7 m 17 s was writing the per-sheet measurement toolkit. Stages A–D with the model built as one
`apply_model` should land near **5 min of agent time**: the drawing collapses to 0.05 s, stage A's ~3 min of
calibration moves to the user's two minutes of clicking, and what is left is measurement and verification.
If a run is slower than that, look at those two costs first — not at the number of cards.
