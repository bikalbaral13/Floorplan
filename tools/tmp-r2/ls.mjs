import { listObjectsDetailed, getObjectText } from "../r2.mjs";
import fs from "node:fs";
const env = Object.fromEntries(fs.readFileSync("D:/MAIN/monica_recent/.env","utf8").split(/\r?\n/).filter(l=>/^\w+=/.test(l)).map(l=>{const i=l.indexOf("=");return [l.slice(0,i), l.slice(i+1).replace(/^"|"$/g,"")];}));
export const cfg={endpoint:env.R2_ENDPOINT,accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY,bucket:env.R2_BUCKET};
export const PUBLIC=env.R2_PUBLIC_URL;
if (process.argv[2]==="ls") {
  const objs = await listObjectsDetailed(cfg, process.argv[3]||"library/");
  for (const o of objs) console.log(o.size, o.key);
}
if (process.argv[2]==="cat") {
  const r = await getObjectText(cfg, process.argv[3]);
  console.log(r.text);
}
