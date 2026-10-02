/**
 * Per-browser show/hide preferences for the editor's big UI pieces (Preferences ▸ Show on screen).
 * Kept in localStorage, not in the design: they are about this screen, not the plan.
 */
import { useSyncExternalStore } from "react";

export interface UiPrefs {
  showChat: boolean;
  showDrawingToolbar: boolean;
  showFlow: boolean;
  /** The Properties | Metrics column. The canvas-edge chevron flips this same value. */
  showProperties: boolean;
}

const KEY = "bp.editor.uiPrefs";
const DEFAULTS: UiPrefs = { showChat: true, showDrawingToolbar: true, showFlow: true, showProperties: true };
const listeners = new Set<() => void>();

function read(): UiPrefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

let current: UiPrefs = read();

export function setUiPref<K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* not persisted; the in-memory value still works */
  }
  listeners.forEach((l) => l());
}

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
