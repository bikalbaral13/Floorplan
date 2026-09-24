---
id: emit-improved-canvas-json
name: Write the improved plan — the exact shapes the canvas format expects
category: Floorplan Improver
when: Every object is chosen and positioned. This is how they become JSON.
tools: [Bash, Read]
requires: [choose-the-fitout-set, lay-out-tiles-and-floor-finishes, light-the-rooms, dress-ceiling-walls-and-trims, wire-services-and-render-kit]
---

Build the whole improved plan as **one model in one script**, then write it once. A round-trip test measured 6 granular calls at 4.30 s against 1 bulk build at 0.02 s — **215×** — and a 104-wall plan built in 0.02 s against 9 m 54 s for the identical plan assembled call by call. There is no reason to do this incrementally when the input and the output are both files.

## Coordinates

`nodes[].x/y` are in the plan's own **pixel** space. `settings.pixelsPerMeter` converts, and it is read from the input file — 145.0187 in the reference, 66.36 in Windsor Park. Every value inside a `params` object is in **metres**. A position computed in metres becomes `x_px = x_m × pixelsPerMeter`, and the two must never be mixed.

Do not touch `imageUnderlay`, and do not recompute `pixelsPerMeter`.

## The three host shapes

### A node-hosted object — furniture, lights, cameras, services

Three pieces, all required:

**1. A node carrying the attachment**, at the object's centre in pixels, `layer: "0"`:

```json
{"id":"n41","x":-492.56,"y":-782.33,"layer":"0",
 "attachments":[{"id":"att-024","objectId":"downlight-with-math",
   "objectPath":"Objects/Architectural/downlight.json","t":0,"flip":false,
   "params":{ … all params, metres … }}]}
```

**2. A degenerate marker segment** from that node to itself, on the object's own named layer:

```json
{"id":"obj-023","fromNodeId":"n41","toNodeId":"n41","layer":"downlight",
 "thickness":0.5,"color":"#334155","dashed":false,"mode":"line",
 "method":"center","segmentType":"wall"}
```

`fromNodeId === toNodeId` is what makes it a marker rather than a wall, and `mode: "line"` with `thickness: 0.5` is what keeps it invisible. This shape is copied verbatim from the working reference file — do not improvise it.

**3. A `graphAttrs.nodes` entry** keyed by the **marker segment's** id (not the node's):

```json
"graphAttrs": {"nodes": {"obj-023:end|obj-023:start": {"node-type":"object"}}, "segments": {}}
```

### A segment-hosted object — walls, doors, windows, trims, counters

An attachment appended to an existing wall piece's `attachments` array:

```json
{"id":"att-007","objectId":"skirting-with-math",
 "objectPath":"Objects/Architectural/skirting.json",
 "params":{"fitMode":"Exact", …},"t":0.5,"flip":false}
```

`t` is the position along the segment (0.5 = centre). A wall already carrying `wall-with-math` keeps it — append, never replace.

**THE `fitMode` TRAP — this one silently ruins every trim.** `"Fill segment"` is `wall.json`'s OWN vocabulary; its options are `Fill segment | Own length (centred)`. **Every other object** uses the host-aware frame's `Off | Max | Exact`, and its maths is `_notOff = fitMode != 'Off'` then `_exact = fitMode == 'Exact'` — so `"Fill segment"` lands in neither branch and the object quietly keeps its **default** length. Baked on a real 4.217 m wall:

| `fitMode` | skirting length drawn |
|---|---|
| `"Off"` | 3.000 m — the default |
| `"Max"` | 3.000 m — shrink-to-fit only, and 3 < 4.217 |
| `"Fill segment"` | **3.000 m — it does nothing** |
| `"Exact"` | **4.217 m — the wall** |

So: a trim that must run the wall (skirting, cornice, shadow gap, curtain track, a feature panel, a kitchen counter) takes **`"Exact"`**. Something hung at a point on the wall (art, a mirror, a towel rail, a paper holder) takes **`"Off"`** and positions itself with `t`. Only `wall-with-math` takes `"Fill segment"`.

**A shared wall carries ONE attachment list.** A party wall belongs to two rooms, so a mirror hung for the bathroom also appears in the bedroom next door unless it is bound to a face. `flipSide` does that — but only for objects anchored to an edge (`anchorDir: "Top-Center"`); a `Center`-anchored object straddles the centreline and ignores it. Measured on a west→east segment: `flipSide: false` puts the mirror on the **+y** side, `true` on **−y** — that is, `false` is the `perp(dir) = (−dy, dx)` side. Compute it from the owning room's centre with `flipToward()`; do not type it. On this plan that flipped two of seven fittings, and both would have been wrong by hand.

