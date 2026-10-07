/**
 * The five project phases (header toggle) and the home phase of every pipeline / skill.
 *
 *   Program → Plan → Design → Build → Present
 *
 * One list so the toggle, the Navigator pipeline sections and — later — toolbars, skill ranking and
 * library filters all agree on where a pipeline belongs. Add a pipeline here when it is created.
 */
export type Phase = "program" | "plan" | "design" | "build" | "present";

export interface PhaseDef {
  id: Phase;
  label: string;
  /** Tooltip: what the phase is for. */
  title: string;
  /** Pipelines and skills whose home is this phase (display names). */
  pipelines: string[];
}

export const PHASES: PhaseDef[] = [
  {
    id: "program",
    label: "Program",
    title: "Program: brief and feasibility — plot, setbacks, building type, unit mix, open space, parking, options",
    pipelines: ["Program Pipeline"],
  },
  {
    id: "plan",
    label: "Plan",
    title: "Plan: import or trace the floor plan, set scale and levels, master-plan layout, pick the moodboard",
    pipelines: ["Floorplan Tracer Pipeline", "Floorplan Tracer", "Scribble to Floorplan", "PDF Intake", "Master Plan Trace"],
  },
  {
    id: "design",
    label: "Design",
    title: "Design: improve the plan with objects, materials, lighting and instancing",
    pipelines: ["Floorplan Improver", "Moodboard Creator", "Material Creator", "Room Renderer", "Parametric Object Creator"],
  },
  {
    id: "build",
    label: "Build",
    title: "Build: structure, services, quantities, cost, schedule and construction drawings",
    pipelines: ["Complete House Design", "Plane Frame Analysis", "EPANET Pipe Networks", "DXF Plan Drawings"],
  },
  {
    id: "present",
    label: "Present",
    title: "Present: images, videos, walkthroughs, Unreal / Blender / SketchUp exports",
    pipelines: ["Floorplan Renderer", "Interior Mesh Pipeline", "Exterior Mesh Pipeline"],
  },
];

export const PHASE_IDS = PHASES.map((p) => p.id);

export const isPhase = (v: unknown): v is Phase => typeof v === "string" && (PHASE_IDS as string[]).includes(v);

/** Home phase of a pipeline / skill by display name, or undefined when it has none yet. */
export const phaseOf = (pipeline: string): PhaseDef | undefined =>
  PHASES.find((p) => p.pipelines.some((n) => n.toLowerCase() === pipeline.toLowerCase()));
