/**
 * Standalone validator for the Rule Book → JSON pipeline.
 *
 * Builds a synthetic 8-room floorplan, runs computeRegionSemantics on every
 * room, evaluates the rulebook, and prints a table of classifications plus
 * any anomalies (rooms that matched no rule, likely-wrong classifications).
 *
 * Run with: npx tsx scripts/test-rulebook.ts
 *
 * The geometry helpers and computeRegionSemantics are duplicated from
 * FloorPlanEditor.tsx so the test runs without bundling the editor. Keep in
 * sync manually until the function is extracted to a shared module.
 */

type Point = { x: number; y: number };
type Wall = {
  id: string;
  start: Point;
  end: Point;
  segmentType?: "wall" | "door" | "window" | "plot-boundary";
  category?: string;
};
type Room = {
  id: string;
  points: Point[];
  region?: string;
  label?: string;
  roomType?: string;
};

// ─── Geometry helpers (duplicated from FloorPlanEditor.tsx) ────────────────

const pointToSegDistPx = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  if (L2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

const segToSegMinDistPx = (a1: Point, a2: Point, b1: Point, b2: Point): number =>
  Math.min(
    pointToSegDistPx(a1, b1, b2),
    pointToSegDistPx(a2, b1, b2),
    pointToSegDistPx(b1, a1, a2),
    pointToSegDistPx(b2, a1, a2),
  );

const pointToPolygonDistPx = (p: Point, poly: Point[]): number => {
  if (poly.length === 0) return Infinity;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, pointToSegDistPx(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
};

const polygonToPolygonDistPx = (a: Point[], b: Point[]): number => {
  if (a.length === 0 || b.length === 0) return Infinity;
  let d = Infinity;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i], aj = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      d = Math.min(d, segToSegMinDistPx(ai, aj, b[j], b[(j + 1) % b.length]));
      if (d === 0) return 0;
    }
  }
  return d;
};

const classifyCardinal = (nx: number, ny: number): "N" | "E" | "S" | "W" => {
  const ang = Math.atan2(nx, -ny);
  const deg = ((ang * 180) / Math.PI + 360) % 360;
  if (deg >= 315 || deg < 45) return "N";
  if (deg < 135) return "E";
  if (deg < 225) return "S";
  return "W";
};

interface RegionSemantics {
  facades: Array<"N" | "E" | "S" | "W">;
  facadeCount: number;
  isPerimeter: boolean;
  isInterior: boolean;
  isCorner: boolean;
  nearCore: boolean;
  nearEntry: boolean;
  nearStair: boolean;
  nearCorridor: boolean;
  areaM2: number;
  depthM: number;
  aspectRatio: number;
}

