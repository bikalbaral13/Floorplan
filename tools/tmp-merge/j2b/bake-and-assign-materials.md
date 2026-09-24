---
id: bake-and-assign-materials
name: Bake the plan and assign its materials
category: Json to Blender Render Ready
when: Running or debugging `bake_plan.mjs` — the Node half, which turns a design JSON into the payload Blender reads.
files: [bake_plan.mjs, finishes.interior.json]
---

```bash
node bake_plan.mjs library/Designs/<plan>.json --out <plan>.baked.json \
     [--finishes finishes.interior.json] [--repo D:/MAIN/monica_recent] [--force-bake]
```

The source may be a local path, an R2 key (`library/Designs/x.json`) or a URL. Three things happen, in order.

## 1. Bake — geometry that is not in the file yet

A design straight off the canvas carries `params` and no geometry: the editor evaluates attachments only
when it exports. `bake_plan.mjs` shells out to `tools/bakeplan/run.mjs` in the app repo, which runs the real
evaluator headlessly. It is a shell-out and not a reimplementation on purpose — the evaluator is the app's
own flow maths and a second copy would drift within a week.

Read its two lines:

    library: 24/24 objects resolved
    attachments 50   with meshes 50   faces 8084   via hidden rows 0

`24/24` means every `objectPath` was found in R2. `with meshes` below `attachments` means something baked
empty. `via hidden rows` counts attachments whose geometry only appeared after the baker switched on render
rows the object ships OFF — those solids are ones the canvas draws by another route, and seeing them in a
render is expected rather than wrong.

A plan that already carries `baked` blocks is passed through untouched unless you say `--force-bake`.

## 2. Assign — a material path per render row

Every baked row is tested in this order, and the first answer wins:

1. **Already wired.** The row carries `material` because its object has a Material node feeding
   `matin-<rowId>`. Left alone. This is the route the object library is migrating to, and it always beats a
   rule.
2. **Helper.** It matches `helpers.match` in the finishes file — a camera body, a view cone, an aim tube.
   Marked `render: false`.
3. **Emissive.** Its name matches `emissive.match` — led, lens, emitter, globe, glow, halo, bias, diffuser.
   Takes the emissive material, and later the fixture's own kelvin.
4. **A surface rule**, in file order.
5. **Nothing** — the row keeps its flat baked colour, and the script prints it by name. That list is the
   to-do for the finishes file.

A rule matches on `object` (the file stem `wall`, or the objectId `wall-with-math`) and `mesh` (a
case-insensitive substring of the row name, negated with a leading `!`). Order matters: the specific rows —
`Mirror`, `Pulls`, `Glazing` — go above the catch-all for the same object.

`tint` overrides the material's base colour at the point of use. `tint: "auto"` keeps the row's own baked
colour, which is what a window frame whose colour is part of the design wants. One lacquer file therefore
serves a cream shutter, a charcoal shadow gap and a navy TV body — the alternative is three near-identical
library files, and a library of near-identical files stops being a library.

## 3. Embed — the definitions travel with the plan

Every material named is fetched from R2 and written into the plan under `materials`. **Embedded, not
linked**: the public r2.dev domain answers 403 to urllib's default user agent, so a Blender-side fetch would
fail and fall back to grey — a silent wrong answer, which is worse than a bigger file. `tools/skpir` embeds
for the same reason.

## Reading the report

    assigned 106 by rule, 16 emissive, 0 already wired, 18 helpers hidden
    embedded 19/19 material definitions

`0 already wired` is the current state of the object library, not a problem. `embedded 19/19` must be equal:
a missing definition is a 404 or a typo in a rule's path, and those rows go grey.
