---
id: render-a-floorplan
name: Turn an improved canvas JSON into a render-ready Blender file
category: Floorplan Renderer
when: A canvas plan — normally one Floorplan Improver has already furnished — needs to become a .blend a person can open and render: materials bound, real lamps, cameras aimed, a plan view that reads as an architectural drawing. The deliverable is the .blend; the stills are only there to prove the cameras and the lighting.
tools: [Bash, Read, Write]
requires: [inspect-the-blend, bind-plan-materials, unblock-and-fix-the-scene, light-and-expose, frame-the-shot, model-soft-goods-and-edges, render-fast-on-cpu, verify-the-render, export-room-blend-glb-skp, floorplan-renderer-scripts]
---

`Json to Blender Render Ready` is the generic pipeline: it bakes a design's flows into geometry and builds a Blender scene. **This skill is the floorplan-specific layer on top of it** — the four things that pipeline does not know about a furnished floorplan, and the one deliverable it never produces.

```bash
node bake_plan.mjs   <plan>.json        --out plan.baked.json --repo <repo>
node enrich_plan.mjs plan.baked.json    --out plan.v2.json [--room "BEDROOM 2"]
blender -b --python render_plan.py -- plan.v2.json --out <ABS dir> \
        --no-render --no-glb                       # build and look at the counts
blender -b --python render_plan.py -- plan.v2.json --out <ABS dir> \
        --camera 1 --res 800 --samples 24 --cut 1.35   # prove the plan view
```

Three commands, because three machines: the bake needs the app's own flow evaluator in Node, the scene needs `bpy` inside Blender, and the enrichment is the plan knowledge that belongs to neither.

## What the deliverable is

**A `.blend`, not an image.** Stills are a test instrument: they prove the cameras point at something, the lamps are the right order of magnitude and no material came back magenta. Render them small — 24 samples at 700–800 px is about a minute — settle the exposure there, and hand over the file.

## The default view is a plan, and a plan is a CUT

When the user does not name a room, the deliverable is the **whole floor seen from above**. Two things make that read as architecture rather than as a photograph of a ceiling:

- **An orthographic camera.** `enrich_plan.mjs` adds one, sized to the plan's own extent with `orthoScale` = the long side in metres. A canvas plan never contains one: the cameras an interior carries are all eye-level shots. It is inserted **first**, so it is `scene.camera` and `--camera 1`.
- **`--cut 1.35`.** Without it the false ceilings, cove bands and cornices are simply the nearest surface to an overhead camera, and every furnished room comes back as a white rectangle. The flag hides every object whose **lowest** vertex is above the cut, which takes the lid off while keeping the walls — they start at the floor — the furniture and the fittings. On the 3BHK that is 235 objects.

With `--room "BEDROOM 2"` the same camera frames that room instead, and the interior cameras the plan carries are the ones to render.

## The four things the generic pipeline gets wrong on a floorplan

Each was found by rendering, not by reading, and each is silent.

**1. It never reads the plan's own materials.** `bake_plan.mjs` assigns from the global `finishes.interior.json` rules and from a wired Material node. A plan out of Floorplan Improver carries `params.materialPath` and `params.finishes` on nearly every attachment, chosen per room — and they are ignored. Measured on the 3BHK: **220 rows on flat colour, 159 of them on attachments already carrying the answer**, including the floor tile of all 12 rooms. `enrich_plan.mjs` binds them. See `bind-plan-materials` for the precedence and the em-dash rule.

**2. Its lamp loop only knew four fixtures.** `("light", "downlight", "pendant", "ceiling-fan")` — so every LINEAR source in the library was silently not a light at all. A cove at 900 lm/m round a 14 m perimeter is 12 600 lm, routinely the largest lamp in the room. `render_plan.py` now carries `LAMP_STEMS` with seventeen, and builds an AREA lamp for each from `lumensPerMetre × run`. The 3BHK went from 0 to **14 area lamps**.

**3. It read parameter names the object library had renamed.** `downlight` states `mountHeight` and `aimTilt`; the loop read `ceilingHeight` and `tilt`, found neither, and dropped all 41 downlights to the 2.7 m default — 70 mm below a 2.77 m panel soffit, on every one of them. Both names are read now, new first.

**4. It had no orthographic camera.** The camera object has always offered the view; nothing honoured it, so a plan view had to be faked with a long lens from very high and still showed perspective at the edges.

## Two defects this will find in the plan, not in the renderer

A render is the first thing that actually looks at the plan, so expect it to reject some of it.

