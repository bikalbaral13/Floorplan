---
id: export-room-blend-glb-skp
name: Hand over one room as .blend, .glb and .skp — without opening SketchUp
category: Floorplan Renderer
when: The interior passes are done and the user wants the room itself, not the whole floor, in the formats other people open — Blender, a web/AR viewer, SketchUp.
tools: [Bash, Read]
requires: [render-a-floorplan, verify-the-render]
---

Three files, three audiences, and they are **not** the same file saved three ways. The `.blend` is the master and keeps everything: procedural materials, lamps, cameras, render settings. The `.glb` and the `.skp` are exchange copies, and neither format can carry a procedural shader, so the materials have to be **baked** before they are written.

```bash
BL="/c/Program Files/Blender Foundation/Blender 4.5/blender.exe"
OUT=D:/…/exports/NE_Bedroom                      # ABSOLUTE

# 1  cut the room out and write .blend + .glb (+ .dae/.obj and the baked swatches)
"$BL" -b floor_pro.blend -P export_room.py -- "$OUT" --room "BEDROOM 3" --name NE_Bedroom \
      --box -0.37,3.19,-5.19,-1.54 --also -0.49,0.69,-1.54,-0.09 --cams "NE Bedroom"

# 2  .skp — SketchUp's own C API, no SketchUp window
"$BL" -b "$OUT/NE_Bedroom.blend" -P dump_for_skp.py -- "$OUT/_dump.json" "$OUT/textures"
python write_skp.py  "$OUT/_dump.json" "$OUT/NE_Bedroom.skp"
python verify_skp.py "$OUT/NE_Bedroom.skp"
```

`render_plan.py` must sit beside `export_room.py`: its `flatten_for_gltf()` is reused verbatim rather than copied.

## 1 — Cut the room, and choose the box deliberately

`--room "BEDROOM 3"` takes the box from the room's floor plate. **A floor plate can be L-shaped** — BEDROOM 3's plate includes the en-suite's corner, so the plate box drags the WC, the basin and the towel rail into a bedroom file (317 meshes instead of 269). Pass `--box` with the room's **interior faces** from `inspect-the-blend`, and `--also` for an entry strip or alcove.

What survives:

- a visible mesh whose bounding-box **centre** is inside the padded box (`--pad`, default 0.25 m);
- a **structural** row — wall, column, door, window — that merely *overlaps* the box, so the shell is closed even where a wall runs on into the next room;
- lamps inside the box, and the sun;
- cameras whose name starts with `--cams` (default: every perspective camera inside the box).

Everything else is deleted and the file is purged. Anything hidden for render — a blackout layer, a duplicate duvet, a camera helper — is dropped, not carried as dead weight.

Expect the exported bounds to run **past** the room on one axis: a wall that the room shares with its neighbour comes in whole. That is correct — cutting walls would open the shell.

## 2 — Why the exchange copies need baking

glTF and SketchUp both store a colour or an image per material. A Wave/Noise/Voronoi tree is neither, so a glTF exporter writes **no** colour at all and the model arrives **white**. `flatten_for_gltf()` bakes each non-metal to a **1 m swatch** at 512 px through the metre-scaled UVs; metals and pbr-only materials take a flat factor (a diffuse bake of a metal is black). On the NE bedroom: **40 baked, 8 flat**. The swatches are saved to `textures/` so the `.skp` can use the same images.

**Architectural glass must be swapped first.** The `Light Path ▸ Is Camera Ray` trick that makes daylight work in Cycles means nothing to any exchange format and exports as an opaque default. `export_room.py` replaces it with a plain transmissive Principled pane (alpha 0.25) for the exports only — the `.blend` keeps the real one, because it is saved *before* the flatten.

## 3 — The .skp, headlessly

**Do not drive the SketchUp application.** Launching `SketchUp.exe -RubyStartup` to import a `.dae` works in principle and in practice opens a window, shows the welcome screen, can hang on sign-in, and cannot be killed from a non-elevated shell (`taskkill` → *Access is denied*). The user sees SketchUp open on their machine, which is exactly what they did not ask for.

Every SketchUp install ships **`SketchUpAPI.dll`** — the same C API the SDK documents. `write_skp.py` calls it through `ctypes`: no window, no licence prompt, ~15 s for 170 k faces.

What it does, and the traps each line avoids:

| Step | Why |
|---|---|
| metres × **39.370 079** | SketchUp's internal unit is the **inch**. Skip it and the room is 1/39 scale. |
| one **group** per Blender object, named after it | the outliner stays navigable: *Bed · Platform · n72*, *Feature · flute 12* … |
| planar polygon → one face; non-planar → fan triangles | a SketchUp face **must be planar**; subdivided cloth quads are not, and `SUGeometryInputAddFace` rejects them silently |
| edges of smooth-shaded polygons **soft + smooth** | otherwise a cushion shows every triangle edge as a black wireframe |
| material = colour + the 1 m swatch at `1/39.37` scale | SketchUp's default projection then lays the texture at true size with **no UVs** |
| `SUModelSaveToFile`, **not** `…WithVersion` | `WithVersion(…, 23)` returns `SUResult 13` — the enum is not the year |

`dump_for_skp.py` is the Blender half: world-space, **modifier-applied** geometry (bevels, solidify, subdivision all baked in), per-polygon material and smooth flag, sRGB colour, the swatch path.

## 4 — Verify, three ways

- **`.skp`** — `verify_skp.py` reopens it through the same DLL and prints groups, faces, materials and the bounds **in metres**. NE bedroom: `groups 269 faces 168539 materials 57`, z `0.00..3.00`. A bounds of ~0.08 m means the inch conversion was skipped.
- **`.blend`** — render the hero camera from the *exported* file, not the whole-floor one. This is what catches a cut that took the ceiling, the lamps or the sun with it.
- **`.glb`** — size is the tell: 14 MB with 40 swatches embedded. A `.glb` of a few hundred KB has no textures, and will be white.

## What goes to the user

```
NE_Bedroom.blend   master — procedural materials, 17 lamps, 3 cameras, Cycles settings
NE_Bedroom.glb     baked swatches embedded; opens in any glTF viewer
NE_Bedroom.skp     SketchUp 2023 format, textures embedded
extras/            .dae, .obj/.mtl, textures/ — only if someone asks
```

Say plainly what the exchange copies lose: no lamps in the `.skp`, no procedural variation in either (a 1 m swatch repeats), and the glass is a plain transparent pane.
