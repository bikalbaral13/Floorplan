# library/Objects — reusable parametric objects

One JSON per object, in a discipline folder: `Architectural/`, `Furniture/`, `Hydraulics/`, `MEP/`, `Miscellaneous/`,
`People/`, `Photometry/`, `Site/`, `Structural/`. Photometry holds `lamp/1` light definitions used by the lighting objects.

On a canvas an object is an **attachment** on a node, segment (wall) or space, by its library path
(`objectPath: "Objects/Architectural/downlight.json"`) with its own parameter values.

## Fields

| key | meaning |
|---|---|
| `id`, `title`, `version`, `category`, `description` | identity; `category` = the folder |
| `object` | what it attaches to and its default parameters |
| `nodes`, `edges` | the **six-node spine**: a Math Engine graph that turns parameters into 2D plan shapes and 3D geometry |
| `python` | optional (object/2): the same graph as generated Python, with baked results |

The evaluator is built into the editor (`packages/engine`); an object carries its graph, not the engine.

## Rules

- Parameters are in **metres**; plan coordinates are pixels (`settings.pixelsPerMeter`).
- Every object (except wall / door) has `renderMode`: `Nothing` (no geometry), `Basic` (a size box, no evaluation),
  `Full` (evaluated).
- Materials are referenced by `params.materialPath` → `Materials/<category>/<name>.json`.
- Reusable only; an object made for one project still lives here if it can be reused.
- Never rename or delete an object that canvases use. Publish a new version instead.
