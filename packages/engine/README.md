# @builderpluss/engine

The expression language and computational-geometry library behind parametric floorplans. **The
single definition of how geometry and maths are computed** — every consumer relies on this and
nothing reimplements it.

Extracted from `monica_recent/src/floorplan`. Two copies of a language runtime or a geometry kernel
drift, and the drift shows up as geometry that differs between apps — the worst failure mode this
product has.

```
~17,800 lines · 86 modules · one runtime dependency (polygon-clipping) · no DOM, no I/O, no host eval
```

## One source of truth: `src/`

`package.json` points at `./src/index.ts`. **Consumers import the TypeScript directly** — there is
no build step in the normal path, and no `dist/` in the repo.

That is deliberate. When consumers resolved a compiled `dist/`, the package had two artifacts that
could disagree: edit the maths in `src/`, forget to rebuild, and the app kept running the previous
numbers with nothing to indicate it. For a package whose whole job is to be the single definition of
how geometry is computed, a silently stale copy is the one failure that matters. Taking the build
out of the resolution path removes that failure mode outright — an edit to `src/` is live on the
next reload, in every consumer.

```jsonc
"dependencies": { "@builderpluss/engine": "file:../engine" }
```

```
npm install
npm run typecheck   # tsc --noEmit; this config never emits
```

### The one exception: `@builderpluss/engine/node`

A consumer that cannot compile TypeScript — plain Node, no bundler — cannot read `src/`. For that
case only, `npm run build` emits `dist/` and the **`./node` subpath** resolves to it:

```js
import { runExprBody } from "@builderpluss/engine/node";   // the emitted build
import { runExprBody } from "@builderpluss/engine";        // src/, for bundlers
```

Everything above still applies to that subpath: it is only as current as the last build, so **run
`npm run build` after changing the maths** or that consumer keeps answering from the previous
version. Bundler consumers must keep importing `"."`, which reads `src/` and cannot go stale.

Its only caller today is `new_app/tools/expr-runner` — the worker that evaluates object expressions
for that project's Python backend, which needs the mesh builders and polygon booleans the backend's
own partial port of this language does not have.

**Bundler consumers need two settings**, because the package resolves to source outside their root:

```ts
// vite.config.ts
server: { fs: { allow: [__dirname, path.resolve(__dirname, "../engine")] } },
optimizeDeps: { exclude: ["@builderpluss/engine"] },   // else the maths get snapshotted into a cache
```

Next.js is the equivalent one-liner: `transpilePackages: ["@builderpluss/engine"]`.

### If a consumer cannot read TypeScript

A Node HTTP wrapper, say. `npm run build` uses `tsconfig.build.json` to emit ESM with explicit `.js`
specifiers, plus `.d.ts` and source maps. **Nothing resolves to that output** — it is disposable, it
is gitignored, and it must never be treated as a source. Rebuild it from `src/`; never edit it.

## The two layers

**The expression language** (`expr/`, `matrix/`) is the substrate: a real interpreter over matrices.
A program is a sequence of assignments evaluated against a scope; values are numbers, strings,
booleans, or matrices.

```ts
import { runExprBody, exprInputs, exprOutputs } from "@builderpluss/engine";

const program = `
  w = width * 2
  m = hcat(1, 0)
  n = rows(m)
`;

exprInputs(program);    // ["width"]        — without running it
exprOutputs(program);   // ["w","m","n"]    — without running it
runExprBody(program, { width: 0.9 });
// { w: 1.8, m: [[1, 0]], n: 1 }
```

Underscore-prefixed names are intermediates and stay out of the result, so a program computes freely
and publishes only what it means to.

**The geometry** (everything else) is 65 modules built on those primitives: polygon operations,
partitioning, layout optimisation, wall graphs, skeletonisation, massing. They ship in the same
package because the named algorithms in `expr/exprAlgorithms` are written as bodies of the language
itself — splitting them would put a cycle between two packages.

## Two ways to call it

The functional API is the real implementation and what the interpreter uses on its hot path. The
classes are immutable facades over those same functions, for callers who would rather chain than
nest. They share one representation — `number[][]` and `Point[]` — so moving between them is free.

```ts
import { Mat, Vec2, Vec3, Poly } from "@builderpluss/engine";

Mat.of([[1, 2], [3, 4]]).transpose().multiply(other).toArray();
Mat.where(mask, ifTrue, ifFalse);            // element-wise ternary

Vec2.of(3, 4).normalize().rotate(90).toPoint();
Vec2.fromRow(row).perp().dot(other);

Poly.rect(0, 0, 10, 10).inset(1, 1).area;    // 64 — 1 m setback at 1 px/m
Poly.of(ring).smooth({ type: "chaikin", level: 0.5 }).convexHull().centroid;
```

**Why facades rather than a rewrite.** The interpreter calls the core functions on raw `number[][]`
hundreds of times per render pass. Making the primitives into methods would put an allocation on
every operation in the hottest path in the product, to buy ergonomics only callers outside the
interpreter want. So the core is untouched and the classes wrap it.

## Layout

