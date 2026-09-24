---
id: bind-plan-materials
name: Bind the plan's own materials, and know which procedural belongs on which geometry
category: Floorplan Renderer
when: After the bake, before the scene build. Any time rows come back on their flat colour, or a floor renders as a chessboard.
tools: [Bash]
requires: [render-a-floorplan]
---

## Where a row's material comes from, in order

`bake_plan.mjs` walks four of these. `enrich_plan.mjs` inserts the two the plan itself knows, which are the most specific and were being thrown away.

1. **Helper rows** — drawing aids, `render: false`, never materialled.
2. **A wired Material node** (`m.material` already set). The object said so; nothing overrides it.
3. **Emissive by name** — `led`, `emitter`, `glow`.
4. **`params.finishes`, matched by row** ← *added here.* The plan naming a specific surface of a specific attachment. Most specific thing in the file.
5. **The global `finishes.interior.json` surface rules**, first hit wins, `!` negates.
6. **`params.materialPath`** ← *added here.* The attachment's base material, the fallback for any row the rules did not name.
7. Flat colour, and a line in the report.

4 sits above the global rules because it names one row of one attachment; 6 sits below them because a rule like `wardrobe :: Mirror → Glazing/mirror` is more specific than the wardrobe's own base of oak.

**Step 4 must genuinely OVERRIDE, not just fill blanks.** Filling only rows that have no material means a global rule always wins and the plan can never say anything — measured on the 3BHK: a bed whose plan named bouclé on its headboard rendered in the rules' *leather*, silently, and the report counted it as bound. Correcting the precedence moved **114 rows** off a global rule onto what the plan actually asked for. A wired Material node (step 2) still beats both: the object itself said so.

## The em-dash rule

`params.finishes` is `"Row=path; Row=path"`. Match the head of the mesh name **before** any em dash:

```
mesh "Frame — head & sill"   entry "Frame"  → matches
mesh "Frame — head & sill"   entry "Sill"   → must NOT match
```

Take `split("—")[0].trim()` on both sides, compare exact first, then containment. Without that a window's frame wears the sill's material and the mistake is invisible in the report — both rows got *a* material.

## Paths carry different prefixes

`objectPath` and `lamp` carry their own top folder (`Objects/Architectural/bed.json`, `Photometry/LED/…`). `materialPath` and every path inside `finishes` are relative to `Materials/` (`Finishes/plaster.json`, `Emissive/diffuser.json`). Prefix them before comparing or embedding, or every one of them reads as missing.

## Embed, never link

The r2.dev domain answers **403 to urllib's default user agent**, so a Blender-side fetch fails silently and the row falls back to grey. Every material the assignment named is fetched in Node and written into `plan.materials`. Anything `enrich_plan.mjs` newly references it fetches and embeds too — otherwise binding a material is worse than not binding it, because the row now names a definition that is not in the payload.

## A pattern procedural must not go on geometry that already is that pattern

This is the rule that a furnished floorplan needs and a bare design does not.

`Finishes/tile.json` is a **checker at 0.3 m** — it draws the tile joints itself, which is right for a floor that is one flat plane. A `tessellation` field draws every tile as **real geometry** with a real grout gap. Put one on the other and the two patterns multiply into a chessboard, at a scale that belongs to neither.

| floor | use | why |
|---|---|---|
| `tessellation` geometry, porcelain | `Finishes/marble.json` | noise, scale 1.6, detail 9 — veining, no joints |
| `tessellation` geometry, wet room | `Finishes/ceramic.json` | noise, scale 9 — a fine speckle |
| a flat floor plane, no tile geometry | `Finishes/tile.json` | the checker IS the joints |
| timber plank as geometry | `Finishes/light-oak.json` / `walnut` | wave BANDS — the grain, not the board edges |

The same trap is waiting in `Organic/rattan.json` (checker at 12 mm), `Fabric/linen.json` and `Fabric/cotton.json` (checker at 4 mm and 1.5 mm) — fine on a smooth surface, wrong on anything modelled with its own weave.

## A bound material can still be the wrong material

Binding fixes *grey*. It does not fix a TV screen wearing walnut, a window frame wearing marble or plant leaves wearing bark — those rows have a material, it is just the wrong one, and the report will not mention them. `unblock-and-fix-the-scene` has the list of surfaces a plan export reliably gets wrong and how to spot them in the inspector's material table.

When the plan is yours, fix the `materialPath` in the plan rather than the .blend — a .blend edit is thrown away at the next bake.

## What the library actually holds

Twenty-eight definitions get embedded on a furnished 3BHK. By procedural: **noise** — ceramic, marble, plaster, paint-eggshell, lacquer, paper, concrete, grass, blackout, velvet, powder-coat; **wave** (bands) — light-oak, walnut, wood, brass, bark; **checker** — tile, linen, cotton, rattan; **voronoi** — wool, leather; **pbr only, no procedural** — glass, mirror, steel, brass-polished, aluminium-anodised, led-warm.

A `pbr only` material is not a bug: a mirror has nothing to vary. But it does mean `tint` is the only thing that will change its colour.

## Read the two numbers

`enrich_plan.mjs` prints `N bound from params.finishes, M from params.materialPath, K still on flat colour`. K is the real number: those rows are grey in the render. On the 3BHK it is 61 of 724 — columns, north arrow, the tile prisms' fall zones and a few object rows whose kinds have no rule anywhere. Each is either a missing rule in `finishes.interior.json` or a missing `materialPath` in the plan, and the fix belongs in whichever of those two is wrong — not in a hand edit of the baked file, which the next bake throws away.
