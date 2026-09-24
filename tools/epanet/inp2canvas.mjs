/** EPANET .inp  ->  standard canvas plan JSON (+ the GGA matrices for the Math Engine flow).
 *
 *  WHAT COMES OUT
 *    <out>.json          the standard plan: settings / nodes / segments / spaces / layers, plus
 *                        `graphAttrs` (the Pipe Network Solver's per-component inputs, bound by
 *                        ROLE) and one parametric object attached to every node and every segment.
 *    <out>.gga.json      A12 / A10 / H0 / r / q / Q0 / H0j - the same network as the matrices the
 *                        Todini-Pilati Math Engine takes, so the two routes solve the same problem.
 *
 *  TWO LENGTHS, ON PURPOSE. An EPANET layout is a SCHEMATIC: Net1 draws a 3.2 km main between
 *  coordinates 10 units apart. Map coordinates therefore become the DRAWING (1 map unit = 1 m at
 *  `--ppm` pixels per metre) while the true [PIPES] length rides as the solver's `length` role and
 *  the Pipe object's `lengthOverride`. Geometry stays a diagram; hydraulics stay exact.
 *
 *  UNITS. US-customary EPANET files (GPM/CFS/...) are converted to the SI the engine works in:
 *  ft -> m, in -> mm, gpm -> L/s. An LPS/LPM/CMH file is already metric and passes through.
 *
 *  NODE KEYS. The editor keys node data by a STABLE KEY - the sorted set of `<segmentId>:<start|end>`
 *  meeting at that point - not by a node id, so metadata sticks to a junction as it moves. Both
 *  `graphAttrs.nodes` and `nodeMeta` are written under that key, rebuilt here exactly as
 *  planFormat.ts's `stableKeys()` builds it.
 */
import { readFileSync, writeFileSync } from "node:fs";

// ── CLI ───────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const IN = argv.find((a) => !a.startsWith("--") && (argv.indexOf(a) === 0 || !argv[argv.indexOf(a) - 1]?.startsWith("--")));
const INP = IN ?? argv[0];
const OUT = arg("out", INP.replace(/\.inp$/i, "") + ".canvas.json");
const PPM = Number(arg("ppm", 12));            // canvas pixels per metre
const MAPSCALE = Number(arg("mapscale", 1));   // EPANET map unit -> metres
const LIBRARY = arg("library", "/Library/");

// ── Unit conversion ───────────────────────────────────────────────────────────
const FT = 0.3048, INCH = 25.4;
const FLOW_TO_LPS = {
  GPM: 0.0630901964, CFS: 28.316846592, MGD: 43.8126364, IMGD: 52.6168, AFD: 14.2764,
  LPS: 1, LPM: 1 / 60, MLD: 11.5740741, CMH: 1 / 3.6, CMD: 1 / 86.4,
};
const US_FLOW = new Set(["GPM", "CFS", "MGD", "IMGD", "AFD"]);

// ── Parse ─────────────────────────────────────────────────────────────────────
/** Split an .inp into `{SECTION: [tokenised, comment-stripped lines]}`. */
function parseInp(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    const m = line.match(/^\[(\w+)\]$/i);
    if (m) { cur = m[1].toUpperCase(); out[cur] ??= []; continue; }
    if (!cur) continue;
    out[cur].push(line.split(/\s+/));
  }
  return out;
}

const text = readFileSync(INP, "utf8");
const S = parseInp(text);
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// [OPTIONS] — flow units decide the whole file's unit system; headloss decides the roughness meaning.
let flowUnit = "GPM", headlossFormula = "H-W";
for (const t of S.OPTIONS ?? []) {
  const k = t[0].toUpperCase();
  if (k === "UNITS") flowUnit = (t[1] ?? "GPM").toUpperCase();
  if (k === "HEADLOSS") headlossFormula = (t[1] ?? "H-W").toUpperCase();
}
const usUnits = US_FLOW.has(flowUnit);
const qToLps = FLOW_TO_LPS[flowUnit] ?? 1;
const lenToM = usUnits ? FT : 1;      // [PIPES] Length / elevations / heads
const diaToMm = usUnits ? INCH : 1;   // [PIPES] Diameter (US: inches, SI: mm already)
const isHW = headlossFormula.startsWith("H");

// [COORDINATES]
const coord = new Map();
for (const t of S.COORDINATES ?? []) coord.set(t[0], { x: num(t[1]), y: num(t[2]) });

