import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import {
  DEFAULT_REGULATIONS,
  OCCUPANCY_LABELS,
  ROAD_LOCATION_LABELS,
  runCircularSetbackSolver,
  type Occupancy,
  type Regulations,
  type RoadLocation,
  type SolverResult,
} from "../../algorithms/dcr/circularSetbackSolver";

export interface CircularSetbackSolverBlockProps {
  selectedRoom: { id: string; points: Point[] };
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /**
   * Paint a preview inset polygon on the canvas using the supplied per-edge
   * setback distances (metres). Implementation should run the Inset Polygon
   * algorithm with commit = false so no permanent walls are created.
   */
  onShowOnCanvas?: (room: { id: string; points: Point[] }, perEdgeDistancesM: number[]) => void;
  /** Remove any inset preview walls previously painted by onShowOnCanvas. */
  onClearPreview?: () => void;
}

/**
 * Circular Setback Solver — UI wrapper around the fixed-point iteration in
 * algorithms/dcr/circularSetbackSolver.ts. Inputs:
 *
 *   • Plot width & depth — derived from the selected Space's bounding box.
 *   • Building type      — Residential / Commercial / Assembly (picks the
 *                          occupancy column out of the regulations).
 *   • Road location      — chooses the row out of the front-setback table.
 *   • Regulations JSON   — editable textarea, prefilled with the LandWise
 *                          PDF defaults (page 1, pages 3 & 5).
 *   • Total BUA          — built-up area target after deductions/additions.
 *
 * Pressing Apply runs the solver and renders an iteration table mirroring the
 * "Model Sheet" tab of setback_iteration.xlsx.
 */
