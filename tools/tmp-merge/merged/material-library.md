---
id: material-library
name: The material library, and what a GLB keeps of it
category: Floorplan Renderer
when: Adding a material to `library/Materials`, deciding what a row should wear, or explaining why a GLB looks different from the render.
files: [bp_materials.py, finishes.interior.json]
---

Materials live in R2 under `library/Materials/<Category>/*.json`, one flat recipe per file, schema
`material/1`. **Not a serialised shader graph** — a file names a texture TYPE from Blender's own vocabulary
with that node's own inputs, in metres, and each importer expands it into whatever tree it likes. Storing
graphs would mean the library owned a shader editor and every consumer had to reimplement one.

## The blocks

| Block | Read by | What it holds |
|---|---|---|
| `procedural` | Blender | `type` (brick / checker / noise / voronoi / wave / gradient / magic / white-noise / none), `blenderNode`, and that node's inputs. **No Musgrave** — removed in 4.1. |
| `pbr` | everything | `baseColor`, `roughness`, `metallic`, and where they apply `transmission`, `ior`, `sheen`, `sheenTint`. The fallback for anything that cannot evaluate a procedural, and the only thing a GLB can carry. |
| `emission` | Blender, glTF | `kelvin` + `luminance` in cd/m². **Additive, and new.** |
| `maps` | Blender, glTF | optional image paths — `baseColor`, `roughness`, `metallic`, `normal`, plus `scale` in metres. Read through the UV layer, and they WIN over the procedural. No library material ships any yet; `base_dir` has to point at where they were prefetched, because a missing image renders as flat magenta. |
| `plan2d` | the canvas | hatch, restricted to `none \| diagonal \| dots`. |
| `dxf` | `tools/dxfplan` | an ACAD pattern name, which must exist in ezdxf's bundled set. |

The schema string stays `material/1` even with `emission` in it. Every consumer ignores keys it does not
know, and bumping the version would make `tools/skpir` reject the whole file.

## Why `emission` is kelvin and cd/m², not a colour and a strength

Every fixture in the object library already states a colour temperature and a lumen output. A material that
said "RGB 1, 0.7, 0.4 at strength 4" could not be reconciled with that; one that says 2800 K at 2600 cd/m²
can. `bp_materials` converts: colour from the Tanner Helland blackbody approximation, strength from
`luminance / 683` — 683 lm/W is the photometric constant, and the Principled's Emission Strength is a
radiance multiplier, so that is the honest conversion rather than a number chosen by eye.

A lit strip is **not** a light. The cove and the halo glow because they are emissive; the room is lit by the
fixtures' own lamps. Double-counting them would blow the exposure and make the lamp data meaningless.

## Adding one

1. Pick the **type** whose parameters describe the surface, not the one whose name sounds right: bands with
   distortion for a grain, voronoi for a tuft, checker for a weave, noise for everything continuous.
2. State sizes **in metres**. Textures are fed world-space `Geometry ▸ Position`, so `tileSize: 0.004` is
   4 mm on a cushion and on a wall.
3. A noise / voronoi / wave emits a **factor**, not a colour. Give it `colorA` and `colorB` or it renders as
   grey static — `bp_materials` puts a ColorRamp between them.
4. Fill `pbr` even when `procedural` carries the look. It is what the canvas, the GLB and any viewer without
   a shader graph will use.
5. Check the `dxf.pattern` exists: `python -c "from ezdxf.tools.pattern import load; print(sorted(load()))"`.
6. Upload to `library/Materials/<Category>/<name>.json` and re-run the bake — the definitions are embedded
   in the payload, so a plan baked before your change still carries the old recipe.

A material with `maps` ignores `tint`: tinting exists to make one recipe serve several colours, and a bitmap already is the colour.

**Do not add a near-duplicate for a colour.** `tint` in the finishes file overrides the base colour at the
point of use, and a `COLOR` mix keeps the pattern's variation as luminance. One lacquer file dresses a cream
shutter, a charcoal shadow gap and a navy TV body.

## What a GLB keeps

glTF has no concept of a procedural texture. Left alone, Blender's exporter finds a Wave node feeding Base
Color, does not know what to do with it, and writes **no base colour at all** — the model arrives white.
`render_plan.py` therefore flattens every material for the GLB, after the .blend is saved and after the
stills, so the file on disk and the renders keep the real shaders:

- **Non-metals with a procedural** are baked: a 1 m square swatch of the material into a 512 px image,
  wired through the metre-scaled UVs the geometry already carries. A 1 m crop lands on 1 m of floor, with a
  seam every metre that a GLB preview can live with.
- **Metals and pbr-only materials** take a flat factor. A DIFFUSE bake of a metal is *black* — metals have
  no diffuse lobe — so baking them would be an actively wrong answer.

What survives to the GLB either way: base colour, roughness, metallic, and via KHR extensions transmission,
IOR, sheen and emissive strength. What does not: anything the bake could not see — a second UV, a normal
map that no material has yet, and the world.

## The library as it stands

About 40 files — list them rather than trusting a count: `node tools/tmp-r2/ls.mjs ls library/Materials/`.
`Masonry` `Site` `Glazing` came first, for site plans and elevations; `Finishes` `Fabric` `Metal`
`Organic` `Emissive` were added for interiors — marble, walnut, lacquer, paper, brass, powder-coat, mirror,
screen glass, velvet, cotton, wool, blackout, foliage, bark, warm LED, opal diffuser, then bouclé, felt,
rug-pile, terrazzo, quartz, ceramic, paint-eggshell, light oak, rattan, anodised aluminium, polished brass,
full-grain leather and cream faux leather.

By procedural: **noise** — ceramic, marble, plaster, paint-eggshell, lacquer, paper, concrete, grass, blackout, velvet, powder-coat; **wave** (bands) — light-oak, walnut, wood, brass, bark; **checker** — tile, linen, cotton, rattan; **voronoi** — wool, leather, leather-cream, bouclé; **pbr only** — glass, mirror, steel, brass-polished, aluminium-anodised, led-warm. A pbr-only material is not a bug (a mirror has nothing to vary), but `tint` is then the only thing that changes its colour.
