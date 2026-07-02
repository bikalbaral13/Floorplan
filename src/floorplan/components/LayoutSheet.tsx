import type { GraphPropDef, GraphAttrValue } from "../types";

/** "Layout" view overlay — turns the live canvas into a paper-space sheet.
 *
 *  Like {@link AlignedElevations}, this is a `pointer-events-none` SVG drawn over the canvas so the
 *  plan in the CENTRE stays fully editable (the viewport), while the OUTER part becomes a printable
 *  paper template: a double drawing border plus a full-height TITLE BLOCK running down the right edge.
 *
 *  The title-block content follows the standard architectural / ISO 7200 / ANSI conventions — firm
 *  identity, project + client, drawing title & discipline, drawn/checked/approved, project & sheet
 *  numbers, document status, a revision history table, a professional seal area, and a copyright /
 *  disclaimer note. Every field is an optional prop with a placeholder default so the sheet renders
 *  out of the box; wire real project metadata (and an editable panel) in later without touching geometry. */
export interface SheetRevision {
  rev: string;
  date: string;
  description: string;
  by: string;
}

export interface LayoutSheetProps {
  width: number;
  height: number;

  // Firm / consultant identity.
  firmName?: string;
  firmAddress?: string;
  firmContact?: string;

  // Project & client.
  projectName?: string;
  projectAddress?: string;
  client?: string;

  // Drawing identity.
  drawingTitle?: string;
  discipline?: string;
  status?: string; // e.g. "FOR CONSTRUCTION", "FOR TENDER", "PRELIMINARY"

  // Approval / admin.
  drawnBy?: string;
  checkedBy?: string;
  approvedBy?: string;
  date?: string;
  scale?: string;
  projectNo?: string;
  sheetNo?: string;
  sheetSize?: string; // e.g. "A1"
  revisionLevel?: string;
  /** North arrow rotation in degrees (clockwise). 0 = arrow points up. */
  northRotation?: number;

  // Revision history.
  revisions?: SheetRevision[];

  // Legal note printed at the foot of the title block.
  disclaimer?: string;

  /** Highlight the title-block strip (it's the selected "Information" record). */
  selected?: boolean;
  /** When provided, the strip becomes clickable and selects the Information record. */
  onSelectTitleBlock?: () => void;
}

