import type { Point } from "../../types";

export type ShapeName =
  | "Rectangle"
  | "L-shape"
  | "T-shape"
  | "U-shape"
  | "C-shape"
  | "S-shape"
  | "Z-shape"
  | "E-shape"
  | "F-shape"
  | "H-shape"
  | "I-shape"
  | "Plus"
  | "Staircase"
  | "T-notch";

export const RECTILINEAR_PRESETS: Record<ShapeName, Point[]> = {
  "Rectangle": [{x:0,y:0},{x:4,y:0},{x:4,y:3},{x:0,y:3}],
  "L-shape":   [{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}],
  "T-shape":   [{x:0,y:0},{x:6,y:0},{x:6,y:2},{x:4,y:2},{x:4,y:4},{x:2,y:4},{x:2,y:2},{x:0,y:2}],
  "U-shape":   [{x:0,y:0},{x:6,y:0},{x:6,y:4},{x:4,y:4},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}],
  "C-shape":   [{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:4,y:4},{x:4,y:6},{x:0,y:6}],
  "S-shape":   [{x:2,y:0},{x:4,y:0},{x:4,y:2},{x:6,y:2},{x:6,y:4},{x:4,y:4},{x:4,y:6},{x:2,y:6},{x:2,y:4},{x:0,y:4},{x:0,y:2},{x:2,y:2}],
  "Z-shape":   [{x:0,y:0},{x:4,y:0},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:6,y:4},{x:6,y:6},{x:2,y:6},{x:2,y:4},{x:0,y:4}],
  "E-shape":   [{x:0,y:0},{x:4,y:0},{x:4,y:1},{x:1,y:1},{x:1,y:2},{x:3,y:2},{x:3,y:3},{x:1,y:3},{x:1,y:4},{x:4,y:4},{x:4,y:5},{x:0,y:5}],
  "F-shape":   [{x:0,y:0},{x:4,y:0},{x:4,y:1},{x:1,y:1},{x:1,y:2},{x:3,y:2},{x:3,y:3},{x:1,y:3},{x:1,y:5},{x:0,y:5}],
  "H-shape":   [{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:4,y:2},{x:4,y:0},{x:6,y:0},{x:6,y:6},{x:4,y:6},{x:4,y:4},{x:2,y:4},{x:2,y:6},{x:0,y:6}],
  "I-shape":   [{x:1,y:0},{x:3,y:0},{x:3,y:2},{x:5,y:2},{x:5,y:3},{x:3,y:3},{x:3,y:5},{x:1,y:5},{x:1,y:3},{x:-1,y:3},{x:-1,y:2},{x:1,y:2}],
  "Plus":      [{x:1,y:0},{x:2,y:0},{x:2,y:1},{x:3,y:1},{x:3,y:2},{x:2,y:2},{x:2,y:3},{x:1,y:3},{x:1,y:2},{x:0,y:2},{x:0,y:1},{x:1,y:1}],
  "Staircase": [{x:0,y:0},{x:2,y:0},{x:2,y:1},{x:4,y:1},{x:4,y:2},{x:6,y:2},{x:6,y:4},{x:4,y:4},{x:4,y:3},{x:2,y:3},{x:2,y:2},{x:0,y:2}],
  "T-notch":   [{x:0,y:0},{x:6,y:0},{x:6,y:4},{x:4,y:4},{x:4,y:2},{x:2,y:2},{x:2,y:4},{x:0,y:4}],
};

export interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  w: number;
  h: number;
}

export interface VertexAngle {
  reflex: boolean;
  v: Point;
}

export interface NotchInfo {
  relX: number;
  relY: number;
  quadrant: "TR" | "BR" | "TL" | "BL";
}

export interface SymmetryInfo {
  symX: boolean;
  symY: boolean;
  both: boolean;
  label: "Both axes" | "Horizontal" | "Vertical" | "None";
}

