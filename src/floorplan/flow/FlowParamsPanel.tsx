import { FLOW_TOOLS, type FlowToolType, type ParamField } from "./flowTypes";
import { PlaceObjectEditor } from "./PlaceObjectEditor";
import { DimensionEdgesEditor } from "./DimensionEdgesEditor";
import { InputPropsEditor } from "./InputPropsEditor";
import type { SerializedFlow, SerializedFlowNode } from "../types";

/** Tools that have a custom editor (no static `fields`) but should still surface in the Properties tab. */
const CUSTOM_EDITOR_TOOLS = new Set<FlowToolType>(["place-object", "input-props", "pobj-source"]);

/** Props-driven tools: no static `fields` — their parameters live in a `props` ARRAY and render through the
 *  shared InputPropsEditor. An imported parametric object (`pobj-source`) is an Input Properties node whose
 *  props came from a .pobj file rather than being typed by hand, so it surfaces identically here.
 *  `grab-object` is deliberately excluded: it MIRRORS a canvas attachment (the host bakes its props on every
 *  sync), so an edit here would be silently overwritten — its values are edited on the host element. */
const PROPS_EDITOR_TOOLS = new Set<string>(["input-props", "pobj-source"]);

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
  /** The selected element's DISPLAY id ("Node001" / "Segment003" / "Space002") — the same string shown in
   *  the ID field above and typed into a flow root's `id`. Scopes briefs to the element they're wired to,
   *  so many objects can each drive their own node/segment/space. Omit to keep the old global behaviour. */
  elementId?: string;
  /** Library object ids that already have a canvas ATTACHMENT block on this element (the "Parametric Object"
   *  block). A brief for the same object would be a SECOND Properties block for one thing, and the attachment
   *  block is the one that drives the 2D/3D canvas render — so its flow brief is suppressed here. Objects
   *  wired in the flow but never attached still show. */
  attachedObjectIds?: string[];
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  /** Routes a param edit to the FLOW node rather than the selected element's `graphAttrs`. Needed for the
   *  array-shaped custom editors (a props-driven brief, Place Object): their params are global to the flow
   *  node, and graphAttrs stores scalars keyed by a field's ROLE — there's no home for an array there, so a
   *  per-element write would corrupt the element instead of editing the brief. Falls back to
   *  `onParamChange` when absent (Space scope, where that already writes to the flow). */
  onFlowParamChange?: (nodeId: string, key: string, value: unknown) => void;
  onEdit?: () => void;
  /** Flow LIVE mode — the same host state the flow editor's footer toggle drives, surfaced here so a flow
   *  can be made live (space-producing nodes materialise as real, editable Spaces) without opening the
   *  overlay. The toggle is hidden when `onToggleLive` is absent. */
  live?: boolean;
  onToggleLive?: () => void;
  /** Place Object node id + object index to emphasise — set while that object is dragged on the canvas,
   *  so its properties scroll into view and highlight here. */
  highlightNodeId?: string;
  highlightObjectIndex?: number;
}

/** The flow nodes directly downstream of the scope's input root. For Node/Segment scopes the root is the
 *  Node-source / Segment-source generators, or the Canvas node's matching typed endpoint (out-1 Nodes,
 *  out-2 Segments). */
const connectedInputNodes = (flow: SerializedFlow, scope: FlowParamsScope, elementId?: string): SerializedFlowNode[] => {
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
    const root = byId.get(e.source);
    if (!isRoot(root, e.sourceHandle)) continue;
    // A root PINNED to another element's id doesn't speak for this one — without this, an object hosted on
    // Node002 (Node → Parametric Object) would show in every node's Properties.
    if (!rootMatchesElement(root, elementId)) continue;
    targetIds.add(e.target);
  }
  return nodes.filter((n) => {
    const tool = n.data?.tool as FlowToolType;
    return targetIds.has(n.id) && ((FLOW_TOOLS[tool]?.fields?.length ?? 0) > 0 || CUSTOM_EDITOR_TOOLS.has(tool));
  });
};

/** The root tools of each scope, matched as an edge TARGET. No source-handle discrimination here (unlike
 *  `connectedInputNodes`): an association edge lands on the root node itself, not on a typed endpoint. */
const ROOT_TOOLS: Record<FlowParamsScope, string[]> = {
  space: ["source"],
  node: ["node-source", "canvas-source"],
  segment: ["segment-source", "canvas-source"],
};

/** Does a root node reference the selected element? This is what scopes a brief to ONE component, so many
 *  objects can each drive their own node/segment/space:
 *   • canvas-source — the whole-canvas root, references everything → always matches.
 *   • grab-from-selection ON (the default) — the root's id tracks the selection, so it IS this element.
 *   • grab OFF — the root pins a comma-separated display-id list ("Node001, Node004"); match against it.
 *  A pinned root with an EMPTY id references nothing, so it claims no element (rather than all of them). */
