import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

export type InsetMode = "equal" | "variable" | "front-remaining";

export interface InsetPolygonBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;
  setAll: number;
  setSetAll: (v: number) => void;
  setbacks: number[];
  setSetbacks: (updater: (prev: number[]) => number[]) => void;
  bumpLivePreviewTick: () => void;
  runRoomInset: (room: { id: string; points: Point[] }, silent: boolean) => boolean;
  /** Clear preview walls + the shared preview polygon entry for this room. */
  onLiveOff: () => void;
  /** Display unit ("m" | "cm" | "ft" | ...) — controls slider scale and labels. Defaults to "m". */
  unit?: string;
  /** Index of the room edge whose corresponding Site Boundary wall has edgeRole === "front".
   *  null means no front edge is tagged; the Front And Remaining mode falls back to edge 0. */
  frontEdgeIndex?: number | null;
  /** Canvas-to-world scale — required to convert the pixel-space room polygon + metres-space
   *  setbacks into a real area readout. */
  pixelsPerMeter: number;
  // --- Deduct Area state (lifted to parent so the canvas overlay can render it). ---
  deductEnabled: boolean;
  setDeductEnabled: (v: boolean) => void;
  deductMode: "area" | "percent";
  setDeductMode: (v: "area" | "percent") => void;
  deductAreaM2: number;
  setDeductAreaM2: (v: number) => void;
  deductPercent: number;
  setDeductPercent: (v: number) => void;
  deductAngle: number;
  setDeductAngle: (v: number) => void;
  // --- Mode + Front/Remaining values (lifted so external tools — e.g. the
  // BUA Calculator's "Show on Canvas" — can drive them directly). ---
  mode?: InsetMode;
  setMode?: (v: InsetMode) => void;
  frontVal?: number;
  setFrontVal?: (v: number) => void;
  remainingVal?: number;
  setRemainingVal?: (v: number) => void;
}

