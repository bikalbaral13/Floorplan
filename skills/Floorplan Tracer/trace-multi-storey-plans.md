---
id: trace-multi-storey-plans
name: Trace several floor sheets into ONE multi-level canvas JSON
category: Floorplan Tracer
when: The user hands over more than one floor of the same building (ground + first + terrace, often separate PDF pages or images) and wants one plan with a level per storey that stacks in 3D. For a single floor use trace-raster-plan-to-canvas; for several BUILDINGS (or a site sheet) use trace-master-plan.
tools: [Bash, Read]
requires: [pdf-intake, trace-raster-plan-to-canvas, calibrate-scale-from-printed-dimensions, measure-wall-bands-from-pixels, verify-trace-overlay-and-areas, floorplan-tracer-scripts]
---

Every floor is traced exactly as the single-floor pipeline does it — **in its own image pixels, calibrated from its own printed dimensions** — and only then mapped into one world frame. First run: Ramanadhapuram Villa 1 (Spacemote PDF pp. 11–13 → `library/Designs/Ramanadhapuram_Villa1.json`): ground 101 wall/opening segments / 19 spaces / 41 objects, first 75 / 13 / 36, terrace stair head 14 / 3; calibration residuals ≤ 0.06 ft on every sheet; the two full floors' exterior walls land within 1 cm of each other.

## 1 — Get one image per floor

From a PDF, run `pdf-intake`. It renders each plan at 300 dpi, masks the title block and key plan, labels each crop with its building and floor, and after the user confirms, uploads to `library/Images/<Project>/` with a `manifest.json`. Take the floors of ONE building from `manifest.buildings[]` in floor order (B2 < B1 < GROUND < FIRST … < TERRACE). A region with `repeats` is one level repeated by elevation.

Keep every sheet's crop independent; do NOT try to crop them to the same box. From images (no PDF), upload one per floor to `library/Images/<Project>-<building>-<floor>.png` as before.

## 2 — Calibrate EACH sheet separately

"NTS" sheets are not at the same scale even inside one set: Villa 1's ground sheet measured 66.01 px/ft and its first-floor sheet 64.57 px/ft — a 2 % difference that would put the upper walls 20 cm off if one scale were assumed. Fit px/ft per sheet from that sheet's printed room spans (least squares, report residuals). A sheet with too few printed spans (a terrace with one stair box) borrows the scale of the sheet it was drawn with — check it is consistent with the one span it does print.

## 3 — Pick a vertical anchor and align in metres

Choose a line that is physically the same on every floor — **the staircase or lift core** (it must stack), plus one exterior wall. Per sheet record `anchorPx = [stair-left wall centreline x, bottom exterior wall centreline y]`. The world frame is metres × a common `PPM` (use 100):

    world = (imagePx − anchorPx) × PPM / sheetPxPerMetre

**Check it**: map the other exterior walls through it — on Villa 1 the right wall came out 8.956 m (ground) vs 8.955 m (first), left −4.009 vs −4.007. A disagreement over ~3 cm means a wrong anchor or a wrong scale; do not continue.

## 4 — Measure bands automatically, then correct by eye

`rects.py <sheet>` → straight wall bands (grey fill + red columns, long pixel runs clustered into rectangles). `auto.py <sheet>` → merges them into centrelines, lists the gaps along each line as openings, classifies a gap as a window when its strip contains light-blue glazing pixels, and writes an overlay. Then read the gridded sheet (`grid.py`) and write the spec by hand, fixing what the pixels cannot know:

- a **double lift/shaft wall** (two thin bands 20 px apart) is ONE line at their joint centre;
- a lift door and a vent read as gaps with no cyan — reclassify (lift = door, vent = small window, sill 1.5);
- a leaf-less gap (foyer → dining, wardrobe entry) is an `opening`, not a door;
- folding / sliding glass walls and balcony glass railings are `window` pieces (sill 0 / sill 1.0 lintel 1.0);
- a band that is split by a tiny offset (utility wall 13 px off the lift wall) is snapped onto one line — say so in the report;
- dashed "double height" boundaries are not walls: the void is a space with no band on that edge, and the floor above gets a **railing** (a thin wall piece, height 1.0) along it.

## 5 — Build all levels in ONE script

`build.mjs` holds one spec per sheet: `lines: [["H"|"V", centrePx, thicknessPx, [[kind, fromPx, toPx, opts], …]]]` with kinds `w` wall · `d` door · `win` window · `g` glazing · `o` opening · `r` railing/parapet (thin, own height), and `spaces: [[label, [x0,y0,x1,y1] | ring]]`. The builder, per level:

- snaps each run's first/last end and every ring corner onto the nearest perpendicular centreline (≤ 45 px), so junctions share nodes;
- splits every wall at any node lying inside it (T-junctions) — the single-floor rule "walls end on the shared node";
- emits the standard constructs (Wall object on every wall/door/window piece, pre-cut `isObjectOpening` pieces, rings on centrelines with the Room object);
- sets the level's `imageUnderlay` to its own sheet at `scale = PPM / sheetPxPerMetre`, positioned at `−anchorPx × scale`, so each level's underlay overlays its walls exactly.

