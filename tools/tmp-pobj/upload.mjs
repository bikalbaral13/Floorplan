import { readFileSync, readdirSync } from "node:fs";
const files = readdirSync("out").filter((f) => f !== "_index.json").sort();
for (const f of files) {
  const content = readFileSync(`out/${f}`, "utf8");
  const res = await fetch("http://localhost:2500/__r2/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: `Objects/Architectural/${f}`, content }),
  });
  const body = await res.json().catch(() => null);
  console.log(`${body?.ok ? "ok  " : "FAIL"} ${f.padEnd(18)} ${body?.key ?? ""} ${body?.error ?? ""}`);
}
