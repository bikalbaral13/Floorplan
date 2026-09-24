// Plan revision log — the reverse channel of the agent bridge.
//
// The bridge (agentBridge.ts) carries commands agent → app. This module carries CHANGES back: every
// committed plan mutation is fingerprinted, diffed against the previous one, and appended to a capped log
// tagged `agent` or `user`. That tag is the whole point — it is how a stepwise agent tells "the wall I
// drew" from "the wall the user just moved", so the next step can respect the user's edit instead of
// overwriting it. Read it over the bridge with `get_changes_since`.
//
// Attribution works by a window, not by instrumenting every mutator: agentBridge marks the span of a tool
// call (begin/endAgentWrite), and a revision recorded inside that span — or shortly after it, since React
// commits a tick or two later — is the agent's. Everything else is the user's.
//
// Inert unless the bridge is enabled: nothing calls in.

import type { FloorPlanModel, Point } from "./types";

export type ChangeSource = "agent" | "user";
export type EntityKind = "wall" | "room" | "object" | "furniture";

/** One entity that appeared, vanished or changed between two revisions. */
export interface EntityChange {
  kind: EntityKind;
  id: string;
  /** Short human/model-readable description — geometry in METRES, matching the bridge's tool coordinates. */
  desc: string;
  /** For `modified` only: what the entity looked like at the previous revision. */
  before?: string;
  /** For `modified` only: which properties actually changed. Without this a settle-up write (the editor
   *  assigning `layerId` a tick after the insert) is indistinguishable from the user dragging the wall —
   *  both read as "~1 wall" with an identical before/after description. */
  fields?: string[];
}

/** One committed plan mutation. */
export interface PlanRevision {
  rev: number;
  /** ms since epoch. */
  at: number;
  source: ChangeSource;
  /** Bridge tool that produced it (agent-sourced revisions only). */
  tool?: string;
  added: EntityChange[];
  removed: EntityChange[];
  modified: EntityChange[];
  /** One-line roll-up, e.g. `user: +2 walls, ~1 wall`. */
  summary: string;
}

/** Entity fingerprint: a whole-entity hash for change detection, a per-property hash so we can name what
 *  changed, and the description we report. Hashes only — entities themselves are never retained. */
interface Fingerprint { h: number; desc: string; props: Record<string, number> }

const MAX_LOG = 400;

let rev = 0;
let log: PlanRevision[] = [];
let prints: Map<string, Fingerprint> | null = null;

// ── Agent-write attribution window ──────────────────────────────────────────────────────────────────
// `depth` covers the synchronous span of a bridge tool call; `lastEndedAt` extends it by GRACE_MS so the
// React commit that lands AFTER the handler resolved is still attributed to the agent that caused it.
let depth = 0;
let lastEndedAt = 0;
let currentTool: string | undefined;
const GRACE_MS = 1500;

/** Mark the start of an agent-driven mutation span (one bridge tool call). */
export function beginAgentWrite(tool: string): void {
  depth += 1;
  currentTool = tool;
}

/** Close the span opened by {@link beginAgentWrite}. */
export function endAgentWrite(): void {
  depth = Math.max(0, depth - 1);
  if (depth === 0) lastEndedAt = Date.now();
}

/** Run `fn` with agent attribution SUSPENDED, so plan changes during it count as the user's.
 *  Wraps the wait inside a blocking tool (the checkpoint HUD) — that tool call is the agent's, but the
 *  edits the user makes while it sits open are emphatically not. */
export async function asUserInteraction<T>(fn: () => Promise<T>): Promise<T> {
  const savedDepth = depth;
  const savedTool = currentTool;
  depth = 0;
  lastEndedAt = 0;
  currentTool = undefined;
  try {
    return await fn();
  } finally {
    depth = savedDepth;
    currentTool = savedTool;
    lastEndedAt = 0; // the agent's own span resumes from here; nothing to back-date
  }
}

function attribution(): { source: ChangeSource; tool?: string } {
  if (depth > 0) return { source: "agent", tool: currentTool };
  if (lastEndedAt && Date.now() - lastEndedAt < GRACE_MS) return { source: "agent", tool: currentTool };
  return { source: "user" };
}

// ── Fingerprinting ──────────────────────────────────────────────────────────────────────────────────

