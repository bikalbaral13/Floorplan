import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react";
import {
  SCHEMA_SECTIONS,
  schemaEntries,
  type SchemaPropEntry,
  type SchemaSectionParam,
} from "./flowTypes";

let schemaSeq = 1;
const nextEntryId = () => `sp_${schemaSeq++}_${Math.random().toString(36).slice(2, 6)}`;

/** Read an uploaded file (SVG icon) as a data URL for storage in the schema. */
const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

const KIND_OPTIONS: { value: SchemaPropEntry["kind"]; label: string }[] = [
  { value: "number", label: "Number" },
  { value: "select", label: "Options" },
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Textbox" },
];

/** Default value for a freshly-chosen kind. */
const defaultDef = (kind: SchemaPropEntry["kind"], options: string[]): string | number | boolean =>
  kind === "checkbox" ? false : kind === "number" ? 0 : kind === "select" ? (options[0] ?? "") : "";

/** Editor for the Schema node: four foldable sections (Node / Segment / Space / Graph Schema), each
 *  a parameter list like the Input Properties node — label, type, key/unit/role, config (min/max/step
 *  or options) and a default value. The lists live under params.nodeProps / segmentProps / spaceProps /
 *  graphProps and are converted to Properties-tab definitions by `schemaNodeToSchemas`. */