const rootMatchesElement = (root: SerializedFlowNode | undefined, elementId?: string): boolean => {
  if (!root) return false;
  if (root.data?.tool === "canvas-source") return true;
  const params = (root.data?.params ?? {}) as Record<string, unknown>;
  if (params.grabFromSelection !== false) return true;
  if (!elementId) return true; // caller didn't scope → keep the old global behaviour
  const ids = String(params.id ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return ids.includes(elementId);
};

/** The BRIEF for a component: a props-driven node (Input Properties, or an imported parametric object)
 *  wired INTO the scope's root node. A root is canvas-fed and ignores incoming geometry, so that edge
 *  carries no data — it declares "this parameter panel belongs to that component". When one is present it
 *  REPLACES the downstream ops in the panel: the brief is what the user tunes, and the ops are driven from
 *  its `val-*` wires (a param fed by a wire is overridden on every eval, so showing the op's own control
 *  there would be a lie). Scoped by `elementId` — a brief wired to the Node001 root shows only on Node001. */
const briefNodes = (flow: SerializedFlow, scope: FlowParamsScope, elementId?: string): SerializedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = ROOT_TOOLS[scope];
  const ids = new Set<string>();
  for (const e of flow.edges ?? []) {
    // `valin-*` is a value wire into one param — not an association. `gin-*` IS accepted: a Node root has no
    // plain input (`"input": false`), so its Stamp endpoint (the green dot) is the ONLY way to wire an
    // object into it. Skipping `gin-` made a brief unreachable for node scope entirely.
    if (e.targetHandle?.startsWith("valin-")) continue;
    const root = byId.get(e.target);
    if (!roots.includes(root?.data?.tool ?? "")) continue;
    if (!rootMatchesElement(root, elementId)) continue;
    if (PROPS_EDITOR_TOOLS.has(byId.get(e.source)?.data?.tool ?? "")) ids.add(e.source);
  }
  return nodes.filter((n) => ids.has(n.id));
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

export const FlowParamsPanel = ({ flow, scope = "space", segmentType, attrs, elementId, attachedObjectIds, onParamChange, onFlowParamChange, onEdit, live, onToggleLive, highlightNodeId, highlightObjectIndex }: FlowParamsPanelProps) => {
  // Hide type-specific segment processors that don't match the selected segment: a Door shows only
  // "Segment to Door" params, a Window only "Segment to Window" (other processors apply to any segment).
  // A props-driven node wired into this scope's root is the component's brief — it REPLACES the downstream
  // ops here rather than adding to them (see briefNodes). Drop any brief whose object already has a canvas
  // attachment block on this element: that block is the single Properties home for an attached object (and
  // the one that drives the render), so its flow brief would be a duplicate.
  const hideObjects = new Set(attachedObjectIds ?? []);
  const brief = briefNodes(flow, scope, elementId).filter((n) => {
    const oid = String((n.data?.params as Record<string, unknown> | undefined)?.objectId ?? "");
    return !oid || !hideObjects.has(oid);
  });
  const inputNodes = brief.length ? brief : [
    ...connectedInputNodes(flow, scope, elementId).filter((node) => {
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
  // A brief is a single FLOW node shared by every component of this kind, so it is never per-element —
  // its values live on the flow node, not on the selected element's graphAttrs.
  const perElement = scope !== "space" && brief.length === 0;
  return (
    <div className="mt-2 space-y-1.5 border-t border-slate-200 pt-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold text-slate-500">{perElement ? "Element Parameters" : "Flow Parameters"}</span>
        <div className="flex items-center gap-1">
          {onToggleLive && (
            <button
              type="button"
              className={`h-5 rounded border px-1.5 text-[9px] ${live ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700" : "border-slate-200 text-emerald-700 hover:bg-emerald-50"}`}
              onClick={onToggleLive}
              title="Live — draw each space-producing node's output (Inset, Optimise Rectangle, …) as a real, editable Space that updates as you change parameters (no Run needed). Toggle off to go back to preview."
            >
              Live{live ? " · on" : ""}
            </button>
          )}
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
            {/* A named node (or an imported parametric object) titles its block with that name, keeping the
                tool label alongside as a muted suffix — matches the node header in the flow editor. */}
            {(() => {
              const custom = typeof params.nodeLabel === "string" ? params.nodeLabel.trim() : "";
              return (
                <span className="flex items-baseline gap-1 text-[10px] font-semibold text-slate-600">
                  <span>{custom || def.label}</span>
                  {custom && <span className="text-[9px] font-medium text-slate-400">{def.label}</span>}
                </span>
              );
            })()}
            {node.data.tool === "place-object" ? (
              <PlaceObjectEditor
                params={params}
                onParamChange={(key, val) => (onFlowParamChange ?? onParamChange)(node.id, key, val)}
                highlightIndex={node.id === highlightNodeId ? highlightObjectIndex : undefined}
              />
            ) : PROPS_EDITOR_TOOLS.has(node.data.tool) ? (
              <InputPropsEditor
                params={params}
                onParamChange={(key, val) => (onFlowParamChange ?? onParamChange)(node.id, key, val)}
                valuesOnly
                hideGated
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

/** Agent nodes associated with the scope's root element — an `agent` node wired to the Space/Node/Segment
 *  source (EITHER direction: Space → Agent for the geometry it reads, or Agent → Space as an association),
 *  scoped by `elementId` the same way briefs are. The counterpart of {@link briefNodes} for the Agent block. */
const agentNodes = (flow: SerializedFlow, scope: FlowParamsScope, elementId?: string): SerializedFlowNode[] => {
  const nodes = flow.nodes ?? [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const roots = ROOT_TOOLS[scope];
  const ids = new Set<string>();
  for (const e of flow.edges ?? []) {
    if (e.targetHandle?.startsWith("valin-")) continue; // a value wire into a param, not an association
    const tTool = byId.get(e.target)?.data?.tool ?? "";
    const sTool = byId.get(e.source)?.data?.tool ?? "";
    let root: SerializedFlowNode | undefined;
    let agentId: string | undefined;
    if (roots.includes(tTool) && sTool === "agent") { root = byId.get(e.target); agentId = e.source; }
    else if (roots.includes(sTool) && tTool === "agent") { root = byId.get(e.source); agentId = e.target; }
    if (!root || !agentId || !rootMatchesElement(root, elementId)) continue;
    ids.add(agentId);
  }
  return nodes.filter((n) => ids.has(n.id));
};

interface FlowAgentPanelProps {
  flow: SerializedFlow;
  /** Which component's inputs to root on. Default "space". */
  scope?: FlowParamsScope;
  /** The selected element's DISPLAY id — scopes the agent to the one it's wired to. */
  elementId?: string;
  /** Edit one of the agent node's params (instructions / prompt / rounds) — routed like a brief edit. */
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  /** Run the agent node headlessly against the connected geometry (the host does the model call + bake). */
  onRun: (nodeId: string, params: Record<string, unknown>) => void;
}

/** Properties-tab block for an Agent node wired to the selected Space/Node/Segment. Surfaces the same
 *  controls as the flow node — Instructions, Prompt, Refine rounds — plus a Run button, so the agent can be
 *  tuned and run without opening the flow. Rendered as a SEPARATE block beside {@link FlowParamsPanel}'s
 *  Input Properties block. Renders nothing when no Agent node is connected. */
export const FlowAgentPanel = ({ flow, scope = "space", elementId, onParamChange, onRun }: FlowAgentPanelProps) => {
  const agents = agentNodes(flow, scope, elementId);
  if (agents.length === 0) return null;
  return (
    <>
      {agents.map((node) => {
        const p = (node.data?.params ?? {}) as Record<string, unknown>;
        const rounds = Math.max(1, Math.min(5, Math.round(Number(p.rounds) || 1)));
        const busy = Boolean(p._busy);
        return (
          <div key={node.id} className="mt-2 space-y-1.5 rounded-md border border-violet-200 bg-violet-50/60 p-2">
            <span className="text-[10px] font-semibold text-violet-700">Agent</span>
            <div className="space-y-0.5">
              <span className="text-[10px] text-slate-500">Instructions</span>
              <textarea
                className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px]"
                rows={5}
                value={typeof p.instructions === "string" ? p.instructions : ""}
                placeholder="Paste the persona here — what judgement should it apply?"
                onChange={(e) => onParamChange(node.id, "instructions", e.target.value)}
              />
            </div>
            <div className="space-y-0.5">
              <span className="text-[10px] text-slate-500">Prompt</span>
              <textarea
                className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px]"
                rows={2}
                value={typeof p.prompt === "string" ? p.prompt : ""}
                placeholder="e.g. 120-person startup office, open plan…"
                onChange={(e) => onParamChange(node.id, "prompt", e.target.value)}
              />
            </div>
            <div className="space-y-0.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Refine rounds</span>
                <span className="font-mono text-[10px] text-slate-700">{rounds}</span>
              </div>
              <input
                type="range" className="w-full" min={1} max={5} step={1} value={rounds}
                onChange={(e) => onParamChange(node.id, "rounds", +e.target.value)}
              />
            </div>
            <button
              type="button"
              className="h-7 w-full rounded bg-violet-600 px-2 text-[11px] font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
              disabled={busy}
              onClick={() => onRun(node.id, node.data?.params ?? {})}
            >
              {busy ? "Analysing…" : "Run"}
            </button>
            {typeof p._status === "string" && p._status && (
              <p className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] leading-tight text-violet-700">{String(p._status)}</p>
            )}
            {Boolean(p._stale) && !busy && (
              <p className="rounded bg-amber-50 px-1.5 py-0.5 text-[9px] leading-tight text-amber-700">⚠ Stale — the space, instructions, prompt or chain changed since this ran. Press Run to refresh.</p>
            )}
            {typeof p.rationale === "string" && p.rationale && (
              <p className="rounded bg-white px-1.5 py-0.5 text-[9px] italic leading-tight text-slate-600">{String(p.rationale)}</p>
            )}
          </div>
        );
      })}
    </>
  );
};