/** FNV-1a over a string — cheap, stable, and we only keep the 32-bit result per entity. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Plan coordinates are PIXELS; the bridge's tools speak METRES, so descriptions do too. */
const m = (px: number, ppm: number): string => (px / (ppm || 50)).toFixed(2);
const pt = (p: Point | undefined, ppm: number): string => (p ? `${m(p.x, ppm)},${m(p.y, ppm)}` : "?");

/** Fingerprint one entity: a hash of the whole thing (so a nested edit is never missed) plus one hash per
 *  top-level property (so we can say which ones moved). */
function print(entity: object, desc: string): Fingerprint {
  const props: Record<string, number> = {};
  for (const [k, v] of Object.entries(entity)) props[k] = hash(JSON.stringify(v ?? null));
  return { h: hash(JSON.stringify(entity)), desc, props };
}

/** Top-level keys whose values differ between two fingerprints (added and removed keys included). */
function changedProps(a: Fingerprint, b: Fingerprint): string[] {
  const keys = new Set([...Object.keys(a.props), ...Object.keys(b.props)]);
  return [...keys].filter((k) => a.props[k] !== b.props[k]).sort();
}

/** Canvas objects are a `kind`-discriminated union, and the point-list kinds (freehand, polygon, segment,
 *  dimension) carry their geometry in `points` while `x`/`y` stay at the placement origin — describing
 *  those by x/y alone reports every freehand stroke as "object @(0.00,0.00)". Describe each kind by what
 *  actually locates it. */
function describeObject(o: FloorPlanModel["objects"][number], ppm: number): string {
  const at = `@(${m(o.x, ppm)},${m(o.y, ppm)})`;
  switch (o.kind) {
    case "rect": return `rect ${m(o.width, ppm)}×${m(o.height, ppm)}m ${at}`;
    case "circle": return `circle r=${m(o.radius, ppm)}m ${at}`;
    case "text": return `text "${o.text.slice(0, 40)}" ${at}`;
    default: {
      // points is a flat [x0,y0,x1,y1,…] in world px, relative to the object's origin.
      const p = (o as { points?: number[] }).points ?? [];
      if (p.length < 2) return `${o.kind} ${at}`;
      const xs = p.filter((_, i) => i % 2 === 0);
      const ys = p.filter((_, i) => i % 2 === 1);
      const from = `${m(o.x + xs[0], ppm)},${m(o.y + ys[0], ppm)}`;
      const to = `${m(o.x + xs[xs.length - 1], ppm)},${m(o.y + ys[ys.length - 1], ppm)}`;
      const span = `${m(Math.max(...xs) - Math.min(...xs), ppm)}×${m(Math.max(...ys) - Math.min(...ys), ppm)}m`;
      return `${o.kind} (${from})→(${to}) ${xs.length} pts, ${span}`;
    }
  }
}

function fingerprints(model: FloorPlanModel, ppm: number): Map<string, Fingerprint> {
  const out = new Map<string, Fingerprint>();

  for (const w of model.walls ?? []) {
    const type = w.segmentType ?? "wall";
    const openings = w.attachments?.length ? ` +${w.attachments.length} attached` : "";
    const desc = `${type} (${pt(w.start, ppm)})→(${pt(w.end, ppm)}) t=${m(w.thickness, ppm)}m${openings}`;
    out.set(`wall:${w.id}`, print(w, desc));
  }

  for (const r of model.rooms ?? []) {
    const label = (r as { name?: string }).name ?? r.id;
    const kind = (r as { roomType?: string }).roomType ?? "room";
    out.set(`room:${r.id}`, print(r, `${kind} "${label}" (${r.points?.length ?? 0} pts)`));
  }

  for (const o of model.objects ?? []) {
    out.set(`object:${o.id}`, print(o, describeObject(o, ppm)));
  }

  for (const f of model.furniture ?? []) {
    out.set(`furniture:${f.id}`, print(f, `${f.type} @(${m(f.x, ppm)},${m(f.y, ppm)}) rot=${Math.round(f.rotation ?? 0)}°`));
  }

  return out;
}

function splitKey(key: string): { kind: EntityKind; id: string } {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as EntityKind, id: key.slice(i + 1) };
}

