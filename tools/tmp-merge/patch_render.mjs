// 2026-09-24 lessons from rendering cropped_floorplan_after_improvement: force-bake, lamp census, brightness.
import fs from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-merge/merged/";
const edit = (f, fn) => { const p = D + f; const s = fs.readFileSync(p, "utf8"); const t = fn(s); if (t === s) throw new Error("no change in " + f); fs.writeFileSync(p, t); console.log("patched", f); };
const before = (s, marker, text) => { const i = s.indexOf(marker); if (i < 0) throw new Error("marker " + marker + " in file"); return s.slice(0, i) + text + s.slice(i); };

edit("render-a-floorplan.md", (s) => before(s, "## Order of work", `## An improved plan needs \`--force-bake\`

A plan that went Tracer → Improver carries \`baked\` blocks from the trace on its walls and furniture, and
NONE on what the Improver added. \`bake_plan.mjs\` sees "already baked" and passes the whole plan through —
so every tile field, false ceiling, light and trim is silently missing from the render (and \`--ceiling\`
then crashes on \`fc.baked.anchor\`). **Always run \`bake_plan.mjs … --force-bake\` on an improved plan.**

`));

edit("light-and-expose.md", (s) => before(s, "## Tone mapping", `## The brightness recipe that works (measured on cropped_floorplan, 2026-09-24)

Three passes on the same bedroom, 720 px / 24 samples:

| Pass | Plan | Render flags | Result |
|---|---|---|---|
| 1 | 650 lm downlights, 100 lux, cove & fan lamps MISSING | \`--lm-per-w 80 --exposure 0.35\` | dark, sodium-orange |
| 2 | + cove 900 lm/m and fan kit actually present | same | lit, still dim and amber |
| 3 | 900 lm downlights (≈180 lux), cove 1400 lm/m, fan 2200 lm | \`--lm-per-w 60 --exposure 0.6\` | bright, clean walls and bedding |

So, in order: **first make sure every emitter in the plan is a lamp** (read the \`lights\` line against the
plan — see \`verify-the-render\` check 3), **then** raise the fixtures' own lumens in the plan (the
Improver's defaults now are 900 lm / 1400 lm/m / 2200 lm), **then** \`--lm-per-w 60\` and \`--exposure 0.6\`
for an interior still. The plan view wants less (\`--exposure 0.3\`), because it looks at the lit floor.
A dark render with a lamp category at 0 is a missing light, not a weak one — no exposure fixes that.

`));

edit("verify-the-render.md", (s) => before(s, "## 4 — Cameras", `### Lamp census — every emitter in the plan is a lamp in the scene

Count the plan's emitters by kind and compare with the \`lights\` line: downlights/spots → \`spot\`, fan
kits and pendants → \`point\`, false-ceiling coves, strips, backlit mirrors → \`area\`. On
cropped_floorplan the first build read \`19 spot, 0 point, 0 area\` against a plan with a cove and a fan
kit: the cove had no \`lumensPerMetre\` in its params (flux 0 → skipped) and the fan had been placed on
the same point as another node object, which drops BOTH from the bake (the \`attachments N\` line was two
short). Fix those in the PLAN (Floorplan Improver checks 9 and 10), re-bake with \`--force-bake\`, and the
census reads \`17 spot, 1 point, 1 area\`.

`));
