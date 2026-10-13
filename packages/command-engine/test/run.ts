// node node_modules/jiti/lib/jiti-cli.mjs packages/command-engine/test/run.ts [--embed] [--verbose]
// Runs every example sentence (data/examples.json) plus the hand-checked cases below through the engine
// on a fixture plan. --embed loads MiniLM (transformers.js, onnxruntime-node) for the semantic layer.
import EXAMPLES from "../data/examples.json";
import { CommandEngine } from "../src/engine";
import type { Decision, Embedder } from "../src/types";
import { CTX, CTX_SEL } from "./fixture";

const argv = process.argv.slice(2);
const verbose = argv.includes("--verbose");

/** Cases with an exact expectation on the first call's args. */
const CHECKS: { text: string; intent: string; sel?: boolean; expect?: Record<string, unknown>; kind?: Decision["kind"] }[] = [
  { text: "add a door on the north wall of bedroom 2, 900 wide", intent: "door.add", expect: { object: "door.single.v1", x: 5.75, y: 4, widthM: 0.9 } },
  { text: "put a 1 m door between kitchen and dining", intent: "door.add", expect: { x: 8, widthM: 1 } },
  { text: "add a 1.5 m window on the east wall of the living room", intent: "window.add", expect: { x: 5, y: 2, widthM: 1.5 } },
  { text: "place a queen bed in the master bedroom", intent: "object.place", expect: { object: "bed.queen.v1", x: 2, y: 6 } },
  { text: "put a wardrobe against the west wall of bedroom 2", intent: "object.place", expect: { object: "wardrobe.v1", x: 4.6, rotation: 270 } },
  { text: "Add a 3 seater sofa in the living room", intent: "object.place", expect: { object: "sofa.3seat.v1" } },
  { text: "make the kitchen 4 by 3.5 m", intent: "room.resize", expect: { space: "r3", side: "E", deltaM: 1 } },
  { text: "extend bedroom 2 by 500 mm to the east", intent: "room.resize", expect: { side: "E", deltaM: 0.5 } },
  { text: "hide the MEP layers", intent: "layer.visibility", expect: { layers: ["mep-elec", "plumbing"], visible: false } },
  { text: "show structure", intent: "layer.visibility", expect: { layers: ["struct-col"], visible: true } },
  { text: "switch to level 1", intent: "level.set", expect: { id: "L1" } },
  { text: "go to first floor", intent: "level.set", expect: { id: "L1" } },
  { text: "show 3D", intent: "view.set", expect: { mode: "3d" } },
  { text: "undo last 3", intent: "history", expect: { op: "undo", count: 3 } },
  { text: "rename room 7 to Study", intent: "room.rename", expect: { space: "r7", name: "Study" } },
  { text: "merge living and dining", intent: "room.merge", expect: { spaces: ["Living Room", "Dining"] } },
  { text: "delete selected", intent: "delete", sel: true, expect: { targets: { selection: true } } },
  { text: "move the bed 300 mm left", intent: "move", expect: { dxM: -0.3, dyM: 0 } },
  { text: "rotate the bed 90 degrees", intent: "rotate", expect: { angle: 90 } },
  { text: "set render mode to basic for all furniture", intent: "rendermode.set", expect: { mode: "Basic" } },
  { text: "draw a wall from 0,0 to 5,0", intent: "wall.add", expect: { x1: 0, y1: 0, x2: 5, y2: 0 } },
  { text: "add a 3x4 bedroom", intent: "room.add" },
  { text: "create a study 3 by 3.5 m next to the living room", intent: "room.add" },
  { text: "set the bed width to 1800", intent: "object.param", expect: { params: { width: 1.8 } } },
  { text: "replace this sofa with an L-shaped sofa", intent: "object.replace", expect: { object: "sofa.l.v1" } },
  { text: "hide the image overlay", intent: "underlay.set", expect: { visible: false } },
  { text: "almirah in bedroom 2", intent: "object.place", expect: { object: "wardrobe.v1" } },
  { text: "add a door in kitchn", intent: "door.add" },
  { text: "add a door to bedroom 2 and then hide MEP", intent: "door.add" },
  { text: "don't move the bed", intent: "", kind: "fallback" },
  { text: "make this feel more spacious", intent: "", kind: "fallback" },
  { text: "design a 3BHK for a 30x40 plot with vastu", intent: "", kind: "fallback" },
];

