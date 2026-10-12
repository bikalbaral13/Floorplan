// Publish the viewer to R2: library/Viewer/v1/index.html (public via r2.dev).
//   node tools/viewer/publish.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { putObject } from "../r2.mjs";
import { refreshDesignsIndex } from "./designs-index.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(fs.readFileSync(path.join(here, "../../.env"), "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const cfg = { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };

const key = "library/Viewer/v1/index.html";
await putObject(cfg, key, fs.readFileSync(path.join(here, "index.html")), "text/html; charset=utf-8");
// The engine is not part of the viewer: it is published separately to library/Engine/ (tools/engine/publish.mjs).
const designs = await refreshDesignsIndex(cfg);
console.log(`designs.json: ${designs.length} designs, ${designs.filter((d) => d.baked).length} baked`);
console.log(`${env.R2_PUBLIC_URL.replace(/\/+$/, "")}/${key}`);
