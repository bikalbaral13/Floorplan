// 2026-09-24 lessons from cropped_floorplan: brighter defaults, explicit emitter output, the coincident-node trap.
import fs from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-improve/skill/";
const edit = (f, fn) => { const p = D + f; const s = fs.readFileSync(p, "utf8"); const t = fn(s); if (t === s) throw new Error("no change in " + f); fs.writeFileSync(p, t); console.log("patched", f); };
const before = (s, marker, text) => { const i = s.indexOf(marker); if (i < 0) throw new Error("marker " + marker); return s.slice(0, i) + text + s.slice(i); };

// ── improve.mjs: brighter default fixture + a coincident-node check the verify step calls ──
edit("improve.mjs", (s) => s
  .replace("export function lumenMethod(area, { targetLux, fixtureLumens = 650, uf = 0.5, mf = 0.8 }) {",
    "export function lumenMethod(area, { targetLux, fixtureLumens = 900, uf = 0.5, mf = 0.8 }) {")
  + `
/** Check 9 — no two node objects on the same point. The editor keys node objects by position with no
 *  tolerance: two markers on one coordinate share a node, nodeMeta is written twice, and BOTH attachments
 *  silently vanish from the bake (2026-09-24: a ceiling fan and the render-look marker, both placed at the
 *  room centre, never reached the render — the room lost its fan and its main light kit, with no error).
 *  Returns the colliding groups; anything under \`minM\` apart (default 5 cm) counts. */
export function coincidentNodes(plan, minM = 0.05) {
  const ppm = ppmOf(plan), out = [];
  const objs = plan.nodes.filter((n) => (n.attachments ?? []).length);
  for (let i = 0; i < objs.length; i++)
    for (let j = i + 1; j < objs.length; j++)
      if (Math.hypot(objs[i].x - objs[j].x, objs[i].y - objs[j].y) / ppm < minM)
        out.push([objs[i], objs[j]].map((n) => \`\${n.id}:\${n.attachments.map((a) => a.objectId).join("+")}\`));
  return out;
}

/** Check 10 — every emitter states its output EXPLICITLY. An attachment stores only the params the
 *  builder wrote; the render pipeline reads those, never the object's defaults. A false-ceiling written
 *  without \`lumensPerMetre\` baked fine and rendered with ZERO cove light (flux = 0 → lamp skipped). */
export function emitterFaults(plan) {
  const need = { "downlight-with-math": ["lumens"], "light-with-math": ["lumens"], "pendant-with-math": ["lumens"],
    "ceiling-fan-with-math": ["lumens"], "false-ceiling-with-math": ["lumensPerMetre"], "cove-light-with-math": ["lumensPerMetre"],
    "led-strip-with-math": ["lumensPerMetre"], "mirror-with-math": ["lumensPerMetre"] };
  const out = [];
  for (const h of [...plan.nodes, ...plan.segments, ...plan.spaces])
    for (const a of h.attachments ?? [])
      for (const k of need[a.objectId] ?? [])
        if (!(Number(a.params?.[k]) > 0)) out.push(\`\${h.id}:\${a.objectId} missing \${k}\`);
  return out;
}
`);

// ── light-the-rooms.md: brightness defaults that render as a lit room ──
edit("light-the-rooms.md", (s) => before(s, "## The completion gate", `## Brightness that survives the render (measured 2026-09-24)

A plan lit to the letter of the lumen method at 100 lux with 650 lm downlights rendered **dark and orange** —
correct photometry, but under AgX a 3000 K room at that level reads as dusk. Rendered bright and clean at:

| Emitter | Write explicitly | Default |
|---|---|---|
| downlight | \`lumens\` | **900 lm** (not 650); \`fixtureLumens: 900\` in \`lumenMethod\` |
| bedroom target | \`targetLux\` | **150 lux** (living 200, kitchen/bath 250–300, wardrobe 200) |
| false-ceiling cove | \`lumensPerMetre\`, \`emitsLight: true\`, \`dimLevel: 100\` | **1400 lm/m** |
| ceiling-fan light kit | \`lumens\` | **2200 lm** |
| backlit mirror | \`lumensPerMetre\` | 700 lm/m |

**Write the output of every emitter into its params, even when it equals the object's default.** An
attachment stores only what the builder wrote, and the render pipeline reads those params — not the
object file. A cove written without \`lumensPerMetre\` bakes fine and emits nothing. \`emitterFaults(plan)\`
in \`improve.mjs\` lists every emitter missing its output; it must return \`[]\`.

`));

// ── emit-improved-canvas-json.md: the coincident-node trap ──
edit("emit-improved-canvas-json.md", (s) => before(s, "## Two gotchas that have cost real runs", `## Never put two node objects on one point

The room centre is where a ceiling fan goes — and also where it is tempting to drop the \`render-look\`
marker, a sun or a camera. **Two node objects closer than a few centimetres share one node and BOTH
disappear from the bake**, with no error and no warning (the attachment count drops by exactly two). On
cropped_floorplan the fan and the render-look went this way, and the render lost its fan and its main
light kit. Offset every marker-only object (\`render-look\`, \`light\` type Directional, \`exterior-context\`)
at least 0.5 m from any fixture, and run \`coincidentNodes(plan)\` before writing — it must return \`[]\`.

`));

// ── verify-the-improvement.md: checks 9 and 10 ──
edit("verify-the-improvement.md", (s) => before(s, "## The report", `## 9 — No two node objects share a point

\`I.coincidentNodes(plan)\` must be \`[]\`. Two markers on one coordinate lose BOTH attachments in the bake
(see \`emit-improved-canvas-json\`). The symptom downstream is the renderer's attachment count coming back
lower than the plan's by an even number.

## 10 — Every emitter states its output

\`I.emitterFaults(plan)\` must be \`[]\` — every downlight, pendant, fan kit and light has \`lumens\`, every
cove, strip and backlit mirror has \`lumensPerMetre\`. A missing value renders as a light that is simply not
there. Report the per-room lux (lumen method) AND the emitter list; a room whose light list has no cove
lamp while the plan has a cove is this fault.

`));
