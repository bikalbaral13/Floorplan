/** Client side of the Library — the R2 bucket is the ONLY home for library files. Reads go to the
 *  bucket's public domain; writes, deletes and listings go through the dev server's signed R2 bridge
 *  (`/__r2/*` in vite.config.ts). Every call degrades gracefully (ok:false / null) when the bridge is
 *  unavailable (production/static hosting), so callers fall back to download-only behaviour and the
 *  bundled manifests below.
 *
 *  TOP-LEVEL FOLDERS (the layout the whole app resolves against — see the LIB_* constants):
 *    Objects/    parametric objects (.pobj.json / .json) in category folders — the old "Parametric Objects"
 *    Tools/      flow NODE declarations + templates (.node.json) in category folders — the old "Flows/Nodes"
 *    Workflows/  whole flow graphs (nodes + connections) — the old "Flows" root + "Flows/Workflows"
 *    Designs/    exported whole-plan designs
 *    Agents/     agent definitions (.agent.json) */

import { cloudLibraryUrl, fetchFromCloudLibrary, listCloudLibraryFiles, saveToCloudLibrary, deleteFromBucket, cloudLibraryStatus } from "./cloudLibrary";

/** Library root for parametric objects (was "Parametric Objects"). */
export const LIB_OBJECTS = "Objects";
/** Library root for flow node declarations / templates (was "Flows/Nodes"). */
export const LIB_TOOLS = "Tools";
/** Library root for whole flow graphs (was "Flows" / "Flows/Workflows"). */
export const LIB_WORKFLOWS = "Workflows";
/** Library root for exported whole-plan designs. */
export const LIB_DESIGNS = "Designs";
/** Library root for agent definitions. */
export const LIB_AGENTS = "Agents";

export interface LibrarySaveResult { ok: boolean; path?: string; error?: string }

/** Category folder of Library/Objects for a .pobj file — the folders are SEMANTIC
 *  (Kitchen / Furniture / Bathroom / MEP / Structural / Architectural / Site / System / Decor / Parking /
 *  Services / Outdoor / Puja / Utility / Hydraulics / Electronics); the
 *  hostKind lives inside the file, not the folder. Keyword-matched from meta.category, with a
 *  hostKind-based fallback for space/canvas objects; anything unmatched lands in "Misc". */
export function pobjFolderFor(category: string | undefined, hostKind: string | undefined): string {
  const c = (category ?? "").toLowerCase();
  if (/kitchen|cook|appliance/.test(c)) return "Kitchen";
  // "Electronics" before the electrical test — both contain "electr".
  if (/electronic|component|resistor|capacitor|semiconductor|pcb/.test(c)) return "Electronics";
  // Decor BEFORE the MEP "light|lamp" test — a "Decor/Lighting" floor/table lamp is decor, not a fixture.
  if (/decor|ornament|mirror|curtain|blind|vase|plant|clock|artwork|wall art/.test(c)) return "Decor";
  if (/parking|vehicle|garage|\bcar\b|\bbike\b|scooter|bollard/.test(c)) return "Parking";
  if (/lift|elevator|escalator|dumbwaiter|water.?tank|sump|service core|\bservices\b/.test(c)) return "Services";
  if (/outdoor|balcony|garden|patio|terrace|pergola|gazebo|swing|bbq|barbecue|landscape/.test(c)) return "Outdoor";
  if (/puja|pooja|prayer|mandir|temple|altar|worship/.test(c)) return "Puja";
  if (/utility|laundry|washing|dryer|ironing|store room/.test(c)) return "Utility";
  if (/hydraulic|spillway|ogee|weir|penstock|turbine|forebay|settling|gravel trap|\bdam\b|\bcanal\b|sediment/.test(c)) return "Hydraulics";
  // MEP (Mechanical / Electrical / Plumbing) — the former "Electrical" folder, broadened.
  if (/\bmep\b|electr|hvac|air.?con|socket|outlet|cctv|surveillance|doorbell|distribution|circuit|wiring|light|lamp|switch|chandelier|\bfan\b/.test(c)) return "MEP";
  if (/bath|sanitary|toilet|plumb/.test(c)) return "Bathroom";
  if (/furnit|bedroom|living|seating|office/.test(c)) return "Furniture";
  if (/struct|footing|column|frame|stair/.test(c)) return "Structural";
  if (/architect|door|window|wall|floorplan|opening/.test(c)) return "Architectural";
  if (hostKind === "space" || /site|massing|plot|zoning/.test(c)) return "Site";
  if (hostKind === "canvas" || /settings|title|sheet/.test(c)) return "System";
  return "Misc";
}