export function LayoutSheet({
  width,
  height,
  firmName = "CONSULTANCY / FIRM NAME",
  firmAddress = "Street Address, City, Country",
  firmContact = "+00 000 0000  ·  info@firm.com",
  projectName = "PROJECT NAME",
  projectAddress = "Plot / Street, City",
  client = "CLIENT NAME",
  drawingTitle = "GROUND FLOOR PLAN",
  discipline = "ARCHITECTURAL",
  status = "FOR CONSTRUCTION",
  drawnBy = "—",
  checkedBy = "—",
  approvedBy = "—",
  date = "—",
  scale = "1:100",
  projectNo = "—",
  sheetNo = "A-101",
  sheetSize = "A1",
  revisionLevel = "0",
  northRotation = 0,
  revisions = [],
  disclaimer = "© This drawing is the property of the firm and may not be reproduced or used without written consent. Do not scale off this drawing — use figured dimensions only. Contractor to verify all dimensions on site.",
  selected = false,
  onSelectTitleBlock,
}: LayoutSheetProps) {
  if (width < 120 || height < 120) return null;

  const ink = "#0f172a";
  const muted = "#64748b";
  const faint = "#94a3b8";
  const tint = "#f1f5f9";

  // Sheet margins: heavy outer rule + lighter inner drawing frame (classic architectural border).
  const outer = 8;
  const inner = 18;

  // ── Title-block strip down the full right edge ──
  const stripW = Math.min(300, Math.max(210, width * 0.2));
  const stripX = width - inner - stripW;
  const top = inner;
  const bottom = height - inner;
  const avail = bottom - top;
  const padX = 8;
  const lx = stripX + padX; // left text x inside the strip

  // ── Text helpers ──
  const label = (t: string, x: number, y: number, anchor: "start" | "middle" = "start") => (
    <text x={x} y={y} fontSize={7} fontWeight={700} fill={muted} textAnchor={anchor} style={{ letterSpacing: "0.07em" }}>
      {t}
    </text>
  );
  const value = (t: string, x: number, y: number, size = 10, weight = 600, anchor: "start" | "middle" = "start", fill = ink) => (
    <text x={x} y={y} fontSize={size} fontWeight={weight} fill={fill} textAnchor={anchor}>
      {t}
    </text>
  );
  const hline = (y: number) => <line x1={stripX} y1={y} x2={stripX + stripW} y2={y} stroke={ink} strokeWidth={0.6} />;

  // ── Vertical section layout: distribute the available height by weight so the strip always fills. ──
  const sections = [
    { key: "firm", weight: 1.3 },
    { key: "project", weight: 1.5 },
    { key: "drawing", weight: 1.2 },
    { key: "admin", weight: 1.6 },
    { key: "northscale", weight: 0.9 },
    { key: "revisions", weight: 1.7 },
    { key: "seal", weight: 1.3 },
    { key: "footer", weight: 0.9 },
  ] as const;
  const totalW = sections.reduce((s, b) => s + b.weight, 0);
  let cy = top;
  const band: Record<string, { y: number; h: number }> = {};
  for (const s of sections) {
    const h = (avail * s.weight) / totalW;
    band[s.key] = { y: cy, h };
    cy += h;
  }

  const sectionContent: JSX.Element[] = [];

  // 1) Firm identity (logo placeholder + name + address + contact).
  {
    const b = band.firm;
    sectionContent.push(
      <g key="firm">
        <rect x={lx} y={b.y + 8} width={26} height={26} fill="none" stroke={faint} strokeWidth={1} />
        <text x={lx + 13} y={b.y + 25} fontSize={9} fontWeight={700} fill={faint} textAnchor="middle">LOGO</text>
        {value(firmName, lx + 34, b.y + 19, 11, 700)}
        {value(firmAddress, lx + 34, b.y + 32, 7.5, 500, "start", muted)}
        {value(firmContact, lx, b.y + b.h - 6, 7.5, 500, "start", muted)}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 2) Project + client.
  {
    const b = band.project;
    sectionContent.push(
      <g key="project">
        {label("PROJECT", lx, b.y + 12)}
        {value(projectName, lx, b.y + 25, 11, 700)}
        {value(projectAddress, lx, b.y + 38, 8, 500, "start", muted)}
        {label("CLIENT", lx, b.y + b.h - 16)}
        {value(client, lx, b.y + b.h - 5, 9.5, 600)}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 3) Drawing title + discipline + status.
  {
    const b = band.drawing;
    const midY = b.y + b.h * 0.6;
    sectionContent.push(
      <g key="drawing">
        {label("DRAWING TITLE", lx, b.y + 12)}
        {value(drawingTitle, lx, b.y + 26, 12, 700)}
        <line x1={stripX} y1={midY} x2={stripX + stripW} y2={midY} stroke={faint} strokeWidth={0.5} />
        {label("DISCIPLINE", lx, midY + 12)}
        {value(discipline, lx, midY + 23, 9)}
        {/* Status badge, right-aligned. */}
        <rect x={stripX + stripW - 116} y={midY + 6} width={108} height={18} fill={ink} />
        {value(status, stripX + stripW - 62, midY + 18, 8.5, 700, "middle", "#ffffff")}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 4) Admin grid — Drawn / Checked / Approved on one row, Date / Scale / Project No on the next.
  {
    const b = band.admin;
    const c1 = stripX + stripW / 3;
    const c2 = stripX + (2 * stripW) / 3;
    const rowY = b.y + b.h / 2;
    sectionContent.push(
      <g key="admin">
        {/* column dividers */}
        <line x1={c1} y1={b.y} x2={c1} y2={b.y + b.h} stroke={faint} strokeWidth={0.5} />
        <line x1={c2} y1={b.y} x2={c2} y2={b.y + b.h} stroke={faint} strokeWidth={0.5} />
        <line x1={stripX} y1={rowY} x2={stripX + stripW} y2={rowY} stroke={faint} strokeWidth={0.5} />
        {/* row 1 */}
        {label("DRAWN", lx, b.y + 11)}
        {value(drawnBy, lx, b.y + 24, 10)}
        {label("CHECKED", c1 + padX, b.y + 11)}
        {value(checkedBy, c1 + padX, b.y + 24, 10)}
        {label("APPROVED", c2 + padX, b.y + 11)}
        {value(approvedBy, c2 + padX, b.y + 24, 10)}
        {/* row 2 */}
        {label("DATE", lx, rowY + 11)}
        {value(date, lx, rowY + 24, 9)}
        {label("PROJECT NO", c1 + padX, rowY + 11)}
        {value(projectNo, c1 + padX, rowY + 24, 10)}
        {label("SHEET SIZE", c2 + padX, rowY + 11)}
        {value(sheetSize, c2 + padX, rowY + 24, 10)}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 5) North arrow + scale.
  {
    const b = band.northscale;
    const nCx = stripX + stripW * 0.22;
    const nCy = b.y + b.h / 2;
    const nR = Math.min(20, b.h / 2 - 6);
    sectionContent.push(
      <g key="northscale">
        <circle cx={nCx} cy={nCy} r={nR} fill="#ffffff" stroke={ink} strokeWidth={1} />
        {/* Needle rotates with northRotation (clockwise); the "N" cap rotates with it so it tracks the arrow. */}
        <g transform={northRotation ? `rotate(${northRotation} ${nCx} ${nCy})` : undefined}>
          <polygon points={`${nCx},${nCy - nR + 4} ${nCx - 5},${nCy + 4} ${nCx},${nCy} ${nCx + 5},${nCy + 4}`} fill={ink} />
          {value("N", nCx, nCy + nR - 2, 8, 700, "middle")}
        </g>
        <line x1={stripX + stripW * 0.42} y1={b.y} x2={stripX + stripW * 0.42} y2={b.y + b.h} stroke={faint} strokeWidth={0.5} />
        {label("SCALE", stripX + stripW * 0.42 + padX, nCy - 4)}
        {value(scale, stripX + stripW * 0.42 + padX, nCy + 12, 13, 700)}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 6) Revision history table — REV / DATE / DESCRIPTION / BY.
  {
    const b = band.revisions;
    const cols = [stripX, stripX + stripW * 0.14, stripX + stripW * 0.42, stripX + stripW * 0.86, stripX + stripW];
    const headerY = b.y + 14;
    const bodyTop = b.y + 18;
    const rows = Math.max(1, Math.floor((b.y + b.h - bodyTop) / 14));
    const rowH = (b.y + b.h - bodyTop) / rows;
    const headers = ["REV", "DATE", "DESCRIPTION", "BY"];
    sectionContent.push(
      <g key="revisions">
        <rect x={stripX} y={b.y} width={stripW} height={18} fill={tint} stroke={faint} strokeWidth={0.5} />
        {headers.map((h, i) => label(h, cols[i] + 4, headerY))}
        {/* column dividers */}
        {cols.slice(1, -1).map((cxp, i) => (
          <line key={`c${i}`} x1={cxp} y1={b.y} x2={cxp} y2={b.y + b.h} stroke={faint} strokeWidth={0.5} />
        ))}
        {/* body rows */}
        {Array.from({ length: rows }).map((_, r) => {
          const ry = bodyTop + rowH * r;
          const rev = revisions[r];
          return (
            <g key={`r${r}`}>
              <line x1={stripX} y1={ry} x2={stripX + stripW} y2={ry} stroke={faint} strokeWidth={0.4} />
              {rev && (
                <>
                  {value(rev.rev, cols[0] + 4, ry + rowH - 4, 8)}
                  {value(rev.date, cols[1] + 4, ry + rowH - 4, 8)}
                  {value(rev.description, cols[2] + 4, ry + rowH - 4, 8, 500)}
                  {value(rev.by, cols[3] + 4, ry + rowH - 4, 8)}
                </>
              )}
            </g>
          );
        })}
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 7) Seal / stamp area.
  {
    const b = band.seal;
    sectionContent.push(
      <g key="seal">
        {label("SEAL / STAMP", lx, b.y + 12)}
        <rect
          x={stripX + stripW / 2 - Math.min(46, b.h / 2 - 8)}
          y={b.y + 18}
          width={Math.min(92, b.h - 16)}
          height={Math.min(92, b.h - 16)}
          rx={Math.min(46, b.h / 2 - 8)}
          fill="none"
          stroke={faint}
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        {hline(b.y + b.h)}
      </g>
    );
  }

  // 8) Footer — big sheet number + revision level, and the legal disclaimer.
  {
    const b = band.footer;
    const splitX = stripX + stripW * 0.62;
    const noteY = b.y + b.h * 0.5;
    sectionContent.push(
      <g key="footer">
        <line x1={splitX} y1={b.y} x2={splitX} y2={noteY} stroke={faint} strokeWidth={0.5} />
        {label("SHEET NO", lx, b.y + 12)}
        {value(sheetNo, lx, b.y + 30, 16, 700)}
        {label("REV", splitX + padX, b.y + 12)}
        {value(revisionLevel, splitX + padX, b.y + 30, 16, 700)}
        <line x1={stripX} y1={noteY} x2={stripX + stripW} y2={noteY} stroke={faint} strokeWidth={0.5} />
        {/* Disclaimer wrapped into short lines (SVG has no auto-wrap). */}
        <text x={lx} y={noteY + 12} fontSize={6} fill={muted}>
          {wrap(disclaimer, 56).slice(0, Math.max(1, Math.floor((b.h - (noteY - b.y) - 8) / 8))).map((line, i) => (
            <tspan key={i} x={lx} dy={i === 0 ? 0 : 8}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  }

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-20"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {/* ── Drawing border (double rule). Transparent fill keeps the centre/plan viewport clear. ── */}
      <rect x={outer} y={outer} width={width - outer * 2} height={height - outer * 2} fill="none" stroke={ink} strokeWidth={2} />
      <rect x={inner} y={inner} width={width - inner * 2} height={height - inner * 2} fill="none" stroke={ink} strokeWidth={1} />

      {/* ── Title block strip (opaque) down the full right edge. Clickable → selects the Information
            record so its fields edit in the Properties tab. ── */}
      <rect
        x={stripX}
        y={top}
        width={stripW}
        height={avail}
        fill="#ffffff"
        stroke={selected ? "#0284c7" : ink}
        strokeWidth={selected ? 2 : 1}
        style={onSelectTitleBlock ? { pointerEvents: "auto", cursor: "pointer" } : undefined}
        onClick={onSelectTitleBlock}
      />
      {sectionContent}
    </svg>
  );
}

/** Maps an Information-schema property `role` → the {@link LayoutSheetProps} field it drives. Give a
 *  Schema-node "Information Schema" row one of these roles to bind it to the title block. The role is
 *  also the storage key in `graphAttrs.information` (SchemaPropsBlock keys values by `role ?? key`), so
 *  editing the field in the Properties tab flows straight onto the sheet. */
export const INFO_ROLE_TO_PROP: Record<string, keyof LayoutSheetProps> = {
  "firm-name": "firmName",
  "firm-address": "firmAddress",
  "firm-contact": "firmContact",
  "project-name": "projectName",
  "project-address": "projectAddress",
  client: "client",
  "drawing-title": "drawingTitle",
  discipline: "discipline",
  status: "status",
  "drawn-by": "drawnBy",
  "checked-by": "checkedBy",
  "approved-by": "approvedBy",
  date: "date",
  scale: "scale",
  "project-no": "projectNo",
  "sheet-no": "sheetNo",
  "sheet-size": "sheetSize",
  "revision-level": "revisionLevel",
  disclaimer: "disclaimer",
};

/** Resolve the role-bound Information-schema values for one record into {@link LayoutSheetProps}. Reads
 *  each def's stored value (keyed by `role ?? key`, matching SchemaPropsBlock), falling back to the
 *  schema default; blanks are dropped so the component's own placeholder defaults survive. */
export function resolveLayoutSheetProps(
  defs: GraphPropDef[],
  attrs: Record<string, GraphAttrValue> | undefined,
): Partial<LayoutSheetProps> {
  const out: Partial<LayoutSheetProps> = {};
  // Read one role's resolved value (stored value → schema default), blank → undefined.
  const byRole = (role: string): string | undefined => {
    const d = defs.find((x) => x.role === role);
    if (!d) return undefined;
    const v = attrs?.[d.role || d.key] ?? d.default;
    return v == null || v === "" ? undefined : String(v);
  };

  for (const d of defs) {
    const prop = d.role ? INFO_ROLE_TO_PROP[d.role] : undefined;
    if (!prop) continue;
    const storeKey = d.role || d.key;
    const v = attrs?.[storeKey] ?? d.default;
    if (v == null || v === "") continue;
    // All scalar title-block fields are strings; coerce safely.
    (out as Record<string, string>)[prop] = String(v);
  }

  // Revision table — assembled from flat roles rev{N}-no / -date / -desc / -by (N = 1…8). A row is
  // emitted when any of its cells has a value, so the schema needs no array-typed field.
  const revisions: SheetRevision[] = [];
  for (let i = 1; i <= 8; i++) {
    const no = byRole(`rev${i}-no`);
    const date = byRole(`rev${i}-date`);
    const description = byRole(`rev${i}-desc`);
    const by = byRole(`rev${i}-by`);
    if (no || date || description || by) {
      revisions.push({ rev: no ?? String(i), date: date ?? "", description: description ?? "", by: by ?? "" });
    }
  }
  if (revisions.length) out.revisions = revisions;

  // North rotation — a number, so resolve it explicitly rather than through the string-valued role map.
  const north = byRole("north-rotation");
  if (north != null) {
    const n = parseFloat(north);
    if (Number.isFinite(n)) out.northRotation = n;
  }

  return out;
}

/** Greedy word-wrap to a max character count per line (SVG <text> has no auto-wrap). */
function wrap(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur.length) cur = w;
    else if (cur.length + 1 + w.length <= maxChars) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur.length) lines.push(cur);
  return lines;
}
