/**
 * Moodboards on the plan — the bridge between a `moodboard/1` board (every option, in the Library at
 * `Moodboards/<id>.json`) and the plan's `moodboards` key (only what was picked).
 *
 * The board is the MENU; the plan keeps the ORDER. Import opens the board in the picker
 * (public/moodboard-picker.html, the same page as the R2 skill's) with the plan's earlier picks merged
 * back in, and `selectionFromBoard` turns what comes back into a {@link MoodboardSelection}.
 */
import type { MoodboardPick, MoodboardSelection, Room } from "./types";

/** The parts of a `moodboard/1` file this module reads. Everything else is carried through untouched. */
export interface MoodboardFile {
  schema: "moodboard/1";
  id: string;
  title?: string;
  rooms: {
    roomKey: string;
    label?: string;
    bind?: { roomType?: string; spaceNames?: string[]; spaceId?: string | null };
    selection?: { optionId?: string | null; status?: string; by?: string | null; note?: string | null; at?: string };
    references: { id: string; src: string; takeaway?: string; tags?: string[]; palette?: string[] }[];
    [k: string]: unknown;
  }[];
  [k: string]: unknown;
}

export function isMoodboardFile(v: unknown): v is MoodboardFile {
  const o = v as MoodboardFile | null;
  return !!o && o.schema === "moodboard/1" && typeof o.id === "string" && Array.isArray(o.rooms);
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/** Space ids this board room applies to. Order of trust: the board's pinned `spaceId`, then a space
 *  whose LABEL contains one of `spaceNames` as whole words ("MB. TOILET" ⊃ "TOILET"), then — only when
 *  no name matched — the `roomType` slug. Unlabelled, unmatched spaces are simply not bound; the caller
 *  reports how many picks found no space rather than guessing one. */
export function matchSpaces(bind: MoodboardFile["rooms"][number]["bind"], rooms: Room[]): string[] {
  if (!bind) return [];
  if (bind.spaceId && rooms.some((r) => r.id === bind.spaceId)) return [bind.spaceId];
  const names = (bind.spaceNames ?? []).map(norm).filter(Boolean);
  const byName = rooms.filter((r) => {
    const label = r.label ? ` ${norm(r.label)} ` : "";
    return label && names.some((n) => label.includes(` ${n} `));
  });
  if (byName.length) return byName.map((r) => r.id);
  if (!bind.roomType) return [];
  return rooms.filter((r) => r.roomType === bind.roomType).map((r) => r.id);
}

/** Picked rooms of a board (as returned by the picker) → the entry stored on the plan. Rooms left
 *  `open` are not stored: an undecided room is the absence of a pick, not a pick. */
export function selectionFromBoard(board: MoodboardFile, source: string, rooms: Room[]): MoodboardSelection {
  const picks: MoodboardPick[] = [];
  for (const r of board.rooms) {
    const sel = r.selection;
    if (!sel?.optionId || (sel.status !== "locked" && sel.status !== "shortlisted")) continue;
    const opt = r.references.find((o) => o.id === sel.optionId);
    if (!opt) continue;
    picks.push({
      roomKey: r.roomKey,
      ...(r.label ? { label: r.label } : {}),
      spaces: matchSpaces(r.bind, rooms),
      status: sel.status,
      optionId: opt.id,
      image: opt.src,
      ...(opt.takeaway ? { takeaway: opt.takeaway } : {}),
      ...(opt.tags?.length ? { tags: opt.tags } : {}),
      ...(opt.palette?.length ? { palette: opt.palette } : {}),
      ...(sel.note ? { note: sel.note } : {}),
      ...(sel.by ? { by: sel.by } : {}),
      ...(sel.at ? { at: sel.at } : {}),
    });
  }
  return { id: board.id, ...(board.title ? { title: board.title } : {}), source, selectedAt: new Date().toISOString(), picks };
}

/** The board with the plan's earlier picks written back into `rooms[].selection`, so reopening the
 *  picker shows what was chosen last time. Picks whose option no longer exists in the board are
 *  dropped (the board was re-issued) — the caller counts them. */
export function mergePicksIntoBoard(board: MoodboardFile, prior: MoodboardSelection | undefined): { board: MoodboardFile; stale: number } {
  if (!prior) return { board, stale: 0 };
  let stale = 0;
  const byRoom = new Map(prior.picks.map((p) => [p.roomKey, p]));
  const rooms = board.rooms.map((r) => {
    const p = byRoom.get(r.roomKey);
    if (!p) return r;
    if (!r.references.some((o) => o.id === p.optionId)) { stale++; return r; }
    return { ...r, selection: { optionId: p.optionId, status: p.status, by: p.by ?? null, note: p.note ?? null, at: p.at } };
  });
  return { board: { ...board, rooms }, stale };
}

/** Replace the entry for this board id, keeping the others. An entry with no picks removes the board. */
export function upsertSelection(list: MoodboardSelection[] | undefined, next: MoodboardSelection): MoodboardSelection[] {
  const rest = (list ?? []).filter((m) => m.id !== next.id);
  return next.picks.length ? [...rest, next] : rest;
}
