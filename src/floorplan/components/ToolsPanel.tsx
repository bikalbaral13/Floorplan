import { type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Room } from "../types";
import type { RegionSemantics } from "../algorithms/semantics/regionSemantics";

export type CommandSuggestion = { label: string; example: string };
export type SemanticState = "off" | "loading" | "ready" | "error";

interface ToolsPanelProps {
  // Panel toggles
  panelExpanded: boolean;
  onPanelExpandedChange: Dispatch<SetStateAction<boolean>>;
  areaSemanticsExpanded: boolean;
  onAreaSemanticsExpandedChange: Dispatch<SetStateAction<boolean>>;
  jsonExpanded: boolean;
  onJsonExpandedChange: Dispatch<SetStateAction<boolean>>;
  aiChatExpanded: boolean;
  onAiChatExpandedChange: Dispatch<SetStateAction<boolean>>;
  commandsExpanded: boolean;
  onCommandsExpandedChange: Dispatch<SetStateAction<boolean>>;

  // Compute Semantics
  visibleRooms: Room[];
  regionSemanticsById: Record<string, RegionSemantics>;
  onComputeSemantics: () => void;

  // Clean Walls
  onCleanWalls: () => void;

  // AI Chat
  aiPrompt: string;
  onAiPromptChange: (value: string) => void;
  aiApiKey: string;
  onAiApiKeyChange: (value: string) => void;
  aiModel: string;
  onAiModelChange: (value: string) => void;
  aiBusy: boolean;
  onAiGenerate: () => void;

  // JSON
  jsonText: string;
  onJsonTextChange: (value: string) => void;
  jsonDragOver: boolean;
  onJsonDragOverChange: (value: boolean) => void;
  onApplyJsonPreview: () => void;
  onApplyJsonCommit: () => void;

  // Commands
  commandsInput: string;
  onCommandsInputChange: (value: string) => void;
  commandsFocused: boolean;
  onCommandsFocusedChange: (value: boolean) => void;
  commandSuggestions: CommandSuggestion[];
  commandCatalogue: CommandSuggestion[];
  semanticState: SemanticState;
  onLoadSemanticLayer: () => void;
  onCommandsPreview: () => void;
  onCommandsRun: () => void;
}

