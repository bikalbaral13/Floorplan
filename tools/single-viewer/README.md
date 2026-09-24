# Single-file bedroom viewer

One `.html` that reads a canvas plan, evaluates every attachment live, and renders it in 3D with a
parametric panel and the moodboard compiled in. No server, no build step at run time, no network.

```bash
node tools/single-viewer/build.mjs
```

Output: `tools/single-viewer/dist/bedroom-viewer.html` — about 1.2 MB. Open it by double-clicking.

```
node tools/single-viewer/build.mjs <plan.json> --out <file.html> [--keep-prose]
```

`--keep-prose` leaves the object descriptions in (53 KB of design rationale the viewer never reads).

---

## What is inside, and why

| Piece | Size | Where it comes from |
|---|---|---|
| three.js r147 | 594 KB | lifted once from `headboard_configurator_standalone.html`, cached in `cache/three.min.js` |
| Parametric engine | 101 KB | **compiled from `src/floorplan/flow/eval/spineObject.ts`** at build time |
| 24 object definitions | 415 KB | `cache/objects/`, mirrored from R2 `library/Objects/Architectural/` |
| 6 material files | 5 KB | `cache/materials/`, mirrored from R2 `library/Materials/` |
| Jost, latin subset | 35 KB | `cache/fonts/jost-latin.woff2`, base64 into an `@font-face` |
| Plan + moodboard + app | 130 KB | the plan JSON, `src/moodboard.json`, `src/app.js`, `src/app.css` |

The engine is **compiled from the app's own TypeScript**, not copied. It cannot drift from what the
canvas editor evaluates, because it is the same code. `src/engine-entry.ts` is the whole surface: the
spine resolver plus the three graph-wide helpers the wall band needs.

## The sharing contract

The finished file is meant to be **sent to someone**. It therefore loads nothing:

- **Classic scripts only.** `<script type="module">` is blocked from `file://` by CORS, so the engine is
  bundled as an IIFE onto `window.PlanEngine`. No workers either.
- **No fetch, no XHR, no `src`, no `href`.** Every asset is inlined; the output has exactly four tags
  that could load anything and all four are inline `<script>`. The plan's `imageUnderlay` is dropped at
  build time — it pointed at R2 and was the file's only live network dependency.
- **The typeface is embedded.** A Google Fonts `<link>` would be a live call on every open, and on a
  machine that is offline or behind a proxy the page would silently change shape. Jost is a variable
  font, so the latin subset embeds once at 35 KB and serves 400, 500 and 600 by interpolation.
- **Textures are generated, never loaded.** A `file://` page that draws an image into a canvas taints
  it, and a tainted canvas cannot be pre-filtered into an environment map. So the fabric weave normal
  map and the studio environment are both built in code.
- **Storage is optional.** Every `localStorage` access is wrapped; the viewer works with it blocked.

**The build enforces this.** Step 6 scans the output for any `src`/`href`/`data` attribute that is not
`data:` or `#`, any `url(http…)` and any `@import`, and exits 1 rather than writing a file that would
phone home. Adding a stylesheet link back to `src/index.html` fails the build by design.

Verified over `http://localhost`, where the page makes **zero** subresource requests of its own. The
`file://` claims are structural — checked by inspecting the output, not by opening it from disk.

One practical note for sending it: at 1.25 MB it is fine on Drive, Slack, WeTransfer or a USB stick,
but some mail gateways strip or rewrite large HTML attachments. Zip it for email.

## Frames

Three meet, and they do not agree on their own:

```
canvas plan    world PIXELS, x east, y SOUTH (down the page)   settings.pixelsPerMeter converts
spine output   ANCHOR-RELATIVE METRES, [x, y, z], z up          what resolveSpineObject returns
three.js       Y-up, right-handed
```

A vertex goes `world = (anchorX + mx, mz, anchorY + my)` — plan y lands on three z — and the model is
then translated so the room centroid sits at the origin.

Anchors and hosts mirror `src/floorplan/export/bakeAttachments.ts` exactly: a segment object anchors at
the wall midpoint with its two ends as host, a node object at the node with one host point, a space
object at the centroid with the room ring.

## The wall band

