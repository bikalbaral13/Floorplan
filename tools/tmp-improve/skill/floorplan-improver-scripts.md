---
id: floorplan-improver-scripts
name: The scripts — copy these, do not retype them
category: Floorplan Improver
when: Every improve run. `improve.mjs` beside it is the library; this file says how to drive it.
tools: [Bash, Read, Write]
---

Four files, all pure — plan in, plan out, no network, no live canvas. Download them next to the plan and drive them from a short run script.

| file | what it is for |
|---|---|
| **`improve.mjs`** | units, geometry, plan reading, room classification, tile set-out, the lumen method, the three emit shapes, the verification checks |
| **`geom.mjs`** | per-room interior **faces**, each side with its OWN wall thickness, the openings on each side, and the door clearance zones |
| **`bake.mjs`** | runs one object's Math Engine headlessly and hands back its real plan footprint |
| **`overlay.mjs`** | bakes the whole plan and writes it as one coloured SVG — check 8 |

Everything below has been run against two real plans: the reference fit-out (`floorplan_with_bedroom_v2_with_lightings.json`, 145.0187 px/m) and a full 3BHK fit-out (`floorplan_with_bedroom.json` → `_after_improvement.json`, 144.278 px/m, 12 spaces, 307 attachments). The numbers quoted are what they actually printed.

## Use geom.mjs, not a median wall thickness

`improve.mjs`'s `wallThickness()` gives the median run, which is fine for a rough clear dimension. Real plans are not uniform: this one carries 0.243, 0.215, 0.194, 0.146, 0.125, 0.118 and 0.090 m walls, so a room can have a 243 mm party wall and a 118 mm partition on the opposite side. `geometry(plan).rooms[id].face` resolves each side separately and is what every placement should work from:

```js
import { geometry } from "./geom.mjs";
const G = geometry(plan);
const r = G.rooms["space-03r"];
r.face      // { x0, x1, y0, y1, w, h } — the real INTERIOR, per side
r.side.N    // { at, half, thickness, walls: [ …the segments on that line… ] }
r.openings  // [ { side, kind, w, seg, lo, hi, c, params } … ]
r.zones     // door clearance polygons, 0.9 m into THIS room
```

`r.side[k].walls` is also how you find the segment id to attach a trim to, without guessing.

## Bake before you believe anything about orientation

`bake.mjs` is what turns "rotation is never typed in" from a slogan into a check. It runs the object's own Math Engine and gives back the plan rings the canvas will draw:

```js
import { planBBox, planSlots } from "./bake.mjs";
planBBox("toilet.json", [[0, 0]], { rotation: 0 });    // node host
planBBox("skirting.json", [[ax, ay], [bx, by]], p);    // segment host
planBBox("tessellation.json", ring, p);                // space host
```

Read the per-slot centroids (`planSlots(file).drawn`) to find where a kind's telling element sits, and you have its back. **Measured this way, at rotation 0:**

| back at | kinds |
|---|---|
| **−x** | `toilet` (cistern), `bed` (headboard and pillows), `chair` (backrest) |
| **−y** | `washbasin` (tap), `armchair` (backrest) |
| **+y** | `wardrobe`, `tv-unit`, `nightstand`, `chest-of-drawers`, `cabinet`, `sofa`, `dressing-table`, `desk`, `shelf` — all of them because their **fronts** (doors, drawers, screen) sit at −y |

Then the rotation that puts a back against a side is a table lookup, never a guess:

```
back −x:  W 0    N 90   E 180  S 270
back −y:  N 0    E 90   S 180  W 270
back +y:  S 0    W 90   N 180  E 270
back +x:  E 0    S 90   W 180  N 270
```

This caught three faults in one input: two WCs left floating 0.8 m off any wall by the trace, and a media console whose drawer fronts faced into the wall.

## The two rules the library encodes

**Pixels and metres.** `nodes[].x/y` are pixels at `settings.pixelsPerMeter`; every `params` value is metres. `m()` and `px()` are the only two places that conversion happens. If you write `* ppm` anywhere else, that is the bug.

**The ring is not the room.** A space ring lies on the wall **centrelines**, so `space.length` is one full wall thickness larger than the floor you can tile. Always go through `clearDims(space, wallThickness(plan))`. Measured on the reference: ring 4.1899 × 3.9614 m, clear **3.9623 × 3.7338**, against a printed `13'0" × 12'3"` = 3.9624 × 3.7338. That is 0.1 mm — set out on the ring instead and every cut tile is half a tile wrong.

