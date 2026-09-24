// 2026-09-24 (user rule): when nothing is said about floors, bedrooms get oak veneer, kitchens marble, toilets terrazzo.
import fs from "node:fs";
const D = "D:/MAIN/monica_recent/tools/tmp-improve/skill/";
const edit = (f, fn) => { const p = D + f; const s = fs.readFileSync(p, "utf8"); const t = fn(s); if (t === s) throw new Error("no change in " + f); fs.writeFileSync(p, t); console.log("patched", f); };
const before = (s, marker, text) => { const i = s.indexOf(marker); if (i < 0) throw new Error("marker " + marker); return s.slice(0, i) + text + s.slice(i); };

edit("improve.mjs", (s) => s + `
/* ── room floor materials when nothing is said (user rule, 2026-09-24) ─────────────────────── */

/** The floor each room type gets when the user has NOT stated a floor finish. "Not stated" includes
 *  taking the scope form's defaults wholesale: only an explicit floor answer, the prompt, a mood-board
 *  image or a finishes schedule overrides this table. Room types not listed keep the tile-spec table in
 *  lay-out-tiles-and-floor-finishes. Every path here exists in R2 library/Materials/Finishes/. */
export const ROOM_FLOOR_DEFAULTS = {
  bedroom: { pattern: "Brick", cellSize: 0.2, cellLength: 1.2, joint: 0.001, materialPath: "Finishes/oak-veneer.json",
    material: "light oak veneer plank, 200 × 1200 mm, running bond, matt lacquer",
    semantics: "warm light-oak plank floor, calm bedroom" },
  kitchen: { pattern: "Square", cellSize: 0.6, cellLength: 0, joint: 0.002, materialPath: "Finishes/marble.json",
    material: "600 × 600 honed marble-look floor, warm white veining, 2 mm grout",
    semantics: "honed marble kitchen floor, easy to clean" },
  bathroom: { pattern: "Square", cellSize: 0.6, cellLength: 0, joint: 0.002, materialPath: "Finishes/terrazzo.json",
    material: "600 × 600 honed terrazzo, anti-skid finish, 2 mm epoxy grout",
    semantics: "terrazzo wet-room floor, speckled, anti-skid" },
};

/** The floor spec for one room. \`stated\` is the user's explicit floor choice for that room (from the
 *  answered form question, the prompt, an image or a schedule) or null when nothing was said. Returns
 *  { spec, source } so the report can say which rule chose the floor. */
export function floorSpecFor(type, stated = null, fallback = null) {
  if (stated) return { spec: stated, source: "stated" };
  if (ROOM_FLOOR_DEFAULTS[type]) return { spec: { ...ROOM_FLOOR_DEFAULTS[type] }, source: "room default (nothing said)" };
  return { spec: fallback, source: "tile table" };
}
`);

edit("lay-out-tiles-and-floor-finishes.md", (s) => before(s, "## The tile spec, by room", `## When nothing is said about the floor — the room defaults (user rule, 2026-09-24)

If the user has **not stated** a floor finish, every room of these types gets this material — before the
tile table below is consulted:

| Room type | \`materialPath\` | Laid as |
|---|---|---|
| Bedroom (incl. master, guest, kids) | \`Finishes/oak-veneer.json\` | plank: \`Brick\`, 0.2 × 1.2, joint 0.001 |
| Kitchen | \`Finishes/marble.json\` | \`Square\` 0.6, joint 0.002 |
| Toilet / bathroom / WC / powder | \`Finishes/terrazzo.json\` | \`Square\` 0.6, joint 0.002, anti-skid honed |

**"Not stated" includes "use the form's defaults".** The scope form's \`floor_finish\` default
(\`vitrified\`) is the form's convenience, not the user's choice; the user's rule wins over it. Only these
override the room defaults: an explicit answer to the floor questions, the prompt text, a mood-board
image the user gave, or a finishes schedule. Other room types (living, dining, corridor, balcony, utility…)
still follow the table below.

In code: \`I.floorSpecFor(room.type, statedSpecOrNull, tableSpec)\` returns \`{ spec, source }\`; pass
\`spec\` to \`tileField\` and put \`source\` in the report line for that room ("room default (nothing said)").
\`ROOM_FLOOR_DEFAULTS\` in \`improve.mjs\` is the single place these three live. Classification decides the
type, so a room the classifier calls \`unknown\` (e.g. "W.I.W") is not covered — say so in the report.

`));

edit("read-the-plan-and-brief.md", (s) => s + `
## Recording whether the floor was actually SAID

For each room keep \`floorStated\`: the explicit floor spec if the user gave one (form question answered by
them, prompt, image, schedule), otherwise \`null\`. Accepting the whole form with its defaults leaves it
\`null\`. \`lay-out-tiles-and-floor-finishes\` uses it to apply the room defaults (bedroom → oak veneer,
kitchen → marble, toilet → terrazzo) only when nothing was said.
`);
