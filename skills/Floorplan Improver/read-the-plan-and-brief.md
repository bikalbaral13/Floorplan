---
id: read-the-plan-and-brief
name: Read the input plan, measure its rooms, and take the brief from whatever the user gave
category: Floorplan Improver
when: First step of every improve run — before a single object is chosen.
tools: [Bash, Read, Glob]
requires: [read-space-boundary-in-metres]
---

Two things have to be true before anything is placed: you know **what each room is and how big it really is**, and you know **what the user wants it to look like**. Neither is guessable from the JSON alone.

## 1 — Parse the plan, and never assume its shape

The canvas format is:

```
schemaVersion, settings{library_path, units, northbearing, pixelsPerMeter, keywords, source},
nodes[{id,x,y,layer,attachments?}], segments[{id,fromNodeId,toNodeId,layer,thickness,…,attachments?}],
spaces[{id,nodeIds[],layer,label,showLabel,roomType,fill,stroke,fillOpacity,attachments[]}],
layers[{id,name,color,visible,locked,order}], imageUnderlay{…}, graphAttrs{nodes{},segments{}}
```

Read `settings.pixelsPerMeter` **from the file** and use it for every conversion. It is not 100, it is not a round number: the reference bedroom is 145.0187 px/m and Windsor Park was 66.36. Anything you compute in pixels — a room's width, a downlight pitch, a node position — divides by that number to become metres, and every `params` value you write is in **metres**.

An input that already carries attachments is being improved a second time. **Do not duplicate.** Index the existing attachments by `(hostId, objectId)` first, and treat that index as the thing you are topping up.

## 2 — Measure every space, in metres

For each space, walk `nodeIds` → the node coordinates, and compute in metres:

- the **shoelace area** — this is the number that drives every sizing decision below,
- the **oriented bounding box** (longest edge = U axis, its perpendicular = V), giving clear length × breadth,
- the **longest uninterrupted wall run** per side, after subtracting every opening on it,
- the **door and window openings on each side**, from the segments carrying `isObjectOpening` or a `door-with-math` / `window-with-math` / `opening-with-math` attachment, each with its centre, clear width and swing side.

The space ring lies on the wall **centrelines**, so the clear internal dimension is the ring dimension minus the two half-thicknesses. Take the wall thickness from the `wall-with-math` attachment's `thickness` param, not from the segment's pixel `thickness`.

## 3 — Classify each room

In priority order:

1. **The label**, normalised — `M. BEDROOM`, `MASTER BED`, `BED 2` → `bedroom`; `TOILET`, `WC`, `BATH`, `ATT. TOILET` → `bathroom`; `KIT` → `kitchen`; `LIV`, `DRAWING`, `HALL` → `living`; also `dining`, `study`, `pooja`, `store`, `utility`, `balcony`, `corridor`, `stair`, `entry`.
2. **The fixtures already in it** — a `toilet` or `washbasin` makes it a bathroom whatever the label says; a `kitchen-counter` makes it a kitchen.
3. **Area and adjacency**, when the label is generic (`Space004`): under 3 m² off a bedroom is an attached toilet; a long thin space touching three doors is a corridor; the space containing the entry door is the living room.

Write the decision down per space — the verify step reads it back, and a room classified wrong is the single largest source of a bad fit-out.

## 4 — The ceiling heights, decided once

Three numbers, and they are used by dozens of objects, so fix them here and pass them everywhere:

- **`slabHeight`** — the structural soffit. Take it from the `wall-with-math` `height` param (3.3528 in the reference). Never invent 2.7.
- **`bandSoffit`** — the underside of the false-ceiling perimeter band, typically `slabHeight − 0.38`.
- **`panelSoffit`** — the underside of the centre panel, typically `slabHeight − 0.23`.

Downlights, cove, pendants, curtain tracks and cornices all mount to one of these three. A downlight whose `mountHeight` is 2.7 in a 3.35 m room hangs in mid-air.

## 5 — Take the brief

Four sources, in descending authority — and ABOVE all four, the plan's own locked moodboard picks. Use the highest one present; fall back for anything it leaves open.

**0. Locked moodboard picks — `plan.moodboards`.** A plan saved from the editor after Files ▸ Import Moodboard carries, per board, the option the user PICKED for each room, already bound to this plan's space ids (`pick.spaces`). `moodboardPicks(plan)` indexes them by space and reports the rest. Only `status: "locked"` is a decision: it is the user's latest explicit word on that room and outranks the scope form, the prompt, an image and the room defaults for everything it states. `shortlisted` = still deciding — report it, never apply it. A locked pick states things in three fields, all filled AFTER the pick: `materials[]` (by surface: floor, ceiling, counter, joinery, upholstery, backsplash, wall…), `objects[]` (category + objectPath + params) and `lighting.cct`. **A locked pick with none of them is a brief, not an instruction** — its `image` and `takeaway` go into your reading as a source-c image; list it under "locked, nothing to apply yet" and never invent a material path from the picture. See Floorplan Improver `floorplan-improver-scripts` ▸ Moodboard picks.


**a. The scope form.** `improve-scope-form.html` + `improve-scope.questions.json`, answered by the user, produces a run plan: level, style, palette, tile spec, lighting mood, per-room overrides, what to emit. **You never answer this form yourself** — hand it over and wait. If the user has pasted the run-plan text back, parse it; every `option.path` in it maps to a param you set.

**b. The prompt.** Read style words literally and bind them: "warm hotel bedroom" → `kelvin` 2700, `dimToKelvin` 2400, `materialPath` on oak/linen; "minimal" → `trim: "Flush"`, `showFrame: false`, `profile: "Shadow gap"`; "budget" → fewer light points, vitrified tile not marble, no cove. Words like *calm*, *airy*, *warm* belong in `semantics`, which is what the render pipeline actually reads.

**c. An image.** A mood board or a reference interior is read for **palette, material and fixture style only** — never for dimensions. Pull three to five material words per surface (floor, walls, ceiling, joinery, soft goods) and map each to a real `library/Materials/…` path. If no material matches, say so and use the nearest, rather than inventing a path that will 404.

**d. A spec file.** A BOQ, a finishes schedule, a client sheet. Anything it names by size or model wins over every default in `choose-the-fitout-set` — a schedule that says 800×800 mm vitrified sets `cellSize` 0.8, and that is the end of the discussion.

**When none of the four is present**, use the defaults in each downstream skill and **list every default you fell back to** in the report. Do not ask the user a question you can answer with a stated assumption, and do not stop the run to ask one.

## 6 — Check the library before you promise anything

List `library/Objects/Architectural/` and `library/Materials/` once, at the start, and hold the result. Every `objectPath` and `materialPath` you write must exist in that listing. An object that is not there is either substituted with the nearest that is — and reported — or authored first (`author-missing-parametric-object`), baked alone, uploaded, and only then referenced.

## Recording whether the floor was actually SAID

For each room keep `floorStated`: the explicit floor spec if the user gave one (form question answered by
them, prompt, image, schedule), otherwise `null`. Accepting the whole form with its defaults leaves it
`null`. `lay-out-tiles-and-floor-finishes` uses it to apply the room defaults (bedroom → oak veneer,
kitchen → marble, toilet → terrazzo) only when nothing was said.

