/** Push a folder of built files into the cloud Library through the dev server.
 *
 *  Writes go through `/__r2/save` because the R2 keys grant write and delete on the whole bucket and
 *  must never enter a browser bundle — so the dev server on 2500 has to be up.
 *
 *    node tools/tmp-light/upload.mjs lamps      -> Photometry/<Category>/<id>.json
 *    node tools/tmp-light/upload.mjs objects    -> Objects/Architectural/<name>.json
 */
import { readFileSync, readdirSync } from "node:fs";

const what = process.argv[2] ?? "objects";
const dir = what === "lamps" ? "tools/tmp-light/lamps" : "tools/tmp-light/out";
const only = process.argv.slice(3);

const dest = (file) => {
  if (what !== "lamps") return `Objects/Architectural/${file}`;
  const [category, id] = file.replace(/\.json$/, "").split("__");
  return `Photometry/${category}/${id}.json`;
};

const files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "_index.json")
                              .filter((f) => !only.length || only.includes(f.replace(/\.json$/, "")))
                              .sort();
let bad = 0;
for (const f of files) {
  const content = readFileSync(`${dir}/${f}`, "utf8");
  const path = dest(f);
  const res = await fetch("http://localhost:2500/__r2/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  }).catch((e) => ({ ok: false, json: async () => ({ error: e.message }) }));
  const body = await res.json().catch(() => null);
  if (!body?.ok) bad++;
  console.log(`${body?.ok ? "ok  " : "FAIL"} ${path.padEnd(46)} ${((content.length / 1024).toFixed(1) + " KB").padStart(9)}  ${body?.error ?? ""}`);
}
console.log(`\n${files.length} files, ${bad} failed`);
process.exit(bad ? 1 : 0);
