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

export const SchemaPropsBlock = ({ title, defs, attrs, onChange }: SchemaPropsBlockProps) => {
  if (!defs.length) return null;
  return (
    <div className="mt-2 rounded border border-cyan-200 bg-cyan-50/40 p-2 space-y-1.5">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-cyan-700">
        {title ?? "Schema properties"}
      </span>
      {defs.map((def) => {
        const label = def.label ?? def.key;
        const raw = attrs?.[def.key];
        if (def.kind === "checkbox") {
          const checked = (raw ?? def.default) === true || (raw ?? def.default) === 1 || (raw ?? def.default) === "true";
          return (
            <label key={def.key} className="flex items-center justify-between gap-2 text-[10px] text-slate-600">
              <span>{label}</span>
              <input type="checkbox" checked={checked} onChange={(e) => onChange(def.key, e.target.checked)} />
            </label>
          );
        }
        if (def.kind === "select") {
          const value = String(raw ?? def.default ?? def.options?.[0]?.value ?? "");
          return (
            <div key={def.key}>
              <span className="text-[10px] text-slate-400">{label}</span>
              <select
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={value}
                onChange={(e) => onChange(def.key, e.target.value)}
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
              <span className="text-[10px] text-slate-400">{label}</span>
              <input
                type="text"
                className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs"
                value={String(raw ?? def.default ?? "")}
                onChange={(e) => onChange(def.key, e.target.value)}
              />
            </div>
          );
        }
        // number (default kind). Empty input clears the stored value → schema default applies.
        const placeholder = def.default != null ? String(def.default) : "";
        return (
          <div key={def.key}>
            <span className="text-[10px] text-slate-400">
              {label}{def.unit ? ` (${def.unit})` : ""}
            </span>
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
                if (v === "") { onChange(def.key, null); return; }
                const n = parseFloat(v);
                onChange(def.key, Number.isFinite(n) ? n : null);
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
