import { type ReactNode } from "react";
import { Line, Circle, Group } from "react-konva";

/** Object kinds that have a 2D architectural symbol (and a matching 3D primitive). Mirrors
 *  Wall.placementKind and the Place Object Along Boundary catalog. */
export type PlacementSymbolKind =
  | "bed" | "table" | "chair" | "sofa"
  | "desk" | "wardrobe" | "bookshelf" | "bench"
  | "piano" | "tv-unit" | "fridge" | "toilet" | "bathtub"
  | "guitar" | "whiteboard" | "flute" | "clock" | "mirror";

export const PLACEMENT_SYMBOL_STROKE: Record<PlacementSymbolKind, string> = {
  bed: "#64748b", table: "#a16207", chair: "#2563eb", sofa: "#16a34a",
  desk: "#7c3aed", wardrobe: "#0f766e", bookshelf: "#9a3412", bench: "#6b7280",
  piano: "#1f2937", "tv-unit": "#0369a1", fridge: "#475569", toilet: "#6366f1", bathtub: "#0891b2",
  guitar: "#b45309", whiteboard: "#0ea5e9", flute: "#a855f7", clock: "#dc2626", mirror: "#0d9488",
};
export const PLACEMENT_SYMBOL_FILL: Record<PlacementSymbolKind, string> = {
  bed: "rgba(148,163,184,0.22)", table: "rgba(161,98,7,0.22)", chair: "rgba(37,99,235,0.22)", sofa: "rgba(22,163,74,0.22)",
  desk: "rgba(124,58,237,0.18)", wardrobe: "rgba(15,118,110,0.22)", bookshelf: "rgba(154,52,18,0.22)", bench: "rgba(107,114,128,0.22)",
  piano: "rgba(31,41,55,0.28)", "tv-unit": "rgba(3,105,161,0.20)", fridge: "rgba(71,85,105,0.22)", toilet: "rgba(99,102,241,0.18)", bathtub: "rgba(8,145,178,0.18)",
  guitar: "rgba(180,83,9,0.18)", whiteboard: "rgba(14,165,233,0.18)", flute: "rgba(168,85,247,0.18)", clock: "rgba(220,38,38,0.18)", mirror: "rgba(13,148,136,0.18)",
};

export const isPlacementSymbolKind = (k: string): k is PlacementSymbolKind =>
  Object.prototype.hasOwnProperty.call(PLACEMENT_SYMBOL_STROKE, k);

/** Local oriented frame of a placed object's footprint, in WORLD-pixel coords.
 *  (ux,uy) runs along the boundary edge (length axis); (nx,ny) is the inward normal (breadth axis);
 *  halfL / halfB are the half-extents along each. Rendered inside a WorldViewport so the small
 *  strokeWidths below read as line weights at any zoom. */
export interface PlacementSymbolFrame {
  cx: number; cy: number;
  ux: number; uy: number;
  nx: number; ny: number;
  halfL: number; halfB: number;
}

/** Derive the oriented frame from a place-object footprint quad. Corner order matches
 *  buildCornersAtEdge / computePerimeterPlacement: p0→p1 is the length edge along the boundary,
 *  p1→p2 is the inward (breadth) edge. Returns null for a degenerate quad. */
export const placementFrameFromQuad = (quad: { x: number; y: number }[]): PlacementSymbolFrame | null => {
  if (quad.length < 4) return null;
  const [p0, p1, p2] = quad;
  let cx = 0, cy = 0;
  for (const p of quad) { cx += p.x; cy += p.y; }
  cx /= quad.length; cy /= quad.length;
  const lx = p1.x - p0.x, ly = p1.y - p0.y;
  const bx = p2.x - p1.x, by = p2.y - p1.y;
  const lLen = Math.hypot(lx, ly), bLen = Math.hypot(bx, by);
  if (lLen < 1e-6 || bLen < 1e-6) return null;
  return { cx, cy, ux: lx / lLen, uy: ly / lLen, nx: bx / bLen, ny: by / bLen, halfL: lLen / 2, halfB: bLen / 2 };
};