const computeRegionSemantics = (
  room: { points: Point[]; region?: string; label?: string },
  walls: Wall[],
  rooms: Room[],
  pixelsPerMeter: number,
): RegionSemantics => {
  const ppm = Math.max(1e-6, pixelsPerMeter);
  const mToPx = (m: number) => m * ppm;
  const pts = room.points;
  const N = pts.length;

  let signed = 0;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    signed += a.x * b.y - b.x * a.y;
  }
  const cx = pts.reduce((s, p) => s + p.x, 0) / Math.max(1, N);
  const cy = pts.reduce((s, p) => s + p.y, 0) / Math.max(1, N);

  const TOL_FACADE_PX = mToPx(0.5);
  const facadeWalls = walls.filter((w) => w.segmentType === "plot-boundary" || w.category === "Facade");
  const facadeSet = new Set<"N" | "E" | "S" | "W">();
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const edgeMid: Point = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const nearFacade = facadeWalls.some((w) =>
      pointToSegDistPx(edgeMid, w.start, w.end) < TOL_FACADE_PX
    );
    if (!nearFacade) continue;
    const ex = b.x - a.x, ey = b.y - a.y;
    const len = Math.hypot(ex, ey) || 1;
    let nx = -ey / len, ny = ex / len;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    if ((cx - mx) * nx + (cy - my) * ny > 0) { nx = -nx; ny = -ny; }
    facadeSet.add(classifyCardinal(nx, ny));
  }
  const facades = Array.from(facadeSet).sort() as Array<"N" | "E" | "S" | "W">;
  const facadeCount = facades.length;

  const isPerimeter = facadeCount >= 1;
  const isInterior = facadeCount === 0;
  const isCorner = facadeCount >= 2;

  const TOL_CORE_PX = mToPx(1.5);
  const TOL_STAIR_PX = mToPx(2.0);
  const TOL_CORRIDOR_PX = mToPx(0.5);
  const selfIsCore = room.region === "Core";
  const selfIsStair = room.region === "Staircase";
  const selfIsCorridor = room.region === "Corridor" || room.label === "Corridor";
  let nearCore = false, nearStair = false, nearCorridor = false;
  for (const r of rooms) {
    if (r.points === pts) continue;
    const d = polygonToPolygonDistPx(pts, r.points);
    if (!selfIsCore && !nearCore && r.region === "Core" && d < TOL_CORE_PX) nearCore = true;
    if (!selfIsStair && !nearStair && r.region === "Staircase" && d < TOL_STAIR_PX) nearStair = true;
    if (!selfIsCorridor && !nearCorridor && (r.region === "Corridor" || r.label === "Corridor") && d < TOL_CORRIDOR_PX) nearCorridor = true;
    if ((selfIsCore || nearCore) && (selfIsStair || nearStair) && (selfIsCorridor || nearCorridor)) break;
  }

  const TOL_ENTRY_PX = mToPx(3.0);
  let nearEntry = false;
  for (const w of walls) {
    if (w.segmentType !== "door") continue;
    const mx = (w.start.x + w.end.x) / 2, my = (w.start.y + w.end.y) / 2;
    if (pointToPolygonDistPx({ x: mx, y: my }, pts) < TOL_ENTRY_PX) { nearEntry = true; break; }
  }

  const areaPx = Math.abs(signed) / 2;
  const areaM2 = areaPx / (ppm * ppm);

  let bestW = 0, bestH = 0, bestArea = Infinity;
  for (let i = 0; i < N; i++) {
    const a = pts[i], b = pts[(i + 1) % N];
    const ex = b.x - a.x, ey = b.y - a.y;
    const L = Math.hypot(ex, ey); if (L < 1e-6) continue;
    const ux = ex / L, uy = ey / L;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of pts) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u; if (u > maxU) maxU = u;
      if (v < minV) minV = v; if (v > maxV) maxV = v;
    }
    const w = maxU - minU, h = maxV - minV;
    if (w * h < bestArea) { bestArea = w * h; bestW = w; bestH = h; }
  }
  const dimA = Math.max(bestW, bestH) / ppm;
  const dimB = Math.min(bestW, bestH) / ppm;
  const aspectRatio = dimB > 1e-6 ? dimA / dimB : Infinity;

  let maxDepthPx = 0;
  if (facadeWalls.length > 0) {
    for (const p of pts) {
      let minDist = Infinity;
      for (const w of facadeWalls) {
        const d = pointToSegDistPx(p, w.start, w.end);
        if (d < minDist) minDist = d;
      }
      if (minDist > maxDepthPx) maxDepthPx = minDist;
    }
  }
  const depthM = maxDepthPx / ppm;

  return { facades, facadeCount, isPerimeter, isInterior, isCorner, nearCore, nearEntry, nearStair, nearCorridor, areaM2, depthM, aspectRatio };
};

// ─── Synthetic test floorplan ─────────────────────────────────────────────

const PPM = 40; // pixels per metre

// Building bounding box: 20m × 12m.
const BOX_W_M = 20;
const BOX_H_M = 12;

// Row grid in metres — 3 rows × 3 cols = 9 rooms, trimmed to 8 (merge bottom-left).
// Rooms laid out as:
//   ┌─────────┬───────────┬─────────┐
//   │   R1    │    R2     │ R3 Core │
//   ├─────────┼───────────┼─────────┤
//   │   R4    │ R5 (int.) │ R6 Svc  │
//   ├─────────┼───────────┴─────────┤
//   │   R7    │        R8 Svc       │
//   └─────────┴─────────────────────┘

const mkRoom = (id: string, xm: number, ym: number, wm: number, hm: number,
                opts: { region?: string; label?: string } = {}): Room => ({
  id,
  points: [
    { x: xm * PPM,         y: ym * PPM },
    { x: (xm + wm) * PPM,  y: ym * PPM },
    { x: (xm + wm) * PPM,  y: (ym + hm) * PPM },
    { x: xm * PPM,         y: (ym + hm) * PPM },
  ],
  roomType: "room",
  ...opts,
});

