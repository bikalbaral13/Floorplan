import { useState } from "react";
import { Plus, X } from "lucide-react";
import { DEFAULT_PROP_COLOR, inputProps, propVisible, type InputProp, type InputPropType } from "./flowTypes";

let propSeq = 1;
export const nextPropId = () => `p_${propSeq++}_${Math.random().toString(36).slice(2, 6)}`;

const TYPE_OPTIONS: { value: InputPropType; label: string }[] = [
  { value: "range", label: "Slider" },
  { value: "select", label: "Options" },
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Textbox" },
  { value: "color", label: "Colour" },
];

/** Default value for a freshly-chosen control type. */
const defaultValue = (type: InputPropType, options: string[]): string | number | boolean =>
  type === "checkbox" ? false
  : type === "range" ? 0
  : type === "select" ? (options[0] ?? "")
  : type === "color" ? DEFAULT_PROP_COLOR
  : "";

/** The Options list for a `select` prop. While the field is focused the RAW text is what's shown, so
 *  in-progress input survives — parsing to `options` normalises away the very characters being typed
 *  (a trailing comma, the space after it), and echoing that back into a controlled `value` would delete
 *  them on each keystroke. `options` still re-parses live so downstream stays in sync; blur drops the
 *  draft and the field snaps back to the canonical `join(", ")`. */
const OptionsInput = ({ p, className, onChange }: { p: InputProp; className: string; onChange: (patch: Partial<InputProp>) => void }) => {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      type="text"
      className={className}
      placeholder="option1, option2, …"
      value={draft ?? p.options.join(", ")}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const options = raw.split(",").map((s) => s.trim()).filter(Boolean);
        onChange({ options, value: options.includes(String(p.value)) ? p.value : (options[0] ?? "") });
      }}
      onBlur={() => setDraft(null)}
    />
  );
};

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
  hideGated,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  onRowRef?: (propId: string, el: HTMLDivElement | null) => void;
  nodrag?: boolean;
  valuesOnly?: boolean;
  /** Consumer view (Properties tab): actually HIDE parameters whose `showIf` gate isn't met, instead of just
   *  dimming them. Off on the canvas node so every row (and its `val-<id>` handle) stays put for authoring. */
  hideGated?: boolean;
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
    if (p.type === "color") {
      const hex = typeof p.value === "string" && p.value ? p.value : DEFAULT_PROP_COLOR;
      return (
        <div className="flex items-center gap-1.5">
          <input
            type="color"
            className={`h-6 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-white${nd}`}
            value={hex}
            onChange={(e) => update(p.id, { value: e.target.value })}
          />
          <span className="font-mono text-[10px] text-slate-700">{hex}</span>
        </div>
      );
    }
    return <input type="text" className={`${inputCls} w-full`} placeholder="value" value={String(p.value ?? "")} onChange={(e) => update(p.id, { value: e.target.value })} />;
  };

  // ── Interaction-only (Properties tab): label + value control, nothing structural. ──
  if (valuesOnly) {
    if (props.length === 0) return <span className="text-[10px] italic text-slate-400">No parameters defined</span>;
    // In the consumer view, drop parameters whose `showIf` gate isn't met (the canvas node dims them instead).
    const shown = hideGated ? props.filter((p) => propVisible(p, props)) : props;
    return (
      <div className="space-y-1.5">
        {shown.map((p, i) => (
          // Anchor each row so the node can align this parameter's `val-<id>` output handle to it
          // (pobj-source exposes every parameter as an output endpoint; without the ref they'd all
          // stack at the node's default handle position). onRowRef is a no-op where unused (Properties tab).
          <div key={p.id} ref={(el) => onRowRef?.(p.id, el)} className="space-y-0.5">
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
        <div key={p.id} ref={(el) => onRowRef?.(p.id, el)} className={`space-y-1 rounded-md border border-slate-200 bg-slate-50/60 p-1.5${propVisible(p, props) ? "" : " opacity-60"}`}>
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
            <OptionsInput p={p} className={`${inputCls} w-full`} onChange={(patch) => update(p.id, patch)} />
          )}

          {valueControl(p)}

          {/* Conditional visibility — show this parameter only when another checkbox / select prop matches.
              Only offered when there's a gate to point at; clearing it back to "Always" drops the showIf. */}
          {(() => {
            const gates = props.filter((x) => x.id !== p.id && (x.type === "checkbox" || x.type === "select"));
            if (gates.length === 0) return null;
            const g = p.showIf?.when ? props.find((x) => x.id === p.showIf!.when) : undefined;
            return (
              <div className="flex items-center gap-1 border-t border-slate-200/70 pt-1">
                <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-400">Show when</span>
                <select
                  className={`${inputCls} min-w-0 flex-1`}
                  value={p.showIf?.when ?? ""}
                  onChange={(e) => {
                    const when = e.target.value;
                    if (!when) { update(p.id, { showIf: undefined }); return; }
                    const gg = props.find((x) => x.id === when);
                    update(p.id, { showIf: { when, equals: gg?.type === "checkbox" ? true : (gg?.options[0] ?? "") } });
                  }}
                >
                  <option value="">Always</option>
                  {gates.map((x) => <option key={x.id} value={x.id}>{x.name.trim() || "Parameter"}</option>)}
                </select>
                {g?.type === "checkbox" && (
                  <select className={`${inputCls} w-24 shrink-0`} value={p.showIf?.equals === true ? "1" : "0"} onChange={(e) => update(p.id, { showIf: { when: g.id, equals: e.target.value === "1" } })}>
                    <option value="1">is checked</option>
                    <option value="0">is unchecked</option>
                  </select>
                )}
                {g?.type === "select" && (
                  <select className={`${inputCls} w-24 shrink-0`} value={String(p.showIf?.equals ?? "")} onChange={(e) => update(p.id, { showIf: { when: g.id, equals: e.target.value } })}>
                    {g.options.length === 0 && <option value="">—</option>}
                    {g.options.map((o) => <option key={o} value={o}>{`= ${o}`}</option>)}
                  </select>
                )}
              </div>
            );
          })()}
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
