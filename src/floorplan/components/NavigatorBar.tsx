import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Cloud } from "lucide-react";
import { ProjectStatusPanel } from "./ProjectStatusPanel";

const FULL_PIPELINE_STAGES = [
  { dir: "1-program", label: "1 · Program", badge: "Program" },
  { dir: "2-plan-design", label: "2 · Plan/Design", badge: "Plan/Design" },
  { dir: "3-build", label: "3 · Build", badge: "Build" },
  { dir: "4-present", label: "4 · Present", badge: "Present" },
];
import { CloudInspectDialog } from "./dialogs/CloudInspectDialog";
import { LibrarySelectionBox } from "./LibrarySelectionBox";
import { PipelineTreeSection } from "./PipelineTreeSection";

const WIDTH_KEY = "bp.editor.navWidth";
const OPEN_KEY = "bp.editor.navOpen";
const MIN_W = 200;
const MAX_W = 640;

const readNum = (k: string, d: number) => {
  try { const v = Number(localStorage.getItem(k)); return Number.isFinite(v) && v > 0 ? v : d; } catch { return d; }
};
const readBool = (k: string, d: boolean) => {
  try { const v = localStorage.getItem(k); return v == null ? d : v === "1"; } catch { return d; }
};
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* in-memory only */ } };

/** The left navigation bar: the R2 bucket as a scrollable folder tree (the Cloud Inspect browser, docked).
 *  The chevron folds it to a thin strip; the right edge drags to resize. Width and fold are per browser. */
export const NavigatorBar = ({ overlay = false }: { overlay?: boolean }) => {
  // On a phone (`overlay`) it is a slide-over drawer: starts folded, and opening it there is not saved
  // over the desktop choice.
  const [open, setOpen] = useState(() => !overlay && readBool(OPEN_KEY, true));
  const [width, setWidth] = useState(() => Math.min(MAX_W, Math.max(MIN_W, readNum(WIDTH_KEY, 300))));
  const drag = useRef<{ x: number; w: number } | null>(null);
  /** The width being dragged to — read on pointer-up, where `width` is still the previous render's. */
  const live = useRef(width);

  // The phone check resolves after the first render, so fold the drawer when it switches on.
  useEffect(() => { if (overlay) setOpen(false); }, [overlay]);

  const toggle = () => setOpen((o) => { if (!overlay) write(OPEN_KEY, o ? "0" : "1"); return !o; });

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, w: width };
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    live.current = Math.min(MAX_W, Math.max(MIN_W, drag.current.w + e.clientX - drag.current.x));
    setWidth(live.current);
  };
  const onResizeUp = () => {
    if (!drag.current) return;
    drag.current = null;
    write(WIDTH_KEY, String(live.current));
  };

  if (!open) {
    // Phone: no rail eating the canvas — just a round chevron floating at the canvas's top-left corner,
    // mirroring the Properties chevron at the top-right.
    if (overlay) return (
      <button type="button" onClick={toggle} title="Show the Library (R2) navigator" aria-label="Show navigator"
        className="fixed left-4 top-[82px] z-40 inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-md hover:bg-slate-50">
        <ChevronRight className="h-4 w-4" />
      </button>
    );
    return (
      <div className="flex w-8 shrink-0 flex-col items-center rounded-xl border border-slate-200 bg-white py-2 shadow-sm">
        <button type="button" onClick={toggle} title="Show the Library (R2) navigator" aria-label="Show navigator"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <ChevronRight className="h-4 w-4" />
        </button>
        <Cloud className="mt-2 h-4 w-4 text-sky-600" aria-hidden />
      </div>
    );
  }

  return (
    <div
      className={overlay
        ? "fixed bottom-2 left-2 top-[72px] z-40 flex w-[min(22rem,calc(100vw-1rem))] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        : "relative flex shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm"}
      style={overlay ? undefined : { width }}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Cloud className="h-3.5 w-3.5 text-sky-600" /> Library (R2)
        </span>
        <button type="button" onClick={toggle} title="Fold the navigator" aria-label="Hide navigator"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex min-h-0 flex-1 flex-col">
          <CloudInspectDialog variant="panel" open onOpenChange={() => {}} />
        </div>
        <ProjectStatusPanel />
        {/* Read-only: the pipeline folders shipped with the app (public/interior-mesh-pipeline, public/floorplan-tracer-pipeline, public/exterior-mesh-pipeline, public/full-pipeline). */}
        <PipelineTreeSection />
        <PipelineTreeSection base="/floorplan-tracer-pipeline" title="Floorplan Tracer Pipeline" storageKey="bp.editor.tracerPipelineOpen" />
        <PipelineTreeSection base="/exterior-mesh-pipeline" title="Exterior Mesh Pipeline" storageKey="bp.editor.extPipelineOpen" />
        {/* One project through the four phases. The standalone Program, Space Brief, Build from Plan Deck and
            Walkthrough pipelines live on as its phase folders (originals archived 2026-10-11). */}
        <PipelineTreeSection base="/full-pipeline" title="Full Pipeline" storageKey="bp.editor.fullPipelineOpen" stages={FULL_PIPELINE_STAGES} />
        <LibrarySelectionBox />
      </div>
      {/* Resize grip — the whole right edge (desktop only; the phone drawer has a fixed width). */}
      {!overlay && <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize navigator"
        title="Drag to resize"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onPointerCancel={onResizeUp}
        className="absolute -right-1.5 top-0 z-10 h-full w-3 cursor-col-resize rounded hover:bg-sky-200/50"
      />}
    </div>
  );
};
