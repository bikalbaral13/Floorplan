/** Upload moodboard images + JSON to R2 and verify each by byte-compare from the public URL. */
import { putObject } from "../r2.mjs";
import { cfg, PUBLIC } from "./r2cfg.mjs";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
const [imgDir, jsonFile] = process.argv.slice(2);
const IMG = "library/Images/Moodboards/Ramanadhapuram";
const jobs = readdirSync(imgDir).filter(f => f.endsWith(".jpg")).map(f => [path.join(imgDir, f), `${IMG}/${f}`, "image/jpeg"]);
jobs.push([null, "library/Moodboards/.keep", "text/plain"]);
jobs.push([jsonFile, "library/Moodboards/ramanadhapuram-apartment-interior.json", "application/json"]);
let bad = 0;
for (const [src, key, type] of jobs) {
  const buf = src ? readFileSync(src) : Buffer.from("folder marker\n");
  await putObject(cfg, key, buf, type);
  const back = Buffer.from(await (await fetch(`${PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`)).arrayBuffer());
  if (!back.equals(buf)) { bad++; console.log("MISMATCH", key); }
}
console.log(`${jobs.length} uploaded, ${bad} mismatches`);
