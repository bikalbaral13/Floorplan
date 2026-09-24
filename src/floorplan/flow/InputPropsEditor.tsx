import { useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { DEFAULT_PROP_COLOR, inputProps, propVisible, type InputProp, type InputPropType } from "./flowTypes";

let propSeq = 1;
export const nextPropId = () => `p_${propSeq++}_${Math.random().toString(36).slice(2, 6)}`;

const TYPE_OPTIONS: { value: InputPropType; label: string }[] = [
  { value: "range", label: "Slider" },
  { value: "select", label: "Options" },
  { value: "checkbox", label: "Checkbox" },
  { value: "text", label: "Textbox" },
  { value: "color", label: "Colour" },
  { value: "button", label: "Run button" },
];

/** Default value for a freshly-chosen control type. */
const defaultValue = (type: InputPropType, options: string[]): string | number | boolean =>
  type === "checkbox" ? false
  : type === "range" || type === "button" ? 0
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
  wired,
  onRunAction,
}: {
  params: Record<string, unknown>;
  onParamChange: (key: string, value: unknown) => void;
  onRowRef?: (propId: string, el: HTMLDivElement | null) => void;
  nodrag?: boolean;
  valuesOnly?: boolean;
  /** Parameters currently DRIVEN by a wire into their `valin-<id>` endpoint, keyed by prop id. Their control
   *  is replaced by a read-only readout of the incoming value: the wire overwrites the stored value on every
   *  evaluation, so leaving an editable slider there would be a lie. */
  wired?: Record<string, number | string>;
  /** What a `button` parameter DOES beyond bumping its run counter — supplied by the flow editor, where a
   *  press also applies the graph's pending Set Object Param writes. Absent in the Properties tab, where
   *  there is no graph to commit: the button still counts up, so a gated Math Engine still runs. */
  onRunAction?: (p: InputProp) => void;
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
    setProps([...props, { id: nextPropId(), name: "", type: "range", value: 0, min: 0, max: 10, step: 1, options: [], editable: true, showInCanvas: false, necessary: true }]);
  const inputCls = `h-6 rounded border border-slate-200 px-1.5 text-[10px]${nd}`;

  // The value control for a parameter — shared by both modes. A parameter fed by a wire shows the INCOMING
  // value read-only instead: its own control is overridden on every evaluation.
  const valueControl = (p: InputProp) => {
    const w = wired?.[p.id];
    // `editable: false` locks the parameter for the CONSUMER only. The flow-canvas editor keeps its
    // control live — that is where the flag is set, and a parameter you locked by mistake has to
    // remain fixable.
    const locked = !!valuesOnly && !p.editable;
    if (w != null) {
      return (
        <div className="flex items-center gap-1.5 rounded bg-amber-50 px-1.5 py-0.5" title="Driven by the value wired into this parameter">
          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-amber-500">wired</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-amber-800">
            {p.type === "checkbox" ? (Number(w) !== 0 ? "On (1)" : "Off (0)") : String(w)}
          </span>
        </div>
      );
    }
    const lockTitle = locked ? "Locked by the flow author — not editable here" : undefined;
    const lockCls = locked ? " cursor-not-allowed opacity-60" : "";
    if (p.type === "button") {
      const runs = typeof p.value === "number" ? p.value : 0;
      return (
        <button
          type="button"
          disabled={locked}
          title={locked ? lockTitle : "Run — solve and apply"}
          className={`flex h-6 w-full items-center justify-center gap-1.5 rounded bg-teal-600 px-2 text-[10px] font-semibold text-white hover:bg-teal-700${nd}${lockCls}`}
          onClick={() => {
            // A NEW value every press. Re-pressing with the same number would be "no change" to the
            // graph, so a re-run after editing something upstream would silently do nothing.
            const next = runs + 1;
            update(p.id, { value: next });
            onRunAction?.({ ...p, value: next });
          }}
        >
          <Play className="h-3 w-3" />
          {p.name.trim() || "Run"}
          {runs > 0 && <span className="font-mono text-[9px] font-normal opacity-70">#{runs}</span>}
        </button>
      );
    }
    if (p.type === "range") {
      return (
        <div className="flex items-center gap-1.5" title={lockTitle}>
          <input
            type="range"
            className={`min-w-0 flex-1${nd}${lockCls}`}
            min={p.min}
            max={p.max}
            step={p.step || 1}
            value={typeof p.value === "number" ? p.value : 0}
            disabled={locked}
            onChange={(e) => update(p.id, { value: +e.target.value })}
          />
          <span className="w-10 shrink-0 text-right font-mono text-[10px] text-slate-700">{typeof p.value === "number" ? p.value : 0}</span>
        </div>
      );
    }
    if (p.type === "select") {
      return (
        <select className={`${inputCls} w-full${lockCls}`} title={lockTitle} value={String(p.value ?? "")} disabled={locked} onChange={(e) => update(p.id, { value: e.target.value })}>
          {p.options.length === 0 && <option value="">—</option>}
          {p.options.map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      );
    }
    if (p.type === "checkbox") {
      return (
        <label className={`flex items-center gap-1.5 text-[10px] text-slate-600${lockCls}`} title={lockTitle}>
          <input type="checkbox" className={nd.trim()} checked={p.value === true} disabled={locked} onChange={(e) => update(p.id, { value: e.target.checked })} />
          {p.value === true ? "On (1)" : "Off (0)"}
        </label>
      );
    }
    if (p.type === "color") {
      const hex = typeof p.value === "string" && p.value ? p.value : DEFAULT_PROP_COLOR;
      return (
        <div className="flex items-center gap-1.5" title={lockTitle}>
          <input
            type="color"
            className={`h-6 w-8 shrink-0 cursor-pointer rounded border border-slate-200 bg-white${nd}${lockCls}`}
            value={hex}
            disabled={locked}
            onChange={(e) => update(p.id, { value: e.target.value })}
          />
          <span className="font-mono text-[10px] text-slate-700">{hex}</span>
        </div>
      );
    }
    return <input type="text" className={`${inputCls} w-full${lockCls}`} title={lockTitle} placeholder="value" value={String(p.value ?? "")} disabled={locked} onChange={(e) => update(p.id, { value: e.target.value })} />;
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
            {/* A button already carries its own name on its face — a label above it would say it twice. */}
            {p.type !== "button" && <span className="text-[10px] text-slate-500">{p.name.trim() || `Parameter ${i + 1}`}</span>}
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

          {/* Editable — whether the CONSUMER (Properties tab) may change this value. On by default, and
              absent from files authored before it existed, which read as editable. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <label className={`flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-slate-400${nd}`} title="Allow this parameter to be changed from the Properties tab">
              <input type="checkbox" className={nd.trim()} checked={p.editable} onChange={(e) => update(p.id, { editable: e.target.checked })} />
              Editable
            </label>

            {/* Draw the live value on the plan, at the host's anchor: Space → centroid, Segment → midpoint,
                Node → over the point. Off by default so no existing object starts labelling itself. */}
            <label className={`flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-slate-400${nd}`} title="Draw this value on the 2D canvas — at the Space centroid / Segment midpoint / over the Node">
              <input type="checkbox" className={nd.trim()} checked={p.showInCanvas} onChange={(e) => update(p.id, { showInCanvas: e.target.checked })} />
              Show in canvas
            </label>

            <label className={`flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-slate-400${nd}`} title="Mark this parameter as required">
              <input type="checkbox" className={nd.trim()} checked={p.necessary} onChange={(e) => update(p.id, { necessary: e.target.checked })} />
              Necessary
            </label>
          </div>

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
