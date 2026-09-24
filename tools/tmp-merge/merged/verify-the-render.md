---
id: verify-the-render
name: Prove the scene before handing over the .blend
category: Floorplan Renderer
when: The .blend is built. Nothing is reported until this passes.
tools: [Bash, Read]
requires: [render-a-floorplan, bake-and-bind-materials, frame-the-shot]
---

Build the scene WITHOUT rendering first — `render_plan.py … --no-render --no-glb` takes seconds — and read its lines. A path trace at 1600 px costs minutes a view; every check here costs seconds and each one has caught something real. Checks 1–5 are numbers the build prints; 6 and 7 find what the numbers cannot, and they are the ones that get skipped.

## 1 — The bake carried everything

```
attachments N   with meshes N   faces F   via hidden rows 0
library: X/X objects resolved
```

`with meshes` must equal `attachments` bar the few objects that legitimately have no geometry (`room`, `opening`, `render-look`). `X/X objects resolved` must be equal — an unresolved object is a path that does not exist and everything downstream of it is missing, not wrong.

### Geometry, as the build reports it

- `geometry N objects` — should be the sum of the rows the bake assigned.
- `faces` **below the baker's count is expected**. The baker counts face RINGS; the build counts polygons that survived. A degenerate ring, and a duplicate face where two solids abut, are both dropped. On the bedroom plan 8084 rings become 6254 polygons, and 1040 of the loss is the fluted panel's flute caps alone.
- `helpers hidden` — if this is 0 the render will have blue view cones in it.

## 2 — Materials

```
materials  56 unique from 27 definitions
materials  33 bound from params.finishes, 126 from params.materialPath, 61 still on flat colour
```

The last number is how many rows are grey. Read the fall-through list by name. **`from 27 definitions` matters as much as `56 unique`**: if definitions is much smaller than unique, most materials are tints of a few procedurals, which is usually right; if it is 1, the embed failed and everything is wearing the same thing.

## 3 — Lamps, by order of magnitude

```
lights    1 sun, 41 spot, 10 point, 14 area   (lm/W 184)
```

Count them against the plan. Every downlight, pendant, fan light kit, cove, mirror halo and the sun should be there. **A zero in a category the plan populates is the failure mode** — for two years the area count was 0 on every plan because the loop only knew four fixture kinds, and nothing said so.

Sanity-check one number by hand: a 650 lm downlight at 184 lm/W is 3.5 W. If the scene is full of 650 W lamps, `--lm-per-w` was not applied and the render will be white.

### Lamp census — every emitter in the plan is a lamp in the scene

Count the plan's emitters by kind and compare with the `lights` line: downlights/spots → `spot`, fan
kits and pendants → `point`, false-ceiling coves, strips, backlit mirrors → `area`. On
cropped_floorplan the first build read `19 spot, 0 point, 0 area` against a plan with a cove and a fan
kit: the cove had no `lumensPerMetre` in its params (flux 0 → skipped) and the fan had been placed on
the same point as another node object, which drops BOTH from the bake (the `attachments N` line was two
short). Fix those in the PLAN (Floorplan Improver checks 9 and 10), re-bake with `--force-bake`, and the
census reads `17 spot, 1 point, 1 area`.

## 4 — Cameras

```
cameras   9
```

One per camera attachment plus the plan view. If it says 1, no camera attachment had a baked anchor and you are looking at the fallback at the origin.

## 5 — The cut

```
cut       235 objects hidden above z=1.35 m
```

Zero means the flag did nothing and the plan view will be a picture of ceilings. A number close to the total object count means the cut is below the furniture.

## 6 — Which side of the wall is the front?

The check nothing else will tell you. A segment-hosted object — a headboard panel, a fluted wall, a TV — is built about its host's plane, and **which way it faces depends on the direction the segment was drawn in**. Two panels on opposite walls of the same room can need opposite settings. Print the depth extents of each part and compare them against the side the room is on:

```bash
node -e "
const d=JSON.parse(require('fs').readFileSync('<baked>.json','utf8'));
for (const h of d.segments) for (const a of h.attachments||[]) {
  const s=(a.objectPath||'').split('/').pop();
  console.log(s, 'anchor', a.baked.anchor.map(v=>v.toFixed(2)).join(','));
  for (const m of a.baked.meshes) {
    let lo=1e9, hi=-1e9;
    for (const r of m.faces) for (const p of r) { lo=Math.min(lo,p[1]); hi=Math.max(hi,p[1]); }
    console.log('   ', m.name, 'y['+lo.toFixed(3)+','+hi.toFixed(3)+']');
  }
}"
```

On the bedroom plan this found the headboard panel mounted backwards: its upholstered pads sat at `y[-0.066,-0.015]`, *inside* the wall. **`flip` on the attachment does not fix it** — the geometry came back byte for byte the same. What fixes it is `params.rotation = 180`, the object's own rotation.

## 7 — Open the images

**A render that came out black, brown, magenta or empty exits 0.** Every one of the five checks above passes on a scene whose cameras all face a wall.

- **The plan view**, `--camera 1 --res 800 --samples 24 --cut 1.35`. Every room should show its floor, its furniture and its fittings. A white rectangle is a ceiling that survived the cut; a black one is a room with no light reaching it.
- **One interior**, `--camera 2 --res 720 --samples 24`. This is where an unaimed camera shows up as a flat brown wall filling the frame. It is also the only place the lighting balance can be judged.

Magenta is a missing texture. Flat grey on everything is the embed having failed. A brown or cream field with a faint vertical edge is a camera 300 mm from a wall.

## 8 — The GLB, if you made one

```bash
node -e "
const b=require('fs').readFileSync('<file>.glb');
const j=JSON.parse(b.slice(20, 20+b.readUInt32LE(12)).toString('utf8'));
console.log('meshes',j.meshes.length,'materials',j.materials.length,'cameras',(j.cameras||[]).length,'images',(j.images||[]).length);
console.log(JSON.stringify(j.materials[0]));"
```

A material printed **without** a `baseColorFactor` and **without** a `baseColorTexture` is the white-model failure: the flatten pass did not run, or ran before the materials were built. `images` at 0 with every material carrying a factor is the flat export — correct for `--glb-flat`, wrong otherwise.

## 9 — Read the plan warnings as plan defects

`enrich_plan.mjs` prints every attachment whose `metrics.scale` is under 0.5. That is not a render problem: `fitMode: "Exact"` scales the whole object including its section, so the object is at the wrong height and the wrong thickness in the plan itself. Fix the plan and re-bake. A render that quietly draws 16 skirtings at 14 mm tall is worse than one that fails.

## What to report

- the three counts — geometry, materials, lamps — and the camera list;
- the material fall-through count **by name**, not just the number;
- every plan defect the render found, separately from anything the renderer did;
- where the `.blend` is, and the exact command to render it at full quality.

Never report a render as finished on the strength of exit codes.
