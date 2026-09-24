/** STEP 1 — the rename pass.
 *
 *  Three objects called the same thing three different names. `light` measured its cone with
 *  `coneAngle` while `downlight` called it `beamAngle`; `light`/`led-strip` mounted at `mountHeight`
 *  while `downlight`/`pendant`/`chandelier` mounted at `ceilingHeight`; `light` aimed with `aimTilt`
 *  and `downlight` with `tilt`. Nothing downstream can key off a name that means a different thing
 *  in the next file, so this runs before anything is added.
 *
 *  A rename touches three places — the prop id, both halves of its edge, and every occurrence in the
 *  Math Engine body — and must change NOTHING else, so the check is that every metric comes back
 *  bit-identical afterwards.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { validateFlow, propsOf, exprOf, nodeOf } from "./validate-flow.mjs";

export const RENAMES = {
  "light":      { coneAngle: "beamAngle" },
  "downlight":  { ceilingHeight: "mountHeight", tilt: "aimTilt" },
  "pendant":    { ceilingHeight: "mountHeight" },
  "chandelier": { ceilingHeight: "mountHeight" },
  "led-strip":  { intensity: "lumensPerMetre" },
};

/** Rename one free variable everywhere it can appear. Word-boundary only: `tilt` must not eat
 *  `aimTilt`, and `_tiltR` is a local the body owns. */
export function renameProp(flow, from, to) {
  const props = propsOf(flow);
  if (!props.some((p) => p.id === from)) throw new Error(`no prop "${from}"`);
  if (props.some((p) => p.id === to)) throw new Error(`"${to}" already exists`);
  const body = exprOf(flow);
  const re = new RegExp(`(?<![A-Za-z0-9_])${from}(?![A-Za-z0-9_])`, "g");
  if (new RegExp(`(?<![A-Za-z0-9_])${to}(?![A-Za-z0-9_])`).test(body)) throw new Error(`body already uses "${to}"`);

  for (const p of props) if (p.id === from) p.id = to;
  nodeOf(flow, "expr").data.params.expr = body.replace(re, to);
  for (const e of flow.edges) {
    if (e.sourceHandle === `val-${from}`) e.sourceHandle = `val-${to}`;
    if (e.targetHandle === `valin-${from}`) e.targetHandle = `valin-${to}`;
    if (e.id.endsWith(`_${from}`)) e.id = e.id.slice(0, -from.length) + to;
  }
  return flow;
}

if (String(process.argv[1]).endsWith("rename.mjs")) {
  mkdirSync("tools/tmp-light/out-renamed", { recursive: true });
  let bad = 0;
  for (const [name, map] of Object.entries(RENAMES)) {
    const src = readFileSync(`tools/tmp-light/live/${name}.json`, "utf8");
    const before = validateFlow(JSON.parse(src));
    const flow = JSON.parse(src);
    for (const [from, to] of Object.entries(map)) renameProp(flow, from, to);
    const after = validateFlow(flow);

    const problems = after.problems.filter((p) => !before.problems.includes(p));
    const keys = [...new Set([...Object.keys(before.metrics), ...Object.keys(after.metrics)])];
    const drift = keys.filter((k) => !Object.is(before.metrics[k], after.metrics[k]));
    if (drift.length) problems.push(`metrics moved: ${drift.map((k) => `${k} ${before.metrics[k]} -> ${after.metrics[k]}`).join(", ")}`);

    writeFileSync(`tools/tmp-light/out-renamed/${name}.json`, JSON.stringify(flow, null, 2) + "\n", "utf8");
    if (problems.length) { bad++; console.log(`FAIL ${name}`); problems.forEach((p) => console.log("      - " + p)); }
    else console.log(`ok   ${name.padEnd(12)} ${Object.entries(map).map(([a, b]) => `${a} -> ${b}`).join(", ").padEnd(46)} ${keys.length} metrics unchanged`);
  }
  console.log(`\n${bad} with problems`);
  process.exit(bad ? 1 : 0);
}
