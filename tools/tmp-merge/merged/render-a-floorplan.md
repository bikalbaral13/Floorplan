---
id: render-a-floorplan
name: Turn a canvas design JSON into a render-ready Blender file — plan view, interiors, stills, GLB
category: Floorplan Renderer
when: A canvas design JSON — normally a floorplan Floorplan Improver has already furnished, but any design with attachments works — needs to become a .blend a person can open and render: geometry baked, materials bound, real lamps, cameras aimed, a plan view that reads as an architectural drawing, and optionally stills, a GLB, or one room exported as .blend/.glb/.skp. Not for the in-canvas 3D view, and not for the Faithful Space Render flow, which is an image model rather than a path tracer.
tools: [Bash, Read, Write]
requires: [bake-and-bind-materials, build-the-blender-scene, material-library, inspect-the-blend, unblock-and-fix-the-scene, light-and-expose, frame-the-shot, model-soft-goods-and-edges, render-fast-on-cpu, verify-the-render, export-room-blend-glb-skp, floorplan-renderer-scripts]
---

One pipeline, three commands. The first bakes a design into a payload, the second adds what the plan knows, the third turns the payload into a scene.

```bash
node bake_plan.mjs   <plan>.json        --out plan.baked.json --repo <repo>
node enrich_plan.mjs plan.baked.json    --out plan.v2.json [--room "BEDROOM 2"]
blender -b --python render_plan.py -- plan.v2.json --out <ABS dir> \
        --no-render --no-glb                       # build and look at the counts
blender -b --python render_plan.py -- plan.v2.json --out <ABS dir> \
        --camera 1 --res 800 --samples 24 --cut 1.35   # prove the plan view
```

Every script is in this folder (see `floorplan-renderer-scripts`). Everything else in this skill explains a decision one of those commands makes, or a pass that takes the .blend further.

## Why three commands and not one

They need different machines. The **bake** needs the app's own flow evaluator — the TypeScript that turns `params` into face rings — and that only runs in Node against the repo (`bake_plan.mjs` shells out to `tools/bakeplan/run.mjs`; it is never reimplemented). The **scene** needs `bpy`, which only exists inside Blender. The **enrichment** is plan knowledge that belongs to neither: the plan's own per-attachment materials, the plan-view camera, the plan defects. So the baked JSON is the contract: geometry in metres, a material path per row, and the material definitions embedded.

`enrich_plan.mjs` is optional for a bare design (no `materialPath`/`finishes` params, no need for a plan view) — `render_plan.py` reads `plan.baked.json` directly. For anything out of Floorplan Improver it is not optional: without it 159 of 220 grey rows on the 3BHK stayed grey.

## What the deliverable is

**A `.blend`, not an image.** Stills are a test instrument: they prove the cameras point at something, the lamps are the right order of magnitude and no material came back magenta. Render them small — 24 samples at 700–800 px is about a minute — settle the exposure there, and hand over the file.

## What arrives in the .blend

| Collection | What is in it |
|---|---|
| `Walls` `Doors` `Windows` `Spaces` | one object per render row of the plan's wall, door, window and room attachments |
| `Objects/<Kind>` | everything else, grouped by object — `Objects/Wardrobe`, `Objects/Bed` … |
| `Lighting` | real Blender lamps built from the fixtures' own lumens, kelvin and beam angles |
| `Cameras` | the plan view first (when enriched), then one per camera attachment, with focal length, sensor and eye height |
| `Helpers` | camera bodies, tripods, view cones, aim tubes — `hide_render` on, so they document the setup without appearing in it |

Every mesh object carries `bp_host`, `bp_object`, `bp_row`, `bp_surface` and `bp_material` as custom properties. Select anything and the outliner says which attachment of which host it came from and which library material it is wearing — which is also how to find the one row that came out grey.

## The default view is a plan, and a plan is a CUT

When the user does not name a room, the deliverable is the **whole floor seen from above**. Two things make that read as architecture rather than as a photograph of a ceiling:

