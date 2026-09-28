/** Server-side PREVIEW of a standard plan — plan JSON → SVG → PNG, with no browser and no editor. It is
 *  how a headless agent (server/designMcp.mjs) SEES what it drew.
 *
 *  A preview, not the editor's drawing. Parametric objects are NOT evaluated here — that needs the whole
 *  engine and the object graphs — so each one is drawn from its host and its params:
 *    walls     the segment band at its thickness (square caps, so corners and T-junctions close)
 *    doors     a gap with the leaf and its swing arc, from width / hinge / swing / leaves / flip
 *    windows   a gap with jambs and the glazing lines
 *    objects   a labelled footprint box from width·depth (or length·breadth / diameter), turned by rotation
 *    spaces    their polygon, label and area
 *  so it answers "is the layout right" — room sizes, which wall the door is in and which way it swings,
 *  whether the bed fits — not "what will it look like".
 *
 *  Rasterised with resvg. Vercel has no system fonts, so the one font the labels use ships next to this
 *  file (fonts/DejaVuSans.ttf, Bitstream Vera licence — fonts/DejaVu-LICENSE.txt). */

import { fileURLToPath } from "node:url";

const FONT = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const DEFAULT_PPM = 50;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const f = (v) => +Number(v).toFixed(2);
const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(+v) ? +v : undefined);

/** The object kind an attachment draws as, from its id / path. */
function kindOf(att) {
  const s = `${att.objectId ?? ""} ${att.objectPath ?? ""}`.toLowerCase();
  if (/wall-with-math|\/wall\.json/.test(s)) return "wall";
  if (/window/.test(s)) return "window";
  if (/door|gate/.test(s)) return "door";
  if (/opening/.test(s)) return "opening";
  return "other";
}
const niceName = (att) => String(att.objectId ?? att.objectPath ?? "object").split("/").pop().replace(/\.json$/, "").replace(/-with-math$/, "").replace(/[-_.]+/g, " ");

/** Footprint in metres from an object's params (overrides over defaults). */
function footprint(params) {
  const p = (k) => num(params[k]);
  const r = p("radius");
  const dia = p("diameter") ?? (r !== undefined ? r * 2 : undefined);
  const w = p("width") ?? p("length") ?? p("columnWidth") ?? p("baseWidth") ?? dia ?? 0.6;
  const d = p("depth") ?? p("breadth") ?? p("columnDepth") ?? p("baseDepth") ?? dia ?? (p("width") !== undefined && p("length") !== undefined ? p("length") : 0.6);
  return { w: Math.max(0.05, w), d: Math.max(0.05, d), round: dia !== undefined && p("width") === undefined };
}

