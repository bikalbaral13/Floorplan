export type Unit = "m" | "ft" | "cm" | "in";

export interface Point {
  x: number;
  y: number;
}

export type WallMode = "fill" | "outline" | "line" | "mitered" | "mitered-union";
/** Spine placement relative to wall thickness: centerline, or flush on one side along the segment. */
export type WallMethod = "left" | "center" | "right";

/** Segment type: wall, door opening, window opening, plot boundary, layout connection edge, or
 *  the buildable / footprint boundary lines that wrap their corresponding Space types. */
export type WallSegmentType = "wall" | "line" | "door" | "window" | "plot-boundary" | "connection"
  | "buildable-boundary" | "footprint-boundary" | "path";

/** Corner style for `segmentType: "path"` segments at junctions where consecutive
 *  path segments meet. "miter" = angular (existing wall-style join); "round" = the
 *  outer corner is replaced with an arc of radius `thickness/2`; "nurbs" = the
 *  entire chain of connected path segments is replaced with a smooth cubic NURBS
 *  curve through the vertices and rendered as an offset ribbon of width `thickness`.
 *  Defaults to "miter" when omitted. Has no effect on non-path segments. */
export type PathJoin = "miter" | "round" | "nurbs";

/** Path geometry style for a drawn path / NURBS segment chain: "straight" = plain mitered
 *  edges, "nurbs-through" = interpolating curve passing through every vertex, "nurbs-smooth" =
 *  approximating curve that smooths the polyline. (Previously defined in DrawPathDialog.) */
export type DrawPathStyle = "straight" | "nurbs-through" | "nurbs-smooth";

/** Path justification relative to the curve's bend: the ribbon sits on the inner (concave) or
 *  outer (convex) side, or straddles the centerline. Resolved to a concrete left / right offset
 *  at commit time from the spine's net bend. */
export type PathJustify = "inner" | "center" | "outer";

/** Connection-segment metadata: when segmentType === "connection", these reference the two rooms the edge links. */
export interface ConnectionWallMeta {
  aRoomId?: string;
  bRoomId?: string;
}

