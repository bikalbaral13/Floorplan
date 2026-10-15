# library/Materials — reusable materials (`material/1`)

One JSON per material, in a category folder: `Emissive/`, `Fabric/`, `Finishes/`, `Glazing/`, `Masonry/`, `Metal/`,
`Organic/`, `Site/`. The file name is the material's short id (`Fabric/blackout.json`).

An object uses a material through its `params.materialPath` (library-relative, e.g. `Materials/Fabric/blackout.json`).
The editor's 3D view reads `pbr`; Blender renders read `procedural` / `surface`; plans read `plan2d`; DXF export reads `dxf`.

## Fields

| key | meaning |
|---|---|
| `schema` | always `"material/1"` |
| `id` | `<category>.<name>`, lower case (`fabric.blackout`) |
| `category`, `title`, `description` | the folder name; a human name; one or two sentences on what it is |
| `procedural` | Blender procedural texture: `type`, `blenderNode` (e.g. `ShaderNodeTexNoise`), `params` (scale, colours …) |
| `pbr` | real-time look: `baseColor` (hex), `roughness`, `metallic`, optional maps |
| `surface` | render extras: sheen, transmission, emission, bump … (Blender Principled BSDF inputs) |
| `plan2d` | 2D plan fill: colour / hatch pattern |
| `dxf` | DXF export: layer, colour index, hatch |

## Rules

- Reusable only. A material made for one project still lives here if it can be reused; project-only files go to
  `Projects/<CODE>/`.
- Add a material with the Material Creator workflow (photo → procedural + swatch). The user names it before it is saved.
- Never rename or delete a material that objects reference. Add a new one instead.
