import { readFileSync, writeFileSync } from "node:fs";
const j = JSON.parse(readFileSync("paste/incoming.json", "utf8"));
const notes = [];

// 1. SECRETS. The library bucket is world-readable, and flow export strips only `_`-prefixed params,
//    so a `secret: true` field like api_key survives into the file. Blank every one.
let keys = 0;
for (const n of j.nodes) {
  const p = n.data?.params ?? {};
  if (typeof p.api_key === "string" && p.api_key.trim()) { notes.push(`${n.id}: api_key blanked (${p.api_key.length} chars)`); p.api_key = ""; keys++; }
}

// 2. METADATA. The export carries only version/nodes/edges; the library needs id/title/category to
//    show the entry by name, and every other workflow in that folder has all four.
const meta = {
  version: 1,
  id: "Semantic_Prompt",
  title: "Semantic Prompt — read the canvas model, compose a prompt, render it",
  category: "Architectural",
  description: `Reads the canvas — or just the selected room — and composes a prompt describing every parametric object in it, what each is meant to look like, and where each sits. The prompt then drives a Render node.

  FOUR STEPS. Plan JSON reads the model; Prompt Builder fills a template from it; Output Metrics publishes the finished text and the counts beside it; the Render node takes that text on its Prompt input and photographs the 3D view.

  WHY IT IS THIS SHORT. Plan JSON already carries all three things being asked for. Every object's \`semantics\` is one of its parameters, so it is serialised alongside that object rather than gathered separately, and every object's POSITION is in there too — \`boundary\` for the space, \`from\`/\`to\` for a segment-hosted wall or opening, \`at\` for a node-hosted furnishing.

  THE PROMPT REACHES RENDER THROUGH THE OUTPUT NODE. Each Output slot re-publishes what it collected on \`val-<slotId>\`, so the node can sit mid-chain rather than only terminating: read the metric, show it, pass it on. That is what the \`val-s5 -> valin-prompt\` wire is doing, and it is why the prompt is visible in the Metrics panel before it is spent on a call.

  SELECT A ROOM OR SELECT NOTHING. The Space source scopes Plan JSON: a selected room narrows the output to that room, and selecting nothing yields no polygon, which leaves it on the whole canvas — the saved state has \`"scoped": false\`, i.e. the whole canvas. Do NOT feed it Canvas out-0 instead; that is a bundle of every space, and Plan JSON would scope to whichever one came first.

  IT NEEDS THE SOURCE FOR A SECOND REASON. A node is only evaluated when it is downstream of a geometry root, so a Plan JSON with nothing wired in would never run at all.

  NO API KEY IS STORED HERE. Flow export writes \`secret\` fields verbatim — only \`_\`-prefixed params are stripped — so the key was removed before this file was published to the shared bucket. Put your own into the Render node after importing.

  WATCH THE OBJECT COUNT. Semantics live on objects, so "Objects in scope" measures how much the prompt actually says. A count of 0 means a prompt with nothing in it, however long the JSON looks.`,
};
const out = { ...meta, nodes: j.nodes, edges: j.edges };

// 3. Report the baked snapshot values rather than removing them — they are one canvas's resolved
//    wires and are overwritten on the next evaluation, but they are also most of the file's size.
for (const n of out.nodes) {
  const p = n.data?.params ?? {};
  for (const k of Object.keys(p)) if (/^v\d+$/.test(k) && typeof p[k] === "string" && p[k].length > 200) notes.push(`${n.id}.${k}: baked snapshot, ${p[k].length} B`);
  if (n.data?.tool === "render" && typeof p.prompt === "string" && p.prompt.length > 200) notes.push(`${n.id}.prompt: baked snapshot, ${p.prompt.length} B`);
}

const txt = JSON.stringify(out, null, 2);
JSON.parse(txt);
// Nothing that looks like a credential may survive.
for (const m of txt.match(/"api_key"\s*:\s*"([^"]*)"/g) ?? []) if (!/""\s*$/.test(m)) throw new Error("api_key still populated: " + m);
if (/AQ\.[A-Za-z0-9_-]{10,}/.test(txt)) throw new Error("a Google-style key string is still present");
writeFileSync("out/Semantic_Prompt.json", txt, "utf8");
console.log(`keys blanked: ${keys}`);
notes.forEach((n) => console.log("  · " + n));
console.log(`\n${out.nodes.length} nodes, ${out.edges.length} edges, ${(txt.length/1024).toFixed(1)} KB`);
console.log("tools:", out.nodes.map((n) => n.data.tool).join(" | "));
