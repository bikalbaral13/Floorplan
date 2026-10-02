import fs from "node:fs";
import { putObject } from "../r2.mjs";
import { cfg } from "./r2cfg.mjs";
const f = "ramanadhapuram_villa1_complete.json", d = JSON.parse(fs.readFileSync(f, "utf8"));
let n = 0;
for (const L of d.levels) for (const k of ["nodes", "segments", "spaces"]) for (const e of L[k] ?? []) for (const a of e.attachments ?? []) { a.params = { ...(a.params ?? {}), renderMode: "Nothing" }; n++; }
fs.writeFileSync(f, JSON.stringify(d));
await putObject(cfg, "library/Designs/ramanadhapuram_villa1_complete.json", JSON.stringify(d));
console.log("attachments set to Nothing:", n);