| Folder | Modules | What |
|---|---|---|
| `expr/` | 3 | parser, interpreter, introspection, named algorithms |
| `matrix/` | 4 | matrix primitives, 2D/3D booleans, mesh faces |
| `geometry/` | 23 | inset, smoothing, clipping, contours, bounds, axes |
| `partitioning/` | 13 | Voronoi, BSP, treemap, Delaunay, convex decomposition |
| `layout/` | 11 | the `optimise*` family, packing, inflation |
| `walls/` | 6 | mitring, splitting, corners, auto-room detection |
| `structure/` | 3 | wall/frame building, schema attribute resolution |
| `mass/` | 3 | 3D inset, smoothing, Voronoi |
| `classes/` | 3 | `Mat`, `Vec2`/`Vec3`, `Poly` |
| `dcr/`, `skeleton/`, `placement/`, `network/`, `semantics/`, `vector/` | 7 | setback rules, medial axis, boundary placement, pipe networks, region classification, raster tracing |

Subpath imports narrow the surface: `import { computeVoronoiCells } from "@builderpluss/engine/partitioning"`.

## Design constraints worth preserving

**Named algorithms are written in this language, not beneath it.** `EXPR_ALGORITHM_BY_NAME` entries
are bodies run through `runExprBody`, so what a caller displays is exactly what executes and no
algorithm can become an opaque builtin. Keep it that way when adding to `exprAlgorithms.ts`.

**No renderer.** Nothing here draws. Geometry functions return `Point[]` rings and matrices, and it
is the caller's business whether those become Konva shapes, SVG paths, three.js meshes or a DXF.
That is what lets one engine serve several apps.

**No I/O.** The Gemini object-detection adapter stayed in the host app precisely because it calls the
network. `lib` is `ES2020` with no `DOM`, so a stray `document` or `fetch` is a compile error rather
than something discovered when a second app runs the engine outside a browser.

**No host `eval`.** Programs run through a real interpreter, so untrusted input cannot reach the
JavaScript runtime.

## The type boundary

`src/types.ts` declares a deliberately narrow geometry vocabulary. The host app's `Wall` carries 172
fields — regulation flags, provenance markers, display state, parametric attachments that drag in the
whole document model. The algorithms here read 16 of them; `Room`, 10 of 43; `NodeMeta`, 7 of 26.
Importing the app's model to serve that would make a geometry library depend on one application's
domain.

TypeScript's structural typing does the rest: a host passing its own richer `Wall` satisfies these
with no adapter and no cast. Functions that split or filter walls are **generic** (`<T extends Wall>`)
so the caller's type survives the round trip. Functions that genuinely *construct* geometry — such as
`detectAutoRoomsFromWalls` — return the narrow shape, and a host widens once at that boundary.

Add a field here only when an algorithm actually reads or writes it. A field added "because the host
has it" re-opens the coupling this file exists to close.

## Untrusted input

There is no code-execution path, but there is a resource-exhaustion one. `loop` takes a count
expression, and several matrix builders allocate proportionally to their arguments — `kron`
multiplicatively. Anything accepting programs from outside its trust boundary needs an iteration
budget, a matrix-cell cap and a wall-clock timeout, and should run them somewhere it can kill.

If a non-JavaScript caller needs the engine, wrap this package in an HTTP handler — the wrapper must
**depend on** it, never reimplement it. `exprInputs`/`exprOutputs` give such a service a natural
`/introspect`; `EXPR_ALIASES` and `EXPR_ALGORITHMS` a `/catalog`.

## A note on the barrel

A handful of names are exported by two independent modules: `MeshType` (geometry/meshPolygon and
partitioning/earClipDelaunay), `V3` (matrix/axisMesh and mass/voronoi3d), `polygonArea` and
`Occupancy` within `dcr/`, and `walls/wallGeometry` duplicates the split-out `wallCorners` /
`miteredWalls` / `splitWallsAtIntersections` wholesale — a pre-existing condition inherited from the
host, not introduced by the extraction.

The root barrel resolves these first-come-wins over an explicit priority order, so exactly one
implementation answers to each bare name. Shadowed ones stay reachable through a deep import. The
generator prints every collision it resolves; nothing is silently dropped. (The two `polygonArea`
implementations were checked and are numerically identical, so that choice is behaviour-preserving;
the two `Occupancy` unions are NOT identical, which is why `circularSetbackSolver` holds the priority
— its is the one consumers pass to `runCircularSetbackSolver`.)

## Three files are reconstructions

`expr/expr.ts`, `expr/exprCatalog.ts` and `expr/exprAlgorithms.ts` carry a `RECONSTRUCTED` header.
The originals were lost on 2026-08-10 and were rebuilt from an esbuild bundle dated 2026-08-03. The
data and logic are byte-faithful to that bundle and verified against the real `door.json` program,
which returns identical values. What the bundler stripped — type annotations and the original prose
comments — was written back by hand, so those are inferred rather than original, and any edit made to
those three files between 2026-08-03 and 2026-08-10 is not present. Git's copy of `expr.ts` is a much
older 194-line design with no matrix support, so it was never a fallback.

## What is deliberately *not* here

The parametric-object evaluator (`parametricObject.ts`, `evalNodes.ts`, `evaluateFlow.ts`) stayed in
the host. That is a second, larger package that would *depend* on this one. Extracting it is a
separate decision, not an extension of this one.
