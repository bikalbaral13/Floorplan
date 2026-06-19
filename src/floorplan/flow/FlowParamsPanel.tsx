import { FLOW_TOOLS, type FlowToolType, type ParamField } from "./flowTypes";
import { PlaceObjectEditor } from "./PlaceObjectEditor";
import { DimensionEdgesEditor } from "./DimensionEdgesEditor";
import { InputPropsEditor } from "./InputPropsEditor";
import type { SerializedFlow, SerializedFlowNode } from "../types";

/** Tools that have a custom editor (no static `fields`) but should still surface in the Properties tab. */
const CUSTOM_EDITOR_TOOLS = new Set<FlowToolType>(["place-object", "input-props"]);

/** Which canvas component the panel is surfacing flow params for. Each scope roots on a different
 *  input: Space → the "source" node; Node → Node/Canvas(out-1 Nodes); Segment → Segment/Canvas(out-2). */
export type FlowParamsScope = "space" | "node" | "segment";

/** Properties-tab renderer for the attached Flow. Surfaces the parameters of whatever node(s) the
 *  relevant input (Space source / Canvas Nodes / Canvas Segments) is wired to — so editing them here is
 *  equivalent to editing that node in the flow (GLOBAL: one set applied to every component of that kind;
 *  per-component values come from an attached Schema instead). Edits call `onParamChange`, which the host
 *  applies and re-evaluates. Renders nothing if nothing is connected. */
interface FlowParamsPanelProps {
  flow: SerializedFlow;
  /** Which component's inputs to root on. Default "space". */
  scope?: FlowParamsScope;
  /** Segment scope only — the selected segment's type, so type-specific processors are filtered: a Door
   *  segment only shows "Segment to Door" params, a Window only "Segment to Window". */
  segmentType?: string;
  /** When set (Node / Segment scope), the SELECTED element's stored values (graphAttrs) — shown in
   *  preference to the flow node's param, so edits are PER-ELEMENT (the host writes them to graphAttrs). */
  attrs?: Record<string, unknown>;
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  onEdit?: () => void;
  /** Place Object node id + object index to emphasise — set while that object is dragged on the canvas,
   *  so its properties scroll into view and highlight here. */
  highlightNodeId?: string;
  highlightObjectIndex?: number;
}

/** The flow nodes directly downstream of the scope's input root. For Node/Segment scopes the root is the
 *  Node-source / Segment-source generators, or the Canvas node's matching typed endpoint (out-1 Nodes,
 *  out-2 Segments). */
const connectedInputNodes = (flow: SerializedFlow, scope: FlowParamsScope): SerializedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const isRoot = (n: SerializedFlowNode | undefined, sourceHandle: string | null | undefined): boolean => {
    if (!n) return false;
    const tool = n.data?.tool;
    if (scope === "space") return tool === "source";
    if (scope === "node") return tool === "node-source" || (tool === "canvas-source" && sourceHandle === "out-1");
    return tool === "segment-source" || (tool === "canvas-source" && sourceHandle === "out-2");
  };
  const targetIds = new Set<string>();
  for (const e of flow.edges ?? []) {
    if (isRoot(byId.get(e.source), e.sourceHandle)) targetIds.add(e.target);
  }
  return nodes.filter((n) => {
    const tool = n.data?.tool as FlowToolType;
    return targetIds.has(n.id) && ((FLOW_TOOLS[tool]?.fields?.length ?? 0) > 0 || CUSTOM_EDITOR_TOOLS.has(tool));
  });
};

/** Graph to Walls (wall-builder) nodes fed by the whole-canvas Graph (canvas-source out-3) or a graph-source.
 *  These are graph-level (not rooted on a per-segment source), but each wall's thickness/justification are
 *  resolved per-segment by role — so they're surfaced in the segment Properties tab for WALL segments. */
const wallBuilderNodes = (flow: SerializedFlow): SerializedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const fed = new Set<string>();
  for (const e of flow.edges ?? []) {
    const srcTool = byId.get(e.source)?.data?.tool;
    if (srcTool === "graph-source" || (srcTool === "canvas-source" && e.sourceHandle === "out-3")) {
      if (byId.get(e.target)?.data?.tool === "wall-builder") fed.add(e.target);
    }
  }
  return nodes.filter((n) => fed.has(n.id));
};

/** Shown next to a field label when this element overrides the flow default — one click resets it. */
const ResetBadge = ({ show, onReset }: { show?: boolean; onReset?: () => void }) =>
  show && onReset ? (
    <button
      type="button"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); onReset(); }}
      title="Overridden for this element — click to reset to the flow default"
      className="rounded bg-cyan-100 px-1 text-[8px] font-semibold uppercase tracking-wide text-cyan-700 hover:bg-cyan-200"
    >
      reset
    </button>
  ) : null;

