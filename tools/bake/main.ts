/**
 * bake — resolve a SPINE parametric object at ONE parameter set and write the answer back INTO the file.
 *
 *   npm run bake -- <file|url>                          bake at the file's own defaults
 *   npm run bake -- <file|url> --set length=2.4         override a parameter (repeatable)
 *   npm run bake -- <file|url> --out bed.baked.json     choose the destination
 *   npm run bake -- <file|url> --list                   print the parameter schema, bake nothing
 *
 * WHY THE RESULT GOES IN THE FILE. The object format is open-schema — a reader takes the keys it understands
 * and ignores the rest — so a `resolved` block rides alongside `nodes`/`edges` without disturbing the editor,
 * and the result is ONE file that a consumer with no evaluator can draw. That consumer is the SketchUp
 * importer: it reads `resolved.meshes` and nothing else, and never learns what a spine is.
 *
 * FRAME: anchor (0,0) and ppm 1, deliberately and not configurably. 3D leaves the resolver in plan-frame
 * metres whatever you pass, but 2D runs through `toPx`, which applies BOTH — so any other ppm would put the
 * two channels in one file at different scales with nothing saying which is which. At ppm 1 `toPx` is the
 * identity and both are metres. `resolved.frame` states this so a reader never has to infer it.
 *
 * A `resolved` block is a CACHE. What makes it safe is `sourceHash` — the spine graph it came from — so a
 * consumer that can evaluate can check it, and one that cannot can at least report what it is drawing.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { parseSpineObject, resolveSpineObject, spineParams } from "../../src/floorplan/flow/eval/spineObject";

const BAKE_SCHEMA = 1;

// ── args ──────────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const valueOf = (f: string): string | undefined => {
  const i = argv.indexOf(f);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

/** Every `--set k=v`, in order — repeatable, unlike valueOf's single lookup. */
const setPairs = (): [string, string][] => {
  const out: [string, string][] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== "--set" || i + 1 >= argv.length) continue;
    const eq = argv[i + 1].indexOf("=");
    if (eq <= 0) {
      console.error(`--set expects key=value, got "${argv[i + 1]}"`);
      process.exit(1);
    }
    out.push([argv[i + 1].slice(0, eq), argv[i + 1].slice(eq + 1)]);
  }
  return out;
};

/** The first bare argument that is not the VALUE of a flag — so `--set length=2 bed.json` and
 *  `bed.json --set length=2` both name the same source. */
const positional = (): string | undefined => {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) continue;
    const prev = i > 0 ? argv[i - 1] : "";
    if (prev === "--set" || prev === "--out") continue;
    return argv[i];
  }
  return undefined;
};

const source = positional();
if (!source) {
  console.error("usage: npm run bake -- <file|url> [--set key=value]... [--out file] [--list] [--pretty]");
  process.exit(1);
}

const PRETTY = has("--pretty");
const LIST = has("--list");

// ── load ──────────────────────────────────────────────────────────────────────────────────────────
/** A library object addressed either on disk or by URL — the R2 read origin is public, so baking straight
 *  from the bucket needs no credentials and no local mirror. */