Two further consequences of one list per wall:
- **Never put two objects of the same kind on one segment.** Two wall-arts on a party wall render as duplicate React keys and one may be dropped. Give the second room a different wall.
- **Check which room a wall actually bounds, especially in an L-shaped room.** A bounding-box test will hand you the neighbour's wall: on this plan `seg-01x` reads as BEDROOM 3's north wall by bbox but is really A.TOILET 3's, and a picture went on it before the bake showed the mistake.

An opening piece keeps its `isObjectOpening: true`, its `thickness`, its `bufferStyle` and its `segmentType: "line"`. **Never change those** — they are what the mitre, the label and the wall gap depend on.

### A space-hosted object — room, ceiling, tiles, rug

An attachment appended to the space's `attachments`:

```json
{"id":"att-101","objectId":"tessellation-with-math",
 "objectPath":"Objects/Architectural/tessellation.json",
 "params":{ … },"t":0.5,"flip":false}
```

The host feeds the space outline in as `P`; you never write `P` yourself. A space object centres on the space's own anchor and **cannot be offset** — in an L-shaped room that anchor falls in the notch, so anything needing a position inside the room is a node object instead.

## Layers

One layer per element group, and it is what lets the user switch the fit-out off and see the shell again. The reference carries 31. Append to `layers[]`:

```json
{"id":"downlight","name":"Downlight wardrobe","color":"#eab308",
 "visible":true,"locked":false,"order":22}
```

Keep the shell's layers (`0`, `image`, `wall`, `door`, `window`, `space`) exactly as they came in, and give every new group a distinct `order` above them. Name them for what they are — `Ceiling Fan + Ring Light`, `Camera 04 Wardrobe wall` — not `Layer 12`.

## Ids

Never reuse an id. Scan the input for the highest existing `n…`, `seg-…`, `obj-…` and `att-…` and continue from there. The reference uses `n<N>` for nodes, `seg-<NNN>` for walls, `obj-<base36>` for markers and `att-<base36>` for attachments; matching that style keeps a diff readable.

## Settings

Three edits, and no others:

- **`settings.keywords`** — rewrite to describe the fit-out, because this string is read by the render pipeline: *"M. Bedroom fit-out, render-ready: materials bound, exterior context, render-look, bedding and styling, cornice and shadow gap, cameras with lens shift and clearance"*.
- **`settings.source`** — add the input file it was improved from, alongside whatever the tracer put there.
- **`settings.renderNote`** — one sentence on how to bake and render it, and any param renames a downstream tool needs to know about.

`library_path`, `units`, `northbearing` and `pixelsPerMeter` are **carried through untouched**.

## The build script

One script, all constants at the top in metres, one `JSON.stringify` at the end. Structure it as: read input → index existing attachments → per-space fit-out plan → emit nodes + markers + attachments → merge layers → write. Keep the per-room decisions in a single table near the top so a change is one edit, not a hunt.

Write two files when the caller asked for both: `<Name>_improved.json` referencing `Images/<file>` relative to `settings.library_path` (~110 KB), and optionally a copy with the image embedded as a data URL for anyone without bucket access.

## Never put two node objects on one point

The room centre is where a ceiling fan goes — and also where it is tempting to drop the `render-look`
marker, a sun or a camera. **Two node objects closer than a few centimetres share one node and BOTH
disappear from the bake**, with no error and no warning (the attachment count drops by exactly two). On
cropped_floorplan the fan and the render-look went this way, and the render lost its fan and its main
light kit. Offset every marker-only object (`render-look`, `light` type Directional, `exterior-context`)
at least 0.5 m from any fixture, and run `coincidentNodes(plan)` before writing — it must return `[]`.

## Two gotchas that have cost real runs

**`import_objects` first, or ids render "(missing)".** If the improved plan is ever applied to a live canvas rather than imported as a file, the object definitions must be imported before the model is applied.

**Bulk-apply only while nothing of the user's exists yet.** `apply_model` replaces the document. This skill writes a file, so it is safe by construction — but if you ever hand the result to a live canvas the user has already edited, every correction goes through a granular tool instead.
