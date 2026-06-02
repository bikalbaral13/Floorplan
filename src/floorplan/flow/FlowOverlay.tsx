import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  useUpdateNodeInternals,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Button } from "@/components/ui/button";
import { X, Play, Plus, Trash2, Download, Loader2, Wand2, Upload, Sparkles } from "lucide-react";
import { toast } from "sonner";
import type { Point } from "../types";
import { FLOW_TOOLS, type FlowNodeData, type FlowToolType } from "./flowTypes";
import { compileFlow } from "./compileFlow";
import { evaluateFlow, type FlowPreviewItem } from "./eval/evaluateFlow";

let nodeSeq = 1;
const nextId = (tool: string) => `${tool}_${nodeSeq++}`;

/** Human-readable catalog of every node tool + its params, derived from FLOW_TOOLS. Fed to the AI
 *  "Generate JSON" feature so the model emits valid tools/params. */
const buildToolCatalog = (): string =>
  Object.values(FLOW_TOOLS)
    .map((def) => {
      if (def.type === "source") return `- "source": pipeline input (the selected space). Exactly one, id "source", params {}.`;
      const fieldDesc = def.fields
        .map((f) => {
          if (f.kind === "select") return `${f.key} ∈ {${(f.options ?? []).map((o) => o.value).join(", ")}}`;
          if (f.kind === "range" || f.kind === "number") return `${f.key}: number${f.min != null ? ` ${f.min}..${f.max}` : ""}`;
          if (f.kind === "checkbox") return `${f.key}: boolean`;
          return `${f.key}: string`;
        })
        .join("; ");
      const outN = def.outputCount ? "multi-output (out-0, out-1, …)" : def.hasOutput ? "1 output" : "no output (terminal)";
      return `- "${def.type}" (${def.label}); ${outN}; params: ${fieldDesc || "none"}; defaults: ${JSON.stringify(def.defaultParams)}`;
    })
    .join("\n");

/** System instruction for AI flow generation — schema rules + the live tool catalog. */
const FLOW_GEN_INSTRUCTION = `You generate a node-graph "Flow" for an architecture floor-plan tool. Respond with ONLY a JSON object — no prose, no markdown fences.

Schema:
{
  "version": 1,
  "nodes": [ { "id": string, "position": { "x": number, "y": number }, "data": { "tool": string, "params": object } } ],
  "edges": [ { "id": string, "source": nodeId, "target": nodeId, "sourceHandle": string|null, "targetHandle": null } ]
}

Rules:
- Always include exactly one source node: {"id":"source","position":{"x":80,"y":200},"data":{"tool":"source","params":{}}}.
- Other node ids are "<tool>_<n>" (e.g. "inset_1"). Lay nodes left→right: x grows ~240 per stage, vary y around 120–320.
- Wire the pipeline with edges; the first tool connects from "source". targetHandle is always null.
- Single-output nodes use "sourceHandle": null. Multi-output nodes (split, bsp, voronoi, conditional) use "out-0","out-1",…; for "conditional", out-0 = TRUE branch, out-1 = FALSE branch.
- Use ONLY the tools/params below. Start from a tool's "defaults" and change only what the request needs; keep values within the stated ranges/options.

Available tools:
${buildToolCatalog()}`;

/** Generic op node — header + param fields + handles. Reads/writes graph state via
 *  the `onParamChange` callback the host injects into node data. */
