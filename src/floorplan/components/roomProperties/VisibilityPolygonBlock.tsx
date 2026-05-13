import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import { computeVisibilityPolygon, sampleSegmentInside } from "../../algorithms/geometry/visibilityPolygon";
import { monteCarloLightSegments } from "../../algorithms/geometry/monteCarloLight";

export type VisibilityMode = "point" | "segment";
export type VisibilityRay = { x1: number; y1: number; x2: number; y2: number; energy: number };

const SEGMENT_SAMPLES = 16;

export interface VisibilityPolygonBlockProps {
  selectedRoom: { id: string; points: Point[]; roomType?: string };
  pixelsPerMeter: number;
  unit: string;

  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  live: boolean;
  setLive: (v: boolean) => void;

  modeByRoom: Record<string, VisibilityMode>;
  setModeByRoom: (updater: (prev: Record<string, VisibilityMode>) => Record<string, VisibilityMode>) => void;
  viewerByRoom: Record<string, Point>;
  setViewerByRoom: (updater: (prev: Record<string, Point>) => Record<string, Point>) => void;
  edgeIndexByRoom: Record<string, number>;
  setEdgeIndexByRoom: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  bouncesByRoom: Record<string, number>;
  setBouncesByRoom: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  rayCountByRoom: Record<string, number>;
  setRayCountByRoom: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  reflectivityByRoom: Record<string, number>;
  setReflectivityByRoom: (updater: (prev: Record<string, number>) => Record<string, number>) => void;
  setPolygonsByRoom: (updater: (prev: Record<string, Point[][]>) => Record<string, Point[][]>) => void;
  setRaysByRoom: (updater: (prev: Record<string, VisibilityRay[]>) => Record<string, VisibilityRay[]>) => void;
}