export const InsetPolygonBlock = (p: InsetPolygonBlockProps) => {
  const u = p.unit ?? "m";
  const mToU = (m: number): number => (u === "m" ? m : u === "cm" ? m * 100 : m * 3.28084);
  const uToM = (v: number): number => (u === "m" ? v : u === "cm" ? v / 100 : v / 3.28084);
  const maxU = mToU(5);
  const stepU = u === "cm" ? 1 : u === "ft" ? 0.1 : 0.05;
  const fmt = (m: number): string => mToU(m).toFixed(u === "cm" ? 0 : 2);

  // Mode + front/remaining values: prefer parent-driven (lifted) state when supplied,
  // otherwise fall back to local state so the block still works standalone.
  const [localMode, setLocalMode] = useState<InsetMode>("variable");
  const mode = p.mode ?? localMode;
  const setMode = p.setMode ?? setLocalMode;
  const frontIdx = p.frontEdgeIndex ?? 0;
  const frontTagged = p.frontEdgeIndex != null;
  const [localFrontVal, setLocalFrontVal] = useState<number>(0);
  const [localRemainingVal, setLocalRemainingVal] = useState<number>(0);
  const frontVal = p.frontVal ?? localFrontVal;
  const setFrontVal = p.setFrontVal ?? setLocalFrontVal;
  const remainingVal = p.remainingVal ?? localRemainingVal;
  const setRemainingVal = p.setRemainingVal ?? setLocalRemainingVal;

  // Deduct Area: optional subtraction from the displayed inset area. The deduction is reported
  // either as an absolute area (in m²) or as a percentage of the *main* (original) room area.
  // State is lifted to the parent so the canvas overlay can render the deduction footprint.
  const { deductEnabled, setDeductEnabled, deductMode, setDeductMode, deductAreaM2, setDeductAreaM2, deductPercent, setDeductPercent, deductAngle, setDeductAngle } = p;

  const applyFrontRemaining = (front: number, remaining: number): void => {
    p.setSetbacks(() => p.setbacks.map((_, i) => (i === frontIdx ? front : remaining)));
  };

  // Compute the inset polygon area for the current room + setbacks. Mirrors the offset-line
  // intersection used by runRoomInset, but stays in this component so the readout updates live
  // as sliders move (without round-tripping through the parent commit/preview cycle).
  const computeInsetAreaM2 = (): number | null => {
    const pts = p.selectedRoom.points;
    const N = pts.length;
    if (N < 3) return null;
    let signedArea = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      signedArea += a.x * b.y - b.x * a.y;
    }
    if (Math.abs(signedArea) < 1) return null;
    const sign = signedArea > 0 ? 1 : -1;
    type Line = { px: number; py: number; ux: number; uy: number };
    const lines: Line[] = [];
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      const dx = b.x - a.x, dy = b.y - a.y;
      const L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L;
      const nx = -uy * sign, ny = ux * sign;
      const setbackM = p.setbacks[i] ?? 0;
      const setbackPx = setbackM * p.pixelsPerMeter;
      lines.push({ px: a.x + nx * setbackPx, py: a.y + ny * setbackPx, ux, uy });
    }
    const intersect = (l1: Line, l2: Line): { x: number; y: number } | null => {
      const det = l1.ux * (-l2.uy) - l1.uy * (-l2.ux);
      if (Math.abs(det) < 1e-6) return null;
      const dx = l2.px - l1.px, dy = l2.py - l1.py;
      const t = (dx * (-l2.uy) - dy * (-l2.ux)) / det;
      return { x: l1.px + t * l1.ux, y: l1.py + t * l1.uy };
    };
    const insetPts: { x: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const v = intersect(lines[(i - 1 + N) % N], lines[i]);
      if (!v) return null;
      insetPts.push(v);
    }
    let area = 0;
    for (let i = 0; i < N; i++) {
      const a = insetPts[i], b = insetPts[(i + 1) % N];
      area += a.x * b.y - b.x * a.y;
    }
    if (Math.sign(area) !== Math.sign(signedArea)) return 0; // collapsed / inverted
    const areaPx2 = Math.abs(area) / 2;
    return areaPx2 / (p.pixelsPerMeter * p.pixelsPerMeter);
  };

  const insetAreaM2 = computeInsetAreaM2();

  // Main (original room) area in m² — drives the "% of Main Area" deduction.
  const computeMainAreaM2 = (): number => {
    const pts = p.selectedRoom.points;
    const N = pts.length;
    if (N < 3) return 0;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const a = pts[i], b = pts[(i + 1) % N];
      s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2 / (p.pixelsPerMeter * p.pixelsPerMeter);
  };
  const mainAreaM2 = computeMainAreaM2();

  // Resolve the actual deduction in m² from whichever mode is active.
  const deductionM2 = !deductEnabled
    ? 0
    : deductMode === "area"
      ? deductAreaM2
      : (deductPercent / 100) * mainAreaM2;

  const finalAreaM2 = insetAreaM2 == null ? null : Math.max(0, insetAreaM2 - deductionM2);

  const areaInUnit = (m2: number): number => {
    if (u === "cm") return m2 * 10000;
    if (u === "ft") return m2 * 10.7639;
    return m2;
  };
  const fmtArea = (m2: number): string => `${areaInUnit(m2).toFixed(u === "cm" ? 0 : 2)} ${u}²`;
  const areaLabel = finalAreaM2 == null ? "—" : fmtArea(finalAreaM2);

  // Deduction-by-area slider bounds: cap at the current inset area so users can't drag past it.
  const maxDeductM2 = insetAreaM2 ?? 0;
  const maxDeductU = areaInUnit(maxDeductM2);
  const deductStepU = u === "cm" ? 10 : u === "ft" ? 0.1 : 0.05;

  return (
  <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
    <button
      type="button"
      className="flex w-full items-center justify-between text-left"
      onClick={() => p.setExpanded((v) => !v)}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Inset Polygon</span>
      <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
    </button>
    {p.expanded && <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-slate-500">Mode</span>
        <select
          className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
          value={mode}
          onChange={(e) => {
            const m = e.target.value as InsetMode;
            setMode(m);
            if (m === "equal") {
              p.setSetbacks(() => p.setbacks.map(() => p.setAll));
            } else if (m === "front-remaining") {
              applyFrontRemaining(frontVal, remainingVal);
            }
            p.bumpLivePreviewTick();
          }}
        >
          <option value="equal">Equal</option>
          <option value="variable">Variable</option>
          <option value="front-remaining">Front And Remaining</option>
        </select>
      </div>

      {mode === "equal" && (
        <div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Offset</span>
            <span className="font-mono text-[10px] text-slate-700">{fmt(p.setAll)} {u}</span>
          </div>
          <input
            type="range"
            className="w-full"
            min={0}
            max={maxU}
            step={stepU}
            value={mToU(p.setAll)}
            onChange={(e) => {
              const v = uToM(+e.target.value);
              p.setSetAll(v);
              p.setSetbacks(() => p.setbacks.map(() => v));
            }}
            onPointerUp={p.bumpLivePreviewTick}
            onTouchEnd={p.bumpLivePreviewTick}
          />
        </div>
      )}

      {mode === "variable" && (
        <>
          <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {p.setbacks.map((sb, i) => (
              <div key={i}>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Edge {i}</span>
                  <span className="font-mono text-[10px] text-slate-700">{fmt(sb)} {u}</span>
                </div>
                <input
                  type="range"
                  className="w-full"
                  min={0}
                  max={maxU}
                  step={stepU}
                  value={mToU(sb)}
                  onChange={(e) => {
                    const v = uToM(+e.target.value);
                    p.setSetbacks((prev) => {
                      const arr = [...prev];
                      arr[i] = v;
                      return arr;
                    });
                  }}
                  onPointerUp={p.bumpLivePreviewTick}
                  onTouchEnd={p.bumpLivePreviewTick}
                />
              </div>
            ))}
          </div>
        </>
      )}

      {mode === "front-remaining" && (
        <>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Front offset (edge {frontIdx})</span>
              <span className="font-mono text-[10px] text-slate-700">{fmt(frontVal)} {u}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0}
              max={maxU}
              step={stepU}
              value={mToU(frontVal)}
              onChange={(e) => {
                const v = uToM(+e.target.value);
                setFrontVal(v);
                applyFrontRemaining(v, remainingVal);
              }}
              onPointerUp={p.bumpLivePreviewTick}
              onTouchEnd={p.bumpLivePreviewTick}
            />
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Remaining offset</span>
              <span className="font-mono text-[10px] text-slate-700">{fmt(remainingVal)} {u}</span>
            </div>
            <input
              type="range"
              className="w-full"
              min={0}
              max={maxU}
              step={stepU}
              value={mToU(remainingVal)}
              onChange={(e) => {
                const v = uToM(+e.target.value);
                setRemainingVal(v);
                applyFrontRemaining(frontVal, v);
              }}
              onPointerUp={p.bumpLivePreviewTick}
              onTouchEnd={p.bumpLivePreviewTick}
            />
          </div>
          <p className="text-[9px] italic text-slate-400">
            {frontTagged
              ? `Front edge: ${frontIdx} (from Site Boundary segment with Edge Role = Front).`
              : "No Site Boundary segment is tagged as Front yet — falling back to edge 0. Set a segment's Edge Role to Front in Segment Properties."}
          </p>
        </>
      )}
      <div className="space-y-1 rounded border border-slate-100 bg-slate-50 px-1.5 py-1.5">
        <label className="flex items-center gap-1 text-[10px] font-medium text-slate-700">
          <input
            type="checkbox"
            checked={deductEnabled}
            onChange={(e) => setDeductEnabled(e.target.checked)}
          />
          Deduct Area
        </label>
        {deductEnabled && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] text-slate-500">Deduction mode</span>
              <select
                className="flex-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
                value={deductMode}
                onChange={(e) => setDeductMode(e.target.value as "area" | "percent")}
              >
                <option value="area">Area</option>
                <option value="percent">Percent of Main Area</option>
              </select>
            </div>
            {deductMode === "area" ? (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Deduction area</span>
                  <span className="font-mono text-[10px] text-slate-700">{fmtArea(Math.min(deductAreaM2, maxDeductM2))}</span>
                </div>
                <input
                  type="range"
                  className="w-full"
                  min={0}
                  max={Math.max(0, maxDeductU)}
                  step={deductStepU}
                  value={Math.min(areaInUnit(deductAreaM2), maxDeductU)}
                  onChange={(e) => {
                    const vU = +e.target.value;
                    const vM2 = u === "cm" ? vU / 10000 : u === "ft" ? vU / 10.7639 : vU;
                    setDeductAreaM2(vM2);
                  }}
                />
              </div>
            ) : (
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">Percent of main area</span>
                  <span className="font-mono text-[10px] text-slate-700">{deductPercent.toFixed(0)}%</span>
                </div>
                <input
                  type="range"
                  className="w-full"
                  min={0}
                  max={100}
                  step={1}
                  value={deductPercent}
                  onChange={(e) => setDeductPercent(+e.target.value)}
                />
                <div className="text-[9px] text-slate-400">Main area: {fmtArea(mainAreaM2)}</div>
              </div>
            )}
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Deduction angle</span>
                <span className="font-mono text-[10px] text-slate-700">{deductAngle.toFixed(0)}°</span>
              </div>
              <input
                type="range"
                className="w-full"
                min={0}
                max={360}
                step={1}
                value={deductAngle}
                onChange={(e) => setDeductAngle(+e.target.value)}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-slate-500">
              <span>Deducted</span>
              <span className="font-mono">−{fmtArea(Math.min(deductionM2, insetAreaM2 ?? deductionM2))}</span>
            </div>
          </>
        )}
      </div>
      {deductEnabled ? (
        <div className="space-y-0.5 rounded bg-slate-50 px-1.5 py-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-600">Inset area</span>
            <span className="font-mono text-[10px] text-slate-800">
              {insetAreaM2 == null ? "—" : fmtArea(insetAreaM2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-slate-600">Deduction area</span>
            <span className="font-mono text-[10px] text-slate-800">
              {fmtArea(Math.min(deductionM2, insetAreaM2 ?? deductionM2))}
            </span>
          </div>
          <div className="flex items-center justify-between border-t border-slate-200 pt-0.5">
            <span className="text-[10px] font-semibold text-slate-700">Inset area after deduction</span>
            <span className="font-mono text-[10px] font-semibold text-slate-900">{areaLabel}</span>
          </div>
        </div>
      ) : (
        <div className="flex items-center justify-between rounded bg-slate-50 px-1.5 py-1">
          <span className="text-[10px] font-medium text-slate-600">Inset area</span>
          <span className="font-mono text-[10px] text-slate-800">{areaLabel}</span>
        </div>
      )}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={p.live}
            onChange={(e) => {
              const on = e.target.checked;
              p.setLive(on);
              if (on) p.runRoomInset(p.selectedRoom, true);
              else p.onLiveOff();
            }}
          />
          Live
        </label>
        <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on slide" : "click Apply Inset"}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full text-[11px]"
        onClick={() => { p.runRoomInset(p.selectedRoom, false); }}
      >
        Apply Inset
      </Button>
    </>}
  </div>
  );
};
