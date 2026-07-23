import { listLibraryFiles } from "../libraryFiles";

/** A resource grant on an agent — which parametric objects / flows / designs it may touch.
 *  `mode`: "all" = unrestricted, "allow" = only the listed items, "none" = no access. */
export interface AgentResourceGrant {
  mode: "all" | "allow" | "none";
  categories?: string[];
  ids?: string[];
  workflows?: string[];
  /** Individual flow node types the agent may use (tool names, e.g. "inset", "split"). */
  nodes?: string[];
  /** Whole flow-node folders the agent may use (e.g. "Reshape", "Partition"). */
  nodeCategories?: string[];
  paths?: string[];
}

/** One agent definition, loaded from a `public/Library/Agents/<id>.agent.json` file.
 *  Mirror of the on-disk schema (see the bundled Agents files). */
export interface AgentDefinition {
  kind?: string;
  schemaVersion?: number;
  id: string;
  name: string;
  version?: string;
  /** Which tool-loop runs it: "canvas" (runAgentChat) or "flow" (runFlowAgent). */
  runner: "canvas" | "flow";
  label?: string;
  icon?: string;
  color?: string;
  description?: string;
  /** The system prompt / persona. */
  instructions: string;
  /** Tool names (from the tool registry) this agent may call. */
  accessibleTools: string[];
  accessibleParametricObjects?: AgentResourceGrant;
  accessibleFlows?: AgentResourceGrant;
  accessibleDesigns?: AgentResourceGrant;
  examples?: string[];
  /** Library-relative source path, set on load (e.g. "Agents/floorplan-generation.v1.agent.json"). */
  sourcePath?: string;
}

/** Bundled agent files shipped under public/Library/Agents — the fallback when the dev file bridge
 *  is unavailable (production build). Keep in sync with the files in that folder. */
export const BUNDLED_AGENT_FILES: string[] = [
  "floorplan-generation.v1.agent.json",
  "site-massing.v1.agent.json",
  "interior-furnishing.v1.agent.json",
  "structural-detailing.v1.agent.json",
  "flow-builder.v1.agent.json",
  "parametric-object-author.v1.agent.json",
];

/** Every `.json` under public/Library/Agents (via the dev bridge), else the bundled manifest. */
export async function listAgentFiles(): Promise<string[]> {
  const listed = await listLibraryFiles("Agents");
  return listed?.length ? listed.filter((f) => f.toLowerCase().endsWith(".json")) : BUNDLED_AGENT_FILES;
}

function isAgentDefinition(x: unknown): x is AgentDefinition {
  const a = x as AgentDefinition | null;
  return !!a && typeof a === "object"
    && typeof a.id === "string" && typeof a.name === "string" && typeof a.instructions === "string"
    && Array.isArray(a.accessibleTools) && (a.runner === "canvas" || a.runner === "flow");
}

/** Fetch + parse the given Agents-folder files (folder-relative paths from {@link listAgentFiles}).
 *  Invalid / unreadable files are skipped; duplicates by id keep the last; result is sorted by name. */
export async function loadAgentsFromPaths(rels: string[]): Promise<AgentDefinition[]> {
  const loaded: AgentDefinition[] = [];
  for (const rel of rels) {
    const bare = rel.replace(/^Agents\//i, "");
    try {
      const res = await fetch(encodeURI(`/Library/Agents/${bare}`));
      if (!res.ok) continue;
      const parsed: unknown = JSON.parse(await res.text());
      if (isAgentDefinition(parsed)) loaded.push({ ...parsed, sourcePath: `Agents/${bare}` });
    } catch { /* skip unreadable / invalid file */ }
  }
  const byId = new Map<string, AgentDefinition>();
  for (const a of loaded) byId.set(a.id, a);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Load + parse every agent definition from the Library/Agents folder. */
export async function loadLibraryAgents(): Promise<AgentDefinition[]> {
  return loadAgentsFromPaths(await listAgentFiles());
}

/** Read + parse agent definitions from user-selected files (the Import file dialog). Invalid / unreadable
 *  files are skipped and their names returned in `skipped` (for a toast). */
export async function readAgentFiles(files: FileList | File[]): Promise<{ agents: AgentDefinition[]; skipped: string[] }> {
  const agents: AgentDefinition[] = [];
  const skipped: string[] = [];
  for (const f of Array.from(files)) {
    try {
      const parsed: unknown = JSON.parse(await f.text());
      if (isAgentDefinition(parsed)) agents.push({ ...parsed, sourcePath: f.name });
      else skipped.push(f.name);
    } catch {
      skipped.push(f.name);
    }
  }
  return { agents, skipped };
}

/** Flatten a grant into human-readable display rows for the panel (mode-aware). */
export function grantItems(grant: AgentResourceGrant | undefined, kind: "objects" | "flows" | "designs"): string[] {
  if (!grant) return [];
  if (kind === "objects") return [
    ...(grant.categories ?? []).map((c) => `category: ${c}`),
    ...(grant.ids ?? []).map((i) => `id: ${i}`),
  ];
  if (kind === "flows") return [
    ...(grant.workflows ?? []),
    ...(grant.nodes ?? []).map((n) => `node: ${n}`),
    ...(grant.nodeCategories ?? []).map((c) => `nodes (category): ${c}`),
  ];
  return grant.paths ?? [];
}
