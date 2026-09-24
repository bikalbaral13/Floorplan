---
id: json-to-blender-render-ready
name: JSON to Blender render-ready
category: Json to Blender Render Ready
when: The user has a canvas design JSON and wants it in Blender as a lit, materialled scene — a .blend they can open and render, stills, or a GLB. Not for the in-canvas 3D view, and not for the Faithful Space Render flow, which is an image model rather than a path tracer.
files: [bake_plan.mjs, render_plan.py, bp_materials.py, finishes.interior.json]
requires: [bake-and-assign-materials, build-the-blender-scene, material-library, verify-the-scene]
---

Two commands. The first turns a design into a payload; the second turns the payload into a scene.

```bash
node bake_plan.mjs library/Designs/<plan>.json --out <plan>.baked.json
blender -b --python render_plan.py -- <plan>.baked.json --out <dir> --samples 128 --res 1600
```

Everything else in this skill explains a decision one of those two makes.

## Why it is two commands and not one

They need different machines. The bake needs the app's own flow evaluator — 100 KB of TypeScript that turns
`params` into face rings — and that only runs in Node against the repo. The scene needs `bpy`, which only
exists inside Blender. Neither can call the other, and a design that tried would have to reimplement one of
them. So the baked JSON is the contract between them: geometry in metres, a material path per row, and the
material definitions embedded.

## What arrives in the .blend

| Collection | What is in it |
|---|---|
| `Walls` `Doors` `Windows` `Spaces` | one object per render row of the plan's wall, door, window and room attachments |
| `Objects/<Kind>` | everything else, grouped by object — `Objects/Wardrobe`, `Objects/Bed` … |
| `Lighting` | real Blender lamps built from the fixtures' own lumens, kelvin and beam angles |
| `Cameras` | one camera per camera object, with its focal length, sensor and eye height |
| `Helpers` | camera bodies, tripods, view cones, aim tubes — `hide_render` on, so they document the setup without appearing in it |

Every mesh object carries `bp_host`, `bp_object`, `bp_row`, `bp_surface` and `bp_material` as custom
properties. That is what makes the file auditable: select anything and the outliner says which attachment of
which host it came from and which library material it is wearing.

## Order of operations

1. **Bake.** `node bake_plan.mjs <design> --out <baked>`. Read its report. `attachments N with meshes N` must
   match; a row that falls through to its flat colour is printed by name and is a missing finishes rule, not
   a failure.
2. **Build without rendering.** `blender -b --python render_plan.py -- <baked> --out <dir> --no-render
   --no-glb`. Four seconds, and it proves the geometry, the material count, the lamp count and the camera
   count before anything spends minutes on a path trace.
3. **Look at one view small.** `--camera 1 --res 640 --samples 24`. About a minute on four cores. This is
   where exposure and light balance get settled — not at final resolution.
4. **Render for real.** Drop the flags. `--samples 128 --res 1600` is the honest setting for a still.
5. **Verify before reporting.** Open the PNGs. A render that came out black, magenta or empty still exits 0.

`verify-the-scene` has the checks for steps 2 and 3, including the one that catches a wall-mounted object
built facing the wrong way — which no amount of looking at material assignments will explain.

## The flags that matter

| Flag | Default | What it is for |
|---|---|---|
| `--samples` | 64 | Path-trace samples. 24 to look, 128+ to keep. |
| `--res` | 1280 | Width; height follows the camera's own aspect. |
| `--lm-per-w` | 184 | Lumens per watt for every lamp. Raise it to dim the whole rig, lower it to lift it — one number, never per fixture. |
| `--sun` | 1.0 | Multiplier on the Directional light alone, for when the daylight and the lamps want different balance. |
| `--sky` | 1.0 | Nishita sky strength — the ambient outside the window. |
| `--exposure` | 0.0 | Stops on the view transform. Cheaper than re-rendering with different lamps. |
| `--camera` | all | Render one view by index or name. |
| `--no-render` / `--no-glb` | | Skip the slow parts. |

## What this skill will not do

- **It will not invent geometry.** If the plan has no false ceiling, the room is open to the sky and the
  render will say so. Fix that on the canvas, not here.
- **It will not render on EEVEE.** EEVEE Next produces flat magenta in background mode without a GPU. The
  failure is silent and reads as a material bug, so only Cycles is offered.
- **It will not put a texture in a GLB that the render did not have.** glTF cannot carry a procedural. See
  `material-library` for what the GLB does and does not keep.
