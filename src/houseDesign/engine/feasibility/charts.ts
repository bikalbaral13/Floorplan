// Tiny dependency-free SVG chart renderer. The same spec (stored in the JSON
// report) renders identically in the calculation workbench and the HTML
// report. Supports line / point / bar series, log axes, reference markers.

export interface Series {
  name: string;
  points: [number, number][];
  style?: "line" | "points" | "bar" | "linepoints";
  dashed?: boolean;
}

export interface Axis {
  label: string;
  log?: boolean;
  min?: number;
  max?: number;
  categories?: string[]; // bar/category x axis (x = index)
}

export interface Marker {
  x?: number;
  y?: number;
  label: string;
}

export interface ChartSpec {
  x: Axis;
  y: Axis;
  series: Series[];
  markers?: Marker[];
  width?: number;
  height?: number;
}

// Reference categorical palette (validated order; light surface).
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

function logTicks(min: number, max: number): number[] {
  const decades = Math.log10(max) - Math.log10(min);
  const mult = decades <= 1.5 ? [1, 2, 3, 5, 7] : decades <= 3 ? [1, 2, 5] : [1];
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(min)); e <= Math.ceil(Math.log10(max)); e++) {
    for (const m of mult) {
      const v = m * Math.pow(10, e);
      if (v >= min * 0.999 && v <= max * 1.001) out.push(v);
    }
  }
  return out;
}

