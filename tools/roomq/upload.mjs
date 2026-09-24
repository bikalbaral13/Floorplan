/** Upload the Room Renderer skill to R2, then read each file back and compare byte-for-byte. */
import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
const BASE = "library/Skills/Room Renderer/";
const SRC = "skills-room-renderer/";
const FILES = [
  ["render-a-room.md", "text/markdown; charset=utf-8"],
  ["questionnaire.schema.md", "text/markdown; charset=utf-8"],
  ["plan.template.md", "text/markdown; charset=utf-8"],
  ["rooms/bedroom.questions.json", "application/json; charset=utf-8"],
  ["form.html", "text/html; charset=utf-8"],
  ["bedroom_trace_prefill.json", "application/json; charset=utf-8"],
];
let bad = 0;
for (const [rel, type] of FILES) {
  const body = readFileSync(SRC + rel, "utf8");
  if (rel.endsWith(".json")) JSON.parse(body);
  const key = BASE + rel;
  try {
    await putObject(cfg, key, body, type);
    const back = await getObjectText(cfg, key);
    if (back.text !== body) { bad++; console.log(`MISMATCH ${rel} — wrote ${body.length} B, read ${back.text.length} B`); }
    else console.log(`ok  ${rel.padEnd(30)} ${String(body.length).padStart(6)} B  verified`);
  } catch (e) { bad++; console.log(`FAIL ${rel}: ${e.message}`); }
}
console.log(`\n${FILES.length} uploaded, ${bad} failed`);