function rollUp(source: ChangeSource, tool: string | undefined, r: Omit<PlanRevision, "summary">): string {
  const tally = (list: EntityChange[], sign: string): string[] => {
    const byKind = new Map<string, number>();
    for (const c of list) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    return [...byKind].map(([k, n]) => `${sign}${n} ${k}${n === 1 ? "" : "s"}`);
  };
  const parts = [...tally(r.added, "+"), ...tally(r.removed, "-"), ...tally(r.modified, "~")];
  return `${source}${tool ? ` (${tool})` : ""}: ${parts.join(", ") || "no entity change"}`;
}

// ── Public API ──────────────────────────────────────────────────────────────────────────────────────

/** Current revision number. Pass it to {@link getChangesSince} later to learn what happened in between. */
export function currentRev(): number {
  return rev;
}

/** Fingerprint `model`, diff it against the previous call, and append a revision when anything changed.
 *  Call once per committed plan state (a `useEffect` on the history state). Returns the new revision, or
 *  null when the state is identical to the last one (React re-renders that changed no entity). */
export function recordRevision(model: FloorPlanModel, pixelsPerMeter = 50): PlanRevision | null {
  const next = fingerprints(model, pixelsPerMeter);

  // First call seeds the baseline — there is no "before" to diff against, so it is not a change.
  if (!prints) {
    prints = next;
    return null;
  }

  const added: EntityChange[] = [];
  const removed: EntityChange[] = [];
  const modified: EntityChange[] = [];

  for (const [key, fp] of next) {
    const prev = prints.get(key);
    if (!prev) added.push({ ...splitKey(key), desc: fp.desc });
    else if (prev.h !== fp.h) modified.push({ ...splitKey(key), desc: fp.desc, before: prev.desc, fields: changedProps(prev, fp) });
  }
  for (const [key, fp] of prints) {
    if (!next.has(key)) removed.push({ ...splitKey(key), desc: fp.desc });
  }

  prints = next;
  if (!added.length && !removed.length && !modified.length) return null;

  const { source, tool } = attribution();
  const entry: PlanRevision = {
    rev: ++rev,
    at: Date.now(),
    source,
    ...(tool ? { tool } : {}),
    added,
    removed,
    modified,
    summary: "",
  };
  entry.summary = rollUp(source, tool, entry);

  log.push(entry);
  if (log.length > MAX_LOG) log = log.slice(-MAX_LOG);
  return entry;
}

export interface ChangesSince {
  /** The revision number as of now — pass this back as `rev` next time. */
  rev: number;
  /** The revision the caller asked from. */
  fromRev: number;
  revisions: PlanRevision[];
  /** True when revisions older than `fromRev + 1` had already aged out of the capped log. */
  truncated: boolean;
  totals: { added: number; removed: number; modified: number; byUser: number; byAgent: number };
}

/** Every revision after `fromRev`, newest last. `limit` caps how many are returned (newest kept). */
export function getChangesSince(fromRev = 0, limit = 50): ChangesSince {
  const after = log.filter((e) => e.rev > fromRev);
  const truncated = fromRev > 0 && log.length > 0 && log[0].rev > fromRev + 1;
  const revisions = after.slice(-Math.max(1, limit));
  const totals = { added: 0, removed: 0, modified: 0, byUser: 0, byAgent: 0 };
  for (const e of after) {
    totals.added += e.added.length;
    totals.removed += e.removed.length;
    totals.modified += e.modified.length;
    if (e.source === "user") totals.byUser += 1;
    else totals.byAgent += 1;
  }
  return { rev, fromRev, revisions, truncated, totals };
}

/** Flatten the user-made entity changes after `fromRev` — the payload a checkpoint hands back to the
 *  agent so the next step builds on what the user did by hand. */
export function userEditsSince(fromRev: number): Array<EntityChange & { op: "added" | "removed" | "modified"; rev: number }> {
  const out: Array<EntityChange & { op: "added" | "removed" | "modified"; rev: number }> = [];
  for (const e of log) {
    if (e.rev <= fromRev || e.source !== "user") continue;
    for (const c of e.added) out.push({ ...c, op: "added", rev: e.rev });
    for (const c of e.removed) out.push({ ...c, op: "removed", rev: e.rev });
    for (const c of e.modified) out.push({ ...c, op: "modified", rev: e.rev });
  }
  return out;
}
