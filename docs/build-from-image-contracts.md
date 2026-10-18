# Build from Deck — image input, textured materials, Python objects (contracts)

Pilot: project **BACHELOR_PAD** — one moodboard image (`Projects/BACHELOR_PAD/inputs/decks/bachelor-pad.png`, 1564×1564,
no60interiors "Bachelor Pad": a plan panel 18'11" × 17'5" + a moodboard panel). Reference crops, one per item:
`Projects/BACHELOR_PAD/inputs/images/refs/<name>.png` in R2 (local copy `pipeline-work/BACHELOR_PAD/refs/`):
`plan, moodboard, pendant-globes, wall-art, paint-sage, floor-lamp-tripod, shelving, side-table, sofa-leather,
cushion, armchair, rug-cowhide, floor-chevron-oak`. Public base: `https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/`.

Three pieces are built in parallel; this file is what they agree on.

## 1. Textured materials — `material/1` + `textures` (skill: **Material Maker**)

`library/Materials/<Category>/<id>.json` stays `material/1` (consumers ignore unknown keys). New optional block:

```jsonc
"textures": {
  "baseColor": { "src": "Materials/_textures/<id>/basecolor.png",   // R2 key under library/, seamless tile
                 "sizeM": [0.6, 0.6],                               // the tile's real size in metres
                 "projection": "box",                               // box (triplanar) — objects carry no UVs
                 "rotationDeg": 0 },
  "roughness": { "src": "…/roughness.png", "sizeM": [0.6, 0.6] },   // optional, grey
  "normal":    { "src": "…/normal.png",    "sizeM": [0.6, 0.6], "strength": 0.4 }   // optional
},
"source": { "image": "Projects/BACHELOR_PAD/inputs/images/refs/floor-chevron-oak.png", "box": [x0, y0, x1, y1] }
```

- The tile is cut from the deck's own swatch image (cleaned, made seamless), so the render shows THAT product.
- `pbr.baseColor` = the tile's mean colour, `plan2d` / `dxf` filled as today; `blenderGraph` (Material Creator) is
  optional — when present it wins in Blender, `textures` wins everywhere else.
- Plain paints need no texture: `pbr` only (the sage swatch → `Paint/sage-<hex>.json`).

## 2. Python parametric objects — `object/2` (skill: **Object Maker**)

`kind: parametric-object, version: 2` (schema `packages/pyobject/schemas/object.v2.schema.json`, reference
`tools/pyobj/bed_python.json`). Rules for objects the pipeline places:

- Saved to **`library/Objects/Python/<id>.json`**; pure Python (no numpy), `build(params) -> {meshes, plan, stats}`,
  metres, object-local +x across, +y back→front, +z up; `hostKind: "node"`.
- `parameters` carries, besides the shape params, the two binding params every spine object has:
  `materialPath` (text, default material) and `finishes` (text, `"Row=Category/id.json; *=…"`). Each mesh's
  `material` key is the ROW name `finishes` matches (case-insensitive substring), e.g. `"Leather"`, `"Legs"`.
- Size params use the spine names where they exist (`length`, `width`/`depth`, `height`, `seatHeight`) so the
  Object Resolver can bind brief dimensions.
- `python -m pyobject check <file>` passes; build at defaults < 1.5 s CPython; a Blender still of it beside the
  reference crop (`tools/pyobj/load_pyobject.py`).
- The editor shows baked results: the pipeline runs `python -m pyobject.bake <canvas> <out>` before loading.

## 3. Rendering a room with both (skill: **Floorplan Renderer**, step RENDER)

Input: the S4 room canvas. Engine (spine) objects bake through `tools/bakeplan/run.mjs`; object/2 attachments through
`python -m pyobject.bake`. The Blender step builds every mesh, resolves each row's material from the attachment's
`finishes` / `materialPath` (library `material/1`, fetched from R2 with a browser user-agent — r2.dev 403s urllib's),
applies `textures` with box projection at `sizeM`, else `blenderGraph`, else `procedural`/`pbr`; lights from the
lamp params; renders the canvas cameras + corners + top; exports .blend/.fbx/.glb. Output and `@@progress` lines as
today (`skills/Floorplan Renderer/tools/progress.py`).

## 4. In the pipeline (build-from-deck 0.5)

| Stage | What changes |
|---|---|
| S1 Brief | Deck Reader accepts **.png/.jpg/.webp**: Claude marks the panels/items (`panels.json`), a script crops them into the deck's `images/` as one slide per item, then the usual questions → draft → curate → finalize |
| S2 Plan | the plan panel crop goes to the Floorplan Tracer; printed sizes (18'11", 17'5") are the scale pairs |
| S3 Objects | catalog includes object/2 objects; a `new-material` item → **Material Maker** from its crop; a `new-object` item → **Object Maker** (Python) from its crop |
| S4 Fit-out | compose places object/2 objects too; the canvas is baked (`pyobject.bake`) so the editor shows them at once |
| S5 3D | the RENDER step of §3 |
