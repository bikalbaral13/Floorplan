---
id: check-in-canvas-blender-glb
name: Load the object on the canvas and screenshot the 3D view, render a low-sample Blender still, export a GLB, compare, ask
category: Parametric Object Creator
when: After the object (and any new material) is published to R2 and check_object.mjs passes. This is the visual gate of every iteration; it ends by showing the user three results and asking for the next step.
tools: [Bash, Browser]
requires: [author-the-six-node-flow, parametric-object-creator-scripts]
---

# Check in canvas, Blender and GLB

Three independent proofs. Each can fail on its own; report each on its own.

## A. Canvas — does the app draw it?

The dev server runs on **port 2500** (`dev-2500` launch config — never the default 3000).

1. Open the editor in the Browser pane: `http://localhost:2500/?agent=1`.

   **Then prove the bridge is talking to THAT tab before placing anything.** The latch goes to whichever
   editor tab polled last, and the user's own Chrome often has the editor open too (2026-09-24: `netstat`
   showed `chrome.exe` on 41414; `place_object` put a test sofa into the user's working plan, and the
   follow-up delete went to a different client). Check: `node tools/fp.mjs get_state '{}'` must describe
   the pane you are looking at (an empty pane reports `walls: 0`), and `netstat -ano | grep 41414` shows
   who is connected. If another client holds it, **ask the user to close or background that tab** — never
   draw into a plan you cannot see.
2. Load the object from the library into the canvas. Two routes:
   - **Bridge** (preferred): `node tools/fp.mjs import_objects '{}'`, then
     `node tools/fp.mjs list_draw_tools '{}'` and confirm the new object id is listed, then
     `node tools/fp.mjs place_object '{"x": 2, "y": 2, "object": "<id>", "rotation": 0}'`.
     The bridge listens on 41414; if the MCP connection is down, `tools/fp.mjs` drives the same tools over
     `POST /enqueue`. The browser tab with `?agent=1` must be open to take the latch.
   - **Editor UI**: Flow / object import from the Library's Objects folder, then place it on a node.
   If the id does not appear, the library listing did not pick the file up — say so, do not fake it.
3. Confirm it BAKED: `node tools/fp.mjs export_plan '{}'` → the node's attachment has `baked` with the
   expected mesh rows. An attachment without `baked` is a silent failure.
4. Switch the editor to the **3D view**, orbit to a ¾ front view close to the reference's angle, and take a
   Browser-pane screenshot (`computer` → `screenshot`). There is no bridge tool for the 3D view;
   `snapshot_canvas` is the 2D plan only — take that too, it proves the plan rows.
5. Read the console (`read_console_messages`, errors only). An evaluation error in the Math Engine shows
   there, not on the canvas.

What to look for: the silhouette, part colours, faceting (too few samples), holes (a face run < 3 vertices),
parts floating or sunk, the 2D plan outline matching the 3D footprint.

## B. Blender — do the materials apply?

Low quality on purpose: the question is "is every row bound to the right material", not "is it beautiful".

```bash
# 1. bake at the defaults with the app's own evaluator (resolved.meshes carry faces + material links)
npm run bake -- <r2-url-or-local.json> --out tools/tmp-<object>/out/<name>.baked.json

# 2. fetch every material the bake links (r2.dev 403s Python's urllib — fetch with node)
node tools/tmp-<object>/fetch_materials.mjs tools/tmp-<object>/out/<name>.baked.json tools/tmp-<object>/out/mats

# 3. build, render (Cycles CPU, 16 samples, 640 px), export GLB
"C:/Program Files/Blender Foundation/Blender 4.5/blender.exe" -b --python tools/tmp-<object>/render_object.py -- \
    <ABS>/out/<name>.baked.json <ABS>/out/mats <ABS>/out/render --samples 16 --res 640
```

`render_object.py` and `fetch_materials.mjs` are in this skill folder (see `parametric-object-creator-scripts`);
copy them next to the object's scratch files. Traps it already handles:

- **Paths must be ABSOLUTE** — background Blender resolves a relative output against the drive root.
- **Cycles CPU only** — EEVEE Next renders flat magenta headless. ~16 samples + denoise is enough.
- **Plan frame is left-handed** (x east, y SOUTH, z up): convert to `(x, −y, z)` and reverse each face's
  winding, or everything is mirrored and inside-out.
- **Smooth by angle** (~40°) after merging coincident vertices, or every loft reads as origami.
- The shader comes from `bp_materials.material_from_def` (from R2 `Skills/Floorplan Renderer/`),
  so the still shows the SAME recipe the render pipeline uses. A row with no resolvable material is drawn
  in its row `color` and **listed in the log** — that list is the answer to "are the materials applied".

Outputs: `render/still.png`, `render/<name>.blend`, `render/<name>.glb`, `render/report.json`
(rows → material id or "MISSING", face counts, GLB size).

## C. GLB — does it export?

`render_object.py` exports after the still. **glTF cannot carry a procedural** — the exporter finds a texture
node on Base Color and writes no factor, so the GLB arrives WHITE. The script therefore swaps every material
to its `pbr.baseColor` / roughness / metallic flat factors before exporting. Check in `report.json`: file
exists, size > 0, one mesh per row, one material per distinct material file. Optionally open it in the
Browser pane with a glTF viewer page to eyeball it.

## D. Compare and ask

Put the reference image, the canvas 3D screenshot and the Blender still side by side in the reply and
judge part by part: silhouette and proportions, the defining curves, surface detail (quilt / piping /
grain visible?), materials (right colour family, right sheen, legs vs upholstery distinct).

- **Almost fine** → say so and ask whether it is done.
- **Not fine** → list the specific differences and the fix you propose for each (a parameter default,
  a technique, a material value), then **ask which to do next**. Do not start the next iteration unasked.

Never report a step as done that did not run. If Blender was skipped or failed, say which command and what
it printed.
