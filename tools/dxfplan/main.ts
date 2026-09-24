/**
 * Plan → drawing geometry, headless. The first half of the DXF pipeline (the second is
 * tools/dxfplan/dxf.py, which writes the sheet with ezdxf).
 *
 * Reads a standard plan file, evaluates every attachment exactly as the export does (bakeAttachments, with
 * the object library fetched from the plan's `library_path`), computes each wall's MITRED band polygon with
 * the engine, and writes one JSON in METRES, plan frame (y down — the Python side flips to y-up):
 *
 *   walls      every band segment with its mitred polygon, thickness, height and whether it is an opening
 *   openings   the door / window pieces with their object params (hinge, swing, sill, lintel, panes …)
 *   dashed     open boundaries (no leaf) — drawn as break lines, and they close spaces
 *   spaces     room rings with label / type / region / area
 *   objects    every other attachment: kind, anchor, rotation, and its baked plan rings UN-ROTATED to the
 *              object's own frame, so the DXF side can define one BLOCK per kind and INSERT it rotated
 *
 *   node tools/dxfplan/run.mjs <plan.json> --out geo.json
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { computeMiteredWallPolygons } from "@builderpluss/engine";
import { withBakedAttachments } from "../../src/floorplan/export/bakeAttachments";
import { fromStandardPlan, toStandardPlan, type StandardPlan, type PlanSegment } from "../../src/floorplan/planFormat";
import type { FloorPlanModel, ParametricObjectFile, SegmentAttachment, Wall } from "../../src/floorplan/types";

const argv = process.argv.slice(2);
const src = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--out");
if (!src) { console.error("usage: node tools/dxfplan/run.mjs <plan.json> [--out geo.json]"); process.exit(1); }
const outArg = argv.indexOf("--out") >= 0 ? argv[argv.indexOf("--out") + 1] : "geo.json";

const plan = JSON.parse(readFileSync(src, "utf8")) as StandardPlan;
const ppm = Number(plan.settings.pixelsPerMeter) || 50;
const base = String(plan.settings.library_path ?? "").replace(/\/+$/, "");

// ── object library: every distinct objectPath, fetched once and cached on disk (the bucket is slow from
//    Node and a definition never changes between two runs of the same session). ──
const cacheDir = join(process.cwd(), "node_modules", ".cache", "floorplan-dxfplan", "objects");
mkdirSync(cacheDir, { recursive: true });
const paths = new Map<string, string>(); // objectPath -> objectId
for (const host of [...plan.nodes, ...plan.segments, ...plan.spaces]) {
  for (const att of (host as { attachments?: SegmentAttachment[] }).attachments ?? []) if (att.objectPath) paths.set(att.objectPath, att.objectId);
}
const objectLibrary: Record<string, ParametricObjectFile> = {};
for (const [path, id] of paths) {
  const cached = join(cacheDir, path.replace(/[\\/]/g, "__"));
  let text: string;
  if (existsSync(cached)) text = readFileSync(cached, "utf8");
  else {
    const res = await fetch(`${base}/${path.split("/").map(encodeURIComponent).join("/")}`);
    if (!res.ok) { console.error(`  ! ${path} -> ${res.status}`); continue; }
    text = await res.text(); writeFileSync(cached, text);
  }
  const raw = JSON.parse(text) as Record<string, unknown>;
  const meta = (raw.object ?? {}) as { name?: string; symbol?: string; units?: string };
  objectLibrary[id] = (raw.spine ? raw : { kind: "parametric-object", version: 1, meta: { id, name: String(meta.name ?? id), units: meta.units, symbol: meta.symbol }, parameters: [], sourcePath: path, spine: raw }) as unknown as ParametricObjectFile;
}
console.log(`library: ${Object.keys(objectLibrary).length}/${paths.size} objects resolved`);

const { model: parsed } = fromStandardPlan(plan);
const model = { walls: [], rooms: [], nodeMeta: {}, ...parsed, objectLibrary } as unknown as FloorPlanModel;

// Node positions keyed the way nodeMeta is (sorted "<segId>:end|<segId>:start" of the ends meeting there).
const ends = new Map<string, { p: { x: number; y: number }; tokens: string[] }>();
for (const w of model.walls) for (const [p, tok] of [[w.start, `${w.id}:start`], [w.end, `${w.id}:end`]] as const) {
  const k = `${p.x},${p.y}`; const hit = ends.get(k); if (hit) hit.tokens.push(tok); else ends.set(k, { p, tokens: [tok] });
}
const nodePositions = [...ends.values()].map(({ p, tokens }) => ({ stableKey: tokens.slice().sort().join("|"), x: p.x, y: p.y }));

const baked = withBakedAttachments(model, { pixelsPerMeter: ppm, nodePositions, resolveObjectDef: (id) => (objectLibrary[id] ? JSON.stringify(objectLibrary[id]) : null) });
const out = toStandardPlan(baked, { pixelsPerMeter: ppm, northBearing: plan.settings.northbearing, libraryPath: base });

// ── geometry in metres, plan frame ──
const M = (v: number) => Math.round((v / ppm) * 1e4) / 1e4;
const nodeAt = new Map(out.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
const P = (id: string) => { const n = nodeAt.get(id)!; return [M(n.x), M(n.y)]; };
const kindOf = (a: SegmentAttachment) => String(a.objectPath ?? a.objectId).split("/").pop()!.replace(/\.json$/, "");
const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);

interface Baked { anchor: [number, number]; plan2d?: { fill: number[][][]; lines: number[][][] }; metrics?: { name: string; value: string; key?: string }[] }
const bakedOf = (a: SegmentAttachment) => (a as { baked?: Baked }).baked;

// Band segments = anything with a thickness > 1 px and non-zero length (markers are zero-length, dashed lines 1.5 px).
const isMarker = (s: PlanSegment) => s.fromNodeId === s.toNodeId;
const isDashed = (s: PlanSegment) => !!(s as { dashed?: boolean }).dashed;
const bandSegs = out.segments.filter((s) => !isMarker(s) && !isDashed(s) && num(s.thickness, 0) > 1);
// Mitred polygons from the engine, on the plan's pixel walls (same ids).
const wallById = new Map(model.walls.map((w) => [w.id, w]));
const mitred = computeMiteredWallPolygons(bandSegs.map((s) => wallById.get(s.id)!).filter(Boolean) as Wall[]);

const walls = bandSegs.map((s) => {
  const wallAtt = (s.attachments ?? []).find((a) => kindOf(a) === "wall");
  const opening = (s.attachments ?? []).find((a) => kindOf(a) === "door" || kindOf(a) === "window");
  const poly = mitred.get(s.id) ?? [];
  return {
    id: s.id, a: P(s.fromNodeId), b: P(s.toNodeId), thickness: M(num(s.thickness, 4)),
    height: num(wallAtt?.params.height, 2.7), hatch: (s as { hatch?: boolean }).hatch !== false,
    isOpening: !!(s as { isObjectOpening?: boolean }).isObjectOpening, label: (s as { label?: string }).label ?? "",
    layer: s.layer, poly: poly.map((p) => [M(p.x), M(p.y)]),
    // The opening's baked rings (anchor-relative metres, plan frame) travel too: the DXF side reads the
    // hinge end and swing side off the drawn leaf and arc, which is what the canvas shows, rather than
    // re-deriving them from the hinge / swing / flip trio and its conventions.
    ...(opening ? { opening: { kind: kindOf(opening), params: opening.params, flip: !!opening.flip, anchor: bakedOf(opening)?.anchor ?? null, fill: bakedOf(opening)?.plan2d?.fill ?? [], lines: bakedOf(opening)?.plan2d?.lines ?? [] } } : {}),
  };
});
const dashed = out.segments.filter((s) => !isMarker(s) && isDashed(s)).map((s) => ({ id: s.id, a: P(s.fromNodeId), b: P(s.toNodeId), label: (s as { label?: string }).label ?? "" }));

const spaces = out.spaces.map((sp) => {
  const pts = sp.nodeIds.map(P); let a = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
  const s = sp as { label?: string; roomType?: string; region?: string };
  return { id: sp.id, label: s.label ?? "", roomType: s.roomType ?? "room", region: s.region ?? "", pts, area: Math.round(Math.abs(a) / 2 * 1e3) / 1e3 };
});

// Objects: every non-wall/door/window/room attachment, rings un-rotated into the object's own frame.
const objects: unknown[] = [];
const rot = (pts: number[][], deg: number) => { const c = Math.cos(deg), s = Math.sin(deg); return pts.map(([x, y]) => [Math.round((x * c - y * s) * 1e4) / 1e4, Math.round((x * s + y * c) * 1e4) / 1e4]); };
const pushObj = (host: string, hostId: string, a: SegmentAttachment, anchorFallback?: number[]) => {
  const kind = kindOf(a); if (["wall", "door", "window", "room"].includes(kind)) return;
  const b = bakedOf(a); const anchor = b?.anchor ?? anchorFallback ?? [0, 0];
  const r = (num(a.params.rotation, 0) * Math.PI) / 180;
  const metrics = Object.fromEntries((b?.metrics ?? []).map((m) => [m.name, m.value]));
  objects.push({ host, hostId, kind, anchor, rotation: num(a.params.rotation, 0), params: a.params,
    fill: (b?.plan2d?.fill ?? []).map((ring) => rot(ring, -r)), lines: (b?.plan2d?.lines ?? []).map((ring) => rot(ring, -r)), metrics });
};
for (const n of out.nodes) for (const a of n.attachments ?? []) pushObj("node", n.id, a, [M(n.x), M(n.y)]);
for (const s of out.segments) for (const a of s.attachments ?? []) pushObj("segment", s.id, a);
for (const sp of out.spaces) for (const a of sp.attachments ?? []) pushObj("space", sp.id, a);

const geo = { units: "m", frame: "plan (y down)", ppm, image: plan.imageUnderlay ? { w: plan.imageUnderlay.width, h: plan.imageUnderlay.height } : null, walls, dashed, spaces, objects };
writeFileSync(outArg, JSON.stringify(geo));
console.log(`walls ${walls.length} (openings ${walls.filter((w) => w.isOpening).length})  dashed ${dashed.length}  spaces ${spaces.length}  objects ${objects.length}\nwrote ${outArg}`);
