/** Upload an image to R2 and prove what landed by hashing the bytes fetched back from the public URL. */
import { putObject } from "../r2.mjs";
import { cfg, PUBLIC } from "../tmp-r2/ls.mjs";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const [src, key, type = "image/png"] = process.argv.slice(2);
const buf = readFileSync(src);
const sha = b => createHash("sha256").update(b).digest("hex").slice(0, 16);
await putObject(cfg, key, buf, type);
const url = `${PUBLIC}/${key.split("/").map(encodeURIComponent).join("/")}`;
const res = await fetch(url);
const back = Buffer.from(await res.arrayBuffer());
console.log(`local   ${buf.length} B   sha ${sha(buf)}`);
console.log(`remote  ${back.length} B   sha ${sha(back)}   http ${res.status}   ${res.headers.get("content-type")}`);
console.log(buf.length === back.length && sha(buf) === sha(back) ? "VERIFIED — identical bytes" : "MISMATCH");
console.log(url);