- **A camera with no bearing points every shot the same way.** `rotation: 0` is east, so eight shots named for eight subjects all render the same wall. A camera's bearing is **derived** from what the shot is named for: in the plan frame, `atan2(dx, −dy) − 90`. Never typed.
- **`fitMode: "Exact"` scales the whole object, including its section.** A 3 m skirting asked to fill a 0.45 m wall piece comes back 0.45 m long, **3 mm thick and 14 mm tall** — in the wrong place, not merely shortened. There is no fitMode that stretches along the wall alone. A trim takes `fitMode: "Off"` and an explicit `length` measured from its host. `enrich_plan.mjs` reports every attachment whose `metrics.scale` is under 0.5.

## The one material rule that is specific to a furnished plan

**A pattern procedural must not go on geometry that already is that pattern.** `Finishes/tile.json` is a checker at 0.3 m that draws its own joints — correct for a flat floor plane, and a chessboard when laid over a `tessellation` field whose tiles are real geometry. A tiled floor built as geometry wants a plain veined surface: `Finishes/marble.json` (noise, scale 1.6, detail 9) for porcelain, `Finishes/ceramic.json` for a wet room. `bind-plan-materials` has the rest.

## Two tracks, and they are not the same job

**A plan view of the whole floor** is a drawing. The three commands above produce it, `--cut` takes the lid off, and it is done. Nothing below this line applies.

**A photographic interior of one room** is a render, and the .blend those three commands produce is the *starting point*, not the deliverable. It arrives with the plan's own lighting and materials, which are correct and which do not yet look like anything. Four passes take it the rest of the way, in this order, each as a script against the previous file so any one can be re-run:

1. **`inspect-the-blend`** — world-space bounding boxes, north, the room's contents, the lamps, the materials. Never `obj.location`: plan geometry has its coordinates baked in and sits at the origin.
2. **`unblock-and-fix-the-scene`** — take out what is in front of the window (a closed blackout, a transmissive glass shader), hide duplicates and bad props, fix the materials a plan export always gets wrong.
3. **`light-and-expose`** — daylight in through the right wall, warm light back, sun disc off, AgX +0.35. **Check total watts, not colour** — the default `--lm-per-w 184` under-lights an interior by two to three times.
4. **`model-soft-goods-and-edges`** — cloth sims on clean proxy colliders, a feature element behind the focal wall, and a bevel on every hard edge.

Then `render-fast-on-cpu` for the settings and the 30-second preview loop. On a four-thread laptop the whole thing is a four-minute render.

5. **`export-room-blend-glb-skp`** — when the user wants *the room*, not the floor: cut it out by its interior box and hand over `.blend` (master), `.glb` and `.skp`. The exchange copies need their procedurals baked first, and the `.skp` is written through `SketchUpAPI.dll` — **never by opening SketchUp on the user's machine**.

A worked example of all four passes, as scripts, is in this folder: `ne_bedroom_pass.py` (scene + materials + fluted feature wall + nightstands + plant + daylight + portals + cameras) and `ne_soft_goods.py` (cloth duvet, turn-down, knit throw, pressure-cloth pillows). They are one room's numbers, not a library — read them for the method.

**Skipping straight to lighting is the common mistake.** Tuning lamps to compensate for a closed curtain means every value is wrong the moment the curtain opens.

## Order of work

1. **Bake.** `attachments N with meshes N` must match; read the fall-through list.
2. **Enrich.** Read the three lines it prints: how many rows it bound, the plan camera's extent, and the `metrics.scale` warnings. A warning here is a plan defect — go back and fix the plan, not the render.
3. **Build with `--no-render --no-glb`.** Four seconds, and it proves geometry, materials, lamps and cameras before anything spends a minute path-tracing.
4. **Prove the plan view.** `--camera 1 --res 800 --samples 24 --cut 1.35`.
5. **Prove one interior.** `--camera 2 --res 720 --samples 24`. This is where a camera aimed at a wall shows up, and nothing else will tell you.
6. **Verify, then hand over the .blend.** `verify-the-render` has the checks.
7. **Export the room** if asked — `export-room-blend-glb-skp`.

## Flags worth knowing

`--cut <z>` plan-view lid removal · `--camera <n|name>` one view · `--lm-per-w` one number for the whole rig · `--sun` daylight alone · `--exposure` stops, cheaper than re-rendering · `--fan-lumens` a ceiling fan that states a light kit but no lumens · `--no-render` `--no-glb`.

**`--out` must be absolute.** Blender resolves render paths against the drive root in background mode, so a relative `--out` lands in `C:\out`.