const rooms: Room[] = [
  mkRoom("R1", 0,  0, 7,  4),
  mkRoom("R2", 7,  0, 7,  4),
  mkRoom("R3", 14, 0, 6,  4, { region: "Core" }),
  mkRoom("R4", 0,  4, 7,  4),
  mkRoom("R5", 7,  4, 7,  4, { label: "Medium Interior" }),
  mkRoom("R6", 14, 4, 6,  4, { region: "Service" }),
  mkRoom("R7", 0,  8, 7,  4),
  mkRoom("R8", 7,  8, 13, 4, { region: "Service" }),
];

// Outer walls marked as plot-boundary (facade). Four segments around the full box.
const facadeWalls: Wall[] = [
  { id: "F-N", start: { x: 0, y: 0 },                           end: { x: BOX_W_M * PPM, y: 0 }, segmentType: "plot-boundary" },
  { id: "F-E", start: { x: BOX_W_M * PPM, y: 0 },               end: { x: BOX_W_M * PPM, y: BOX_H_M * PPM }, segmentType: "plot-boundary" },
  { id: "F-S", start: { x: BOX_W_M * PPM, y: BOX_H_M * PPM },   end: { x: 0, y: BOX_H_M * PPM }, segmentType: "plot-boundary" },
  { id: "F-W", start: { x: 0, y: BOX_H_M * PPM },               end: { x: 0, y: 0 }, segmentType: "plot-boundary" },
];

// ─── Rulebook (user's sample, verbatim) ────────────────────────────────────

const rulebook = {
  schema: "rulebook/v1",
  rules: [
    { id: "RZ-01", label: "Service",         when: { nearCore: true } },
    { id: "RZ-02", label: "Service",         when: { nearCore: false, facadeCount: 0, areaM2: { lt: 15 } } },
    { id: "RZ-03", label: "Medium Interior", when: { nearCore: false, facadeCount: 0, areaM2: { gte: 15, lt: 60 } } },
    { id: "RZ-04", action: "split", labels: ["Medium Interior", "Large Interior"],
      when: { nearCore: false, facadeCount: 0, areaM2: { gte: 60 } } },
    { id: "RZ-05", label: "Large Facade",    when: { nearCore: false, facadeCount: { gte: 2 }, areaM2: { gte: 60 } } },
    { id: "RZ-06", label: "Medium Facade",   when: { nearCore: false, facadeCount: { gte: 2 }, areaM2: { gte: 15, lt: 60 } } },
    { id: "RZ-07", label: "Small Facade",    when: { nearCore: false, facadeCount: { gte: 2 }, areaM2: { lt: 15 } } },
    { id: "RZ-08", label: "Large Facade",    when: { nearCore: false, facadeCount: 1, depthM: { lte: 8 }, areaM2: { gte: 100 } } },
    { id: "RZ-09", label: "Medium Facade",   when: { nearCore: false, facadeCount: 1, depthM: { lte: 8 }, areaM2: { gte: 20, lt: 100 } } },
    { id: "RZ-10", label: "Small Facade",    when: { nearCore: false, facadeCount: 1, depthM: { lte: 8 }, areaM2: { lt: 20 } } },
    { id: "RZ-11", action: "split", labels: ["Large Facade", "Medium Interior"],
      when: { nearCore: false, facadeCount: 1, depthM: { gt: 8 }, areaM2: { gte: 60 } } },
    { id: "RZ-12", label: "Medium Facade",   when: { nearCore: false, facadeCount: 1, depthM: { gt: 8 }, areaM2: { lt: 60 } } },
  ],
};

// ─── Rule evaluator ────────────────────────────────────────────────────────

