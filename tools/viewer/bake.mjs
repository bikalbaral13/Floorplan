/** Bake a design's objects for the R2 viewer → `<design>.view.json` next to it.
 *
 *   node tools/viewer/bake.mjs Designs/Ramanadhapuram_Villa1_improved.json [--upload] [--out file]
 *
 * Runs the app's own evaluator (tools/bakeplan/run.mjs) one level at a time — it only reads the root
 * nodes/segments/spaces — with every object forced to renderMode "Full": a placement saved as "Nothing"
 * bakes to no geometry at all. The design file itself is never changed.
 *
 * Output (all metres, plan frame: x east, y south, z up; mesh coords relative to `anchor`):
 *   { version: 1, source, bakedAt,
 *     geoms: [ [ { color, tri: [x,y,z, …] (mm ints, 3 verts per triangle) }, … ], … ],
 *     items: { "<levelIndex>/<attachmentId>": { g: <geom index>, anchor: [x, y], fill?: [[[x,y],…]] } } }
 * Identical geometry (same object, same params, same orientation) is stored once — a plan's 84 downlights
 * are one geom. Walls are skipped (the viewer draws its own). Room objects (floor, tile field, false
 * ceiling) are baked too; the viewer hides ceilings unless asked.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { signedRequest } from "../r2.mjs";
import { refreshDesignsIndex } from "./designs-index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const env = Object.fromEntries(fs.readFileSync(path.join(REPO, ".env"), "utf8").split(/\r?\n/)
  .filter((l) => /^\w+=/.test(l)).map((l) => { const i = l.indexOf("="); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")]; }));
const PUBLIC = (env.R2_PUBLIC_URL || "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev").replace(/\/+$/, "");

const argv = process.argv.slice(2);
const src = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
if (!src) { console.error("usage: node tools/viewer/bake.mjs Designs/<name>.json [--upload] [--out file]"); process.exit(1); }
const rel = src.replace(/^\/*(library\/)?/, "");
const outArg = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;

// ── load ────────────────────────────────────────────────────────────────────
let plan;
if (fs.existsSync(src)) plan = JSON.parse(fs.readFileSync(src, "utf8"));
else {
  const url = `${PUBLIC}/library/${rel.split("/").map(encodeURIComponent).join("/")}`;
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) { console.error(`! ${url} -> ${r.status}`); process.exit(1); }
  plan = await r.json();
}
const levels = plan.levels?.length
  ? plan.levels.map((L) => (L.id === plan.activeLevelId && !L.nodes?.length && plan.nodes?.length ? { ...L, nodes: plan.nodes, segments: plan.segments, spaces: plan.spaces } : L))
  : [{ id: "L", name: "Plan", nodes: plan.nodes || [], segments: plan.segments || [], spaces: plan.spaces || [] }];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "viewer-bake-"));
const skip = (a) => /^wall/.test(a.objectId || "");
// Drawing aids a render must not show — the same list as the Floorplan Renderer's finishes `helpers`.
const HELPER_OBJECT = /^(camera|light)-with-math$/;
const HELPER_MESH = /view cone|beam \/ aim|footprint/i;
const geoms = [], geomIndex = new Map(), items = {};

// Surface colour from the wired material (row.material) or the placement's params.materialPath, as the
// renderer reads them — a tile field otherwise shows its object's default swatch, not the chosen finish.
// Joints/grout/gaps keep their own colour.
const matColour = new Map();
async function colourOf(matPath) {
  const key = matPath.replace(/^\/*(library\/)?(Materials\/)?/, "Materials/");
  if (!matColour.has(key)) {
    let c = null;
    try {
      const r = await fetch(`${PUBLIC}/library/${key.split("/").map(encodeURIComponent).join("/")}`, { headers: { "user-agent": "viewer-bake" } });
      if (r.ok) { const m = await r.json(); c = m.pbr?.baseColor || m.plan2d?.color || null; }
    } catch {}
    matColour.set(key, c);
  }
  return matColour.get(key);
}
const KEEP_OWN = /joint|grout|gap|seam/i;
let faces = 0, tris = 0;

for (const [li, L] of levels.entries()) {
  const full = (h) => ({ ...h, attachments: (h.attachments || []).map((a) => ({ ...a, params: { ...(a.params || {}), renderMode: "Full" } })) });
  const lv = {
    ...plan, levels: undefined, activeLevelId: undefined,
    nodes: (L.nodes || []).map(full), segments: (L.segments || []).map(full),
    spaces: (L.spaces || []).map(full),
  };
  const want = [...lv.nodes, ...lv.segments, ...lv.spaces].flatMap((h) => h.attachments).filter((a) => !skip(a)).length;
  if (!want) { console.log(`level ${li} ${L.name}: nothing to bake`); continue; }
  const inF = path.join(work, `L${li}.json`), outF = path.join(work, `L${li}.baked.json`);
  fs.writeFileSync(inF, JSON.stringify(lv));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(REPO, "tools/bakeplan/run.mjs"), inF, "--out", outF], { cwd: REPO, encoding: "utf8", maxBuffer: 1 << 30 });
  if (r.status !== 0) { console.error(r.stderr?.slice(-3000)); console.error(`! level ${li} bake failed`); process.exit(1); }
  const baked = JSON.parse(fs.readFileSync(outF, "utf8"));
  let n = 0;
  for (const h of [...(baked.nodes || []), ...(baked.segments || []), ...(baked.spaces || [])]) {
    for (const a of h.attachments || []) {
      if (skip(a) || HELPER_OBJECT.test(a.objectId || "") || !a.baked?.meshes?.length) continue;
      const parts = [];
      for (const m of a.baked.meshes) {
        if (HELPER_MESH.test(m.name || "")) continue;
        const tri = [];
        for (const f of m.faces || []) {
          faces++;
          for (let k = 1; k + 1 < f.length; k++) for (const p of [f[0], f[k], f[k + 1]]) tri.push(Math.round(p[0] * 1000), Math.round(p[1] * 1000), Math.round(p[2] * 1000));
        }
        const mat = m.material || (!KEEP_OWN.test(m.name || "") && a.params?.materialPath);
        const colour = (mat && (await colourOf(mat))) || m.color || "#a3a3a3";
        if (tri.length) parts.push({ color: colour, tri });
      }
      if (!parts.length) continue;
      const key = crypto.createHash("sha1").update(JSON.stringify(parts)).digest("hex");
      let g = geomIndex.get(key);
      if (g == null) { g = geoms.length; geoms.push(parts); geomIndex.set(key, g); tris += parts.reduce((s, p) => s + p.tri.length / 9, 0); }
      const fill = (a.baked.plan2d?.fill || []).map((ring) => ring.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]));
      items[`${li}/${a.id}`] = { g, anchor: a.baked.anchor, ...(fill.length ? { fill } : {}) };
      n++;
    }
  }
  console.log(`level ${li} ${L.name}: ${n}/${want} objects baked  (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

const out = { version: 1, source: rel, bakedAt: new Date().toISOString(), geoms, items };
const text = JSON.stringify(out);
const outFile = outArg || path.join(work, path.basename(rel).replace(/\.json$/i, ".view.json"));
fs.writeFileSync(outFile, text);
console.log(`\n${Object.keys(items).length} objects · ${geoms.length} unique geoms · ${tris} triangles stored (${faces} faces baked) · ${(text.length / 1048576).toFixed(1)} MB`);
console.log(`wrote ${outFile}`);

if (argv.includes("--upload")) {
  const key = `library/${rel.replace(/\.json$/i, ".view.json")}`;
  const cfg = { endpoint: env.R2_ENDPOINT, accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY, bucket: env.R2_BUCKET };
  // Served gzip-encoded: the browser inflates it transparently, and mm-int JSON shrinks ~5×.
  const gz = zlib.gzipSync(text, { level: 9 });
  await signedRequest(cfg, "PUT", key, gz, { "content-type": "application/json", "content-encoding": "gzip", "cache-control": "no-cache" });
  console.log(`gzip ${(gz.length / 1048576).toFixed(1)} MB`);
  console.log(`uploaded ${PUBLIC}/${key}`);
  await refreshDesignsIndex(cfg);
}
