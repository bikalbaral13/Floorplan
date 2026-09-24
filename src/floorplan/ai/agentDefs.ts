import { listLibraryFiles, listWorkflowFiles, fetchLibraryJson } from "../libraryFiles";
import { loadLibrarySkills, composeSkillSection, type SkillDefinition } from "./skillDefs";

/** A resource grant on an agent — which parametric objects / flows / designs / AGENTS it may touch.
 *  `mode`: "all" = unrestricted, "allow" = only the listed items, "none" = no access. */
export interface AgentResourceGrant {
  mode: "all" | "allow" | "none";
  categories?: string[];
  ids?: string[];
  /** Whole flow graphs, Workflows-relative ("Vectorisation/detect_doors.json"). An entry ending in
   *  `/` or `/*` is a FOLDER — every flow in it, resolved to the real files at load time by
   *  {@link resolveFlowFolders}, so a file dropped in the folder is granted without editing the agent. */
  workflows?: string[];
  /** Individual flow node types the agent may use (tool names, e.g. "inset", "split"). */
  nodes?: string[];
  /** Whole flow-node folders the agent may use (e.g. "Reshape", "Partition"). */
  nodeCategories?: string[];
  paths?: string[];
  /** Agent ids / names / labels this agent may DELEGATE to (see accessibleAgents). */
  agents?: string[];
}

/** One agent definition, loaded from a `Agents/<id>.agent.json` file in the shared Library.
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
  /** The system prompt actually used: the file's own instructions with the agent's SKILLS composed in
   *  (see {@link resolveAgentSkills}). A selected agent's instructions REPLACE the built-in prompt, so
   *  this is what the model sees. */
  instructions: string;
  /** The file's `instructions` field verbatim — persona + routing only, before skills were appended.
   *  Kept so a re-compose (or an export back to disk) doesn't duplicate the skill text. */
  baseInstructions?: string;
  /** Skill ids (files under the Library's Skills/ folder) whose judgement this agent works by. Each is
   *  authored once and shared by every agent that names it. */
  skills?: string[];
  /** Tool names (from the tool registry) this agent may call. */
  accessibleTools: string[];
  /** Which agents this one may DELEGATE to — only meaningful when it holds the delegation tools.
   *  Enforced in the host's listAgents / runAgent (the caller itself is never in its own roster).
   *  Absent = "all" for a delegating agent, which is also what the roster falls back to. */
  accessibleAgents?: AgentResourceGrant;
  accessibleParametricObjects?: AgentResourceGrant;
  accessibleFlows?: AgentResourceGrant;
  accessibleDesigns?: AgentResourceGrant;
  examples?: string[];
  /** Library-relative source path, set on load (e.g. "Agents/floorplan-generation.v1.agent.json"). */
  sourcePath?: string;
}

/** Bundled agent file names under Agents/ — the fallback when neither the bucket nor the dev bridge
 *  can list the folder (production build). Keep in sync with the files in that folder. */
export const BUNDLED_AGENT_FILES: string[] = [
  "Orchestration.agent.json",
  "Design.agent.json",
  "floorplan-generation.v1.agent.json",
  "flow-builder.v1.agent.json",
  "Vectorisation.agent.json",
  "Render.agent.json",
];

/** Every `.json` under the Library's Agents/ folder (bucket first, dev bridge second), else the bundled manifest. */
export async function listAgentFiles(): Promise<string[]> {
  const listed = await listLibraryFiles("Agents");
  return listed?.length ? listed.filter((f) => f.toLowerCase().endsWith(".json")) : BUNDLED_AGENT_FILES;
}

/** Compose each agent's named skills into its instructions. The library is read ONCE for the whole
 *  batch. An agent with no `skills` is returned untouched, so pre-skill agent files keep working. */
export async function resolveAgentSkills(
  agents: AgentDefinition[],
  preloaded?: Map<string, SkillDefinition>,
): Promise<AgentDefinition[]> {
  /** Skill ids from a hand-edited file, defensively — anything but an array of strings reads as none. */
  const idsOf = (a: AgentDefinition): string[] =>
    Array.isArray(a.skills) ? a.skills.filter((s): s is string => typeof s === "string" && !!s.trim()) : [];
  if (!agents.some((a) => idsOf(a).length)) return agents;
  let skills: Map<string, SkillDefinition>;
  try {
    skills = preloaded ?? (await loadLibrarySkills());
  } catch {
    return agents; // library unreachable — fall back to the agents' own instructions
  }
  return agents.map((a) => {
    const ids = idsOf(a);
    if (!ids.length) return a;
    const base = a.baseInstructions ?? a.instructions;
    const section = composeSkillSection(ids, skills);
    return { ...a, baseInstructions: base, instructions: base + section };
  });
}

/** Expand FOLDER entries in `accessibleFlows.workflows` ("Vectorisation/" = every flow in that folder)
 *  into the files actually on disk, so dropping a new flow into the folder grants it without touching
 *  the agent file. The Workflows folder is listed ONCE for the whole batch. When the library bridge is
 *  unavailable (production build — no directory listing) the folder entry is left exactly as written,
 *  which still reads correctly in the panel. */
export async function resolveFlowFolders(agents: AgentDefinition[]): Promise<AgentDefinition[]> {
  const isFolder = (s: string) => /[/*]$/.test(s.trim());
  const folderOf = (a: AgentDefinition) => (a.accessibleFlows?.workflows ?? []).some(isFolder);
  if (!agents.some(folderOf)) return agents;
  let files: string[] | null;
  try {
    files = await listWorkflowFiles();
  } catch {
    return agents;
  }
  const all = (files ?? []).filter((f) => f.toLowerCase().endsWith(".json"));
  if (!all.length) return agents;
  return agents.map((a) => {
    if (!folderOf(a)) return a;
    const out: string[] = [];
    for (const entry of a.accessibleFlows!.workflows!) {
      if (!isFolder(entry)) { out.push(entry); continue; }
      const dir = entry.trim().replace(/\*+$/, "").toLowerCase();
      const hits = all.filter((f) => f.toLowerCase().startsWith(dir));
      // A folder that matched nothing keeps its own line — better than silently showing no access.
      out.push(...(hits.length ? hits : [entry]));
    }
    return { ...a, accessibleFlows: { ...a.accessibleFlows!, workflows: [...new Set(out)] } };
  });
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
      const parsed = await fetchLibraryJson<unknown>(`Agents/${bare}`);
      if (parsed == null) continue;
      if (isAgentDefinition(parsed)) loaded.push({ ...parsed, sourcePath: `Agents/${bare}` });
    } catch { /* skip unreadable / invalid file */ }
  }
  const byId = new Map<string, AgentDefinition>();
  for (const a of loaded) byId.set(a.id, a);
  const agents = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  return resolveAgentSkills(await resolveFlowFolders(agents));
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
  return { agents: await resolveAgentSkills(await resolveFlowFolders(agents)), skipped };
}

/** Flatten a grant into human-readable display rows for the panel (mode-aware). */
export function grantItems(grant: AgentResourceGrant | undefined, kind: "objects" | "flows" | "designs" | "agents"): string[] {
  if (!grant) return [];
  if (kind === "agents") return grant.agents ?? [];
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