export const CircularSetbackSolverBlock = (p: CircularSetbackSolverBlockProps) => {
  // Derive plot bounding box from the selected room polygon.
  const { plotWidthM, plotDepthM } = useMemo(() => {
    if (!p.selectedRoom?.points?.length) return { plotWidthM: 0, plotDepthM: 0 };
    const xs = p.selectedRoom.points.map((q) => q.x);
    const ys = p.selectedRoom.points.map((q) => q.y);
    const w = (Math.max(...xs) - Math.min(...xs)) / p.pixelsPerMeter;
    const d = (Math.max(...ys) - Math.min(...ys)) / p.pixelsPerMeter;
    return { plotWidthM: w, plotDepthM: d };
  }, [p.selectedRoom?.points, p.pixelsPerMeter]);

  const [occupancy, setOccupancy] = useState<Occupancy>("residential");
  const [roadLocation, setRoadLocation] = useState<RoadLocation>("areas-in-city");
  const [bua, setBua] = useState<number>(17280);
  const [regsText, setRegsText] = useState<string>(() =>
    JSON.stringify(DEFAULT_REGULATIONS, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<SolverResult | null>(null);

  // Live-parse the JSON so the preview panel can show the active height cap /
  // front setback for the current dropdown selections before Apply is pressed.
  // Failures here are silent — onApply re-parses and surfaces the error there.
  const liveRegs: Regulations | null = useMemo(() => {
    try { return JSON.parse(regsText) as Regulations; } catch { return null; }
  }, [regsText]);

  const occRulesPreview = liveRegs?.occupancies?.[occupancy];
  const previewFront = occRulesPreview?.frontSetbacks.find((r) => r.location === roadLocation)?.setbackM
    ?? occRulesPreview?.frontSetbacks[0]?.setbackM
    ?? null;
  const previewHeightCap = occRulesPreview?.permissibleHeightM ?? null;

  const onApply = () => {
    let regs: Regulations;
    try {
      regs = JSON.parse(regsText) as Regulations;
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e));
      setResult(null);
      return;
    }
    const res = runCircularSetbackSolver({
      plotWidthM,
      plotDepthM,
      totalBuaM2: bua,
      regs,
      occupancy,
      roadLocation,
    });
    setResult(res);
  };

  // Derived figures shown alongside the BUA input as a sanity check.
  const plotAreaM2 = plotWidthM * plotDepthM;
  const impliedFsi = plotAreaM2 > 0 ? bua / plotAreaM2 : 0;

  const statusColor =
    result?.status === "converged" ? "text-emerald-700 bg-emerald-50 border-emerald-300" :
    result?.status === "invalid-input" ? "text-slate-700 bg-slate-50 border-slate-300" :
    "text-red-700 bg-red-50 border-red-300";

  return (
    <div className="rounded border border-indigo-300 bg-indigo-50 p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-indigo-700">
          Circular Setback Solver
        </span>
        <span className="text-[11px] text-indigo-500">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <p className="text-[9px] italic text-indigo-600 leading-tight">
            setback ← height ← floors ← plate ← buildable ← setback. Iterates to a fixed point.
          </p>

          {/* ── Auto-derived plot dims ──────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded border border-slate-200 bg-white p-1.5">
              <span className="text-[9px] text-slate-500">Plot width</span>
              <p className="font-mono text-[11px] text-slate-700">{plotWidthM.toFixed(2)} m</p>
            </div>
            <div className="rounded border border-slate-200 bg-white p-1.5">
              <span className="text-[9px] text-slate-500">Plot depth</span>
              <p className="font-mono text-[11px] text-slate-700">{plotDepthM.toFixed(2)} m</p>
            </div>
          </div>

          {/* ── Building type ───────────────────────────────────────────── */}
          <div>
            <span className="text-[9px] text-slate-500">Building type</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
              value={occupancy}
              onChange={(e) => setOccupancy(e.target.value as Occupancy)}
            >
              {(Object.keys(OCCUPANCY_LABELS) as Occupancy[]).map((k) => (
                <option key={k} value={k}>{OCCUPANCY_LABELS[k]}</option>
              ))}
            </select>
            {previewHeightCap != null && (
              <p className="mt-0.5 text-[9px] text-slate-400">
                Permissible height: <span className="font-mono text-slate-600">{previewHeightCap} m</span>
              </p>
            )}
          </div>

          {/* ── Road location ───────────────────────────────────────────── */}
          <div>
            <span className="text-[9px] text-slate-500">Road location (front setback)</span>
            <select
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
              value={roadLocation}
              onChange={(e) => setRoadLocation(e.target.value as RoadLocation)}
            >
              {(Object.keys(ROAD_LOCATION_LABELS) as RoadLocation[]).map((k) => (
                <option key={k} value={k}>{ROAD_LOCATION_LABELS[k]}</option>
              ))}
            </select>
            {previewFront != null && (
              <p className="mt-0.5 text-[9px] text-slate-400">
                Front setback: <span className="font-mono text-slate-600">{previewFront} m</span>
              </p>
            )}
          </div>

          {/* ── BUA ────────────────────────────────────────────────────── */}
          <div>
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] text-slate-500">Total BUA (m²)</span>
              <span className="text-[9px] text-slate-400">
                implied FSI ≈ {impliedFsi.toFixed(2)}
              </span>
            </div>
            <input
              type="number"
              step={50}
              min={0}
              className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px] font-mono"
              value={bua}
              onChange={(e) => setBua(Number(e.target.value))}
            />
            <p className="mt-0.5 text-[9px] italic text-slate-400 leading-tight">
              Enter the optimal BUA after deductions/additions; the solver iterates against this target directly.
            </p>
          </div>

          {/* ── Regulations JSON ─────────────────────────────────────────── */}
          <div>
            <span className="text-[9px] text-slate-500">Regulations (JSON)</span>
            <textarea
              className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-mono text-slate-700"
              rows={14}
              value={regsText}
              onChange={(e) => setRegsText(e.target.value)}
              spellCheck={false}
            />
            {parseError && (
              <p className="mt-1 text-[9px] text-red-600">JSON parse error: {parseError}</p>
            )}
          </div>

          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-[11px] border-indigo-400 bg-indigo-100 hover:bg-indigo-200"
              onClick={onApply}
              disabled={!(plotWidthM > 0 && plotDepthM > 0)}
            >
              Apply
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1 text-[11px] border-indigo-400 bg-white hover:bg-indigo-50"
              disabled={!result || !p.onShowOnCanvas || result.rows.length === 0}
              title="Paint the final-iteration setback as an Inset Polygon preview (no commit)"
              onClick={() => {
                if (!result || !p.onShowOnCanvas) return;
                // Use the final iteration row — it holds the converged (or last attempted)
                // side setback. Front comes from the resolved table the solver used.
                const lastRow = result.rows[result.rows.length - 1];
                const side = Number.isFinite(lastRow.sideSetbackM) ? lastRow.sideSetbackM : 0;
                const front = result.frontSetbackUsedM;
                // Per-edge distance array: for each polygon edge, classify as horizontal
                // or vertical and pick the matching setback. Matches the solver's
                // (W − 2·side) × (D − 2·front) convention on axis-aligned rectangles.
                const pts = p.selectedRoom.points;
                const distances = pts.map((a, i) => {
                  const b = pts[(i + 1) % pts.length];
                  const dx = Math.abs(b.x - a.x);
                  const dy = Math.abs(b.y - a.y);
                  return dx >= dy ? front : side; // horizontal edge → front, vertical → side
                });
                p.onClearPreview?.();
                p.onShowOnCanvas(p.selectedRoom, distances);
              }}
            >
              Show on Canvas
            </Button>
          </div>

          {/* ── Result ────────────────────────────────────────────────── */}
          {result && (
            <div className="space-y-1.5">
              <div className={`rounded border px-2 py-1 text-[10px] ${statusColor}`}>
                <div className="font-semibold uppercase tracking-wide">{result.status.replace(/-/g, " ")}</div>
                <div>{result.message}</div>
                <div className="mt-0.5 text-[9px] opacity-80">
                  Plot area: {(plotWidthM * plotDepthM).toFixed(1)} m² · Total BUA: {result.totalBuaM2.toFixed(1)} m²
                  {" · "}front: {result.frontSetbackUsedM.toFixed(2)} m · cap: {result.heightCapUsedM} m
                </div>
              </div>

              {result.rows.length > 0 && (
                <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                  <table className="w-full text-[9px] tabular-nums">
                    <thead className="bg-slate-100 text-slate-600">
                      <tr>
                        <th className="px-1 py-0.5 text-left">Iter</th>
                        <th className="px-1 py-0.5 text-right">Plate in</th>
                        <th className="px-1 py-0.5 text-right">Flrs</th>
                        <th className="px-1 py-0.5 text-right">H (m)</th>
                        <th className="px-1 py-0.5 text-right">Side</th>
                        <th className="px-1 py-0.5 text-right">B-W</th>
                        <th className="px-1 py-0.5 text-right">B-D</th>
                        <th className="px-1 py-0.5 text-right">Buildable</th>
                        <th className="px-1 py-0.5 text-center">Fits?</th>
                        <th className="px-1 py-0.5 text-left">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.rows.map((r) => (
                        <tr key={r.iter} className="border-t border-slate-100">
                          <td className="px-1 py-0.5 text-slate-700">{r.iter}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{r.plateInM2.toFixed(1)}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{r.floors}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{r.heightM.toFixed(1)}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.sideSetbackM) ? r.sideSetbackM.toFixed(2) : "—"}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.buildWidthM) ? r.buildWidthM.toFixed(1) : "—"}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.buildDepthM) ? r.buildDepthM.toFixed(1) : "—"}</td>
                          <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.buildableM2) ? r.buildableM2.toFixed(1) : "—"}</td>
                          <td className={`px-1 py-0.5 text-center font-semibold ${r.note === "CONVERGED" ? "text-emerald-700" : r.plateFits ? "text-emerald-600" : "text-red-600"}`}>
                            {r.note === "CONVERGED" ? "✓✓" : r.plateFits ? "yes" : "no"}
                          </td>
                          <td className="px-1 py-0.5 text-slate-500">{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