export interface Wall {
  id: string;
  start: Point;
  end: Point;
  /** Layer this wall lives on. Missing/unknown values resolve to `DEFAULT_LAYER_ID` (`"0"`). */
  layerId?: string;
  /** Flow node id that OWNS this segment in "Live" mode (materialised from that node's live output).
   *  All walls carrying an owner are wiped + redrawn on every flow change, so the produced Space tracks
   *  the node's parameters in real time. Cleared when Live turns off (the geometry bakes into normal walls). */
  flowOwner?: string;
  /** Optional spine polyline for curved walls (x1, y1, x2, y2, ...). */
  spinePoints?: number[];
  /** Konva Line tension used when rendering spinePoints as a spline. */
  splineTension?: number;
  thickness: number;
  color: string;
  dashed?: boolean;
  /** Stroke style for the segment in 2D. Overrides the legacy `dashed` flag when set. */
  lineStyle?: "solid" | "dashed" | "dotted";
  /** Fill the segment's interior with a hatch pattern (Display block) instead of a solid colour. */
  hatch?: boolean;
  /** Hatch pattern kind. Default "diagonal". */
  hatchStyle?: "diagonal" | "dots";
  /** Hatch spacing in world pixels (line gap / dot pitch). Default 8. */
  hatchSpacing?: number;
  /** Hatch rotation in degrees (diagonal only). Default 45. */
  hatchAngle?: number;
  /** Hatch line thickness / dot radius factor. Default 1. */
  hatchWeight?: number;
  /** Parametric object instances attached to this segment (e.g. a parametric Door), each referencing a
   *  library object id + its per-instance params + position along the segment. */
  attachments?: SegmentAttachment[];
  /** This wall piece is the OPENING gap cut for an attached parametric object — it renders as a hole in
   *  the band (no fill/stroke), and the object's symbol/geometry fills it. */
  isObjectOpening?: boolean;
  /** fill = solid wall; outline = hollow rectangle stroke only */
  mode?: WallMode;
  /** Display block "Buffered" mode — when set, the segment renders as a thickness band with this cap
   *  style (capsule = rounded, square = extended, flat = butt), surviving Graph view. Absent = Line mode
   *  (thin styled stroke). Mirrors the flow "Display Segment" node's buffer style. */
  bufferStyle?: "capsule" | "square" | "flat";
  /** Display block "Path" mode (requires `bufferStyle`): besides the band, the connected run of touching
   *  path segments derives a LIVE Space (union outline, recomputed as segments move — never persisted in
   *  `rooms`). Space attachments for it live in `FloorPlanModel.pathSpaceAttachments`. */
  asSpace?: boolean;
  /** How the start→end spine aligns to the wall thickness */
  method?: WallMethod;
  /** Segment type: built-in (`wall` / `door` / `window` / `plot-boundary` / `path`) or a
   *  custom slug registered in `FloorPlanModel.customSegmentTypes`. */
  segmentType?: WallSegmentType | string;
  /** Corner join style when `segmentType === "path"`. Defaults to "miter" if omitted.
   *  Ignored for all other segment types. */
  pathJoin?: PathJoin;
  /** When `pathJoin === "nurbs"`, controls whether the curve passes exactly through
   *  each vertex (interpolating Catmull-Rom) or approximates the polyline (B-spline). */
  nurbsInterpolate?: boolean;
  /** Per-wall values for parameters declared by a custom segment type's schema.
   *  Keyed by ParamDef.key. Built-in segment types ignore this field. */
  customParams?: Record<string, string | number | boolean>;
  /** Optional user-editable label shown in the properties panel. */
  label?: string;
  /** When true, draw this segment's label at its midpoint on the canvas (Segment Properties → Show Label). */
  showLabel?: boolean;
  /** Optional user-selected category for the segment. */
  category?: "Fire Exit" | "Facade" | "Electrical Entrance" | "Lift Entrance";
  /** When true, render an arrowhead at the segment's midpoint pointing from start → end. */
  showDirection?: boolean;
  /** When true, render the segment's convergence/divergence level number on it. */
  showLevel?: boolean;
  /** Whether this wall was generated by compute floorplate. */
  isFloorplateComputed?: boolean;
  /** ID of the floorplate-boundary room this wall belongs to (set on BSP-generated layout walls). */
  floorplateId?: string;
  /** Whether this wall was generated by GCR buildable area computation. */
  isGcrComputed?: boolean;
  /** Whether this wall was generated by max inscribed rectangle computation. */
  isMaxRectComputed?: boolean;
  /** Live-preview variant of max inscribed rectangle — excluded from room detection. */
  isMaxRectPreview?: boolean;
  /** Whether this wall was generated by Optimise L-shape computation (committed). */
  isOptLShapeWall?: boolean;
  /** Live-preview variant of Optimise L-shape — excluded from room detection. */
  isOptLShapePreview?: boolean;
  /** Source room id for Optimise L-shape walls (preview & committed). */
  optLShapeSourceRoomId?: string;
  /** Wall belongs to a placed rectangle along the boundary (permanent). */
  isPlacementWall?: boolean;
  /** Live-preview variant of boundary placement — excluded from room detection. */
  isPlacementPreview?: boolean;
  /** Source room id for placement walls. */
  placementSourceRoomId?: string;
  /** Stable id of the PlacedObject this placement-wall belongs to (groups the 4 sides). */
  placementObjectId?: string;
  /** Kind of placed object — drives 2D-symbol rendering in 2D Symbol placement mode. */
  placementKind?:
    | "bed" | "table" | "chair" | "sofa"
    | "desk" | "wardrobe" | "bookshelf" | "bench"
    | "piano" | "tv-unit" | "fridge" | "toilet" | "bathtub"
    | "guitar" | "whiteboard" | "flute" | "clock" | "mirror";
  /** Height in metres of the placed object (used by 3D primitive in 2D Symbol mode). */
  placementHeightM?: number;
  /** Clearance from floor in metres (lift wall-hung objects above floor). */
  placementClearanceM?: number;
  /** Wall belongs to a committed Voronoi partition. */
  isVoronoiWall?: boolean;
  /** Live-preview variant of Voronoi partition — excluded from room detection. */
  isVoronoiPreview?: boolean;
  /** Source room id for voronoi walls. */
  voronoiSourceRoomId?: string;
  /** Wall belongs to a committed polygon skeleton (medial axis). */
  isSkeletonWall?: boolean;
  /** Live-preview variant of polygon skeleton — excluded from room detection. */
  isSkeletonPreview?: boolean;
  /** Source room id for skeleton walls. */
  skeletonSourceRoomId?: string;
  /** Segment traced from a raster image by Image Tools → Vectorisation. */
  isVectorWall?: boolean;
  /** Live-preview variant of a vectorised segment — excluded from room detection. */
  isVectorPreview?: boolean;
  /** Wall belongs to a committed convex hull. */
  isConvexHullWall?: boolean;
  /** Live-preview variant of convex hull — excluded from room detection. */
  isConvexHullPreview?: boolean;
  /** Source room id for convex hull walls. */
  convexHullSourceRoomId?: string;
  /** Wall belongs to a committed inflation (soap-film) inscribed rectangle. */
  isInflationWall?: boolean;
  /** Live-preview variant of inflation rectangle — excluded from room detection. */
  isInflationPreview?: boolean;
  /** Source room id for inflation rectangle walls. */
  inflationSourceRoomId?: string;
  /** Wall belongs to a committed BSP partition. */
  isBspWall?: boolean;
  /** Live-preview variant of BSP partition — excluded from room detection. */
  isBspPreview?: boolean;
  /** Source room id for BSP walls. */
  bspSourceRoomId?: string;
  /** Wall belongs to a committed RFP (Rectangular Floor Plan) partition. */
  isRfpWall?: boolean;
  /** Live-preview variant of RFP partition — excluded from room detection. */
  isRfpPreview?: boolean;
  /** Source room id for RFP walls. */
  rfpSourceRoomId?: string;
  /** Wall belongs to a committed rectangular decomposition. */
  isRectDecompWall?: boolean;
  /** Live-preview variant of rectangular decomposition — excluded from room detection. */
  isRectDecompPreview?: boolean;
  /** Source room id for rectangular decomposition walls. */
  rectDecompSourceRoomId?: string;
  /** Wall belongs to a committed Delaunay triangulation. */
  isDelaunayWall?: boolean;
  /** Live-preview variant of Delaunay triangulation — excluded from room detection. */
  isDelaunayPreview?: boolean;
  /** Source room id for Delaunay walls. */
  delaunaySourceRoomId?: string;
  /** Wall belongs to a committed polygon-smoothing curve. */
  isSmoothingWall?: boolean;
  /** Live-preview variant of polygon smoothing — excluded from room detection. */
  isSmoothingPreview?: boolean;
  /** Source room id for smoothing walls. */
  smoothingSourceRoomId?: string;
  /** Wall belongs to a committed polygon mesh triangulation. */
  isMeshWall?: boolean;
  /** Live-preview variant of polygon meshing — excluded from room detection. */
  isMeshPreview?: boolean;
  /** Source room id for mesh walls. */
  meshSourceRoomId?: string;
  /** Wall belongs to a committed CVT (centroidal Voronoi tessellation) cell boundary. */
  isCvtWall?: boolean;
  /** Live-preview variant of CVT relaxation — excluded from room detection. */
  isCvtPreview?: boolean;
  /** Source room id for CVT walls. */
  cvtSourceRoomId?: string;
  /** Wall belongs to a committed convex decomposition. */
  isConvexDecompWall?: boolean;
  /** Live-preview variant of convex decomposition — excluded from room detection. */
  isConvexDecompPreview?: boolean;
  /** Source room id for convex-decomposition walls. */
  convexDecompSourceRoomId?: string;
  /** Wall belongs to a committed circumcircle (minimum enclosing circle) of a room. */
  isCircumcircleWall?: boolean;
  /** Live-preview variant of circumcircle — excluded from room detection. */
  isCircumcirclePreview?: boolean;
  /** Source room id for circumcircle walls. */
  circumcircleSourceRoomId?: string;
  /** Wall belongs to a committed minimum enclosing ellipse of a room. */
  isEllipseWall?: boolean;
  /** Live-preview variant of minimum enclosing ellipse — excluded from room detection. */
  isEllipsePreview?: boolean;
  /** Source room id for ellipse walls. */
  ellipseSourceRoomId?: string;
  /** Wall belongs to a committed oriented bounding box of a room. */
  isObbWall?: boolean;
  /** Live-preview variant of oriented bounding box — excluded from room detection. */
  isObbPreview?: boolean;
  /** Source room id for OBB walls. */
  obbSourceRoomId?: string;
  /** Wall belongs to a committed regular n-gon enclosure of a room. */
  isNGonWall?: boolean;
  /** Live-preview variant of n-gon enclosure — excluded from room detection. */
  isNGonPreview?: boolean;
  /** Source room id for n-gon walls. */
  nGonSourceRoomId?: string;
  /** Wall belongs to a committed polygon-unroll visualization of a room. */
  isUnrollWall?: boolean;
  /** Live-preview variant of polygon unroll — excluded from room detection. */
  isUnrollPreview?: boolean;
  /** Source room id for unroll walls. */
  unrollSourceRoomId?: string;
  /** Wall belongs to a committed principal-axes overlay of a room. */
  isPrincipalAxisWall?: boolean;
  /** Live-preview variant of principal-axes overlay — excluded from room detection. */
  isPrincipalAxisPreview?: boolean;
  /** Source room id for principal-axis walls. */
  principalAxisSourceRoomId?: string;
  /** Wall belongs to a committed contour-line overlay of a room. */
  isContourWall?: boolean;
  /** Live-preview variant of contour-line overlay — excluded from room detection. */
  isContourPreview?: boolean;
  /** Source room id for contour walls. */
  contourSourceRoomId?: string;
  /** Wall belongs to a committed streamlines overlay of a room. */
  isStreamlineWall?: boolean;
  /** Live-preview variant of streamlines overlay — excluded from room detection. */
  isStreamlinePreview?: boolean;
  /** Source room id for streamline walls. */
  streamlineSourceRoomId?: string;
  /** Wall belongs to a committed noise-texture overlay of a room. */
  isNoiseTextureWall?: boolean;
  /** Live-preview variant of noise-texture overlay — excluded from room detection. */
  isNoiseTexturePreview?: boolean;
  /** Source room id for noise-texture walls. */
  noiseTextureSourceRoomId?: string;
  /** Wall belongs to a committed incircle overlay of a room. */
  isInCircleWall?: boolean;
  /** Live-preview variant of incircle overlay — excluded from room detection. */
  isInCirclePreview?: boolean;
  /** Source room id for incircle walls. */
  inCircleSourceRoomId?: string;
  /** Wall belongs to a committed tiling overlay of a room. */
  isTilingWall?: boolean;
  /** Live-preview variant of tiling overlay — excluded from room detection. */
  isTilingPreview?: boolean;
  /** Source room id for tiling walls. */
  tilingSourceRoomId?: string;
  /** Wall belongs to a committed squarified-treemap partition. */
  isTreemapWall?: boolean;
  /** Live-preview variant of squarified-treemap partition — excluded from room detection. */
  isTreemapPreview?: boolean;
  /** Source room id for treemap walls. */
  treemapSourceRoomId?: string;
  /** Whether this wall was generated by the Splitting Actions panel for a room. */
  isSplitWall?: boolean;
  /** Source room id for walls generated by Splitting Actions. */
  splitSourceRoomId?: string;
  /** Whether this wall was generated by the Inset Polygon panel for a room (live preview). */
  isInsetWall?: boolean;
  /** Source room id for walls generated by Inset Polygon. */
  insetSourceRoomId?: string;
  /** Basement-footprint outline (plot inset by podium offset). Painted dashed in 2D, suppressed as a wall in 3D — the 3D renderer extrudes it downward using stack metadata instead. */
  isBasementOutlineWall?: boolean;
  /** Source plot-boundary room id for basement outline walls. */
  basementSourceRoomId?: string;
  /** Wall belongs to a committed Massing facade (boundary windows + door). */
  isMassingWall?: boolean;
  /** Live-preview variant of Massing facade — excluded from room detection. */
  isMassingPreview?: boolean;
  /** Source room id for walls generated by Massing. */
  massingSourceRoomId?: string;
  /** Wall is the perimeter of a Path Setter–generated Space (committed). */
  isPathSpaceWall?: boolean;
  /** Live-preview variant of Path Setter perimeter — excluded from room detection. */
  isPathSpacePreview?: boolean;
  /** Source room id for walls / rooms generated by Path Setter. */
  pathSpaceSourceRoomId?: string;
  /** Per-segment height in metres (applies to "wall" and "plot-boundary" segments). */
  heightM?: number;
  /** Site Boundary only: physical treatment of the boundary line. */
  boundaryTreatment?: "fence" | "railing" | "open" | "solid" | "gate";
  /** Site Boundary only: regulatory adjacency that drives setback / NOC requirements (Indian context). */
  setbackRegime?: "road" | "adjoining-plot" | "nala-drain" | "water-body" | "restricted-zone" | "green-open-space";
  /** Site Boundary + setbackRegime="road" only: abutting road width in metres (drives tiered setback). */
  roadWidthM?: number;
  /** Site Boundary only: role of this edge along the plot perimeter — "front" (street-facing)
   *  or "remaining" (everything else). Drives the Inset Polygon "Front And Remaining" mode. */
  edgeRole?: "front" | "remaining";
  /** Wall produced by Add Openings (committed). */
  isOpeningWall?: boolean;
  /** Live-preview variant of Add Openings — excluded from room detection. */
  isOpeningPreview?: boolean;
  /** Source wall id for walls generated by Add Openings. */
  openingSourceWallId?: string;
  /** Door only: which end the hinge is on. "left" = start end, "right" = end end. */
  doorHinge?: "left" | "right";
  /** Door only: which side the door swings into. "left" = perpendicular left, "right" = perpendicular right. */
  doorPlacement?: "left" | "right";
  /** Door / Window: height from floor to top of opening, in meters. */
  lintelHeightM?: number;
  /** Window only: height from floor to bottom of opening, in meters. */
  sillHeightM?: number;
  /** Window only: when true, the 3D primitive renders the sash swung open; 2D is unaffected. */
  isOpen?: boolean;
  /** Flow "Segment to 3D": custom 3D extrusion height (m) overriding the default storey height for this
   *  wall, and the extrude direction. Transient — set when building the 3D model, not persisted. */
  extrude3dHeightM?: number;
  extrude3dDir?: "up" | "down";
  /** Flow "Node to Object": a placement-preview wall that must ALWAYS render as its 3D primitive (by
   *  kind), independent of the 2D-Symbol placement mode. Transient — set when building the 3D model. */
  objectPrimitive3d?: boolean;
  /** Plot boundary only: sub-type. */
  plotBoundaryType?: "road" | "plot" | "open" | "reservation" | "water" | "row";
  /** Plot boundary only: computed setback in meters. */
  setbackM?: number;
  /** Plot boundary + Road: road width in meters. */
  roadWidthM?: number;
  /** Plot boundary + Plot: whether it's a blank wall (no openings). */
  blankWall?: boolean;
  /** Plot boundary + Water: water body subtype. */
  waterSubtype?: "river" | "nala" | "lake" | "sea" | "canal";
  /** Plot boundary + Water: CRZ zone. */
  crzZone?: "I" | "II" | "III" | "IV";
  /** Plot boundary + ROW: ROW subtype. */
  rowSubtype?: "railway" | "metro" | "ht_line" | "pipeline" | "highway";