export const SchemaNodeEditor = ({
  params,
  onParamChange,
  nodrag,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  nodrag?: boolean;
}) => {
  // Sections folded by default except the first non-empty one (or Node Schema when all empty).
  const [open, setOpen] = useState<Record<string, boolean>>(() => {
    const firstFilled = SCHEMA_SECTIONS.find((s) => schemaEntries(params, s.param).length > 0);
    return { [(firstFilled ?? SCHEMA_SECTIONS[0]).param]: true };
  });
  const nd = nodrag ? " nodrag" : "";
  const inputCls = `h-6 rounded border border-slate-200 px-1.5 text-[10px]${nd}`;

  const renderSection = (param: SchemaSectionParam, title: string) => {
    const entries = schemaEntries(params, param);
    const setEntries = (next: SchemaPropEntry[]) => onParamChange(param, next);
    const update = (id: string, patch: Partial<SchemaPropEntry>) =>
      setEntries(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    const expanded = !!open[param];
    return (
      <div key={param} className="rounded-md border border-violet-200 bg-violet-50/40">
        <button
          type="button"
          className={`flex w-full items-center justify-between px-1.5 py-1 text-left${nd}`}
          onClick={() => setOpen((o) => ({ ...o, [param]: !o[param] }))}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wide text-violet-700">{title}</span>
          <span className="flex items-center gap-1 text-[9px] text-violet-500">
            {entries.length > 0 && <span className="font-mono">{entries.length}</span>}
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        </button>
        {expanded && (
          <div className="space-y-1.5 px-1.5 pb-1.5">
            {entries.map((e, i) => (
              <div key={e.id} className="space-y-1 rounded-md border border-slate-200 bg-white p-1.5">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    className={`${inputCls} min-w-0 flex-1`}
                    placeholder={`Parameter ${i + 1}`}
                    value={e.label}
                    onChange={(ev) => update(e.id, { label: ev.target.value })}
                  />
                  <select
                    className={`${inputCls} w-20`}
                    value={e.kind}
                    onChange={(ev) => {
                      const kind = ev.target.value as SchemaPropEntry["kind"];
                      update(e.id, { kind, def: defaultDef(kind, e.options) });
                    }}
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    title="Remove parameter"
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600${nd}`}
                    onClick={() => setEntries(entries.filter((x) => x.id !== e.id))}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {/* Storage key / display unit / solver role — all optional (key falls back to the label slug). */}
                <div className="flex items-center gap-1">
                  <input type="text" className={`${inputCls} w-1/3 min-w-0 font-mono`} placeholder="key (auto)" value={e.key} onChange={(ev) => update(e.id, { key: ev.target.value })} />
                  <input type="text" className={`${inputCls} w-1/3 min-w-0`} placeholder="unit" value={e.unit} onChange={(ev) => update(e.id, { unit: ev.target.value })} />
                  <input type="text" className={`${inputCls} w-1/3 min-w-0 font-mono`} placeholder="role" title="Solver binding, e.g. demand / diameter" value={e.role} onChange={(ev) => update(e.id, { role: ev.target.value })} />
                </div>
                {e.kind === "number" && (
                  <div className="flex items-center gap-1">
                    <input type="number" className={`${inputCls} w-1/3`} placeholder="min" value={e.min} onChange={(ev) => update(e.id, { min: +ev.target.value })} />
                    <input type="number" className={`${inputCls} w-1/3`} placeholder="max" value={e.max} onChange={(ev) => update(e.id, { max: +ev.target.value })} />
                    <input type="number" className={`${inputCls} w-1/3`} placeholder="step" value={e.step} onChange={(ev) => update(e.id, { step: +ev.target.value })} />
                  </div>
                )}
                {e.kind === "select" && (
                  <input
                    type="text"
                    className={`${inputCls} w-full`}
                    placeholder="option1, option2, …"
                    value={e.options.join(", ")}
                    onChange={(ev) => {
                      const options = ev.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                      const def = options.includes(String(e.def)) ? e.def : (options[0] ?? "");
                      update(e.id, { options, def });
                    }}
                  />
                )}
                {/* Per-option SVG icons — give each type (wall / door / window, furniture kind, …) a custom
                    icon. Stored as a data URL under optionIcons[value]. */}
                {e.kind === "select" && e.options.length > 0 && (
                  <div className="space-y-1 rounded border border-slate-100 bg-slate-50/60 p-1">
                    <span className="text-[9px] uppercase tracking-wide text-slate-400">Type icons (SVG)</span>
                    {e.options.map((opt) => {
                      const icon = e.optionIcons?.[opt];
                      return (
                        <div key={opt} className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-slate-200 bg-white">
                            {icon ? <img src={icon} alt="" className="h-4 w-4 object-contain" /> : <span className="text-[8px] text-slate-300">—</span>}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-[10px] text-slate-600" title={opt}>{opt}</span>
                          <label className={`flex h-5 cursor-pointer items-center rounded border border-slate-200 bg-white px-1.5 text-[9px] text-slate-600 hover:bg-slate-100${nd}`}>
                            {icon ? "Replace" : "Upload SVG"}
                            <input
                              type="file"
                              accept=".svg,image/svg+xml"
                              className="hidden"
                              onChange={async (ev) => {
                                const file = ev.target.files?.[0];
                                ev.target.value = "";
                                if (!file) return;
                                const dataUrl = await readFileAsDataUrl(file);
                                update(e.id, { optionIcons: { ...(e.optionIcons ?? {}), [opt]: dataUrl } });
                              }}
                            />
                          </label>
                          {icon && (
                            <button
                              type="button"
                              title="Remove icon"
                              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600${nd}`}
                              onClick={() => {
                                const next = { ...(e.optionIcons ?? {}) };
                                delete next[opt];
                                update(e.id, { optionIcons: Object.keys(next).length ? next : undefined });
                              }}
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                {/* Default value (applies to every component until it's edited individually). */}
                {e.kind === "number" && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[9px] text-slate-400">default</span>
                    <input type="number" className={`${inputCls} min-w-0 flex-1 font-mono`} value={typeof e.def === "number" ? e.def : 0} onChange={(ev) => update(e.id, { def: +ev.target.value })} />
                  </div>
                )}
                {e.kind === "select" && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[9px] text-slate-400">default</span>
                    <select className={`${inputCls} min-w-0 flex-1`} value={String(e.def ?? "")} onChange={(ev) => update(e.id, { def: ev.target.value })}>
                      {e.options.length === 0 && <option value="">—</option>}
                      {e.options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  </div>
                )}
                {e.kind === "checkbox" && (
                  <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
                    <input type="checkbox" className={nd.trim()} checked={e.def === true} onChange={(ev) => update(e.id, { def: ev.target.checked })} />
                    default {e.def === true ? "on" : "off"}
                  </label>
                )}
                {e.kind === "text" && (
                  <div className="flex items-center gap-1.5">
                    <span className="w-10 shrink-0 text-[9px] text-slate-400">default</span>
                    <input type="text" className={`${inputCls} min-w-0 flex-1`} value={String(e.def ?? "")} onChange={(ev) => update(e.id, { def: ev.target.value })} />
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              className={`flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-violet-300 text-[10px] text-violet-600 hover:bg-violet-50${nd}`}
              onClick={() => setEntries([...entries, { id: nextEntryId(), key: "", label: "", kind: "number", unit: "", def: 0, min: 0, max: 100, step: 1, options: [], role: "" }])}
            >
              <Plus className="h-3 w-3" /> Add parameter
            </button>
          </div>
        )}
      </div>
    );
  };

  return <div className="space-y-1">{SCHEMA_SECTIONS.map((s) => renderSection(s.param, s.title))}</div>;
};
