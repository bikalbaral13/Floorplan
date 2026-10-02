import { listLibraryFiles, fetchLibraryText } from "../libraryFiles";

/** One SKILL — a single piece of reusable professional judgement, stored as a markdown file under
 *  Skills/<Folder>/<id>.md with a small YAML-ish frontmatter block.
 *
 *  Skills are the layer BELOW agents: an agent file holds persona + routing + resource grants and names
 *  the skills it may use; each skill holds one decision, written once and shared by every agent that
 *  needs it. Agents compose their skills into their instructions at load time (see agentDefs.ts), so a
 *  correction made in one skill file reaches every agent that lists it. */
export interface SkillDefinition {
  /** Stable slug — what an agent's `skills` array names. Falls back to the filename. */
  id: string;
  /** Human title, shown as the skill's heading in the composed prompt. */
  name: string;
  /** Folder / discipline the skill belongs to (Shared, Site Planning, Flow, …). */
  category?: string;
  /** One line on WHEN to reach for it — the routing hint. */
  when?: string;
  /** Tool names the skill expects to use (documentation only — the agent's allow-list still governs). */
  tools?: string[];
  /** Other skill ids this one leans on. */
  requires?: string[];
  /** The markdown body — the judgement itself. */
  body: string;
  /** Library-relative source path, set on load (e.g. "Skills/Shared/verify-before-reporting.md"). */
  sourcePath?: string;
}

/** Folder-relative paths of every bundled skill under Skills/ — the production fallback
 *  for {@link listSkillFiles} (static hosting can't list directories; dev lists LIVE through the
 *  library bridge). NEW bundled skills belong in their folder AND here. */
export const BUNDLED_SKILL_FILES: string[] = [
  "Shared/read-space-boundary-in-metres.md",
  "Shared/verify-before-reporting.md",
  "Shared/import-objects-scoped.md",
  "Shared/work-one-step-at-a-time.md",
  "Site Planning/attach-site-envelope.md",
  "Site Planning/read-setbacks-from-source.md",
  "Site Planning/ensure-core-and-path-objects.md",
  "Site Planning/size-and-place-cores.md",
  "Site Planning/route-core-paths.md",
  "Site Planning/mass-and-report-fsi.md",
  "Circulation/attach-circulation-object.md",
  "Circulation/sketch-circulation-network.md",
  "Circulation/tune-mitered-corridor.md",
  "Architectural/run-floorplan-workflow.md",
  "Architectural/architectural-object-ids.md",
  "Architectural/draw-plan-by-hand.md",
  "Architectural/floorplan-house-rules.md",
  "Interiors/furnish-room-layout.md",
  "Design/draw-walls-and-guides.md",
  "Design/cut-openings-in-walls.md",
  "Design/place-node-objects.md",
  "Vectorisation/prepare-underlay-for-tracing.md",
  "Vectorisation/auto-tune-vectorisation.md",
  "Vectorisation/color-detected-classes.md",
  "Vectorisation/straighten-traced-graph.md",
  "Vectorisation/graph-to-canvas-primitives.md",
  "Vectorisation/carve-openings-from-graph.md",
  "Vectorisation/detect-objects-in-underlay.md",
  "Vectorisation/run-raster-to-plan-flow.md",
  "Flow/flow-spine.md",
  "Flow/flow-math-engine.md",
  "Flow/flow-host-aware-frame.md",
  "Flow/flow-compose-units.md",
  "Flow/flow-recipes.md",
  "Render/run-faithful-space-render.md",
  "Render/render-scope-and-framing.md",
  "Render/wire-plan-and-3d-into-render.md",
  "Floorplan Tracer/trace-raster-plan-to-canvas.md",
  "Floorplan Tracer/pdf-intake.md",
  "Floorplan Tracer/trace-master-plan.md",
  "Floorplan Tracer/trace-multi-storey-plans.md",
  "Floorplan Tracer/trace-raster-plan-live.md",
  "Floorplan Tracer/calibrate-scale-from-printed-dimensions.md",
  "Floorplan Tracer/measure-wall-bands-from-pixels.md",
  "Floorplan Tracer/read-openings-and-fixtures-by-zoom.md",
  "Floorplan Tracer/author-plan-graph-in-image-pixels.md",
  "Floorplan Tracer/verify-trace-overlay-and-areas.md",
  "Floorplan Tracer/floorplan-tracer-scripts.md",
  "Floorplan Improver/improve-traced-plan.md",
  "Floorplan Improver/read-the-plan-and-brief.md",
  "Floorplan Improver/choose-the-moodboard.md",
  "Floorplan Improver/choose-the-fitout-set.md",
  "Floorplan Improver/lay-out-tiles-and-floor-finishes.md",
  "Floorplan Improver/light-the-rooms.md",
  "Floorplan Improver/dress-ceiling-walls-and-trims.md",
  "Floorplan Improver/wire-services-and-render-kit.md",
  "Floorplan Improver/emit-improved-canvas-json.md",
  "Floorplan Improver/apply-moodboard-to-modelling-plans.md",
  "Floorplan Improver/verify-the-improvement.md",
  "Floorplan Improver/floorplan-improver-scripts.md",
  "Floorplan Improver/upgrade-object-meshes.md",
  "Floorplan Renderer/render-a-floorplan.md",
  "Floorplan Renderer/inspect-the-blend.md",
  "Floorplan Renderer/unblock-and-fix-the-scene.md",
  "Floorplan Renderer/light-and-expose.md",
  "Floorplan Renderer/model-soft-goods-and-edges.md",
  "Floorplan Renderer/render-fast-on-cpu.md",
  "Floorplan Renderer/frame-the-shot.md",
  "Floorplan Renderer/verify-the-render.md",
  "Floorplan Renderer/export-room-blend-glb-skp.md",
  "Floorplan Renderer/floorplan-renderer-scripts.md",
  "Floorplan Renderer/bake-and-bind-materials.md",
  "Floorplan Renderer/build-the-blender-scene.md",
  "Floorplan Renderer/material-library.md",
  "Canvas Json to Dxf/convert-canvas-json-to-dxf.md",
  "Canvas Json to Dxf/extract-drawing-geometry-from-plan.md",
  "Canvas Json to Dxf/draft-walls-hatch-and-blocks.md",
  "Canvas Json to Dxf/dimension-plan-in-three-tiers.md",
  "Canvas Json to Dxf/draft-hidden-line-elevations.md",
  "Canvas Json to Dxf/lay-out-a1-sheet-with-schedules.md",
  "Canvas Json to Dxf/verify-dxf-by-render.md",
  "Canvas Json to Dxf/dxfplan-commands.md",
];

