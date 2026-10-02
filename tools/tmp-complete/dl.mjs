import { getObjectText, listObjectsDetailed } from "../r2.mjs";
import { cfg } from "./r2cfg.mjs";
import fs from "node:fs";
const [,, cmd, arg, out] = process.argv;
if (cmd==="ls") for (const o of await listObjectsDetailed(cfg, arg)) console.log(o.size, o.key);
if (cmd==="get") { const { text } = await getObjectText(cfg, arg, 50_000_000); fs.writeFileSync(out, text); console.log(text.length); }
