---
id: save-to-the-library
name: Save the approved material to R2 library/Materials under the user's name
category: Material Creator
when: Step 6 of create-a-material — only after the user approved the swatch AND gave (or confirmed) the name.
tools: [Bash]
requires: [render-and-compare, material-creator-scripts]
---

# Save to the library

## Name and place

- Key: `library/Materials/<Category>/<name>.json`. `<name>` is the user's, lower-case, hyphenated
  (`"Honey Oak Laminate"` → `honey-oak-laminate`). Say the exact key back before writing.
- Category — one of the existing folders unless the user asks for a new one: `Finishes` (floors, joinery,
  paint, stone finishes), `Fabric`, `Metal`, `Glazing`, `Masonry`, `Organic`, `Site`, `Emissive`.
- `id` inside the file: `<kind>.<descriptor>` (`floor.laminate.oak-honey`); `title`: `"Kind — descriptor"`.
- **Never overwrite silently.** If the key exists, read it, show the user what is there, and ask:
  overwrite, or a new name.

## Before uploading — the file must be complete

- `schema: "material/1"` (not bumped — consumers ignore `blenderGraph`, and a new version would make
  `tools/skpir` reject the file);
- `description` that says what the recipe does and why, in plain words;
- `procedural`, `pbr`, `plan2d`, `dxf` filled (the flat fallback), `surface` where it applies;
- `blenderGraph` exactly as last rendered — re-render once from the final file if it was edited after the
  last swatch.

## Upload

```bash
node upload_material.mjs <local material.json> <Category>/<name>.json [--force]
```

It refuses to overwrite an existing key without `--force`, writes to R2 through `tools/r2.mjs`, reads the
object back, and compares byte counts. Report the key, the size, and the swatch PNG path.

The swatch PNGs are not stored in R2 unless the user asks; if they do, put them beside the material as
`library/Materials/<Category>/<name>.png`.

## What other tools will do with it

Floorplan Renderer and the Blender addon read `procedural` / `pbr` / `surface` and ignore `blenderGraph`,
so a room render shows the flat approximation until those importers learn the block (a small change: call
`mc_build.build(definition)` when `blenderGraph` is present). Say this when the material is meant for a
room render.
