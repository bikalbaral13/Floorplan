import { putObject } from "../r2.mjs";
import { cfg, PUBLIC } from "./r2cfg.mjs";
import { readFileSync, readdirSync } from "node:fs";
const dir = process.argv[2], T = { md: "text/markdown; charset=utf-8", py: "text/x-python", mjs: "text/javascript", html: "text/html; charset=utf-8" };
let bad = 0, n = 0;
for (const f of readdirSync(dir)) {
  const key = process.argv[3] + f, buf = readFileSync(dir + "/" + f);
  await putObject(cfg, key, buf, T[f.split(".").pop()]); n++;
  const back = Buffer.from(await (await fetch(PUBLIC + "/" + key.split("/").map(encodeURIComponent).join("/"))).arrayBuffer());
  if (!back.equals(buf)) { bad++; console.log("MISMATCH", key); }
}
console.log(n + " uploaded, " + bad + " mismatches");