- **An orthographic camera.** `enrich_plan.mjs` adds one, sized to the plan's own extent with `orthoScale` = the long side in metres. A canvas plan never contains one: the cameras an interior carries are all eye-level shots. It is inserted **first**, so it is `scene.camera` and `--camera 1`.
- **`--cut 1.35`.** Without it the false ceilings, cove bands and cornices are simply the nearest surface to an overhead camera, and every furnished room comes back as a white rectangle. The flag hides every object whose **lowest** vertex is above the cut, which takes the lid off while keeping the walls — they start at the floor — the furniture and the fittings. On the 3BHK that is 235 objects.

With `--room "BEDROOM 2"` the same camera frames that room instead, and the interior cameras the plan carries are the ones to render.

## Four things that were silently wrong, and are fixed in this folder's scripts

Each was found by rendering, not by reading. They are recorded so nobody reintroduces them.

**1. The plan's own materials were ignored.** A plan out of Floorplan Improver carries `params.materialPath` and `params.finishes` on nearly every attachment, chosen per room; the bake only knew wired Material nodes and the global `finishes.interior.json` rules. Measured on the 3BHK: **220 rows on flat colour, 159 of them on attachments already carrying the answer**, including the floor tile of all 12 rooms. `enrich_plan.mjs` binds them. See `bake-and-bind-materials` for the precedence and the em-dash rule.

**2. The lamp loop only knew four fixtures.** `("light", "downlight", "pendant", "ceiling-fan")` — so every LINEAR source in the library was silently not a light at all. A cove at 900 lm/m round a 14 m perimeter is 12 600 lm, routinely the largest lamp in the room. `render_plan.py` now carries `LAMP_STEMS` with seventeen, and builds an AREA lamp for each from `lumensPerMetre × run`. The 3BHK went from 0 to **14 area lamps**.

**3. Renamed parameters were read by their old names.** `downlight` states `mountHeight` and `aimTilt`; the loop read `ceilingHeight` and `tilt`, found neither, and dropped all 41 downlights to the 2.7 m default. Both names are read now, new first.

**4. There was no orthographic camera.** The camera object has always offered the view; nothing honoured it.

## Two defects this will find in the plan, not in the renderer

A render is the first thing that actually looks at the plan, so expect it to reject some of it.

- **A camera with no bearing points every shot the same way.** `rotation: 0` is east, so eight shots named for eight subjects all render the same wall. A camera's bearing is **derived** from what the shot is named for: in the plan frame, `atan2(dx, −dy) − 90`. Never typed. See `frame-the-shot`.
- **`fitMode: "Exact"` scales the whole object, including its section.** A 3 m skirting asked to fill a 0.45 m wall piece comes back 0.45 m long, **3 mm thick and 14 mm tall**. A trim takes `fitMode: "Off"` and an explicit `length` measured from its host. `enrich_plan.mjs` reports every attachment whose `metrics.scale` is under 0.5.

## Two tracks, and they are not the same job

**A plan view of the whole floor** is a drawing. The commands above produce it, `--cut` takes the lid off, and it is done. Nothing below this line applies.

**A photographic interior of one room** is a render, and the .blend those commands produce is the *starting point*, not the deliverable. It arrives with the plan's own lighting and materials, which are correct and which do not yet look like anything. Four passes take it the rest of the way, in this order, each as a script against the previous file so any one can be re-run:

1. **`inspect-the-blend`** — world-space bounding boxes, north, the room's contents, the lamps, the materials. Never `obj.location`: plan geometry has its coordinates baked in and sits at the origin.
2. **`unblock-and-fix-the-scene`** — take out what is in front of the window (a closed blackout, a transmissive glass shader), hide duplicates and bad props, fix the materials a plan export always gets wrong.
3. **`light-and-expose`** — daylight in through the right wall, warm light back, sun disc off, AgX +0.35. **Check total watts, not colour** — the default `--lm-per-w 184` under-lights an interior by two to three times.
4. **`model-soft-goods-and-edges`** — cloth sims on clean proxy colliders, a feature element behind the focal wall, and a bevel on every hard edge.