function fmtTick(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`;
  if (a >= 1e4) return `${(v / 1e3).toLocaleString(undefined, { maximumFractionDigits: 0 })}k`;
  if (a >= 100) return v.toFixed(0);
  if (a >= 1) return String(Number(v.toFixed(2)));
  if (a === 0) return "0";
  return String(Number(v.toPrecision(2)));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderChart(spec: ChartSpec): string {
  const W = spec.width ?? 640;
  const H = spec.height ?? 340;
  // Legend layout (wraps into rows) — computed first so the plot starts below it.
  const legend: { x: number; y: number; si: number }[] = [];
  if (spec.series.length > 1) {
    let lx = 64;
    let ly = 15;
    spec.series.forEach((s, si) => {
      const w = 26 + s.name.length * 6.2;
      if (lx + w > W - 16 && lx > 64) {
        lx = 64;
        ly += 16;
      }
      legend.push({ x: lx, y: ly, si });
      lx += w;
    });
  }
  const H2 = H + (legend.length ? legend[legend.length - 1].y - 15 : 0);
  const m = { l: 64, r: 16, t: legend.length ? legend[legend.length - 1].y + 16 : 14, b: 48 };
  const pw = W - m.l - m.r;
  const ph = H2 - m.t - m.b;
  const cat = spec.x.categories;
  const all = spec.series.flatMap((s) => s.points).filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const hasBar = spec.series.some((s) => s.style === "bar");

  let xmin = spec.x.min ?? (cat ? -0.5 : Math.min(...xs));
  let xmax = spec.x.max ?? (cat ? cat.length - 0.5 : Math.max(...xs));
  let ymin = spec.y.min ?? Math.min(...ys, hasBar ? 0 : Infinity);
  let ymax = spec.y.max ?? Math.max(...ys);
  if (!spec.y.log && spec.y.min == null) {
    const pad = (ymax - ymin) * 0.06 || 1;
    ymin = ymin >= 0 && ymin - pad < 0 ? 0 : ymin - (ymin === 0 ? 0 : pad);
    ymax += pad;
  }
  if (spec.x.log) { xmin = Math.max(xmin, 1e-9); }
  if (spec.y.log) { ymin = Math.max(ymin, 1e-9); }
  if (xmax === xmin) xmax = xmin + 1;
  if (ymax === ymin) ymax = ymin + 1;

  const sx = (v: number) =>
    m.l + (spec.x.log ? (Math.log10(v) - Math.log10(xmin)) / (Math.log10(xmax) - Math.log10(xmin)) : (v - xmin) / (xmax - xmin)) * pw;
  const sy = (v: number) =>
    m.t + ph - (spec.y.log ? (Math.log10(v) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin)) : (v - ymin) / (ymax - ymin)) * ph;

  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H2}" width="100%" style="max-width:${W}px;font-family:inherit;font-size:11px" role="img">`);
  parts.push(`<rect x="0" y="0" width="${W}" height="${H2}" fill="#ffffff"/>`);

  // grid + y ticks
  const yt = spec.y.log ? logTicks(ymin, ymax) : niceTicks(ymin, ymax);
  for (const v of yt) {
    const y = sy(v);
    parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="#e5e5e2" stroke-width="1"/>`);
    parts.push(`<text x="${m.l - 6}" y="${y + 4}" text-anchor="end" fill="#52514e">${fmtTick(v)}</text>`);
  }
  // x ticks
  if (cat) {
    cat.forEach((c, i) => {
      parts.push(`<text x="${sx(i)}" y="${m.t + ph + 16}" text-anchor="middle" fill="#52514e">${esc(c)}</text>`);
    });
  } else {
    const xt = spec.x.log ? logTicks(xmin, xmax) : niceTicks(xmin, xmax, 6);
    for (const v of xt) {
      const x = sx(v);
      parts.push(`<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}" stroke="#efefec" stroke-width="1"/>`);
      parts.push(`<text x="${x}" y="${m.t + ph + 16}" text-anchor="middle" fill="#52514e">${fmtTick(v)}</text>`);
    }
  }
  // axes
  parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${m.t + ph}" y2="${m.t + ph}" stroke="#8a8984" stroke-width="1"/>`);
  parts.push(`<line x1="${m.l}" x2="${m.l}" y1="${m.t}" y2="${m.t + ph}" stroke="#8a8984" stroke-width="1"/>`);
  parts.push(`<text x="${m.l + pw / 2}" y="${H2 - 10}" text-anchor="middle" fill="#0b0b0b">${esc(spec.x.label)}</text>`);
  parts.push(`<text transform="translate(14 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" fill="#0b0b0b">${esc(spec.y.label)}</text>`);

  // bars
  const bars = spec.series.filter((s) => s.style === "bar");
  const slot = cat ? pw / cat.length : 0;
  const bw = bars.length ? Math.max(2, (slot * 0.72) / bars.length - 2) : 0;
  spec.series.forEach((s, si) => {
    const color = PALETTE[si % PALETTE.length];
    const pts = s.points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]) && (!spec.x.log || p[0] > 0) && (!spec.y.log || p[1] > 0));
    if (s.style === "bar") {
      const bi = bars.indexOf(s);
      for (const [x, y] of pts) {
        const cx = sx(x) - (bars.length * (bw + 2)) / 2 + bi * (bw + 2) + 1;
        const y0 = sy(Math.max(ymin, 0));
        const y1 = sy(y);
        const top = Math.min(y0, y1);
        const h = Math.max(1, Math.abs(y0 - y1));
        parts.push(`<rect x="${cx}" y="${top}" width="${bw}" height="${h}" rx="2" fill="${color}"><title>${esc(s.name)}: ${fmtTick(y)}</title></rect>`);
      }
      return;
    }
    if (s.style !== "points") {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${sx(p[0]).toFixed(1)},${sy(p[1]).toFixed(1)}`).join("");
      parts.push(`<path d="${d}" fill="none" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="6 4"' : ""} stroke-linejoin="round"/>`);
    }
    if (s.style === "points" || s.style === "linepoints") {
      for (const [x, y] of pts) {
        parts.push(`<circle cx="${sx(x)}" cy="${sy(y)}" r="4" fill="${color}" stroke="#ffffff" stroke-width="1.5"><title>${esc(s.name)}: (${fmtTick(x)}, ${fmtTick(y)})</title></circle>`);
      }
    }
  });

  // markers
  for (const mk of spec.markers ?? []) {
    if (mk.x != null) {
      const x = sx(mk.x);
      parts.push(`<line x1="${x}" x2="${x}" y1="${m.t}" y2="${m.t + ph}" stroke="#0b0b0b" stroke-width="1" stroke-dasharray="3 3"/>`);
      parts.push(`<text x="${x + 4}" y="${m.t + 12}" fill="#0b0b0b">${esc(mk.label)}</text>`);
    }
    if (mk.y != null) {
      const y = sy(mk.y);
      parts.push(`<line x1="${m.l}" x2="${m.l + pw}" y1="${y}" y2="${y}" stroke="#0b0b0b" stroke-width="1" stroke-dasharray="3 3"/>`);
      parts.push(`<text x="${m.l + pw - 4}" y="${y - 4}" text-anchor="end" fill="#0b0b0b">${esc(mk.label)}</text>`);
    }
  }

  // legend (≥ 2 series)
  for (const { x: lx, y: ly, si } of legend) {
    const s = spec.series[si];
    const color = PALETTE[si % PALETTE.length];
    parts.push(s.style === "bar"
      ? `<rect x="${lx}" y="${ly - 5}" width="12" height="10" rx="2" fill="${color}"/>`
      : `<line x1="${lx}" x2="${lx + 14}" y1="${ly}" y2="${ly}" stroke="${color}" stroke-width="2" ${s.dashed ? 'stroke-dasharray="4 3"' : ""}/>`);
    parts.push(`<text x="${lx + 18}" y="${ly + 4}" fill="#0b0b0b">${esc(s.name)}</text>`);
  }
  parts.push("</svg>");
  return parts.join("");
}
