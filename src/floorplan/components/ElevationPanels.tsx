import { useMemo } from "react";
import type { Point } from "../types";

/** One elevation panel — fits its projected polylines into an SVG (non-scaling stroke). */
function Panel({ title, lines, className }: { title: string; lines: Point[][]; className: string }) {
  const box = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ln of lines) for (const p of ln) {
      if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
    }
    if (!isFinite(minX)) return null;
    const w = Math.max(1, maxX - minX), h = Math.max(1, maxY - minY);
    const pad = Math.max(w, h) * 0.06;
    return { x: minX - pad, y: minY - pad, w: w + 2 * pad, h: h + 2 * pad };
  }, [lines]);

  return (
    <div className={`pointer-events-auto absolute flex flex-col overflow-hidden border border-slate-300 bg-white/95 ${className}`}>
      <span className="shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{title}</span>
      {box ? (
        <svg viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`} preserveAspectRatio="xMidYMid meet" className="min-h-0 flex-1 p-1">
          {lines.map((ln, i) => (
            <polyline
              key={i}
              points={ln.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="#0f172a"
              strokeWidth={1}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center text-[10px] text-slate-300">—</div>
      )}
    </div>
  );
}

/** Orthographic elevation layout around the plan: Back on top, Front on the bottom, Left / Right on the
 *  sides. The centre shows the live canvas plan (drawn below) — unless `plan` lines are supplied (e.g. a
 *  flow object's plan), in which case a centre Plan panel is drawn over it. */
export function ElevationPanels({ front, back, left, right, plan }: { front: Point[][]; back: Point[][]; left: Point[][]; right: Point[][]; plan?: Point[][] }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      <Panel title="Back" lines={back} className="left-0 right-0 top-0 h-[24%]" />
      <Panel title="Front" lines={front} className="bottom-0 left-0 right-0 h-[24%]" />
      <Panel title="Left" lines={left} className="bottom-[24%] left-0 top-[24%] w-[22%]" />
      <Panel title="Right" lines={right} className="bottom-[24%] right-0 top-[24%] w-[22%]" />
      {plan && plan.length > 0 && (
        <Panel title="Plan" lines={plan} className="bottom-[24%] left-[22%] right-[22%] top-[24%]" />
      )}
    </div>
  );
}