/** Every `.md` under Skills/ (via the dev bridge), else the bundled manifest. */
export async function listSkillFiles(): Promise<string[]> {
  const listed = await listLibraryFiles("Skills", "md");
  return listed?.length ? listed.filter((f) => f.toLowerCase().endsWith(".md")) : BUNDLED_SKILL_FILES;
}

/** Split a `---` frontmatter block off the top of a markdown file. Missing / malformed → no keys. */
function splitFrontmatter(text: string): { keys: Record<string, string>; body: string } {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) return { keys: {}, body: src.trim() };
  const keys: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (kv) keys[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { keys, body: src.slice(m[0].length).trim() };
}

/** Read a frontmatter value as a list — accepts `[a, b]` or a bare comma-separated string. */
function asList(v: string | undefined): string[] | undefined {
  if (!v) return undefined;
  const inner = v.trim().replace(/^\[|\]$/g, "");
  const items = inner.split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
  return items.length ? items : undefined;
}

/** Parse one skill file. `rel` is the Skills-relative path, used for the id/category fallbacks. */
export function parseSkillFile(rel: string, text: string): SkillDefinition | null {
  const { keys, body } = splitFrontmatter(text);
  if (!body) return null;
  const bare = rel.replace(/^Skills\//i, "");
  const fileId = bare.split("/").pop()!.replace(/\.md$/i, "");
  return {
    id: keys.id || fileId,
    name: keys.name || fileId,
    category: keys.category || (bare.includes("/") ? bare.split("/")[0] : undefined),
    when: keys.when,
    tools: asList(keys.tools),
    requires: asList(keys.requires),
    body,
    sourcePath: `Skills/${bare}`,
  };
}

/** Fetch + parse the given Skills-folder files (folder-relative paths from {@link listSkillFiles}).
 *  Unreadable / empty files are skipped; duplicates by id keep the last. */
export async function loadSkillsFromPaths(rels: string[]): Promise<Map<string, SkillDefinition>> {
  const byId = new Map<string, SkillDefinition>();
  for (const rel of rels) {
    const bare = rel.replace(/^Skills\//i, "");
    try {
      // Skills are MARKDOWN with frontmatter, so they read as text rather than JSON.
      const text = await fetchLibraryText(`Skills/${bare}`);
      if (text == null) continue;
      const parsed = parseSkillFile(bare, text);
      if (parsed) byId.set(parsed.id, parsed);
    } catch { /* skip unreadable file */ }
  }
  return byId;
}

/** Load + parse every skill in the Library/Skills folder, keyed by id. */
export async function loadLibrarySkills(): Promise<Map<string, SkillDefinition>> {
  return loadSkillsFromPaths(await listSkillFiles());
}

/** Render the named skills as one markdown section to append to an agent's instructions. Ids with no
 *  matching file are listed as missing rather than dropped silently — a typo in an agent's `skills`
 *  array is a defect the model should be able to report. */
export function composeSkillSection(ids: string[], skills: Map<string, SkillDefinition>): string {
  if (!ids.length) return "";
  const found = ids.map((id) => skills.get(id)).filter((s): s is SkillDefinition => !!s);
  const missing = ids.filter((id) => !skills.has(id));
  if (!found.length && !missing.length) return "";
  const parts = found.map((s) => {
    const head = `## SKILL — ${s.name} (${s.id})`;
    const when = s.when ? `\n_Use when: ${s.when}_` : "";
    return `${head}${when}\n\n${s.body}`;
  });
  const note = missing.length ? `\n\n(Skills named but not found in the library: ${missing.join(", ")}.)` : "";
  return `\n\n# SKILLS\n\nThese are your practice's own procedures. Follow them over your general instincts; where one applies, it decides the matter.\n\n${parts.join("\n\n---\n\n")}${note}`;
}
