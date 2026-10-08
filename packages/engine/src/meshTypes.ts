/**
 * The neutral 3D-mesh payload — the contract between anything that COMPUTES a mesh and anything
 * that DRAWS one.
 *
 * Deliberately SERIALIZABLE: no THREE.js objects, no renderer types. That is what lets it sit in
 * this package at all, and it is why a mesh can travel on a flow edge, through history and undo,
 * and into persisted state. A renderer builds real geometry from this description (and can
 * instance identical specs); this file never knows which renderer.
 *
 * A mesh is a list of `prisms`, each LOFTED between a bottom polygon and a top polygon — a "prism"
 * whose two ends may differ. A plain box layer has top == bottom; a frustum or taper has a smaller
 * top. Footprints are in PLAN-PIXEL world coords, the same frame the 2D geometry uses;
 * `yTop`/`yBottom` are METRES, y-up, 0 = floor plane, negative = below grade. The mixed units are
 * inherited from the host and are load-bearing — do not "tidy" one of them without changing every
 * producer and consumer together.
 *
 * `top` and `bottom` must have the same vertex count and be index-aligned: vertex i of the bottom
 * lofts to vertex i of the top.
 */
import type { Point } from "./types.js";

export interface FlowMeshPrism {
  /** Bottom outline, plan-px world coords. */
  bottom: Point[];
  /** Top outline, plan-px world coords — index-aligned with `bottom` (same length). */
  top: Point[];
  /** Bottom plane height, metres (y-up; negative = below grade). */
  yBottom: number;
  /** Top plane height, metres. Must be ≥ yBottom. */
  yTop: number;
  /** Fill colour for this prism. */
  color: string;
  /** Optional interior hole outlines (plan-px world coords), punched through the FULL prism height.
   *  Only meaningful for STRAIGHT prisms (top ≈ bottom): a renderer can then extrude the footprint
   *  as a shape-with-holes instead of fan-triangulating, so concave / holed outlines come out right.
   *  Used by the wall-band carve (column footprints subtracted from wall prisms). */
  holes?: Point[][];
  /** The 3D render ROW this solid came from (e.g. "Flutes", "Backer") — what a `finishes` entry names. */
  name?: string;
  /** A Library material path wired to that row by the object itself (a Material node), when it has one. */
  material?: string;
}

export interface FlowMesh {
  /** Stable id (e.g. `<nodeId>-<index>`) so a renderer can key or instance it. */
  id: string;
  prisms: FlowMeshPrism[];
}