/** @param plan standard plan  @param opts { level, widthPx, defaultsFor(att) → params|undefined, title } */
export function renderDesignSvg(plan, opts = {}) {
  const levels = Array.isArray(plan.levels) && plan.levels.length ? plan.levels : null;
  const c = levels ? (opts.level ? levels.find((l) => l.id === opts.level || l.name === opts.level) ?? levels[0] : levels[0]) : plan;
  const ppm = Number(plan.settings?.pixelsPerMeter) || DEFAULT_PPM;
  const nodes = new Map((c.nodes ?? []).map((n) => [n.id, n]));
  const segs = c.segments ?? [];
  const spaces = c.spaces ?? [];
  const P = (id) => nodes.get(id);

  // Bounds over everything drawn, padded; world px throughout, the viewBox does the scaling.
  const pts = [...nodes.values()];
  if (!pts.length) throw new Error("the design is empty — nothing to render");
  let minX = Math.min(...pts.map((n) => n.x)), maxX = Math.max(...pts.map((n) => n.x));
  let minY = Math.min(...pts.map((n) => n.y)), maxY = Math.max(...pts.map((n) => n.y));
  const pad = Math.max(1.2 * ppm, 0.08 * Math.max(maxX - minX, maxY - minY));
  minX -= pad; maxX += pad; minY -= pad; maxY += pad * 1.4;           // extra room under the plan for the scale bar
  const W = Math.max(maxX - minX, ppm), H = Math.max(maxY - minY, ppm);
  const widthPx = Math.min(2400, Math.max(400, Math.round(opts.widthPx ?? 1200)));
  const heightPx = Math.round((widthPx * H) / W);
  const k = W / widthPx;                                             // world px per output px
  const fs = (px) => f(px * k);                                      // an on-screen size in world units

  const defaults = (att) => ({ ...(opts.defaultsFor?.(att) ?? {}), ...(att.params ?? {}) });
  const out = [];
  const legend = { walls: 0, doors: 0, windows: 0, openings: 0, objects: 0, spaces: spaces.length, lines: 0 };

  // ── spaces ──
  for (const sp of spaces) {
    const ring = (sp.nodeIds ?? []).map(P).filter(Boolean);
    if (ring.length < 3) continue;
    out.push(`<polygon points="${ring.map((n) => `${f(n.x)},${f(n.y)}`).join(" ")}" fill="${esc(sp.fill ?? "rgba(148,163,184,0.25)")}" fill-opacity="0.55" stroke="none"/>`);
  }

  // ── wall bands (non-opening wall pieces), drawn as one group so overlaps read as one mass ──
  const bands = [], lines = [], openings = [];
  for (const s of segs) {
    const a = P(s.fromNodeId), b = P(s.toNodeId);
    if (!a || !b || s.fromNodeId === s.toNodeId) continue;
    if (s.isObjectOpening) { openings.push({ s, a, b }); continue; }
    if (s.mode === "line" || !(s.thickness > 2)) { lines.push({ s, a, b }); continue; }
    bands.push({ s, a, b });
  }
  // BUTT ends, then a square joint at every node where wall pieces meet (or a wall ends free). NOT square
  // caps: a cap would also poke half a thickness into every door and window gap, drawing the opening
  // narrower than it is — so a node that touches an opening gets no joint, and the jamb stays flush.
  out.push(`<g stroke="#334155" stroke-linecap="butt" fill="none">`);
  for (const { s, a, b } of bands) out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke-width="${f(s.thickness)}"/>`);
  out.push(`</g>`);
  const joint = new Map();                                             // nodeId → { t: max thickness, open: touches an opening }
  for (const { s } of bands) for (const id of [s.fromNodeId, s.toNodeId]) {
    const j = joint.get(id) ?? { t: 0, open: false };
    j.t = Math.max(j.t, s.thickness);
    joint.set(id, j);
  }
  for (const { s } of openings) for (const id of [s.fromNodeId, s.toNodeId]) { const j = joint.get(id); if (j) j.open = true; }
  out.push(`<g fill="#334155">`);
  for (const [id, j] of joint) {
    if (j.open) continue;
    const n = P(id);
    out.push(`<rect x="${f(n.x - j.t / 2)}" y="${f(n.y - j.t / 2)}" width="${f(j.t)}" height="${f(j.t)}"/>`);
  }
  out.push(`</g>`);
  // A light core line shows each piece's centreline and where the pieces split.
  out.push(`<g stroke="#94a3b8" stroke-width="${fs(0.6)}">`);
  for (const { a, b } of bands) out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}"/>`);
  out.push(`</g>`);
  legend.walls = bands.length;
  for (const { s, a, b } of lines) {
    out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="${esc(s.color ?? "#475569")}" stroke-width="${fs(1.2)}"${s.dashed ? ` stroke-dasharray="${fs(6)} ${fs(4)}"` : ""}/>`);
    legend.lines++;
  }

  // ── openings: a gap in the band, then the object that fills it ──
  for (const { s, a, b } of openings) {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const u = { x: (b.x - a.x) / L, y: (b.y - a.y) / L }, n = { x: -u.y, y: u.x };
    const t = s.thickness > 2 ? s.thickness : 0.15 * ppm;
    const jamb = (p) => `<line x1="${f(p.x + n.x * t / 2)}" y1="${f(p.y + n.y * t / 2)}" x2="${f(p.x - n.x * t / 2)}" y2="${f(p.y - n.y * t / 2)}" stroke="#334155" stroke-width="${fs(1.4)}"/>`;
    out.push(jamb(a), jamb(b));
    const att = (s.attachments ?? []).find((x) => kindOf(x) !== "wall");
    const kind = att ? kindOf(att) : "opening";
    const p = att ? defaults(att) : {};
    if (kind === "window") {
      legend.windows++;
      for (const off of [-t / 4, 0, t / 4]) {
        out.push(`<line x1="${f(a.x + n.x * off)}" y1="${f(a.y + n.y * off)}" x2="${f(b.x + n.x * off)}" y2="${f(b.y + n.y * off)}" stroke="#0e7490" stroke-width="${fs(off === 0 ? 1.6 : 1)}"/>`);
      }
    } else if (kind === "door") {
      legend.doors++;
      const double = String(p.leaves ?? "").toLowerCase() === "double";
      // Swing side: "left"/"right" of the run's direction, mirrored by flip.
      let side = String(p.swing ?? "left").toLowerCase() === "right" ? -1 : 1;
      if (att.flip) side = -side;
      const hingeAtStart = String(p.hinge ?? "left").toLowerCase() !== "right";
      const leaf = (H, dir, len) => {
        const tip = { x: H.x + n.x * side * len, y: H.y + n.y * side * len };
        const end = { x: H.x + u.x * dir * len, y: H.y + u.y * dir * len };
        const sweep = (dir * side > 0) ? 1 : 0;
        return `<line x1="${f(H.x)}" y1="${f(H.y)}" x2="${f(tip.x)}" y2="${f(tip.y)}" stroke="#b91c1c" stroke-width="${fs(1.6)}"/>`
          + `<path d="M ${f(tip.x)} ${f(tip.y)} A ${f(len)} ${f(len)} 0 0 ${sweep} ${f(end.x)} ${f(end.y)}" fill="none" stroke="#b91c1c" stroke-width="${fs(0.9)}" stroke-dasharray="${fs(4)} ${fs(3)}"/>`;
      };
      if (double) out.push(leaf(a, 1, L / 2), leaf(b, -1, L / 2));
      else out.push(hingeAtStart ? leaf(a, 1, L) : leaf(b, -1, L));
    } else {
      legend.openings++;
      out.push(`<line x1="${f(a.x)}" y1="${f(a.y)}" x2="${f(b.x)}" y2="${f(b.y)}" stroke="#64748b" stroke-width="${fs(1)}" stroke-dasharray="${fs(5)} ${fs(4)}"/>`);
    }
  }

  // ── node objects: footprint boxes ──
  for (const nd of nodes.values()) {
    for (const att of nd.attachments ?? []) {
      const p = defaults(att);
      const { w, d, round } = footprint(p);
      const rot = num(p.rotation) ?? 0;
      const name = niceName(att);
      legend.objects++;
      const box = round
        ? `<ellipse cx="0" cy="0" rx="${f((w * ppm) / 2)}" ry="${f((d * ppm) / 2)}"/>`
        : `<rect x="${f((-w * ppm) / 2)}" y="${f((-d * ppm) / 2)}" width="${f(w * ppm)}" height="${f(d * ppm)}"/>`;
      // A tick on the local +y edge shows which way the object is turned.
      out.push(`<g transform="translate(${f(nd.x)} ${f(nd.y)}) rotate(${f(rot)})" fill="rgba(124,58,237,0.10)" stroke="#7c3aed" stroke-width="${fs(1.2)}">${box}`
        + `<line x1="0" y1="${f((d * ppm) / 2)}" x2="0" y2="${f((d * ppm) / 2 - Math.min(w, d) * ppm * 0.25)}"/></g>`);
      out.push(`<text x="${f(nd.x)}" y="${f(nd.y + fs(4))}" font-size="${fs(11)}" fill="#5b21b6" text-anchor="middle">${esc(name)}</text>`);
    }
  }

  // ── space labels last, so they sit on top ──
  for (const [i, sp] of spaces.entries()) {
    const ring = (sp.nodeIds ?? []).map(P).filter(Boolean);
    if (ring.length < 3) continue;
    // A traced space often has no label, only an internal id — name it by its type, or its number.
    const name = sp.label || sp.name || (sp.roomType && sp.roomType !== "room" ? sp.roomType : `Space ${i + 1}`);
    let A = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i], q = ring[(i + 1) % ring.length], cr = p.x * q.y - q.x * p.y;
      A += cr; cx += (p.x + q.x) * cr; cy += (p.y + q.y) * cr;
    }
    if (Math.abs(A) < 1e-9) continue;
    cx /= 3 * A; cy /= 3 * A;
    const area = Math.abs(A) / 2 / ppm ** 2;
    out.push(`<text x="${f(cx)}" y="${f(cy)}" font-size="${fs(15)}" fill="#0f172a" text-anchor="middle" font-weight="bold">${esc(name)}</text>`);
    out.push(`<text x="${f(cx)}" y="${f(cy + fs(17))}" font-size="${fs(12)}" fill="#334155" text-anchor="middle">${area.toFixed(1)} m²</text>`);
  }

  // ── overall dimensions, scale bar, title ──
  const bx0 = Math.min(...pts.map((n) => n.x)), bx1 = Math.max(...pts.map((n) => n.x));
  const by0 = Math.min(...pts.map((n) => n.y)), by1 = Math.max(...pts.map((n) => n.y));
  const dimY = by0 - fs(28), dimX = bx0 - fs(28);
  const dim = (x1, y1, x2, y2, label, vertical) => {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    return `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="#b45309" stroke-width="${fs(1)}"/>`
      + `<text x="${f(mx)}" y="${f(my - fs(5))}" font-size="${fs(12)}" fill="#b45309" text-anchor="middle"${vertical ? ` transform="rotate(-90 ${f(mx)} ${f(my)})"` : ""}>${label}</text>`;
  };
  out.push(dim(bx0, dimY, bx1, dimY, `${((bx1 - bx0) / ppm).toFixed(2)} m`, false));
  out.push(dim(dimX, by0, dimX, by1, `${((by1 - by0) / ppm).toFixed(2)} m`, true));
  const span = (bx1 - bx0) / ppm;
  const barM = [0.5, 1, 2, 5, 10, 20, 50, 100].find((m) => m >= span / 5) ?? 100;
  const sx = bx0, sy = by1 + pad * 0.9;
  out.push(`<rect x="${f(sx)}" y="${f(sy)}" width="${f(barM * ppm)}" height="${fs(5)}" fill="#0f172a"/>`
    + `<text x="${f(sx + barM * ppm + fs(6))}" y="${f(sy + fs(5))}" font-size="${fs(12)}" fill="#0f172a">${barM} m</text>`);
  if (opts.title) out.push(`<text x="${f(bx1)}" y="${f(sy + fs(5))}" font-size="${fs(12)}" fill="#64748b" text-anchor="end">${esc(opts.title)}</text>`);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="${f(minX)} ${f(minY)} ${f(W)} ${f(H)}" font-family="DejaVu Sans">`
    + `<rect x="${f(minX)}" y="${f(minY)}" width="${f(W)}" height="${f(H)}" fill="#ffffff"/>${out.join("")}</svg>`;
  return { svg, widthPx, heightPx, legend, boundsM: { width: +((bx1 - bx0) / ppm).toFixed(2), height: +((by1 - by0) / ppm).toFixed(2) } };
}

/** SVG → PNG bytes. resvg is loaded lazily so the library tools never pay for the native module. */
export async function svgToPng(svg) {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, { font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: "DejaVu Sans" }, background: "#ffffff" });
  return r.render().asPng();
}
