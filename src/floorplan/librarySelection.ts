/**
 * The Library selection — R2 files ticked in the navigator. Ticking IS the selection: nothing is loaded
 * onto the canvas; the chat agent reads what is here when a message is sent. Per TAB (sessionStorage): a new
 * tab starts with nothing ticked, so the chat starts from scratch; a reload of the same tab keeps the ticks.
 *
 * Behaviour is by folder (`kindOf`): a Skill's text becomes agent instructions; small text/JSON files
 * (objects, workflows, designs, materials …) go in as their contents; anything else (images, .glb,
 * .blend, big files) is handed over as a path + public URL.
 */
import { useSyncExternalStore } from "react";
import { fetchBucketFileText, fetchCloudTree, type CloudTreeNode } from "./cloudLibrary";

export type SelKind = "skill" | "object" | "tool" | "design" | "material" | "moodboard" | "asset" | "file";

export interface SelItem {
  /** Full bucket key ("library/Skills/Flow/flow-spine.md"). */
  key: string;
  size: number;
  url?: string;
  kind: SelKind;
}

export const KIND_LABEL: Record<SelKind, string> = {
  skill: "Skills", object: "Objects", tool: "Tools & workflows", design: "Designs", material: "Materials",
  moodboard: "Moodboards", asset: "Images & models", file: "Other files",
};
export const KIND_ORDER: SelKind[] = ["skill", "object", "tool", "design", "material", "moodboard", "asset", "file"];

