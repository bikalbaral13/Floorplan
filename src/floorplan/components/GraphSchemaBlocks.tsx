/**
 * Schema-driven Properties-tab blocks for canvas graph components (nodes & segments).
 *
 * An imported {@link GraphSchema} (loaded on the Flow Pipe Network Solver node) defines EXTRA
 * properties per graph node / segment. These blocks render them generically — number / select /
 * checkbox / text — so adding or renaming a property is a JSON edit, never a code change. They
 * are APPENDED to the built-in property panels (existing properties stay untouched).
 *
 * `SchemaPropsBlock`   → editable inputs (Properties tab). Values live in `graphAttrs` (history
 *                        state, persisted); unedited fields fall back to the schema default.
 * `SchemaMetricsBlock` → read-only solver results (Metrics tab), rows defined by schema.results.
 */

import type { GraphAttrValue, GraphPropDef, GraphResultDef } from "../types";

const numOr = (v: unknown, d: number): number => {
  const n = typeof v === "number" ? v : typeof v === "string" ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

export interface SchemaPropsBlockProps {
  title?: string;
  defs: GraphPropDef[];
  /** Stored attribute values for THIS component (may be undefined — defaults apply). */
  attrs: Record<string, GraphAttrValue> | undefined;
  /** Write one attribute value (null clears it back to the schema default). */
  onChange: (key: string, value: GraphAttrValue | null) => void;
}

/** The canonical graphAttrs storage key for a prop — its `role` (so values are shared with the flow
 *  processors / params panel), falling back to its `key`. */
const storeKey = (d: { role?: string; key: string }): string => d.role ?? d.key;

/** Current value of a prop (stored value → schema default), for evaluating `showIf` discriminators.
 *  `key` is the discriminator's prop KEY (showIf.when); we resolve it to that prop's storage key. */
const valueOf = (defs: GraphPropDef[], attrs: Record<string, GraphAttrValue> | undefined, key: string): GraphAttrValue | undefined => {
  const d = defs.find((x) => x.key === key);
  return (attrs?.[d ? storeKey(d) : key] ?? d?.default) as GraphAttrValue | undefined;
};

/** A field label that, when this element has its OWN stored value (an override of the schema default),
 *  shows a tiny "default" badge + a one-click reset (clears the override back to the schema default). */
const Lab = ({ text, overridden, onReset }: { text: string; overridden: boolean; onReset: () => void }) => (
  <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
    {text}
    {overridden && (
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
        title="Overridden for this element — click to reset to the schema default"
        className="rounded bg-cyan-100 px-1 text-[8px] font-semibold uppercase tracking-wide text-cyan-700 hover:bg-cyan-200"
      >
        reset
      </button>
    )}
  </span>
);

export const SchemaPropsBlock = ({ title, defs, attrs, onChange }: SchemaPropsBlockProps) => {
  // Type-driven visibility: drop rows whose `showIf` discriminator doesn't match the current value.
  const visible = defs.filter((def) => {
    if (!def.showIf) return true;
    const cur = valueOf(defs, attrs, def.showIf.when);
    if (def.showIf.in) return def.showIf.in.some((v) => String(v) === String(cur));
    if (def.showIf.equals !== undefined) return String(def.showIf.equals) === String(cur);
    return true;
  });
  if (!visible.length) return null;
  return (
    <div className="mt-2 rounded border border-cyan-200 bg-cyan-50/40 p-2 space-y-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-700">
        {title ?? "Schema properties"}
      </span>
      {visible.map((def) => {
        const label = def.label ?? def.key;
        const sk = storeKey(def);
        const raw = attrs?.[sk];
        if (def.kind === "color") {
          const value = String(raw ?? def.default ?? "#334155");
          return (
            <div key={def.key}>
              <Lab text={label} overridden={raw != null} onReset={() => onChange(sk, null)} />
              <div className="mt-0.5 flex items-center gap-2">
                <input
                  type="color"
                  value={value}
                  onChange={(e) => onChange(sk, e.target.value)}
                  className="h-7 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5"
                />
                <span className="text-[10px] text-slate-500">{value}</span>
              </div>
            </div>
          );
        }
        if (def.kind === "checkbox") {
          const checked = (raw ?? def.default) === true || (raw ?? def.default) === 1 || (raw ?? def.default) === "true";
          return (
            <label key={def.key} className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
              <Lab text={label} overridden={raw != null} onReset={() => onChange(sk, null)} />
              <input type="checkbox" checked={checked} onChange={(e) => onChange(sk, e.target.checked)} />
            </label>
          );
        }
        if (def.kind === "select") {
          const value = String(raw ?? def.default ?? def.options?.[0]?.value ?? "");
          return (
            <div key={def.key}>
              <Lab text={label} overridden={raw != null} onReset={() => onChange(sk, null)} />
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={value}
                onChange={(e) => onChange(sk, e.target.value)}
              >
                {(def.options ?? []).map((o) => (
                  <option key={o.value} value={o.value}>{o.label ?? o.value}</option>
                ))}
              </select>
            </div>
          );
        }
        if (def.kind === "text") {
          return (
            <div key={def.key}>
              <Lab text={label} overridden={raw != null} onReset={() => onChange(sk, null)} />
              <input
                type="text"
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={String(raw ?? def.default ?? "")}
                onChange={(e) => onChange(sk, e.target.value)}
              />
            </div>
          );
        }
        // number (default kind). Empty input clears the stored value → schema default applies.
        const placeholder = def.default != null ? String(def.default) : "";
        return (
          <div key={def.key}>
            <Lab text={`${label}${def.unit ? ` (${def.unit})` : ""}`} overridden={raw != null} onReset={() => onChange(sk, null)} />
            <input
              type="number"
              step={def.step ?? "any"}
              min={def.min}
              max={def.max}
              placeholder={placeholder}
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
              value={typeof raw === "number" ? raw : typeof raw === "string" && raw !== "" ? raw : ""}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") { onChange(sk, null); return; }
                const n = parseFloat(v);
                onChange(sk, Number.isFinite(n) ? n : null);
              }}
            />
          </div>
        );
      })}
    </div>
  );
};

export interface SchemaMetricsBlockProps {
  title?: string;
  defs: GraphResultDef[];
  /** Solver results for THIS component (undefined → not solved yet / unreachable). */
  results: Record<string, number> | undefined;
}

export const SchemaMetricsBlock = ({ title, defs, results }: SchemaMetricsBlockProps) => {
  if (!defs.length) return null;
  return (
    <div className="mt-2 rounded border border-cyan-200 bg-cyan-50/40 p-2 space-y-1">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-700">
        {title ?? "Solver metrics"}
      </span>
      {defs.map((def) => {
        const v = results?.[def.key];
        const txt = v == null ? "—" : numOr(v, 0).toFixed(def.decimals ?? 3);
        return (
          <div key={def.key} className="flex items-center justify-between rounded bg-white/70 px-1.5 py-0.5 text-[10px]">
            <span className="text-slate-500">{def.label ?? def.key}</span>
            <span className="font-mono text-slate-700">
              {txt}{v != null && def.unit ? ` ${def.unit}` : ""}
            </span>
          </div>
        );
      })}
      {!results && <p className="text-[9px] italic text-slate-400">No solve yet — run the Pipe Network Solver in Flow.</p>}
    </div>
  );
};
