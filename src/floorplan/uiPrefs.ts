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
  /** The left navigation bar (the R2 Library tree). */
  showNavigator: boolean;
  /** The canvas status bar (zoom · mode · selection · Ortho). Off by default. */
  showStatusBar: boolean;
  /** Who answers the Chat box: Claude Code (over Connect Claude / the local bridge) or Gemini. */
  chatEngine: "claude" | "gemini";
  /** Marker: the one-time reset of showFlow to the new OFF default has run. */
  flowOffDefault?: boolean;
}

const KEY = "bp.editor.uiPrefs";
const DEFAULTS: UiPrefs = { showChat: true, showDrawingToolbar: false, showFlow: false, showProperties: true, showNavigator: true, showStatusBar: false, chatEngine: "claude" };
const listeners = new Set<() => void>();

function read(): UiPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<UiPrefs>;
    // Prefs saved before the navigator existed carry the old Drawing-toolbar default (on). The navigator
    // takes that place now, so the toolbar starts OFF once; after that the saved choice is kept.
    if (!("showNavigator" in saved)) saved.showDrawingToolbar = false;
    // Flow engine became off by default (every phase). Prefs saved before that carry it ON; reset it once,
    // then the user's own choice is kept.
    if (!(saved as { flowOffDefault?: boolean }).flowOffDefault) saved.showFlow = false;
    return { ...DEFAULTS, ...saved, flowOffDefault: true } as UiPrefs;
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

/** The current prefs, for callbacks that must not re-subscribe. */
export const getUiPrefs = (): UiPrefs => current;

export function useUiPrefs(): UiPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
