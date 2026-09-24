---
id: improve-traced-plan
name: Improve a traced canvas JSON into a furnished, tiled, render-ready plan
category: Floorplan Improver
when: A canvas plan JSON already exists — usually straight out of Floorplan Tracer — and the rooms are empty or barely furnished. The user wants it back as a professionally fitted-out plan: furniture, tiles, lighting, false ceiling, trims, decor, services and the render kit. Input is a JSON, output is a JSON.
tools: [Bash, Read, Glob, Grep]
requires: [read-the-plan-and-brief, choose-the-fitout-set, lay-out-tiles-and-floor-finishes, light-the-rooms, dress-ceiling-walls-and-trims, wire-services-and-render-kit, emit-improved-canvas-json, verify-the-improvement, floorplan-improver-scripts]
---

The Tracer hands back a **shell**: walls on their measured centrelines, openings cut, spaces closed, and — at best — a few footprints. This skill is the step after. It reads that JSON, decides what a real room of that type and that size needs, and writes a second JSON in the same format with everything added. **Nothing is drawn on a live canvas and no tool call touches the app**: the input is a file, the output is a file, and the whole fit-out is built as ONE model.

A finished bedroom of this standard carries about **40 attachments across 31 named layers** — that is the measured shape of the reference fit-out (`floorplan_with_bedroom_v2_with_lightings.json`: 62 nodes, 56 segments, 2 spaces). A plan that comes back with a bed, a light and nothing else is a **failure, not a draft**.

## The one rule that keeps the improvement safe

**Never move a wall, a node or a space.** The Tracer solved those centrelines from printed dimensions and every room already reads exactly as printed. The improver is **additive**: it appends attachments, appends marker segments and their nodes, appends layers, and edits `settings.keywords` / `settings.source`. If a piece of furniture does not fit, the furniture is wrong — the plan is not. The verify step diffs the wall graph against the input and fails the run if a single wall coordinate moved.

The second rule: **every number in a param is metres**, while `nodes[].x/y` are in the plan's own pixel space at `settings.pixelsPerMeter`. Mixing the two is the classic way to get a 145-metre bed.

## The pipeline, in order

1. **Read the plan and the brief** (`read-the-plan-and-brief`) — parse the JSON, measure every space in metres, classify each room by label + area + fixtures, and pull the style brief from whichever of the four context sources the user gave: the scope form, the prompt text, a mood-board image, or a spec file. Decide the ceiling height once, here, from `wall-with-math`'s `height`.
2. **Choose the fit-out set** (`choose-the-fitout-set`) — the object list per room type, the sizes that actually fit, the orientation rule, the clearance zones. This is the decision; the later steps only place what it chose.
3. **Lay out tiles and floor finishes** (`lay-out-tiles-and-floor-finishes`) — a `tessellation-with-math` field per space at a real tile size, the right pattern and joint, a centred set-out, skirting-height border where the brief wants one, and the wet-area rules.
4. **Light the rooms** (`light-the-rooms`) — the downlight grid from a lux target, pendants over what they belong over, cove from the false ceiling, a fan in every habitable room, and the light groups and scene membership the render pipeline reads.
5. **Dress the ceiling, walls and trims** (`dress-ceiling-walls-and-trims`) — `false-ceiling` on the space, `cornice` / `shadow-gap` / `skirting` on every wall run, curtain track and pelmet over every window, wall panels and art.
6. **Wire the services and the render kit** (`wire-services-and-render-kit`) — switches at handle height, sockets at skirting height, the AC grille, wet-area services; then `render-look`, the sun `light`, `exterior-context` and the cameras that make the output drop straight into the Blender pipeline.
7. **Emit the improved canvas JSON** (`emit-improved-canvas-json`) — the exact shapes: a node object is a degenerate marker segment plus a node carrying the attachment; a segment object rides one wall piece; a space object attaches to the space. One layer per element group, one build script, one file.
8. **Verify before reporting** (`verify-the-improvement`) — the graph-unchanged diff, the per-room completion gate, a headless bake of every attachment, the clearance and overlap checks, and a re-import through the editor's own JSON importer.

## What "professional" means here, concretely

Not "more objects". A room passes when all of these hold:

- **Nothing floor-standing sits in a door swing** — every door and open bay owns a zone its own width across and 0.9 m deep on both sides.
- **No two floor-band objects overlap.** Bands are `floor`, `wall`, `high`, `surface`; only floor–floor pairs are tested. Columns are floor objects.
- **Every object faces what it is for.** A chair faces its table, a sofa faces its screen, a headboard is against a wall and never under a window.
- **The tile field is set out from the room centre**, not from a corner, so the cut tiles at opposite walls match.
- **Every light carries its `lamp`, `lightGroup`, `kelvin`, `lumens` and `sceneMembership`** — a light without them renders as a grey box.
- **Every object carries `materialPath` and `semantics`.** An object with a default `Finishes/plaster.json` on a bed is an unfinished object, and the glTF arrives white.
- **Every element group has its own named layer**, so the user can switch the fit-out off and see the shell again.

## Deliver

`<Name>_improved.json` next to the input, uploaded to `library/Designs/<Name>_improved.json`, with `settings.keywords` rewritten to describe the fit-out and `settings.source` carrying the input file it improved. Report in plain sentences: per-room object counts, the tile spec used, the lux achieved per room, and every judgement you had to make because the brief did not say. **Never paste the JSON into chat.**

The scripts that implement steps 1–8 are collected in `floorplan-improver-scripts` — copy them, do not retype them. The questionnaire that produces the brief is `improve-scope-form.html` + `improve-scope.questions.json`; the **user** answers it, never you.
