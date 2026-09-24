/**
 * Artifact discovery — what the harness verifies.
 *
 * Everything shipped in `public/Library` that the app EVALUATES: parametric objects (`Objects/`) and flow
 * graphs (`Workflows/`). Discovery walks the disk rather than reading a manifest on purpose: the harness
 * should cover what actually ships, so a file added by an agent is picked up without anyone remembering to
 * register it (and shows up as a NEW baseline, which is the signal you want).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export type ArtifactKind = "object" | "flow";

export interface Artifact {
  kind: ArtifactKind;
  /** Path relative to the repo root, POSIX separators — the stable identity used for baseline filenames. */
  id: string;
  absPath: string;
  text: string;
  json: unknown;
  /** Set when the file isn't parseable JSON; such an artifact still gets a baseline recording the failure,
   *  so a corrupt file can never pass silently. */
  parseError?: string;
}

const OBJECT_DIR = join("public", "Library", "Objects");
const FLOW_DIR = join("public", "Library", "Workflows");

const walk = (dir: string, out: string[] = []): string[] => {
  let entries: ReturnType<typeof readdirSync>;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
};

const toId = (root: string, abs: string): string => relative(root, abs).split(sep).join("/");

const load = (root: string, abs: string, kind: ArtifactKind): Artifact => {
  const text = readFileSync(abs, "utf8");
  try {
    return { kind, id: toId(root, abs), absPath: abs, text, json: JSON.parse(text) };
  } catch (e) {
    return { kind, id: toId(root, abs), absPath: abs, text, json: null, parseError: (e as Error).message };
  }
};

export const discover = (repoRoot: string): Artifact[] => {
  const objects = walk(join(repoRoot, OBJECT_DIR)).map((p) => load(repoRoot, p, "object"));
  const flows = walk(join(repoRoot, FLOW_DIR)).map((p) => load(repoRoot, p, "flow"));
  // Sorted so a run's output order is stable regardless of filesystem ordering.
  return [...objects, ...flows].sort((a, b) => (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind.localeCompare(b.kind)));
};

/**
 * Object id → definition text, for `ref` rules that compose one object out of others. Built from EVERY
 * discovered object file (keyed on `meta.id`), which is what the app's own library resolver does — without
 * it, any composed object would evaluate to a hollow shell and its baseline would record that as normal.
 */
export const buildResolver = (artifacts: Artifact[]): ((id: string) => string | null) => {
  const byId = new Map<string, string>();
  for (const a of artifacts) {
    if (a.kind !== "object" || !a.json) continue;
    const meta = (a.json as { meta?: { id?: unknown } }).meta;
    if (meta && typeof meta.id === "string" && meta.id) byId.set(meta.id, a.text);
  }
  return (id: string) => byId.get(id) ?? null;
};

export const isDir = (p: string): boolean => {
  try { return statSync(p).isDirectory(); } catch { return false; }
};
