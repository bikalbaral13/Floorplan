---
id: calibrate-scale-and-north-from-annotations
name: Calibrate scale and north from what is drawn on the map
category: City Planning
when: First step on any map image — before the parcel is traced, because the trace is in pixels and everything after it is in metres.
tools: [Bash, Read]
---

A map image carries its scale in exactly one place: a segment somebody has written a length beside. Everything else is derived from that one number, so get it from the pixels, not from the annotation's shape.

## Scale — measured

Find the two ENDS of the dimensioned segment on the drawing, in pixels, and divide:

```
mpp = metres / hypot(x2 − x1, y2 − y1)        # 200 m over 174.3 px → 1.147 m/px
```

Take the ends off the underlying boundary line where the stroke was drawn, not off the stroke's own wobble — a hand-drawn red line wanders ±3 px, which is ±3 m here. When the stroke sits ON a boundary, read the boundary.

Sanity-check with something else on the map that has a known size: a road width, a parcel that is labelled. If a second measurement disagrees by more than ~5 %, the dimension is not what you think it is (it may be the whole side, not the stretch the stroke covers) — ask before building.

## What is NOT a measurement

"10m" written beside two parallel strokes at the entry is a LABEL: the width the client wants that road drawn. On this scan the strokes were 20 px apart — 23 m at the calibrated scale. Read it, do not measure it, and say in the report which numbers were read.

## North — measured from the shaft

The arrow's SHAFT is a straight stroke. Its principal axis (PCA of its red pixels) is north; the head and the letter N must be excluded from the box or they pull the axis. Orient the axis to point up the page (a north arrow does), then:

```
bearing = atan2(dx, −dy) in degrees, clockwise from page-up      # −24.3° → 335.7°
```

`northbearing` in the plan's settings is exactly that: degrees clockwise from up-the-page to true north. It changes nothing about the geometry — the drawing stays in image pixels — and everything about the compass words: a plot's `direction` and its `neighbours` (North/East/South/West) are computed against this bearing, not against the page.

**No arrow: assume 0° and say so.** Do not infer north from the street grid or a label.

## Print all three

Metres per pixel, the bearing, and the entry point snapped onto the traced boundary (with how far it had to snap). If the snap is more than a few pixels the mark was not on the assigned parcel's edge — which usually means the wrong parcel was traced.
