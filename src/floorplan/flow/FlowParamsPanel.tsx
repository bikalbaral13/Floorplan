import { FLOW_TOOLS, type FlowToolType, type ParamField } from "./flowTypes";
import type { SerializedFlow, SerializedFlowNode } from "../types";

/** Properties-tab renderer for a Space's attached Flow. Surfaces the parameters of whatever node(s)
 *  the "Selected Space" (source) node is wired to — so editing them here is equivalent to editing that
 *  node in the flow. Edits call `onParamChange`, which the host applies (to the open overlay, or to the
 *  stored graph) and re-evaluates for a live preview. Renders nothing if nothing is connected. */
interface FlowParamsPanelProps {
  flow: SerializedFlow;
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  onEdit?: () => void;
}

/** The nodes directly downstream of a Source node (i.e. wired to the Selected Space). */
const connectedInputNodes = (flow: SerializedFlow): SerializedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  const sourceIds = new Set(nodes.filter((n) => n.data?.tool === "source").map((n) => n.id));
  if (sourceIds.size === 0) return [];
  const targetIds = new Set((flow.edges ?? []).filter((e) => sourceIds.has(e.source)).map((e) => e.target));
  return nodes.filter((n) => targetIds.has(n.id) && (FLOW_TOOLS[n.data?.tool as FlowToolType]?.fields?.length ?? 0) > 0);
};

const Field = ({
  field,
  value,
  onChange,
}: {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
}) => {
  if (field.kind === "range") {
    const num = typeof value === "number" ? value : 0;
    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500">{field.label}</span>
          <span className="font-mono text-[10px] text-slate-700">
            {num.toFixed(2)}{field.unit ? ` ${field.unit}` : ""}
          </span>
        </div>
        <input
          type="range"
          className="w-full"
          min={field.min}
          max={field.max}
          step={field.step}
          value={num}
          onChange={(e) => onChange(+e.target.value)}
        />
      </div>
    );
  }
  if (field.kind === "text" || field.kind === "textarea") {
    const str = typeof value === "string" ? value : "";
    return (
      <div className="space-y-0.5">
        <span className="text-[10px] text-slate-500">{field.label}</span>
        {field.kind === "textarea" ? (
          <textarea
            className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px]"
            rows={2}
            placeholder={field.placeholder}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            type="text"
            className="h-6 w-full rounded border border-slate-200 px-1.5 text-[10px]"
            placeholder={field.placeholder}
            value={str}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[10px] text-slate-500">{field.label}</span>
      {field.kind === "number" && (
        <input
          type="number"
          className="h-6 w-20 rounded border border-slate-200 px-1 text-[10px] font-mono"
          min={field.min}
          max={field.max}
          step={field.step}
          value={typeof value === "number" ? value : 0}
          onChange={(e) => onChange(+e.target.value)}
        />
      )}
      {field.kind === "select" && (
        <select
          className="h-6 w-28 rounded border border-slate-200 px-1 text-[10px]"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        >
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}
      {field.kind === "checkbox" && (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
    </div>
  );
};

export const FlowParamsPanel = ({ flow, onParamChange, onEdit }: FlowParamsPanelProps) => {
  const inputNodes = connectedInputNodes(flow);
  if (inputNodes.length === 0) return null;
  return (
    <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500">Flow Parameters</span>
        {onEdit && (
          <button
            type="button"
            className="h-5 rounded border border-slate-200 px-1.5 text-[9px] text-slate-600 hover:bg-slate-50"
            onClick={onEdit}
          >
            Edit flow
          </button>
        )}
      </div>
      {inputNodes.map((node) => {
        const def = FLOW_TOOLS[node.data.tool as FlowToolType];
        const params = node.data.params ?? {};
        const fields = def.fields.filter((f) => !f.showIf || f.showIf(params));
        return (
          <div key={node.id} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2">
            <span className="text-[10px] font-semibold text-slate-600">{def.label}</span>
            {fields.map((f) => (
              <Field
                key={f.key}
                field={f}
                value={params[f.key]}
                onChange={(v) => onParamChange(node.id, f.key, v)}
              />
            ))}
          </div>
        );
      })}
    </div>
  );
};