const Field = ({
  field,
  value,
  onChange,
  params,
  overridden,
  onReset,
}: {
  field: ParamField;
  value: unknown;
  onChange: (v: unknown) => void;
  params?: Record<string, unknown>;
  /** Per-element mode: this element has its OWN stored value (overriding the flow default). */
  overridden?: boolean;
  onReset?: () => void;
}) => {
  if (field.kind === "range") {
    const num = typeof value === "number" ? value : 0;
    return (
      <div className="space-y-0.5">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[10px] text-slate-500">{field.label}<ResetBadge show={overridden} onReset={onReset} /></span>
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
        <span className="flex items-center gap-1.5 text-[10px] text-slate-500">{field.label}<ResetBadge show={overridden} onReset={onReset} /></span>
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
      <span className="flex items-center gap-1.5 text-[10px] text-slate-500">{field.label}<ResetBadge show={overridden} onReset={onReset} /></span>
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
      {field.kind === "select" && (() => {
        const dyn = field.optionsFromParam ? (params?.[field.optionsFromParam] as { value: string; label: string }[] | undefined) : undefined;
        const opts = dyn ?? field.options ?? [];
        return (
          <select
            className="h-6 w-28 rounded border border-slate-200 px-1 text-[10px]"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
          >
            {field.optionsFromParam && <option value="">{opts.length ? "— select —" : "— connect a node —"}</option>}
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      })()}
      {field.kind === "checkbox" && (
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
        />
      )}
      {field.kind === "color" && (
        <input
          type="color"
          className="h-6 w-10 rounded border border-slate-200 bg-white p-0.5"
          value={typeof value === "string" && value ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
};

export const FlowParamsPanel = ({ flow, scope = "space", segmentType, attrs, onParamChange, onEdit, highlightNodeId, highlightObjectIndex }: FlowParamsPanelProps) => {
  // Hide type-specific segment processors that don't match the selected segment: a Door shows only
  // "Segment to Door" params, a Window only "Segment to Window" (other processors apply to any segment).
  const inputNodes = [
    ...connectedInputNodes(flow, scope).filter((node) => {
      const tool = node.data.tool;
      if (tool === "segment-to-door") return segmentType === "door";
      if (tool === "segment-to-window") return segmentType === "window";
      return true;
    }),
    // Graph to Walls is fed by the whole-canvas Graph (not a per-segment source) — surface its per-wall
    // thickness/justification here for WALL segments only.
    ...(scope === "segment" && segmentType === "wall" ? wallBuilderNodes(flow) : []),
  ];
  if (inputNodes.length === 0) return null;
  const perElement = scope !== "space";
  return (
    <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500">{perElement ? "Element Parameters" : "Flow Parameters"}</span>
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
        // In per-element mode, hide flow-level fields that aren't read per-element (e.g. "Apply to" — a
        // type filter set in the flow editor; "mode" — the line/buffered switch).
        const fields = def.fields.filter((f) =>
          (!f.showIf || f.showIf(params)) && !(perElement && (f.key === "applyTo" || f.key === "mode")));
        return (
          <div key={node.id} className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/60 p-2">
            <span className="text-[10px] font-semibold text-slate-600">{def.label}</span>
            {node.data.tool === "place-object" ? (
              <PlaceObjectEditor
                params={params}
                onParamChange={(key, val) => onParamChange(node.id, key, val)}
                highlightIndex={node.id === highlightNodeId ? highlightObjectIndex : undefined}
              />
            ) : node.data.tool === "input-props" ? (
              <InputPropsEditor
                params={params}
                onParamChange={(key, val) => onParamChange(node.id, key, val)}
                valuesOnly
              />
            ) : (
              <>
                {fields.map((f) => {
                  // Per-element edits are stored under the canonical ROLE (shared with the Schema block +
                  // processors); the global default still comes from the flow node's param (params[f.key]).
                  const sk = perElement ? (f.role ?? f.key) : f.key;
                  const overridden = perElement && attrs != null && attrs[sk] != null;
                  return (
                    <Field
                      key={f.key}
                      field={f}
                      value={perElement && attrs ? (attrs[sk] ?? params[f.key]) : params[f.key]}
                      onChange={(v) => onParamChange(node.id, sk, v)}
                      params={params}
                      overridden={overridden}
                      onReset={() => onParamChange(node.id, sk, null)}
                    />
                  );
                })}
                {/* Dimension · Edgewise: per-edge checkbox grid below the fields. */}
                {node.data.tool === "dimension" && params.mode === "edgewise" && (
                  <DimensionEdgesEditor params={params} onParamChange={(key, val) => onParamChange(node.id, key, val)} />
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
};
