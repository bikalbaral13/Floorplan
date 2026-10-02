/**
 * Plan / Build / Present toggle in the editor header.
 *
 * Step 1 of the phases work: the toggle only records the chosen phase (per browser, in localStorage).
 * Nothing reads it yet. Later steps subscribe with `usePhase()` to show/hide toolbars and rank skills,
 * so the logic stays here and out of FloorPlanEditor.
 */
import { useSyncExternalStore } from "react";

export type Phase = "plan" | "build" | "present";

const PHASES: { id: Phase; label: string; title: string }[] = [
  { id: "plan", label: "Plan", title: "Plan: import or trace the floor plan, set scale and levels, pick the moodboard" },
  { id: "build", label: "Build", title: "Build: improve the plan with objects, materials, lighting and instancing" },
  { id: "present", label: "Present", title: "Present: images, videos and walkthroughs" },
];

const KEY = "bp.editor.phase";
const listeners = new Set<() => void>();

function read(): Phase {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "plan" || v === "build" || v === "present") return v;
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
          title={p.title}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
