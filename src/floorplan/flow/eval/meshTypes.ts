/**
 * Generic 3D-mesh payload that flows on a Flow edge (produced by `… to 3D Mesh` nodes, consumed by the
 * single `Mesh to 3D` terminal). Deliberately SERIALIZABLE — no THREE.js objects — because the flow graph
 * goes through history/undo and persistence. The 3D canvas builds the actual geometry from this description
 * (and can instance identical specs).
 *
 * A mesh is a list of `prisms`, each LOFTED between a bottom polygon and a top polygon (a "prism" with
 * possibly different top/bottom outlines). A plain box layer → top == bottom outline; a frustum / taper →
 * top smaller than bottom. Footprints are in PLAN-PIXEL world coords (mapped to the scene exactly like
 * `spaceMasses`); `yTop`/`yBottom` are in METRES, y-up, 0 = floor plane, negative = below grade.
 *
 * `top` and `bottom` must have the same vertex count and be index-aligned (vertex i of the bottom lofts to
 * vertex i of the top). Convex outlines render correctly (caps are fan-triangulated); footings are convex.
 */
import type { Point } from "../../types";

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
   *  Only meaningful for STRAIGHT prisms (top ≈ bottom): the canvas then extrudes the footprint as a
   *  Shape-with-holes instead of fan-triangulating, so concave / holed outlines render correctly.
   *  Used by the wall-band carve (column footprints subtracted from wall prisms). */
  holes?: Point[][];
}

export interface FlowMesh {
  /** Stable id (e.g. `<nodeId>-<index>`) so the canvas can key / instance it. */
  id: string;
  prisms: FlowMeshPrism[];
}