// Nodes
/** @type {Map<string,{id:string,kind:'junction'|'reservoir'|'tank',elev:number,demand:number,head:number,tank?:object}>} */
const nodes = new Map();
for (const t of S.JUNCTIONS ?? []) {
  nodes.set(t[0], { id: t[0], kind: "junction", elev: num(t[1]) * lenToM, demand: num(t[2]) * qToLps, head: 0 });
}
for (const t of S.RESERVOIRS ?? []) {
  const h = num(t[1]) * lenToM;
  nodes.set(t[0], { id: t[0], kind: "reservoir", elev: h, demand: 0, head: h });
}
for (const t of S.TANKS ?? []) {
  const elev = num(t[1]) * lenToM, init = num(t[2]) * lenToM;
  nodes.set(t[0], {
    id: t[0], kind: "tank", elev, demand: 0, head: elev + init,
    tank: { elev, init, min: num(t[3]) * lenToM, max: num(t[4]) * lenToM, dia: num(t[5]) * lenToM },
  });
}

// [DEMANDS] — additive categories on top of the [JUNCTIONS] base demand.
for (const t of S.DEMANDS ?? []) {
  const n = nodes.get(t[0]);
  if (n) n.demand += num(t[1]) * qToLps;
}

// Links. Pumps and valves are READ and reported, but they are not pipes and the solver has no
// role for either, so they are excluded from the hydraulic graph rather than silently mis-modelled.
const pipes = [];
for (const t of S.PIPES ?? []) {
  const status = (t[7] ?? "Open").toUpperCase();
  pipes.push({
    id: t[0], a: t[1], b: t[2],
    length: num(t[3]) * lenToM,
    dia: num(t[4]) * diaToMm,
    rough: num(t[5], isHW ? 130 : 0.05),
    minor: num(t[6], 0),
    closed: status === "CLOSED",
  });
}
const pumps = (S.PUMPS ?? []).map((t) => ({ id: t[0], a: t[1], b: t[2] }));
const valves = (S.VALVES ?? []).map((t) => ({ id: t[0], a: t[1], b: t[2] }));

const used = pipes.filter((p) => !p.closed && nodes.has(p.a) && nodes.has(p.b) && p.a !== p.b);
const skipped = pipes.length - used.length;

// Only nodes a live pipe touches reach the canvas.
const touched = new Set(used.flatMap((p) => [p.a, p.b]));
const liveNodes = [...nodes.values()].filter((n) => touched.has(n.id));

// ── Geometry ──────────────────────────────────────────────────────────────────
// EPANET's y runs UP, the canvas's y runs DOWN, so y is flipped about the map's own top edge and
// the drawing keeps the orientation the .inp was laid out in.
const xs = liveNodes.map((n) => coord.get(n.id)?.x ?? 0);
const ys = liveNodes.map((n) => coord.get(n.id)?.y ?? 0);
const minX = Math.min(...xs), maxY = Math.max(...ys);
const PAD = 4; // map units of margin
const px = (n) => {
  const c = coord.get(n.id) ?? { x: 0, y: 0 };
  return {
    x: +(((c.x - minX) * MAPSCALE + PAD) * PPM).toFixed(4),
    y: +(((maxY - c.y) * MAPSCALE + PAD) * PPM).toFixed(4),
  };
};
const pt = new Map(liveNodes.map((n) => [n.id, px(n)]));

const wallId = (p) => `pipe_${p.id}`;

// Stable keys, exactly as planFormat.ts builds them: every `<segmentId>:<start|end>` meeting at the
// node, sorted, joined with "|".
const ends = new Map();
for (const p of used) {
  (ends.get(p.a) ?? ends.set(p.a, []).get(p.a)).push(`${wallId(p)}:start`);
  (ends.get(p.b) ?? ends.set(p.b, []).get(p.b)).push(`${wallId(p)}:end`);
}
const stable = new Map([...ends].map(([id, toks]) => [id, toks.slice().sort().join("|")]));

// ── Objects ───────────────────────────────────────────────────────────────────
const OBJ = {
  pipe: { id: "pipe-with-math", path: "Objects/Hydraulics/pipe.json" },
  junction: { id: "junction-with-math", path: "Objects/Hydraulics/junction.json" },
  reservoir: { id: "reservoir-with-math", path: "Objects/Hydraulics/reservoir.json" },
  tank: { id: "tank-with-math", path: "Objects/Hydraulics/tank.json" },
};
const r4 = (v) => +Number(v).toFixed(4);

