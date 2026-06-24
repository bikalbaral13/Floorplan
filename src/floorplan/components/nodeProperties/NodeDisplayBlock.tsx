import { Button } from "@/components/ui/button";
import type { NodeMeta } from "../../types";

export interface NodeDisplayBlockProps {
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** The selected node's metadata (display fields). */
  meta: NodeMeta;
  /** Patch the node's display fields. */
  onChange: (patch: Partial<NodeMeta>) => void;
}

/** Canvas-native equivalent of the flow "Display Node" node — node-marker shape / style / colour / size /
 *  hatch, shown in the Node Properties tab. Writes to `nodeMeta` (the marker render already reads these). */
export const NodeDisplayBlock = (p: NodeDisplayBlockProps) => {
  const m = p.meta;
  const shape = m.dispShape ?? "dot";
  const style = m.dispStyle ?? "solid";
  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
      <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => p.setExpanded((v) => !v)}>
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Display</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          {/* Shape */}
          <div>
            <span className="text-[10px] text-slate-400">Shape</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {(["dot", "circle", "square", "triangle"] as const).map((s) => (
                <Button key={s} size="sm" className="capitalize" variant={shape === s ? "default" : "outline"} onClick={() => p.onChange({ dispShape: s })}>{s}</Button>
              ))}
            </div>
          </div>
          {/* Style */}
          <div>
            <span className="text-[10px] text-slate-400">Style</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              {(["solid", "dashed", "dotted"] as const).map((s) => (
                <Button key={s} size="sm" className="capitalize" variant={style === s ? "default" : "outline"} onClick={() => p.onChange({ dispStyle: s })}>{s}</Button>
              ))}
            </div>
          </div>
          {/* Colour */}
          <label className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-600">Colour</span>
            <input type="color" className="h-7 w-10 cursor-pointer rounded border border-slate-200" value={m.dispColor ?? "#475569"} onChange={(e) => p.onChange({ dispColor: e.target.value })} />
          </label>
          {/* Size */}
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-slate-600">Size</span>
              <span className="font-mono text-[10px] text-slate-500">{(m.dispSize ?? 1).toFixed(1)}×</span>
            </div>
            <input type="range" className="w-full" min={0.5} max={5} step={0.5} value={m.dispSize ?? 1} onChange={(e) => p.onChange({ dispSize: +e.target.value })} />
          </div>
          {/* Hatch */}
          <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
            <input type="checkbox" className="h-4 w-4" checked={!!m.hatch} onChange={(e) => p.onChange({ hatch: e.target.checked })} />
            Use Hatch
          </label>
          {m.hatch && (
            <div className="space-y-1.5 rounded border border-slate-100 bg-slate-50 p-1.5">
              <div>
                <span className="text-[10px] text-slate-400">Hatch Style</span>
                <div className="mt-0.5 flex flex-wrap gap-1.5">
                  <Button size="sm" variant={(m.hatchStyle ?? "diagonal") === "diagonal" ? "default" : "outline"} onClick={() => p.onChange({ hatchStyle: "diagonal" })}>Diagonal</Button>
                  <Button size="sm" variant={m.hatchStyle === "dots" ? "default" : "outline"} onClick={() => p.onChange({ hatchStyle: "dots" })}>Random Dots</Button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-2">
                <div>
                  <span className="text-[10px] text-slate-400">Spacing (px)</span>
                  <input type="number" min={2} step={1} className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono" value={m.hatchSpacing ?? 8} onChange={(e) => { const v = parseFloat(e.target.value); p.onChange({ hatchSpacing: isFinite(v) && v > 0 ? v : undefined }); }} />
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Weight</span>
                  <input type="number" min={0.5} step={0.5} className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono" value={m.hatchWeight ?? 1} onChange={(e) => { const v = parseFloat(e.target.value); p.onChange({ hatchWeight: isFinite(v) && v > 0 ? v : undefined }); }} />
                </div>
              </div>
              {(m.hatchStyle ?? "diagonal") === "diagonal" && (
                <div>
                  <span className="text-[10px] text-slate-400">Angle (°)</span>
                  <input type="number" step={5} className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono" value={m.hatchAngle ?? 45} onChange={(e) => { const v = parseFloat(e.target.value); p.onChange({ hatchAngle: isFinite(v) ? v : undefined }); }} />
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