export interface ShapeSignature {
  n: number;
  reflexCount: number;
  fillRatio: number;
  aspect: number;
  canonical: string;
  sym: SymmetryInfo;
  notches: NotchInfo[];
  normEdges: number[];
  area: number;
  bb: BBox;
  turnSeq: number[];
  hullArea: number;
}

export interface ShapeMatch {
  name: ShapeName;
  score: number;
  sig: ShapeSignature;
  pts: Point[];
}

export interface ClassificationResult {
  ruleLabel: string;
  best: ShapeMatch;
  matches: ShapeMatch[];
  confidence: number;
  signature: ShapeSignature;
  axisAligned: boolean;
}

const isCCW = (pts: Point[]): boolean => {
  let s = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    s += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  }
  return s < 0;
};

export const ensureCCW = (pts: Point[]): Point[] => (isCCW(pts) ? pts : [...pts].reverse());

export const getAngles = (pts: Point[]): VertexAngle[] => {
  const n = pts.length;
  const out: VertexAngle[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const dx1 = prev.x - cur.x;
    const dy1 = prev.y - cur.y;
    const dx2 = next.x - cur.x;
    const dy2 = next.y - cur.y;
    // Cross of v1=(prev-cur) and v2=(next-cur). For a math-CCW polygon
    // (`ensureCCW` produces this) a left turn at the corner — i.e. a CONVEX
    // angle — gives a negative cross. So reflex (interior angle > 180°) is the
    // *positive* case. The original HTML port had this inverted, producing
    // r = (n - true_r) which broke every rule-based label and every strict
    // n/r topology check, even though preset-distance matching still worked
    // because both query and preset were inverted equally.
    out.push({ reflex: dx1 * dy2 - dy1 * dx2 > 0, v: cur });
  }
  return out;
};

export const isAxisAligned = (pts: Point[]): boolean => {
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    if (pts[j].x !== pts[i].x && pts[j].y !== pts[i].y) return false;
  }
  return true;
};

const polygonAreaLocal = (pts: Point[]): number => {
  let a = 0;
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
};

export const getBBox = (pts: Point[]): BBox => {
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
};

const getTurnSeq = (pts: Point[]): number[] =>
  getAngles(pts).map(a => (a.reflex ? -1 : 1));

const canonicalTurnSeq = (seq: number[]): string => {
  const n = seq.length;
  const s = seq.concat(seq).join("");
  let best: string | null = null;
  for (let i = 0; i < n; i += 1) {
    const rot = s.slice(i, i + n);
    if (!best || rot < best) best = rot;
  }
  const reversed = [...seq].reverse();
  const rev = reversed.concat(reversed).join("");
  for (let i = 0; i < n; i += 1) {
    const rot = rev.slice(i, i + n);
    if (!best || rot < best) best = rot;
  }
  return best ?? "";
};

const getEdgeLengths = (pts: Point[]): number[] => {
  const n = pts.length;
  const out: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const j = (i + 1) % n;
    out.push(Math.abs(pts[j].x - pts[i].x) + Math.abs(pts[j].y - pts[i].y));
  }
  return out;
};

const getNotchSignature = (pts: Point[]): NotchInfo[] => {
  const n = pts.length;
  const ang = getAngles(pts);
  const bb = getBBox(pts);
  const notches: NotchInfo[] = [];
  for (let i = 0; i < n; i += 1) {
    if (!ang[i].reflex) continue;
    const v = ang[i].v;
    const relX = (v.x - bb.minX) / (bb.w || 1);
    const relY = (v.y - bb.minY) / (bb.h || 1);
    const fx = relX - 0.5;
    const fy = relY - 0.5;
    const quadrant: NotchInfo["quadrant"] =
      fx >= 0 ? (fy >= 0 ? "TR" : "BR") : fy >= 0 ? "TL" : "BL";
    notches.push({
      relX: Math.round(relX * 4) / 4,
      relY: Math.round(relY * 4) / 4,
      quadrant,
    });
  }
  return notches;
};

