/** enrich_plan.mjs — the step between `bake_plan.mjs` and `render_plan.py`.
 *
 *  `bake_plan.mjs` assigns materials from the GLOBAL finishes rules and from a Material node when
 *  an object has one wired. It never reads the plan's OWN per-attachment `params.materialPath`
 *  and `params.finishes` — and a plan that came out of Floorplan Improver carries both on nearly
 *  every attachment, chosen per room. On the 3BHK that is 220 rows with no material, 159 of them
 *  on attachments that were already carrying the answer, including the floor tile of all 12 rooms.
 *
 *  It also adds the one camera a floorplan always wants and no plan ever contains: a top-down
 *  orthographic view of the whole floor, or of one named room.
 *
 *    node enrich_plan.mjs <baked.json> --out <enriched.json>
 *         [--room "BEDROOM 2"]     frame one room instead of the whole floor
 *         [--margin 0.6]           metres of air around the framed extent
 *         [--ceiling]              build a slab over each space, so a cove has something to bounce off
 *         [--library https://…]    where to fetch newly-referenced materials from
 */
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d; };
const has = (n) => argv.includes(`--${n}`);
const src = argv.find((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--") && !["--ceiling"].includes(argv[i - 1])));
if (!src) { console.error("usage: node enrich_plan.mjs <baked.json> --out <enriched.json> [--room NAME] [--ceiling]"); process.exit(1); }
const outFile = flag("out", src.replace(/\.json$/, ".v2.json"));
const ROOM = flag("room", null);
const MARGIN = parseFloat(flag("margin", "0.6"));

const plan = JSON.parse(readFileSync(src, "utf8"));
const LIB = (flag("library", plan.settings?.library_path) || "").replace(/\/+$/, "");
const ppm = Number(plan.settings?.pixelsPerMeter) || 1;

const hosts = [];
for (const n of plan.nodes || []) hosts.push(["node", n]);
for (const s of plan.segments || []) hosts.push(["segment", s]);
for (const s of plan.spaces || []) hosts.push(["space", s]);
const atts = [];
for (const [kind, h] of hosts) for (const a of h.attachments || []) atts.push([kind, h, a]);
const stem = (a) => String(a.objectId || "").replace(/-with-math$/, "");

/* ── 1. bind the plan's own materials ─────────────────────────────────────────────────────── */
/** `params.finishes` is "Row=path; Row=path". The row name matches the head of the mesh name
 *  BEFORE any em dash — a window's "Frame — head & sill" must match a "Frame" entry and must NOT
 *  be taken by a "Sill" one. */
const head = (s) => String(s).split("—")[0].split(" - ")[0].trim().toLowerCase();
const asMat = (p) => (!p ? null : /^Materials\//.test(p) ? p : `Materials/${p.replace(/^\/+/, "")}`);

let byFinish = 0, byPath = 0, overrode = 0, stillBare = 0;
const wanted = new Set(Object.keys(plan.materials || {}));
for (const [, , a] of atts) {
  const p = a.params || {};
  const pairs = String(p.finishes || "").split(";").map((s) => s.trim()).filter(Boolean)
    .map((s) => { const i = s.indexOf("="); return i < 0 ? null : [head(s.slice(0, i)), s.slice(i + 1).trim()]; })
    .filter(Boolean);
  for (const m of a.baked?.meshes || []) {
    if (m.render === false) continue;
    const h = head(m.name || "");
    const hit = pairs.find(([row]) => h === row) || pairs.find(([row]) => h.includes(row) || row.includes(h));
    // params.finishes OUTRANKS a global rule. The plan naming one row of one attachment is more
    // specific than an (object, mesh) rule, and filling only BLANK rows meant it could never win:
    // a bed whose plan said boucle on the headboard rendered in the rules leather, silently.
    // A wired Material node still wins over both — the object itself said so.
    if (hit && !m.wired) {
      if (m.material && m.material !== asMat(hit[1])) overrode++;
      m.material = asMat(hit[1]); m.fromPlan = "finishes"; byFinish++; wanted.add(m.material); continue;
    }
    if (m.material) continue;
    if (p.materialPath) { m.material = asMat(p.materialPath); m.fromPlan = "materialPath"; byPath++; wanted.add(m.material); continue; }
    stillBare++;
  }
}
console.log(`materials  ${byFinish} bound from params.finishes (${overrode} overriding a global rule), ${byPath} from params.materialPath, ${stillBare} still on flat colour`);

/* ── 2. embed anything newly referenced ───────────────────────────────────────────────────── */
const missing = [...wanted].filter((k) => k && !plan.materials?.[k]);
if (missing.length && LIB) {
  plan.materials ||= {};
  let ok = 0;
  for (const rel of missing) {
    try {
      const r = await fetch(`${LIB}/${rel.replace(/^Materials\//, "Materials/")}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const def = await r.json();
      if (def.schema !== "material/1") throw new Error(`schema ${JSON.stringify(def.schema)}`);
      plan.materials[rel] = def; ok++;
    } catch (e) { console.warn(`  ! ${rel}: ${e.message} — those rows keep their flat colour`); }
  }
  console.log(`embedded   ${ok}/${missing.length} newly referenced material definitions`);
}

/* ── 3. the extent to frame ───────────────────────────────────────────────────────────────── */
const nodeById = new Map((plan.nodes || []).map((n) => [n.id, n]));
const ringOf = (sp) => (sp.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean).map((n) => [n.x / ppm, n.y / ppm]);
let target = null, label = "the whole floor";
if (ROOM) {
  const want = ROOM.trim().toLowerCase();
  const sp = (plan.spaces || []).find((s) => String(s.label || "").trim().toLowerCase() === want)
    || (plan.spaces || []).find((s) => String(s.label || "").toLowerCase().includes(want));
  if (!sp) { console.error(`! no space matches --room ${JSON.stringify(ROOM)}. Have: ${(plan.spaces || []).map((s) => s.label).join(", ")}`); process.exit(2); }
  target = ringOf(sp); label = sp.label;
} else {
  target = (plan.spaces || []).flatMap(ringOf);
}
const xs = target.map((p) => p[0]), ys = target.map((p) => p[1]);
const ext = { x0: Math.min(...xs) - MARGIN, x1: Math.max(...xs) + MARGIN, y0: Math.min(...ys) - MARGIN, y1: Math.max(...ys) + MARGIN };
ext.w = ext.x1 - ext.x0; ext.h = ext.y1 - ext.y0;
const cx = (ext.x0 + ext.x1) / 2, cy = (ext.y0 + ext.y1) / 2;

/* ── 4. the top-down orthographic camera ──────────────────────────────────────────────────── */
/** A plan view is the deliverable a floorplan always wants and no canvas plan ever contains: the
 *  cameras an interior carries are eye-level shots. Orthographic, straight down (tilt -90), and
 *  `orthoScale` is the frame WIDTH in metres — the long side of the extent, so nothing is cropped.
 *  It goes FIRST so it is `scene.camera` and `--camera 1`. */
const slab = (() => {
  let h = 0;
  for (const [, , a] of atts) for (const [k, v] of Object.entries(a.params || {}))
    if (/^(slabHeight|height)$/.test(k) && stem(a) === "wall" && Number.isFinite(+v)) h = Math.max(h, +v);
  return h || 3.0;
})();

const topNodeId = `cam-top-${Date.now().toString(36)}`;
const topNode = {
  id: topNodeId, x: cx * ppm, y: cy * ppm, layer: "0",
  attachments: [{
    id: `att-${topNodeId}`, objectId: "camera-with-math",
    objectPath: "Objects/Architectural/camera.json", t: 0, flip: false,
    params: {
      rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
      view: "Orthographic",
      orthoScale: +(Math.max(ext.w, ext.h) * 1.02).toFixed(3),
      sensorWidth: 36, aspect: ext.w >= ext.h ? "16:9" : "1:1",
      eyeHeight: +(slab + 6).toFixed(2),
      tilt: -90, targetDistance: +(slab + 6).toFixed(2),
      showFrustum: false, tripod: false, minClearance: 0,
      shotName: `Plan view — ${label}`, shotOrder: 0, shotActive: true,
      resolutionX: 2400, resolutionY: 2400,
    },
    baked: { anchor: [cx, cy], metrics: [], meshes: [], plan2d: [] },
  }],
};
plan.nodes = [topNode, ...(plan.nodes || [])];
console.log(`camera     plan view of ${label}: ${ext.w.toFixed(2)} × ${ext.h.toFixed(2)} m, orthoScale ${topNode.attachments[0].params.orthoScale}, at ${topNode.attachments[0].params.eyeHeight} m`);

/* ── 5. optional enclosure ────────────────────────────────────────────────────────────────── */
/** A `false-ceiling` states a soffit height and draws a perimeter band — there is no slab, so a
 *  cove throws its light at the sky and the room renders as if it were open. Off by default,
 *  because a plan view wants the ceilings GONE. */
if (has("ceiling")) {
  const cols = [];
  for (const sp of plan.spaces || []) {
    const fc = (sp.attachments || []).find((a) => stem(a) === "false-ceiling");
    if (!fc) continue;
    const ring = ringOf(sp);
    if (ring.length < 3) continue;
    const z = Number(fc.params?.panelSoffit || fc.params?.bandSoffit || slab) - 0.005;
    // render_plan.py reads each face as a ring of ANCHOR-RELATIVE points, never as indices into a
    // vertex list — an index ring crashes the build ('int' object is not subscriptable).
    const [ax, ay] = fc.baked.anchor || [0, 0];
    const pts = ring.map(([x, y]) => [+(x - ax).toFixed(5), +(y - ay).toFixed(5), +z.toFixed(4)]);
    (fc.baked.meshes ||= []).push({
      id: "p3_slab", name: "Ceiling slab", color: "#f5f5f4", layer: "Ceiling",
      material: "Materials/Finishes/plaster.json",
      faces: [pts, [...pts].reverse()],
    });
    cols.push(sp.label || sp.id);
  }
  console.log(`enclosure  ceiling slab over ${cols.length} space(s): ${cols.join(", ")}`);
}

/* ── 6. warnings the pipeline never raised ────────────────────────────────────────────────── */
/** `fitMode: "Exact"` scales the WHOLE object including its elevation, so a 3 m cornice asked to
 *  fill a 0.45 m run bakes at scale 0.15 and sits at knee height. Under 0.5 the object is in the
 *  wrong place, not merely squeezed. */
const warn = [];
for (const [, h, a] of atts) {
  const sc = (a.baked?.metrics || []).find((m) => /scale/i.test(m.key || m.name || ""));
  const v = sc ? parseFloat(sc.value) : NaN;
  if (Number.isFinite(v) && v < 0.5) warn.push(`${stem(a)} on ${h.id}: metrics.scale ${v.toFixed(3)} — fitMode ${a.params?.fitMode}`);
}
plan.warnings = warn;
if (warn.length) {
  console.log(`\n! ${warn.length} attachment(s) scaled under 0.5 by fitMode — they are in the wrong PLACE, not just squeezed:`);
  for (const w of warn.slice(0, 12)) console.log(`    ${w}`);
}

plan.schemaVersion = 2;
plan.settings.bakedFrame = { handed: "left", note: "x east, y south, z up; a right-handed DCC needs (x, -y, z) and reversed winding", toRightHanded: "(x, -y, z)" };
writeFileSync(outFile, JSON.stringify(plan));
console.log(`\nwrote      ${outFile}`);