type RuleWhen = Record<string, unknown>;
const matchesWhen = (when: RuleWhen | undefined, facts: Record<string, unknown>): boolean => {
  if (!when) return true;
  for (const [key, expected] of Object.entries(when)) {
    const actual = facts[key];
    if (expected !== null && typeof expected === "object" && !Array.isArray(expected)) {
      const cmp = expected as Record<string, unknown>;
      if (typeof actual !== "number") return false;
      if (typeof cmp.lt  === "number" && !(actual <  cmp.lt)) return false;
      if (typeof cmp.lte === "number" && !(actual <= cmp.lte)) return false;
      if (typeof cmp.gt  === "number" && !(actual >  cmp.gt)) return false;
      if (typeof cmp.gte === "number" && !(actual >= cmp.gte)) return false;
      if (typeof cmp.eq  === "number" && actual !== cmp.eq) return false;
      if (typeof cmp.ne  === "number" && actual === cmp.ne) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
};

// ─── Run the pipeline ──────────────────────────────────────────────────────

console.log("━".repeat(110));
console.log("RULE BOOK VALIDATION — synthetic 8-room floorplan");
console.log("━".repeat(110));
console.log();

const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);

console.log(
  pad("ID",  4) + " | " +
  pad("region",  10) + " | " +
  pad("label",  18) + " | " +
  pad("facades", 9) + " | " +
  pad("area m²", 8) + " | " +
  pad("depth m", 8) + " | " +
  pad("nearCore", 9) + " | " +
  pad("rule", 6) + " | " +
  "assigned label / action"
);
console.log("─".repeat(110));

let unmatched = 0;
const perRule: Record<string, number> = {};
const issues: string[] = [];

for (const r of rooms) {
  const sem = computeRegionSemantics(r, facadeWalls, rooms, PPM);
  const facts = {
    nearCore: sem.nearCore,
    nearEntry: sem.nearEntry,
    nearStair: sem.nearStair,
    nearCorridor: sem.nearCorridor,
    facadeCount: sem.facadeCount,
    isPerimeter: sem.isPerimeter,
    isInterior: sem.isInterior,
    isCorner: sem.isCorner,
    areaM2: sem.areaM2,
    depthM: sem.depthM,
    aspectRatio: sem.aspectRatio,
  };
  const matched = rulebook.rules.find((rule) => matchesWhen(rule.when as RuleWhen, facts));
  const ruleId = matched?.id ?? "—";
  perRule[ruleId] = (perRule[ruleId] ?? 0) + 1;
  if (!matched) unmatched += 1;

  let outcome = "(no match)";
  if (matched) {
    if ((matched as { action?: string }).action === "split") {
      outcome = `SPLIT → ${(matched as { labels: string[] }).labels.join(" + ")}`;
    } else if ((matched as { label?: string }).label) {
      outcome = (matched as { label: string }).label;
    }
  }

  console.log(
    pad(r.id, 4) + " | " +
    pad(r.region ?? "—", 10) + " | " +
    pad(r.label ?? "—", 18) + " | " +
    pad(`[${sem.facades.join(",")}](${sem.facadeCount})`, 9) + " | " +
    pad(sem.areaM2.toFixed(1), 8) + " | " +
    pad(sem.depthM.toFixed(2), 8) + " | " +
    pad(sem.nearCore.toString(), 9) + " | " +
    pad(ruleId, 6) + " | " +
    outcome
  );

  // Anomaly checks:
  if (r.region === "Core" && ruleId !== "RZ-01") {
    issues.push(`⚠️  ${r.id} has region=Core but matched ${ruleId} — rulebook has no explicit "room IS Core" rule; only "nearCore" (which is false for self). Consider adding a rule like { region: "Core" } → Service.`);
  }
  if (r.region === "Service" && !(matched as { label?: string })?.label?.startsWith("Service") && ruleId !== "RZ-01") {
    issues.push(`ℹ️   ${r.id} has region=Service but rulebook classified it as ${outcome} (not Service). The rulebook ignores the room's existing region unless it's Core.`);
  }
}

console.log("─".repeat(110));
console.log();
console.log(`Summary: ${rooms.length} rooms, ${rooms.length - unmatched} matched, ${unmatched} unmatched`);
console.log(`Per-rule: ${Object.entries(perRule).map(([k, v]) => `${k}×${v}`).join(", ")}`);
console.log();

if (issues.length > 0) {
  console.log("Anomalies:");
  for (const i of issues) console.log("  " + i);
  console.log();
}

console.log("Interpretation tips:");
console.log("  • depth = max distance from any vertex of the room to the nearest facade wall anywhere in the building");
console.log("  • nearCore is FALSE for rooms that ARE region=Core (self-exclusion)");
console.log("  • A room with region=Service sitting away from any Core will fall through to facade/interior rules");
console.log();
console.log("Done.");
