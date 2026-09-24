---
id: floorplan-renderer-scripts
name: The scripts, where they live, and the environment they need
category: Floorplan Renderer
when: Every render run.
tools: [Bash, Read, Write]
---

## The three commands

```bash
REPO=D:/MAIN/monica_recent
SKILL=$REPO/tools/tmp-render/live/Skill          # or a local copy of library/Skills/Json to Blender Render Ready/
BL="/c/Program Files/Blender Foundation/Blender 4.5/blender.exe"
OUT=$(pwd)/out                                    # ABSOLUTE — see below

node $SKILL/bake_plan.mjs   plan.json        --out plan.baked.json --repo $REPO
node $SKILL/enrich_plan.mjs plan.baked.json  --out plan.v2.json [--room "BEDROOM 2"] [--ceiling]
"$BL" -b --python $SKILL/render_plan.py -- plan.v2.json --out "$OUT" --no-render --no-glb
"$BL" -b --python $SKILL/render_plan.py -- plan.v2.json --out "$OUT" --camera 1 --res 800 --samples 24 --cut 1.35
```

`bake_plan.mjs`, `render_plan.py`, `bp_materials.py` and `finishes.interior.json` belong to **`Json to Blender Render Ready`**. `enrich_plan.mjs` belongs here. Do not fork the first four — the two fixes this skill needed (`LAMP_STEMS`, orthographic cameras, the renamed downlight params, `--cut`) are *in* `render_plan.py`, so there is one copy of the pipeline and it is the one everything uses.

## Environment

- **Blender 4.5 LTS**, `/c/Program Files/Blender Foundation/Blender 4.5/blender.exe`. Cycles only — EEVEE Next renders flat magenta in background mode without a GPU, silently, and it reads as a material bug.
- **The repo**, for `tools/bakeplan/run.mjs`. `bake_plan.mjs` shells out to it; that is the app's real flow evaluator and **it is never reimplemented**.
- **Node 22** for the two `.mjs`.
- The plan's `settings.library_path` for fetching material definitions. Fetch in **Node**, never from Blender: r2.dev answers 403 to urllib's default user agent and the row silently goes grey.

## `--out` must be absolute

Blender resolves render paths against the **drive root** in background mode, so a relative `--out out` writes to `C:\out`. Take `os.path.abspath` at parse time, or pass an absolute path.

## Timings, measured on a 3BHK (295 attachments, 144 095 faces)

| step | time |
|---|---|
| bake | ~25 s |
| enrich | < 1 s |
| build, `--no-render --no-glb` | ~20 s — 724 objects, 143 393 faces |
| plan view, 800 px, 24 samples, orthographic | ~60 s |
| interior, 720 px, 24 samples | ~55 s |

Path-trace cost scales with pixels × samples, not with the scene. 24 samples at 700–800 px is the settling loop; `--samples 128 --res 1600` is the honest setting for a still, and is minutes not seconds.

## A background render still needs watching

A render that came out black exits 0. Blender also prints its own `Fra:` progress on stdout, which buries the `[bp]` lines — filter for them:

```bash
"$BL" -b --python render_plan.py -- … 2>&1 | grep -E "^\[bp\] "
```

## Room export — `.blend`, `.glb`, `.skp`

```bash
"$BL" -b floor_pro.blend -P export_room.py -- "$OUT" --room "BEDROOM 3" --name NE_Bedroom --box x0,x1,y0,y1
"$BL" -b "$OUT/NE_Bedroom.blend" -P dump_for_skp.py -- "$OUT/_dump.json" "$OUT/textures"
python write_skp.py  "$OUT/_dump.json" "$OUT/NE_Bedroom.skp"      # SketchUpAPI.dll via ctypes, no window
python verify_skp.py "$OUT/NE_Bedroom.skp"
```

`export_room.py` needs `render_plan.py` beside it (it reuses `flatten_for_gltf`). `write_skp.py` needs a SketchUp install for `SketchUpAPI.dll` (default `C:\Program Files\SketchUp\SketchUp 2023`; pass another as the third argument) and a 64-bit Python. See `export-room-blend-glb-skp`.

| step | time (NE bedroom, 269 objects) |
|---|---|
| cut + .blend + bake 40 swatches + .glb + .dae/.obj | ~3 min |
| dump | ~10 s |
| write .skp (168 k faces) | ~15 s |

## Interior pass helpers

`preview.py` — `blender -b x.blend -P preview.py -- <out.png> [pct] [spp] [camera]`, the 30-second look. `ne_bedroom_pass.py` / `ne_soft_goods.py` — a worked interior (see `render-a-floorplan`).

## `enrich_plan.mjs` flags

| flag | default | what it does |
|---|---|---|
| `--out` | `<in>.v2.json` | where to write |
| `--room "NAME"` | whole floor | frame one space; exact label first, then contains; lists the labels if nothing matches |
| `--margin` | 0.6 | metres of air round the framed extent |
| `--ceiling` | off | build a slab over each space that has a `false-ceiling`, so a cove has something to bounce off. **Off for a plan view** — a plan wants the lid gone. *Fixed 2026-09-23*: it used to write the slab as vertex **indices**, and `render_plan.py` reads every face as a ring of anchor-relative **points**, so the build crashed with `'int' object is not subscriptable`. It now writes points relative to the false-ceiling's anchor, both windings. |
| `--library` | the plan's own `settings.library_path` | where to fetch newly-referenced materials |

It also sets `schemaVersion: 2` and `settings.bakedFrame`, and writes `plan.warnings[]`.

## The frame is LEFT handed

`x east, y south, z up`. A right-handed DCC needs `(x, −y, z)` **and** every face's winding reversed. `render_plan.py` does this once, on the way in; anything else that reads a baked plan has to do it too. `settings.bakedFrame.toRightHanded` states it in the file so nothing has to rediscover it.

## What lands in the .blend

| collection | contents |
|---|---|
| `Walls` `Doors` `Windows` `Spaces` | one object per render row of those attachments |
| `Objects/<Kind>` | everything else, grouped — `Objects/Wardrobe`, `Objects/Bed` … |
| `Lighting` | real lamps from each fixture's own lumens, kelvin and beam |
| `Cameras` | the plan view first, then one per camera attachment |
| `Helpers` | camera bodies, cones, aim tubes — `hide_render` on |

Every mesh carries `bp_host`, `bp_object`, `bp_row`, `bp_surface`, `bp_material` as custom properties. That is what makes the file auditable: select anything and the outliner says which attachment of which host it came from and which library material it is wearing. It is also how to find the one row that came out grey.
