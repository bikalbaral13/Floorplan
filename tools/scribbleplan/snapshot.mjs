/** Render the live canvas to a PNG on disk. Run: node tools/scribbleplan/snapshot.mjs [out.png]
 *
 *  `snapshot_canvas` hands back a data URL; keeping the decode on this side means the image never
 *  crosses the agent's context as base64 — it lands as a file that can be looked at directly.
 */
import fs from "node:fs";
import { call } from "./push.mjs";

const out = process.argv[2] ?? "tools/scribbleplan/shell.png";
const raw = await call("snapshot_canvas", {});
const shot = typeof raw === "string" ? JSON.parse(raw) : raw;
if (!shot?.dataUrl) {
  console.error(`no image: ${JSON.stringify(shot)}`);
  process.exit(1);
}
fs.writeFileSync(out, Buffer.from(shot.dataUrl.split(",")[1], "base64"));
console.log(`${out}  ${shot.widthM?.toFixed(2)} × ${shot.heightM?.toFixed(2)} m  (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
