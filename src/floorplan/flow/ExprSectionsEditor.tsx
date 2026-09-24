import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { EXPR_NAMESPACES, exprCompletionCatalog, exprSignature, type ExprFn, EXPR_ALGORITHMS, algorithmsUsedIn } from "@builderpluss/engine";

/** Built-ins + named algorithms, in the order autocomplete offers them. */
const EXPR_FUNCTIONS = exprCompletionCatalog(EXPR_ALGORITHMS);

/**
 * Foldable REGIONS inside a formula box.
 *
 * A ported algorithm reaches a hundred-odd definitions, and a single flat textarea makes it unreadable — you
 * scroll past the winding test to reach the offset lines and lose your place. This splits the SAME string on
 * `# <title>` marker lines and gives each run of lines its own foldable block, so a body reads as sections.
 *
 * The value stays ONE STRING throughout. Nothing downstream changes: the parser already ignores any line
 * that is not `loop` / `end` / `name = expr` (see parseExprStmts), so a `#` line is inert to evaluation, to
 * `exprInputs`/`exprOutputs`, to flowToPobj and to serialization. Removing every marker leaves the body
 * byte-identical to what it was — the markers are the ONLY thing this feature adds to the text.
 *
 * `#` is safe as the marker: no shipped body uses it, and it cannot collide with a colour literal because
 * colours live on their own params, never in a formula.
 */

/** One region: its title (null for the lines before the first marker) and the body lines under it. */
export interface ExprSection {
  /** Marker title, or null for the implicit leading region. */
  title: string | null;
  /** The section's lines, EXCLUDING its own `#` marker line. */
  text: string;
  /** Index of the marker line in the original body (−1 for the implicit leading region). */
  markerLine: number;
}

const MARKER = /^\s*#\s*(.*)$/;

/** Split a formula body into regions on `# <title>` lines. A body with no markers yields a single untitled
 *  region holding all of it — which is what keeps the plain-textarea case unchanged. */
export const splitExprSections = (src: unknown): ExprSection[] => {
  const body = typeof src === "string" ? src : "";
  const lines = body.split("\n");
  const out: ExprSection[] = [];
  let cur: ExprSection = { title: null, text: "", markerLine: -1 };
  let buf: string[] = [];
  lines.forEach((line, i) => {
    const m = MARKER.exec(line);
    if (!m) { buf.push(line); return; }
    cur.text = buf.join("\n");
    // Drop a leading region that holds nothing — a body that OPENS with a marker has no preamble, and an
    // empty untitled block at the top would just be noise.
    if (out.length > 0 || cur.text.trim() || cur.title !== null) out.push(cur);
    buf = [];
    cur = { title: m[1].trim(), text: "", markerLine: i };
  });
  cur.text = buf.join("\n");
  out.push(cur);
  return out;
};

/** Regions → one string. Exactly the inverse of the split, so a round trip with nothing edited is a no-op. */
export const joinExprSections = (sections: ExprSection[]): string =>
  sections
    .map((s) => (s.title === null ? s.text : `# ${s.title}\n${s.text}`))
    .join("\n");

/** Definition count, for the collapsed header — "what is in here" without unfolding it. `loop` / `end` and
 *  blank lines are not definitions, so the number matches the outputs the region contributes. */
const defCount = (text: string): number =>
  text.split("\n").filter((l) => /^\s*[A-Za-z_]\w*\s*=(?!=)/.test(l)).length;

// ── Completion ──────────────────────────────────────────────────────────────────────────────────────
/** The identifier being typed, immediately left of the caret. Dots are part of it, so `Matrix.Tr` is one
 *  word and the list narrows as the namespace is typed. */
const WORD = /[A-Za-z_][A-Za-z0-9_.]*$/;

/** Rank matches so the most likely lands first: a qualified-name prefix, then the bare name (what an older
 *  body contains), then anything containing the text — which is how you find `Transpose` by typing "trans". */
const matchesFor = (word: string): ExprFn[] => {
  const q = word.toLowerCase();
  if (!q) return [];
  const pre: ExprFn[] = [], bare: ExprFn[] = [], mid: ExprFn[] = [];
  for (const f of EXPR_FUNCTIONS) {
    const ql = f.qualified.toLowerCase();
    if (ql.startsWith(q)) pre.push(f);
    else if (f.bare.toLowerCase().startsWith(q)) bare.push(f);
    else if (ql.includes(q)) mid.push(f);
  }
  return [...pre, ...bare, ...mid].slice(0, 8);
};

/**
 * The formula box for one region: a textarea plus a completion popup driven by {@link EXPR_FUNCTIONS}.
 *
 * The popup lists the qualified name, its full signature and a one-line summary; the highlighted entry also
 * shows what each argument means and an example. Accepting inserts `Namespace.Name(` and puts the caret
 * between the brackets, so the signature stays visible while the arguments are typed.
 *
 * Positioned BELOW the box rather than at the caret: a textarea gives no caret coordinates, and the usual
 * workaround (a mirrored div measuring the text) is a large amount of fragile code for a popup that is only
 * ever a few lines tall.
 */
