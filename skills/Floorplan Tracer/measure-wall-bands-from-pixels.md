---
id: measure-wall-bands-from-pixels
name: Measure wall centrelines, thickness, columns and openings from the dark mask
category: Floorplan Tracer
when: Turning a raster plan's drawn walls into exact pixel coordinates — faces, centrelines, thickness, the RCC column blocks sitting on them, and where each wall is interrupted by a door, window or open boundary.
tools: [Bash, Read]
requires: []
---

On a rendered plan the walls are the only long straight bands of one flat colour. That makes them measurable to the pixel with 40 lines of numpy — do not estimate them by eye and do not hand them to a bounding-box detector.

1. **Sample the wall colour BEFORE choosing a threshold.** Print a few row/column profiles of `gray = mean(RGB)` straight across a wall. Two render styles exist:
   - *black-line plans* (the 3BHK render): the whole band is near-black → `gray < 70–80`;
   - *brochure plans with coloured walls* (Windsor Park): the band is a brown/grey FILL of gray ≈ 78 bounded by 2 px near-black EDGE lines. A `gray < 80` mask then keeps only the two edge lines and every wall comes out as two thin parallel bands (t = 4–5) with a light run between them. Raise the threshold ABOVE the fill level — `gray < 105` — and the band is solid again.
   Keep the saturation term `max(RGB) − min(RGB) < 70` in both cases; brown walls have sat ≈ 22, coloured tiles and furniture are higher.
2. **Find bands.** For every row, take dark runs longer than ~30–35 px; group runs that overlap on consecutive rows into a band. Do the same per column. A band with ≥3 rows is a wall; its row range is the two faces, its median run extent is the wall's length. Draw the bands on a 2× copy of the image and check them against the plan before trusting any number. Mask out the title block, key plans and legends by rectangle first, or they become bands.
3. **List the columns separately.** Brochure plans draw RCC columns as DARKER blocks (gray ≈ 41 against the wall's 78) sitting on the wall line and projecting past its outer face. A second mask `gray < 55`, a 5×5 binary opening (which deletes the 2 px edge lines), then `scipy.ndimage.label` gives every block as a rectangle `x0..x1 × y0..y1`. Anything longer than ~2 m is a dark wall piece, not a column, and is measured as a wall; the rest become column objects (see `author-plan-graph-in-image-pixels`).
4. **Refine each wall you will actually use.** For a horizontal wall pick a clean span (no openings, no text, no column) and take the rows where >60 % of that span is dark → the largest contiguous block of rows is `face0..face1`. Centreline = `(face0+face1)/2`, thickness = `face1 − face0 + 1`. Windsor Park: exterior 16–17 px (0.25 m at 66.4 px/m), partitions 10–12 px (0.15–0.18 m), columns 22–24 px (0.35 m). Use the measured value per wall — do not normalise them all to one thickness.
5. **Read the runs along the band.** Along the full wall span, take the band-majority mask (>50 % of the face rows dark) and run-length encode it. Every `#` run is solid wall; every `.` run ≥3 px is an interruption: a door leaf gap, a window (thin double/triple lines read as light), a cupboard niche or an open boundary between rooms. The run edges are the opening's exact start/end pixels — they go straight into the build script. A gap that the band pass cannot split (door frame lines inside it) is settled with a single-pixel profile across it: `row(y, x0, x1)` printed as numbers, where 0–10 is an edge line, ~78 is wall fill and >200 is floor.
6. **Snap to a shared coordinate.** Two collinear walls measured at 256 and 257 are one wall: pick one centreline per wall line and reuse the constant everywhere that line is touched. Two collinear walls of DIFFERENT thickness (a 10 px partition continuing as a 19 px wall over a shaft) still share one centreline — choose it so neither face is more than ~3 px (5 cm) off and give each piece its own thickness. Endpoints must be EXACTLY equal for the graph to form junctions and for spaces to close — the plan format keys nodes by exact position, with no tolerance.

Write the results to a JSON file (`walls_measured.json`) so the build script and the verification read the same numbers. A wall you could not find in the mask (hidden under a dark render element) is measured from its neighbours and flagged in the report.
