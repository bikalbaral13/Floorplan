// Parametric engineering drawings. A DrawingSheet (stored in the JSON report)
// holds views in model units (metres, y up). `layoutSheet` fits every view to
// the paper width and returns positioned primitives (paths + text) that are
// emitted as SVG here and as TikZ in renderLatex.ts — one geometry, two outputs.

export type Pt = [number, number];
export type Stroke = "thick" | "thin" | "hidden" | "center" | "water" | "none";
export type Fill = "concrete" | "water" | "soil" | "stone" | "steel" | "none";

export type Item =
  | { k: "poly"; pts: Pt[]; closed?: boolean; fill?: Fill; stroke?: Stroke }
  | { k: "line"; a: Pt; b: Pt; stroke?: Stroke }
  | { k: "circle"; c: Pt; r: number; fill?: Fill; stroke?: Stroke }
  | { k: "dim"; a: Pt; b: Pt; off?: number; text?: string } // off: paper px, + = left of a→b
  | { k: "level"; at: Pt; text: string; side?: "left" | "right" }
  | { k: "text"; at: Pt; text: string; size?: number; anchor?: "start" | "middle" | "end"; rot?: number }
  | { k: "arrow"; a: Pt; b: Pt; text?: string };

export interface View {
  title: string;
  items: Item[];
  vexag?: number; // vertical exaggeration (profiles)
  maxHeight?: number; // paper px
  noScale?: boolean; // omit the metric scale bar (non-scaled diagrams)
}

export interface DrawingSheet {
  title: string;
  sheetNo: string;
  project: string;
  views: View[];
  notes?: string[];
}

// ---------------------------------------------------------------------------
// Layout → paper primitives (px, y down)
// ---------------------------------------------------------------------------

export type Prim =
  | { t: "path"; pts: Pt[]; closed: boolean; stroke: Stroke; fill: Fill; width?: number }
  | { t: "text"; x: number; y: number; text: string; size: number; anchor: "start" | "middle" | "end"; rot: number; bold?: boolean };

export const PAPER_W = 700;
const M = 34; // margin around each view for dimensions

function fmtLen(v: number): string {
  return v >= 100 ? v.toFixed(1) : v.toFixed(2);
}

function niceStep(span: number): number {
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3.5 ? 2 : n < 7.5 ? 5 : 10) * mag;
}

