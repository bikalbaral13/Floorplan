# Baked Object Import (SketchUp)

Imports a **baked** BuilderPluss parametric object into SketchUp as a component. It is a button on the
existing **Builderpluss** plugin's toolbar, not a separate extension.

The importer knows nothing about spines, flows or the Math Engine. It reads `resolved.meshes` — face rings
that have already been evaluated — and draws them. Everything parametric happens earlier, in `npm run bake`,
so there is exactly one implementation of the geometry semantics.

## 1. Bake an object

```
npm run bake -- https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library/Objects/Architectural/bed.json
```

Writes `bed.baked.json` next to the source (or in the cwd when the source is a URL). Useful flags:

| Flag | Effect |
| --- | --- |
| `--list` | print the parameter schema and exit |
| `--set key=value` | override a parameter (repeatable) |
| `--out <file>` | choose the destination |
| `--pretty` | indent the JSON (roughly 2x the size) |

## 2. Install

The two new files drop into the existing plugin, matching its own layout — `Classes/` for code, `Icons/`
for a 48x48 PNG named after the command:

```bash
P="$APPDATA/SketchUp/SketchUp 2023/SketchUp/Plugins/builderpluss"
cp sketchup/builderpluss/Classes/BakedObjectImporter.rb "$P/Classes/"
cp sketchup/builderpluss/Icons/import_baked_object.png "$P/Icons/"
```

`Classes/Main.rb` then needs the lines below, which are already applied on this machine. `patch-main-rb.mjs`
in this folder re-applies the toolbar half of them if a plugin update ever overwrites `Main.rb`:

```bash
node sketchup/patch-main-rb.mjs "$APPDATA/SketchUp/SketchUp 2023/SketchUp/Plugins/builderpluss/Classes/Main.rb"
```


```ruby
require  "builderpluss/Classes/BakedObjectImporter"     # beside the other Classes requires

submenu_pobj=submenu.add_submenu("Parametric Objects")  # in the toolbar block
create_menu_item("import_baked_object", "Import a baked BuilderPluss object (.baked.json)",submenu_pobj,toolbar)
```

`create_menu_item` builds `UI::Command.new(name) { self.send(name) }` against `Main` and derives the icon
path as `Icons/<name>.png`, so the command name, the method name and the icon filename must all match —
`import_baked_object`, `import_floorplan`. Each `Main.<name>` shim lives at the bottom of its own importer,
which is what keeps Main.rb's diff to a require and one menu line per button.

Two further changes make the **toolbar** reliable (`patch-main-rb.mjs` applies both):

- `toolbar.show` is deferred behind `UI.start_timer(0.1, false)`. Called while the file is still loading it
  can run before SketchUp's UI exists, and the toolbar is then built and populated but never displayed —
  the menu items appear and the toolbar does not, which is exactly how the failure looks.
- `create_menu_item` guards its icon assignment and rescues per command, so one bad button cannot abort the
  block before `toolbar.show` is reached. Failures print to the Ruby Console instead.

Restart SketchUp after installing. If the toolbar is still hidden, **View → Toolbars → Builderpluss**, or
run `UI::Toolbar.new("Builderpluss").show` in the Ruby Console to show it without restarting.

## 3. Import

**Builderpluss** toolbar → the teal-arrow-over-cube button, or **Extensions → Builderpluss → Parametric
Objects → Import a baked BuilderPluss object**. Pick a `.baked.json`.

The import reports itself against the file's own metrics:

```
Bed
  hash      91e9ef89f1aed0ae
  meshes    5
  faces     54

Bounding box vs baked metrics (m):
  Length     2.0000   expected   2.0000   OK
  Width      1.5000   expected   1.5000   OK
  Height     1.0500   expected   1.0500   OK

Geometry matches the baked metrics.
```

That comparison is the point of the pilot. The baked file carries *Overall length / width / height* as
metrics, so a correct import proves itself. A mismatch localises the bug immediately — everything 39.37x
too large is a double unit conversion, swapped Length and Width is the axis mapping.

## Frame

`resolved.frame` states its convention rather than leaving it to be inferred:

> metres · x east · y **south** (down the plan page) · z up

SketchUp is z-up with +y **north** and works internally in inches, so the entire conversion is

```ruby
Geom::Point3d.new(x.m, -y.m, z.m)
```

which lives in `BakedObjectImporter.ring_points` and nowhere else.

## Known limits (v0)

- **3D only.** `resolved.plan` (the 2D rings) is baked but ignored.
- **Face winding is not resolved.** A face may arrive back-side-out, so materials are painted on both
  sides. Orienting faces against the group centroid is the next fix.
- **No small-geometry scaling.** Fine for furniture; door hardware and glazing beads below roughly 1 mm
  will need the build-at-100x-then-scale trick, because SketchUp discards edges under ~0.001".
- **One object per import, at the origin.** Multiple attachments and host placement come later; the
  geometry is already built inside a `ComponentDefinition` so that step is additive.
- **Canvas-hosted objects are refused by the bake**, not by the importer — they read the whole drawing and
  have nothing to show standalone.

Each imported instance carries `sourceHash`, `bakedAt`, `bakedFrom` and the full `params` in a
`builderpluss` attribute dictionary. Nothing reads them yet; they are what makes a "re-bake this instance"
command possible without the user having to remember any of it.
