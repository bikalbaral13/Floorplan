// Phase 1 inventory: mine Claude Code transcripts for
//   human sentence → canvas tool calls that followed it.
// Usage: node tools/command-engine/inventory.mjs [transcriptDir ...]
// Writes tools/command-engine/inventory/pairs.jsonl + tools.json
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const home = os.homedir();
const dirs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["D--MAIN-monica-recent", "D--MAIN-Viewer"].map((d) => path.join(home, ".claude", "projects", d));

// Tools that act on the canvas / plan (the things a Command Engine could emit).
const CANVAS = /^mcp__(floorplan|floorplan-bridge|Moodboard|03dbf1e2[^_]*|12a79244[^_]*)__/;

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "inventory");
fs.mkdirSync(outDir, { recursive: true });

const textOf = (c) =>
  typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";

const shortInput = (input) => {
  const s = JSON.stringify(input ?? {});
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
};

const pairs = [];
const toolCounts = {};
for (const dir of dirs) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    let cur = null;
    const flush = () => { if (cur && cur.calls.length) pairs.push(cur); cur = null; };
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch { continue; }
      if (e.isSidechain) continue;
      if (e.type === "user" && e.origin?.kind === "human") {
        const text = textOf(e.message?.content).trim();
        if (!text || text.startsWith("<")) continue;
        flush();
        cur = { session: f.slice(0, 8), ts: e.timestamp, text, calls: [] };
      } else if (e.type === "assistant" && cur) {
        for (const b of e.message?.content ?? []) {
          if (b.type !== "tool_use" || !CANVAS.test(b.name)) continue;
          const tool = b.name.replace(/^mcp__[^_]+(?:-[^_]+)*__/, "");
          const op = b.input?.op ? `${tool}.${b.input.op}` : tool;
          toolCounts[op] = (toolCounts[op] ?? 0) + 1;
          cur.calls.push({ op, input: shortInput(b.input) });
        }
      }
    }
    flush();
  }
}

fs.writeFileSync(path.join(outDir, "pairs.jsonl"), pairs.map((p) => JSON.stringify(p)).join("\n") + "\n");
fs.writeFileSync(
  path.join(outDir, "tools.json"),
  JSON.stringify(Object.fromEntries(Object.entries(toolCounts).sort((a, b) => b[1] - a[1])), null, 2),
);
console.log(`${pairs.length} sentence→tool-call pairs, ${Object.keys(toolCounts).length} distinct ops → ${outDir}`);
