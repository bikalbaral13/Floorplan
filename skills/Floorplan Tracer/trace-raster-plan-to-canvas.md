---
id: trace-raster-plan-to-canvas
name: Trace a raster floorplan into an overlaying canvas JSON
category: Floorplan Tracer
when: The user hands over a raster floorplan (JPEG/PNG render, scan, brochure plan) and wants it replicated as a canvas plan JSON — walls, columns, doors, windows, spaces and furniture — that overlays the image exactly when both are imported. If they want to WATCH and steer it stage by stage in the app, use trace-raster-plan-live instead.
tools: [Bash, Read, get_state, list_spaces, snapshot_canvas]
requires: [pdf-intake, calibrate-scale-from-printed-dimensions, measure-wall-bands-from-pixels, read-openings-and-fixtures-by-zoom, author-plan-graph-in-image-pixels, verify-trace-overlay-and-areas]
---

**Handed a PDF, not an image?** Run `pdf-intake` first. It finds every plan on every sheet, crops each one at 300 dpi into `library/Images/<Project>/`, gets the user to confirm the crops, and reports the document kind. Then route by it:
- `single`: this pipeline, on the one crop;
- `multi-level`: `trace-multi-storey-plans`;
- `masterplan`: `trace-master-plan`, which places several buildings on a site as groups.

Never trace straight off a PDF page render. The title block, key plan and notes get measured as walls.

**Several floors of one building?** Trace each sheet with this pipeline, then combine them with `trace-multi-storey-plans` — per-sheet calibration, a shared stair/lift anchor, and one multi-level JSON with a level per storey.

This is the whole pipeline, in order. It has produced two plans: a furnished 3BHK render (605 × 799 px, 52.9 px/m; 217 nodes, 159 segments, 18 spaces, 56 objects, rooms within ±1 %) and a brochure 2BHK with coloured walls and RCC columns (Windsor Park B1, 1500 × 1086 px, 66.4 px/m; 105 nodes, 111 segments, 12 spaces, 41 objects incl. 9 columns, 5 doors, 6 windows, 3 leaf-less openings, every printed room reading exactly as printed in the editor label). No ML detector was used: the trace is **pixel measurement + printed dimensions + your own reading of zoomed crops**, which is more accurate than a box detector on a clean plan and needs no API key. A 2BHK takes about 40 tool calls end to end when the scripts below are copied rather than rewritten.

**The one rule that makes the overlay exact:** author every coordinate in **image pixels**, place the underlay at scale 1 with its top-left at world `(-W/2, -H/2)` — exactly where the editor drops a manually imported image — and set `pixelsPerMeter` to the image's own px/m from calibration. Then `world = image_px − (W/2, H/2)`, nothing is resampled, and a wall drawn on a measured pixel lands on that pixel.

1. **Get the file on disk** (a signed GET from the bucket for `library/Images/<file>`) and read its true pixel size. Never work from a screenshot of the image — the size must be the file's. Look at the whole image once, then only at crops.
2. **Sample the wall colour, then measure the walls** (`measure-wall-bands-from-pixels`): choose the dark threshold above the wall FILL level (brochure walls are brown ≈ 78 gray with black edges, so `gray < 105`, not 80), find the bands, refine each wall's two faces, list the darker column blocks separately, and read the dark/light runs along each band — the light runs ARE the doors, windows and open boundaries.
3. **Calibrate, then solve** (`calibrate-scale-from-printed-dimensions`): read every printed room dimension, measure the matching clear spans between the refined inner faces, fit one px-per-foot by least squares, report every residual (stop if the max is above ~0.2 ft on more than one pair) — and then place the wall centrelines FROM the printed spans plus half-thicknesses, anchored on two or three measured lines, so every printed room reads exactly as printed in the editor's label.
4. **Read what pixels cannot tell you** (`read-openings-and-fixtures-by-zoom`): grid-labelled crops at 3–4× for labels, door arcs (hinge by equidistance, swing by side), window types, the brochure symbol legend (stripes = wardrobe, V = TV, X = duct), and every furniture footprint with its rotation.
5. **Author the graph** (`author-plan-graph-in-image-pixels`): one build script, all constants in image px, emitting the standard plan format — shared nodes, `line` segments carrying the Wall object, column objects on the wall lines, pre-cut opening pieces carrying Door / Window with hinge/swing set by the door's own maths, leaf-less gaps as wall-thickness pieces carrying opening.json, walls ending on the shared node at every 90° bend (no stubs past a junction), space rings on the wall centrelines with the Room object, degenerate marker segments for node-hosted furniture. No open polylines touching walls from outside.
6. **Verify before reporting** (`verify-trace-overlay-and-areas`): computed space areas vs printed L×B, a headless bake of every attachment, a composite overlay proof drawn from the baked `plan2d` footprints, and finally an import through the app's own JSON importer (never `apply_model`) checked with `get_state` + `list_spaces` + a screenshot.

Deliver `plan.noimg.json` referencing `Images/<file>` relative to `settings.library_path` (~110 KB) — copied into the repo as `<Name>.json` and uploaded to `library/Designs/<Name>.json` — and keep `plan.json` with the image embedded as a data URL (~320 KB) for anyone without bucket access.

Report in plain sentences: the calibrated scale, the max calibration residual, the per-room area deltas, and anything you had to guess (a door width, a niche, what a symbol was). Never paste the JSON into chat.

**Objects are part of the trace.** Walls, openings and spaces alone are an unfinished trace: every furniture and fixture symbol is placed at its measured centre, size and rotation (rotation from the BACK table in `trace-multi-storey-plans` step 5b, verified by a baked-footprint overlay) or listed as not placed with the reason. Only the user's scope form may exclude them.

The scripts that implement steps 2–6 are collected in `floorplan-tracer-scripts` — copy them, do not retype them.

**Working with the user instead of for them.** This pipeline runs to completion and hands back a file. When
the user wants to watch it happen and correct it as it goes — nudging a wall, fixing a door swing, telling
you a span is wrong — run `trace-raster-plan-live` instead: same measurement and the same arithmetic, but
each stage is drawn on the live canvas and handed to them at a checkpoint before the next one starts. Prefer
this one when accuracy on a hard brochure plan matters more than steering; prefer the live one when the user
has said they want to be in the loop.
