---
id: trace-assigned-parcel
name: Trace the assigned parcel — precisely, and only that one
category: City Planning
when: After calibration. The map shows every parcel in the district; one is assigned and the rest are neighbours. The boundary you trace is the boundary the client sees overlaid on their map, so it has to sit ON the drawn line.
tools: [Bash, Read]
requires: [calibrate-scale-and-north-from-annotations]
---

The assigned parcel is marked — a circle around its number, a hatch, a colour. Use ONLY it. The map has fifty others and the algorithm will happily subdivide the district.

## Fill, don't detect

No box detector: a cadastral scan is black lines on white, and a parcel is the region inside them. FLOOD-FILL from a seed pixel inside the assigned parcel, with the boundary defined as every dark pixel — dilated by one pixel to close hairline gaps in the scan.

**Count the annotation strokes as boundary too.** A dimension stroke is drawn ON the boundary it measures and hides the black line under it; if red is treated as open the fill leaks straight through into the neighbour, and the "parcel" comes out as 60 % of the map. The blue circle around the parcel number is inside the parcel and must NOT be boundary, or the seed is trapped in it — seed on the number, fill through blue, stop at black and red.

If the fill's bounding box is bigger than the parcel could be, look at the overlay before believing it: paint the filled pixels over the scan and READ the picture. On this scan the "leak" was the parcel — an L with an arm running under the diagonal neighbour.

(The Vectorisation skills' raster-to-plan flow is the other route — it traces every line on the sheet as a graph. It is the right tool when you need ALL the parcels; for one assigned parcel the fill is simpler and cannot pick up a neighbour's edge.)

## Grow the fill back onto the line

The fill stops at the dilated INSIDE of the line — about 2 px short of the line's centre, which is 2 m at this scale, on every edge, all the way round. Grow the region back by 2 px (morphological dilation) before outlining it, so the trace sits on the centre of the drawn boundary. The first version skipped this and the whole outline sat a metre and a half inside the map's line.

## Outline the fill the dumb way

Every horizontal run of filled pixels is a rectangle; the boolean union of those ~500 rectangles is the exact staircase outline. This cannot fail. A Moore-neighbour boundary walk fails on the first one-pixel notch (the start pixel it finds is the notch), and a marching-squares chain breaks at the first inconsistent orientation. Take the largest polygon's outer ring.

## PRECISION: simplify adaptively, so a curve becomes many short segments

Douglas–Peucker is already adaptive — it keeps a vertex only where the boundary leaves the chord by more than the tolerance — so the whole question is the tolerance. At 5 px (6 m) an L came out as 14 vertices and every curved or slightly bowed edge was cut straight across, visibly off the map's line. At **1.5 px** the same parcel is 38 vertices: straight runs are still ONE segment each, and every bow, kink and curve is a chain of short segments lying on the line. That is what "smaller segments where the boundary curves" means in practice — do not add segments by hand; lower the tolerance and let the curve decide.

Two things the fine tolerance keeps that you must remove:

- **The closed-ring collapse.** DP on a ring where first == last makes the chord a point, every distance to it zero, and the ring collapses to ONE vertex. Split at the vertex farthest from the start, simplify each half, join.
- **Notches** where a red stroke crosses the boundary — a dent a few pixels wide and deep. A notch is a vertex whose two neighbours are close together (< 12 px apart) while it stands only a little off their chord (< 6 px); a real corner has long edges either side. Remove such vertices and repeat until none are left.

**Then prove it** (`verify-subdivision`, check 9): every vertex within 2.5 px of a dark or red pixel of the scan. Mean 0.3 px, worst 1.4 px is what a good trace reads.

## Entry

Snap the user's entry mark onto the nearest point of the traced boundary and record which edge it landed on. That edge is where the main road leaves the parcel and the side the numbering starts from.

## Deliver `site.json`

Image name and size, metres per pixel, north bearing, the parcel as a pixel polygon, its area in pixels and hectares, and the entry — everything the layout step needs and nothing about roads or plots. Keep the coordinates in IMAGE PIXELS: the overlay is exact only while nothing has been resampled. Downstream, every edge of this polygon becomes one `plot-boundary` segment, so a precise trace is also what makes the boundary editable edge by edge in the canvas.
