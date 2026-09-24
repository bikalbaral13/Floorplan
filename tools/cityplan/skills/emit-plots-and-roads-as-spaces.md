---
id: emit-plots-and-roads-as-spaces
name: Emit the subdivision as a canvas plan — spaces with plot.json and road.json, image underneath
category: City Planning
when: The layout is final and verified in metres. This turns it into the file the editor and the Library expect.
tools: [Bash, import_objects, list_spaces]
requires: [cut-plots-along-roads, import-objects-scoped]
---

The output is the standard six-key plan — `settings · nodes · segments · spaces · layers · imageUnderlay` — with every parametric object referenced by `objectPath`, so it imports like any design in `Designs/`.

## What becomes what

| Layout element | Plan element | Object | Params |
|---|---|---|---|
| each plot | SPACE, label `PLOT-n`, layer `plot` | `Objects/Architectural/plot.json` | `identifyingType: "plot"`, `number`, `direction`, `status: "Available"`, `neighbours` |
| the park | SPACE, label `PARK`, layer `park` | plot.json | `identifyingType: "park"`, `number: 0`, `status: "Booked"` |
| any reserve sliver | SPACE, label `RESERVE` | plot.json | `identifyingType: "reserve"`, `status: "Booked"` |
| each road run | SPACE, label `MAIN ROAD 10 m` / `BRANCH ROAD 9 m` / `STREET 6 m`, layer `road` | `Objects/Architectural/road.json` | `identifyingType: "road"`, `color: "Asphalt"`, `thickness: 0.15` |
| each parcel edge | SEGMENT, `segmentType: "plot-boundary"`, layer `boundary` | `Objects/Architectural/plot_boundary.json` | `color: "Blue"` |

**One space per road RUN, not one per network.** The union of the runs is a ring full of holes — every block is a hole — and a space with forty holes is a poor thing to select, label or attach to. Runs overlap where they cross, and that is fine: the same object, the same fill.

**Every attachment needs its own `id`.** An id-less one takes the editor down on the next render (`verify-scribble-plan` in the Scribble skills explains the mechanism). Generate them.

## The frame — one factor, chosen for the editor

Metres go back to image pixels (÷ mpp) and then, together with the picture, are scaled by ONE factor into world pixels:

```
k     = ppm / (image px per metre)                 # 50 / 0.8716 = 57.36
world = (px − (W/2, H/2)) × k
underlay: x = −W·k/2, y = −H·k/2, width = W·k, height = H·k, scale 1, locked
```

This differs from the raster-tracer rule on purpose. The tracer adopts the image's own px/m because an architectural render is dense (50 px/m). A cadastral scan is 0.87 px/m, and a canvas at that scale is unusable — a 6 m street is five pixels wide, every default line thickness is a wall. So `pixelsPerMeter` is the editor's own 50, and picture and geometry are multiplied by the same `k`. The overlay is still exact: one multiply keeps every traced pixel on its pixel. `settings.source` records `metresPerPixel`, `worldPxPerImagePx` and the world origin so a reader can invert it.

`settings.northbearing` is the calibrated bearing; `units: "m"`; `library_path` the bucket, so every `objectPath` resolves.

## Two files

`<name>.json` with the image embedded as a data URL (self-contained, ~470 KB for a 260 KB PNG) and `<name>.noimg.json` referencing `Images/<file>` relative to `library_path` for when the picture is in the bucket. Both carry identical geometry.

## Pushing it live

`apply_model` over the bridge takes the converted model but does NOT set the editor's px/m — the file's `pixelsPerMeter` is only honoured on a real import. Emitting at 50 sidesteps that: a live push then reads in metres too (438 × 521 m for this parcel), and the underlay comes through when the converter carries `imageUnderlay` instead of nulling it.
