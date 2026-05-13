import { useMemo, useRef, useState } from "react";

interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

export const useHistory = <T,>(initial: T) => {
  const [state, setState] = useState<HistoryState<T>>({
    past: [],
    present: initial,
    future: [],
  });

  // Synchronous shadow of the latest state. setState is async, so when multiple
  // mutators run in the same tick (e.g. Site Tools cascading Inset → OptRect →
  // Split → Massing) each call would otherwise read the stale present and the
  // last setState would clobber the rest. The shadow ref is updated immediately
  // inside set/replace/undo/redo, and `state` (returned to consumers) reads from
  // it — so each cascaded runner sees the previous runner's writes.
  const shadowRef = useRef<HistoryState<T>>(state);
  // Keep the shadow in sync when React commits a new state from outside
  // (e.g. parent re-render with a different initial). The setState updaters below
  // already update the shadow synchronously; this catches any drift.
  if (shadowRef.current !== state && shadowRef.current.present !== state.present) {
    // React's committed state is the source of truth — overwrite shadow if drifted.
    shadowRef.current = state;
  }

  const canUndo = shadowRef.current.past.length > 0;
  const canRedo = shadowRef.current.future.length > 0;

  const set = (next: T) => {
    const prev = shadowRef.current;
    const updated: HistoryState<T> = {
      past: [...prev.past, prev.present],
      present: next,
      future: [],
    };
    shadowRef.current = updated;
    setState(updated);
  };

  /** Replace present without pushing to undo stack — for transient/live updates. */
  const replace = (next: T) => {
    const prev = shadowRef.current;
    const updated: HistoryState<T> = {
      past: prev.past,
      present: next,
      future: prev.future,
    };
    shadowRef.current = updated;
    setState(updated);
  };

  const undo = () => {
    const prev = shadowRef.current;
    if (prev.past.length === 0) return;
    const previous = prev.past[prev.past.length - 1];
    const nextPast = prev.past.slice(0, -1);
    const updated: HistoryState<T> = {
      past: nextPast,
      present: previous,
      future: [prev.present, ...prev.future],
    };
    shadowRef.current = updated;
    setState(updated);
  };

  const redo = () => {
    const prev = shadowRef.current;
    if (prev.future.length === 0) return;
    const [next, ...nextFuture] = prev.future;
    const updated: HistoryState<T> = {
      past: [...prev.past, prev.present],
      present: next,
      future: nextFuture,
    };
    shadowRef.current = updated;
    setState(updated);
  };

  const actions = useMemo(
    () => ({
      set,
      replace,
      undo,
      redo,
    }),
    []
  );

  return {
    // Read from the shadow so cascaded mutators within the same tick see
    // each others' writes. React renders are still driven by `state`.
    state: shadowRef.current.present,
    canUndo,
    canRedo,
    ...actions,
  };
};
