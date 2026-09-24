/**
 * @builderpluss/engine — the expression language and computational-geometry library behind
 * parametric floorplans.
 *
 * TWO LAYERS, ONE PACKAGE. The expression language (`expr`, `matrix`) is the substrate: a pure
 * interpreter over matrices, with no host `eval` and no I/O. Everything else is computational
 * geometry built on the same primitives — 65 modules covering polygon operations, partitioning,
 * layout optimisation, wall graphs, skeletonisation and massing. They ship together because the
 * named algorithms in `expr/exprAlgorithms` are written as bodies of the language itself, so
 * splitting them would put a cycle between two packages.
 *
 * WHAT IS DELIBERATELY ABSENT. No renderer. Nothing here draws: the geometry functions return
 * `Point[]` rings and matrices, and it is the caller's business whether those become Konva
 * shapes, SVG paths, three.js meshes or a DXF. That is what lets one engine serve several apps.
 * Anything reaching the network or the DOM belongs in the host — the Gemini object-detection
 * adapter stayed behind for exactly that reason.
 *
 * TWO WAYS TO CALL IT. The functional API is the real implementation and what the interpreter
 * uses on its hot path. The classes (`Mat`, `Vec2`, `Vec3`, `Poly`) are immutable facades over
 * the same functions, for callers who would rather chain than nest. They share one
 * representation — `number[][]` and `Point[]` — so moving between them costs nothing.
 *
 *   import { runExprBody, computeInsetPolygon } from "@builderpluss/engine";
 *   import { Mat, Poly, Vec2 } from "@builderpluss/engine";
 *
 *   runExprBody("w = width * 2", { width: 0.9 });   // { w: 1.8 }
 *   Poly.of(ring).inset(3, 50).area;                // 3 m setback at 50 px/m
 *   Mat.of([[1, 2], [3, 4]]).transpose().multiply(other).toArray();
 *
 * A few names are exported by two independent modules and the root barrel can only carry one of
 * each (see the generator note). Reach a shadowed one through its folder:
 *   import { MeshType } from "@builderpluss/engine/partitioning";
 */

/** The geometry vocabulary. Narrow by design — see the note at the top of `types.ts`. */
export * from "./types.js";

/** The neutral 3D-mesh payload — the contract between computing a mesh and drawing one. */
export * from "./meshTypes.js";

/* The expression language — parser, interpreter, introspection, named algorithms. */
export * from "./expr/index.js";

/* Matrix primitives, 2D/3D booleans and mesh face builders. */
export * from "./matrix/index.js";

/* Polygon operations — inset, smoothing, clipping, contours, bounds, axes. */
export * from "./geometry/index.js";

/* Wall graphs — mitring, splitting, corner resolution, room detection. */
export * from "./walls/index.js";

/* Subdividing an area — Voronoi, BSP, treemap, Delaunay, convex decomposition. */
export { cellsToEdges, clipPolygonByHalfPlane, collectSharedVoronoiEdges, computeBspCells, computeBspCellsAdvanced, computeBspPartition, computeCapacityConstrainedCells, computeConvexDecomposition, computeConvexHull, computeCvtCells, computeCvtEdges, computeDelaunayTriangulation, computePowerDiagramCell, computePowerDiagramCells, computeRectilinearVoronoi, computeSquarifiedTreemap, computeSteinerEnrichment, computeVoronoiCells, computeVoronoiEdges, decomposeBayazit, decomposeSteinerEdgeExtension, enrichWithSteinerPoints, optimizeWeightsForTargetAreas, parseBspConnections, relaxCapacityConstrainedSeeds, relaxVoronoiSeeds, runRfp, serializeBspConnections } from "./partitioning/index.js";
export type { AdvancedBspOptions, AdvancedBspResult, BspEdge, BspOptions, BspSeed, ConvexDecompositionType, DelaunayResult, OptimizeOptions, PartitionEdge, PolygonMesh, RectVoronoiMetric, RfpConnection, RfpCut, RfpLeaf, RfpResult, RfpSeed, SteinerEnrichResult, TreemapCell, TreemapOptions, TreemapSeed, VoronoiMetric, WeightedSeed } from "./partitioning/index.js";

/* Fitting shapes into an area — the optimise* family and packing. */
export * from "./layout/index.js";

/* Building walls and frames from a schema, plus schema attribute resolution. */
export { ROLES, buildFootingLayers, buildStaircaseBoxes, computeFrame, computeMiteredWalls, computeWallDimensions, extractInteriorFaces, findDef, footingElevationPolys, footingMeshPrisms, footingPlanPolys, layerColor, readBool, readNum, readStr, resolveBool, resolveNum, resolveStr, staircaseElevationPolys, staircaseMeshPrisms, toFootingSpec, toStaircaseSpec, wallsToGraphInput } from "./structure/index.js";
export type { FootingLayer, FootingSkew, FootingSpec, FootingType, FrameGraphInput, FramePiece, FrameResult, FrameSchema, StaircaseBox, StaircaseConfig, StaircaseSpec, WallDimResult, WallPiece, WallResult } from "./structure/index.js";

/* Medial-axis skeletonisation. */
export * from "./skeleton/index.js";

/* 3D massing — inset, smoothing and Voronoi over solids. */
export { insetMassFootprint, massVertices, smoothMassFootprint, voronoiCells3D } from "./mass/index.js";

/* Placing objects along a boundary. */
export * from "./placement/index.js";

/* Pipe-network solving. */
export * from "./network/index.js";

/* Region classification. */
export * from "./semantics/index.js";

/* Raster-to-vector tracing. */
export * from "./vector/index.js";

/* Development-control rules and setback solving. */
export { DEFAULT_REGULATIONS, HEIGHT_CAP_DEFAULT_M, HEIGHT_HIGHRISE_M, HEIGHT_TALL_M, LIFT_LOBBY_M2, OCCUPANCY_LABELS, ROAD_LOCATION_LABELS, STAIR_FOOTPRINT_M2, buildableAreaFromInset, corePerWing, frontSetback, frontSetbackFor, insetPolygon, liftsRequired, refugeFloors, runCircularSetbackSolver, setbacksFor, sideSetback, sideSetbackFromBands, stairWidthM, stairsPerCore } from "./dcr/index.js";
export type { FrontSetbackRule, Occupancy, OccupancyRules, Regulations, RoadLocation, RoadType, SetbackBand, SetbackSet, SolverInputs, SolverResult, SolverRow, SolverStatus } from "./dcr/index.js";

/* Chainable, immutable facades over the functional core. */
export { Mat } from "./classes/Mat.js";
export { Vec2, Vec3 } from "./classes/Vec.js";
export { Poly } from "./classes/Poly.js";