  // ── DCR / Regulation properties (plot boundary) ──
  /** Ground coverage percentage (e.g. 40) */
  groundCoveragePct?: number;
  /** Maximum building height in meters */
  maxHeightM?: number;
  /** Floor-to-floor height in meters */
  floorToFloorM?: number;
  /** Applicable regulation code (e.g. "DCR 33(7B)") */
  regulation?: string;
  /** Zone classification */
  zone?: string;

  // ── FSI properties (plot boundary) ──
  /** FSI multiplier for this segment */
  fsiMultiplier?: number;
  /** Deduction area in sq.m. (DP road / reservation segments) */
  deductionAreaSqm?: number;
  /** Whether this is surrendered land */
  isSurrenderedLand?: boolean;
  /** In-situ FSI available */
  inSituFsiAvailable?: number;

  // ── Entry / Access properties (plot boundary) ──
  /** Whether main entry is allowed from this side */
  allowsMainEntry?: boolean;
  /** Whether windows are allowed on this side */
  allowsWindows?: boolean;
  /** Whether NOC is required */
  nocRequired?: boolean;
  /** Whether this is the primary frontage */
  isPrimaryFrontage?: boolean;
  /** Proposed road widening in meters */
  proposedWideningM?: number;

  /** Connection-type segment: rooms whose centroids the segment links. */
  aRoomId?: string;
  bRoomId?: string;
}

/** Derived rectangle: four edges + spine. Computed from Wall via getWallPolygonGeometry in wallGeometry.ts. */
export interface WallPolygonGeometry {
  corners: Point[];
  edges: [Point, Point][];
  /** Center line along the wall (same as start → end). */
  spine: { start: Point; end: Point };
}

/** Room/area type classification.
 *  Built-in slugs are kept as a string union for code paths that branch on them.
 *  User-defined types extend this set at runtime via `FloorPlanModel.customRoomTypes`,
 *  so consumers should treat `roomType` as `string` when dealing with arbitrary values. */
export type RoomType = "room" | "area" | "floorplate-boundary" | "basement-area" | "plot-boundary" | "buildable-area" | "inset-area" | "deduction-area" | "path";

/** Schema for a single user-defined parameter on a custom room type. */
export type ParamDef =
  | { key: string; label: string; kind: "number"; min?: number; max?: number; step?: number; default?: number; unit?: string }
  | { key: string; label: string; kind: "text"; default?: string }
  | { key: string; label: string; kind: "boolean"; default?: boolean }
  | { key: string; label: string; kind: "select"; options: string[]; default?: string };

/** User-defined area type definition. Stored under FloorPlanModel.customRoomTypes
 *  keyed by the type's slug; the slug is what gets written to room.roomType. */
export interface AreaTypeDef {
  /** Unique slug (lowercased identifier) — matches the value stored in room.roomType. */
  id: string;
  /** Display name shown in the type dropdown and properties header. */
  displayName: string;
  /** Optional fill colour for rooms of this type (CSS colour). */
  fill?: string;
  /** Schema describing the parameters this type exposes in the INPUTS panel. */
  params: ParamDef[];
}

/** Id prefix of LIVE Path spaces (derived from `asSpace` buffered segments — see Wall.asSpace).
 *  Rooms with this prefix are recomputed, never persisted, and their attachments live in
 *  `FloorPlanModel.pathSpaceAttachments`. */