/** Konva 2D architectural symbol for a placed object — a filled footprint outline plus a per-kind
 *  motif (bed pillow, sofa arms, toilet bowl, clock face, …). Shared by the committed-placement
 *  overlay and the live Flow preview so both render identical symbols. */
export const PlacementSymbol2D = ({
  frame,
  kind,
  listening = false,
}: {
  frame: PlacementSymbolFrame;
  kind: PlacementSymbolKind;
  listening?: boolean;
}) => {
  const { cx, cy, ux, uy, nx, ny, halfL, halfB } = frame;
  const corner = (sl: number, sb: number) => ({
    x: cx + ux * halfL * sl + nx * halfB * sb,
    y: cy + uy * halfL * sl + ny * halfB * sb,
  });
  const c00 = corner(-1, -1), c10 = corner(1, -1), c11 = corner(1, 1), c01 = corner(-1, 1);
  const stroke = PLACEMENT_SYMBOL_STROKE[kind];
  const fill = PLACEMENT_SYMBOL_FILL[kind];
  const motif = (() => {
    if (kind === "bed") {
      const pH = halfB * 0.28;
      const a = corner(-0.85, -1), b = corner(0.85, -1);
      const c = { x: b.x + nx * pH, y: b.y + ny * pH };
      const d = { x: a.x + nx * pH, y: a.y + ny * pH };
      const mx = (a.x + b.x) / 2 + nx * pH * 0.5;
      const my = (a.y + b.y) / 2 + ny * pH * 0.5;
      return (
        <>
          <Line points={[a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]} closed stroke={stroke} strokeWidth={0.8} fill="rgba(255,255,255,0.4)" />
          <Line points={[mx - ux * halfL * 0.85, my - uy * halfL * 0.85, mx + ux * halfL * 0.85, my + uy * halfL * 0.85]} stroke={stroke} strokeWidth={0.5} />
        </>
      );
    }
    if (kind === "chair") {
      const tH = halfB * 0.25;
      const a = corner(-1, -1), b = corner(1, -1);
      const c = { x: b.x + nx * tH, y: b.y + ny * tH };
      const d = { x: a.x + nx * tH, y: a.y + ny * tH };
      return <Line points={[a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.6} />;
    }
    if (kind === "sofa") {
      const tBack = halfB * 0.25;
      const tArm = halfL * 0.18;
      // Back
      const ba = corner(-1, -1), bb = corner(1, -1);
      const bc = { x: bb.x + nx * tBack, y: bb.y + ny * tBack };
      const bd = { x: ba.x + nx * tBack, y: ba.y + ny * tBack };
      // Left arm
      const la = corner(-1, -1);
      const lb = { x: la.x + ux * tArm, y: la.y + uy * tArm };
      const lc = { x: lb.x + nx * halfB * 2, y: lb.y + ny * halfB * 2 };
      const ld = { x: la.x + nx * halfB * 2, y: la.y + ny * halfB * 2 };
      // Right arm
      const ra = { x: corner(1, -1).x - ux * tArm, y: corner(1, -1).y - uy * tArm };
      const rb = corner(1, -1);
      const rc = { x: rb.x + nx * halfB * 2, y: rb.y + ny * halfB * 2 };
      const rd = { x: ra.x + nx * halfB * 2, y: ra.y + ny * halfB * 2 };
      return (
        <>
          <Line points={[ba.x, ba.y, bb.x, bb.y, bc.x, bc.y, bd.x, bd.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />
          <Line points={[la.x, la.y, lb.x, lb.y, lc.x, lc.y, ld.x, ld.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />
          <Line points={[ra.x, ra.y, rb.x, rb.y, rc.x, rc.y, rd.x, rd.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />
        </>
      );
    }
    if (kind === "table") {
      const inset = Math.min(halfL, halfB) * 0.18;
      const sL = (halfL - inset) / halfL, sB = (halfB - inset) / halfB;
      const i00 = corner(-sL, -sB), i10 = corner(sL, -sB), i11 = corner(sL, sB), i01 = corner(-sL, sB);
      return <Line points={[i00.x, i00.y, i10.x, i10.y, i11.x, i11.y, i01.x, i01.y]} closed stroke={stroke} strokeWidth={0.6} dash={[3, 2]} />;
    }
    if (kind === "desk") {
      // Knee well — a recessed inner rectangle on the user (inner) side.
      const a = corner(-0.6, 0.0), b = corner(0.6, 0.0);
      const c = corner(0.6, 0.85), d = corner(-0.6, 0.85);
      return <Line points={[a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]} closed stroke={stroke} strokeWidth={0.6} dash={[2, 2]} />;
    }
    if (kind === "wardrobe") {
      // Center divider line + door-arc hint on each half.
      const a = corner(0, -1), b = corner(0, 1);
      const arcPts1: number[] = [];
      const arcPts2: number[] = [];
      const STEPS = 14;
      for (let s = 0; s <= STEPS; s++) {
        const t = s / STEPS;
        const a1 = (Math.PI / 2) * t;
        const r1 = halfL;
        const h1 = corner(-1, -1);
        arcPts1.push(h1.x + Math.cos(a1) * ux * r1 + Math.sin(a1) * nx * r1);
        arcPts1.push(h1.y + Math.cos(a1) * uy * r1 + Math.sin(a1) * ny * r1);
        const h2 = corner(1, -1);
        arcPts2.push(h2.x - Math.cos(a1) * ux * r1 + Math.sin(a1) * nx * r1);
        arcPts2.push(h2.y - Math.cos(a1) * uy * r1 + Math.sin(a1) * ny * r1);
      }
      return (
        <>
          <Line points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={0.8} />
          <Line points={arcPts1} stroke={stroke} strokeWidth={0.5} dash={[2, 2]} />
          <Line points={arcPts2} stroke={stroke} strokeWidth={0.5} dash={[2, 2]} />
        </>
      );
    }
    if (kind === "bookshelf") {
      const SHELVES = 4;
      const lines: ReactNode[] = [];
      for (let s = 1; s < SHELVES; s++) {
        const sb = -1 + (2 * s) / SHELVES;
        const a = corner(-1, sb), b = corner(1, sb);
        lines.push(<Line key={`bs-${s}`} points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={0.5} />);
      }
      return <>{lines}</>;
    }
    if (kind === "bench") {
      const inset = Math.min(halfL, halfB) * 0.15;
      const sL = (halfL - inset) / halfL, sB = (halfB - inset) / halfB;
      const i00 = corner(-sL, -sB), i10 = corner(sL, -sB), i11 = corner(sL, sB), i01 = corner(-sL, sB);
      const ma = corner(-1, 0), mb = corner(1, 0);
      return (
        <>
          <Line points={[i00.x, i00.y, i10.x, i10.y, i11.x, i11.y, i01.x, i01.y]} closed stroke={stroke} strokeWidth={0.5} />
          <Line points={[ma.x, ma.y, mb.x, mb.y]} stroke={stroke} strokeWidth={0.4} />
        </>
      );
    }
    if (kind === "piano") {
      const KEYS = Math.max(8, Math.round((halfL * 2) / Math.max(1, halfB) * 4));
      const keys: ReactNode[] = [];
      for (let k = 0; k <= KEYS; k++) {
        const sl = -1 + (2 * k) / KEYS;
        const a = corner(sl, 0.2), b = corner(sl, 1);
        keys.push(<Line key={`pk-${k}`} points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={0.4} />);
      }
      const da = corner(-1, 0.2), db = corner(1, 0.2);
      keys.push(<Line key="pdiv" points={[da.x, da.y, db.x, db.y]} stroke={stroke} strokeWidth={0.7} />);
      return <>{keys}</>;
    }
    if (kind === "tv-unit") {
      const lines: ReactNode[] = [];
      for (let s = 1; s < 3; s++) {
        const sl = -1 + (2 * s) / 3;
        const a = corner(sl, -1), b = corner(sl, 1);
        lines.push(<Line key={`tv-d-${s}`} points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={0.5} />);
      }
      const ta = corner(-0.7, 0.65), tb = corner(0.7, 0.65), tc = corner(0.7, 0.95), td = corner(-0.7, 0.95);
      lines.push(<Line key="tv-scr" points={[ta.x, ta.y, tb.x, tb.y, tc.x, tc.y, td.x, td.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />);
      return <>{lines}</>;
    }
    if (kind === "fridge") {
      const a = corner(0, -1), b = corner(0, 1);
      const ha = corner(0.05, 0.2), hb = corner(0.05, -0.2);
      return (
        <>
          <Line points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={0.8} />
          <Line points={[ha.x, ha.y, hb.x, hb.y]} stroke={stroke} strokeWidth={1.2} />
        </>
      );
    }
    if (kind === "toilet") {
      const ta = corner(-0.5, -1), tb = corner(0.5, -1), tc = corner(0.5, -0.5), td = corner(-0.5, -0.5);
      const ELLIPSE_PTS = 28;
      const ec = corner(0, 0.4);
      const ePts: number[] = [];
      for (let i = 0; i <= ELLIPSE_PTS; i++) {
        const a = (i / ELLIPSE_PTS) * Math.PI * 2;
        const ex = ec.x + Math.cos(a) * ux * halfL * 0.45 + Math.sin(a) * nx * halfB * 0.55;
        const ey = ec.y + Math.cos(a) * uy * halfL * 0.45 + Math.sin(a) * ny * halfB * 0.55;
        ePts.push(ex, ey);
      }
      return (
        <>
          <Line points={[ta.x, ta.y, tb.x, tb.y, tc.x, tc.y, td.x, td.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />
          <Line points={ePts} closed fill="rgba(255,255,255,0.6)" stroke={stroke} strokeWidth={0.7} />
        </>
      );
    }
    if (kind === "bathtub") {
      const inset = Math.min(halfL, halfB) * 0.18;
      const sL = (halfL - inset) / halfL, sB = (halfB - inset) / halfB;
      const i00 = corner(-sL, -sB), i10 = corner(sL, -sB), i11 = corner(sL, sB), i01 = corner(-sL, sB);
      const drain = corner(-0.7, 0);
      return (
        <>
          <Line points={[i00.x, i00.y, i10.x, i10.y, i11.x, i11.y, i01.x, i01.y]} closed fill="rgba(255,255,255,0.5)" stroke={stroke} strokeWidth={0.6} />
          <Circle x={drain.x} y={drain.y} radius={Math.min(halfL, halfB) * 0.08} stroke={stroke} strokeWidth={0.6} />
        </>
      );
    }
    if (kind === "guitar") {
      const bodyR = Math.min(halfL * 0.4, halfB * 0.9);
      const bodyC = corner(-0.5, 0);
      const waistR = bodyR * 0.7;
      const waistC = corner(0, 0);
      const upperR = bodyR * 0.85;
      const upperC = corner(0.4, 0);
      const neckA = corner(0.7, 0), neckB = corner(1, 0);
      return (
        <>
          <Circle x={bodyC.x} y={bodyC.y} radius={bodyR} stroke={stroke} strokeWidth={0.7} fill="rgba(255,255,255,0.3)" />
          <Circle x={waistC.x} y={waistC.y} radius={waistR} stroke={stroke} strokeWidth={0.5} />
          <Circle x={upperC.x} y={upperC.y} radius={upperR} stroke={stroke} strokeWidth={0.6} fill="rgba(255,255,255,0.3)" />
          <Line points={[neckA.x, neckA.y, neckB.x, neckB.y]} stroke={stroke} strokeWidth={1.2} />
        </>
      );
    }
    if (kind === "whiteboard") {
      const inset = Math.min(halfL, halfB) * 0.12;
      const sL = (halfL - inset) / halfL, sB = (halfB - inset) / halfB;
      const i00 = corner(-sL, -sB), i10 = corner(sL, -sB), i11 = corner(sL, sB), i01 = corner(-sL, sB);
      const ta = corner(-0.85, 0.6), tb = corner(0.85, 0.6), tc = corner(0.85, 0.85), td = corner(-0.85, 0.85);
      return (
        <>
          <Line points={[i00.x, i00.y, i10.x, i10.y, i11.x, i11.y, i01.x, i01.y]} closed fill="rgba(255,255,255,0.7)" stroke={stroke} strokeWidth={0.6} />
          <Line points={[ta.x, ta.y, tb.x, tb.y, tc.x, tc.y, td.x, td.y]} closed fill={stroke} stroke={stroke} strokeWidth={0.4} />
        </>
      );
    }
    if (kind === "flute") {
      const a = corner(-1, 0), b = corner(1, 0);
      const HOLES = 6;
      const dots: ReactNode[] = [];
      for (let k = 0; k < HOLES; k++) {
        const sl = -0.7 + (1.4 * k) / (HOLES - 1);
        const c = corner(sl, 0.05);
        dots.push(<Circle key={`fh-${k}`} x={c.x} y={c.y} radius={Math.min(halfL, halfB) * 0.08} fill={stroke} />);
      }
      return (
        <>
          <Line points={[a.x, a.y, b.x, b.y]} stroke={stroke} strokeWidth={1.5} />
          {dots}
        </>
      );
    }
    if (kind === "clock") {
      const r = Math.min(halfL, halfB) * 0.85;
      const ticks: ReactNode[] = [];
      for (let q = 0; q < 4; q++) {
        const a = (q / 4) * Math.PI * 2;
        const x1 = cx + Math.cos(a) * ux * r * 0.85 + Math.sin(a) * nx * r * 0.85;
        const y1 = cy + Math.cos(a) * uy * r * 0.85 + Math.sin(a) * ny * r * 0.85;
        const x2 = cx + Math.cos(a) * ux * r + Math.sin(a) * nx * r;
        const y2 = cy + Math.cos(a) * uy * r + Math.sin(a) * ny * r;
        ticks.push(<Line key={`ct-${q}`} points={[x1, y1, x2, y2]} stroke={stroke} strokeWidth={0.7} />);
      }
      const hour = corner(0, -0.4);
      const min = corner(0.5, 0);
      return (
        <>
          <Circle x={cx} y={cy} radius={r} fill="rgba(255,255,255,0.7)" stroke={stroke} strokeWidth={0.8} />
          {ticks}
          <Line points={[cx, cy, hour.x, hour.y]} stroke={stroke} strokeWidth={1.2} />
          <Line points={[cx, cy, min.x, min.y]} stroke={stroke} strokeWidth={0.8} />
          <Circle x={cx} y={cy} radius={Math.min(halfL, halfB) * 0.08} fill={stroke} />
        </>
      );
    }
    if (kind === "mirror") {
      const inset = Math.min(halfL, halfB) * 0.12;
      const sL = (halfL - inset) / halfL, sB = (halfB - inset) / halfB;
      const i00 = corner(-sL, -sB), i10 = corner(sL, -sB), i11 = corner(sL, sB), i01 = corner(-sL, sB);
      const da = corner(-sL * 0.6, -sB * 0.6), db = corner(sL * 0.6, sB * 0.6);
      const ea = corner(-sL * 0.3, -sB * 0.6), eb = corner(sL * 0.9, sB * 0.6);
      return (
        <>
          <Line points={[i00.x, i00.y, i10.x, i10.y, i11.x, i11.y, i01.x, i01.y]} closed fill="rgba(255,255,255,0.6)" stroke={stroke} strokeWidth={0.6} />
          <Line points={[da.x, da.y, db.x, db.y]} stroke={stroke} strokeWidth={0.4} dash={[2, 2]} />
          <Line points={[ea.x, ea.y, eb.x, eb.y]} stroke={stroke} strokeWidth={0.4} dash={[2, 2]} />
        </>
      );
    }
    return null;
  })();
  return (
    <Group listening={listening}>
      <Line points={[c00.x, c00.y, c10.x, c10.y, c11.x, c11.y, c01.x, c01.y]} closed fill={fill} stroke={stroke} strokeWidth={1.2} />
      {motif}
    </Group>
  );
};
