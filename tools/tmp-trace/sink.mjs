/** A one-shot local sink so the form can hand its artefacts straight to disk. */
import http from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
let got = 0;
http.createServer((req, res) => {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "POST,OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  let body = "";
  req.on("data", d => { body += d; });
  req.on("end", () => {
    const name = decodeURIComponent((req.url || "/f").slice(1)) || "file";
    writeFileSync(`${OUT}/${name}`, body, "utf8");
    console.log(`wrote ${name}  ${body.length} B`);
    res.writeHead(200, cors); res.end("ok");
    got++;
  });
}).listen(41777, "127.0.0.1", () => console.log("sink on 41777 ->", OUT));