/** Write one file into the R2 Library. `relPath` is Library-relative, e.g.
 *  "Objects/Site/site.pobj.json" or "Workflows/my-flow.json". */
export async function saveLibraryFile(relPath: string, content: string): Promise<LibrarySaveResult> {
  const res = await saveToCloudLibrary(relPath.replace(/^\/+/, ""), content);
  return res.ok ? { ok: true, path: relPath } : { ok: false, error: res.error };
}

/** The public R2 URL of one Library-relative file ("Objects/Site/site.json"), or "" when no read
 *  domain is configured. Callers that want parsed JSON should use {@link fetchLibraryJson}. */
export async function libraryFileUrl(relPath: string): Promise<string> {
  return cloudLibraryUrl(relPath.replace(/^\/+/, ""));
}

/** Fetch + parse one Library-relative JSON file from the bucket. Null when absent. */
export async function fetchLibraryJson<T = unknown>(relPath: string): Promise<T | null> {
  return fetchFromCloudLibrary<T>(relPath.replace(/^\/+/, ""));
}

/** Fetch one Library-relative file as TEXT from the bucket, with the same forced revalidation as
 *  `fetchFromCloudLibrary`. Skills are markdown, so they cannot go through the JSON reader. */
export async function fetchLibraryText(relPath: string): Promise<string | null> {
  const url = await cloudLibraryUrl(relPath.replace(/^\/+/, ""));
  if (!url) return null;
  try {
    const res = await fetch(encodeURI(url), { cache: "no-cache" });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** List every file of the given extension under a Library subfolder (paths relative to it, e.g.
 *  "Site/site.pobj.json" for dir "Objects") — null when the bucket can't be enumerated (r2.dev serves
 *  objects but won't list them, so a production build needs the `/__r2/list` bridge), in which case
 *  callers fall back to the bundled manifest. Skills are markdown; pass ext "md" for those. */
export async function listLibraryFiles(dir: string, ext = "json"): Promise<string[] | null> {
  const suffix = `.${ext.replace(/^\./, "").toLowerCase()}`;
  const cloud = await listCloudLibraryFiles(dir);
  return cloud ? cloud.filter((f) => f.toLowerCase().endsWith(suffix)) : null;
}

/** Category-relative paths of every bundled object file under Library/Objects — the production
 *  fallback for {@link listParametricObjectFiles} (static hosting can't list directories; dev lists
 *  LIVE through the bridge). NEW bundled objects belong in their category folder AND here. */
export const BUNDLED_POBJ_FILES: string[] = [
  "Architectural/door.json", "Architectural/plant.json", "Architectural/wall.json", "Architectural/window.json",
  // IMAGE-HOSTED objects (`hostKind: "image"`) — they attach to an imported picture rather than to an
  // element, and list in the Image Object block on a selected image.
  "Architectural/ink-coverage.json",
  "Architectural/detect_all.json", "Architectural/detect_boundary.json", "Architectural/detect_doors.json",
  "Architectural/detect_objects.json", "Architectural/detect_rooms.json", "Architectural/detect_walls.json",
  "Architectural/detect_windows.json",
  "Architectural backup/core.box.v1.pobj.json", "Architectural backup/door.pobj.json",
  "Architectural backup/floorplan.pobj.json", "Architectural backup/path.v1.pobj.json",
  "Architectural backup/room.pobj.json", "Architectural backup/site.v1.pobj.json",
  "Architectural backup/staircase.space.v1.pobj.json", "Architectural backup/wall.pobj.json",
  "Architectural backup/window.pobj.json",
  "Furniture/piano.json",
  "Hydraulics/canal.json", "Hydraulics/gravel-trap.json", "Hydraulics/gravity-dam.json",
  "Hydraulics/ogee-spillway.json", "Hydraulics/settling-basin.json",
  "Hydraulics/sewage-treatment-plant.json", "Hydraulics/turbine.json", "Hydraulics/well.json",
  "New Objects/bansuri.json", "New Objects/bike.json", "New Objects/car.json",
  "Site/Circulation.pobj.json", "Site/Corridoor.pobj.json", "Site/core.pobj.json", "Site/floor-plate.pobj.json",
  "Site/floor.pobj.json", "Site/footprint-massing.pobj.json", "Site/massing.pobj.json", "Site/site.pobj.json",
  "Site/site_to_cores.pobj.json",
  "Structural/column.json", "Structural/footing.json", "Structural/staircase.json",
  "Structural/column.v1.pobj.json", "Structural/footing.pobj.json", "Structural/staircase.pobj.json",
  "System/node_settings.pobj.json", "System/segment_settings.pobj.json", "System/settings.pobj.json",
  "System/titleblock-a1.pobj.json",
];

/** Every `.json` under Library/Objects, category-relative (e.g. "Site/site.pobj.json"). Live
 *  dev-bridge listing when available — so agent-saved objects appear alongside the bundled set —
 *  otherwise the {@link BUNDLED_POBJ_FILES} manifest. */
export async function listParametricObjectFiles(): Promise<string[]> {
  const listed = await listLibraryFiles(LIB_OBJECTS);
  return listed?.length ? listed.filter((rel) => rel.toLowerCase().endsWith(".json")) : BUNDLED_POBJ_FILES;
}

/** Folder-relative paths of every bundled TOOL (flow node declaration / template) under
 *  Library/Tools — the production fallback for {@link listFlowNodeFiles} (static hosting can't
 *  list directories; dev lists LIVE through the bridge). Each `.node.json` names a `tool` + its params.
 *  NEW bundled tools belong in their category folder under Tools AND here. */
export const BUNDLED_FLOW_NODE_FILES: string[] = [
  // ONE template for the four SELECTABLE canvas sources: the Geometry node becomes a Point / Segment /
  // Graph / Space source from what is selected on the canvas (see GEOMETRY_KINDS in flow/flowTypes).
  // Freehand keeps its own template — its strokes are matched by colour, so no selection implies it.
  "Geometry/geometry.node.json",
  "Freehand/freehand-source.node.json",
  "Freehand/freehand-geometry.node.json",
  "Canvas/canvas-source.node.json",
  "Canvas/separate.node.json",
  "2d primitives/point.node.json",
  "2d primitives/rectangle.node.json",
  "2d primitives/arc.node.json",
  "2d primitives/circle.node.json",
  "2d primitives/line.node.json",
  "2d primitives/ellipse.node.json",
  "2d primitives/network.node.json",
  "2d primitives/polygon.node.json",
  "2d primitives/sector.node.json",
  "2d primitives/render-2d.node.json",
  "3d primitives/render-3d.node.json",
  "3d primitives/frustum.node.json",
  "3d primitives/tapered-box.node.json",
  "3d primitives/torus.node.json",
  "3d primitives/capsule.node.json",
  "3d primitives/cuboid.node.json",
  "3d primitives/cylinder.node.json",
  "3d primitives/sphere.node.json",
  "3d primitives/cone.node.json",
  "3d primitives/loop-3d.node.json",
  "3d primitives/transform-3d.node.json",
  "3d primitives/boolean-3d.node.json",
  "3d primitives/display-3d.node.json",
  "Space/space-creator.node.json",
  "Space/space-geometry.node.json",
  "Space/pull.node.json",
  "Space/transform.node.json",
  "Space/hatching.node.json",
  "Space/dimension.node.json",
  "Space/area-dimension.node.json",
  "Space/input-props.node.json",
  "Space/schema.node.json",
  "Space/output-schema.node.json",
  "Space/schema-to-drawing.node.json",
  "Space/schema-to-layers.node.json",
  "Space/merge.node.json",
  "Space/boolean-2d.node.json",
  "Space/layout-gen.node.json",
  "Reshape/inset.node.json",
  "Reshape/optimise-rect.node.json",
  "Reshape/smoothing.node.json",
  "Reshape/densify.node.json",
  "Reshape/bounding-shape.node.json",
  "Reshape/convex-hull.node.json",
  "Reshape/contour.node.json",
  "Partition/split.node.json",
  "Partition/loop.node.json",
  "Partition/bsp.node.json",
  "Partition/voronoi.node.json",
  "Partition/treemap.node.json",
  "Partition/rect-pack.node.json",
  "Partition/convex-decomp.node.json",
  "Partition/mesh.node.json",
  "Partition/circle-packing.node.json",
  "Partition/skeleton.node.json",
  "Partition/corridoor.node.json",
  "Partition/core-racking.node.json",
  "Partition/visibility.node.json",
  "Segment/segment-geometry.node.json",
  "Segment/segment-split.node.json",
  "Segment/display-segment.node.json",
  "Node/node-geometry.node.json",
  "Node/bloom.node.json",
  "Node/display-node.node.json",
  "Graph/mitered-join.node.json",
  "Graph/graph-geometry.node.json",
  "Graph/graph-to-matrix.node.json",
  "Graph/matrix-to-graph.node.json",
  "Graph/graph-to-path.node.json",
  "Graph/graph-to-openings.node.json",
  "Graph/label-graph.node.json",
  "Graph/graph-smooth.node.json",
  "Graph/graph-simplify.node.json",
  "Graph/graph-classify.node.json",
  "Graph/graph-clip.node.json",
  "Graph/graph-fit-lines.node.json",
  "Graph/graph-metrics.node.json",
  "Graph/merge-graph.node.json",
  "Graph/set-thickness.node.json",
  "Graph/show-direction.node.json",
  "Graph/graph-to-spaces.node.json",
  "Graph/graph-reduce.node.json",
  "Graph/voronoi-bloom.node.json",
  "Graph/spring-layout.node.json",
  "Graph/pipe-solver.node.json",
  "Grid/grid-source.node.json",
  "Grid/grid-geometry.node.json",
  "Grid/graph-to-grid.node.json",
  "Grid/grid-field.node.json",
  "Grid/cellular-automaton.node.json",
  "Grid/laplace-solver.node.json",
  "Grid/least-squares.node.json",
  "Grid/fill-depressions.node.json",
  "Grid/flow-direction.node.json",
  "Grid/flow-accumulation.node.json",
  "Grid/watershed.node.json",
  "Grid/morphology.node.json",
  "Grid/grid-distance.node.json",
  "Grid/grid-threshold.node.json",
  "Grid/marching-squares.node.json",
  "Grid/render-grid.node.json",
  "Grid/vector-ops.node.json",
  "Grid/vector-product.node.json",
  "Image/image.node.json",
  "Image/vectorise.node.json",
  "Image/object-detection.node.json",
  "Image/filter-by-label.node.json",
  "Logic/conditional.node.json",
  "Logic/param-manip.node.json",
  "Build/floor-massing.node.json",
  "Build/place-object.node.json",
  "Build/frame-builder.node.json",
  "Building/wall-builder.node.json",
  "Building/graph-to-room.node.json",
  "Building/segment-to-door.node.json",
  "Building/segment-to-window.node.json",
  "Building/node-to-object.node.json",
  "Mass/mass.node.json",
  "Mass/inset-3d.node.json",
  "Mass/smooth-3d.node.json",
  "Mass/mesh-to-3d.node.json",
  "Calculate/bua.node.json",
  "Calculate/file-upload.node.json",
  "Calculate/math-engine.json",
  "Output/output.node.json",
  "Output/render.node.json",
  "Output/analyse.node.json",
  "Output/generate.node.json",
  "Output/snapshot.node.json",
  "Output/export-dxf.node.json",
  "Output/export-3d.node.json",
  "Output/export-canvas.node.json",
  "AI/agent.node.json",
  "New Tools/bounding_ngon_with_math.json",
  "New Tools/bsp_with_math.json",
  "New Tools/convex_decomposition_with_math.json",
  "New Tools/inset_with_math.json",
  "New Tools/Tesselation.json",
  "New Tools/vectorise_with_math.json",
  "New Tools/watershed_with_math.json",
];

/** Every `.json` under Library/Tools, folder-relative (e.g. "2d primitives/point.node.json").
 *  Live dev-bridge listing when available — so user-saved tools appear alongside the bundled set —
 *  otherwise the {@link BUNDLED_FLOW_NODE_FILES} manifest. */
export async function listFlowNodeFiles(): Promise<string[]> {
  const listed = await listLibraryFiles(LIB_TOOLS);
  return listed?.length ? listed.filter((rel) => rel.toLowerCase().endsWith(".json")) : BUNDLED_FLOW_NODE_FILES;
}

/** Folder-relative paths of every bundled WORKFLOW under Library/Workflows — the production
 *  fallback for {@link listWorkflowFiles}, mirroring {@link BUNDLED_POBJ_FILES} and
 *  {@link BUNDLED_FLOW_NODE_FILES}. Without it the Import browser showed Objects and Tools but silently
 *  omitted Workflows, because those two fall back to a manifest and this one had nothing to fall back to.
 *  NEW bundled workflows belong in their category folder under Workflows AND here. */
export const BUNDLED_WORKFLOW_FILES: string[] = [
  "Architectural/floorplan.json",
  "Architectural/floorplan.v2.json",
  "Architectural/floorplan.v3.json",
  "Architectural/floorplan.v4.json",
  "Architectural/floorplan.v5.json",
  "Architectural/raster-to-plan.json",
  "Hydrology/gga-pipe-network.json",
  "Hydrology/least-squares-normal-equations.json",
  "Hydrology/pipe-network-flow.json",
  "Hydrology/pipe-network.json",
  "Miscellaneous/Floorplate Optimisation.json",
  "Miscellaneous/freehand.json",
  "Miscellaneous/freehand2.json",
  "Miscellaneous/freehand_circulation.json",
  "Miscellaneous/freehand_skeleton.json",
  "Miscellaneous/freehandv3.json",
  "Miscellaneous/inset_to_segments.json",
  "Miscellaneous/layout-generation.json",
  "Miscellaneous/orient-furniture-agent.json",
  "Miscellaneous/site-massing.json",
  "Miscellaneous/site_to_building_envelope.json",
  "Miscellaneous/site_to_cores.json",
  "Miscellaneous/watershed-delineation.json",
  // Operations — one short DEMO per named algorithm, each a single `Algorithms.…` call.
  "Operations/convex-hull.json",
  "Operations/inset-3d-maths.json",
  "Operations/inset.json",
  "Operations/mitered-join.json",
  "Operations/optimise-rectangle.json",
  "Operations/smooth-3d-maths.json",
  "Operations/straight-skeleton.json",
  "Operations/voronoi.json",
  "Structural/eigen-principal-axes.json",
  "Structural/fdm-1d-poisson.json",
  "Structural/load-takedown-chain.json",
  "Structural/structural-analysis-direct-stiffness.json",
  "Vectorisation/detect_doors_windows_walls.json",
  "Vectorisation/detect_furniture_points.json",
  "Vectorisation/detect_openings_one_call.json",
  "Vectorisation/detect_wall_junctions.json",
  "Vectorisation/detect_walls_from_vectorisation.json",
  "Vectorisation/object_detection_workflow.json",
  "Vectorisation/raster_to_vector_using_computer_vision.json",
  "Vectorisation/vectorisation_combined.json",
  "Render/Faithful_Space_Render.json",
];

/** Every `.json` under Library/Workflows, folder-relative (e.g. "Operations/inset.json").
 *  Live dev-bridge listing when available — so agent-saved and exported flows appear alongside the
 *  bundled set — otherwise the {@link BUNDLED_WORKFLOW_FILES} manifest. Same contract as the Objects and
 *  Tools listings, so the Import browser shows all three roots in dev AND in a production build. */
export async function listWorkflowFiles(): Promise<string[]> {
  const listed = await listLibraryFiles(LIB_WORKFLOWS);
  return listed?.length ? listed.filter((rel) => rel.toLowerCase().endsWith(".json")) : BUNDLED_WORKFLOW_FILES;
}

/** Full bucket key of a Library-relative path ("Tools/Reshape/inset.node.json" → "library/Tools/…"). */
async function bucketKey(relPath: string): Promise<string> {
  const { prefix } = await cloudLibraryStatus();
  const p = prefix.replace(/^\/+|\/+$/g, "");
  const rel = relPath.replace(/^\/+/, "");
  return p ? `${p}/${rel}` : rel;
}

/** Delete ONE file from the R2 Library by its Library-relative path (e.g. "Tools/Reshape/inset.node.json").
 *  Degrades to ok:false on production hosting. Used by the Flow Agent to remove node / workflow templates. */
export async function deleteLibraryFile(relPath: string): Promise<{ ok: boolean; deleted?: string; error?: string }> {
  const res = await deleteFromBucket(await bucketKey(relPath));
  return res.ok ? { ok: true, deleted: relPath } : { ok: false, error: res.error };
}

/** Delete the object files under Library/Objects whose meta.id matches one of `ids` (matched by file
 *  content, so renamed files are found too). Null when the bucket can't be listed. */
export async function deleteLibraryObjectFiles(ids: string[]): Promise<{ deleted: string[] } | null> {
  const want = new Set(ids);
  const files = await listLibraryFiles(LIB_OBJECTS);
  if (!files) return null;
  const deleted: string[] = [];
  for (const rel of files) {
    const path = `${LIB_OBJECTS}/${rel}`;
    const json = await fetchLibraryJson<{ meta?: { id?: unknown }; id?: unknown }>(path);
    const id = json?.meta?.id ?? json?.id;
    if (typeof id === "string" && want.has(id) && (await deleteLibraryFile(path)).ok) deleted.push(path);
  }
  return { deleted };
}
