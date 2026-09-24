---
id: make-the-materials
name: Bind each part to a library material — reuse first, create a material/1 file only when nothing fits
category: Parametric Object Creator
when: After study-the-reference has named the material of every part. With an image, match its colour and finish; without one, choose from architectural knowledge and say why. New files go to R2 library/Materials/<Category>/.
tools: [Bash, Read, Write]
requires: [study-the-reference]
---

# Make the materials

## 1. Reuse first

List what exists: `node tools/tmp-r2/ls.mjs ls library/Materials/`. Categories today: `Emissive`, `Fabric`
(blackout, boucle, cotton, felt, linen, rug-pile, velvet, wool), `Finishes` (ceramic, lacquer, leather,
leather-cream, light-oak, marble, paint-eggshell, paper, plaster, quartz, terrazzo, tile, walnut, wood),
`Glazing`, `Masonry`, `Metal` (aluminium-anodised, brass, brass-polished, powder-coat, steel), `Organic`,
`Site`. Read the candidate (`… cat library/Materials/<path>`) — the NAME is not enough: `Finishes/leather`
is dark brown full grain; the chair needed `Finishes/leather-cream`.

A material is right when its **category of surface** matches (a coated fabric vs a hide vs a woven textile)
AND its colour is within reach. Colour alone is not a reason for a new file when the category is right —
but there is no per-row tint on an object today, so a clearly different colour (cream vs brown) IS a new file.

## 2. Create only when nothing fits

Derive from the nearest existing file (copy it, change what differs) so the recipe style stays consistent.
Schema `material/1` — one flat recipe per renderer, NOT a shader graph:

```json
{
  "schema": "material/1",
  "category": "Finishes",
  "id": "leather.faux.cream",
  "title": "Leather — faux, cream",
  "description": "One or two sentences on what the recipe does and WHY (what makes it read as this material).",
  "procedural": {
    "type": "voronoi", "blenderNode": "ShaderNodeTexVoronoi",
    "params": { "scale": 520, "detail": 3, "roughness": 0.55, "randomness": 1, "feature": "F1",
                "distance": "EUCLIDEAN", "colorA": "#e9dfcf", "colorB": "#dcd0bd" }
  },
  "pbr":     { "baseColor": "#e3d8c6", "roughness": 0.45, "metallic": 0 },
  "surface": {
    "bevel": { "width": 0.0015, "samples": 4 },
    "normal": { "source": "procedural", "strength": 0.5, "scale": 1 },
    "coat": { "weight": 0.28, "roughness": 0.25, "ior": 1.45 },
    "subsurface": { "weight": 0.06, "radius": [0.006, 0.004, 0.003], "scale": 0.004 },
    "roughnessVariation": { "amount": 0.12, "scale": 11 }
  },
  "plan2d":  { "hatch": "dots", "spacing": 6, "angle": 0, "weight": 1, "color": "#e3d8c6" },
  "dxf":     { "pattern": "AR-SAND", "scale": 0.5, "angle": 0 }
}
```

Rules for each block:

- **procedural** — Blender's own texture-node vocabulary only: `brick | checker | noise | voronoi | wave |
  gradient | magic | white-noise`. **No Musgrave** (removed in Blender 4.1). Sizes in METRES, world-space
  (textures are fed Geometry ▸ Position). noise/voronoi/wave need `colorA`/`colorB` or they render grey.
  - leather / PU: voronoi, scale 350–550 (fine pebble), coat 0.2–0.3
  - woven fabric (linen, cotton): noise or wave at small scale, roughness 0.8–0.95, `sheen`
  - bouclé / velvet: voronoi coarse + strong `sheen`, displacement for bouclé
  - wood: wave BANDS + `grain` block (axis along the part's length), coat 0.1–0.3 for lacquered
  - stone: voronoi/noise veining, roughness 0.2–0.5, coat for polished
  - metal: `pbr.metallic: 1`, roughness 0.15–0.4, `anisotropy` for brushed
- **pbr** — the flat fallback AND what a GLB carries. `baseColor` must be the average visible colour of the
  procedural, or the GLB will not look like the render. Glazing adds `transmission` / `ior`.
- **surface** (all optional): `bevel` (the biggest single realism win on hard parts), `normal`, `grain`,
  `sheen`, `subsurface`, `coat`, `anisotropy`, `displacement`, `roughnessVariation`.
- **emission** (lights only): `{ kelvin, luminance }` in cd/m² — never a colour and a strength.
- **plan2d** — hatch restricted to `none | diagonal | dots`.
- **dxf** — an ACAD pattern present in ezdxf's set (AR-SAND, AR-CONC, AR-PARQ1, ANSI32, NET, GRASS, …).

Colours from a photo: sample the lit mid-tone, not the shadow; cream/white upholstery photographed indoors
reads 10–20 % darker and greyer than the material is.

Upload to `library/Materials/<Category>/<name>.json` and read it back (see `parametric-object-creator-scripts`).

## 3. Bind it — two mechanisms, use both

1. **Material nodes** in the flow (these WIN in every consumer): one node per material,
   `{ "tool": "material", "params": { "path": "Materials/<Category>/<name>.json" } }` — note the path
   INCLUDES `Materials/` — wired `mat` → `matin-<rowId>` on the 3D Render node.
2. **Text props** as the fallback the plan tools read: `materialPath` = the default (relative to
   `Materials/`, NO prefix), `finishes` = `"Row=path; …"` per 3D row name.

Give every 3D row a sensible `color` too (the canvas preview uses it, and it is the last fallback).
