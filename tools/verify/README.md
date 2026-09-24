# Verification harness

Deterministic regression checks for everything in `public/Library` that the app **evaluates** — parametric
objects (`Objects/`) and flow graphs (`Workflows/`).

```bash
npm run verify
```

```bash
npm run verify:update
```

## Why this exists

The library is increasingly authored rather than hand-written — by the Flow agent, the Parametric agent, the
`flowToPobj` bake, the node-declaration migration. Reviewing that work by opening the app and looking at it
does not scale, and "it renders something plausible" is not the same as "it is correct".

So: every artifact is evaluated through the **real engines** (`evalParametric*`, `evaluateFlow` — not a
reimplementation) and reduced to a fingerprint that is committed to git. A change in behaviour then shows up
in review as a readable diff:

```
CHANGED  public/Library/Objects/Architectural/door.json
           cases.free.geometry.fill.area: 1.8624 → 2.0410
           cases.free.geometry.fill.vertices: 48 → 52
```

That is the whole point. The pass/fail line is secondary to the diff.

## What a fingerprint records

Each artifact gets one baseline at `tools/verify/baselines/<path>.print.json`, holding both a strict `hash`
and readable statistics — the hash catches *any* change, the statistics explain *what* changed.

**Objects** are evaluated twice, in two cases:

| Case | Host | Purpose |
|---|---|---|
| `free` | none | the object standing alone |
| `hosted` | a fixed 10 × 8 m rectangle | host-aware objects (Site, Floor Plate, Massing) produce nothing without one |

Both always run. A non-host-aware object simply fingerprints identically twice — which means a change that
accidentally makes an object host-sensitive shows up immediately.

Per case: 2D geometry (fill / lines / refLines — ring count, vertex count, area, bbox), 3D solids (count,
approximate volume), and the output metrics exactly as the node's `val-<key>` endpoints publish them.

**Flows** are evaluated headlessly with no canvas content, and record per-node polygon statistics. Status
distinguishes the cases that would otherwise all look like "empty":

| Status | Meaning |
|---|---|
| `ok` | produced geometry |
| `needs-canvas` | rooted on a canvas source (a Space, an image, a freehand stroke) — correctly inert here |
| `empty` | produced nothing with no canvas root — **suspicious**, worth investigating |
| `error` | threw, or references a tool that is not registered |

## Conventions worth knowing

- **Evaluation runs at 50 px/m** (the app default), because the engines carry pixel-scale thresholds —
  sub-pixel segments get dropped. Evaluating at 1 px/m would silently change behaviour.
- **Fingerprints are in metres.** Coordinates are divided by that scale before hashing, so baselines survive
  a change to the default zoom.
- **Rounded to 4 dp** (0.1 mm) before hashing — below any meaningful modelling change, above float noise.
- **Non-finite values are never rounded away.** A `NaN` coordinate is encoded literally and counted in
  `nonFinite`. Any non-zero `nonFinite` is a bug whether or not it matches the baseline.
- **An evaluation error fails the run even under `--update`.** Recording a broken artifact as "expected" is
  precisely the silent pass this harness exists to prevent.

## Options

| Flag | Effect |
|---|---|
| `--update` | write/refresh baselines instead of comparing |
| `--filter <substring>` | restrict to artifacts whose path matches |
| `--list` | list what would be checked, evaluate nothing |
| `--prune` | delete baselines whose artifact no longer exists |

```bash
node tools/verify/run.mjs --filter door
```

New artifacts report as `NEW` and fail the run until baselined — so a file added by an agent cannot slip in
unverified.

## How it runs

`run.mjs` bundles `main.ts` with esbuild (already a Vite dependency) and imports it. No test runner, because
this is one deterministic pass over the library rather than a suite of assertions, and bundling side-steps
the extensionless-import resolution that plain Node cannot do.

This does **not** type-check — `tsc -p tsconfig.app.json` covers the app. The harness deliberately runs even
when the app has unrelated type errors, so it can be used to bisect them.

## Adding coverage

The harness walks the disk, so a new object or workflow file is picked up automatically. Extending what is
*recorded* means touching `evaluate.ts` — note that changing a fingerprint's shape invalidates every existing
baseline, so do it deliberately and regenerate in its own commit.