// ── Segments ──────────────────────────────────────────────────────────────────
const segments = used.map((p) => {
  const A = pt.get(p.a), B = pt.get(p.b);
  const drawnM = Math.hypot(B.x - A.x, B.y - A.y) / PPM;
  return {
    id: wallId(p),
    fromNodeId: p.a, toNodeId: p.b, // placeholders, rewritten below against the node table
    layer: "pipes",
    start: A, end: B,
    thickness: Math.max(2, r4((p.dia / 1000) * PPM)),
    color: "#0e7490",
    segmentType: "pipe",
    bufferStyle: "flat",
    label: p.id,
    attachments: [{
      id: `att_pipe_${p.id}`,
      objectId: OBJ.pipe.id,
      objectPath: OBJ.pipe.path,
      t: 0.5,
      params: {
        diameter: r4(p.dia),
        wallThk: 6,
        formula: isHW ? "Hazen-Williams" : "Darcy-Weisbach",
        roughC: isHW ? r4(p.rough) : 130,
        roughMM: isHW ? 0.05 : r4(p.rough),
        minorLoss: r4(p.minor),
        spanMode: "Fill segment",
        ownLength: r4(drawnM),
        lengthOverride: r4(p.length),
        invert: 0,
        flow: 0, headA: 0, headB: 0, // written back by the flow after the solve
      },
    }],
  };
});

// ── Nodes ─────────────────────────────────────────────────────────────────────
const planNodes = liveNodes.map((n) => {
  const P = pt.get(n.id);
  const key = stable.get(n.id);
  const kind = n.kind;
  const params = kind === "junction"
    ? { elevation: r4(n.elev), demand: r4(n.demand), head: 0, minPressure: 15, markerSize: 1.2, showGrade: true, gradeScale: 0.05 }
    : kind === "reservoir"
      ? { totalHead: r4(n.head), baseElevation: r4(n.elev - 5), planSize: 6, supply: 0, bankThk: 0.6 }
      : {
          bottomElevation: r4(n.tank.elev), initLevel: r4(n.tank.init), minLevel: r4(n.tank.min),
          maxLevel: r4(n.tank.max), tankDiameter: r4(n.tank.dia), netInflow: 0, wallThk: 0.25,
        };
  return {
    id: n.id, x: P.x, y: P.y, layer: "pipes",
    label: n.id, showLabel: true, type: "point",
    attachments: [{ id: `att_${kind}_${n.id}`, objectId: OBJ[kind].id, objectPath: OBJ[kind].path, t: 0, params }],
    _key: key, _kind: kind,
  };
});

// ── graphAttrs — the solver's inputs, bound by ROLE in the schema ─────────────
const gaNodes = {}, gaSegments = {};
for (const n of liveNodes) {
  const key = stable.get(n.id);
  const fixed = n.kind === "reservoir" || n.kind === "tank";
  gaNodes[key] = {
    elevation: r4(n.elev),
    demand: r4(n.demand),
    fixedHead: fixed,
    head: fixed ? r4(n.head) : 0,
    "node-kind": n.kind,
    "node-label": n.id,
  };
}
for (const p of used) {
  gaSegments[wallId(p)] = {
    diameter: r4(p.dia),
    roughness: r4(p.rough),
    minorLoss: r4(p.minor),
    length: r4(p.length),
    "seg-label": p.id,
  };
}

// ── The plan ──────────────────────────────────────────────────────────────────
// The standard format names NODES by id and segments by `fromNodeId`/`toNodeId`; positions live in
// exactly one place. Our node ids are the EPANET ids, which is what makes the file readable.
const plan = {
  schemaVersion: 1,
  settings: {
    library_path: LIBRARY,
    units: "m",
    northbearing: 0,
    pixelsPerMeter: PPM,
    keywords: `EPANET, pipe network, ${flowUnit}, ${headlossFormula}`,
    epanet: {
      source: INP.replace(/\\/g, "/").split("/").pop(),
      flowUnits: flowUnit,
      headloss: headlossFormula,
      converted: "tools/epanet/inp2canvas.mjs",
      mapUnitsPerMetre: MAPSCALE,
      note: "Map coordinates are a SCHEMATIC. True pipe lengths ride in graphAttrs.segments[].length (role `length`) and in each Pipe object's lengthOverride.",
    },
  },
  nodes: planNodes.map(({ _key, _kind, ...n }) => n),
  segments: segments.map(({ start, end, ...s }) => s),
  spaces: [],
  layers: [
    { id: "0", name: "0", color: "#94a3b8", visible: true, locked: false, order: 0 },
    { id: "pipes", name: "Pipe network", color: "#0e7490", visible: true, locked: false, order: 1 },
  ],
  imageUnderlay: null,
  customSegmentTypes: {
    pipe: { id: "pipe", displayName: "Pipe", fill: "#0e7490", params: [] },
  },
  graphAttrs: { nodes: gaNodes, segments: gaSegments },
};

