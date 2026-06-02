import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { clipInsetByDeduction } from "../../algorithms/geometry/insetDeduction";
import { computeInsetPolygon } from "../../algorithms/geometry/insetPolygon";

export type InsetMode = "equal" | "variable" | "front-remaining";

/** Compact, scrollable read-only list of polygon vertices (in display units). */
const VertexList = ({
  title,
  pts,
  fmtVertex,
}: {
  title: string;
  pts: Point[];
  fmtVertex: (q: Point) => string;
}) => (
  <div>
    <div className="flex items-center justify-between">
      <span className="text-[10px] font-medium text-slate-600">{title}</span>
      <span className="font-mono text-[9px] text-slate-400">{pts.length} pts</span>
    </div>
    {pts.length > 0 ? (
      <div className="mt-0.5 max-h-20 overflow-y-auto rounded border border-slate-200 bg-white px-1 py-0.5 font-mono text-[9px] leading-tight text-slate-700">
        {pts.map((q, i) => (
          <div key={i}>{i + 1}: {fmtVertex(q)}</div>
        ))}
      </div>
    ) : (
      <div className="text-[9px] italic text-slate-400">—</div>
    )}
  </div>
);

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
  /** Offset direction: true (default) = inset inward; false = offset outward. */
  inside: boolean;
  setInside: (v: boolean) => void;
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

  // Recipe JSON preview — foldable, default collapsed.
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [recipeCopied, setRecipeCopied] = useState(false);

  // Deduct Area: optional subtraction from the displayed inset area. The deduction is reported
  // either as an absolute area (in m²) or as a percentage of the *main* (original) room area.
  // State is lifted to the parent so the canvas overlay can render the deduction footprint.
  const { deductEnabled, setDeductEnabled, deductMode, setDeductMode, deductAreaM2, setDeductAreaM2, deductPercent, setDeductPercent, deductAngle, setDeductAngle } = p;

  const applyFrontRemaining = (front: number, remaining: number): void => {
    p.setSetbacks(() => p.setbacks.map((_, i) => (i === frontIdx ? front : remaining)));
  };

  // Inset polygon area + vertices for the current room + setbacks. Delegates to the
  // shared `computeInsetPolygon` (the same routine runRoomInset and the canvas overlay
  // use) so the readout can never diverge from what's drawn/committed. Mapping back to
  // this block's null/zero-area contract: degenerate or parallel-edge cases → null;
  // collapsed (setbacks too large) → keep the ring but report zero area.
  const computeInsetReadout = (): { pts: Point[]; areaM2: number } | null => {
    const res = computeInsetPolygon(p.selectedRoom.points, p.setbacks, p.pixelsPerMeter, p.inside);
    if (res.reason === "degenerate" || res.reason === "parallel") return null;
    let area = 0;
    const N = res.pts.length;
    for (let i = 0; i < N; i++) {
      const a = res.pts[i], b = res.pts[(i + 1) % N];
      area += a.x * b.y - b.x * a.y;
    }
    const areaM2 = res.valid ? Math.abs(area) / 2 / (p.pixelsPerMeter * p.pixelsPerMeter) : 0;
    return { pts: res.pts, areaM2 };
  };

  const insetResult = computeInsetReadout();
  const insetPolyPx = insetResult?.pts ?? [];
  const insetAreaM2 = insetResult ? insetResult.areaM2 : null;

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

  // Deduction + post-deduction (available) polygons — same shared helper the canvas
  // overlay uses, so the listed vertices match what's drawn.
  const dedClip = (deductEnabled && insetPolyPx.length >= 3)
    ? clipInsetByDeduction(insetPolyPx, {
        angleDeg: deductAngle,
        mode: deductMode,
        areaM2: deductAreaM2,
        percent: deductPercent,
        mainAreaM2,
        ppm: p.pixelsPerMeter,
      })
    : null;
  const deductionPolyPx = dedClip?.deduction ?? [];
  const availablePolyPx = dedClip && dedClip.available.length >= 3 ? dedClip.available : insetPolyPx;

  // Vertex formatter: world-pixel coordinate → display unit, as "(x, y)".
  const fmtVertex = (q: Point): string => {
    const d = u === "cm" ? 0 : 2;
    return `(${mToU(q.x / p.pixelsPerMeter).toFixed(d)}, ${mToU(q.y / p.pixelsPerMeter).toFixed(d)})`;
  };

  // Executable recipe op for the current parameters. Carries the offset direction
  // (`inside`) and the UI `mode` plus its mode-specific values, all of which
  // applyRecipeJson now replays. Geometry comes from `uniformSetback` (equal) or the
  // per-edge `setbacks` array. (Deduct Area isn't replayed yet, so it's still omitted.)
  // Wrapped in { operations: [...] } so it drops straight into the Apply JSON box.
  const recipeJson = (() => {
    const sb = p.setbacks ?? [];
    const round = (n: number): number => Number(n.toFixed(4));
    const params: Record<string, unknown> = { mode, inside: p.inside };
    if (mode === "equal") {
      params.uniformSetback = round(p.setAll);
    } else if (mode === "front-remaining") {
      params.front = round(frontVal);
      params.remaining = round(remainingVal);
      params.setbacks = sb.map(round);
    } else {
      params.setbacks = sb.map(round);
    }
    return JSON.stringify({ operations: [{ tool: "inset", params, commit: true }] }, null, 2);
  })();

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
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-1 text-[10px] text-slate-600" title="When checked the polygon is offset inward (classic inset). Uncheck to offset the polygon outward by the setback distance.">
          <input
            type="checkbox"
            checked={p.inside}
            onChange={(e) => {
              p.setInside(e.target.checked);
              if (p.live) p.runRoomInset(p.selectedRoom, true);
              p.bumpLivePreviewTick();
            }}
          />
          Inside
        </label>
        <span className="text-[9px] text-slate-400">{p.inside ? "offset inward" : "offset outward"}</span>
      </div>
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
      {/* Polygon vertex lists (coordinates in display units). */}
      <div className="space-y-1.5 rounded bg-slate-50 px-1.5 py-1">
        <div className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Polygons ({u})</div>
        <VertexList title="Inset polygon" pts={insetPolyPx} fmtVertex={fmtVertex} />
        {deductEnabled && (
          <>
            <VertexList title="Deduction polygon" pts={deductionPolyPx} fmtVertex={fmtVertex} />
            <VertexList title="Inset after deduction" pts={availablePolyPx} fmtVertex={fmtVertex} />
          </>
        )}
      </div>
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
        onClick={() => {
          p.runRoomInset(p.selectedRoom, false);
          // After committing, drop out of Live mode. Do NOT call onLiveOff here:
          // the commit (silent=false) already strips this room's preview walls and
          // its livePreviewPolygon entry, and onLiveOff's h.replace reads a stale
          // history snapshot (set() updates the shadow ref synchronously, but
          // historyRef.current.state isn't refreshed until the next render) — calling
          // it in the same tick would clobber the just-committed inset segments.
          if (p.live) p.setLive(false);
        }}
      >
        Apply Inset
      </Button>

      {/* Recipe JSON — live op for the current parameters, foldable (default collapsed).
          Copy and paste into the Apply JSON box to replay this inset. */}
      <div className="rounded border border-slate-200 bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-2 py-1 text-left"
          onClick={() => setRecipeOpen((v) => !v)}
        >
          <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Recipe JSON</span>
          <span className="text-[11px] text-slate-400">{recipeOpen ? "▼" : "▶"}</span>
        </button>
        {recipeOpen && (
          <div className="space-y-1 px-2 pb-2">
            <pre className="max-h-40 overflow-auto whitespace-pre rounded border border-slate-200 bg-slate-50 px-1.5 py-1 font-mono text-[9px] leading-tight text-slate-700">{recipeJson}</pre>
            <Button
              variant="outline"
              size="sm"
              className="h-6 w-full text-[10px]"
              onClick={() => {
                navigator.clipboard.writeText(recipeJson).then(
                  () => { setRecipeCopied(true); window.setTimeout(() => setRecipeCopied(false), 1500); },
                  () => { /* clipboard unavailable — no-op */ },
                );
              }}
            >
              {recipeCopied ? "Copied!" : "Copy"}
            </Button>
          </div>
        )}
      </div>
    </>}
  </div>
  );
};
