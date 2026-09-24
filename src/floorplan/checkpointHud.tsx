// Checkpoint HUD — the in-app half of the `checkpoint` bridge tool.
//
// A stepwise agent calls `checkpoint` after each step; that tool call BLOCKS until the user decides here.
// The card shows what the agent just did, counts the edits the user makes on canvas while it sits open,
// and takes a decision (+ free text). Both channels — canvas edits and typed notes — come back in the
// same tool result, so the next step sees them.
//
// It mounts its own React root on document.body rather than living in the editor tree: the HUD is bridge
// machinery, not part of the document being edited, and this keeps the whole feature out of the editor's
// render path when the bridge is off (which is always, in normal use).

import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { currentRev, getChangesSince } from "./agentRevisions";

export interface CheckpointRequest {
  /** Where we are, e.g. "2/6 — exterior walls". */
  step: string;
  /** What the agent just did. */
  summary?: string;
  /** What the agent wants from the user. */
  ask?: string;
  /** Decision buttons. First is the primary action. */
  options?: string[];
}

export interface CheckpointDecision {
  decision: string;
  notes: string;
  /** How the answer arrived — the app card, or the chat client via elicitation. */
  via: "app" | "chat";
}

const DEFAULT_OPTIONS = ["continue", "redo step", "reject"];

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let resolveOpen: ((d: CheckpointDecision) => void) | null = null;

function unmount(): void {
  resolveOpen = null;
  const r = root;
  const h = host;
  root = null;
  host = null;
  // Defer: React 18 warns if a root is unmounted while it is rendering (we are inside an event handler).
  setTimeout(() => {
    r?.unmount();
    h?.remove();
  }, 0);
}

/** True while a checkpoint card is waiting on the user. */
export function isCheckpointOpen(): boolean {
  return resolveOpen != null;
}

/** Answer the open checkpoint from OUTSIDE the card — used when the user replied in the chat client
 *  (MCP elicitation) instead, so the card must close with that decision. No-op when none is open. */
export function resolveOpenCheckpoint(decision: string, notes = "", via: CheckpointDecision["via"] = "chat"): boolean {
  const r = resolveOpen;
  if (!r) return false;
  unmount();
  r({ decision, notes, via });
  return true;
}

/** Show the card and wait for the user. Resolves with their decision; never rejects. */
export function showCheckpoint(req: CheckpointRequest): Promise<CheckpointDecision> {
  // A new checkpoint supersedes a stale one (agent restarted mid-run) rather than stacking cards.
  resolveOpenCheckpoint("superseded", "a newer checkpoint replaced this one", "app");

  host = document.createElement("div");
  host.id = "bp-checkpoint-hud";
  document.body.appendChild(host);
  root = createRoot(host);

  return new Promise<CheckpointDecision>((resolve) => {
    resolveOpen = resolve;
    const answer = (decision: string, notes: string) => {
      const r = resolveOpen;
      if (!r) return;
      unmount();
      r({ decision, notes, via: "app" });
    };
    root?.render(<CheckpointCard req={req} onAnswer={answer} />);
  });
}

// ── The card ────────────────────────────────────────────────────────────────────────────────────────

const S = {
  shell: {
    position: "fixed", left: "50%", bottom: 24, transform: "translateX(-50%)", zIndex: 2147483000,
    width: "min(560px, calc(100vw - 32px))", boxSizing: "border-box",
    background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 12,
    boxShadow: "0 18px 50px rgba(0,0,0,.45)", padding: 14,
    font: '13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  },
  step: { fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "#38bdf8", fontWeight: 600 },
  summary: { marginTop: 6, color: "#cbd5e1" },
  ask: { marginTop: 8, color: "#f1f5f9", fontWeight: 500 },
  edits: { marginTop: 10, padding: "6px 8px", borderRadius: 8, background: "#172554", border: "1px solid #1e40af", color: "#bfdbfe", fontSize: 12 },
  box: {
    marginTop: 10, width: "100%", boxSizing: "border-box", minHeight: 52, resize: "vertical",
    background: "#1e293b", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 8, padding: "7px 9px",
    font: "inherit", outline: "none",
  },
  row: { marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
  hint: { marginLeft: "auto", fontSize: 11, color: "#64748b" },
} satisfies Record<string, React.CSSProperties>;

function button(primary: boolean): React.CSSProperties {
  return {
    padding: "7px 13px", borderRadius: 8, cursor: "pointer", font: "inherit", fontWeight: 600,
    border: primary ? "1px solid #0284c7" : "1px solid #475569",
    background: primary ? "#0284c7" : "transparent",
    color: primary ? "#f8fafc" : "#cbd5e1",
  };
}

function CheckpointCard({ req, onAnswer }: { req: CheckpointRequest; onAnswer: (decision: string, notes: string) => void }) {
  const [notes, setNotes] = useState("");
  // Revision at the moment the card opened — everything after it is the user's review edit.
  const [openedAt] = useState(() => currentRev());
  const [edits, setEdits] = useState(0);

  // Poll rather than subscribe: the revision log is written from a React effect in the editor, and a
  // 600 ms tick is plenty to keep a "3 edits" counter honest without another cross-tree wiring.
  useEffect(() => {
    const id = setInterval(() => {
      const since = getChangesSince(openedAt);
      setEdits(since.revisions.filter((r) => r.source === "user").length);
    }, 600);
    return () => clearInterval(id);
  }, [openedAt]);

  const options = req.options?.length ? req.options : DEFAULT_OPTIONS;

  return (
    <div style={S.shell}>
      <div style={S.step}>⏸ checkpoint · {req.step}</div>
      {req.summary ? <div style={S.summary}>{req.summary}</div> : null}
      <div style={S.ask}>{req.ask ?? "Edit on canvas or type a note, then choose:"}</div>
      {edits > 0 ? (
        <div style={S.edits}>
          ✎ {edits} edit{edits === 1 ? "" : "s"} of yours captured — they go back to the agent with your answer.
        </div>
      ) : null}
      <textarea
        style={S.box}
        autoFocus
        placeholder="Notes for the agent (optional) — e.g. “north wall is 200 mm too far out”"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onAnswer(options[0], notes.trim());
        }}
      />
      <div style={S.row}>
        {options.map((o, i) => (
          <button key={o} style={button(i === 0)} onClick={() => onAnswer(o, notes.trim())}>
            {o}
          </button>
        ))}
        <span style={S.hint}>⌘/Ctrl+Enter = {options[0]}</span>
      </div>
    </div>
  );
}
