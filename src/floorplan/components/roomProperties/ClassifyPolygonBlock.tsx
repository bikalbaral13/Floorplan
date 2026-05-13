import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import {
  classifyRectilinearPolygon,
  type ClassificationResult,
} from "../../algorithms/geometry/rectilinearShapeClassifier";

export interface ClassifyPolygonBlockProps {
  selectedRoom: { id: string; points: Point[] };
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
}

export const ClassifyPolygonBlock = ({ selectedRoom, expanded, setExpanded }: ClassifyPolygonBlockProps) => {
  const [result, setResult] = useState<ClassificationResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onClassify = () => {
    setError(null);
    if (selectedRoom.points.length < 3) {
      setResult(null);
      setError("Polygon needs at least 3 vertices.");
      return;
    }
    try {
      setResult(classifyRectilinearPolygon(selectedRoom.points));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Classify Polygon</span>
        <span className="text-[11px] text-slate-400">{expanded ? "▼" : "▶"}</span>
      </button>
      {expanded && (
        <>
          <Button variant="outline" size="sm" className="w-full text-[11px]" onClick={onClassify}>
            Classify
          </Button>
          {error && <p className="text-[10px] text-rose-600">{error}</p>}
          {result && (
            <div className="space-y-0.5 text-[10px] text-slate-700">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Shape</span>
                <span className="font-mono font-semibold text-slate-900">{result.best.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Confidence</span>
                <span className="font-mono">{result.confidence}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Rule label</span>
                <span className="font-mono">{result.ruleLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Vertices / reflex</span>
                <span className="font-mono">{result.signature.n} / {result.signature.reflexCount}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Symmetry</span>
                <span className="font-mono">{result.signature.sym.label}</span>
              </div>
              {!result.axisAligned && (
                <p className="text-[9px] text-amber-600">Polygon has diagonal edges — match is approximate.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};
