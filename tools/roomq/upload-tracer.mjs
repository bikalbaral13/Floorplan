/** Upload the Floorplan Tracer scope files to R2, reading each back to prove what landed. */
import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const BASE = "library/Skills/Floorplan Tracer/";
const SRC = "skills-floorplan-tracer/";
const FILES = [
  ["scope-the-trace.md", "text/markdown; charset=utf-8"],
  ["drive-the-canvas-over-the-bridge.md", "text/markdown; charset=utf-8"],
  ["trace-scope.questions.json", "application/json; charset=utf-8"],
  ["trace-scope-form.html", "text/html; charset=utf-8"],
];
let bad = 0;
for (const [rel, type] of FILES) {
  const body = readFileSync(SRC + rel, "utf8");
  if (rel.endsWith(".json")) JSON.parse(body);
  try {
    await putObject(cfg, BASE + rel, body, type);
    const back = await getObjectText(cfg, BASE + rel);
    if (back.text !== body) { bad++; console.log(`MISMATCH ${rel}`); }
    else console.log(`ok  ${rel.padEnd(28)} ${String(body.length).padStart(6)} B  verified`);
  } catch (e) { bad++; console.log(`FAIL ${rel}: ${e.message}`); }
}
console.log(`\n${FILES.length} uploaded, ${bad} failed`);
