---
id: city-plan-from-parcel-image
name: Turn a parcel on a map image into a road-and-plot canvas plan
category: City Planning
when: The user hands over a map or cadastral image with one parcel assigned, a dimension, maybe a north arrow and an entry, and wants it subdivided — roads as spaces with road.json, numbered plots as spaces with plot.json — overlaid on the image.
tools: [Bash, Read, apply_model, import_objects, list_spaces, snapshot_canvas]
requires: [calibrate-scale-and-north-from-annotations, trace-assigned-parcel, lay-out-roads-by-limb-grid, cut-plots-along-roads, emit-plots-and-roads-as-spaces, verify-subdivision]
---

This is the whole pipeline, in order. It was built on a cadastral scan (1150 × 653 px, an L-shaped 8.7 ha parcel with a 200 m dimension, a north arrow and a 10 m entry marked in red) and produced 156 plots, a 15-run road tree and a park, every plot fronting a road, in about a minute of compute. The reference for what the RESULT should look like is `Images/Globusarima.jpeg` in the Library: ~60 ft near-square plots on both sides of straight roads, a wider main road from the entrance, narrower branches, plot numbers walking in from the gate.

**The one distinction that decides everything:** on a map, some things are MEASURED and some are READ. The parcel boundary, the calibration segment and the north arrow are measured, in pixels, from the pixels. A "10m" written beside two strokes is read — it is the road width the client wants, not a dimension of the drawing (those strokes were 23 m apart at the calibrated scale). Mixing the two up puts a 23 m road through the plan.

1. **Calibrate** (`calibrate-scale-and-north-from-annotations`): metres per pixel from the one segment whose length is given; north from the arrow's shaft, or 0° when there is none. Print both.
2. **Trace the assigned parcel** (`trace-assigned-parcel`): flood-fill from a seed inside it with the red strokes counted as boundary, outline the fill by unioning its pixel runs, simplify. Use ONLY the assigned parcel; the map has fifty others.
3. **Roads** (`lay-out-roads-by-limb-grid`): cut the parcel into limbs at its reflex corners, grid each limb in its own frame — a spine through the entry (main width), parallel streets spaced for two plot rows, cross streets every block — then join every detached piece to the entry with the shortest connector. Widths step down: entry, branch, street.
4. **Park**: a square of the asked share, beside the spine at the limb junction — the corner where straight plots come out worst anyway. Never centred ON the spine, or the main road dead-ends into it.
5. **Plots** (`cut-plots-along-roads`): frontage-wide cells along every road edge, row depth solved from the limb width, clipped to what is free, kept only if they touch their road; leftovers cut into frontage strips and merged to the neighbour with the longest shared edge, under a size cap; anything oversized split perpendicular to its frontage.
6. **Number and describe**: plots numbered by WALKING DISTANCE along the roads from the entry, not by cutting order; `direction` is the compass of the frontage under the calibrated north; `neighbours` names the plot on each side, "Road" on the frontage, "Empty" at the boundary.
7. **Emit** (`emit-plots-and-roads-as-spaces`): the standard six-key plan, image as underlay, one scaling factor between image pixels and world so the overlay is exact, `pixelsPerMeter` at the editor's own 50 — not the scan's 0.87.
8. **Verify** (`verify-subdivision`): eight checks on the geometry and the file. Then look at it.

Deliver `test_plot.json` (image embedded) and `.noimg.json` (image by Library path), a rendered overlay, and a plain-sentence report: scale, north, parcel area, plot count and size spread, road share, park share, anything reserved, and what you read versus measured. Never paste the JSON.

**Where it goes wrong.** Flood fills leak through dimension strokes drawn over boundaries (treat red as wall). Douglas–Peucker on a CLOSED ring collapses it to one vertex unless you split at the farthest point first. One grid over an L skews every plot in the arm (cut limbs). A boolean union of road runs glues corner-touching pieces the traffic cannot use (connect by overlap area). A leftover strip merged into one neighbour makes a 1,900 m² plot (shatter it first). And `polygon-clipping` throws on near-coincident edges (snap to millimetres, retry nudged).
