---
id: verify-the-scene
name: Verify the scene before rendering it
category: Json to Blender Render Ready
when: Between `bake_plan.mjs` and the full render — and every time a render looks wrong in a way the materials cannot explain.
requires: [json-to-blender-render-ready]
---

A path trace at 1600 px costs about thirteen minutes a view on four cores. Every check here costs seconds
and each one has caught something real.

## 1. The bake's own counts

    library: 24/24 objects resolved
    attachments 50   with meshes 50   faces 8084

Unequal numbers on the middle line mean an attachment baked empty — usually an object whose render rows are
all switched off at the parameters this instance uses.

## 2. The build, without rendering

```bash
blender -b --python render_plan.py -- <baked>.json --out <dir> --no-render --no-glb
```

Four lines to read, and all four are load-bearing:

- `geometry N objects` — should be the sum of the rows the bake assigned, minus none.
- `faces` **below the baker's count is expected**. The baker counts face RINGS; this counts polygons that
  survived. A degenerate ring, and a duplicate face where two solids abut, are both dropped. On the bedroom
  plan 8084 rings become 6254 polygons, and 1040 of the loss is the fluted panel's flute caps alone.
- `lights` — a zero here is why a render came out black. Fixtures without a `lumens` parameter are the usual
  cause; the ceiling fan is one, and it takes `--fan-lumens`.
- `helpers hidden` — if this is 0 the render will have blue view cones in it.

## 3. Which side of the wall is the front?

The check that matters most, and the one nothing else will tell you. A segment-hosted object — a headboard
panel, a fluted wall, a TV — is built about its host's plane, and **which way it faces depends on the
direction the segment was drawn in**. Two panels on opposite walls of the same room can need opposite
settings.

Print the depth extents of each part and compare them against the side the room is on:

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

On the bedroom plan this found the headboard panel mounted backwards: its upholstered pads sat at
`y[-0.066,-0.015]`, *inside* the wall, and the halo LED that should hide behind it faced the room. The
fluted panel on the opposite wall, drawn the other way round, was correct.

**`flip` on the attachment does not fix it** — it was already tried, and the geometry came back byte for
byte the same. What fixes it is `params.rotation = 180`, the object's own rotation, which turns it about the
anchor and leaves the x extents alone.

## 4. One view, small

```bash
blender -b --python render_plan.py -- <baked>.json --out <dir> --camera 1 --res 640 --samples 24
```

About forty-five seconds. Settle exposure and light balance here. Then look at the picture — a render that
came out black, magenta or empty still exits 0, and the log still says `done`.

## 5. The GLB, if you made one

```bash
node -e "
const b=require('fs').readFileSync('<file>.glb');
const j=JSON.parse(b.slice(20, 20+b.readUInt32LE(12)).toString('utf8'));
console.log('meshes',j.meshes.length,'materials',j.materials.length,'cameras',(j.cameras||[]).length,
            'images',(j.images||[]).length);
console.log(JSON.stringify(j.materials[0]));
"
```

A material printed **without** a `baseColorFactor` and **without** a `baseColorTexture` is the white-model
failure: the flatten pass did not run, or ran before the materials were built. `images` at 0 with every
material carrying a factor is the flat export, which is correct for `--glb-flat` and wrong otherwise.