const FormulaBox = ({
  value,
  rows,
  placeholder,
  className,
  onChange,
}: {
  value: string;
  rows: number;
  placeholder?: string;
  className: string;
  onChange: (next: string) => void;
}) => {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const [word, setWord] = useState("");
  const [sel, setSel] = useState(0);
  const [open, setOpen] = useState(false);
  const hits = open ? matchesFor(word) : [];

  const sync = (el: HTMLTextAreaElement) => {
    const upto = el.value.slice(0, el.selectionStart ?? 0);
    const m = WORD.exec(upto);
    const w = m ? m[0] : "";
    setWord(w);
    // Two characters before offering anything: a popup on every single letter fights ordinary typing.
    setOpen(w.length >= 2);
    setSel(0);
  };

  const accept = (f: ExprFn) => {
    const el = ref.current;
    if (!el) return;
    const caret = el.selectionStart ?? 0;
    const upto = el.value.slice(0, caret);
    const m = WORD.exec(upto);
    const start = m ? caret - m[0].length : caret;
    const insert = `${f.qualified}(`;
    const next = el.value.slice(0, start) + insert + el.value.slice(caret);
    setOpen(false);
    onChange(next);
    // Restore the caret INSIDE the brackets after React has written the new value back.
    const pos = start + insert.length;
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(pos, pos); });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        className={className}
        rows={rows}
        placeholder={placeholder}
        value={value}
        spellCheck={false}
        // The canvas must not see these: without the stops, typing drives React Flow's own shortcuts and a
        // scroll inside the box zooms the graph (hence `nowheel` on the class).
        onKeyDown={(e) => {
          e.stopPropagation();
          if (!hits.length) { if (e.key === "Escape") setOpen(false); return; }
          if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % hits.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + hits.length) % hits.length); }
          else if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); accept(hits[sel]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onBlur={() => setOpen(false)}
        onSelect={(e) => sync(e.currentTarget)}
        onChange={(e) => { onChange(e.target.value); sync(e.currentTarget); }}
      />
      {hits.length > 0 && (
        <div className="absolute left-0 right-0 top-full z-50 mt-0.5 overflow-hidden rounded border border-slate-300 bg-white shadow-lg nodrag nowheel">
          {hits.map((f, i) => (
            <div
              key={f.qualified}
              className={`cursor-pointer px-1.5 py-1 ${i === sel ? "bg-sky-50" : "hover:bg-slate-50"}`}
              // `onMouseDown` not `onClick`: the textarea's blur would close the popup first.
              onMouseDown={(e) => { e.preventDefault(); accept(f); }}
              onMouseEnter={() => setSel(i)}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[10px] text-slate-800">{exprSignature(f)}</span>
                <span className="shrink-0 font-mono text-[8px] text-slate-400">{f.bare}</span>
              </div>
              <div className="text-[9px] leading-tight text-slate-500">{f.summary}</div>
              {i === sel && (
                <div className="mt-0.5 space-y-0.5 border-t border-slate-100 pt-0.5">
                  <div className="text-[8px] uppercase tracking-wide text-slate-400">{EXPR_NAMESPACES[f.namespace]}</div>
                  {f.params.map((p) => (
                    <div key={p.name} className="text-[9px] leading-tight text-slate-600">
                      <span className="font-mono text-slate-700">{p.name}{p.optional ? "?" : ""}</span>
                      <span className="text-slate-400"> — {p.about}</span>
                    </div>
                  ))}
                  {f.example && <div className="font-mono text-[9px] text-emerald-700">{f.example}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export const ExprSectionsEditor = ({
  value,
  rows,
  placeholder,
  folded,
  onChange,
  onFoldedChange,
}: {
  value: string;
  rows: number;
  placeholder?: string;
  /** Titles of the folded regions. Kept by TITLE, not index, so editing one region doesn't reshuffle the
   *  fold state of the others. */
  folded: string[];
  onChange: (next: string) => void;
  onFoldedChange: (next: string[]) => void;
}) => {
  const sections = splitExprSections(value);
  const titled = sections.filter((s) => s.title !== null);
  const isFolded = (t: string) => folded.includes(t);
  const setSectionText = (idx: number, text: string) =>
    onChange(joinExprSections(sections.map((s, i) => (i === idx ? { ...s, text } : s))));
  const setTitle = (idx: number, title: string) =>
    onChange(joinExprSections(sections.map((s, i) => (i === idx ? { ...s, title } : s))));
  const toggle = (t: string) =>
    onFoldedChange(isFolded(t) ? folded.filter((x) => x !== t) : [...folded, t]);

  // Per-region height: keep the whole box roughly the size it would be flat, but never so short that a
  // two-line region is a scroller. Folded regions give their rows back to the ones still open.
  const openTitled = titled.filter((s) => !isFolded(s.title!)).length;
  const openTotal = openTitled + (sections[0]?.title === null ? 1 : 0);
  const rowsFor = (text: string) =>
    Math.max(2, Math.min(text.split("\n").length + 1, Math.ceil(rows / Math.max(1, openTotal)) + 2));

  return (
    <div className="space-y-1">
      {titled.length > 0 && (
        <div className="flex items-center justify-between text-[9px] text-slate-400">
          <span>{titled.length} section{titled.length === 1 ? "" : "s"}</span>
          <div className="flex gap-1.5">
            <button
              type="button"
              className="nodrag hover:text-slate-600"
              onClick={() => onFoldedChange(titled.map((s) => s.title!))}
            >
              Fold all
            </button>
            <button type="button" className="nodrag hover:text-slate-600" onClick={() => onFoldedChange([])}>
              Unfold all
            </button>
          </div>
        </div>
      )}
      {sections.map((s, i) => {
        const key = s.title === null ? "__lead" : `${s.title}#${i}`;
        const boxed = s.title !== null;
        const shut = boxed && isFolded(s.title!);
        return (
          <div key={key} className={boxed ? "rounded border border-slate-200 bg-slate-50/60" : ""}>
            {boxed && (
              <div className="flex items-center gap-1 px-1 py-0.5">
                <button
                  type="button"
                  className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-200"
                  title={shut ? "Unfold section" : "Fold section"}
                  onClick={() => toggle(s.title!)}
                >
                  {shut ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                </button>
                <input
                  type="text"
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 text-[10px] font-medium text-slate-600 hover:border-slate-200 focus:border-slate-300 focus:bg-white nodrag"
                  value={s.title!}
                  placeholder="Section"
                  onKeyDown={(e) => e.stopPropagation()}
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) => setTitle(i, e.target.value)}
                />
                <span className="shrink-0 pr-1 text-[9px] tabular-nums text-slate-400">
                  {defCount(s.text)}
                </span>
              </div>
            )}
            {!shut && (
              <FormulaBox
                className={`w-full resize-y px-1.5 py-1 text-[10px] nodrag nowheel ${
                  boxed ? "rounded-b border-0 bg-white" : "rounded border border-slate-200"
                }`}
                rows={rowsFor(s.text)}
                placeholder={i === 0 && !boxed ? placeholder : undefined}
                value={s.text}
                onChange={(next) => setSectionText(i, next)}
              />
            )}
          </div>
        );
      })}
      {/* THE MATHS BEHIND EVERY ALGORITHM CALLED ABOVE — one read-only foldable block each, appended after
          the editable regions. This is what keeps `Algorithms.Inset(P, d)` from being an opaque builtin:
          the text shown here is the SAME STRING the engine evaluates (see exprAlgorithms.ts), so it cannot
          drift from what produced the answer, and it can be pasted into the body above to take it over. */}
      {algorithmsUsedIn(value).map((a) => {
        const key = `algo:${a.qualified}`;
        const shut = folded.includes(key);
        return (
          <div key={key} className="rounded border border-violet-200 bg-violet-50/50">
            <div className="flex items-center gap-1 px-1 py-0.5">
              <button
                type="button"
                className="nodrag flex h-4 w-4 shrink-0 items-center justify-center rounded text-violet-400 hover:bg-violet-100"
                title={shut ? "Show the maths" : "Hide the maths"}
                onClick={() => onFoldedChange(shut ? folded.filter((x) => x !== key) : [...folded, key])}
              >
                {shut ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-medium text-violet-700">
                {a.qualified}({a.params.map((p) => p.name).join(", ")})
              </span>
              <span className="shrink-0 pr-1 text-[9px] text-violet-400">maths</span>
            </div>
            {!shut && (
              <div className="space-y-1 px-1.5 pb-1.5">
                <p className="text-[9px] leading-tight text-violet-600">{a.summary}</p>
                {a.params.map((p) => (
                  <div key={p.name} className="text-[9px] leading-tight text-slate-600">
                    <span className="font-mono text-slate-700">{p.name}</span>
                    <span className="text-slate-400"> — {p.about}</span>
                  </div>
                ))}
                <pre className="overflow-x-auto rounded border border-violet-200 bg-white px-1.5 py-1 font-mono text-[10px] leading-snug text-slate-800 nowheel">
{a.body}
                </pre>
                <div className="flex items-center justify-between text-[9px] text-violet-500">
                  <span>returns <span className="font-mono">{a.returns}</span></span>
                  {a.source && <span className="truncate pl-2 text-violet-400">{a.source}</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
