// Renders the JSON ReportDocument to a standalone HTML file styled after
// final.docx: A4 pages, Times New Roman 12 pt justified body, centred part and
// chapter titles, numbered sections / tables / figures / equations.

import { renderChart } from "./charts";
import { renderDrawingSvg } from "./drawing";
import type { Block, Chapter, ReportDocument, Section } from "./doc";

function esc(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const CSS = `
@page { size: A4; margin: 2.54cm; }
* { box-sizing: border-box; }
html { background: #d9d9d6; }
body { margin: 0; font-family: "Times New Roman", Times, "Liberation Serif", serif; font-size: 12pt; color: #000; line-height: 1.5; background: #d9d9d6; }
.page { width: 21cm; max-width: 100%; min-height: 29.7cm; margin: 16px auto; padding: 2.54cm; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.25); }
p { text-align: justify; margin: 0 0 10px; }
.cover { text-align: center; display: flex; flex-direction: column; align-items: center; }
.cover .inst { font-size: 16pt; font-weight: bold; line-height: 1.6; margin-top: 1.5cm; }
.cover .logo { width: 96px; height: 96px; border: 2px solid #000; border-radius: 50%; margin: 24px auto; display: flex; align-items: center; justify-content: center; font-size: 10pt; }
.cover .title { font-size: 20pt; font-weight: bold; margin: 36px 0 12px; text-transform: uppercase; }
.cover .sub { font-size: 13pt; margin: 6px 0 40px; text-transform: uppercase; }
.cover .sig { display: flex; justify-content: space-between; width: 100%; text-align: left; margin-top: 40px; font-size: 12pt; }
.cover .sig h4 { margin: 0 0 6px; font-size: 12pt; }
.cover .date { margin-top: 48px; font-weight: bold; }
h1.title1 { font-family: "Times New Roman", Times, serif; font-size: 16pt; text-align: center; font-weight: bold; margin: 0 0 24px; }
h1.part { font-size: 26pt; text-align: center; font-weight: bold; margin: 9cm 0 0; }
h1.part small { display: block; font-size: 18pt; margin-top: 12px; }
h2.chapter { font-size: 16pt; text-align: center; font-weight: bold; margin: 0 0 24px; line-height: 1.6; }
h2.chapter span { display: block; font-size: 13pt; }
h3.sec { font-size: 14pt; font-weight: bold; margin: 22px 0 8px; text-transform: uppercase; }
h4.sub { font-size: 12pt; font-weight: bold; margin: 16px 0 6px; }
h5.head { font-size: 12pt; font-weight: bold; font-style: italic; margin: 12px 0 6px; }
table { border-collapse: collapse; width: 100%; margin: 4px 0 14px; font-size: 10.5pt; page-break-inside: auto; }
th, td { border: 1px solid #000; padding: 3px 6px; vertical-align: top; }
th { background: #f2f2f2; font-weight: bold; text-align: center; }
td { text-align: center; }
td:first-child { text-align: left; }
table.kv td:first-child { width: 55%; }
table.kv td:last-child { text-align: left; }
table.salient td.group { font-weight: bold; background: #f2f2f2; text-transform: uppercase; }
table.calc { border: none; width: auto; margin: 6px 0 12px 24px; font-size: 12pt; }
table.calc td { border: none; text-align: left; padding: 1px 8px; }
table.calc td:nth-child(2) { width: 12px; padding: 1px 0; }
.caption { text-align: center; font-weight: bold; font-size: 11pt; margin: 10px 0 4px; }
.fig { text-align: center; margin: 12px 0 4px; page-break-inside: avoid; }
.fig svg { font-family: "Times New Roman", Times, "Liberation Serif", serif; }
.eq { display: flex; align-items: center; margin: 8px 0; }
.eq .ex { flex: 1; text-align: center; font-family: "Times New Roman", Times, serif; font-style: italic; }
.eq .no { white-space: nowrap; font-size: 11pt; }
.where { margin: -4px 0 10px 40px; font-size: 11pt; }
.where div { margin: 0; }
.check { margin: 6px 0; padding: 4px 8px; border-left: 4px solid; font-size: 11pt; }
.check.ok { border-color: #008300; background: #eef7ee; }
.check.bad { border-color: #e34948; background: #fdeeee; }
.check b { margin-right: 6px; }
.note { font-style: italic; font-size: 11pt; border-left: 3px solid #999; padding: 4px 10px; margin: 8px 0; color: #333; }
.tnote { font-size: 10pt; font-style: italic; margin-top: -10px; margin-bottom: 12px; }
ul, ol { margin: 4px 0 10px 28px; padding: 0; }
li { margin: 2px 0; text-align: justify; }
.toc div { display: flex; gap: 8px; }
.toc .l0 { font-weight: bold; margin-top: 10px; text-transform: uppercase; }
.toc .l1 { font-weight: bold; padding-left: 12px; }
.toc .l2 { padding-left: 36px; }
.toc .num { min-width: 44px; }
.toc div .num { min-width: 110px; }
.fig.drawing { border: 1px solid #000; padding: 4px; }
.abbr div { display: flex; }
.abbr div span:first-child { width: 110px; }
.wide { overflow-x: auto; }
@media print {
  html, body { background: #fff; }
  .shots figure { break-inside: avoid; }
  .page { margin: 0; padding: 0; box-shadow: none; width: auto; min-height: 0; page-break-after: always; }
}
`;

const SHOTS_CSS = `.shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:10px 0}.shots figure{margin:0;border:1px solid #ccc;background:#fff}.shots img{width:100%;display:block}.shots figcaption{font-size:12px;padding:4px 6px;text-align:center}`;

function renderBlock(b: Block): string {
  switch (b.type) {
    case "paragraph":
      return `<p>${esc(b.text)}</p>`;
    case "heading":
      return `<h5 class="head">${esc(b.text)}</h5>`;
    case "list": {
      const tag = b.ordered ? "ol" : "ul";
      return `<${tag}>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</${tag}>`;
    }
    case "equation":
      return `<div class="eq"><div class="ex">${esc(b.expr)}</div><div class="no">${b.number ? `……eqn ${esc(b.number)}` : ""}</div></div>` +
        (b.where?.length ? `<div class="where">where, ${b.where.map((w) => `<div>${esc(w)}</div>`).join("")}</div>` : "");
    case "calc":
      return `<table class="calc"><tbody>${b.lines.map(([l, v]) => `<tr><td>${esc(l)}</td><td>=</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
    case "kv":
      return (b.caption ? `<div class="caption">Table ${esc(b.number ?? "")}: ${esc(b.caption)}</div>` : "") +
        `<table class="kv"><tbody>${b.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table>`;
    case "table":
      return `<div class="caption">Table ${esc(b.number ?? "")}: ${esc(b.caption)}</div><div class="wide"><table><thead>${b.headers
        .map((row) => `<tr>${row.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>`)
        .join("")}</thead><tbody>${b.rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` +
        (b.note ? `<div class="tnote">${esc(b.note)}</div>` : "");
    case "figure":
      return `<div class="fig">${renderChart(b.chart)}</div><div class="caption">Figure ${esc(b.number ?? "")}: ${esc(b.caption)}</div>`;
    case "drawing":
      return `<div class="fig drawing">${renderDrawingSvg(b.sheet)}</div><div class="caption">Drawing ${esc(b.number ?? "")}: ${esc(b.caption)}</div>`;
    case "check":
      return `<div class="check ${b.ok ? "ok" : "bad"}"><b>${b.ok ? "✓ OK" : "✗ NOT OK"}</b>${esc(b.label)} — ${esc(b.detail)}</div>`;
    case "note":
      return `<div class="note">${esc(b.text)}</div>`;
    case "images":
      return `<div class="shots">${b.items.map((i) => `<figure><img src="${esc(i.src)}" alt="${esc(i.caption)}" loading="lazy"/><figcaption>${esc(i.caption)}</figcaption></figure>`).join("")}</div>` + (b.caption ? `<div class="caption">${esc(b.caption)}</div>` : "");
    case "video":
      return `<div class="fig"><video controls preload="metadata" src="${esc(b.src)}"${b.poster ? ` poster="${esc(b.poster)}"` : ""} style="width:100%;max-height:70vh;background:#000"></video></div><div class="caption">${esc(b.caption)} — <a href="${esc(b.src)}" target="_blank" rel="noopener">open video</a></div>`;
  }
}

export function renderBlocks(blocks: Block[]): string {
  return blocks.map(renderBlock).join("\n");
}

function renderSection(s: Section, level: 3 | 4): string {
  const tag = level === 3 ? `<h3 class="sec">` : `<h4 class="sub">`;
  const close = level === 3 ? "</h3>" : "</h4>";
  return `${tag}${esc(s.number ?? "")}&nbsp;&nbsp;${esc(s.title)}${close}${renderBlocks(s.blocks)}${(s.subsections ?? []).map((x) => renderSection(x, 4)).join("")}`;
}

export function renderChapter(ch: Chapter, appendix: boolean): string {
  const head = appendix
    ? `<h2 class="chapter">${esc(ch.number ?? "")}&nbsp;&nbsp;${esc(ch.title.toUpperCase())}</h2>`
    : `<h2 class="chapter">CHAPTER ${esc(ch.number ?? "")}<span>${esc(ch.title.toUpperCase())}</span></h2>`;
  return `<section class="page">${head}${ch.intro ? renderBlocks(ch.intro) : ""}${ch.sections.map((s) => renderSection(s, 3)).join("")}</section>`;
}

export function renderReportHtml(r: ReportDocument): string {
  const c = r.cover;
  const cover = `<section class="page cover">
    <div class="inst">${c.institution.map(esc).join("<br/>")}</div>
    <div class="title">${esc(c.title)}</div>
    <div class="sub">${esc(c.subtitle)}</div>
    <div class="sig">
      <div>${c.submittedBy.length ? `<h4>SUBMITTED BY:</h4>${c.submittedBy.map(esc).join("<br/>")}` : ""}</div>
      <div>${c.submittedTo.length ? `<h4>SUBMITTED TO:</h4>${c.submittedTo.map(esc).join("<br/>")}` : ""}</div>
    </div>
    <div class="date">${esc(c.date)}</div>
  </section>`;

  const front = r.frontMatter
    .map((fm) => `<section class="page"><h1 class="title1">${esc(fm.title)}</h1>${renderBlocks(fm.blocks)}</section>`)
    .join("");

  const toc = `<section class="page toc"><h1 class="title1">TABLE OF CONTENTS</h1>${r.lists.contents
    .map((e) => `<div class="l${e.level}"><span class="num">${esc(e.number ?? "")}</span><span>${esc(e.level === 1 && !/^[A-Z]-/.test(e.number ?? "") ? e.title.toUpperCase() : e.title)}</span></div>`)
    .join("")}</section>`;
  const lot = `<section class="page toc"><h1 class="title1">LIST OF TABLES</h1>${r.lists.tables
    .map((t) => `<div><span class="num">Table ${esc(t.number)}</span><span>${esc(t.caption)}</span></div>`).join("")}</section>`;
  const lof = `<section class="page toc"><h1 class="title1">LIST OF FIGURES</h1>${r.lists.figures
    .map((t) => `<div><span class="num">Figure ${esc(t.number)}</span><span>${esc(t.caption)}</span></div>`).join("")}</section>`;
  const lod = r.lists.drawings.length
    ? `<section class="page toc"><h1 class="title1">LIST OF DRAWINGS</h1>${r.lists.drawings
        .map((t) => `<div><span class="num">Drawing ${esc(t.number)}</span><span>${esc(t.caption)}</span></div>`).join("")}</section>`
    : "";
  const abbr = `<section class="page abbr"><h1 class="title1">LIST OF ABBREVIATIONS</h1>${r.abbreviations
    .map(([a, d]) => `<div><span>${esc(a)}</span><span>${esc(d)}</span></div>`).join("")}</section>`;
  const salient = `<section class="page"><h1 class="title1">PROJECT SALIENT FEATURES</h1><table class="kv salient"><tbody>${r.salientFeatures
    .map((g) => `<tr><td class="group" colspan="2">${esc(g.group)}</td></tr>${g.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}`)
    .join("")}</tbody></table></section>`;

  const body = r.parts
    .map((p) => {
      const title = `<section class="page"><h1 class="part">${esc(p.title)}${p.subtitle ? `<small>(${esc(p.subtitle)})</small>` : ""}</h1></section>`;
      return title + p.chapters.map((ch) => renderChapter(ch, !!p.appendix)).join("");
    })
    .join("");

  const refs = `<section class="page"><h1 class="title1">REFERENCES</h1><ol>${r.references.map((x) => `<li>${esc(x)}</li>`).join("")}</ol></section>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(r.meta.project)} Report</title><style>${CSS}${SHOTS_CSS}</style></head><body>${cover}${front}${toc}${lot}${lof}${lod}${abbr}${salient}${body}${refs}</body></html>`;
}

export const REPORT_CSS = CSS;