export const PATH_SPACE_ID_PREFIX = "path-space:";

export interface Room {
  id: string;
  points: Point[];
  /** Layer this room lives on. Missing/unknown values resolve to `DEFAULT_LAYER_ID` (`"0"`). */
  layerId?: string;
  /** Inner rings carved out of this room (holes). Mostly meaningful on
   *  plot-boundary rooms that contain a footprint/building. Derived on the fly
   *  by `getRoomHoles(room, rooms)` so callers usually don't need to set this
   *  explicitly — it's exposed for serialization and future manual overrides. */
  holes?: Point[][];
  fill: string;
  stroke: string;
  /** Fill opacity 0–1 (Display block). When unset the raw `fill` colour is used as-is. */
  fillOpacity?: number;
  /** Parametric objects attached to this Space (e.g. a Floor slab). Same instance shape as a segment/node
   *  attachment; placement (t/flip) is unused for an area host. */
  attachments?: SegmentAttachment[];
  label?: string;
  /** When true, draw this Space's label, area and L×B at its centroid on the canvas (Space Properties →
   *  Display → Show Label). */
  showLabel?: boolean;
  /** Order of the L×B dimension label at the Space centroid (Display block).
   *  "max-min" (default) = long × short; "x-y" = width × height; "y-x" = height × width. */
  aspectMode?: "max-min" | "x-y" | "y-x";
  netArea?: number;
  /** Area type: built-in (`room` / `floorplate-boundary` / `plot-boundary`) or a custom slug
   *  registered in `FloorPlanModel.customRoomTypes`. Code paths that branch on the built-ins
   *  use string equality, so widening to `string` here doesn't break narrowing in practice. */
  roomType?: RoomType | string;
  /** Region classification for rooms (only meaningful when roomType === "room"). */
  region?: "Core" | "Staircase" | "AHU" | "Electrical Room" | "Service" | "Lift" | "Toilet" | "Corridor";
  /** Zone-type sizing constraints used by the ZR pipeline. All optional, in metres² / dimensionless. */
  minArea?: number;
  maxArea?: number;
  maxRatio?: number;
  /** When true, render a clockwise/anticlockwise direction icon at the room's centroid. */
  showDirection?: boolean;
  // ── Site plan properties (plot-boundary rooms only) ──
  /** Ground coverage percentage */
  groundCoveragePct?: number;
  /** Maximum building height in meters */
  maxHeightM?: number;
  /** Floor-to-floor height in meters */
  floorToFloorM?: number;
  /** Maximum permissible FSI */
  maxFsi?: number;
  /** Applicable regulation code */
  regulation?: string;
  /** Max polygon optimization type */
  maxPolygonType?: "normal" | "axis-aligned" | "edge-sitting";
  /** Zone classification */
  zone?: string;
  /** Massing: number of floors to render in 3D (default 1). */
  floorsCount?: number;
  // ── FSI Statement inputs (plot-boundary rooms only) ──────────────────────────
  /** Amenity open space surrender rate as a fraction of gross plot (e.g. 0.10 = 10%). */
  amenityOsRate?: number;
  /** Layout open space (LOS) rate on net plot area (e.g. 0.15 = 15%). */
  losRate?: number;
  /** Zonal / basic FSI multiplier (e.g. 1.0). */
  basicFsiMultiplier?: number;
  /** Premium FSI multiplier — on payment (e.g. 0.5). */
  premiumFsiMultiplier?: number;
  /** TDR FSI multiplier — max permissible (e.g. 0.9). */
  tdrMultiplier?: number;
  /** Scheme-specific balance FSI given as an absolute area (sq.m), not a ratio. */
  schemeFsiSqm?: number;
  /** Fungible FSI rate applied on top of all FSI components (e.g. 0.35 = 35%). */
  fungibleRate?: number;
  /** In-situ FSI factor: FSI credit per sq.m of surrendered amenity OS (e.g. 2 = 2×). */
  inSituFsiFactor?: number;
  // ── Build Program inputs (plot-boundary rooms only) ──────────────────────────
  /** Total car parks required (nos). */
  carParksRequired?: number;
  /** Area per car park stall (sq.m), e.g. 30 for ramp parking. */
  areaPerCarParkSqm?: number;
  /** Other non-FSI area (sq.m) — terraces, utilities, refuge floors. */
  otherNonFsiSqm?: number;
  /** Number of wings / cores per floor. */
  wingsPerFloor?: number;
  /** Chosen gross floor plate area (sq.m) for Massing calculation (default 2500). */
  chosenPlateM2?: number;
  /** Room produced by Path Setter live preview — excluded from room detection / commit. */
  isPathSpacePreview?: boolean;
  /** Source host-room id for Path Setter–generated spaces. */
  pathSpaceSourceRoomId?: string;
  /** Per-room values for parameters declared by a custom room type's schema.
   *  Keyed by ParamDef.key. Built-in types ignore this field. */
  customParams?: Record<string, string | number | boolean>;
  /** Flow node id that OWNS this Space in "Live" mode (materialised from that node's live output). Owned
   *  Spaces are wiped + redrawn on every flow change so they track the node's parameters in real time, and
   *  they're kept INERT to auto-room detection / suppression (they never split or hide native Spaces). */
  flowOwner?: string;
}

/** Serialized Flow graph (the Flow overlay's export/import shape) persisted on a Room. */
export interface SerializedFlowNode {
  id: string;
  position?: { x: number; y: number };
  /** React Flow node type. Omitted/"op" for tool nodes; "group" for a container box. */
  type?: string;
  /** Parent group id (for nodes inside a group); their `position` is parent-relative. */
  parentId?: string;
  /** Group container box size (only for `type: "group"`). */
  width?: number;
  height?: number;
  data: { tool: string; params: Record<string, unknown> };
}
export interface SerializedFlowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}
export interface SerializedFlow {
  version: number;
  nodes: SerializedFlowNode[];
  edges: SerializedFlowEdge[];
}

export type ObjectKind = "rect" | "circle" | "polygon" | "freehand" | "text" | "segment" | "dimension";

/** Scope filter applied while the Select tool is active.
 *  - "all": pick anything (current behavior — default).
 *  - "node": only wall endpoints / corner nodes are selectable.
 *  - "segment": only walls / segment lines are selectable.
 *  - "space": only Room polygons are selectable.
 *  - "graph": clicking any segment selects its whole connected component (links + shared-endpoint
 *    nodes) — a flood-fill across junctions, so a drawn network selects as one unit.
 *  Doors/windows/objects always fall back to "all" — only available without a scope. */
export type SelectFilter = "all" | "node" | "segment" | "space" | "graph" | "image" | "grid" | "dimension";

export type Tool =
  | "select"
  | "wall"
  | "room"
  | "rect"
  | "circle"
  | "freehand"
  | "text"
  | "segment"
  | "measure"
  | "scale"
  /** "Set Scale → By Area" — click a space/polygon, then enter its real-world area to rescale the drawing. */
  | "scale-area"
  | "pan"
  | "door"
  | "window"
  | "point"
  /** "Add Space → Shapes → Rectangle" — click-click trace that emits a Space (Room). */
  | "space-rect"
  /** "Add Space → Shapes → Circle" — click center, drag for radius, type exact radius. */
  | "space-circle"
  /** "Add Segment" (drawing toolbar) — click-click for a single straight line segment. */
  | "single-segment"
  /** "Dimension" (drawing toolbar) — click two points to place a standalone Dimension annotation. */
  | "dimension";

