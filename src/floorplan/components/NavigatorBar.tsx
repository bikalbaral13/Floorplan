import { useRef, useState, type ReactNode } from "react";
import { Cloud, PanelLeftClose, Search } from "lucide-react";
import { NavFoldSection } from "./NavPlanSections";

import { CloudInspectDialog } from "./dialogs/CloudInspectDialog";
import { AccountBar } from "./AccountBar";

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
/** Whether the navigator is open — per browser on desktop; a phone drawer always starts folded. */
export const readNavigatorOpen = (overlay: boolean) => !overlay && readBool(OPEN_KEY, true);
export const saveNavigatorOpen = (open: boolean) => write(OPEN_KEY, open ? "1" : "0");

/** `open` / `onToggle` are owned by the editor so its top-left panel button can toggle the navigator.
 *  `preferences`: the Preferences panel content, opened from the account bar at the bottom (Claude-style). */
export const NavigatorBar = ({ overlay = false, preferences, open, onToggle, planSections, query = "", onQuery }: {
  overlay?: boolean; preferences?: ReactNode; open: boolean; onToggle: () => void;
  /** One search at the top of the navigator: filters the Library tree and the Layers tree together. */
  query?: string; onQuery?: (q: string) => void;
  /** Drawings · Layers · Elements — built by the editor (they need its state), shown under the Library tree. */
  planSections?: ReactNode;
}) => {
  const [width, setWidth] = useState(() => Math.min(MAX_W, Math.max(MIN_W, readNum(WIDTH_KEY, 300))));
  const drag = useRef<{ x: number; w: number } | null>(null);
  /** The width being dragged to — read on pointer-up, where `width` is still the previous render's. */
  const live = useRef(width);

  const toggle = onToggle;

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

  // Folded = gone entirely: the canvas takes the full width. The panel-toggle button at the top-left of the
  // editor (next to the logo) brings it back.
  if (!open) return null;

  return (
    <div
      className={overlay
        ? "fixed bottom-2 left-2 top-[72px] z-40 flex w-[min(22rem,calc(100vw-1rem))] flex-col rounded-xl border border-slate-200 bg-white shadow-xl"
        : "relative flex shrink-0 flex-col rounded-xl border border-slate-200 bg-white shadow-sm"}
      style={overlay ? undefined : { width }}
    >
      {/* Top: one search over everything below (Library files, layers and their elements). */}
      <div className="flex items-center gap-1.5 border-b border-slate-100 p-2">
        <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 focus-within:border-slate-300 focus-within:bg-white">
          <Search className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <input value={query} onChange={(e) => onQuery?.(e.target.value)} placeholder="Search library, layers, elements…"
            aria-label="Search the navigator" spellCheck={false} autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-xs outline-none" />
        </label>
        {/* Desktop: the header's panel button (top-left) shows / hides this navigator. The phone drawer
            covers that button, so it carries its own close. */}
        {overlay && (
          <button type="button" onClick={toggle} title="Close the navigator" aria-label="Close navigator"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <PanelLeftClose className="h-4 w-4" />
          </button>
        )}
      </div>
      {/* The whole middle scrolls; the Library tree keeps a usable height and each section caps its own. */}
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
        <NavFoldSection title="Library" icon={<Cloud className="h-3.5 w-3.5 text-sky-600" />} storageKey="bp.editor.navLibraryOpen" defaultOpen grow first>
          <div className="h-[22rem] min-h-0">
            <CloudInspectDialog variant="panel" open onOpenChange={() => {}} query={query} />
          </div>
        </NavFoldSection>
        {planSections}
        {/* Pipelines live in the Library (library/Pipelines/); the agent works on projects directly, and the
            ticked Library items show in the chat bar — so no Pipeline, Project or Selection sections here. */}
      </div>
      {preferences != null && <AccountBar preferences={preferences} />}
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
