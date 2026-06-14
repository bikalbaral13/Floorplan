import { Plus, X } from "lucide-react";
import { inputProps, type InputProp, type InputPropType } from "./flowTypes";

let propSeq = 1;
export const nextPropId = () => `p_${propSeq++}_${Math.random().toString(36).slice(2, 6)}`;

const TYPE_OPTIONS: { value: InputPropType; label: string }[] = [
  { value: "range", label: "Slider" },
  { value: "select", label: "Options" },
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Textbox" },
];

/** Default value for a freshly-chosen control type. */
const defaultValue = (type: InputPropType, options: string[]): string | number | boolean =>
  type === "checkbox" ? false : type === "range" ? 0 : type === "select" ? (options[0] ?? "") : "";

/** Editor for the Input Properties node. Two modes:
 *   - Full (default, used on the flow canvas): edit each parameter's name, type, config (min/max/step
 *     or options), value; remove parameters; add new ones.
 *   - `valuesOnly` (used in the Properties tab): interaction-only — just each parameter's label and its
 *     value control (slider / options / checkbox / textbox). No type/config/remove/add.
 *  Each parameter's value is exposed as a `val-<id>` output handle (rendered by the node via `onRowRef`). */
export const InputPropsEditor = ({
  params,
  onParamChange,
  onRowRef,
  nodrag,
  valuesOnly,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  onRowRef?: (propId: string, el: HTMLDivElement | null) => void;
  nodrag?: boolean;
  valuesOnly?: boolean;
}) => {
  const props = inputProps(params);
  const nd = nodrag ? " nodrag" : "";
  const setProps = (next: InputProp[]) => onParamChange("props", next);
  const update = (id: string, patch: Partial<InputProp>) =>
    setProps(props.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const changeType = (id: string, type: InputPropType) => {
    const p = props.find((x) => x.id === id);
    update(id, { type, value: defaultValue(type, p?.options ?? []) });
  };
  const addProp = () =>
    setProps([...props, { id: nextPropId(), name: "", type: "range", value: 0, min: 0, max: 10, step: 1, options: [] }]);
  const inputCls = `h-6 rounded border border-slate-200 px-1.5 text-[10px]${nd}`;

  // The value control for a parameter — shared by both modes.
  const valueControl = (p: InputProp) => {
    if (p.type === "range") {
      return (
        <div className="flex items-center gap-1.5">
          <input
            type="range"
            className={`min-w-0 flex-1${nd}`}
            min={p.min}
            max={p.max}
            step={p.step || 1}
            value={typeof p.value === "number" ? p.value : 0}
            onChange={(e) => update(p.id, { value: +e.target.value })}
          />
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-700">{typeof p.value === "number" ? p.value : 0}</span>
        </div>
      );
    }
    if (p.type === "select") {
      return (
        <select className={`${inputCls} w-full`} value={String(p.value ?? "")} onChange={(e) => update(p.id, { value: e.target.value })}>
          {p.options.length === 0 && <option value="">—</option>}
          {p.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    if (p.type === "checkbox") {
      return (
        <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
          <input type="checkbox" className={nd.trim()} checked={p.value === true} onChange={(e) => update(p.id, { value: e.target.checked })} />
          {p.value === true ? "On (1)" : "Off (0)"}
        </label>
      );
    }
    return <input type="text" className={`${inputCls} w-full`} placeholder="value" value={String(p.value ?? "")} onChange={(e) => update(p.id, { value: e.target.value })} />;
  };

  // ── Interaction-only (Properties tab): label + value control, nothing structural. ──
  if (valuesOnly) {
    if (props.length === 0) return <span className="text-[10px] italic text-slate-400">No parameters defined</span>;
    return (
      <div className="space-y-1.5">
        {props.map((p, i) => (
          <div key={p.id} className="space-y-0.5">
            <span className="text-[10px] text-slate-500">{p.name.trim() || `Parameter ${i + 1}`}</span>
            {valueControl(p)}
          </div>
        ))}
      </div>
    );
  }

  // ── Full editor (flow canvas). ──
  return (
    <div className="space-y-1.5">
      {props.map((p, i) => (
        <div key={p.id} ref={(el) => onRowRef?.(p.id, el)} className="space-y-1 rounded-md border border-slate-200 bg-slate-50/60 p-1.5">
          <div className="flex items-center gap-1">
            <input
              type="text"
              className={`${inputCls} min-w-0 flex-1`}
              placeholder={`Parameter ${i + 1}`}
              value={p.name}
              onChange={(e) => update(p.id, { name: e.target.value })}
            />
            <select className={`${inputCls} w-20`} value={p.type} onChange={(e) => changeType(p.id, e.target.value as InputPropType)}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              title="Remove parameter"
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600${nd}`}
              onClick={() => setProps(props.filter((x) => x.id !== p.id))}
            >
              <X className="h-3 w-3" />
            </button>
          </div>

          {p.type === "range" && (
            <div className="flex items-center gap-1">
              <input type="number" className={`${inputCls} w-1/3`} placeholder="min" value={p.min} onChange={(e) => update(p.id, { min: +e.target.value })} />
              <input type="number" className={`${inputCls} w-1/3`} placeholder="max" value={p.max} onChange={(e) => update(p.id, { max: +e.target.value })} />
              <input type="number" className={`${inputCls} w-1/3`} placeholder="step" value={p.step} onChange={(e) => update(p.id, { step: +e.target.value })} />
            </div>
          )}

          {p.type === "select" && (
            <input
              type="text"
              className={`${inputCls} w-full`}
              placeholder="option1, option2, …"
              value={p.options.join(", ")}
              onChange={(e) => {
                const options = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                const value = options.includes(String(p.value)) ? p.value : (options[0] ?? "");
                update(p.id, { options, value });
              }}
            />
          )}

          {valueControl(p)}
        </div>
      ))}
      <button
        type="button"
        className={`flex h-6 w-full items-center justify-center gap-1 rounded border border-dashed border-slate-300 text-[10px] text-slate-500 hover:bg-slate-50${nd}`}
        onClick={addProp}
      >
        <Plus className="h-3 w-3" /> Add parameter
      </button>
    </div>
  );
};