export interface BaseObject {
  id: string;
  /** Layer this object lives on. Missing/unknown values resolve to `DEFAULT_LAYER_ID` (`"0"`). */
  layerId?: string;
  x: number;
  y: number;
  rotation: number;
  stroke: string;
  fill: string;
}

export interface RectObject extends BaseObject {
  kind: "rect";
  width: number;
  height: number;
}

export interface CircleObject extends BaseObject {
  kind: "circle";
  radius: number;
}

export interface PolygonObject extends BaseObject {
  kind: "polygon";
  points: number[];
}

export interface FreehandObject extends BaseObject {
  kind: "freehand";
  points: number[];
}

export interface TextObject extends BaseObject {
  kind: "text";
  text: string;
  fontSize: number;
}

export type SegmentSubtype = "drawn" | "adjacency";
export type AdjacencyConstraint = "connection" | "repulsion";

export interface SegmentObject extends BaseObject {
  kind: "segment";
  points: number[];
  measurements: string[];
  totalText: string;
  /** "drawn" (default, manually drawn) or "adjacency" (auto-computed between two rooms). */
  segmentSubtype?: SegmentSubtype;
  /** For adjacency subtype: endpoints reference room IDs and points are derived from centroids. */
  aRoomId?: string;
  bRoomId?: string;
  /** For adjacency subtype: the relation type. */
  constraint?: AdjacencyConstraint;
}

/** A dimension annotation: a measured line between two world points, rendered with end ticks
 *  (arrowheads or slash marks), the measured length as a label, and optional perpendicular offset.
 *  It is a selectable canvas object; its `stroke` is the line/text colour. Length is computed live
 *  from `points` + the current unit, so changing units re-labels it automatically. */
export interface DimensionObject extends BaseObject {
  kind: "dimension";
  /** Measured endpoints in world px: [x1, y1, x2, y2]. */
  points: number[];
  /** End-tick style — arrowheads ("arrow") or 45° architectural slashes ("line"). Defaults to "arrow". */
  tickStyle?: "arrow" | "line";
  /** Draw the dimension line connecting the two ends. Defaults to true. */
  showLine?: boolean;
  /** Append the current unit (m / ft / cm) to the length label. Defaults to true. */
  showUnits?: boolean;
  /** Perpendicular offset (px) of the dimension line from the measured segment (0 = on the segment). */
  offset?: number;
}

export type FloorObject = RectObject | CircleObject | PolygonObject | FreehandObject | TextObject | SegmentObject | DimensionObject;

/** One adjustable Input Property of a parametric object file (Door / Window / …). Mirrors the
 *  Schema/Flow param shape so the existing property renderers can drive it. */
export interface ParametricObjectParam {
  key: string;
  label: string;
  kind: "number" | "select" | "checkbox" | "text" | "color";
  default: number | string | boolean;
  /** Optional binding role. For a `canvas` / `titleblock` object, this maps the param onto a Layout
   *  sheet field via {@link INFO_ROLE_TO_PROP} (e.g. "drawing-title", "scale", "north-rotation"). Mirrors
   *  {@link GraphPropDef.role} so the same Properties renderer (`SchemaPropsBlock`) can drive it. */
  role?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Optional visibility gate: an expression over the object's OWN parameter values (e.g. `"have_spine"` or
   *  `"mode == 'stepped'"`). When it evaluates falsy the field is hidden from the Properties / creation UI —
   *  the value still exists and drives geometry. Absent ⇒ always shown. Evaluated by the shared expr engine. */
  showWhen?: string;
}

/** A self-contained parametric object loaded from a `.pobj.json` file — its identity + Input Properties
 *  schema + an optional declarative `geometry` block. When `geometry` is present, an attached instance
 *  renders its OWN lines (2D plan) and 3D mesh from the parameters (evaluated by `evalParametricGeometry` /
 *  `evalParametricPrisms`); otherwise it falls back to the placeholder `meta.symbol`. */
/** Toolbar / menu glyph for a parametric object. Two inline forms, both self-contained in the `.pobj.json`:
 *  - a `src` string — a `data:` URI or URL, rendered via `<img>` (any SVG/raster, but no `currentColor` theming);
 *  - `{ paths }` — inline SVG stroke-path `d` strings, rendered into a fixed 24×24 `<svg>` that inherits
 *    `currentColor` (themeable, safe — no arbitrary markup/scripts). Prefer this for monochrome toolbar icons. */
export type ParametricObjectIcon = string | { paths: string[] };

/** One node in a pobj's explicit `flow` decompilation (see {@link ParametricObjectFile.flow}). `tool` is the
 *  Flow tool id (e.g. "inset", "circle-packing", "cylinder"). `id` names the node (default `tool_<i>`).
 *  `from` is the geometry-source node id: omit → chain from the previous geometry node (or the Space source);
 *  `null` → no geometry input (a source primitive like a 3D Cylinder). `params` are literal node params.
 *  `bind` maps a node param key → an object parameter key: it BAKES that param's live value onto the node AND,
 *  when the node exposes `valin-<nodeKey>`, wires an edge `Object.val-<objKey>` → `node.valin-<nodeKey>`. */
export interface PobjFlowNode {
  tool: string;
  id?: string;
  from?: string | null;
  params?: Record<string, number | string | boolean>;
  bind?: Record<string, string>;
}

export interface ParametricObjectFile {
  kind: "parametric-object";
  version: number;
  /** `symbol` selects the placeholder 2D plan symbol drawn for instances ("door" swing, "window"
   *  frame+glass, "staircase" steps) when the file has no `geometry` block. Defaults to "door".
   *  `icon` is the toolbar/menu glyph (Add Segment/Node/Space dropdowns) — see {@link ParametricObjectIcon};
   *  when absent the menu falls back to a built-in Lucide icon keyed by `symbol`. */
  meta: { id: string; name: string; category?: string; units?: string; symbol?: "door" | "window" | "staircase" | "floor" | "wall" | "massing" | "titleblock" | "settings"; icon?: ParametricObjectIcon };
  parameters: ParametricObjectParam[];
  /** Which host this object is drawn onto from the toolbar — set when imported via a Floorplan-Tracer
   *  folder (Nodes → "node", Segments → "segment", Spaces → "space", Canvas → "canvas"). Drives the
   *  Add Node / Add Segment / Add Space menus and the auto-attach when the matching element is drawn /
   *  selected. `canvas` objects (e.g. the Layout title block) attach to the project sheet, not an element. */
  hostKind?: "node" | "segment" | "space" | "canvas";
  /** Declarative geometry generator (vars + cases + box rules with expression strings). Passed verbatim to
   *  `evalParametricGeometry` (plan) / `evalParametricPrisms` (3D mesh). Kept loose — the evaluator validates. */
  geometry?: Record<string, unknown>;
  /** Optional explicit Flow decompilation: an ordered semantic node list that the "Edit in Flow" / import-to-
   *  flow path materialises into a wired graph (Object Node → these nodes). Positions + edges are DERIVED
   *  (never stored) so it survives node-schema changes. See {@link PobjFlowNode}. */
  flow?: { nodes?: PobjFlowNode[] };
  /** Opt-in auto-decompile mode. `"primitives"` → on import, the object's `geometry` rules are decomposed into
   *  separate 2D-primitive Flow nodes (a `box` rule → a Rectangle node, a `circle` rule → a Circle node, with
   *  evaluated dimensions baked in). A pilot for turning a rules object into an editable primitive graph. */
  decompile?: "primitives";
  /** Structural carve flag: placed instances of this object SUBTRACT their plan footprint from the wall
   *  band — 2D wall fills are clipped around the object and 3D wall volumes get the footprint punched
   *  through (plan-space boolean, full wall height). For columns / shafts / pilasters: the wall must not
   *  draw through them. General: any object can opt in; the carve shape is the object's own evaluated
   *  2D fill (rectangular, circular, rotated — whatever the geometry rules produce). */
  cutsWall?: boolean;
}