/** Phrasings that are in NO rule and NO example — the honest measure of what embeddings add. */
const HELDOUT: { text: string; intent: string }[] = [
  { text: "pop a window into the kitchen", intent: "window.add" },
  { text: "I'd love a doorway from the dining into the kitchen", intent: "door.add" },
  { text: "make room for a refrigerator in the kitchen", intent: "object.place" },
  { text: "the master bedroom needs a wardrobe", intent: "object.place" },
  { text: "get the electrical out of my way", intent: "layer.visibility" },
  { text: "bring back the columns", intent: "layer.visibility" },
  { text: "i want to see it in 3d", intent: "view.set" },
  { text: "take me to the first floor", intent: "level.set" },
  { text: "oops, take that back", intent: "history" },
  { text: "wipe it all and begin again", intent: "canvas.clear" },
  { text: "living and dining should be one open space", intent: "room.merge" },
  { text: "bedroom 2 should be called guest room", intent: "room.rename" },
  { text: "push the sofa 400 mm towards the north", intent: "move" },
  { text: "spin the bed 90", intent: "rotate" },
  { text: "lose the coffee table", intent: "delete" },
  { text: "which rooms do we have", intent: "rooms.list" },
  { text: "fade the background image to 30%", intent: "underlay.set" },
  { text: "give bedroom 2 a floor finish", intent: "object.attach" },
  { text: "swap out the bed for the king size one", intent: "object.replace" },
  { text: "the bed should be 1800 wide", intent: "object.param" },
  { text: "the toilet should be 2.5 by 2", intent: "room.resize" },
  { text: "go downstairs", intent: "level.set" },
];

async function loadEmbedder(): Promise<Embedder> {
  const { pipeline } = await import("@huggingface/transformers");
  const fe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", { dtype: "q8" });
  return async (texts) => {
    const out = await fe(texts, { pooling: "mean", normalize: true });
    const [n, d] = out.dims as [number, number];
    return Array.from({ length: n }, (_, i) => new Float32Array((out.data as Float32Array).slice(i * d, (i + 1) * d)));
  };
}

const sub = (actual: unknown, expect: unknown): boolean => {
  if (expect && typeof expect === "object" && !Array.isArray(expect)) return Object.entries(expect).every(([k, v]) => sub((actual as Record<string, unknown>)?.[k], v));
  if (Array.isArray(expect)) return Array.isArray(actual) && expect.length === actual.length && expect.every((v, i) => sub(actual[i], v));
  if (typeof expect === "number") return typeof actual === "number" && Math.abs(actual - expect) < 0.02;
  return actual === expect;
};

const embed = argv.includes("--embed") ? await loadEmbedder() : undefined;
const engine = new CommandEngine({ embed });
let pass = 0, fail = 0;
const stats = { run: 0, suggest: 0, fallback: 0 };

const t0 = Date.now();
for (const [intent, list] of Object.entries(EXAMPLES as Record<string, string[]>)) {
  for (const text of list) {
    const d = await engine.decide(text, CTX_SEL);
    stats[d.kind]++;
    const got = d.kind === "run" ? d.parsed[0].intent : d.kind === "suggest" ? `suggest:${d.options.map((o) => o.intent).join("|")}` : `fallback(${d.reason})`;
    const ok = d.kind === "run" ? d.parsed[0].intent === intent : d.kind === "suggest" ? d.options.some((o) => o.intent === intent) : false;
    if (ok) pass++; else fail++;
    if (!ok || verbose) console.log(`${ok ? "  ok " : "MISS "} [${intent}] "${text}" → ${got}`);
  }
}
console.log(`\nexamples: ${pass}/${pass + fail} recognised  (run ${stats.run}, suggest ${stats.suggest}, fallback ${stats.fallback})${embed ? "  [seen: these sentences are in the index]" : ""}`);

const held = { run: 0, suggest: 0, wrong: 0, fallback: 0 };
for (const h of HELDOUT) {
  const d = await engine.decide(h.text, { ...CTX_SEL, activeLevelId: "L1" });
  const tag = d.kind === "run" ? (d.parsed[0].intent === h.intent ? "run" : "wrong") : d.kind === "suggest" ? (d.options.some((o) => o.intent === h.intent) ? "suggest" : "wrong") : "fallback";
  held[tag as keyof typeof held]++;
  if (tag !== "run" || verbose) console.log(`  ${tag.padEnd(8)} [${h.intent}] "${h.text}" → ${d.kind === "run" ? `${d.parsed[0].intent} (${d.parsed[0].via} ${d.parsed[0].confidence}) ${d.parsed[0].summary}` : d.kind === "suggest" ? d.options.map((o) => `${o.intent} ${o.confidence}`).join(" | ") : d.reason}`);
}
console.log(`held-out: ${held.run} run correctly, ${held.suggest} offered as a suggestion, ${held.fallback} handed to AI, ${held.wrong} wrong (of ${HELDOUT.length}; "wrong" = ran the wrong command, or suggested only wrong ones)`);

let cp = 0;
for (const c of CHECKS) {
  const d = await engine.decide(c.text, c.sel ? CTX_SEL : CTX);
  let ok: boolean;
  if (c.kind === "fallback") ok = d.kind === "fallback";
  else ok = d.kind === "run" && d.parsed[0].intent === c.intent && (!c.expect || sub(d.parsed[0].calls[0]?.args, c.expect));
  if (ok) cp++;
  if (!ok || verbose) console.log(`${ok ? "  ok " : "FAIL "} "${c.text}" → ${JSON.stringify(d.kind === "run" ? d.parsed.map((p) => ({ i: p.intent, s: p.summary, a: p.calls[0]?.args })) : d)}`);
}
console.log(`checks: ${cp}/${CHECKS.length} exact   (${Date.now() - t0} ms total, embeddings ${embed ? "on" : "off"})`);
process.exit(cp === CHECKS.length ? 0 : 1);
