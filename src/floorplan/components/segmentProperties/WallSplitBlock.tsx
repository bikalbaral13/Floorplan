import { Button } from "@/components/ui/button";
import type { Unit, Wall } from "../../types";

export type WallSplitType = "percent" | "length";

const metresToUnit = (meters: number, unit: Unit): number => {
  if (unit === "m") return meters;
  if (unit === "cm") return meters * 100;
  return meters * 3.28084;
};

export interface WallSplitBlockProps {
  selectedWall: Wall;
  unit: Unit;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  count: number;
  setCount: (v: number) => void;
  type: WallSplitType;
  setType: (v: WallSplitType) => void;
  percents: number[];
  setPercents: (updater: (prev: number[]) => number[]) => void;
  lengths: number[];
  setLengths: (updater: (prev: number[]) => number[]) => void;
  onApplySplit: () => void;
}

/** Split the selected wall into N parts by percentage or by absolute length. The
 *  last part is auto-computed from the remainder so the parts always sum to the
 *  total. Validation surfaces inline when the user enters an impossible split. */
export const WallSplitBlock = (p: WallSplitBlockProps) => (
  <div className="mt-2 rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Splitting</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && (() => {
      const totalPx = Math.hypot(
        p.selectedWall.end.x - p.selectedWall.start.x,
        p.selectedWall.end.y - p.selectedWall.start.y,
      );
      const totalUnit = metresToUnit(totalPx / p.pixelsPerMeter, p.unit);
      const N = Math.max(2, Math.min(20, Math.round(p.count)));
      const percents = p.percents.slice(0, N - 1);
      const lengths = p.lengths.slice(0, N - 1);
      const sumPct = percents.reduce((s, v) => s + v, 0);
      const sumLen = lengths.reduce((s, v) => s + v, 0);
      const lastPct = Math.max(0, 100 - sumPct);
      const lastLen = Math.max(0, totalUnit - sumLen);
      return (
        <>
          <div>
            <span className="text-[10px] text-slate-400">Number of parts (n)</span>
            <input
              type="number"
              min={2}
              max={20}
              step={1}
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
              value={p.count}
              onChange={(e) => p.setCount(Math.max(2, Math.min(20, Math.round(+e.target.value || 2))))}
            />
          </div>
          <div>
            <span className="text-[10px] text-slate-400">Type</span>
            <div className="mt-0.5 flex flex-wrap gap-1.5">
              <Button size="sm" variant={p.type === "percent" ? "default" : "outline"} onClick={() => p.setType("percent")}>
                Based on Percent
              </Button>
              <Button size="sm" variant={p.type === "length" ? "default" : "outline"} onClick={() => p.setType("length")}>
                Based on Length
              </Button>
            </div>
          </div>
          {p.type === "percent" ? (
            <div>
              <span className="text-[10px] text-slate-400">Percentages for first {N - 1} parts (%)</span>
              <div className="mt-0.5 space-y-1">
                {percents.map((pct, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 text-[10px] text-slate-500">Part {i + 1}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      className="h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      value={pct}
                      onChange={(e) => {
                        const v = +e.target.value;
                        p.setPercents((arr) => arr.map((x, idx) => idx === i ? v : x));
                      }}
                    />
                    <span className="text-[9px] text-slate-400">%</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[10px] text-slate-500">Part {N}</span>
                  <input
                    type="text"
                    readOnly
                    className="h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
                    value={lastPct.toFixed(2)}
                  />
                  <span className="text-[9px] text-slate-400">% (auto)</span>
                </div>
              </div>
              {sumPct >= 100 && <p className="text-[9px] text-red-600">Sum of percentages must be &lt; 100</p>}
            </div>
          ) : (
            <div>
              <span className="text-[10px] text-slate-400">Lengths for first {N - 1} parts ({p.unit}) — total {totalUnit.toFixed(3)} {p.unit}</span>
              <div className="mt-0.5 space-y-1">
                {lengths.map((L, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-10 text-[10px] text-slate-500">Part {i + 1}</span>
                    <input
                      type="number"
                      min={0}
                      step={p.unit === "cm" ? 1 : 0.01}
                      className="h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
                      value={L}
                      onChange={(e) => {
                        const v = +e.target.value;
                        p.setLengths((arr) => arr.map((x, idx) => idx === i ? v : x));
                      }}
                    />
                    <span className="text-[9px] text-slate-400">{p.unit}</span>
                  </div>
                ))}
                <div className="flex items-center gap-2">
                  <span className="w-10 text-[10px] text-slate-500">Part {N}</span>
                  <input
                    type="text"
                    readOnly
                    className="h-6 w-full rounded-md border border-slate-200 bg-slate-50 px-1.5 text-xs font-mono text-slate-700"
                    value={lastLen.toFixed(3)}
                  />
                  <span className="text-[9px] text-slate-400">{p.unit} (auto)</span>
                </div>
              </div>
              {sumLen >= totalUnit - 1e-6 && (
                <p className="text-[9px] text-red-600">Sum of lengths must be &lt; total ({totalUnit.toFixed(3)} {p.unit})</p>
              )}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            onClick={p.onApplySplit}
          >
            Apply Split
          </Button>
        </>
      );
    })()}
  </div>
);