const load = async (src: string): Promise<string> => {
  if (!/^https?:\/\//i.test(src)) return readFileSync(src, "utf8");
  const res = await fetch(src);
  if (!res.ok) throw new Error(`GET ${src} → ${res.status} ${res.statusText}`);
  return res.text();
};

const defText = await load(source);
const flow = parseSpineObject(defText);
if (!flow) {
  console.error(`Not a spine object: ${source}`);
  console.error("(no `object` block, or no Math Engine — the rules-DSL objects take a different path)");
  process.exit(1);
}

const params = spineParams(flow);
const hostKind = flow.object?.hostKind;
const name = flow.object?.name ?? "Object";

if (LIST) {
  console.log(`${name}  (hostKind: ${hostKind ?? "—"})`);
  for (const p of params) {
    const range = p.min !== undefined && p.max !== undefined ? `  [${p.min}…${p.max}]` : "";
    const opts = p.options?.length ? `  {${p.options.map((o) => o.value).join(" | ")}}` : "";
    console.log(`  ${p.key.padEnd(18)} ${String(p.default).padEnd(12)} ${p.label}${range}${opts}`);
  }
  process.exit(0);
}

// ── overrides ─────────────────────────────────────────────────────────────────────────────────────
/** Command-line values arrive as strings; the scope wants the parameter's own type. Coerced against the
 *  DECLARED kind rather than by guessing from the text, so `--set semantics=2` stays the string "2" and
 *  `--set footboard=0` is false rather than a truthy string. */
const coerce = (raw: string, kind: string, key: string): number | string | boolean => {
  if (kind === "checkbox") {
    if (/^(true|1|yes|on)$/i.test(raw)) return true;
    if (/^(false|0|no|off)$/i.test(raw)) return false;
    console.error(`--set ${key}: expected a boolean, got "${raw}"`);
    process.exit(1);
  }
  if (kind === "number") {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      console.error(`--set ${key}: expected a number, got "${raw}"`);
      process.exit(1);
    }
    return n;
  }
  return raw;
};

const byKey = new Map(params.map((p) => [p.key, p]));
const overrides: Record<string, number | string | boolean> = {};
for (const [k, v] of setPairs()) {
  const p = byKey.get(k);
  if (!p) {
    console.error(`--set ${k}: no such parameter. Run with --list to see them.`);
    process.exit(1);
  }
  const val = coerce(v, p.kind, k);
  // Out-of-range is a WARNING, not an error: the declared range drives the editor's slider, and baking a
  // deliberate outlier to see what the geometry does is a legitimate thing to want.
  if (typeof val === "number" && p.min !== undefined && p.max !== undefined && (val < p.min || val > p.max)) {
    console.warn(`  warning: ${k}=${val} is outside the declared range [${p.min}…${p.max}]`);
  }
  overrides[k] = val;
}

/** What the object was ACTUALLY baked at — defaults with the overrides applied. Written out whole rather
 *  than as a diff, so a reader knows every value without needing the source file to fill in the rest. */
const bakedParams: Record<string, number | string | boolean> = {};
for (const p of params) bakedParams[p.key] = p.key in overrides ? overrides[p.key] : p.default;

// ── resolve ───────────────────────────────────────────────────────────────────────────────────────
if (hostKind === "canvas") {
  console.error(`"${name}" is a canvas-hosted object: it reads the whole drawing (SpineEnv.canvasJson) and`);
  console.error("has nothing to show standalone. Bake a node / segment / space object instead.");
  process.exit(1);
}

// No `host` argument: an unattached bake leaves each parameter's own typed default in place, which is what
// makes these objects draw standing alone. (bed.json's host param `P` defaults to "[[0, 0]]" — the origin.)
const resolved = resolveSpineObject(defText, { x: 0, y: 0 }, 1, overrides);
if (!resolved) {
  console.error(`Failed to resolve "${name}" — the Math Engine body is missing or empty.`);
  process.exit(1);
}

// ── shape the output ──────────────────────────────────────────────────────────────────────────────
/** Coordinates carry far more precision than any consumer needs, and the encoding is `number[][][]`, the
 *  least compact there is. 4dp is a tenth of a millimetre — below SketchUp's own tolerance. */
const r4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const ring3 = (f: number[][]): number[][] => f.map((p) => [r4(p[0]), r4(p[1]), r4(p[2])]);
const ring2 = (r: { x: number; y: number }[]): number[][] => r.map((p) => [r4(p.x), r4(p.y)]);

/** A mesh's canvas LAYER lives on the 3D Render row, not on the mesh the resolver returns — and the two
 *  share an id (`meshes.push({ id: row.id, … })`), so the join is by id rather than by position. */