/** An instance of a parametric object bound to a host segment: which library object, its per-instance
 *  parameter values, and host placement (position `t` along the segment 0..1, and which side it faces). */
export interface SegmentAttachment {
  id: string;
  objectId: string;
  params: Record<string, number | string | boolean>;
  /** Per-instance overrides for NESTED components (`ref` rules inside the object), keyed by ref-instance
   *  path (e.g. "door.single.v1", "window[2]") → {paramKey: value}. SketchUp-style nested editing: params the
   *  parent binds in its `ref.params` stay driven by the parent; these overrides cover the free ones. */
  childParams?: Record<string, Record<string, number | string | boolean>>;
  /** Position along the host segment, 0 (start) → 1 (end). */
  t: number;
  /** Mirror the object to the other side of the segment. */
  flip?: boolean;
  /** The graph id of the `pobj-source` flow node this attachment is mirrored to (set when attaching a Node
   *  object, which auto-injects `pobj-source → Node`). Binds the two param stores so editing either side
   *  keeps them in sync. Absent for attachments with no flow node. */
  flowNodeId?: string;
}

/** An instance of a parametric object bound to the project canvas (not a node / segment / space) — e.g.
 *  the Layout sheet title block. A sheet-level singleton, keyed by sheet id in {@link FloorPlanState.canvasObjects}.
 *  `params` holds the per-instance field values (keyed by each param's `role ?? key`, matching SchemaPropsBlock). */
export interface CanvasAttachment {
  id: string;
  objectId: string;
  params: Record<string, number | string | boolean>;
}

export interface FurnitureItem {
  id: string;
  type: "bed" | "sofa" | "table" | "chair" | "door" | "window";
  /** Layer this furniture lives on. Missing/unknown values resolve to `DEFAULT_LAYER_ID` (`"0"`). */
  layerId?: string;
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Door only: swing arc sweep in degrees (0 = closed, 90 = fully open). Default 90 when omitted. */
  doorSwingDeg?: number;
  /** Door only: when true, swing arc opens on the opposite face of the wall (inside vs outside in plan). */
  doorSwingFlip?: boolean;
  /** Door only: the two room labels this door connects. Used to reposition when rooms move. */
  connectionRooms?: [string, string];
}

export interface ImageUnderlay {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  scale: number;
  locked: boolean;
  /** Layer this underlay lives on. Missing/unknown values resolve to `DEFAULT_LAYER_ID` (`"0"`).
   *  New uploads (image or PDF raster) are stamped with `DEFAULT_IMAGE_LAYER_ID` ("image") so
   *  toggling the Image layer hides them. */
  layerId?: string;
}

export interface RoomConstraint {
  label: string;
  minArea: number;
  maxRatio: number;
}

/** OSM map overlay state. When set, the MapTileLayer renders OSM tiles below the
 *  drawing layers. `anchor` maps the world coord (0,0) to a geographic lat/lon, and
 *  `zoom` is an integer OSM zoom level (typically 16–19 for site-scale work). */
export interface MapOverlayState {
  anchor: { lat: number; lon: number };
  zoom: number;
}

/** Per-node metadata edited in the Node properties tab. Persisted in the model, keyed by the
 *  node's stableKey (its connected wall ids/ends) so it sticks to the node as it moves. When
 *  `type` is "column", `columnShape` chooses a circular column (radius) or rectangular one
 *  (dimX × dimY). Geometry values are in METRES (canonical, unit-independent). */
export interface NodeMeta {
  label?: string;
  /** When true, draw this node's label at the node on the canvas (Node Properties → Display → Show Label). */
  showLabel?: boolean;
  /** Node classification. "point" (default) is a plain node with no footprint; "column" / "tree"
   *  render a semantic footprint in Architectural view; "object" tags a furniture/fixture item
   *  whose specific kind is given by `objectKind`. */
  type?: "point" | "column" | "tree" | "object";
  columnShape?: "circular" | "rectangular";
  radius?: number;
  dimX?: number;
  dimY?: number;
  /** Furniture/fixture kind when `type` is "object" (e.g. "bed", "sofa"). See NODE_OBJECT_KINDS. */
  objectKind?: string;
  /** Object symbol footprint in METRES: width (along x), height (along y, plan depth). When unset,
   *  the kind's default size is used. */
  objWidth?: number;
  objHeight?: number;
  /** Distance in METRES from the symbol's bottom edge up to the node anchor (vertical placement).
   *  0 = the node sits on the object's bottom edge. */
  objOffsetBottom?: number;
  /** Symbol rotation in degrees (clockwise), pivoting about the anchor point. Default 0. */
  objRotation?: number;
  /** Which point of the object's box coincides with the node. Default "center". */
  objAnchor?: ObjectAnchor;
  /** Space this object node is associated with (display id, e.g. "Space003"). When set, the object is
   *  placed ON that space's boundary at `boundaryPosition` and drag is constrained to the perimeter. */
  connectedSpaceId?: string;
  /** Position 0–100 along the connected space's perimeter (boundary-placed objects). Default 50. */
  boundaryPosition?: number;
  /** Inward setback (metres) from the connected space's boundary. Default 0. */
  boundarySetback?: number;
  /** 2D node-marker shape (Display block). Default "dot". */
  dispShape?: "dot" | "circle" | "square" | "triangle";
  /** 2D node-marker stroke/fill treatment (Display block). Default "solid". */
  dispStyle?: "solid" | "dashed" | "dotted";
  /** Node-marker stroke/fill colour (Display block). Falls back to the default slate when unset. */
  dispColor?: string;
  /** Node-marker size multiplier on the base radius (Display block). Default 1. */
  dispSize?: number;
  /** Fill the node marker with a hatch pattern (Display block) instead of a solid fill. */
  hatch?: boolean;
  /** Hatch pattern kind. Default "diagonal". */
  hatchStyle?: "diagonal" | "dots";
  /** Hatch spacing in world pixels (line gap / dot pitch). Default 8. */
  hatchSpacing?: number;
  /** Hatch rotation in degrees (diagonal only). Default 45. */
  hatchAngle?: number;
  /** Hatch line thickness / dot radius factor. Default 1. */
  hatchWeight?: number;
  /** Parametric object instances attached to this node (e.g. a parametric Staircase). */
  attachments?: SegmentAttachment[];
}

/** Placement point of an object symbol relative to the node. */
export type ObjectAnchor = "center" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

/** Options for the Anchor dropdown, in display order. */
export const OBJECT_ANCHORS: { value: ObjectAnchor; label: string }[] = [
  { value: "center", label: "Center" },
  { value: "top-left", label: "Top-Left" },
  { value: "top-right", label: "Top-Right" },
  { value: "bottom-left", label: "Bottom-Left" },
  { value: "bottom-right", label: "Bottom-Right" },
];

/** Selectable kinds for an "object" node, shown in the Node properties Kind dropdown. `w`/`h` are
 *  default plan sizes in metres, used until the user overrides width/height. */