export function layoutSheet(sheet: DrawingSheet): { prims: Prim[]; height: number } {
  const prims: Prim[] = [];
  let top = 14;
  for (const view of sheet.views) {
    const vx = view.vexag ?? 1;
    const pts: Pt[] = [];
    for (const it of view.items) {
      if (it.k === "poly") pts.push(...it.pts);
      else if (it.k === "line" || it.k === "dim" || it.k === "arrow") pts.push(it.a, it.b);
      else if (it.k === "circle") pts.push([it.c[0] - it.r, it.c[1] - it.r], [it.c[0] + it.r, it.c[1] + it.r]);
      else pts.push(it.at);
    }
    const xmin = Math.min(...pts.map((p) => p[0]));
    const xmax = Math.max(...pts.map((p) => p[0]));
    const ymin = Math.min(...pts.map((p) => p[1]));
    const ymax = Math.max(...pts.map((p) => p[1]));
    const maxH = view.maxHeight ?? 300;
    const s = Math.min((PAPER_W - 2 * M - 60) / Math.max(1e-6, xmax - xmin), maxH / Math.max(1e-6, (ymax - ymin) * vx));
    const w = (xmax - xmin) * s;
    const h = (ymax - ymin) * s * vx;
    const ox = (PAPER_W - w) / 2;
    const oy = top + 26 + M;
    const X = (x: number) => ox + (x - xmin) * s;
    const Y = (y: number) => oy + (ymax - y) * s * vx;
    const P = (p: Pt): Pt => [X(p[0]), Y(p[1])];

    // view title (centred, bold; case kept so units such as m³/s stay correct)
    prims.push({ t: "text", x: PAPER_W / 2, y: top + 18, text: view.title, size: 12, anchor: "middle", rot: 0, bold: true });

    for (const it of view.items) {
      switch (it.k) {
        case "poly":
          prims.push({ t: "path", pts: it.pts.map(P), closed: !!it.closed, stroke: it.stroke ?? "thick", fill: it.fill ?? "none" });
          break;
        case "line":
          prims.push({ t: "path", pts: [P(it.a), P(it.b)], closed: false, stroke: it.stroke ?? "thick", fill: "none" });
          break;
        case "circle": {
          const [cx, cy] = P(it.c);
          const r = it.r * s;
          const n = 36;
          prims.push({
            t: "path",
            pts: Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)] as Pt),
            closed: true, stroke: it.stroke ?? "thick", fill: it.fill ?? "none",
          });
          break;
        }
        case "dim": {
          const a = P(it.a);
          const b = P(it.b);
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy) || 1;
          const nx = dy / len;
          const ny = -dx / len; // left normal in paper coords
          const off = it.off ?? 18;
          const a2: Pt = [a[0] + nx * off, a[1] + ny * off];
          const b2: Pt = [b[0] + nx * off, b[1] + ny * off];
          const ext = off > 0 ? 3 : -3;
          prims.push({ t: "path", pts: [[a[0] + nx * 2 * Math.sign(off), a[1] + ny * 2 * Math.sign(off)], [a2[0] + nx * ext, a2[1] + ny * ext]], closed: false, stroke: "thin", fill: "none" });
          prims.push({ t: "path", pts: [[b[0] + nx * 2 * Math.sign(off), b[1] + ny * 2 * Math.sign(off)], [b2[0] + nx * ext, b2[1] + ny * ext]], closed: false, stroke: "thin", fill: "none" });
          prims.push({ t: "path", pts: [a2, b2], closed: false, stroke: "thin", fill: "none" });
          // oblique ticks
          const ux = dx / len;
          const uy = dy / len;
          for (const q of [a2, b2]) {
            prims.push({ t: "path", pts: [[q[0] - (ux + nx) * 3, q[1] - (uy + ny) * 3], [q[0] + (ux + nx) * 3, q[1] + (uy + ny) * 3]], closed: false, stroke: "thick", fill: "none", width: 1.2 });
          }
          let rot = (Math.atan2(dy, dx) * 180) / Math.PI;
          if (rot > 90) rot -= 180;
          if (rot < -90) rot += 180;
          const mx = (a2[0] + b2[0]) / 2 + nx * 4;
          const my = (a2[1] + b2[1]) / 2 + ny * 4;
          const real = it.text ?? fmtLen(Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]));
          prims.push({ t: "text", x: mx, y: my + (Math.abs(rot) < 45 ? (ny > 0 ? 9 : 0) : 3), text: real, size: 9, anchor: "middle", rot });
          break;
        }
        case "level": {
          const [x, y] = P(it.at);
          const right = it.side !== "left";
          const tx = right ? x + 8 : x - 8;
          prims.push({ t: "path", pts: [[x - 5, y - 8], [x + 5, y - 8], [x, y]], closed: true, stroke: "thin", fill: "steel" });
          prims.push({ t: "path", pts: [[x, y - 8], [right ? x + 70 : x - 70, y - 8]], closed: false, stroke: "thin", fill: "none" });
          prims.push({ t: "text", x: tx, y: y - 11, text: it.text, size: 8.5, anchor: right ? "start" : "end", rot: 0 });
          break;
        }
        case "text": {
          const [x, y] = P(it.at);
          prims.push({ t: "text", x, y, text: it.text, size: it.size ?? 9, anchor: it.anchor ?? "middle", rot: it.rot ?? 0 });
          break;
        }
        case "arrow": {
          const a = P(it.a);
          const b = P(it.b);
          const dx = b[0] - a[0];
          const dy = b[1] - a[1];
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          prims.push({ t: "path", pts: [a, b], closed: false, stroke: "thin", fill: "none" });
          prims.push({ t: "path", pts: [b, [b[0] - ux * 7 - uy * 3, b[1] - uy * 7 + ux * 3], [b[0] - ux * 7 + uy * 3, b[1] - uy * 7 - ux * 3]], closed: true, stroke: "thin", fill: "steel" });
          if (it.text) prims.push({ t: "text", x: a[0] - ux * 4, y: a[1] - uy * 4 - 2, text: it.text, size: 8.5, anchor: ux >= 0 ? "end" : "start", rot: 0 });
          break;
        }
      }
    }

    // scale bar (horizontal, model metres)
    const barY = oy + h + M + 12; // below the lowest dimension line
    if (!view.noScale) {
      const span = xmax - xmin;
      const step = niceStep(span);
      const bx = ox;
      for (let i = 0; i < 2; i++) {
        prims.push({ t: "path", pts: [[bx + i * step * s, barY], [bx + (i + 1) * step * s, barY], [bx + (i + 1) * step * s, barY + 4], [bx + i * step * s, barY + 4]], closed: true, stroke: "thin", fill: i === 0 ? "steel" : "none" });
      }
      [0, 1, 2].forEach((i) => prims.push({ t: "text", x: bx + i * step * s, y: barY + 13, text: `${Number((i * step).toPrecision(3))}`, size: 7.5, anchor: "middle", rot: 0 }));
      prims.push({ t: "text", x: bx + 2 * step * s + 6, y: barY + 5, text: vx !== 1 ? `m (horizontal); vertical ×${vx}` : "m", size: 7.5, anchor: "start", rot: 0 });
    }

    top = barY + 26;
  }

  // title block
  const tbH = 46;
  const y0 = top + 4;
  const cols = [0, 250, 520, PAPER_W - 10];
  prims.push({ t: "path", pts: [[10, y0], [PAPER_W - 10, y0], [PAPER_W - 10, y0 + tbH], [10, y0 + tbH]], closed: true, stroke: "thick", fill: "none" });
  for (const cx of cols.slice(1, 3)) prims.push({ t: "path", pts: [[cx, y0], [cx, y0 + tbH]], closed: false, stroke: "thin", fill: "none" });
  const cell = (x: number, label: string, value: string) => {
    prims.push({ t: "text", x: x + 8, y: y0 + 14, text: label, size: 7.5, anchor: "start", rot: 0 });
    prims.push({ t: "text", x: x + 8, y: y0 + 32, text: value, size: 10.5, anchor: "start", rot: 0, bold: true });
  };
  cell(10, "PROJECT", sheet.project);
  cell(250, "DRAWING", sheet.title);
  cell(520, "SHEET No. / SCALE", `${sheet.sheetNo}  ·  as shown`);
  let height = y0 + tbH + 8;
  if (sheet.notes?.length) {
    sheet.notes.forEach((n, i) => prims.push({ t: "text", x: 14, y: height + 12 + i * 13, text: `${i + 1}. ${n}`, size: 8.5, anchor: "start", rot: 0 }));
    height += 16 + sheet.notes.length * 13;
  }
  return { prims, height };
}