const layerById = new Map<string, string>();
for (const n of flow.nodes ?? []) {
  const node = n as { data?: { tool?: string; params?: { prims?: unknown } } };
  if (node?.data?.tool !== "render-3d") continue;
  const prims = node.data?.params?.prims;
  for (const row of Array.isArray(prims) ? (prims as { id?: string; layer?: string }[]) : []) {
    if (typeof row?.id === "string" && typeof row.layer === "string" && row.layer) layerById.set(row.id, row.layer);
  }
}

const meshes = resolved.meshes.map((m) => ({
  id: m.id,
  name: m.name,
  color: m.color,
  // The Library-relative path of the Material wired into this row, when there is one. A LINK is baked,
  // not the material's content: the consumer (the Blender addon, a glTF writer) resolves it at import,
  // so retuning the material file restyles every bake that points at it without re-baking anything.
  ...(m.material ? { material: m.material } : {}),
  ...(layerById.has(m.id) ? { layer: layerById.get(m.id)! } : {}),
  faces: m.faces.map(ring3),
}));

const metrics = [...resolved.outputs.declared, ...resolved.outputs.derived].map((row) => ({
  name: row.name,
  value: row.value,
  ...(row.key ? { key: row.key } : {}),
  ...(row.unit ? { unit: row.unit } : {}),
}));

/** Identity of the DEFINITION, not of this bake: the graph and the object block, with everything else in the
 *  file (title, description, a previous `resolved`) left out. So re-baking at different parameters leaves the
 *  hash alone, and editing the geometry changes it — which is exactly the staleness question a consumer asks. */
const sourceHash = createHash("sha256")
  .update(JSON.stringify({ object: flow.object, nodes: flow.nodes, edges: flow.edges }))
  .digest("hex")
  .slice(0, 16);

const doc = JSON.parse(defText) as Record<string, unknown>;
doc.resolved = {
  schema: BAKE_SCHEMA,
  bakedAt: new Date().toISOString(),
  bakedFrom: source,
  sourceHash,
  frame: {
    units: "m",
    /** Stated rather than implied: a consumer flipping y and calling it z-up should not have to read the
     *  resolver to learn which way the plan's y runs. */
    axes: "x east, y south (plan down-page), z up",
    anchor: [0, 0],
    pixelsPerMeter: 1,
  },
  object: { name, hostKind: hostKind ?? null, units: flow.object?.units ?? "m" },
  params: bakedParams,
  metrics,
  meshes,
  plan: {
    color: resolved.geometry.color,
    fill: resolved.geometry.fill.map(ring2),
    fillLayer: resolved.fillLayer,
    lines: resolved.geometry.lines.map(ring2),
  },
};

const out =
  valueOf("--out") ??
  join(
    /^https?:\/\//i.test(source) ? process.cwd() : dirname(source),
    basename(source.split("?")[0]).replace(/\.json$/i, "") + ".baked.json",
  );
writeFileSync(out, JSON.stringify(doc, null, PRETTY ? 2 : 0));

// ── report ────────────────────────────────────────────────────────────────────────────────────────
const faceCount = meshes.reduce((n, m) => n + m.faces.length, 0);
const overridden = Object.keys(overrides);
console.log(`${name}  →  ${out}`);
console.log(`  hash     ${sourceHash}`);
console.log(`  params   ${params.length} (${overridden.length ? `overridden: ${overridden.join(", ")}` : "all defaults"})`);
console.log(`  meshes   ${meshes.length}, ${faceCount} faces`);
for (const m of meshes) {
  console.log(`             ${m.name.padEnd(20)} ${String(m.faces.length).padStart(4)} faces  ${m.color}${m.layer ? `  [${m.layer}]` : ""}`);
}
console.log(`  metrics  ${metrics.length}`);
for (const m of metrics) console.log(`             ${m.name.padEnd(20)} ${m.value}`);
if (!resolved.outputs.ok) console.warn("  warning: the Output node reported not-ok — metrics may be incomplete.");
if (!meshes.length) console.warn("  warning: no 3D meshes. Check the 3D Render rows are wired and `show` is not false.");
