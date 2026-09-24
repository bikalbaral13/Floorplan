import { putObject, getObjectText } from "../r2.mjs";
import { cfg } from "../tmp-r2/ls.mjs";
import { readFileSync, readdirSync } from "node:fs";
const D = "tools/tmp-poc/skill/";
const ct = (f) => f.endsWith(".md") ? "text/markdown; charset=utf-8" : f.endsWith(".mjs") ? "text/javascript; charset=utf-8" : "text/x-python; charset=utf-8";
for (const f of readdirSync(D)) {
  const key = `library/Skills/Parametric Object Creator/${f}`;
  const body = readFileSync(D + f, "utf8");
  await putObject(cfg, key, body, ct(f));
  const back = (await getObjectText(cfg, key, 5_000_000)).text;
  console.log(back.length === body.length ? "ok " : "!! size mismatch ", key, body.length);
}
