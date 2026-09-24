# Parametric object → SketchUp Dynamic Component

Turns a BuilderPluss `.pobj` flow into a **real Dynamic Component**: the parameters land in SketchUp's
Component Options dialog, and SketchUp's own DC engine recomputes the geometry when they change. Nothing
from the Math Engine ships or runs at that point — the formulas are translated ahead of time.

This is the parametric sibling of `sketchup/builderpluss/Classes/BakedObjectImporter.rb`. That one imports
`resolved.meshes` and what lands is correct and completely inert. This one imports formulas.

```bash
node tools/skpir/run.mjs    bed.json  bed.skpir.json   # translate
node tools/skpir/verify.mjs bed.json  bed.skpir.json   # prove it matches the bake
node tools/skpir/sweep.mjs  <dir>                      # how much of a library converts
```

## Why it works

A DC formula has no matrices, no meshes and no lathe, so translating a Math Engine body in general is
hopeless. But the library's 3D kernel is not general. `KERNEL` in `tools/tmp-pobj/common.mjs` sweeps a table
`Q` of quads from `z0` to `z1`, and **every column of every Q row is a scalar expression in the parameters**.
An axis-aligned quad swept in z is exactly what a DC sub-component is: a box with `lenx/leny/lenz` and
`x/y/z` formulas.

So the translation is: evaluate the body symbolically, stop at `Q`, and print one sub-component per row.

| Math Engine | Dynamic Component |
| --- | --- |
| a `Q` row | one sub-component box |
| `cond ? rows : zeros(0,11)` | `hidden` formula |
| `arange(n)` broadcast row | `copies` + the `COPY` index |
| `a ? b : c` | `IF(a,b,c)` |
| `&&` / `\|\|` | `AND()` / `OR()` |
| `style == 'Legs'` | `Parent!BaseStyle="Legs"` |

## What is deliberately dropped

`rotation`, `anchorDir`, `fitMode`, `margin`, `flipSide` and the host points `P` are the object's PLACEMENT
on a floorplan. SketchUp already has placement — it is the instance transform. Pinning them to their
standalone values collapses the whole FRAME / FIT / ANCHOR preamble to constants, which is what leaves the
geometry expressions small enough to read.

## Three traps, each of which returns success while being wrong

1. **A child formula naming a bare attribute reads the CHILD, not the parent.** Parameters live on the
   parent, so every reference is emitted as `Parent!Name`. Get this wrong and the part is the right shape
   and ignores every slider.
2. **`material` is a reserved DC attribute** — it paints the component. An object with a `material`
   parameter would drive the paint instead of appearing in the dialog, so reserved names are renamed
   (`material` → `MaterialSpec`).
3. **A zero-length side is a scale of 0, not a flat box.** Any slider can reach it (`legHeight` 0), and the
   DC engine either refuses it or collapses the instance. Every part carries a degeneracy guard in its
   `hidden` formula. The bake has no equivalent problem — it emits a zero-area face and moves on.

Also: both `Divan3D` and `DivanPlan` select group 1, and `buildFlow` strips each render row's `from`, so the
group → colour link survives only in the edges. Reading the statements alone gets the 2D name and no colour.

## Verification

SketchUp cannot be driven from outside a running session, so `verify.mjs` evaluates the emitted formulas
itself — DC is a small closed language — turns each part into the box SketchUp would draw, and compares
against the real bake. That covers the branches a screenshot would not:

```
12/12 cases match · 60 group boxes compared to 0.000001 m
```

## Coverage (94-object library, 2026-09-16)

| | count | |
| --- | --- | --- |
| fully translated | **35** | bed, sofa, table, chair, desk, cabinet, shelf, armchair, stool, dressing-table, window-seat, false-ceiling, rug, mirror, tv, led-strip, beam, and the sanitary/appliance set |
| partial | 3 | camera, curtain-track, fluted-panel |
| `loop` statements — box geometry, transpiler gap | 21 | nightstand, tv-unit, door, window, staircase, column, wall-cabinet, chest-of-drawers, shoe-rack, kitchen-counter … |
| other box-geometry gaps | 8 | wall, room, road, plot, dimension … |
| missing `^` / `%` operators | 5 | wardrobe, curtain, chandelier, car, bansuri |
| needs `kron()` | 2 | upholstered-panel, wall-art |
| non-axis-aligned quads | 2 | ceiling-fan, skirting |
| genuinely not boxes (tube / ring / loft / lathe) | 8 | pendant, light-bulb, plant, downlight, bike, piano, north-arrow, well |
| not geometry objects at all | 10 | the `detect-*` image objects, BOQ generator, opening |

The first four rows are transpiler work, not a limit of the idea: unrolling `loop`, adding two operators and
`kron`, and emitting `rotz` for a rotated quad would take the box-mapped set to roughly 70 of the 84 real
objects. The last row of real objects — revolves and tubes — needs a different mapping: a baked sub-mesh
inside the DC that scales with `lenx/leny/lenz`, which is right for a pendant shade and wrong for a fan blade.

## Install the importer

```bash
P="$APPDATA/SketchUp/SketchUp 2023/SketchUp/Plugins/builderpluss"
cp sketchup/builderpluss/Classes/DynamicObjectImporter.rb "$P/Classes/"
```

`Classes/Main.rb` needs the same two lines the baked importer uses, beside them:

```ruby
require "builderpluss/Classes/DynamicObjectImporter"
create_menu_item("import_dynamic_object", "Import a BuilderPluss object as a dynamic component", submenu_pobj, toolbar)
```

The command name, the `Main.import_dynamic_object` shim and `Icons/import_dynamic_object.png` must all match,
which is what keeps Main.rb's diff to one require and one line. Restart SketchUp.

**The Dynamic Components extension must be enabled** (Extension Manager). Without it the component still
lands with correct formulas and nothing evaluates them; the importer reports that rather than leaving you to
work it out from a pile of unit cubes.
