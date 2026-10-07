/**
 * Program / Plan / Design / Build / Present toggle in the editor header.
 *
 * Records the chosen phase per browser (localStorage) and publishes it through `usePhase()`; LeftToolbar
 * switches its phase workflow buttons on it. The phase list and each pipeline's home phase live in
 * ../phases.ts so other parts of the app can share them.
 */
import { useSyncExternalStore } from "react";
import { PHASES, isPhase, type Phase } from "../phases";

export type { Phase };

const KEY = "bp.editor.phase.v2";
/** Before Program / Design existed, "build" meant improving the plan with objects — today's Design. */
const LEGACY_KEY = "bp.editor.phase";
const listeners = new Set<() => void>();

function read(): Phase {
  try {
    const v = localStorage.getItem(KEY);
    if (isPhase(v)) return v;
    const old = localStorage.getItem(LEGACY_KEY);
    if (old === "build") return "design";
    if (isPhase(old)) return old;
  } catch {
    /* storage blocked: fall back to the default */
  }
  return "plan";
}

let current: Phase = read();

export function setPhase(p: Phase) {
  if (p === current) return;
  current = p;
  try {
    localStorage.setItem(KEY, p);
  } catch {
    /* not persisted; the in-memory value still works */
  }
  listeners.forEach((l) => l());
}

export function usePhase(): Phase {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function PhaseToggle() {
  const phase = usePhase();
  return (
    <div className="flex flex-row overflow-hidden rounded-md border border-slate-200" role="group" aria-label="Phase">
      {PHASES.map((p, i) => (
        <button
          key={p.id}
          type="button"
          onClick={() => setPhase(p.id)}
          className={`${i ? "border-l border-slate-200 " : ""}px-2.5 py-1 text-[11px] font-semibold transition ${phase === p.id ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
          aria-pressed={phase === p.id}
          title={`${p.title}
Pipelines: ${p.pipelines.join(", ")}`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