Output is the packed multi-level format (`schemaVersion: 2`): top-level `nodes/segments/spaces` empty, `activeLevelId`, and `levels: [{ id, name, elevation, height, nodes, segments, spaces, imageUnderlay, graphAttrs, rooms: [], furniture: [], objects: [] }]`. Elevations stack by floor-to-floor height (3.2 m unless the section says otherwise — report it as a judgement). Wall `height` = the level's floor-to-floor.

## 5b — Objects, per sheet (not optional)

A trace is not finished until every furniture / fixture symbol on every sheet is either placed or listed as not placed with a reason. Skipping objects "to save time" is not allowed; only the user's scope form may exclude them. Villa 1: 41 objects on the ground floor, 36 on the first.

1. **Read each footprint from that sheet's gridded crop** (`grid.py <sheet> x0 y0 x1 y1 100 <scale>` per room group): centre and the two extents in THAT sheet's image px. Never reuse another sheet's px — the sheets differ in scale.
2. **Decide the back side from the symbol** (N = image up):

   | Symbol on the sheet | Library object | Its back is… |
   |---|---|---|
   | bed with pillows / headboard band | `bed` | the pillow end |
   | WC: oval bowl + rectangular cistern | `toilet` | the cistern side |
   | round or oval bowl with a tap mark | `washbasin` | the tap side (the wall) |
   | hatched / slashed strip along a wall | `wardrobe` | the wall |
   | long thin unit with a line (TV) | `tv-unit` | the wall |
   | small squares either side of a bed head | `nightstand` | the wall behind the bed |
   | sofa: back band + seat cushions | `sofa` | the back band |
   | armchair / lounge chair (cushion drawn on one side) | `armchair` | the cushion (back-rest) side |
   | dining chair tucked to a table | `chair` | away from the table |
   | counter strip + sink square | `cabinet` + `kitchen-sink` | the wall |
   | 3–4 burner circles | `stove` | the wall |
   | tall rectangle by the kitchen wall | `refrigerator` | the wall |
   | plan tree / star symbol | `plant-potted` | — |
   | rectangle or circle with chairs round it | `table` | — (x-extent, y-extent) |

3. **Turn the back side into `rotation` with the measured BACK table** (object's back at rotation 0, from the Floorplan Improver's headless bake), never by guessing:

   | object back at 0° | back W | back N | back E | back S |
   |---|---|---|---|---|
   | −x: bed, toilet, chair | 0 | 90 | 180 | 270 |
   | −y: washbasin, armchair | 270 | 0 | 90 | 180 |
   | +y: wardrobe, tv-unit, nightstand, sofa, cabinet, kitchen-sink, stove, refrigerator | 90 | 180 | 270 | 0 |

   Sizes: "across" = the extent along the back wall, "along" = away from it; `build.mjs`'s `SIZE` map converts them to each object's own params (bed length = along, width = across; wardrobe width = across, depth = along; …).
4. **Write them into the sheet's spec** as `objects: [[kind, cxPx, cyPx, acrossPx, alongPx, back, extraParams]]`. The builder maps the centre through the shared anchor and emits the node-hosted shape (node + attachment, zero-length marker segment on the `furniture` layer, `graphAttrs.nodes` "object").
5. **Verify by baking, not by eye**: `multi/bakeobj.mjs` runs every object's own Math Engine headlessly (Improver `bake.mjs`, objects downloaded beside it) and `multi/overlay_obj.py` draws the REAL plan footprints on each sheet. Check every pillow end, cistern and tap lands where the sheet draws it — a 180° error is invisible in the spec and obvious here.
6. **Report what was not placed**: symbols with no library object (pooja unit, thulasi maadam planter, staircase treads, rugs, cushions, water tank) — listed, never forced onto the nearest object.

## 6 — The half storey

A terrace sheet usually draws only the stair head room and the roof outline. Trace the head room from the sheet; take the **roof edge from the floor below's exterior wall centrelines** (mapped through the shared anchor), and draw it as 1.0 m parapets (`r`). The open terrace is one space ring: roof outline with the head room cut out. Tanks and services drawn dashed are reported, not traced.

## 7 — Verify

- per sheet: the overlay proof (`overlay.py`) — walls, doors, windows and rings drawn back into image px on the sheet — for every level;
- objects: the baked-footprint proof (`overlay_obj.py`) per sheet, and the not-placed list;
- cross-level: the core (stair / lift walls) and exterior walls agree between floors within ~3 cm;
- import through the editor's `.json` file input (never `apply_model`), then check the level tabs list every storey, each level's Nodes / Edges / Areas counts, "(missing)" count 0, and a 3D screenshot with the **All** tab showing the stacked building.

Report: each sheet's px/ft and max residual, the anchor used and the cross-level agreement, floor-to-floor heights assumed, and every reclassification from step 4.
