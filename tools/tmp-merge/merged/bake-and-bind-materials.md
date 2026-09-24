---
id: bake-and-bind-materials
name: Bake the plan, bind every row to a material, embed the definitions
category: Floorplan Renderer
when: Running or debugging the Node half — `bake_plan.mjs` then `enrich_plan.mjs` — which turns a design JSON into the payload Blender reads. Also any time rows come back on their flat colour, or a floor renders as a chessboard.
tools: [Bash]
files: [bake_plan.mjs, enrich_plan.mjs, finishes.interior.json]
requires: [render-a-floorplan]
---

```bash
node bake_plan.mjs <design>.json --out plan.baked.json \
     [--finishes finishes.interior.json] [--repo D:/MAIN/monica_recent] [--force-bake]
node enrich_plan.mjs plan.baked.json --out plan.v2.json [--room "NAME"] [--ceiling] [--library <url>]
```

The source may be a local path, an R2 key (`library/Designs/x.json`) or a URL.

## 1. Bake — geometry that is not in the file yet

A design straight off the canvas carries `params` and no geometry: the editor evaluates attachments only when it exports. `bake_plan.mjs` shells out to `tools/bakeplan/run.mjs` in the app repo, which runs the real evaluator headlessly. It is a shell-out and not a reimplementation on purpose — the evaluator is the app's own flow maths and a second copy would drift within a week.

Read its two lines:

    library: 24/24 objects resolved
    attachments 50   with meshes 50   faces 8084   via hidden rows 0

`24/24` means every `objectPath` was found in R2. `with meshes` below `attachments` means something baked empty. `via hidden rows` counts attachments whose geometry only appeared after the baker switched on render rows the object ships OFF — those solids are ones the canvas draws by another route, and seeing them in a render is expected rather than wrong.

A plan that already carries `baked` blocks is passed through untouched unless you say `--force-bake`.

## 2. Bind — where a row's material comes from, in order

`bake_plan.mjs` walks steps 1, 2, 3, 5 and 7. `enrich_plan.mjs` inserts 4 and 6 — the two the plan itself knows, which are the most specific and used to be thrown away.

1. **Helper rows** — match `helpers.match` in the finishes file: a camera body, a view cone, an aim tube. Marked `render: false`, never materialled.
2. **A wired Material node** — the row already carries `material` because its object has a Material node feeding `matin-<rowId>`. The object said so; nothing overrides it. This is the route the object library is migrating to.
3. **Emissive by name** — `emissive.match`: led, lens, emitter, globe, glow, halo, bias, diffuser. Takes the emissive material, and later the fixture's own kelvin.
4. **`params.finishes`, matched by row** — the plan naming a specific surface of a specific attachment. Most specific thing in the file.
5. **The global `finishes.interior.json` surface rules**, first hit wins.
6. **`params.materialPath`** — the attachment's base material, the fallback for any row the rules did not name.
7. **Nothing** — the row keeps its flat baked colour, and the script prints it by name. That list is the to-do.

4 sits above the global rules because it names one row of one attachment; 6 sits below them because a rule like `wardrobe :: Mirror → Glazing/mirror` is more specific than the wardrobe's own base of oak.

**Step 4 must genuinely OVERRIDE, not just fill blanks.** Filling only rows that have no material means a global rule always wins and the plan can never say anything — measured on the 3BHK: a bed whose plan named bouclé on its headboard rendered in the rules' *leather*, silently, and the report counted it as bound. Correcting the precedence moved **114 rows** off a global rule onto what the plan actually asked for.

### The finishes rules file

A rule matches on `object` (the file stem `wall`, or the objectId `wall-with-math`) and `mesh` (a case-insensitive substring of the row name, negated with a leading `!`). Order matters: the specific rows — `Mirror`, `Pulls`, `Glazing` — go above the catch-all for the same object.

`tint` overrides the material's base colour at the point of use; `tint: "auto"` keeps the row's own baked colour, which is what a window frame whose colour is part of the design wants. One lacquer file therefore serves a cream shutter, a charcoal shadow gap and a navy TV body — the alternative is three near-identical library files.

### The em-dash rule

`params.finishes` is `"Row=path; Row=path"`. Match the head of the mesh name **before** any em dash:

```
mesh "Frame — head & sill"   entry "Frame"  → matches
mesh "Frame — head & sill"   entry "Sill"   → must NOT match
```

Take `split("—")[0].trim()` on both sides, compare exact first, then containment. Without that a window's frame wears the sill's material and the mistake is invisible in the report — both rows got *a* material.

### Paths carry different prefixes

`objectPath` and `lamp` carry their own top folder (`Objects/Architectural/bed.json`, `Photometry/LED/…`). `materialPath` and every path inside `finishes` are relative to `Materials/` (`Finishes/plaster.json`, `Emissive/diffuser.json`). A Material node's `path` INCLUDES `Materials/`. Prefix before comparing or embedding, or every one of them reads as missing.

## 3. Embed — the definitions travel with the plan

Every material named is fetched from R2 in Node and written into the plan under `materials`. **Embedded, not linked**: the public r2.dev domain answers 403 to urllib's default user agent, so a Blender-side fetch would fail and fall back to grey — a silent wrong answer, which is worse than a bigger file. Anything `enrich_plan.mjs` newly references it fetches and embeds too; otherwise binding a material is worse than not binding it, because the row names a definition that is not in the payload.

## 4. What else enrich writes

`schemaVersion: 2` and `settings.bakedFrame` (the left-handed frame, stated), the orthographic plan camera (see `frame-the-shot`), `--ceiling` slabs, and `plan.warnings[]` — every attachment whose `metrics.scale` is under 0.5, which is a plan defect (see `render-a-floorplan`).

## A pattern procedural must not go on geometry that already is that pattern

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

## Reading the reports

    assigned 106 by rule, 16 emissive, 0 already wired, 18 helpers hidden
    embedded 19/19 material definitions
    N bound from params.finishes, M from params.materialPath, K still on flat colour

`embedded X/X` must be equal: a missing definition is a 404 or a typo in a path, and those rows go grey. **K is the real number** — those rows are grey in the render. On the 3BHK it is 61 of 724: columns, north arrow, the tile prisms' fall zones and a few object rows whose kinds have no rule anywhere. Each is either a missing rule in `finishes.interior.json` or a missing `materialPath` in the plan, and the fix belongs in whichever of those two is wrong — never in a hand edit of the baked file, which the next bake throws away.