const checkSymmetry = (pts: Point[]): SymmetryInfo => {
  const bb = getBBox(pts);
  const cx = (bb.minX + bb.maxX) / 2;
  const cy = (bb.minY + bb.maxY) / 2;
  const has = (x: number, y: number) =>
    pts.some(p => Math.abs(p.x - x) < 0.01 && Math.abs(p.y - y) < 0.01);
  const symX = pts.every(p => has(2 * cx - p.x, p.y));
  const symY = pts.every(p => has(p.x, 2 * cy - p.y));
  const label: SymmetryInfo["label"] =
    symX && symY ? "Both axes" : symX ? "Horizontal" : symY ? "Vertical" : "None";
  return { symX, symY, both: symX && symY, label };
};

const getConvexHullArea = (pts: Point[]): number => {
  const n = pts.length;
  if (n < 3) return 0;
  const sorted = [...pts].sort((a, b) => (a.x !== b.x ? a.x - b.x : a.y - b.y));
  const upper: Point[] = [];
  const lower: Point[] = [];
  for (const p of sorted) {
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) <= 0) upper.pop();
      else break;
    }
    upper.push(p);
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0) lower.pop();
      else break;
    }
    lower.push(p);
  }
  const hull = [...upper, ...lower.slice(1, -1)];
  return polygonAreaLocal(hull);
};

export const computeShapeSignature = (rawPts: Point[]): ShapeSignature => {
  const ordered = ensureCCW(rawPts);
  const ang = getAngles(ordered);
  const reflexCount = ang.filter(a => a.reflex).length;
  const n = ordered.length;
  const bb = getBBox(ordered);
  const area = polygonAreaLocal(ordered);
  const hullArea = getConvexHullArea(ordered);
  const fillRatio = area / (hullArea || 1);
  const aspect = bb.w / (bb.h || 1);
  const turnSeq = getTurnSeq(ordered);
  const canonical = canonicalTurnSeq(turnSeq);
  const sym = checkSymmetry(ordered);
  const notches = getNotchSignature(ordered);
  const edgeLens = getEdgeLengths(ordered);
  const maxEdge = Math.max(...edgeLens) || 1;
  const normEdges = edgeLens.map(e => Math.round((e / maxEdge) * 4) / 4);
  return { n, reflexCount, fillRatio, aspect, canonical, sym, notches, normEdges, area, bb, turnSeq, hullArea };
};

const turnSeqDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (la !== lb) return 1 + Math.abs(la - lb) * 0.1;
  const bb2 = b + b;
  const brev = b.split("").reverse().join("");
  const brev2 = brev + brev;
  let minD = Infinity;
  for (let i = 0; i < lb; i += 1) {
    const rot = bb2.slice(i, i + lb);
    let d = 0;
    for (let j = 0; j < lb; j += 1) if (rot[j] !== a[j]) d += 1;
    if (d < minD) minD = d;
    const rotr = brev2.slice(i, i + lb);
    let dr = 0;
    for (let j = 0; j < lb; j += 1) if (rotr[j] !== a[j]) dr += 1;
    if (dr < minD) minD = dr;
  }
  return minD / lb;
};

const notchPatternDistance = (na: NotchInfo[], nb: NotchInfo[]): number => {
  if (na.length !== nb.length) return 1 + Math.abs(na.length - nb.length) * 0.5;
  if (na.length === 0) return 0;
  const used = new Set<number>();
  let matches = 0;
  for (const n of na) {
    for (let j = 0; j < nb.length; j += 1) {
      if (used.has(j)) continue;
      const dX = Math.abs(n.relX - nb[j].relX);
      const dY = Math.abs(n.relY - nb[j].relY);
      if (dX < 0.3 && dY < 0.3) {
        matches += 1;
        used.add(j);
        break;
      }
    }
  }
  return 1 - matches / na.length;
};

