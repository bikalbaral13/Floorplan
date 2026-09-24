/** Push a built folder into the cloud Library through the dev server on 2500.
 *
 *    node tools/tmp-render/upload.mjs materials   -> Materials/<Category>/<file>.json (existing + new)
 *    node tools/tmp-render/upload.mjs objects     -> Objects/Architectural/<file>.json
 *    node tools/tmp-render/upload.mjs skill       -> Skills/Json to Blender Render Ready/<file>
 *    node tools/tmp-render/upload.mjs designs     -> Designs/<file>.json
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";

const WHAT = process.argv[2] ?? "";
const R = "tools/tmp-render/out";

const JOBS = {
  materials: [
    { dir: `${R}/Materials`, to: (f) => `Materials/${f.replace("__", "/")}` },
    { dir: `${R}/Materials/new`, to: (f) => `Materials/${f.replace("__", "/")}` },
  ],
  objects: [{ dir: `${R}/Objects`, to: (f) => `Objects/Architectural/${f}` }],
  skill: [{ dir: `${R}/Skill`, to: (f) => `Skills/Json to Blender Render Ready/${f.replace(/__/g, "/")}` }],
  designs: [{ dir: `${R}/Designs`, to: (f) => `Designs/${f}` }],
};

const jobs = JOBS[WHAT];
if (!jobs) { console.log(`usage: upload.mjs ${Object.keys(JOBS).join("|")}`); process.exit(1); }

let n = 0, bad = 0;
for (const job of jobs) {
  if (!existsSync(job.dir)) continue;
  for (const f of readdirSync(job.dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name).sort()) {
    if (f === "_index.json") continue;
    const content = readFileSync(`${job.dir}/${f}`, "utf8");
    const path = job.to(f);
    const res = await fetch("http://localhost:2500/__r2/save", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, content }),
    }).catch((e) => ({ json: async () => ({ error: e.message }) }));
    const body = await res.json().catch(() => null);
    n++;
    if (!body?.ok) bad++;
    console.log(`${body?.ok ? "ok  " : "FAIL"} ${path.padEnd(52)} ${((content.length / 1024).toFixed(1) + " KB").padStart(9)}  ${body?.error ?? ""}`);
  }
}
console.log(`\n${n} files, ${bad} failed`);
process.exit(bad ? 1 : 0);
