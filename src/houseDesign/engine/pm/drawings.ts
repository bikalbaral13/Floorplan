// Drawing sheets for the report (SVG in HTML, TikZ in LaTeX): Gantt chart
// and activity-on-node precedence network. The interactive versions live in
// components/PmDiagrams.tsx.

import type { DrawingSheet, Item, Pt } from "../feasibility/drawing";
import type { PmResult } from "./compute";

/** Rank (column) of each activity = longest chain of predecessors. */
export function ranks(r: PmResult): number[] {
  const rank = r.inp.activities.map(() => 0);
  for (const j of r.net.order) for (const l of r.inp.activities[j].preds) rank[j] = Math.max(rank[j], rank[r.net.idx.get(l.pred)!] + 1);
  return rank;
}

export function ganttSheet(r: PmResult, starts: number[], label: string, sheetNo: string): DrawingSheet {
  const n = r.inp.activities.length;
  const T = Math.max(r.cpm.T, ...starts.map((s, i) => s + r.d[i]));
  const h = T / 55; // row height in day units → readable aspect
  const items: Item[] = [];
  const y = (i: number) => -(i + 1) * h;
  // year grid
  for (let k = 0; k <= T; k++) {
    const yr = r.date(k).slice(0, 4);
    if (k > 0 && yr === r.date(k - 1).slice(0, 4)) continue;
    if (k > 0) items.push({ k: "line", a: [k, 0.3 * h], b: [k, y(n) - 0.6 * h], stroke: "center" });
    items.push({ k: "text", at: [k + 4 * h, 0.55 * h], text: yr, size: 7.5, anchor: "start" });
  }
  items.push({ k: "line", a: [0, 0], b: [T, 0], stroke: "thin" });
  r.cpm.rows.forEach((row, i) => {
    const s = starts[i], e = s + row.d, yc = y(i);
    items.push({ k: "text", at: [-h * 0.6, yc - 0.3 * h], text: row.a.id, size: 7, anchor: "end" });
    if (row.d === 0) {
      items.push({ k: "poly", pts: [[s, yc + 0.4 * h], [s + 0.4 * h, yc], [s, yc - 0.4 * h], [s - 0.4 * h, yc]], closed: true, fill: "steel", stroke: "thin" });
    } else {
      items.push({ k: "poly", pts: [[s, yc - 0.32 * h], [e, yc - 0.32 * h], [e, yc + 0.32 * h], [s, yc + 0.32 * h]], closed: true, fill: row.critical ? "steel" : "concrete", stroke: "thin" });
      const lateEnd = row.LF;
      if (lateEnd > e + 1e-9 && starts === r.early.starts) items.push({ k: "line", a: [e, yc], b: [lateEnd, yc], stroke: "hidden" });
    }
    items.push({ k: "text", at: [Math.max(e, s) + 0.5 * h, yc - 0.3 * h], text: `${row.a.name.slice(0, 34)} (${row.d} d)`, size: 6.2, anchor: "start" });
  });
  return {
    title: `Gantt chart — ${label}`,
    sheetNo,
    project: r.inp.project.name.slice(0, 38),
    views: [{ title: `BAR CHART (${label.toUpperCase()}) — ${T} WORKING DAYS`, items, maxHeight: 620 }],
    notes: [
      "Black bars = critical activities (zero total float), hatched bars = non-critical, dashed line = total float to late finish, diamond = milestone.",
      `Start ${r.date(0)}; ${r.inp.settings.daysPerWeek}-day working week; vertical lines at the start of each calendar year.`,
    ],
  };
}

export function networkSheet(r: PmResult, sheetNo: string): DrawingSheet {
  const rk = ranks(r);
  const cols = new Map<number, number[]>();
  rk.forEach((c, i) => cols.set(c, [...(cols.get(c) ?? []), i]));
  const W = 10, H = 5.2, gx = 4.5, gy = 1.6;
  const pos: Pt[] = r.inp.activities.map(() => [0, 0]);
  for (const [c, ids] of cols) {
    ids.sort((a, b) => r.cpm.rows[a].ES - r.cpm.rows[b].ES);
    ids.forEach((i, k) => (pos[i] = [c * (W + gx), -k * (H + gy)]));
  }
  const items: Item[] = [];
  r.inp.activities.forEach((a, j) => {
    for (const l of a.preds) {
      const i = r.net.idx.get(l.pred)!;
      const A: Pt = [pos[i][0] + W, pos[i][1] - H / 2], B: Pt = [pos[j][0], pos[j][1] - H / 2];
      const crit = r.cpm.driving.some(([p, s]) => p === l.pred && s === a.id);
      items.push({ k: "arrow", a: A, b: B });
      if (crit) items.push({ k: "line", a: A, b: B, stroke: "thick" });
      if (l.type !== "FS" || l.lag) items.push({ k: "text", at: [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + 0.4], text: `${l.type}${l.lag ? (l.lag > 0 ? "+" : "") + l.lag : ""}`, size: 5.5 });
    }
  });
  r.cpm.rows.forEach((row, i) => {
    const [x, y0] = pos[i];
    const q = W / 3;
    items.push({ k: "poly", pts: [[x, y0], [x + W, y0], [x + W, y0 - H], [x, y0 - H]], closed: true, fill: row.critical ? "water" : "none", stroke: row.critical ? "thick" : "thin" });
    items.push({ k: "line", a: [x, y0 - H * 0.3], b: [x + W, y0 - H * 0.3], stroke: "thin" });
    items.push({ k: "line", a: [x, y0 - H * 0.7], b: [x + W, y0 - H * 0.7], stroke: "thin" });
    for (const f of [1, 2]) {
      items.push({ k: "line", a: [x + q * f, y0], b: [x + q * f, y0 - H * 0.3], stroke: "thin" });
      items.push({ k: "line", a: [x + q * f, y0 - H * 0.7], b: [x + q * f, y0 - H], stroke: "thin" });
    }
    const tx = (k: number, yy: number, s: string, size = 6) => items.push({ k: "text", at: [x + q * k + q / 2, yy], text: s, size });
    tx(0, y0 - H * 0.22, String(row.ES)); tx(1, y0 - H * 0.22, String(row.d)); tx(2, y0 - H * 0.22, String(row.EF));
    items.push({ k: "text", at: [x + W / 2, y0 - H * 0.56], text: row.a.id, size: 7.5 });
    tx(0, y0 - H * 0.92, String(row.LS)); tx(1, y0 - H * 0.92, `TF ${row.TF}`, 5.5); tx(2, y0 - H * 0.92, String(row.LF));
  });
  return {
    title: "Precedence network (activity on node)",
    sheetNo,
    project: r.inp.project.name.slice(0, 38),
    views: [{ title: "AON NETWORK — ES | DUR | EF / ID / LS | TF | LF", items, maxHeight: 520 }],
    notes: [
      "Shaded, heavy boxes and heavy arrows form the critical path; labels on arrows give non-FS relationships and lags (working days).",
      `Critical path: ${r.cpm.paths.map((p) => p.join(" → ")).join("  |  ")}`,
    ],
  };
}
