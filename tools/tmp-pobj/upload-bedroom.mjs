/** Upload the bedroom pack to R2 `library/Objects/Architectural/`, then READ EACH ONE BACK and
 *  compare byte-for-byte — a PUT that returns 200 is not proof the object is what we wrote. */
import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";

const NEW = ["false-ceiling", "led-strip", "downlight", "upholstered-panel", "fluted-panel",
             "window-seat", "skirting", "wall-art", "curtain-track", "beam"];
const PATCHED = ["nightstand", "tv-unit", "tv", "wardrobe", "curtain", "tessellation", "light-bulb",
                 "ceiling-fan", "chandelier", "mirror", "window", "bed", "plant", "planter-box", "rug", "wall"];

const only = process.argv[2];
const files = only === "new" ? NEW : only === "patched" ? PATCHED : [...NEW, ...PATCHED];
let bad = 0;

for (const f of files) {
  const body = readFileSync(`out-bedroom/${f}.json`, "utf8");
  const key = `library/Objects/Architectural/${f}.json`;
  const tag = NEW.includes(f) ? "new    " : "replace";
  try {
    await putObject(cfg, key, body, "application/json");
    const back = await getObjectText(cfg, key);
    const same = back.text === body;
    const j = JSON.parse(back.text);
    const np = j.nodes.find((n) => n.data?.tool === "input-props").data.params.props.length;
    if (!same) { bad++; console.log(`MISMATCH ${f} — wrote ${body.length} B, read back ${back.text.length} B`); }
    else console.log(`ok  ${tag}  ${f.padEnd(19)} ${String(body.length).padStart(6)} B  ${String(np).padStart(2)} params  verified`);
  } catch (e) { bad++; console.log(`FAIL ${f}: ${e.message}`); }
}
console.log(`\n${files.length} uploaded, ${bad} failed`);