// ---------------------------------------------------------------------------
// SVG emitter
// ---------------------------------------------------------------------------

const STROKE: Record<string, { w: number; dash?: string; color: string }> = {
  thick: { w: 1.6, color: "#111" },
  thin: { w: 0.7, color: "#111" },
  hidden: { w: 0.8, dash: "5 3", color: "#111" },
  center: { w: 0.7, dash: "10 3 2 3", color: "#555" },
  water: { w: 1.0, color: "#2a78d6" },
};

const FILL: Record<Fill, string> = {
  concrete: "url(#dw-conc)",
  water: "#d6e9f8",
  soil: "url(#dw-soil)",
  stone: "url(#dw-stone)",
  steel: "#222",
  none: "none",
};

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderDrawingSvg(sheet: DrawingSheet): string {
  const { prims, height } = layoutSheet(sheet);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAPER_W} ${height}" width="100%" style="max-width:${PAPER_W}px;font-family:inherit" role="img">`);
  out.push(`<defs>
<pattern id="dw-conc" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#e6e6e3"/><circle cx="2" cy="2" r="0.8" fill="#888"/><circle cx="6" cy="5" r="0.6" fill="#999"/></pattern>
<pattern id="dw-soil" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="#f4efe6"/><line x1="0" y1="0" x2="0" y2="7" stroke="#a08a6a" stroke-width="0.8"/></pattern>
<pattern id="dw-stone" width="10" height="10" patternUnits="userSpaceOnUse"><rect width="10" height="10" fill="#efefe9"/><path d="M1 3 L4 1 L7 3 L5 6 Z M6 8 L9 6 L9 9 Z" fill="none" stroke="#777" stroke-width="0.6"/></pattern>
</defs>`);
  out.push(`<rect x="0" y="0" width="${PAPER_W}" height="${height}" fill="#fff"/>`);
  for (const p of prims) {
    if (p.t === "path") {
      const st = p.stroke === "none" ? null : STROKE[p.stroke];
      const d = p.pts.map((q, i) => `${i ? "L" : "M"}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join("") + (p.closed ? "Z" : "");
      out.push(`<path d="${d}" fill="${p.closed ? FILL[p.fill] : "none"}" stroke="${st ? st.color : "none"}" stroke-width="${p.width ?? st?.w ?? 0}"${st?.dash ? ` stroke-dasharray="${st.dash}"` : ""} stroke-linejoin="round"/>`);
    } else {
      out.push(`<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" font-size="${p.size}" text-anchor="${p.anchor}"${p.bold ? ' font-weight="bold"' : ""}${p.rot ? ` transform="rotate(${p.rot.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)})"` : ""} fill="#111">${esc(p.text)}</text>`);
    }
  }
  out.push("</svg>");
  return out.join("");
}
