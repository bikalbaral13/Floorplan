/** Shared metrics + condition evaluation for the Flow "Conditional" (gate) node.
 *
 *  A Conditional node reads its input space's geometry, derives a set of metrics (area, perimeter,
 *  …), and tests one of them against a value. The SAME logic backs both the live preview
 *  (evalConditional in eval/evalNodes.ts) and the committed recipe op (the "conditional" handler in
 *  FloorPlanEditor), so what you see routed in the canvas is what Run Flow executes. */
import type { Point } from "../types";
import { polygonArea } from "../algorithms/geometry/polygon";

export type ConditionMetric = "area" | "perimeter" | "vertices" | "width" | "height" | "aspect";
export type ConditionOp = "gt" | "gte" | "eq" | "lte" | "lt" | "ne";

export interface SpaceMetrics {
  /** Enclosed area in m². */
  area: number;
  /** Boundary length in m. */
  perimeter: number;
  /** Vertex count. */
  vertices: number;
  /** Axis-aligned bounding-box width in m. */
  width: number;
  /** Axis-aligned bounding-box height in m. */
  height: number;
  /** Longer bbox side ÷ shorter bbox side (≥ 1; 0 for a degenerate shape). */
  aspect: number;
}

/** Metric dropdown options (label carries the unit so the node reads naturally). */
export const CONDITION_METRIC_OPTIONS: { value: ConditionMetric; label: string }[] = [
  { value: "area", label: "Area (m²)" },
  { value: "perimeter", label: "Perimeter (m)" },
  { value: "vertices", label: "Vertices" },
  { value: "width", label: "Width (m)" },
  { value: "height", label: "Height (m)" },
  { value: "aspect", label: "Aspect ratio" },
];

/** Comparison-operator dropdown options. */
export const CONDITION_OP_OPTIONS: { value: ConditionOp; label: string }[] = [
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "eq", label: "= equals" },
  { value: "lte", label: "≤ at most" },
  { value: "lt", label: "< less than" },
  { value: "ne", label: "≠ not equal" },
];

/** Short symbol for a UI badge (e.g. "area > 30"). */
export const conditionOpSymbol = (op: ConditionOp): string =>
  ({ gt: ">", gte: "≥", eq: "=", lte: "≤", lt: "<", ne: "≠" }[op] ?? ">");

/** Derive all supported metrics from a polygon (pixel coords) given pixels-per-metre. */
export const computeSpaceMetrics = (pts: Point[], ppm: number): SpaceMetrics => {
  const safePpm = ppm > 0 ? ppm : 1;
  if (pts.length < 3) return { area: 0, perimeter: 0, vertices: pts.length, width: 0, height: 0, aspect: 0 };
  const areaPx2 = polygonArea(pts); // already absolute
  let perimPx = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    perimPx += Math.hypot(b.x - a.x, b.y - a.y);
    if (a.x < minX) minX = a.x;
    if (a.y < minY) minY = a.y;
    if (a.x > maxX) maxX = a.x;
    if (a.y > maxY) maxY = a.y;
  }
  const width = (maxX - minX) / safePpm;
  const height = (maxY - minY) / safePpm;
  const long = Math.max(width, height), short = Math.min(width, height);
  return {
    area: areaPx2 / (safePpm * safePpm),
    perimeter: perimPx / safePpm,
    vertices: pts.length,
    width,
    height,
    aspect: short > 1e-9 ? long / short : 0,
  };
};

const asMetric = (v: unknown): ConditionMetric =>
  (typeof v === "string" && ["area", "perimeter", "vertices", "width", "height", "aspect"].includes(v))
    ? (v as ConditionMetric)
    : "area";
const asOp = (v: unknown): ConditionOp =>
  (typeof v === "string" && ["gt", "gte", "eq", "lte", "lt", "ne"].includes(v)) ? (v as ConditionOp) : "gt";

/** The live value of the chosen metric for a polygon — used for the node's status badge. */
export const conditionMetricValue = (pts: Point[], ppm: number, params: Record<string, unknown>): number =>
  computeSpaceMetrics(pts, ppm)[asMetric(params.metric)];

/** Evaluate the node's condition against a polygon → does it route to the TRUE output?
 *  `=` / `≠` use a small tolerance (max(0.5, 1% of the value)) so floating-point areas/lengths can
 *  realistically match an integer target; `vertices` (always integral) effectively compares exactly. */
export const evaluateSpaceCondition = (pts: Point[], ppm: number, params: Record<string, unknown>): boolean => {
  if (pts.length < 3) return false;
  const lhs = conditionMetricValue(pts, ppm, params);
  const op = asOp(params.op);
  const value = typeof params.value === "number" && isFinite(params.value) ? params.value : 0;
  const tol = Math.max(0.5, Math.abs(value) * 0.01);
  switch (op) {
    case "gt": return lhs > value;
    case "gte": return lhs >= value;
    case "lt": return lhs < value;
    case "lte": return lhs <= value;
    case "eq": return Math.abs(lhs - value) <= tol;
    case "ne": return Math.abs(lhs - value) > tol;
    default: return false;
  }
};
