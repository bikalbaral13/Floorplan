/** Where a project's files live in R2 — the app's copy of pipeline_kit/projpaths.py (keep the two in step).
 *  Layout: R2 Projects/project_creation.md.
 *
 *    Projects/<CODE>/project.json                     the project manifest
 *    Projects/<CODE>/inputs/<kind>/                   what the user uploads (images, drawings, decks, designs, models)
 *    Projects/<CODE>/<n-phase>/<pipeline>/[<SUB>/]    one pipeline's folder: run.json, state.json, steps/, output/
 *    Projects/<CODE>/handoff/<phase>.json             what a finished phase hands the next one
 *    Projects/<CODE>/shared/                          the packed project canvas + revisions
 *    Projects/<CODE>/media/<kind>/                    client-facing renders, video, drawings
 *
 *  Anything made with no project open goes to Projects/_unassigned/. Nothing project-specific goes into library/. */

export const PHASE_DIRS = { program: "1-program", plan: "2-plan", build: "3-build", present: "4-present" } as const;
export type Phase = keyof typeof PHASE_DIRS;
export const UNASSIGNED = "_unassigned";
export type InputKind = "images" | "drawings" | "decks" | "designs" | "models" | "shared";
export type MediaKind = "renders" | "video" | "drawings";

const ALIASES: Record<string, Phase> = { design: "plan", "plan/design": "plan" };
const KNOWN: Record<string, Phase> = {
  program: "program", "floorplan-tracer": "program", "site-checklist": "program", "space-brief": "plan",
  "build-from-deck": "build", "walkthrough-video": "present",
};
/** Phases read from apps.json / pipeline.json at run time, for pipelines made later (pipelines.create). */
const declared = new Map<string, Phase>();

function asPhase(p?: string): Phase | undefined {
  const k = String(p ?? "").toLowerCase();
  return (ALIASES[k] ?? (k in PHASE_DIRS ? (k as Phase) : undefined));
}

/** Record a pipeline's phase as its registry declares it (apps.json `phase`). */
export function rememberPhase(pipeline: string, phase?: string) {
  const p = asPhase(phase);
  if (p) declared.set(pipeline, p);
}

export function phaseOf(pipeline: string, phase?: string): Phase {
  return asPhase(phase) ?? declared.get(pipeline) ?? KNOWN[pipeline] ?? "program";
}

/** A project code as a folder name: A–Z 0–9 _, max 40; empty → _unassigned. */
export function projectCode(raw: unknown): string {
  const c = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return c || UNASSIGNED;
}

export const projectRoot = (code: string) => `Projects/${code}/`;
export const manifestKey = (code: string) => `Projects/${code}/project.json`;
export const inputsDir = (code: string, kind?: InputKind) => `Projects/${code}/inputs/${kind ? `${kind}/` : ""}`;
export const mediaDir = (code: string, kind?: MediaKind) => `Projects/${code}/media/${kind ? `${kind}/` : ""}`;
export const sharedDir = (code: string) => `Projects/${code}/shared/`;
export const handoffKey = (code: string, phase: string) => `Projects/${code}/handoff/${phaseOf("", phase)}.json`;

/** One pipeline's folder in a project; a floor's sub-project (CODE_GF) gets its own sub-folder. */
export function pipelineDir(code: string, pipeline: string, phase?: string, sub?: string): string {
  return `Projects/${code}/${PHASE_DIRS[phaseOf(pipeline, phase)]}/${pipeline}/${sub && sub !== code ? `${sub}/` : ""}`;
}

/** A file name safe for an R2 key, with a time stamp so repeated uploads never overwrite each other. */
export function stampedName(name: string): string {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name).replace(/[^\w.-]+/g, "_").slice(0, 60) || "file";
  const ext = dot > 0 ? name.slice(dot).toLowerCase().replace(/[^.\w]/g, "") : "";
  return `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}_${base}${ext}`;
}

/** The project open in the editor: the code the Project panel remembers (bp.editor.projectCode), else `fallback`
 *  (e.g. the plan's own project code), else _unassigned. Uploads and outputs made in the editor go under it. */
export function activeProject(fallback?: unknown): string {
  let c = "";
  try { c = localStorage.getItem("bp.editor.projectCode") ?? ""; } catch { /* storage blocked */ }
  return projectCode(c || fallback);
}
