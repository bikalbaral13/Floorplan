/**
 * Smoke test for `withBakedAttachments` — the export-side bake, run headlessly against a real plan.
 *
 * The editor's own path is a React component, so this rebuilds the minimum around the baker: a plan file
 * back into the model shape it expects, an object library fetched from R2 by each attachment's
 * `objectPath`, and the resolver those two need. What it proves is the thing that is hard to see from the
 * canvas — that every attachment comes out with geometry, and that walls in particular are no longer empty.
 *
 *   node tools/bakeplan/run.mjs <plan.json> [--out baked.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { withBakedAttachments } from "../../src/floorplan/export/bakeAttachments";
import { fromStandardPlan, toStandardPlan, type StandardPlan } from "../../src/floorplan/planFormat";
import type { FloorPlanModel, ParametricObjectFile } from "../../src/floorplan/types";

const argv = process.argv.slice(2);
const src = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1] !== "--out");
if (!src) { console.error("usage: node tools/bakeplan/run.mjs <plan.json> [--out file]"); process.exit(1); }
const outArg = argv.indexOf("--out") >= 0 ? argv[argv.indexOf("--out") + 1] : undefined;

const plan = JSON.parse(readFileSync(src, "utf8")) as StandardPlan;
const base = (plan.settings.library_path ?? "").replace(/\/+$/, "");

// ── object library: every distinct `objectPath` the plan references, keyed by the objectId the
//    attachments name (which is how the model's `objectLibrary` is keyed). ──
const paths = new Map<string, string>(); // objectPath -> objectId
for (const host of [...plan.nodes, ...plan.segments, ...plan.spaces]) {
  for (const att of (host as { attachments?: { objectPath?: string; objectId: string }[] }).attachments ?? []) {
    if (att.objectPath) paths.set(att.objectPath, att.objectId);
  }
}

const objectLibrary: Record<string, ParametricObjectFile> = {};
for (const [path, id] of paths) {
  const url = `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`  ! ${path} -> ${res.status}`); continue; }
  const raw = JSON.parse(await res.text()) as Record<string, unknown>;
  // A flow FILE has object/nodes/edges at top level; the stored library record keeps them under `spine`.
  // The evaluators are handed the record, so wrap what the bucket serves.
  // `meta.symbol` is what tells the baker a wall is a wall (and a door a door) — the editor's own loader
  // maps it off the flow's `object` block, so the harness has to as well or the band path never fires.
  const meta = (raw.object ?? {}) as { name?: string; symbol?: string; units?: string };
  objectLibrary[id] = (raw.spine
    ? raw
    : {
        kind: "parametric-object",
        version: 1,
        meta: { id, name: String(meta.name ?? id), units: meta.units, symbol: meta.symbol },
        parameters: [],
        sourcePath: path,
        spine: raw,
      }) as unknown as ParametricObjectFile;
}
console.log(`library: ${Object.keys(objectLibrary).length}/${paths.size} objects resolved\n`);

// `fromStandardPlan` returns `{ model, frame }` — the model is a Partial, so the fields the baker walks
// are defaulted here rather than trusted.
const { model: parsed } = fromStandardPlan(plan);
const model = { walls: [], rooms: [], nodeMeta: {}, ...parsed, objectLibrary } as unknown as FloorPlanModel;

// Node attachments are keyed in `nodeMeta` by a stable key naming the segment ends meeting at the node;
// re-derive the positions the same way `toStandardPlan` does, from the segments' own endpoints.
const nodePositions: { stableKey: string; x: number; y: number }[] = [];
const ends = new Map<string, { pts: { x: number; y: number }[]; tokens: string[] }>();
for (const w of model.walls) {
  for (const [p, tok] of [[w.start, `${w.id}:start`], [w.end, `${w.id}:end`]] as const) {
    const k = `${p.x},${p.y}`;
    const hit = ends.get(k);
    if (hit) hit.tokens.push(tok as string); else ends.set(k, { pts: [p], tokens: [tok as string] });
  }
}
for (const { pts, tokens } of ends.values()) {
  nodePositions.push({ stableKey: tokens.slice().sort().join("|"), x: pts[0].x, y: pts[0].y });
}

const baked = withBakedAttachments(model, {
  pixelsPerMeter: plan.settings.pixelsPerMeter,
  nodePositions,
  resolveObjectDef: (id: string) => (objectLibrary[id] ? JSON.stringify(objectLibrary[id]) : null),
});

const out = toStandardPlan(baked, {
  pixelsPerMeter: plan.settings.pixelsPerMeter,
  northBearing: plan.settings.northbearing,
  libraryPath: plan.settings.library_path as string | undefined,
});

interface Baked { anchor: [number, number]; meshes?: { faces: unknown[] }[]; metrics?: unknown[]; hidden3d?: boolean }
let n = 0, withMesh = 0, faces = 0, hidden = 0;
console.log("host      object          anchor(m)                meshes faces  hidden3d");
for (const [kind, list] of [["node", out.nodes], ["segment", out.segments], ["space", out.spaces]] as const) {
  for (const host of list) {
    for (const att of (host as { attachments?: { objectPath?: string; baked?: Baked }[] }).attachments ?? []) {
      n++;
      const b = att.baked;
      const ms = b?.meshes ?? [];
      const f = ms.reduce((s, m) => s + m.faces.length, 0);
      if (ms.length) withMesh++;
      faces += f;
      if (b?.hidden3d) hidden++;
      console.log(
        kind.padEnd(9) + String(att.objectPath).split("/").pop()!.padEnd(15) +
        JSON.stringify(b?.anchor ?? []).padEnd(25) + String(ms.length).padStart(5) + String(f).padStart(6) +
        (b?.hidden3d ? "   yes" : ""),
      );
    }
  }
}
console.log(`\nattachments ${n}   with meshes ${withMesh}   faces ${faces}   via hidden rows ${hidden}`);
if (outArg) { writeFileSync(outArg, JSON.stringify(out, null, 2)); console.log(`\nwrote ${outArg}`); }