export const NODE_OBJECT_KINDS: { value: string; label: string; w: number; h: number }[] = [
  { value: "bed", label: "Bed", w: 1.5, h: 2.0 },
  { value: "sofa", label: "Sofa", w: 2.0, h: 0.9 },
  { value: "table", label: "Table", w: 1.2, h: 0.8 },
  { value: "chair", label: "Chair", w: 0.5, h: 0.5 },
  { value: "desk", label: "Desk", w: 1.4, h: 0.7 },
  { value: "wardrobe", label: "Wardrobe", w: 1.2, h: 0.6 },
  { value: "bookshelf", label: "Bookshelf", w: 1.0, h: 0.3 },
  { value: "cabinet", label: "Cabinet", w: 0.8, h: 0.5 },
  { value: "refrigerator", label: "Refrigerator", w: 0.7, h: 0.7 },
  { value: "stove", label: "Stove", w: 0.6, h: 0.6 },
  { value: "sink", label: "Sink", w: 0.6, h: 0.5 },
  { value: "toilet", label: "Toilet", w: 0.4, h: 0.7 },
  { value: "bathtub", label: "Bathtub", w: 1.7, h: 0.75 },
  { value: "washbasin", label: "Washbasin", w: 0.6, h: 0.45 },
  { value: "tv-unit", label: "TV Unit", w: 1.6, h: 0.4 },
];

/** Default plan size (metres) for an object kind; falls back to a 1×1 box for unknown kinds. */
export const objectKindDefaultSize = (kind?: string): { w: number; h: number } => {
  const k = NODE_OBJECT_KINDS.find((o) => o.value === kind);
  return k ? { w: k.w, h: k.h } : { w: 1, h: 1 };
};

// ── Graph schema (imported JSON) — user-defined properties for canvas graph nodes & segments ──
/** One user-defined property from an imported graph schema. Rendered in the Properties tab for
 *  every canvas graph node ("node" set) or segment ("segment" set), ALONGSIDE the built-in
 *  properties (the schema only adds; it never replaces). `role` binds the property to a solver
 *  input — e.g. the pipe solver reads node "elevation"/"demand"/"fixedHead"/"head" and segment
 *  "diameter"/"roughness"/"minorLoss"/"length" — so the JSON decides which key feeds what. */
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
  /** Solver binding (see above). Properties without a role are carried but not consumed. */
  role?: string;
  decimals?: number;
  /** Conditional visibility: only render this property when another property's current value matches.
   *  `when` is the discriminator property's key; the row shows when its value `equals` the given value,
   *  or is `in` the given list. Used for type-driven schemas (e.g. door fields shown only when
   *  type === "door"). Omitted → always shown. */
  showIf?: { when: string; equals?: string | number | boolean; in?: (string | number | boolean)[] };
}

/** One read-only result row a solver publishes per component (shown in the Metrics tab). */
export interface GraphResultDef { key: string; label?: string; unit?: string; decimals?: number }

/** An imported graph schema: extra node/segment properties + the result rows to display. */
export interface GraphSchema {
  name?: string;
  node?: GraphPropDef[];
  segment?: GraphPropDef[];
  results?: { node?: GraphResultDef[]; segment?: GraphResultDef[] };
}

export type GraphAttrValue = number | string | boolean;

/** A parametric construction grid placed on the canvas (Create Grid tool). Stores its definition; the
 *  lattice lines are derived for rendering. `x,y` is the top-left origin (world px); cells are cellW×cellH
 *  px (= cell size in metres × pixelsPerMeter at creation). */
export interface GridDef {
  id: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  cellW: number;
  cellH: number;
  rotation?: number;
  color?: string;
  layerId?: string;
  /** Optional per-cell value generation: each cell (reading order) gets min, min+delta, … cycling up to
   *  max. When `delta` > 0 and `max` > `min`, the generated value is drawn in each cell. */
  minValue?: number;
  maxValue?: number;
  delta?: number;
  /** When set, each cell gets a (deterministic) random value in [min, max] instead of the cycling
   *  sequence. Snapped to the `delta` grid when `delta` > 0. */
  randomValues?: boolean;
  /** Seed for the deterministic random-value hash — kept stable across renders; reshuffle bumps it. */
  randomSeed?: number;
}

/** Per-cell value for a grid's "Range of values". `ordinal` is the row-major cell index (j*cols + i).
 *  Random mode: deterministic hash of (seed, ordinal) mapped into [min, max], snapped to the `delta`
 *  grid when delta > 0. Sequential mode: min, min+delta, … cycling up to max. Returns null when no
 *  value applies (e.g. delta = 0 in sequential mode, or max ≤ min). */
export function gridCellValue(g: GridDef, ordinal: number): number | null {
  const gMin = g.minValue ?? 0, gMax = g.maxValue ?? 0, gDelta = g.delta ?? 0;
  if (g.randomValues) {
    if (gMax <= gMin) return null;
    let h = ((ordinal + 1) * 2654435761 + (g.randomSeed ?? 1) * 40503) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    const r = (h >>> 0) / 4294967296;
    let v = gMin + r * (gMax - gMin);
    if (gDelta > 0) v = gMin + Math.round((v - gMin) / gDelta) * gDelta;
    return Math.min(gMax, Math.max(gMin, v));
  }
  if (gDelta > 0 && gMax > gMin) {
    const steps = Math.floor((gMax - gMin) / gDelta) + 1;
    return gMin + (ordinal % steps) * gDelta;
  }
  return null;
}

export interface FloorPlanModel {
  walls: Wall[];
  rooms: Room[];
  objects: FloorObject[];
  furniture: FurnitureItem[];
  /** Parametric construction grids (Create Grid tool). */
  grids?: GridDef[];
  imageUnderlay: ImageUnderlay | null;
  /** Optional OSM overlay configuration. Renders only when the "map" layer is visible. */
  mapOverlay?: MapOverlayState | null;
  constraints?: {
    rooms: RoomConstraint[];
    connections: [string, string][];
  };
  /** User-defined room-type registry. Keyed by slug (= the value stored in room.roomType).
   *  Built-in types (`room`, `floorplate-boundary`, `plot-boundary`) are NOT stored here —
   *  they remain hardcoded so existing code paths keep working unchanged. */
  customRoomTypes?: Record<string, AreaTypeDef>;
  /** User-defined segment-type registry. Keyed by slug (= the value stored in wall.segmentType).
   *  Built-ins (`wall`, `door`, `window`, `plot-boundary`) are NOT stored here. */
  customSegmentTypes?: Record<string, AreaTypeDef>;
  /** Imported parametric object files (Door / Window / …), keyed by object id. Segment attachments
   *  reference these; persisted so a project keeps its object library. */
  objectLibrary?: Record<string, ParametricObjectFile>;
  /** AutoCAD-style layer table. Always non-empty (a default `"0"` layer is seeded).
   *  Per-entity `layerId` references entries here; missing/unknown references resolve to `"0"`. */
  layers?: Layer[];
  /** Canvas scale: pixels per metre. Persisted so an imported file renders at the same scale
   *  it was authored at. Defaults to 50 when absent. */
  pixelsPerMeter?: number;
  /** Per-node metadata (label / column / tree), keyed by node stableKey. See {@link NodeMeta}. */
  nodeMeta?: Record<string, NodeMeta>;
  /** Parametric objects attached to LIVE Path spaces (Display mode "Path"), keyed by the derived
   *  room id (`path-space:<smallest member wall id>`). The rooms themselves are recomputed from the
   *  path segments and never stored in `rooms`, so their attachments persist here instead. */
  pathSpaceAttachments?: Record<string, SegmentAttachment[]>;
  /** Schema-defined attribute values for canvas components, edited in the Properties tab.
   *  `nodes` is keyed by node stableKey, `segments` by wall id, `spaces` by room id and
   *  `graphs` by graph display id; each entry maps a schema property key → its value. Only
   *  user-edited values are stored (defaults come from the schema), so loading a schema never
   *  disturbs existing data. */
  graphAttrs?: {
    nodes: Record<string, Record<string, GraphAttrValue>>;
    segments: Record<string, Record<string, GraphAttrValue>>;
    spaces?: Record<string, Record<string, GraphAttrValue>>;
    graphs?: Record<string, Record<string, GraphAttrValue>>;
    /** Non-geometric "Information" records (e.g. the Layout title block), keyed by record id.
     *  Like `graphs`, these carry no canvas geometry — they hold schema-driven sheet metadata
     *  (consultancy / project / scale / …) fed to the Layout sheet. Legacy: superseded by
     *  {@link FloorPlanState.canvasObjects} when a `titleblock` parametric object is attached. */
    information?: Record<string, Record<string, GraphAttrValue>>;
  };
  /** Canvas-attached parametric objects (e.g. the Layout title block), keyed by sheet id. Each entry is a
   *  {@link CanvasAttachment} whose object lives in {@link objectLibrary}; its `params` drive the sheet. */
  canvasObjects?: Record<string, CanvasAttachment>;
}