export const ToolsPanel = ({
  panelExpanded,
  onPanelExpandedChange,
  areaSemanticsExpanded,
  onAreaSemanticsExpandedChange,
  jsonExpanded,
  onJsonExpandedChange,
  aiChatExpanded,
  onAiChatExpandedChange,
  commandsExpanded,
  onCommandsExpandedChange,
  visibleRooms,
  regionSemanticsById,
  onComputeSemantics,
  onCleanWalls,
  aiPrompt,
  onAiPromptChange,
  aiApiKey,
  onAiApiKeyChange,
  aiModel,
  onAiModelChange,
  aiBusy,
  onAiGenerate,
  jsonText,
  onJsonTextChange,
  jsonDragOver,
  onJsonDragOverChange,
  onApplyJsonPreview,
  onApplyJsonCommit,
  commandsInput,
  onCommandsInputChange,
  commandsFocused,
  onCommandsFocusedChange,
  commandSuggestions,
  commandCatalogue,
  semanticState,
  onLoadSemanticLayer,
  onCommandsPreview,
  onCommandsRun,
}: ToolsPanelProps) => (
  <div className="shrink-0 border-t border-slate-200 bg-slate-50" style={panelExpanded ? { maxHeight: "45%" } : undefined}>
    <button
      type="button"
      className="flex w-full items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-left"
      onClick={() => onPanelExpandedChange((v) => !v)}
    >
      <span className="text-sm font-semibold">Tools</span>
      <span className="text-[11px] text-slate-400">{panelExpanded ? "▼" : "▶"}</span>
    </button>
    {panelExpanded && (
      <ScrollArea className="h-full max-h-[45vh]">
        <div className="space-y-2 p-3">

          {/* Compute Semantics */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onAreaSemanticsExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Compute Semantics</span>
              <span className="text-[11px] text-slate-400">{areaSemanticsExpanded ? "▼" : "▶"}</span>
            </button>
            {areaSemanticsExpanded && <>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                onClick={onComputeSemantics}
              >
                Compute Semantics for all rooms
              </Button>
              {Object.keys(regionSemanticsById).length === 0 ? (
                <p className="text-[9px] text-slate-400">Click to derive facades, proximity flags, area, depth and aspect ratio for every room. Results are cached and used by Rule Book and other tools.</p>
              ) : (
                <div className="max-h-40 overflow-y-auto rounded border border-slate-100 bg-slate-50 p-1 text-[9px] leading-[1.4] text-slate-700 font-mono">
                  {visibleRooms.filter((r) => regionSemanticsById[r.id]).map((r) => {
                    const s = regionSemanticsById[r.id];
                    const displayId = `Room${String(visibleRooms.indexOf(r) + 1).padStart(3, "0")}`;
                    return (
                      <div key={r.id} className="flex justify-between gap-2">
                        <span className="text-slate-400">{displayId}</span>
                        <span>f={s.facadeCount} a={s.areaM2.toFixed(1)}m² d={s.depthM.toFixed(1)}m{s.nearCore ? " core" : ""}{s.isCorner ? " cnr" : s.isInterior ? " int" : ""}</span>
                      </div>
                    );
                  })}
                  <div className="mt-1 border-t border-slate-200 pt-1 text-slate-400">
                    {Object.keys(regionSemanticsById).length} / {visibleRooms.length} rooms cached
                  </div>
                </div>
              )}
              <p className="text-[9px] text-slate-400">Thresholds: facade 0.5 m, Core 1.5 m, Stair 2 m, Corridor 0.5 m, Entry 3 m.</p>
            </>}
          </div>

          {/* Clean Walls */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-[11px]"
              onClick={onCleanWalls}
              title="Split walls at T-junctions and remove duplicate / overlapping wall segments. Plot-boundary walls are preserved."
            >
              Clean Walls
            </Button>
            <p className="text-[9px] text-slate-400">Splits walls at any T-junction (where another wall's endpoint lands on its interior) and removes duplicate segments. Run after creating rooms via JSON / AI to clean up shared edges.</p>
          </div>

          {/* Apply JSON */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onJsonExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Apply JSON</span>
              <span className="text-[11px] text-slate-400">{jsonExpanded ? "▼" : "▶"}</span>
            </button>
            {jsonExpanded && <>
              {/* AI Assist */}
              <div className="rounded border border-slate-200 bg-slate-50 p-2 space-y-2">
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left"
                  onClick={() => onAiChatExpandedChange((v) => !v)}
                >
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Generate with AI</span>
                  <span className="text-[11px] text-slate-400">{aiChatExpanded ? "▼" : "▶"}</span>
                </button>
                {aiChatExpanded && <>
                  <div>
                    <span className="text-[10px] text-slate-500">Prompt</span>
                    <textarea
                      className="mt-0.5 h-20 w-full resize-y rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px]"
                      placeholder="e.g. For Core rooms split 40:60, for Service rooms draw a skeleton."
                      value={aiPrompt}
                      onChange={(e) => onAiPromptChange(e.target.value)}
                      spellCheck={false}
                    />
                  </div>
                  <details className="text-[10px]">
                    <summary className="cursor-pointer text-slate-500">API settings</summary>
                    <div className="mt-1 space-y-1">
                      <div>
                        <span className="text-[10px] text-slate-500">Gemini API key</span>
                        <input
                          type="password"
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-mono"
                          placeholder="AIza..."
                          value={aiApiKey}
                          onChange={(e) => onAiApiKeyChange(e.target.value)}
                          autoComplete="off"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500">Model</span>
                        <input
                          type="text"
                          className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-mono"
                          value={aiModel}
                          onChange={(e) => onAiModelChange(e.target.value)}
                          placeholder="gemini-3-flash-preview"
                        />
                      </div>
                    </div>
                  </details>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-[11px]"
                    disabled={aiBusy || !aiPrompt.trim() || !aiApiKey.trim()}
                    onClick={onAiGenerate}
                    title="Generate JSON into the textarea below. Review, then press Apply JSON."
                  >
                    {aiBusy ? "Generating…" : "Generate → fill JSON below"}
                  </Button>
                </>}
              </div>

              <div
                className={`rounded border-2 border-dashed p-2 text-center text-[10px] transition-colors ${jsonDragOver ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-slate-50"}`}
                onDragOver={(e) => { e.preventDefault(); onJsonDragOverChange(true); }}
                onDragLeave={() => onJsonDragOverChange(false)}
                onDrop={async (e) => {
                  e.preventDefault();
                  onJsonDragOverChange(false);
                  const file = e.dataTransfer.files?.[0];
                  if (!file) return;
                  try {
                    const text = await file.text();
                    onJsonTextChange(text);
                    toast.success(`Loaded ${file.name}`);
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    toast.error(`Read failed: ${msg}`);
                  }
                }}
              >
                <span className="text-slate-500">Drop a .json file here, or </span>
                <label className="cursor-pointer text-sky-600 underline">
                  browse
                  <input
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const text = await file.text();
                        onJsonTextChange(text);
                        toast.success(`Loaded ${file.name}`);
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        toast.error(`Read failed: ${msg}`);
                      }
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Recipe JSON</span>
                  {jsonText && (
                    <button
                      type="button"
                      className="text-[9px] text-red-500 hover:underline"
                      onClick={() => onJsonTextChange("")}
                    >
                      clear
                    </button>
                  )}
                </div>
                <textarea
                  className="mt-0.5 h-32 w-full resize-y rounded-md border border-slate-200 bg-white px-1.5 py-1 font-mono text-[10px]"
                  placeholder={`{\n  "rooms": [\n    {\n      "match": { "region": "Core" },\n      "operations": [\n        { "tool": "split", "params": { "count": 2, "mode": "ratio", "ratios": [40, 60] }, "commit": true }\n      ]\n    },\n    {\n      "match": { "region": "Service" },\n      "operations": [\n        { "tool": "skeleton", "params": { "type": "straight-skeleton" } }\n      ]\n    }\n  ]\n}`}
                  value={jsonText}
                  onChange={(e) => onJsonTextChange(e.target.value)}
                  spellCheck={false}
                />
                <span className="text-[9px] text-slate-400">
                  Multi-room: "rooms[].match" selects rooms by region, label, zone, id, roomType, or area. Each op can set "commit": true (permanent) or false (live preview); omit to use the recipe-wide mode. Legacy "operations[]" (no "rooms") targets the selected room.{" "}
                  Tools: inset, regime-inset, split, optimise-rect, place-object, voronoi, cvt, bsp, delaunay, skeleton, convex-hull, rect-decomp, smoothing, mesh, convex-decomp.
                </span>
              </div>

              <Button
                variant="outline"
                size="sm"
                className="w-full text-[11px]"
                disabled={!jsonText.trim()}
                onClick={onApplyJsonCommit}
                title="Apply the recipe. Set per-op commit:false in the JSON for live preview."
              >
                Apply JSON
              </Button>
            </>}
          </div>

          {/* Commands */}
          <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => onCommandsExpandedChange((v) => !v)}
            >
              <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Commands</span>
              <span className="text-[11px] text-slate-400">{commandsExpanded ? "▼" : "▶"}</span>
            </button>
            {commandsExpanded && <>
              <div className="relative">
                <input
                  type="text"
                  className="h-7 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
                  placeholder="e.g. inset by 0.3 m then split 60:40 and round corners 30%"
                  value={commandsInput}
                  onChange={(e) => onCommandsInputChange(e.target.value)}
                  onFocus={() => onCommandsFocusedChange(true)}
                  onBlur={() => setTimeout(() => onCommandsFocusedChange(false), 150)}
                  spellCheck={false}
                />
                {commandsFocused && commandSuggestions.length > 0 && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-0.5 max-h-56 overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
                    {commandSuggestions.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        className="block w-full px-2 py-1 text-left text-[10px] hover:bg-slate-50"
                        onMouseDown={(e) => { e.preventDefault(); onCommandsInputChange(c.example); }}
                      >
                        <div className="font-medium text-slate-700">{c.label}</div>
                        <div className="font-mono text-[9px] text-slate-400">{c.example}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <span className="text-[9px] text-slate-400">
                Chain commands with &quot;then&quot;, &quot;and&quot;, &quot;;&quot; or newlines. Click a suggestion to fill.
              </span>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Semantic fallback</span>
                <Button
                  variant={semanticState === "ready" ? "default" : "outline"}
                  size="sm"
                  className="h-6 text-[10px]"
                  disabled={semanticState === "loading"}
                  onClick={onLoadSemanticLayer}
                  title="Load an on-device embedding model (~25 MB) to match unusual phrasings by meaning"
                >
                  {semanticState === "off" && "Enable"}
                  {semanticState === "loading" && "Loading model…"}
                  {semanticState === "ready" && "Ready ✓"}
                  {semanticState === "error" && "Retry"}
                </Button>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[11px]"
                  disabled={!commandsInput.trim()}
                  onClick={onCommandsPreview}
                  title="Match commands and preview them (non-destructive)"
                >
                  Interact
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 text-[11px]"
                  disabled={!commandsInput.trim()}
                  onClick={onCommandsRun}
                >
                  Run
                </Button>
              </div>

              <details className="text-[10px]">
                <summary className="cursor-pointer text-slate-500">Command vocabulary ({commandCatalogue.length})</summary>
                <ul className="mt-1 space-y-0.5 pl-3">
                  {commandCatalogue.map((c, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span className="font-mono text-[9px] text-slate-600 truncate">{c.example}</span>
                      <button
                        type="button"
                        className="text-[9px] text-sky-600 hover:underline"
                        onClick={() => onCommandsInputChange(c.example)}
                      >
                        use
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            </>}
          </div>

        </div>
      </ScrollArea>
    )}
  </div>
);