export const VisibilityPolygonBlock = (p: VisibilityPolygonBlockProps) => {
  const rid = p.selectedRoom.id;
  const mode = p.modeByRoom[rid] ?? "point";
  const viewer = p.viewerByRoom[rid];
  const edgeIdx = p.edgeIndexByRoom[rid] ?? 0;
  const polyHasViewer = !!viewer;
  const bounces = p.bouncesByRoom[rid] ?? 0;
  const rayCount = p.rayCountByRoom[rid] ?? 200;
  const reflectivity = p.reflectivityByRoom[rid] ?? 0.7;

  const compute = () => {
    const pts = p.selectedRoom.points;
    if (mode === "point") {
      if (!viewer) return;
      p.setPolygonsByRoom((prev) => ({ ...prev, [rid]: [computeVisibilityPolygon(viewer, pts)] }));
      if (bounces > 0) {
        const segs = monteCarloLightSegments(viewer, pts, { rayCount, maxBounces: bounces, reflectivity });
        p.setRaysByRoom((prev) => ({ ...prev, [rid]: segs }));
      } else {
        p.setRaysByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
      }
    } else {
      const samples = sampleSegmentInside(pts, edgeIdx, SEGMENT_SAMPLES);
      const polys = samples.map((s) => computeVisibilityPolygon(s, pts)).filter((q) => q.length >= 3);
      p.setPolygonsByRoom((prev) => ({ ...prev, [rid]: polys }));
      p.setRaysByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Visibility Polygon</span>
        <span className="text-[11px] text-slate-400">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <div>
            <span className="text-[10px] text-slate-500">Type</span>
            <div className="mt-0.5 flex gap-1">
              <Button
                size="sm"
                variant={mode === "point" ? "default" : "outline"}
                className="h-6 flex-1 text-[10px]"
                onClick={() => p.setModeByRoom((prev) => ({ ...prev, [rid]: "point" }))}
              >
                Point
              </Button>
              <Button
                size="sm"
                variant={mode === "segment" ? "default" : "outline"}
                className="h-6 flex-1 text-[10px]"
                onClick={() => p.setModeByRoom((prev) => ({ ...prev, [rid]: "segment" }))}
              >
                Segment
              </Button>
            </div>
          </div>
          {mode === "point" ? (
            <>
              <p className="text-[10px] text-slate-500">
                Drag the orange handle on the canvas to move the viewer.
              </p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">Viewer</span>
                <span className="font-mono text-[10px] text-slate-700">
                  {polyHasViewer ? `(${viewer.x.toFixed(0)}, ${viewer.y.toFixed(0)})` : "—"}
                </span>
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 flex-1 text-[10px]"
                  onClick={() => {
                    const pts = p.selectedRoom.points;
                    let cx = 0, cy = 0;
                    for (const pt of pts) { cx += pt.x; cy += pt.y; }
                    cx /= pts.length; cy /= pts.length;
                    const c = { x: cx, y: cy };
                    p.setViewerByRoom((prev) => ({ ...prev, [rid]: c }));
                    p.setPolygonsByRoom((prev) => ({ ...prev, [rid]: [computeVisibilityPolygon(c, pts)] }));
                  }}
                >
                  {polyHasViewer ? "Reset to centroid" : "Place at centroid"}
                </Button>
                {polyHasViewer && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 flex-1 text-[10px]"
                    onClick={() => {
                      p.setViewerByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
                      p.setPolygonsByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
                      p.setRaysByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
                    }}
                  >
                    Clear
                  </Button>
                )}
              </div>

              {/* Monte-Carlo light tracing controls. Bounces=0 disables MC; only direct visibility shown. */}
              <div className="rounded border border-slate-100 bg-slate-50 p-1.5 space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Monte-Carlo light</div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Bounces</span>
                    <span className="font-mono text-[10px] text-slate-700">{bounces}</span>
                  </div>
                  <input
                    type="range" className="w-full" min={0} max={6} step={1}
                    value={bounces}
                    onChange={(e) => {
                      const v = +e.target.value;
                      p.setBouncesByRoom((prev) => ({ ...prev, [rid]: v }));
                      if (p.live && polyHasViewer) {
                        if (v > 0) {
                          const segs = monteCarloLightSegments(viewer!, p.selectedRoom.points, { rayCount, maxBounces: v, reflectivity });
                          p.setRaysByRoom((prev) => ({ ...prev, [rid]: segs }));
                        } else {
                          p.setRaysByRoom((prev) => { const n = { ...prev }; delete n[rid]; return n; });
                        }
                      }
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Rays</span>
                    <span className="font-mono text-[10px] text-slate-700">{rayCount}</span>
                  </div>
                  <input
                    type="range" className="w-full" min={50} max={1000} step={25}
                    value={rayCount}
                    onChange={(e) => {
                      const v = +e.target.value;
                      p.setRayCountByRoom((prev) => ({ ...prev, [rid]: v }));
                      if (p.live && bounces > 0 && polyHasViewer) {
                        const segs = monteCarloLightSegments(viewer!, p.selectedRoom.points, { rayCount: v, maxBounces: bounces, reflectivity });
                        p.setRaysByRoom((prev) => ({ ...prev, [rid]: segs }));
                      }
                    }}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Reflectivity</span>
                    <span className="font-mono text-[10px] text-slate-700">{reflectivity.toFixed(2)}</span>
                  </div>
                  <input
                    type="range" className="w-full" min={0.1} max={0.95} step={0.05}
                    value={reflectivity}
                    onChange={(e) => {
                      const v = +e.target.value;
                      p.setReflectivityByRoom((prev) => ({ ...prev, [rid]: v }));
                      if (p.live && bounces > 0 && polyHasViewer) {
                        const segs = monteCarloLightSegments(viewer!, p.selectedRoom.points, { rayCount, maxBounces: bounces, reflectivity: v });
                        p.setRaysByRoom((prev) => ({ ...prev, [rid]: segs }));
                      }
                    }}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-[10px] text-slate-500">
                Pick a polygon edge — the visibility region is the union of viewpoints sampled along it (e.g. a window or open wall span).
              </p>
              <div>
                <span className="text-[10px] text-slate-500">Edge</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-[11px]"
                  value={edgeIdx}
                  onChange={(e) => {
                    const v = +e.target.value;
                    p.setEdgeIndexByRoom((prev) => ({ ...prev, [rid]: v }));
                    if (p.live) {
                      const pts = p.selectedRoom.points;
                      const samples = sampleSegmentInside(pts, v, SEGMENT_SAMPLES);
                      const polys = samples.map((s) => computeVisibilityPolygon(s, pts)).filter((q) => q.length >= 3);
                      p.setPolygonsByRoom((prev) => ({ ...prev, [rid]: polys }));
                    }
                  }}
                >
                  {p.selectedRoom.points.map((_, i) => {
                    const a = p.selectedRoom.points[i];
                    const b = p.selectedRoom.points[(i + 1) % p.selectedRoom.points.length];
                    const len = Math.hypot(b.x - a.x, b.y - a.y) / p.pixelsPerMeter;
                    return (
                      <option key={i} value={i}>
                        Edge {i} (V{i}→V{(i + 1) % p.selectedRoom.points.length}) — {len.toFixed(2)} {p.unit}
                      </option>
                    );
                  })}
                </select>
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1 text-[10px] text-slate-600">
              <input
                type="checkbox"
                checked={p.live}
                onChange={(e) => {
                  const on = e.target.checked;
                  p.setLive(on);
                  if (on) compute();
                }}
              />
              Live
            </label>
            <span className="text-[9px] text-slate-400">{p.live ? "auto-updates on drag / edge change" : "click Compute"}</span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px]"
            disabled={mode === "point" && !polyHasViewer}
            onClick={compute}
          >
            Compute Visibility
          </Button>
        </>
      )}
    </div>
  );
};
