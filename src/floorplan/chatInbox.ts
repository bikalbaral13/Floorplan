/**
 * The editor's Chat box as an INBOX for Claude Code. With the engine set to Claude, a sent prompt is queued
 * here instead of going to Gemini; the MCP tool `chat_wait_prompt` (chat.wait) takes it — resolving at once
 * when one is queued, else when the next one is sent — and `chat_reply` (chat.reply) posts back into the box.
 */
import { useSyncExternalStore } from "react";

export interface InboxPrompt {
  prompt: string;
  /** The navigator's ticked Library items at send time. */
  selection: { path: string; kind: string; size: number; url?: string }[];
  attachment?: string;
  sentAt: number;
}

const queue: InboxPrompt[] = [];
const waiters: ((p: InboxPrompt) => void)[] = [];
/** How many chat_wait_prompt calls are blocked right now — i.e. is Claude Code listening. */
let listening = 0;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function sendToInbox(p: InboxPrompt) {
  const w = waiters.shift();
  if (w) w(p);
  else queue.push(p);
  notify();
}

/** The handler behind chat_wait_prompt. */
export function waitForPrompt(): Promise<InboxPrompt> {
  const next = queue.shift();
  if (next) { notify(); return Promise.resolve(next); }
  listening++;
  notify();
  return new Promise((resolve) => {
    waiters.push((p) => { listening = Math.max(0, listening - 1); notify(); resolve(p); });
  });
}

export const inboxQueued = () => queue.length;

/* ── chat_ask (chat.ask): Claude Code asks the USER a question in the Chat box and waits for the answer.
 *  While a question is open, the next thing the user sends (typed, or a clicked option) is its answer —
 *  not a new prompt. One question at a time; a new one replaces an unanswered one. */
let pendingAsk: { resolve: (a: string) => void } | null = null;
export const hasPendingAsk = () => !!pendingAsk;

export function askUser(): Promise<string> {
  pendingAsk?.resolve("(superseded by a newer question)");
  return new Promise((resolve) => {
    pendingAsk = { resolve: (a) => { pendingAsk = null; notify(); resolve(a); } };
    notify();
  });
}

/** The user answered (typed or clicked an option). False when no question was open. */
export function answerAsk(answer: string): boolean {
  if (!pendingAsk) return false;
  pendingAsk.resolve(answer);
  return true;
}

/** { listening, queued } for the chat box's status line. */
export function useInboxStatus(): { listening: boolean; queued: number; asking: boolean } {
  const snap = useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => `${listening}|${queue.length}|${pendingAsk ? 1 : 0}`,
  );
  const [l, q, a] = snap.split("|").map(Number);
  return { listening: l > 0, queued: q, asking: a > 0 };
}
