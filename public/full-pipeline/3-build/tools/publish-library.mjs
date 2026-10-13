// Upload the objects and materials a project's resolve.json declares as NEW to the shared R2 library.
//   node tools/publish-library.mjs <project_dir>     (needs R2_* in .env here or in a parent folder, or in the environment)
// Objects come from objects/out/<name>.json, materials from materials/<name>.json; keys = library/<path>.
import fs from "node:fs";
import path from "node:path";
import * as r2 from "../lib/r2.mjs";

const projectDir = process.argv[2];
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const env = r2.loadEnv();
const cfg = r2.r2ConfigFrom(env);
const res = JSON.parse(fs.readFileSync(path.join(projectDir, "resolve.json"), "utf8"));
for (const p of res.new.objects) {
  const src = path.join(root, "objects", "out", path.basename(p));
  await r2.putObject(cfg, `library/${p}`, fs.readFileSync(src, "utf8"));
  console.log(`object   library/${p}`);
}
for (const p of res.new.materials) {
  const src = path.join(root, "materials", path.basename(p));
  await r2.putObject(cfg, `library/Materials/${p}`, fs.readFileSync(src, "utf8"));
  console.log(`material library/Materials/${p}`);
}