const fullDistance = (sig: ShapeSignature, psig: ShapeSignature): number => {
  const w = { turn: 50, reflex: 35, fill: 15, aspect: 8, notch: 25, sym: 10 };
  let score = 0;
  score += w.turn * turnSeqDistance(sig.canonical, psig.canonical);
  score += w.reflex * Math.min(1, Math.abs(sig.reflexCount - psig.reflexCount) * 0.4);
  score += w.fill * Math.min(1, Math.abs(sig.fillRatio - psig.fillRatio) * 1.5);
  const la = Math.log(sig.aspect || 0.1);
  const lb = Math.log(psig.aspect || 0.1);
  score += w.aspect * Math.min(1, Math.abs(la - lb) * 0.5);
  score += w.notch * notchPatternDistance(sig.notches, psig.notches);
  const symMatch =
    sig.sym.symX === psig.sym.symX && sig.sym.symY === psig.sym.symY
      ? 0
      : sig.sym.symX !== psig.sym.symX && sig.sym.symY !== psig.sym.symY
      ? 1
      : 0.5;
  score += w.sym * symMatch;
  return score;
};

/** Continuous distance between a candidate polygon and a named preset shape.
 *  Lower is better; 0 means the canonical signatures match exactly. Useful when
 *  using the classifier as an optimisation objective rather than a discrete label. */
export const scorePolygonAgainstShape = (pts: Point[], target: ShapeName): number => {
  const sig = computeShapeSignature(pts);
  const psig = computeShapeSignature(RECTILINEAR_PRESETS[target]);
  return fullDistance(sig, psig);
};

export const classifyByRules = (sig: ShapeSignature): string => {
  const { reflexCount: r, n, sym } = sig;
  if (r === 0 && n === 4) return "Rectangle";
  if (r === 1) return "L-shape";
  if (r === 2) {
    if (sym.both) return "S-shape / Z-shape";
    if (sym.symX || sym.symY) return "T-shape / U-notch";
    return "Step / Z-shape";
  }
  if (r === 3) {
    if (sym.symX || sym.symY) return "T-shape (asymmetric)";
    return "Z / S variant";
  }
  if (r === 4) {
    if (sym.both) return n <= 12 ? "Plus" : "H-shape";
    if (sym.symX || sym.symY) return "U-shape / C-shape";
    return "Irregular 4-notch";
  }
  if (r === 5) {
    if (sym.symY) return "E-shape";
    return "F-shape";
  }
  if (r === 6) return "I-shape / Hollow-rect";
  return `Complex (${r} reflex, ${n} verts)`;
};

const matchAllPresets = (pts: Point[]): ShapeMatch[] => {
  const sig = computeShapeSignature(pts);
  return (Object.entries(RECTILINEAR_PRESETS) as [ShapeName, Point[]][])
    .map(([name, pp]) => {
      const psig = computeShapeSignature(pp);
      return { name, score: fullDistance(sig, psig), sig: psig, pts: pp };
    })
    .sort((a, b) => a.score - b.score);
};

const computeConfidence = (matches: ShapeMatch[]): number => {
  if (matches.length < 2) return 100;
  const best = matches[0].score;
  const second = matches[1].score;
  if (best === 0) return 100;
  const gap = second - best;
  return Math.min(100, Math.max(0, Math.round(100 * (1 - best / (best + gap + 1e-6)) * (1 + gap * 0.3))));
};

export const classifyRectilinearPolygon = (pts: Point[]): ClassificationResult => {
  if (pts.length < 3) {
    throw new Error("classifyRectilinearPolygon: need at least 3 vertices");
  }
  const ordered = ensureCCW(pts);
  const signature = computeShapeSignature(ordered);
  const matches = matchAllPresets(ordered);
  return {
    ruleLabel: classifyByRules(signature),
    best: matches[0],
    matches,
    confidence: computeConfidence(matches),
    signature,
    axisAligned: isAxisAligned(ordered),
  };
};
