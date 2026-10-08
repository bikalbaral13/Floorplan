// Report document model. The JSON report is a tree of parts → chapters →
// sections → blocks. Numbering (chapters, sections, tables, figures,
// equations) is resolved when the document is built so the HTML renderer
// (and any other consumer) just prints what it is given.

import type { ChartSpec } from "./charts";
import type { DrawingSheet } from "./drawing";

export type Cell = string | number;

export type Block =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; number?: string }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "equation"; expr: string; tex?: string; where?: string[]; number?: string } // tex: LaTeX math; derived from expr when absent
  | { type: "calc"; lines: [string, string][] } // "label = expression" worked steps
  | { type: "kv"; rows: [string, string][]; caption?: string; number?: string }
  | { type: "table"; headers: Cell[][]; rows: Cell[][]; caption: string; number?: string; note?: string }
  | { type: "figure"; chart: ChartSpec; caption: string; number?: string }
  | { type: "drawing"; sheet: DrawingSheet; caption: string; number?: string }
  | { type: "check"; label: string; ok: boolean; detail: string }
  | { type: "note"; text: string }
  // (canvas app) raster images and video — room snapshots from the 3D view, the walkthrough film
  | { type: "images"; items: { src: string; caption: string }[]; caption?: string }
  | { type: "video"; src: string; caption: string; poster?: string };

export interface Section {
  title: string;
  number?: string;
  blocks: Block[];
  subsections?: Section[];
}

export interface Chapter {
  id: string;
  title: string;
  number?: string; // "1", "2" … or "A-1"
  intro?: Block[];
  sections: Section[];
}

export interface Part {
  id: string;
  title: string; // Heading0 (e.g. "INTRODUCTION", "APPENDIX-A")
  subtitle?: string;
  appendix?: string; // "A", "B" …
  chapters: Chapter[];
}

export interface ReportDocument {
  meta: {
    title: string;
    project: string;
    river: string;
    location: string;
    generated_at: string;
    generator: string;
  };
  cover: {
    institution: string[];
    title: string;
    subtitle: string;
    submittedBy: string[];
    submittedTo: string[];
    date: string;
  };
  frontMatter: { id: string; title: string; blocks: Block[] }[];
  salientFeatures: { group: string; rows: [string, string][] }[];
  abbreviations: [string, string][];
  parts: Part[];
  references: string[];
  lists: {
    contents: { level: number; number?: string; title: string }[];
    tables: { number: string; caption: string }[];
    figures: { number: string; caption: string }[];
    drawings: { number: string; caption: string }[];
  };
  summary: Record<string, number | string | boolean>;
}

// ---------- helpers for builders ----------

export const P = (text: string): Block => ({ type: "paragraph", text });
export const H = (text: string): Block => ({ type: "heading", text });
export const L = (items: string[], ordered = false): Block => ({ type: "list", items, ordered });
export const EQ = (expr: string, where?: string[], tex?: string): Block => ({ type: "equation", expr, where, tex });
export const CALC = (lines: [string, string][]): Block => ({ type: "calc", lines });
export const KV = (rows: [string, string][], caption?: string): Block => ({ type: "kv", rows, caption });
export const T = (caption: string, headers: Cell[] | Cell[][], rows: Cell[][], note?: string): Block => ({
  type: "table",
  caption,
  headers: Array.isArray(headers[0]) ? (headers as Cell[][]) : [headers as Cell[]],
  rows,
  note,
});
export const DRAW = (caption: string, sheet: DrawingSheet): Block => ({ type: "drawing", caption, sheet });
export const FIG = (caption: string, chart: ChartSpec): Block => ({ type: "figure", caption, chart });
export const CHECK = (label: string, ok: boolean, detail: string): Block => ({ type: "check", label, ok, detail });
export const NOTE = (text: string): Block => ({ type: "note", text });

export function f(n: number | null | undefined, d = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function money(n: number): string {
  return `NRs ${f(n, 2)}`;
}

/** Walk a document and assign table / figure / equation / section numbers. */
export function numberDocument(doc: ReportDocument): ReportDocument {
  const tables: { number: string; caption: string }[] = [];
  const figures: { number: string; caption: string }[] = [];
  const drawings: { number: string; caption: string }[] = [];
  const contents: { level: number; number?: string; title: string }[] = [];
  let chapterNo = 0;
  for (const part of doc.parts) {
    contents.push({ level: 0, title: part.appendix ? `${part.title} ${part.subtitle ? `(${part.subtitle})` : ""}`.trim() : part.title });
    part.chapters.forEach((ch, ci) => {
      const chNum = part.appendix ? `${part.appendix}-${ci + 1}` : String(++chapterNo);
      ch.number = chNum;
      contents.push({ level: 1, number: chNum, title: ch.title });
      let t = 0;
      let fg = 0;
      let eq = 0;
      const visit = (blocks: Block[]) => {
        for (const b of blocks) {
          if (b.type === "table" || (b.type === "kv" && b.caption)) {
            b.number = `${chNum}.${++t}`;
            tables.push({ number: b.number, caption: b.caption! });
          } else if (b.type === "figure") {
            b.number = `${chNum}.${++fg}`;
            figures.push({ number: b.number, caption: b.caption });
          } else if (b.type === "drawing") {
            b.number = b.sheet.sheetNo;
            drawings.push({ number: b.number, caption: b.caption });
          } else if (b.type === "equation") {
            b.number = `${chNum}.${++eq}`;
          }
        }
      };
      if (ch.intro) visit(ch.intro);
      ch.sections.forEach((s, si) => {
        s.number = `${chNum}.${si + 1}`;
        contents.push({ level: 2, number: s.number, title: s.title });
        visit(s.blocks);
        s.subsections?.forEach((ss, ssi) => {
          ss.number = `${s.number}.${ssi + 1}`;
          visit(ss.blocks);
        });
      });
    });
  }
  doc.lists = { contents, tables, figures, drawings };
  return doc;
}