// ── GGA matrices for the Math Engine route ────────────────────────────────────
// Junction order = the unknown-head nodes in file order; pipe order = [PIPES] order.
const junc = liveNodes.filter((n) => n.kind === "junction").map((n) => n.id);
const fixed = liveNodes.filter((n) => n.kind !== "junction").map((n) => n.id);
const jIdx = new Map(junc.map((id, i) => [id, i]));
const fIdx = new Map(fixed.map((id, i) => [id, i]));

const zeros = (r, c) => Array.from({ length: r }, () => new Array(c).fill(0));
const A12 = zeros(used.length, junc.length);
const A10 = zeros(used.length, fixed.length);
used.forEach((p, i) => {
  // Energy: A11 Q + A12 H + A10 H0 = 0  =>  -1 at the from-node, +1 at the to-node.
  const set = (id, v) => {
    if (jIdx.has(id)) A12[i][jIdx.get(id)] = v;
    else if (fIdx.has(id)) A10[i][fIdx.get(id)] = v;
  };
  set(p.a, -1);
  set(p.b, 1);
});
const dM = (p) => Math.max(0.005, p.dia / 1000);
const rVec = used.map((p) => {
  const d = dM(p);
  const L = Math.max(0.01, p.length);
  if (isHW) return [10.667 * L / (Math.pow(Math.max(1, p.rough), 1.852) * Math.pow(d, 4.871))];
  // Darcy: r is Q-dependent; the Math Engine takes a constant r, so a fully-rough f is used.
  const eps = Math.max(1e-9, p.rough / 1000);
  const f = 0.25 / Math.pow(Math.log10(eps / (3.7 * d)), 2);
  return [8 * f * L / (Math.PI * Math.PI * 9.81 * Math.pow(d, 5))];
});
const gga = {
  note: "Todini-Pilati GGA operands for the Math Engine flow. Q and q are m3/s, heads m, r in SI so that h = r * Q^n.",
  order: { pipes: used.map((p) => p.id), junctions: junc, fixedNodes: fixed },
  nExp: isHW ? 1.852 : 2,
  A12, A10,
  H0: fixed.map((id) => [r4(nodes.get(id).head)]),
  r: rVec.map(([v]) => [+v.toPrecision(10)]),
  q: junc.map((id) => [+(nodes.get(id).demand / 1000).toPrecision(10)]),
  Q0: used.map((p) => [+(Math.PI * dM(p) * dM(p) / 4 * 0.3).toPrecision(10)]),
  Hj0: junc.map((id) => [r4(nodes.get(id).elev)]),
};

// ── Write ─────────────────────────────────────────────────────────────────────
writeFileSync(OUT, JSON.stringify(plan, null, 1) + "\n", "utf8");
const ggaOut = OUT.replace(/\.json$/, "") + ".gga.json";
writeFileSync(ggaOut, JSON.stringify(gga, null, 1) + "\n", "utf8");

const kinds = { junction: 0, reservoir: 0, tank: 0 };
for (const n of liveNodes) kinds[n.kind]++;
console.log(`${INP}  [${flowUnit} / ${headlossFormula}]${usUnits ? " -> SI" : ""}`);
console.log(`  nodes      ${liveNodes.length}  (${kinds.junction} junction, ${kinds.reservoir} reservoir, ${kinds.tank} tank)`);
console.log(`  segments   ${used.length}${skipped ? `  (${skipped} pipe(s) skipped: closed or dangling)` : ""}`);
if (pumps.length) console.log(`  pumps      ${pumps.length} NOT converted - the solver has no pump role (${pumps.map((p) => p.id).join(", ")})`);
if (valves.length) console.log(`  valves     ${valves.length} NOT converted - the solver has no valve role (${valves.map((v) => v.id).join(", ")})`);
console.log(`  GGA        ${used.length} pipes x ${junc.length} junctions, ${fixed.length} fixed head(s), n = ${gga.nExp}`);
console.log(`  -> ${OUT}`);
console.log(`  -> ${ggaOut}`);