`wall.json` ships its own 3D Render row switched **off**, and the viewer rebuilds the band instead of
forcing that row on. Two reasons, neither knowable from inside one segment:

- **Mitre** — corners join only if the footprint is the mitred polygon, a property of the whole wall
  graph. Per-segment boxes double up at every corner.
- **Spandrel** — a segment hosting a door or window carries band only above the head, and below the
  sill for a window, or the opening is buried in solid wall.

## The lighting adapter

The objects carry photometry as numbers and draw a yellow lens; nothing in a plan emits light. So the
rig is derived, in candela, with `physicallyCorrectLights`:

| Object | Becomes | From |
|---|---|---|
| `downlight` ×6 | SpotLight, shadow-casting | 650 lm, 36° beam → 2114 cd |
| `pendant` ×2 | PointLight | 320 lm → 25 cd |
| `ceiling-fan` | PointLight | when `lightKit` or `ringLight` is on |
| `light` (`type: Directional`) | **the sun** | 18000 lm over its stated 1.52 × 2.13 m aperture → 5536 lux |
| any mesh named `…LED`, `Halo`, `Bias`, `Diffuser` | sampled PointLights | viewer defaults, see `COVE_LUMENS_PER_POINT` |

That directional light is this plan's **sun proxy** — "V-Ray Sun through the west window at about
3:30 pm". Rendering it where it stands would put a 12,000 cd point source a metre outside the wall.

Because the units are real, the exposure has to sit where a camera's would: a 300 lux wall at 0.8
albedo is ~76 cd/m², so `EXPOSURE_BASE` is 0.0024 and the Exposure slider multiplies it.

Sun direction comes from `rotation + 90°` (bearing, measured `atan2(x, −y)`) and `aimTilt`. That
convention was checked against all four camera objects' own view cones.

## Known gaps

- **The 24 objects have no Material node wired.** Their `material` parameter is prose for AI rendering
  (`"light oak veneer, matte lacquer"`), and their 3D rows carry flat hex colours. So the finishes are
  applied by a **viewer-side override layer** — `moodboard.json`'s `surfaces`, matched on object id and
  mesh name. Six finishes resolve to real `Materials/*.json` files; the rest are viewer-local. Wiring
  Material nodes into the objects is the durable fix and would benefit Blender and DXF too.
- **No rules or checks.** The headboard configurator's `rules` array (`"wider than the wall"`) has no
  pobj equivalent; the output node carries scalars with no level or message.
- **No parameter groups in the format.** The panel buckets a flat parameter list by keyword. That is
  the only place this code guesses at anything — see `GROUPS` in `app.js`.
- **The channel headboard is not in the library.** `upholstered-panel.json` is the nearest object and
  the plan uses it, but it has no `puff`, `edge_radius` or `end_taper`.
- **Mesh names carry meaning.** `EMISSIVE` and `HELPER` are regexes over part names. A new object that
  spells its LED strip differently will not glow.

## Refreshing the library

`cache/objects` and `cache/materials` are mirrors, not sources. To re-pull:

```bash
B=https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library
curl -s -o cache/objects/bed.json "$B/Objects/Architectural/bed.json"
```

`library/index.json` is stale — it reports 19 objects and no materials at all, while all 24 objects and
the materials fetch fine. Do not build the loader against the index.

The typeface needs a browser user-agent or Google serves ttf instead of woff2:

```bash
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
curl -s -A "$UA" "https://fonts.googleapis.com/css2?family=Jost:wght@400;500;600&display=swap"
# then take the woff2 whose unicode-range starts U+0000-00FF (the latin subset)
curl -s -A "$UA" "https://fonts.gstatic.com/s/jost/v20/92zatBhPNqw73oTd4g.woff2" -o cache/fonts/jost-latin.woff2
```

Build without the cached font and you get a warning, not a failure — the file falls back to Segoe UI.

## Debugging

The viewer exposes `window.__viewer` once the scene is up: `scene`, `camera`, `renderer`, `instances`,
`byId`, `groups`, `lights`, `state`, `shots`, plus `evaluate`, `rebuild`, `setShot`, `select`.

```js
__viewer.instances.filter(i => i.objectId === 'wardrobe-with-math')[0]
__viewer.state.overrides
```