## Drive it

```js
import fs from "node:fs";
import * as I from "./improve.mjs";

const plan = JSON.parse(fs.readFileSync(IN, "utf8"));
const read = I.readPlan(plan);
const th   = I.wallThickness(plan);
const H    = I.ceilingHeights(plan);        // { slabHeight, bandSoffit, panelSoffit }
const mk   = I.idMinter(plan);              // never collides with the input's own ids

for (const sp of read.spaces) {
  console.log(sp.id, sp.label, sp.type, sp.area.toFixed(2) + " m²",
              I.clearDims(sp, th));
}
```

On the reference this prints `space-00q "M. BEDROOM" bedroom 16.60 m²` and `{ slabHeight: 3.3528, bandSoffit: 2.9728, panelSoffit: 3.1228 }`. **Note the heights come from the wall object**, not from a 2.7 convention — a downlight at 2.7 in this room hangs 650 mm below the ceiling.

## Tiles

```js
const spec = { pattern: "Square", cellSize: 0.8, cellLength: 0, joint: 0.002,
               materialPath: "Finishes/tile.json",
               material: "800 × 800 ivory marble-look porcelain, matt, 2 mm matching grout",
               semantics: "large-format porcelain floor, warm ivory, matt, calm" };
const { attachment, setOut } = I.tileField(sp, spec, mk, th);
sp.raw.attachments.push(attachment);
```

`setOut.u` / `setOut.v` carry `wholeTiles`, `offset` and `cut`. Measured on the reference bedroom:

| Tile | U | V |
|---|---|---|
| 800 vitrified, 2 mm | 3 whole, **778 mm** cut each end | 3 whole, **664 mm** cut |
| 600 vitrified, 2 mm | 5 whole, **476 mm** cut | 5 whole, **362 mm** cut |
| 200 × 1200 oak plank, 1 mm | 18 whole, **172 mm** cut | 2 whole, **666 mm** cut |

Read `cut` back into the report. A cut under 100 mm means the tile is wrong for the room — change the tile, not the offset.

## Lighting

```js
const { count } = I.lumenMethod(sp.area, { targetLux: 130, fixtureLumens: 650 });
const grid = I.downlightGrid(sp, count, { thickness: th, setback: 0.6 });
for (const [x, y] of grid.points) {
  const o = I.nodeObject(plan, {
    xM: x, yM: y, layer: "downlight",
    objectId: "downlight-with-math",
    objectPath: "Objects/Architectural/downlight.json",
    params: { mountHeight: H.panelSoffit, lumens: 650, kelvin: 3000, cri: 90,
              beamAngle: 36, dimLevel: 100, showBeam: false,
              lamp: "Photometry/LED/cob-spot-3000k.json", lightGroup: "downlights",
              sceneMembership: "Bright, Photo", emitsLight: true,
              materialPath: "Metal/powder-coat.json", finishes: "Lens=Emissive/diffuser.json",
              material: "white powder-coated trim, frosted lens, 3000K COB",
              semantics: "discreet recessed spotlight, clean ceiling, minimal trim" },
  }, mk);
  plan.nodes.push(o.node);
  plan.segments.push(o.segment);
  plan.graphAttrs.nodes[o.graphAttr[0]] = o.graphAttr[1];
}
I.addLayer(plan, { id: "downlight", name: "Downlights", color: "#eab308" });
```

`downlightGrid` refuses an asymmetric arrangement: asked for 9 in the reference bedroom it returns **3 × 3**, not a row of five. It searches `nu × nv` up to 8 × 8 for the factorisation closest to the requested count with the squarest spacing. With a ceiling fan at the centre, drop the centre point and keep the eight.

## The tile cap is real — step up, do not ask for the impossible

`capSafeCell(space, pattern, cellSize)` reproduces the object's own 250-cell floor over the space's bounding box and, when the requested size is below it, steps **up** to the next real tile size and says so. Measured: OPEN TERRACE E, bbox 3.802 × 6.564 m, asked 300 mm → the object would have silently drawn **315.9 mm**. The skill takes 400 mm instead, which is a tile that exists, and reports the substitution.

## The three host shapes

