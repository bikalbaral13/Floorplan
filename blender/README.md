# Parametric object → Blender

Imports a BuilderPluss parametric object into Blender and **keeps it parametric**: the parameters land on
the imported empty and the geometry rebuilds whenever one changes. No bake, no round trip to the web app,
no Math Engine inside Blender.

Same transpiler as the SketchUp route (`tools/skpir/`), different printer: SketchUp gets inches and
spreadsheet formulas, Blender gets metres and Python expressions.

```bash
node tools/skpir/run.mjs bed.json bed.blir.json --target blender
```

## How it is parametric

The IR carries each part as an axis-aligned box whose position and size are **Python expressions over the
parameters**. The import builds:

- an **Empty** holding every parameter as a custom property, with its UI min/max taken from the object's own
  slider definition, plus the whole IR so a rebuild needs no external file
- one **unit-cube child per part**, whose `location` and `scale` are the evaluated expressions

Changing a parameter tags the object, which raises `depsgraph_update_post`, which re-evaluates and moves the
children. Mesh data is only touched when a **count** parameter changes (pillows, drawers) — otherwise a
rebuild is two vectors per part, so dragging a slider is cheap.

## Using it

**Builder+ sidebar → Parametric Tools → Parametric Objects → Import Parametric Object**, pick a
`.blir.json`. With the imported object selected, the same panel lists its parameters; there is also a
**Rebuild** button as a manual fallback.

Blender caches addon code at launch, so after installing: **Scripting workspace → Text → Open →
`House/dev_reload.py` → Alt+P**, or just restart.

## eval, and why it is not a hole

The part expressions are evaluated with `eval`, on a file the user picked off disk. Every expression is
therefore parsed to an AST and checked against a whitelist **first** — arithmetic, comparisons,
conditionals, nine maths functions, and subscripting the params dict. Anything else is refused and the
import fails loudly. Whitelisting the tree is the check that holds; clearing `__builtins__` on its own is
not. All formulas are compiled at import, so a bad file fails when it is opened rather than mid-drag.

## Test

```bash
node tools/skpir/expected.mjs bed.json bed.expected.json
blender -b --python blender/test_parametric_object.py -- bed.blir.json bed.expected.json
```

It enables the real addon and calls the real operator, so it covers registration, the panel's operator ids,
the importer and the live-rebuild path — not just the maths. Geometry is compared against `expected.json`,
which comes from the Math Engine, so a pass means Blender agrees with the web app rather than with a second
copy of the same assumptions.

```
ALL PASS — 11 geometry cases + 9 behaviour checks
```

**One thing the test had to get right to be worth anything:** assigning `obj["Length"] = 2.4` from Python
does not tag the object, so no depsgraph update fires and nothing rebuilds. A test that only assigned would
have passed while exercising nothing. `touch()` calls `update_tag()` — the same signal the UI slider sends.

## Frame

The IR is already in Blender's frame: metres, +x east, +y north (the object frame's +y **south** is flipped
by the transpiler), +z up. So `utils/parametric_object.py` has no axis handling at all.

## Installed files

| File | |
| --- | --- |
| `utils/parametric_object.py` | new — the importer, rebuild and depsgraph handler |
| `operators/ops_parametric.py` | patched — two operators added, originals in `.bak-preparametric` |
| `panels/panel_main.py` | patched — the button and the parameter list |