/** Folder → behaviour. The second path segment under `library/` decides it. */
export function kindOf(key: string): SelKind {
  const top = key.replace(/^library\//, "").split("/")[0].toLowerCase();
  if (top === "skills") return "skill";
  if (top === "objects" || top === "photometry") return "object";
  if (top === "workflows" || top === "tools") return "tool";
  if (top === "designs" || top === "master plans") return "design";
  if (top === "materials") return "material";
  if (top === "moodboards") return "moodboard";
  if (/\.(png|jpe?g|webp|gif|pdf|glb|gltf|blend|obj|fbx|skp|dwg|dxf|zip)$/i.test(key)) return "asset";
  return "file";
}

const KEY = "bp.editor.librarySelection";
const listeners = new Set<() => void>();
function read(): SelItem[] {
  try { localStorage.removeItem(KEY); } catch { /* older builds kept the ticks forever in localStorage */ }
  try { const v = JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
}
let current: SelItem[] = read();
function commit(next: SelItem[]) {
  current = next;
  try { sessionStorage.setItem(KEY, JSON.stringify(next)); } catch { /* in-memory only */ }
  listeners.forEach((l) => l());
}

export function useLibrarySelection(): SelItem[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => current);
}

/** Every file under a tree node (the node itself when it is a file). */
export function filesUnder(node: CloudTreeNode): CloudTreeNode[] {
  if (node.type === "file") return [node];
  return (node.children ?? []).flatMap(filesUnder);
}

/** Tick / untick a file or a whole folder. A folder ticks all its files; if they all are ticked already, it
 *  unticks them all. */
export function toggleSelection(node: CloudTreeNode) {
  const files = filesUnder(node);
  const have = new Set(current.map((i) => i.key));
  const allOn = files.length > 0 && files.every((f) => have.has(f.path));
  if (allOn) {
    const drop = new Set(files.map((f) => f.path));
    commit(current.filter((i) => !drop.has(i.key)));
  } else {
    const add = files.filter((f) => !have.has(f.path)).map((f): SelItem => ({ key: f.path, size: f.size ?? 0, url: f.url, kind: kindOf(f.path) }));
    commit([...current, ...add]);
  }
}
export function removeSelection(keys: string[]) {
  const drop = new Set(keys);
  commit(current.filter((i) => !drop.has(i.key)));
}
export function clearSelection() { commit([]); }

/** The selection as Library-relative items — what the MCP side sees. */
export function selectionForAgent(items: SelItem[] = current) {
  return items.map((i) => ({ path: i.key.replace(/^library\//, ""), kind: i.kind, size: i.size, ...(i.url ? { url: i.url } : {}) }));
}

/** set_library_selection: tick / untick Library-relative paths (files or folders). Folders are expanded with
 *  the bucket listing; a path the listing cannot resolve is ticked as a single file. */
export async function setSelectionByPaths(add: string[] = [], remove: string[] = [], clear = false) {
  const full = (p: string) => `library/${p.replace(/^\/+|\/+$/g, "").replace(/^library\//, "")}`;
  let next = clear ? [] : [...current];
  const resolve = async (p: string): Promise<SelItem[]> => {
    const key = full(p);
    const { tree } = await fetchCloudTree(`${key}/`);
    const files = tree ? filesUnder(tree.tree).filter((f) => f.path.startsWith(`${key}/`)) : [];
    if (files.length) return files.map((f) => ({ key: f.path, size: f.size ?? 0, url: f.url, kind: kindOf(f.path) }));
    // Not a folder: find the file in its parent's listing, for its size and public URL.
    const parent = key.slice(0, key.lastIndexOf("/") + 1);
    const { tree: pt } = await fetchCloudTree(parent);
    const hit = pt ? filesUnder(pt.tree).find((f) => f.path === key) : undefined;
    return [{ key, size: hit?.size ?? 0, url: hit?.url, kind: kindOf(key) }];
  };
  for (const p of remove) {
    const k = full(p);
    next = next.filter((i) => i.key !== k && !i.key.startsWith(`${k}/`));
  }
  const have = new Set(next.map((i) => i.key));
  for (const p of add) for (const it of await resolve(p)) if (!have.has(it.key)) { next.push(it); have.add(it.key); }
  commit(next);
  return selectionForAgent(next);
}

/** "all" | "some" | "none" for a row's checkbox. */
export function selectionState(node: CloudTreeNode, selected: Set<string>): "all" | "some" | "none" {
  const files = filesUnder(node);
  if (!files.length) return "none";
  const n = files.filter((f) => selected.has(f.path)).length;
  return n === 0 ? "none" : n === files.length ? "all" : "some";
}

/** What the agent may be handed in one message. Past it, files go over as paths only. */
export const CONTEXT_BUDGET = 300_000;
const INLINE_MAX = 60_000;
const isText = (k: string) => /\.(md|txt|json|csv|ya?ml|mjs|js|ts|py|xml|svg|inp)$/i.test(k);

/** The block appended to the agent's system prompt for this send. */
export async function buildSelectionContext(items: SelItem[]): Promise<{ text: string; inlined: number; listed: number }> {
  if (!items.length) return { text: "", inlined: 0, listed: 0 };
  const rel = (k: string) => k.replace(/^library\//, "");
  let used = 0, inlined = 0;
  const skills: string[] = [], files: string[] = [], refs: string[] = [];
  // Skills first — they are instructions, so they get the budget before anything else.
  const ordered = [...items].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  for (const it of ordered) {
    const canInline = isText(it.key) && it.size <= INLINE_MAX && used + it.size <= CONTEXT_BUDGET;
    if (canInline) {
      const r = await fetchBucketFileText(it.key);
      if (r.ok && r.text != null) {
        used += r.text.length; inlined++;
        (it.kind === "skill" ? skills : files).push(`=== ${rel(it.key)} ===\n${r.text}`);
        continue;
      }
    }
    refs.push(`- ${rel(it.key)} (${KIND_LABEL[it.kind]}, ${Math.round(it.size / 1024)} KB)${it.url ? ` — ${it.url}` : ""}`);
  }
  const parts: string[] = ["\n\nLIBRARY SELECTION — the user ticked these Library items for this conversation. Use them; do not load anything onto the canvas unless the user asks."];
  if (skills.length) parts.push(`\nSKILLS (follow these instructions):\n${skills.join("\n\n")}`);
  if (files.length) parts.push(`\nFILES (contents):\n${files.join("\n\n")}`);
  if (refs.length) parts.push(`\nREFERENCED FILES (too large or binary to include — paths and links only):\n${refs.join("\n")}`);
  return { text: parts.join("\n"), inlined, listed: refs.length };
}