`nodeObject` returns **all three pieces** — the node, its degenerate marker segment, and the `graphAttrs.nodes` entry keyed by the *marker segment's* id. Push all three. A node without its marker does not show; a marker without the graphAttrs entry is not recognised as an object.

```js
plan.segments.find(s => s.id === wallId).attachments.push(
  I.segmentObject({ objectId: "skirting-with-math",
                    objectPath: "Objects/Architectural/skirting.json",
                    params: { height: 0.076, thickness: 0.018, profile: "Square",
                              materialPath: "Finishes/paint-eggshell.json" } }, mk));

sp.raw.attachments.push(
  I.spaceObject({ objectId: "false-ceiling-with-math",
                  objectPath: "Objects/Architectural/false-ceiling.json",
                  params: { slabHeight: H.slabHeight, bandSoffit: H.bandSoffit,
                            panelSoffit: H.panelSoffit, bandWidth: 0.305,
                            bandSides: "All four", coveLed: true,
                            lamp: "Photometry/LED/tape-warm-2700k.json",
                            lightGroup: "cove", sceneMembership: "Relax, Night, Photo" } }, mk));
```

`segmentObject` now defaults to `fitMode: "Exact"` — **not** `"Fill segment"`, which is `wall.json`'s own vocabulary and silently does nothing on every other object (see `emit-improved-canvas-json` for the measured table). Pass `fitMode: "Off"` for anything hung at a point and position it with `t`.

For a trim on a **party wall**, tell `onSeg` which room it belongs to and let `flipToward()` work out `flipSide` from the wall direction and the room centre:

```js
const flip = I.flipToward([ax, ay], [bx, by], [roomCx, roomCy]);
```

On the 3BHK that flipped two of seven wet-room fittings — a mirror that would have hung in the stairwell and a towel rail that would have hung in the bedroom.

## Verify

```js
const out = JSON.parse(JSON.stringify(plan));
const shell = I.shellUnchanged(input, out);          // { faults: [], maxDelta: 0 }
console.table(I.completionTable(out, I.readPlan(out)));
const clash = I.clearanceFaults(placed, doorZones);  // metres in, mm out
const refs  = I.referenceFaults(out, { objects, materials, photometry });
```

`placed` is `[{ name, band, cx, cy, len, wid, rot }]` in metres; bands are `floor` / `wall` / `high` / `surface` and only floor–floor pairs are tested. `clearanceFaults` uses a separating-axis test and reports the penetration in millimetres — two 2 × 1 m boxes 0.5 m apart come back as `{ kind: "overlap", mm: 1000 }`.

`referenceFaults` needs the three library listings as `Set`s of paths. Build them once:

```js
const listing = async (prefix) => new Set(
  (await listObjectsDetailed(cfg, `library/${prefix}/`))
    .map(o => (o.key ?? o.Key).replace(/^library\//, "")));
const objects    = await listing("Objects");
const materials  = await listing("Materials");
const photometry = await listing("Photometry");
```

## Upload

Same as every other library asset — `putObject` from `tools/r2.mjs`, content-type `application/json` for the plan, `text/markdown; charset=utf-8` for a skill:

```js
import { r2ConfigFrom, putObject } from "file:///D:/MAIN/monica_recent/tools/r2.mjs";
const env = Object.fromEntries(fs.readFileSync(".env", "utf8").split(/\r?\n/)
  .filter(l => l.includes("=") && !l.startsWith("#"))
  .map(l => { const i = l.indexOf("="); 
              return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
await putObject(r2ConfigFrom(env), `library/Designs/${name}.json`,
                JSON.stringify(plan), "application/json");
```

The `.env` values are **quoted**; strip the quotes or `new URL(endpoint)` throws `ERR_INVALID_URL`.

## Draw the result

```bash
node overlay.mjs output.json     # → overlay.svg
```

It bakes every attachment, groups the rings by kind, colours them by what they are (floor finish, trims, furniture, sanitary, lighting, services) and layers them in that order with room labels and clear dimensions. On the 3BHK it drew **291 of 305** attachments; the 14 it skipped were the marker-only objects (`render-look`, `exterior-context`) and anything not downloaded. Hand this to the user with the JSON — the counts never show a bed inside a wardrobe, and this does.

## Where the library is wrong, fix the library

`improve.mjs` is a starting point, not scripture. When a run finds a rule it does not encode — a room type it misclassifies, a bond it cannot set out — add it here and re-upload, so the next run starts from the corrected version rather than from the same gap.
