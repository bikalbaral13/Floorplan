/**
 * Screen-wide Render mode toggle (header, left of the Files button): Graph | Primitives | Detailed.
 *
 *   Graph      — nodes, segments and spaces only; no parametric object is evaluated or drawn.
 *   Primitives — each attached object as its bounding outline in 2D and bounding cuboid in 3D.
 *   Detailed   — every object fully evaluated in 2D and 3D.
 *
 * Per-browser view setting (localStorage), never written into the design. The per-object
 * `renderMode` parameter stays in the files but is meant to be passive once this drives rendering.
 * Step 1: the toggle only records the choice; `useRenderMode()` / `getRenderMode()` are for the wiring.
 */
import { useSyncExternalStore } from "react";

export type UiRenderMode = "geometry" | "primitives" | "detailed";

const MODES: { id: UiRenderMode; label: string; title: string }[] = [
  { id: "geometry", label: "Graph", title: "Graph only: nodes, segments and spaces; no object is rendered (still listed in Properties)" },
  { id: "primitives", label: "Primitives", title: "Primitives: each object as its bounding outline in 2D and bounding cuboid in 3D" },
  { id: "detailed", label: "Detailed", title: "Detailed: every object fully evaluated in 2D and 3D (slow on big plans)" },
];

const KEY = "bp.editor.renderMode";
const listeners = new Set<() => void>();

function read(): UiRenderMode {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "geometry" || v === "primitives" || v === "detailed") return v;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return "geometry";
}

let current: UiRenderMode = read();

export const getRenderMode = (): UiRenderMode => current;

export function setRenderMode(m: UiRenderMode) {
  if (m === current) return;
  current = m;
  try {
    localStorage.setItem(KEY, m);
  } catch {
    /* not persisted; the in-memory value still works */
  }
  listeners.forEach((l) => l());
}

export function useRenderMode(): UiRenderMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function RenderModeToggle() {
  const mode = useRenderMode();
  return (
    <div className="flex flex-row overflow-hidden rounded-md border border-slate-200" role="group" aria-label="Render mode">
      {MODES.map((m, i) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setRenderMode(m.id)}
          className={`${i ? "border-l border-slate-200 " : ""}px-2 py-1 text-[11px] font-semibold transition ${mode === m.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          aria-pressed={mode === m.id}
          title={m.title}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
