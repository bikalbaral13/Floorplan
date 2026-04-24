import { useMemo, useState } from "react";

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

  const canUndo = state.past.length > 0;
  const canRedo = state.future.length > 0;

  const set = (next: T) => {
    setState((prev) => ({
      past: [...prev.past, prev.present],
      present: next,
      future: [],
    }));
  };

  /** Replace present without pushing to undo stack — for transient/live updates. */
  const replace = (next: T) => {
    setState((prev) => ({
      past: prev.past,
      present: next,
      future: prev.future,
    }));
  };

  const undo = () => {
    setState((prev) => {
      if (prev.past.length === 0) {
        return prev;
      }
      const previous = prev.past[prev.past.length - 1];
      const nextPast = prev.past.slice(0, -1);
      return {
        past: nextPast,
        present: previous,
        future: [prev.present, ...prev.future],
      };
    });
  };

  const redo = () => {
    setState((prev) => {
      if (prev.future.length === 0) {
        return prev;
      }
      const [next, ...nextFuture] = prev.future;
      return {
        past: [...prev.past, prev.present],
        present: next,
        future: nextFuture,
      };
    });
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
    state: state.present,
    canUndo,
    canRedo,
    ...actions,
  };
};