const OpNode = ({ id, data }: NodeProps) => {
  const d = data as FlowNodeData;
  const def = FLOW_TOOLS[d.tool];
  const outN = def.outputCount ? def.outputCount(d.params) : def.hasOutput ? 1 : 0;
  // Re-measure this node's handle positions whenever its handle set changes (or on mount). Without
  // this, React Flow can't compute edge paths to the value handles (the edge exists and the value
  // flows, but no curve is drawn). Keyed on the handle count so it also covers Split/Voronoi/BUA.
  const updateNodeInternals = useUpdateNodeInternals();
  const handleSig = `${outN}|${def.valueInputs?.length ?? 0}|${def.valueOutputs?.length ?? 0}`;
  useEffect(() => { updateNodeInternals(id); }, [id, handleSig, updateNodeInternals]);
  return (
    <div className={`relative rounded-md border border-slate-300 bg-white shadow-md ${d.tool === "render" ? "min-w-[230px]" : "min-w-[180px]"}`}>
      {def.hasInput && <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-slate-400" />}
      {/* Scalar value INPUT endpoints (amber, left) — id `valin-<key>`. A wired value overrides the param. */}
      {def.valueInputs?.map((vi, i) => {
        const n = def.valueInputs!.length;
        const top = n === 1 ? 80 : 64 + (i / (n - 1)) * 28;
        return (
          <span key={vi.key}>
            <Handle id={`valin-${vi.key}`} type="target" position={Position.Left} style={{ top: `${top}%` }} className="!h-2.5 !w-2.5 !bg-amber-500" />
            <span style={{ position: "absolute", left: 11, top: `${top}%`, transform: "translateY(-50%)" }} className="pointer-events-none whitespace-nowrap font-mono text-[8px] text-amber-500">
              {vi.label}
            </span>
          </span>
        );
      })}
      <div className="rounded-t-md px-2 py-1 text-[11px] font-semibold text-white" style={{ background: def.color }}>
        {def.label}
      </div>
      <div className="space-y-1.5 px-2 py-1.5">
        {def.fields.length === 0 && (
          <div className="text-[9px] italic text-slate-400">{def.hint}</div>
        )}
        {def.fields
          .filter((f) => !f.showIf || f.showIf(d.params))
          .map((f) => {
            const val = d.params[f.key];
            // Range = full-width slider with a live value label (matches the tool blocks).
            if (f.kind === "range") {
              const num = typeof val === "number" ? val : 0;
              return (
                <div key={f.key} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">{f.label}</span>
                    <span className="font-mono text-[10px] text-slate-700">
                      {num.toFixed(2)}{f.unit ? ` ${f.unit}` : ""}
                    </span>
                  </div>
                  <input
                    type="range"
                    className="w-full nodrag"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={num}
                    onChange={(e) => d.onParamChange?.(id, f.key, +e.target.value)}
                  />
                </div>
              );
            }
            // Text / textarea = full-width stacked field (label above the input).
            if (f.kind === "text" || f.kind === "textarea") {
              const str = typeof val === "string" ? val : "";
              return (
                <div key={f.key} className="space-y-0.5">
                  <span className="text-[10px] text-slate-500">{f.label}</span>
                  {f.kind === "textarea" ? (
                    <textarea
                      className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[10px] nodrag"
                      rows={3}
                      placeholder={f.placeholder}
                      value={str}
                      onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                    />
                  ) : (
                    <input
                      type={f.secret ? "password" : "text"}
                      className="h-6 w-full rounded border border-slate-200 px-1.5 text-[10px] nodrag"
                      placeholder={f.placeholder}
                      value={str}
                      onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                    />
                  )}
                </div>
              );
            }
            return (
              <div key={f.key} className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500">{f.label}</span>
                {f.kind === "number" && (
                  <input
                    type="number"
                    className="h-6 w-20 rounded border border-slate-200 px-1 text-[10px] font-mono nodrag"
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    value={typeof val === "number" ? val : 0}
                    onChange={(e) => d.onParamChange?.(id, f.key, +e.target.value)}
                  />
                )}
                {f.kind === "select" && (
                  <select
                    className="h-6 w-28 rounded border border-slate-200 px-1 text-[10px] nodrag"
                    value={typeof val === "string" ? val : ""}
                    onChange={(e) => d.onParamChange?.(id, f.key, e.target.value)}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                )}
                {f.kind === "checkbox" && (
                  <input
                    type="checkbox"
                    className="nodrag"
                    checked={Boolean(val)}
                    onChange={(e) => d.onParamChange?.(id, f.key, e.target.checked)}
                  />
                )}
              </div>
            );
          })}
        {/* Conditional gate: live metric value + which branch is currently active. */}
        {d.tool === "conditional" && typeof d.params._value === "number" && (
          <div
            className={`flex items-center justify-between rounded px-1.5 py-0.5 text-[9px] font-semibold ${
              d.params._pass ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
            }`}
          >
            <span>
              {String(d.params.metric ?? "area")} = {Number(d.params._value).toFixed(1)}
            </span>
            <span>→ {d.params._pass ? "TRUE" : "FALSE"}</span>
          </div>
        )}
        {/* Render action: Generate button + result image + download link. */}
        {d.tool === "render" && (
          <div className="space-y-1.5">
            <Button
              size="sm"
              className="h-7 w-full gap-1.5 px-2 text-[11px] nodrag"
              disabled={Boolean(d.params._busy)}
              onClick={() => d.onRunRender?.(id, d.params)}
            >
              {d.params._busy
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Rendering…</>
                : <><Wand2 className="h-3 w-3" /> Generate</>}
            </Button>
            {typeof d.params._resultUrl === "string" && (
              <div className="space-y-1">
                <img src={d.params._resultUrl} alt="Render result" className="w-full rounded border border-slate-200" />
                <a
                  href={d.params._resultUrl}
                  download="flow-render.png"
                  className="flex items-center justify-center gap-1 rounded border border-slate-200 py-1 text-[10px] text-slate-600 hover:bg-slate-50 nodrag"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              </div>
            )}
          </div>
        )}
        {/* Scalar value outputs (e.g. Inset area, BUA): each is a labelled row with an amber endpoint
            handle (id `val-<key>`) anchored at the node's right edge — no overlap with the fields. */}
        {def.valueOutputs?.length ? (
          <div className="flex flex-col gap-0.5 pt-0.5">
            {def.valueOutputs.map((vo) => {
              const v = (d.params._values as Record<string, number> | undefined)?.[vo.key];
              return (
                <div key={vo.key} className="flex items-center justify-between rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                  <span>{vo.label}</span>
                  <span className="font-mono">{v != null ? `${v.toFixed(2)}${vo.unit ? ` ${vo.unit}` : ""}` : "—"}</span>
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
      {outN <= 1
        ? def.hasOutput && <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-slate-400" />
        : Array.from({ length: outN }).map((_, i) => {
            const top = ((i + 1) / (outN + 1)) * 100;
            const label = def.outputLabels?.[i] ?? `P${i + 1}`;
            return (
              <span key={i}>
                <span
                  style={{ position: "absolute", right: 9, top: `${top}%`, transform: "translateY(-50%)" }}
                  className="pointer-events-none font-mono text-[8px] text-slate-400"
                >
                  {label}
                </span>
                <Handle
                  id={`out-${i}`}
                  type="source"
                  position={Position.Right}
                  style={{ top: `${top}%` }}
                  className="!h-2.5 !w-2.5 !bg-teal-500"
                />
              </span>
            );
          })}
      {/* Scalar value OUTPUT endpoints (amber, right) — id `val-<key>`. Direct children of the node so
          React Flow registers them as connectable, like the geometry output handles. */}
      {def.valueOutputs?.map((vo, i) => {
        const n = def.valueOutputs!.length;
        const top = n === 1 ? 84 : 72 + (i / (n - 1)) * 22;
        return (
          <Handle
            key={vo.key}
            id={`val-${vo.key}`}
            type="source"
            position={Position.Right}
            style={{ top: `${top}%` }}
            className="!h-2.5 !w-2.5 !bg-amber-500"
          />
        );
      })}
    </div>
  );
};

const nodeTypes = { op: OpNode };

export interface FlowOverlayProps {
  open: boolean;
  onClose: () => void;
  /** Run Flow → commit the pipeline via the app's recipe engine (creates real Spaces). */
  onRunCommit: (json: string) => void;
  /** Pure live preview: the evaluated output polygons per node, for canvas overlay rendering. */
  onPreview: (items: FlowPreviewItem[]) => void;
  /** The selected space's vertices (pixel coords) — the pipeline input. */
  sourcePolygon: Point[];
  /** Pixels-per-metre, for the geometry algorithms. */
  pixelsPerMeter: number;
  /** Label of the currently-selected space (pipeline input), or null. */
  selectedRoomLabel: string | null;
  /** Capture the 3D view's isometric snapshot as a PNG data URL (for the Render node). */
  onCaptureIsometric?: () => Promise<string | null>;
}

interface NodeCallbacks {
  onParamChange: (nodeId: string, key: string, value: unknown) => void;
  onRunRender: (nodeId: string, params: Record<string, unknown>) => void;
}

const makeNode = (
  tool: FlowToolType,
  pos: { x: number; y: number },
  cb: NodeCallbacks,
): Node => {
  const def = FLOW_TOOLS[tool];
  return {
    id: tool === "source" ? "source" : nextId(tool),
    type: "op",
    position: pos,
    // The Source node is the pipeline input — keep it un-deletable so Delete never removes it.
    deletable: tool !== "source",
    data: { tool, params: { ...def.defaultParams }, onParamChange: cb.onParamChange, onRunRender: cb.onRunRender } as FlowNodeData,
  };
};

export const FlowOverlay = (props: FlowOverlayProps) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [initialised, setInitialised] = useState(false);

  // Stable param-edit callback injected into every node's data.
  const onParamChange = useCallback((nodeId: string, key: string, value: unknown) => {
    setNodes((ns) =>
      ns.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...(n.data as FlowNodeData).params, [key]: value } } }
          : n,
      ),
    );
  }, [setNodes]);

  // Render node "Generate": capture the 3D isometric snapshot, send it + the prompt to the Google AI
  // image model, and bake the result (or busy/error state) back onto the node. Stable identity (reads
  // onCaptureIsometric via a ref) so it can be injected once at node creation.
  const captureIsoRef = useRef(props.onCaptureIsometric);
  captureIsoRef.current = props.onCaptureIsometric;
  const onRunRender = useCallback(async (nodeId: string, params: Record<string, unknown>) => {
    const apiKey = String(params.api_key ?? "").trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    const model = String(params.model ?? "gemini-3.1-flash-image-preview").trim() || "gemini-3.1-flash-image-preview";
    const prompt = String(params.prompt ?? "");
    onParamChange(nodeId, "_busy", true);
    onParamChange(nodeId, "_resultUrl", undefined);
    try {
      const snap = await captureIsoRef.current?.();
      if (!snap) { toast.error("Couldn't capture the 3D isometric view"); return; }
      const data = snap.split(",")[1] ?? "";
      const mime = snap.startsWith("data:image/jpeg") ? "image/jpeg" : "image/png";
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data } }] }],
          generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
        }),
      });
      if (!res.ok) { toast.error(`Render failed (${res.status})`); console.error(await res.text()); return; }
      const json = await res.json();
      const parts = json?.candidates?.[0]?.content?.parts ?? [];
      const imgPart = parts.find((p: { inline_data?: { data?: string }; inlineData?: { data?: string } }) => p.inline_data?.data || p.inlineData?.data);
      if (!imgPart) { toast.error("Model returned no image"); console.error("Render response:", json); return; }
      const inline = imgPart.inline_data ?? imgPart.inlineData;
      const m = inline.mime_type ?? inline.mimeType ?? "image/png";
      onParamChange(nodeId, "_resultUrl", `data:${m};base64,${inline.data}`);
      toast.success("Render complete");
    } catch (e) {
      toast.error("Render error");
      console.error(e);
    } finally {
      onParamChange(nodeId, "_busy", false);
    }
  }, [onParamChange]);

  const nodeCb = useMemo<NodeCallbacks>(() => ({ onParamChange, onRunRender }), [onParamChange, onRunRender]);

  // Seed the graph with a Source node the first time the overlay opens.
  useEffect(() => {
    if (props.open && !initialised) {
      setNodes([makeNode("source", { x: 80, y: 200 }, nodeCb)]);
      setInitialised(true);
    }
  }, [props.open, initialised, setNodes, nodeCb]);

  const addToolNode = useCallback((tool: FlowToolType) => {
    setNodes((ns) => {
      const x = 320 + (ns.length % 3) * 240;
      const y = 120 + Math.floor(ns.length / 3) * 180;
      return [...ns, makeNode(tool, { x, y }, nodeCb)];
    });
  }, [setNodes, nodeCb]);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, animated: true }, es)), [setEdges]);

  // ── Export / Import the flow GRAPH (nodes + edges) as JSON. Distinct from "view JSON", which
  //    shows the COMPILED recipe. Injected callbacks (onParamChange/onRunRender) and transient baked
  //    params (the "_"-prefixed keys: _busy/_resultUrl/_pass/_value/vertexCount) are stripped on
  //    export and re-injected/recomputed on import. ──
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const exportFlow = useCallback(() => {
    const payload = {
      version: 1,
      nodes: nodes.map((n) => {
        const d = n.data as FlowNodeData;
        const params: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(d.params)) if (!k.startsWith("_")) params[k] = v;
        return { id: n.id, position: n.position, data: { tool: d.tool, params } };
      }),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flow.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [nodes, edges]);

  // Build live nodes/edges from a parsed flow object and load them into the graph. Throws on a bad
  // shape so callers can surface an error. Shared by file import and AI "Generate JSON".
  const importFlowData = useCallback((parsed: { nodes?: unknown[]; edges?: unknown[] }) => {
    if (!Array.isArray(parsed.nodes)) throw new Error("missing nodes array");
    const importedNodes: Node[] = parsed.nodes.map((raw) => {
      const n = raw as { id?: unknown; position?: { x: number; y: number }; data?: { tool?: FlowToolType; params?: Record<string, unknown> } };
      const tool = (n.data?.tool ?? "inset") as FlowToolType;
      return {
        id: typeof n.id === "string" ? n.id : nextId(tool),
        type: "op",
        position: n.position ?? { x: 0, y: 0 },
        deletable: tool !== "source",
        data: { tool, params: { ...(n.data?.params ?? {}) }, onParamChange: nodeCb.onParamChange, onRunRender: nodeCb.onRunRender } as FlowNodeData,
      };
    });
    const importedEdges: Edge[] = Array.isArray(parsed.edges) ? parsed.edges.map((raw) => {
      const e = raw as { id?: unknown; source?: unknown; target?: unknown; sourceHandle?: unknown; targetHandle?: unknown };
      const sourceHandle = e.sourceHandle != null ? String(e.sourceHandle) : null;
      return {
        id: typeof e.id === "string" ? e.id : `e-${String(e.source)}-${sourceHandle ?? ""}-${String(e.target)}`,
        source: String(e.source),
        target: String(e.target),
        sourceHandle,
        targetHandle: e.targetHandle != null ? String(e.targetHandle) : null,
        animated: true,
      };
    }) : [];
    // Advance the id counter past any imported "<tool>_<n>" ids so new nodes don't collide.
    for (const n of importedNodes) {
      const m = /_(\d+)$/.exec(n.id);
      if (m) nodeSeq = Math.max(nodeSeq, parseInt(m[1], 10) + 1);
    }
    // Guarantee a Source node exists (pipeline input).
    if (!importedNodes.some((n) => (n.data as FlowNodeData).tool === "source")) {
      importedNodes.unshift(makeNode("source", { x: 80, y: 200 }, nodeCb));
    }
    setNodes(importedNodes);
    setEdges(importedEdges);
    setInitialised(true);
    return importedNodes.length;
  }, [nodeCb, setNodes, setEdges]);

  const importFlow = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const n = importFlowData(JSON.parse(String(reader.result)));
        toast.success(`Imported flow — ${n} node${n === 1 ? "" : "s"}`);
      } catch (err) {
        toast.error("Invalid flow JSON");
        console.error("Flow import failed:", err);
      }
    };
    reader.readAsText(file);
  }, [importFlowData]);

  // ── AI "Generate JSON": describe a flow in plain language → Gemini emits flow JSON → import it. ──
  const [genOpen, setGenOpen] = useState(false);
  const [genApiKey, setGenApiKey] = useState<string>(() => {
    try { return localStorage.getItem("flow-gen-api-key") ?? ""; } catch { return ""; }
  });
  const [genModel, setGenModel] = useState<string>(() => {
    try { return localStorage.getItem("flow-gen-model") || "gemini-3-flash-preview"; } catch { return "gemini-3-flash-preview"; }
  });
  const [genPrompt, setGenPrompt] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const generateFlow = useCallback(async () => {
    const apiKey = genApiKey.trim();
    if (!apiKey) { toast.error("Add a Google AI Studio API key"); return; }
    if (!genPrompt.trim()) { toast.error("Describe the flow to generate"); return; }
    const model = genModel.trim() || "gemini-3-flash-preview";
    setGenBusy(true);
    try {
      try { localStorage.setItem("flow-gen-api-key", apiKey); } catch { /* ignore */ }
      try { localStorage.setItem("flow-gen-model", model); } catch { /* ignore */ }
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: FLOW_GEN_INSTRUCTION }] },
          contents: [{ parts: [{ text: genPrompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4 },
        }),
      });
      if (!res.ok) { toast.error(`Generation failed (${res.status})`); console.error(await res.text()); return; }
      const json = await res.json();
      const text: string = (json?.candidates?.[0]?.content?.parts ?? [])
        .map((p: { text?: string }) => p.text ?? "")
        .join("");
      // responseMimeType:"application/json" should yield pure JSON; fall back to extracting the first {…}.
      let parsed: { nodes?: unknown[]; edges?: unknown[] } | null = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        const a = text.indexOf("{"), b = text.lastIndexOf("}");
        if (a >= 0 && b > a) { try { parsed = JSON.parse(text.slice(a, b + 1)); } catch { /* ignore */ } }
      }
      if (!parsed) { toast.error("Model returned invalid JSON"); console.error("Gen response:", text); return; }
      const count = importFlowData(parsed);
      setGenOpen(false);
      toast.success(`Generated flow — ${count} node${count === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error("Generation error");
      console.error(e);
    } finally {
      setGenBusy(false);
    }
  }, [genApiKey, genModel, genPrompt, importFlowData]);

  // When a Split node's piece count shrinks, drop edges that referenced a now-gone output handle
  // (e.g. an edge from "out-4" after Pieces dropped to 3) so they don't dangle.
  useEffect(() => {
    setEdges((es) => {
      const next = es.filter((e) => {
        if (!e.sourceHandle || !e.sourceHandle.startsWith("out-")) return true;
        const src = nodes.find((n) => n.id === e.source);
        if (!src) return true;
        const def = FLOW_TOOLS[(src.data as FlowNodeData).tool];
        const n = def.outputCount ? def.outputCount((src.data as FlowNodeData).params) : def.hasOutput ? 1 : 0;
        const idx = parseInt(e.sourceHandle.slice(4), 10);
        return Number.isFinite(idx) && idx < n;
      });
      return next.length === es.length ? es : next;
    });
  }, [nodes, setEdges]);

  // Delete the currently-selected connection(s) and/or node(s). The Source node is protected
  // (deletable: false). Dangling edges of removed nodes are dropped too.
  const hasSelection = nodes.some((n) => n.selected) || edges.some((e) => e.selected);
  const deleteSelected = useCallback(() => {
    const removed = new Set(nodes.filter((n) => n.selected && n.deletable !== false).map((n) => n.id));
    setEdges((es) => es.filter((e) => !e.selected && !removed.has(e.source) && !removed.has(e.target)));
    if (removed.size) setNodes((ns) => ns.filter((n) => !removed.has(n.id)));
  }, [nodes, setNodes, setEdges]);

  // Commit compilation (Run Flow) — uses `on` so each step targets the previous step's
  // committed output rooms. Also drives the status line + JSON view.
  const compiled = useMemo(() => compileFlow(nodes, edges, "commit"), [nodes, edges]);

  // Live PURE preview: evaluate the DAG as pure function composition (no engine, no refs) and
  // hand the resulting per-node output polygons up for canvas overlay rendering. Deterministic
  // and order-independent — this is the sequential pipeline the user expects.
  const { open, selectedRoomLabel } = props;
  const sourceKey = props.sourcePolygon.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(";");
  const ppm = props.pixelsPerMeter;
  const preview = useMemo(
    () => evaluateFlow(nodes, edges, props.sourcePolygon, ppm),
    // sourceKey captures sourcePolygon changes without depending on its array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodes, edges, sourceKey, ppm],
  );
  // Voronoi seeds = the input polygon's vertices, so each Voronoi node emits one cell (and one
  // output handle) per vertex of whatever polygon feeds it. The vertex count isn't knowable from
  // params alone, so bake each Voronoi node's live cell count into `vertexCount` — read by
  // outputCount (handle rendering) and by the compiler (produces list). No feedback loop:
  // evalVoronoi ignores params, so baking can't change the preview's cell count.
  useEffect(() => {
    const cellCountByNode = new Map(
      preview.filter((it) => it.tool === "voronoi").map((it) => [it.nodeId, it.cellCount ?? it.polygons.length]),
    );
    // Conditional nodes: surface the live result on the node (read-only badge fields). Safe like
    // vertexCount — evalConditional reads only metric/op/value, never these baked fields.
    const condByNode = new Map(
      preview.filter((it) => it.tool === "conditional" && it.condition).map((it) => [it.nodeId, it.condition!]),
    );
    // Scalar value outputs (e.g. Inset area) → bake under params._values for the node's readout.
    const valuesByNode = new Map(
      preview.filter((it) => it.values).map((it) => [it.nodeId, it.values!]),
    );
    // Resolved value INPUT overrides (e.g. Massing floors from a wired value) → bake under _vin so the
    // compiler/commit uses the same number as the live preview.
    const vinByNode = new Map(
      preview.filter((it) => it.valueInputs).map((it) => [it.nodeId, it.valueInputs!]),
    );
    // Optimise Rectangle auto-tilt → bake the chosen angle into axisAngle (slider + commit follow it).
    const tiltByNode = new Map(
      preview.filter((it) => typeof it.optimisedTilt === "number").map((it) => [it.nodeId, it.optimisedTilt!]),
    );
    setNodes((ns) => {
      let changed = false;
      const next = ns.map((n) => {
        const data = n.data as FlowNodeData;
        if (data.tool === "voronoi") {
          const vc = cellCountByNode.get(n.id);
          if (vc == null || data.params.vertexCount === vc) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, vertexCount: vc } } };
        }
        if (data.tool === "conditional") {
          const c = condByNode.get(n.id);
          if (!c || (data.params._pass === c.pass && data.params._value === c.value)) return n;
          changed = true;
          return { ...n, data: { ...n.data, params: { ...data.params, _pass: c.pass, _value: c.value } } };
        }
        if (FLOW_TOOLS[data.tool].valueOutputs?.length) {
          const v = valuesByNode.get(n.id);
          if (v && JSON.stringify(data.params._values) !== JSON.stringify(v)) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, _values: v } } };
          }
        }
        if (FLOW_TOOLS[data.tool].valueInputs?.length) {
          // Write each wired value into its actual param so the field/slider reflects the driven value.
          const vin = vinByNode.get(n.id);
          if (vin) {
            let diff = false;
            const merged: Record<string, unknown> = { ...data.params };
            for (const [k, val] of Object.entries(vin)) { if (merged[k] !== val) { merged[k] = val; diff = true; } }
            if (diff) { changed = true; return { ...n, data: { ...n.data, params: merged } }; }
          }
        }
        if (data.tool === "optimise-rect") {
          const tilt = tiltByNode.get(n.id);
          if (typeof tilt === "number" && data.params.axisAngle !== tilt) {
            changed = true;
            return { ...n, data: { ...n.data, params: { ...data.params, axisAngle: tilt } } };
          }
        }
        return n;
      });
      return changed ? next : ns;
    });
  }, [preview, setNodes]);

  const onPreviewRef = useRef(props.onPreview);
  onPreviewRef.current = props.onPreview;
  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => onPreviewRef.current(preview), 80);
    return () => window.clearTimeout(handle);
  }, [open, preview]);

  const run = (mode: "commit") => {
    if (compiled.error || mode !== "commit") return;
    props.onRunCommit(compiled.json);
  };

  if (!props.open) return null;

  return (
    <div className="flex h-full w-full flex-col bg-slate-50">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white/90 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-700">Flow — Operations Pipeline</span>
          <span className="text-[11px] text-slate-400">
            Input: {props.selectedRoomLabel ? <b className="text-slate-600">{props.selectedRoomLabel}</b> : "no space selected"}
          </span>
        </div>
        <div className="relative flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFlow(f); e.target.value = ""; }}
          />
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => fileInputRef.current?.click()} title="Import a flow (.json)">
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={exportFlow} title="Export this flow as .json">
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => setGenOpen((v) => !v)} title="Generate a flow with AI">
            <Sparkles className="h-3.5 w-3.5" /> Generate JSON
          </Button>
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={props.onClose}>
            <X className="h-3.5 w-3.5" /> Close
          </Button>

          {/* AI flow-generation dropdown */}
          {genOpen && (
            <div className="absolute right-0 top-9 z-50 w-80 space-y-2 rounded-md border border-slate-200 bg-white p-2.5 shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-700">Generate flow with AI</span>
                <button type="button" className="text-slate-400 hover:text-slate-600" onClick={() => setGenOpen(false)}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">Model</span>
                <input
                  type="text"
                  className="h-7 w-full rounded border border-slate-200 px-1.5 text-[11px]"
                  value={genModel}
                  onChange={(e) => setGenModel(e.target.value)}
                  placeholder="gemini-3-flash-preview"
                />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">API key</span>
                <input
                  type="password"
                  className="h-7 w-full rounded border border-slate-200 px-1.5 text-[11px]"
                  value={genApiKey}
                  onChange={(e) => setGenApiKey(e.target.value)}
                  placeholder="Google AI Studio key"
                />
              </div>
              <div className="space-y-0.5">
                <span className="text-[10px] text-slate-500">Prompt</span>
                <textarea
                  className="w-full resize-y rounded border border-slate-200 px-1.5 py-1 text-[11px]"
                  rows={3}
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder="e.g. Inset 1 m, fit a rectangle, then massing 5 floors upward and render it"
                />
              </div>
              <Button size="sm" className="h-7 w-full gap-1.5 text-[11px]" disabled={genBusy} onClick={generateFlow}>
                {genBusy
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Generating…</>
                  : <><Sparkles className="h-3 w-3" /> Generate &amp; Import</>}
              </Button>
              <span className="block text-[9px] leading-tight text-slate-400">
                Replaces the current graph with the generated nodes &amp; connections.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Body — vertical palette (left) + canvas (right) */}
      <div className="flex min-h-0 flex-1">
        {/* Palette — vertical left rail */}
        <div className="flex w-44 flex-col gap-1 overflow-y-auto border-r border-slate-200 bg-white/70 px-2 py-2">
          <span className="px-1 pb-0.5 text-[10px] uppercase tracking-wide text-slate-400">Add</span>
          {(["inset", "optimise-rect", "split", "skeleton", "place-object", "bsp", "voronoi", "conditional", "bounding-shape", "convex-hull", "convex-decomp", "smoothing", "contour", "floor-massing", "render", "bua", "math"] as FlowToolType[]).map((t) => (
            <Button
              key={t}
              variant="outline"
              size="sm"
              className="h-7 w-full justify-start gap-1.5 px-2 text-[11px]"
              onClick={() => addToolNode(t)}
            >
              <Plus className="h-3 w-3 shrink-0" /> {FLOW_TOOLS[t].label}
            </Button>
          ))}
          <div className="mt-auto border-t border-slate-200 pt-2">
            <span className="mb-1 block px-1 text-[10px] leading-tight text-slate-400">Select a node/connection, then</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 w-full justify-start gap-1.5 px-2 text-[11px] text-red-600 hover:bg-red-50 disabled:text-slate-300"
              disabled={!hasSelection}
              onClick={deleteSelected}
              title="Delete selected connection or node (or press Delete)"
            >
              <Trash2 className="h-3 w-3 shrink-0" /> Delete
            </Button>
          </div>
        </div>

        {/* Canvas */}
        <div className="relative flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            deleteKeyCode={["Delete", "Backspace"]}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>
      </div>

      {/* Footer — compile status + run */}
      <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-white/90 px-3 py-2">
        <div className="min-w-0 flex-1 text-[11px]">
          {compiled.error ? (
            <span className="text-red-600">{compiled.error}</span>
          ) : (
            <span className="text-slate-500">
              {compiled.opCount} operation{compiled.opCount === 1 ? "" : "s"} · previewing live on canvas ·{" "}
              <button type="button" className="underline hover:text-slate-700" onClick={() => setJsonOpen((v) => !v)}>
                {jsonOpen ? "hide" : "view"} JSON
              </button>
            </span>
          )}
        </div>
        <Button
          size="sm"
          className="h-8 gap-1.5 px-3 text-[12px]"
          disabled={!!compiled.error || !props.selectedRoomLabel}
          onClick={() => run("commit")}
        >
          <Play className="h-3.5 w-3.5" /> Run Flow
        </Button>
      </div>

      {jsonOpen && !compiled.error && (
        <pre className="max-h-48 overflow-auto whitespace-pre border-t border-slate-200 bg-slate-900 px-3 py-2 font-mono text-[10px] leading-tight text-slate-100">
          {compiled.json}
        </pre>
      )}
    </div>
  );
};