/** AutoCAD-style layer. Every drawable entity carries a `layerId` referencing one of these. */
export interface Layer {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  /** Paint order — higher values draw on top. Default `0` for the seed layer. */
  order: number;
}

/** Built-in default layer id. Always present in `FloorPlanModel.layers` and cannot be deleted. */
export const DEFAULT_LAYER_ID = "0";

/** Returns a fresh seed layer table containing the default `"0"` layer plus
 *  Wall / Door / Window. Created entities are auto-stamped onto the appropriate
 *  layer by segmentType so users get sensible defaults without having to set
 *  the active layer first. */
export const DEFAULT_WALL_LAYER_ID = "wall";
export const DEFAULT_DOOR_LAYER_ID = "door";
export const DEFAULT_WINDOW_LAYER_ID = "window";
export const DEFAULT_FURNITURE_LAYER_ID = "furniture";
export const DEFAULT_IMAGE_LAYER_ID = "image";
export const DEFAULT_SPACE_LAYER_ID = "space";
export const DEFAULT_PARTITION_LAYER_ID = "partition";
export const DEFAULT_MAP_LAYER_ID = "map";
export const DEFAULT_SITE_LAYER_ID = "site-area";
export const DEFAULT_BUILDABLE_LAYER_ID = "buildable-area";
export const DEFAULT_FOOTPRINT_LAYER_ID = "footprint-area";
export const DEFAULT_BASEMENT_LAYER_ID = "basement-area";
export const DEFAULT_INSET_LAYER_ID = "inset-area";
export const DEFAULT_DEDUCTION_LAYER_ID = "deduction-area";
export const DEFAULT_DIMENSION_LAYER_ID = "dimension";
/** Layer IDs grouped under the foldable "Site" block in the Layers panel.
 *  Membership drives both the UI grouping and any future "lock the whole
 *  Site cascade" actions. */
export const SITE_GROUP_LAYER_IDS: ReadonlySet<string> = new Set([
  DEFAULT_SITE_LAYER_ID,
  DEFAULT_BUILDABLE_LAYER_ID,
  DEFAULT_FOOTPRINT_LAYER_ID,
  DEFAULT_BASEMENT_LAYER_ID,
  DEFAULT_INSET_LAYER_ID,
  DEFAULT_DEDUCTION_LAYER_ID,
]);
/** Layer IDs grouped under the foldable "Default" block in the Layers panel — the built-in Layer 0 plus
 *  the Image underlay and Map system layers. */
export const DEFAULT_GROUP_LAYER_IDS: ReadonlySet<string> = new Set([
  DEFAULT_LAYER_ID,
  DEFAULT_IMAGE_LAYER_ID,
  DEFAULT_MAP_LAYER_ID,
  DEFAULT_DIMENSION_LAYER_ID,
]);
/** The seed layer table. Intentionally MINIMAL — only the built-in Layer "0". All type layers
 *  (Wall / Door / Window / Node / Segment …) are now SCHEMA-DRIVEN: load a workflow template whose
 *  Schema feeds a "Schema to Layers" node and the matching foldable Node / Segment layer blocks appear
 *  live in the Layers panel. With no template loaded, the panel shows just Layer 0.
 *
 *  The DEFAULT_*_LAYER_ID constants below remain exported (entities still carry these layerIds for
 *  auto-stamping / color-by-type), but unknown layerIds resolve to visible, so nothing disappears. */
export const defaultLayerTable = (): Layer[] => [
  { id: DEFAULT_LAYER_ID,       name: "0",     color: "#000000", visible: true,  locked: false, order: 0 },
  // Image underlay layer — seeded so the imported reference image can be toggled / locked.
  { id: DEFAULT_IMAGE_LAYER_ID, name: "Image", color: "#a855f7", visible: true,  locked: false, order: 1 },
  // Map is a system layer (not a drawing-type layer): seeded but hidden. Toggling it visible opens the
  // OSM search panel; an imported GeoJSON / OSM overlay renders under the drawing when it's visible.
  { id: DEFAULT_MAP_LAYER_ID,   name: "Map",   color: "#0284c7", visible: false, locked: false, order: 2 },
  // Dimension annotations layer — toggle to hide / show all dimension objects at once.
  { id: DEFAULT_DIMENSION_LAYER_ID, name: "Dimension", color: "#b45309", visible: true, locked: false, order: 3 },
];

/** Layer for a given Space (room) type. Drives the auto-assignment in the
 *  Properties type selector and the BUA commit paths so a Space lands on its
 *  dedicated layer without the user having to switch active layer first. */
export const layerForRoomType = (roomType: string | undefined): string => {
  switch (roomType) {
    // "Site Area" is the Properties label for the plot-boundary Space type.
    case "plot-boundary":       return DEFAULT_SITE_LAYER_ID;
    case "buildable-area":      return DEFAULT_BUILDABLE_LAYER_ID;
    case "floorplate-boundary": return DEFAULT_FOOTPRINT_LAYER_ID;
    case "basement-area":       return DEFAULT_BASEMENT_LAYER_ID;
    case "inset-area":          return DEFAULT_INSET_LAYER_ID;
    case "deduction-area":      return DEFAULT_DEDUCTION_LAYER_ID;
    default:                    return DEFAULT_SPACE_LAYER_ID;
  }
};

/** Migrate a (possibly older) FloorPlanModel into the layer-aware shape:
 *  – ensure `model.layers` exists and contains the default `"0"` layer
 *  – stamp `layerId = "0"` on every drawable entity that's missing it
 *  Call this on any model loaded from external storage (JSON file, project API). */
export const withLayerDefaults = (model: FloorPlanModel): FloorPlanModel => {
  const existing = model.layers && model.layers.length > 0 ? model.layers : [];
  const haveIds = new Set(existing.map((l) => l.id));
  // Add any built-in default layers (0, Wall, Door, Window) that the loaded model
  // is missing, without disturbing the user's other custom layers or their order.
  const seeds = defaultLayerTable().filter((s) => !haveIds.has(s.id));
  const layers: Layer[] = [...seeds, ...existing];
  const stamp = <T extends { layerId?: string }>(arr: T[] | undefined): T[] =>
    (arr ?? []).map((e) => (e.layerId ? e : { ...e, layerId: DEFAULT_LAYER_ID }));
  return {
    ...model,
    layers,
    walls: stamp(model.walls),
    rooms: stamp(model.rooms),
    objects: stamp(model.objects),
    furniture: stamp(model.furniture),
  };
};

/** Stored state from an auto-generated floor plan, enabling interactive room dragging. */
export interface GeneratedLayoutState {
  /** The generation config used (boundary, rooms, connections, etc.) */
  config: import("./floorplanAlgorithms").GenerateConfig;
  /** Current seed positions in meters (used to re-run BSP on drag) */
  seedPositions: Record<string, { x: number; y: number }>;
  /** Current room rectangles in pixel coords (for hit-testing drag targets) */
  roomRects: Array<{ label: string; x: number; y: number; w: number; h: number }>;
}