Then `render-fast-on-cpu` for the settings and the 30-second preview loop. On a four-thread laptop the whole thing is a four-minute render.

5. **`export-room-blend-glb-skp`** — when the user wants *the room*, not the floor: cut it out by its interior box and hand over `.blend` (master), `.glb` and `.skp`. The exchange copies need their procedurals baked first, and the `.skp` is written through `SketchUpAPI.dll` — **never by opening SketchUp on the user's machine**.

A worked example of all four passes, as scripts, is in this folder: `ne_bedroom_pass.py` (scene + materials + fluted feature wall + nightstands + plant + daylight + portals + cameras) and `ne_soft_goods.py` (cloth duvet, turn-down, knit throw, pressure-cloth pillows). They are one room's numbers, not a library — read them for the method.

**Skipping straight to lighting is the common mistake.** Tuning lamps to compensate for a closed curtain means every value is wrong the moment the curtain opens.

## An improved plan needs `--force-bake`

A plan that went Tracer → Improver carries `baked` blocks from the trace on its walls and furniture, and
NONE on what the Improver added. `bake_plan.mjs` sees "already baked" and passes the whole plan through —
so every tile field, false ceiling, light and trim is silently missing from the render (and `--ceiling`
then crashes on `fc.baked.anchor`). **Always run `bake_plan.mjs … --force-bake` on an improved plan.**

## Order of work

1. **Bake.** `attachments N with meshes N` must match; read the fall-through list.
2. **Enrich.** Read the three lines it prints: how many rows it bound, the plan camera's extent, and the `metrics.scale` warnings. A warning here is a plan defect — go back and fix the plan, not the render.
3. **Build with `--no-render --no-glb`.** Seconds, and it proves geometry, materials, lamps and cameras before anything spends a minute path-tracing.
4. **Prove the plan view.** `--camera 1 --res 800 --samples 24 --cut 1.35`.
5. **Prove one interior.** `--camera 2 --res 720 --samples 24`. This is where a camera aimed at a wall shows up, and nothing else will tell you.
6. **Render for real** if stills are wanted: drop the preview flags; `--samples 128 --res 1600` is the honest setting.
7. **Verify, then hand over the .blend.** `verify-the-render` has the checks, including the one that catches a wall-mounted object built facing the wrong way.
8. **Export the room** if asked — `export-room-blend-glb-skp`.

## The flags that matter (`render_plan.py`)

| Flag | Default | What it is for |
|---|---|---|
| `--out` | the plan's folder | Made absolute at parse time; pass an absolute path anyway. Background Blender resolves a relative path against the drive root, so `--out out` lands in `C:\out`. |
| `--samples` | 64 | Path-trace samples. 24 to look, 128+ to keep. |
| `--res` | 1280 | Width; height follows the camera's own aspect. |
| `--camera` | all | Render one view by index or name. |
| `--cut <z>` | off | Plan-view lid removal: hide every object whose lowest vertex is above z. |
| `--lm-per-w` | 184 | Lumens per watt for every lamp. Lower it to lift the whole rig, raise it to dim — one number, never per fixture. |
| `--sun` | 1.0 | Multiplier on the Directional light alone. |
| `--sky` | 1.0 | Nishita sky strength — the ambient outside the window. |
| `--exposure` | 0.0 | Stops on the view transform. Cheaper than re-rendering with different lamps. |
| `--fan-lumens` | 1400 | For a ceiling fan that states a light kit but no lumens. |
| `--no-render` / `--no-glb` | | Skip the slow parts. |

## What this skill will not do

- **It will not invent geometry.** If the plan has no false ceiling, the room is open to the sky and the render will say so. Fix that on the canvas (or `enrich_plan.mjs --ceiling` for a cove that needs something to bounce off).
- **It will not render on EEVEE.** EEVEE Next produces flat magenta in background mode without a GPU. The failure is silent and reads as a material bug, so only Cycles is offered.
- **It will not put a texture in a GLB that the render did not have.** glTF cannot carry a procedural. See `material-library` for what the GLB does and does not keep.
