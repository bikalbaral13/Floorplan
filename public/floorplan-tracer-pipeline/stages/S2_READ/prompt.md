# S2 — Read the source

You write `reading.json` in the project folder. The stage validates it and (drawings) fits the scale. Ownership rule for the whole pipeline: **one look and one click → the user; many measurements and many draws → you. Never re-do what the user set** (their scale, their corrections).

## DRAWING branch — a measured plan, traced pixel for pixel

1. **Sample the wall colour before any threshold.** `python tools/wallbands.py <page> work/measure/<page>.walls.json --profile`. Black-line plans: walls `gray < 70–80`. Brochure plans: a brown/grey fill (gray ≈ 78) between 2 px black edges — use `--dark 105`, or every wall splits into two thin edge bands. Keep the saturation limit (`--sat 70`). Mask title blocks, key plans and legends (`--mask x0,y0,x1,y1`). Look at the `.png` proof before trusting a number.
2. **Columns are objects, not thicker walls**: the tool lists dark blocks (`--column-dark 55`); blocks longer than ~2 m are dark wall pieces.
3. **Refine each wall you use**: clean span, rows > 60 % dark → faces → centreline = (f0 + f1) / 2, thickness = f1 − f0 + 1. Use the measured thickness per wall; do not normalise. Collinear walls measured 1–3 px apart are ONE line: pick one centreline constant and reuse it.
4. **Openings by zoom, not by squint**: `python tools/grid_crops.py <page> x0 y0 x1 y1 work/crops/<name>.png --scale 4`. Quarter arc + leaf = hinged door (hinge = the gap end the arc is centred on — check the two arc ends are equidistant from it; swing = the side the arc lies on; two arcs = double). Two parallel thin lines in a wide gap, no arc = sliding glazed door. Thin double / triple line in an exterior wall = window (toilet ventilators short and high). A gap with no leaf and no glazing = a vacant OPENING (kitchen → living, balcony open side). Never trace a chajja / sill box outside a window (it closes into a sliver room).
5. **Printed sizes → scale.** Transcribe EVERY printed room size with its room name (`10' 5"` etc.; zoom ambiguous digits: `1'`/`7'`, `5"`/`6"`). Measure the matching CLEAR span (inner face to inner face) in pixels from the refined faces. Put them in `calibration.pairs`. If the user owns the scale (`scope.scale_owner = user`), put their px/m in `calibration.user_px_per_m` and the pairs only as a one-line cross-check — never a card, never a re-calibration.
6. **Symbols** (objects are mandatory when `scope.objects = all`): count every drawn fixture by kind in `symbols` — legend in `standards/DEFAULT.json → symbol_legend` (striped rectangle on a wall = wardrobe, V box = TV unit, dashed-X box = duct / shaft SPACE …). Every one is later placed or listed in `not_placed` with a reason.

```json
{"branch": "drawing",
 "sheets": [{"page": "P01", "level": "L0", "origin_px": [750, 543], "walls": "work/measure/P01.walls.json", "style": "brochure"}],
 "calibration": {"pairs": [["LIVING w", 1360, "20'6\""], ["LIVING h", 730, "11'"]], "user_px_per_m": null},
 "printed": [["LIVING / DINING", "20'6\" x 11'0\""], ["BEDROOM-1", "12' x 11'"]],
 "symbols": [{"kind": "bed", "count": 2, "level": "L0"}, {"kind": "wardrobe", "count": 2, "level": "L0"}],
 "notes": [], "assumptions": ["no printed size for the duct — measured lines kept"]}
```

## SKETCH branch — a photo of a scribble: intent plus a dimension chain, derived not traced

Separate three kinds of information before drawing anything:
- **GIVEN — believe these**: room names, printed dimension strings ("36ft outer", "10ft c-c"), wall-thickness notes, adjacency.
- **DRAWN — read, do not measure**: small squares at junctions = COLUMNS (count grid LINES, not squares); quarter arcs = doors (hinge + swing); a box with an arrow = stair (arrow = up); short parallel ticks = window.
- **INFERRED — you are deciding these, so say so**: unprinted bays, windows the sketch never drew, door widths, floor-to-floor.

Rotate until the text reads upright; follow the dimension LINE, not where its label sits. Pixel spacing is a proportion for splitting a known total, never a dimension (`bays[].px` in `dims.json`). **Present the reading back** as a text block diagram (bays across the top, rooms in cells, dimensions on the edges) with what you inferred, and ask ONE round of questions — the room arrangement, the inferred bays, and **the ambiguous cell** (the region where two rooms are drawn stacked that cannot both fit): compute the areas both ways, propose, let the user choose. Walk the circulation from the entrance: no room reached only through a bedroom; wet rooms on an outside wall. The stage only finishes with the user's confirmation (`--approved "<their words>"`).

```json
{"branch": "sketch",
 "given": ["36ft outer (E–W)", "25ft outer (N–S)", "10ft c-c west bay", "9 inch outer wall", "4 inch inner wall"],
 "drawn": ["4 × 3 column grid (12 columns)", "stair in the NW cell, arrow up north", "door arcs: hall→bed 1, hall→bed 2"],
 "inferred": ["E bays 12'0\" / 13'3\" from pixel proportions", "windows on every outer wall of habitable rooms", "floor-to-floor 3.0 m"],
 "rooms": [{"name": "HALL", "cell": "B-C / 1-2", "adjacent": ["VERANDAH", "BEDROOM 1", "KITCHEN", "BEDROOM 2", "TOILET"]}],
 "block_diagram": "  A        B          C              D\n3 +--STAIR--+--BED 1--+----KITCHEN-----+ ...",
 "ambiguous": [{"where": "C-D / 1-2", "options": ["bed 2 + toilet stacked", "toilet carved from the hall corner"], "areas": "…", "chosen_by_user": "toilet in the hall corner"}],
 "symbols": [{"kind": "staircase", "count": 1}],
 "questions_asked": ["…"], "answers": "the user's words"}
```
