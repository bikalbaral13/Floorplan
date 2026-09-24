/**
 * The engine's geometry vocabulary.
 *
 * WHY THIS IS NOT THE HOST APP'S `types.ts`. The app's `Wall` carries 172 fields — regulation
 * flags (`crzZone`, `setbackRegime`), provenance markers (`isVoronoiWall`, `bspSourceRoomId`),
 * display state, and a reference to its parametric attachments, which in turn drags in the whole
 * document model. The algorithms here read 16 of those fields; `Room`, 10 of 43; `NodeMeta`, 7 of
 * 26. Importing the app's model to serve that would make a geometry library depend on one
 * application's domain — the exact coupling that stops a second app from using it.
 *
 * So the engine declares the narrow shapes it genuinely needs, and TypeScript's structural typing
 * does the rest: a host passing its own richer `Wall` satisfies these, with no adapter and no cast.
 * The fields the engine does not name are neither read nor written, but they travel through
 * untouched because nothing here reconstructs a wall from scratch.
 *
 * WHEN TO ADD A FIELD. Only when an algorithm in this package actually reads or writes it. A field
 * added "because the host has it" re-opens the coupling this file exists to close.
 */

/** A point in world units. Every polygon, ring and path in this package is a `Point[]`. */
export interface Point {
  x: number;
  y: number;
}

/** How a wall's thickness sits relative to its centreline. */
export type WallMethod = "left" | "center" | "right";

/** How a wall is realised as geometry — a stroked line, a filled band, or a mitred union. */
export type WallMode = "fill" | "outline" | "line" | "mitered" | "mitered-union";

/** The mitred outline of one wall: its four corners, its edges, and the centreline they wrap. */
export interface WallPolygonGeometry {
  corners: Point[];
  edges: [Point, Point][];
  /** Centre line along the wall (same as start → end). */
  spine: { start: Point; end: Point };
}

/**
 * A wall segment, reduced to what the algorithms use. `id`, `start`, `end`, `thickness` and
 * `color` are required because the package constructs walls (splitting, mitring, wall-building)
 * and a host must be able to accept the result as its own.
 */
export interface Wall {
  id: string;
  start: Point;
  end: Point;
  thickness: number;
  color: string;
  /** Interpolated spine for curved segments, as a flat `[x, y, x, y, …]` run. */
  spinePoints?: number[];
  mode?: WallMode;
  method?: WallMethod;
  segmentType?: string;
  hatch?: boolean;
  label?: string;
  /**
   * Carried through, never interpreted. Declared as the host's own union rather than `string`
   * because the engine hands walls BACK to the host: widening here would make every returned
   * wall unassignable to the caller's narrower type.
   */
  category?: "Fire Exit" | "Facade" | "Electrical Entrance" | "Lift Entrance";
  layerId?: string;
  /**
   * Provenance markers. The layout solvers stamp their own output so a host can tell a generated
   * wall from a drawn one, and a preview from a committed result. The engine only writes these;
   * what a host does with them is its business.
   */
  isFloorplateComputed?: boolean;
  isMaxRectComputed?: boolean;
  isMaxRectPreview?: boolean;
  isInflationWall?: boolean;
  isInflationPreview?: boolean;
  inflationSourceRoomId?: string;
  /** Metres. Read by the massing and DCR routines. */
  heightM?: number;
  setbackM?: number;
  floorToFloorM?: number;
}

/** A closed area. `points` is the outer ring; `holes` are inner rings wound the other way. */
export interface Room {
  id: string;
  /** True for a room DETECTED from a closed wall loop rather than drawn. It used to be readable from the
   *  id's prefix, which is why the id had one; ids now name their KIND and nothing else ("space_…", like
   *  every segment's "segment_…" and node's "node_…"), so the fact lives in its own field. */
  auto?: boolean;
  points: Point[];
  fill: string;
  /** Required, matching the host: the engine constructs rooms, and an optional field here would
   *  make every returned room unassignable to a caller that requires one. */
  stroke: string;
  holes?: Point[][];
  label?: string;
  /** Area in square world-units. Trusted when present rather than recomputed. */
  netArea?: number;
  /** Carried through, never interpreted — same reasoning as `Wall.category`. */
  region?: "Core" | "Staircase" | "AHU" | "Electrical Room" | "Service" | "Lift" | "Toilet" | "Corridor";
  /** Constraint inputs for the layout optimisers. */
  minArea?: number;
  maxArea?: number;
  maxRatio?: number;
  floorToFloorM?: number;
}

/** Per-node metadata — what a graph node *is* (a plain point, a column, a tree) and its size. */
export interface NodeMeta {
  label?: string;
  type?: "point" | "column" | "tree" | "object";
  columnShape?: "circular" | "rectangular";
  radius?: number;
  dimX?: number;
  dimY?: number;
  hatch?: boolean;
}

/** A value carried by a schema-defined property. */
export type GraphAttrValue = number | string | boolean;

/** One schema-defined property on a node or segment. */
export interface GraphPropDef {
  key: string;
  label?: string;
  kind?: "number" | "select" | "checkbox" | "text" | "color";
  unit?: string;
  default?: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label?: string }[];
  /** Solver binding. Properties without a role are carried but not consumed. */
  role?: string;
  decimals?: number;
  /** Conditional visibility: show only when another property's value matches. */
  showIf?: { when: string; equals?: string | number | boolean; in?: (string | number | boolean)[] };
}

/** One read-only result row a solver publishes per component. */
export interface GraphResultDef {
  key: string;
  label?: string;
  unit?: string;
  decimals?: number;
}

/** Extra node/segment properties plus the result rows a solver displays. */
export interface GraphSchema {
  name?: string;
  node?: GraphPropDef[];
  segment?: GraphPropDef[];
  results?: { node?: GraphResultDef[]; segment?: GraphResultDef[] };
}
