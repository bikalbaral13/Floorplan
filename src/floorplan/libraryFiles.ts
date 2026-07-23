/** Client side of the dev-server Library file bridge (the `library-bridge` middleware in
 *  vite.config.ts). The browser can't write to the repo by itself, so saves POST to the dev server,
 *  which persists assets into `public/Library` — Flows / Designs / Parametric Objects — the single
 *  home for bundled files. Every call degrades gracefully (ok:false / null) when the bridge is
 *  unavailable (production/static hosting), so callers fall back to download-only behaviour. */

export interface LibrarySaveResult { ok: boolean; path?: string; error?: string }

/** Category folder of public/Library/Parametric Objects for a .pobj file — the folders are SEMANTIC
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

/** Write one JSON file inside public/Library. `relPath` is Library-relative, e.g.
 *  "Parametric Objects/Nodes/fan.v1.pobj.json" or "Flows/my-flow.json". */
export async function saveLibraryFile(relPath: string, content: string): Promise<LibrarySaveResult> {
  try {
    const res = await fetch("/__library/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath, content }),
    });
    // `body.ok` must be checked too: SPA fallbacks answer unknown routes with 200 + index.html.
    const body = (await res.json().catch(() => null)) as (LibrarySaveResult & { ok?: unknown }) | null;
    return res.ok && body?.ok === true
      ? { ok: true, path: typeof body.path === "string" ? body.path : relPath }
      : { ok: false, error: body?.error ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** List every .json under a public/Library subfolder (paths relative to it, e.g.
 *  "Nodes/fan.v1.pobj.json" for dir "Parametric Objects") — null when the bridge is unavailable,
 *  so callers fall back to the bundled manifest. */
export async function listLibraryFiles(dir: string): Promise<string[] | null> {
  try {
    const res = await fetch(`/__library/list?dir=${encodeURIComponent(dir)}`);
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { files?: unknown } | null;
    return Array.isArray(body?.files) ? body.files.map(String) : null;
  } catch {
    return null;
  }
}

/** Category-relative paths of every bundled `.pobj` under public/Library/Parametric Objects — the
 *  production fallback for {@link listParametricObjectFiles} (static hosting can't list directories;
 *  dev lists LIVE through the bridge). NEW bundled objects belong in their category folder AND here. */
export const BUNDLED_POBJ_FILES: string[] = [
  "System/titleblock-a1.pobj.json", "System/settings.pobj.json", "System/segment_settings.pobj.json", "System/node_settings.pobj.json",
  "Site/floor.pobj.json", "Site/massing.pobj.json", "Site/footprint-massing.pobj.json", "Site/site.pobj.json",
  "Site/core.pobj.json", "Site/Corridoor.pobj.json", "Site/floor-plate.pobj.json", "Site/site-flow.v1.pobj.json",
  "Site/test.pobj.json", "Site/site_to_cores.pobj.json", "Site/core.box.v1.pobj.json", "Site/path.v1.pobj.json", "Site/Circulation.pobj.json",
  "Architectural/wall.pobj.json", "Architectural/door.pobj.json", "Architectural/window.pobj.json",
  "Architectural/floorplan.pobj.json", "Architectural/room.pobj.json",
  "MEP/battery.pobj.json", "MEP/wire.pobj.json", "MEP/switch-inline.pobj.json",
  "MEP/switch.pobj.json", "MEP/bulb.pobj.json", "MEP/chandelier.v1.pobj.json", "MEP/fan.ceiling.v1.pobj.json",
  "MEP/ac.pobj.json", "MEP/db.pobj.json", "MEP/cctv.pobj.json", "MEP/doorbell.pobj.json", "MEP/socket.pobj.json",
  "Services/lift.pobj.json", "Services/escalator.pobj.json", "Services/water-tank.pobj.json",
  "Outdoor/balcony-railing.pobj.json", "Outdoor/swing.pobj.json", "Outdoor/bbq.pobj.json", "Outdoor/pergola.pobj.json",
  "Puja/mandir.pobj.json", "Puja/low-stool.pobj.json",
  "Utility/washing-machine.pobj.json", "Utility/ironing-board.pobj.json", "Utility/storage-shelves.pobj.json",
  "Hydraulics/gravel-trap.pobj.json", "Hydraulics/settling-basin.pobj.json", "Hydraulics/canal.pobj.json",
  "Hydraulics/ogee-spillway.pobj.json", "Hydraulics/gravity-dam.pobj.json", "Hydraulics/turbine.pobj.json",
  "Kitchen/fridge.pobj.json", "Kitchen/refrigerator.pobj.json", "Kitchen/oven.pobj.json", "Kitchen/blender.pobj.json",
  "Kitchen/juicer.pobj.json", "Kitchen/induction.pobj.json", "Kitchen/stove.pobj.json", "Kitchen/dispenser.pobj.json", "Kitchen/sink.pobj.json",
  "Furniture/bed.pobj.json", "Furniture/sofa.pobj.json", "Furniture/chair.pobj.json", "Furniture/table.pobj.json",
  "Furniture/desk.pobj.json", "Furniture/wardrobe.pobj.json", "Furniture/tv-unit.v1.pobj.json", "Furniture/rug.v1.pobj.json",
  "Decor/potted-plant.pobj.json", "Decor/floor-lamp.pobj.json", "Decor/table-lamp.pobj.json", "Decor/vase.pobj.json",
  "Decor/wall-art.pobj.json", "Decor/wall-mirror.pobj.json", "Decor/wall-clock.pobj.json", "Decor/curtains.pobj.json", "Decor/wall-shelf.pobj.json",
  "Bathroom/bathtub.pobj.json", "Bathroom/toilet.pobj.json",
  "Parking/car.pobj.json", "Parking/bike.pobj.json",
  "Structural/footing.pobj.json", "Structural/staircase.pobj.json",
  "Electronics/resistor.pobj.json",
];

/** Every `.json` under public/Library/Parametric Objects, category-relative (e.g.
 *  "Kitchen/oven.pobj.json"). Live dev-bridge listing when available — so agent-saved objects appear
 *  alongside the bundled set — otherwise the {@link BUNDLED_POBJ_FILES} manifest. */
export async function listParametricObjectFiles(): Promise<string[]> {
  const listed = await listLibraryFiles("Parametric Objects");
  return listed?.length ? listed.filter((rel) => rel.toLowerCase().endsWith(".json")) : BUNDLED_POBJ_FILES;
}

/** Folder-relative paths of every bundled Flow NODE template under public/Library/Flows/Nodes — the
 *  production fallback for {@link listFlowNodeFiles} (static hosting can't list directories; dev lists
 *  LIVE through the bridge). Each `.node.json` names a `tool` + preset `params`. NEW bundled node
 *  templates belong in their category folder under Flows/Nodes AND here. */
export const BUNDLED_FLOW_NODE_FILES: string[] = [
  "Canvas/canvas-source.node.json",
  "Canvas/separate.node.json",
  "2d primitives/point.node.json",
  "2d primitives/rectangle.node.json",
  "2d primitives/arc.node.json",
  "2d primitives/circle.node.json",
  "2d primitives/line.node.json",
  "2d primitives/ngon.node.json",
  "2d primitives/ellipse.node.json",
  "2d primitives/rounded-rect.node.json",
  "2d primitives/sector.node.json",
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
  "Space/source.node.json",
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
  "Segment/segment-source.node.json",
  "Segment/segment-geometry.node.json",
  "Segment/segment-split.node.json",
  "Segment/display-segment.node.json",
  "Node/node-source.node.json",
  "Node/node-geometry.node.json",
  "Node/bloom.node.json",
  "Node/display-node.node.json",
  "Graph/graph-source.node.json",
  "Graph/mitered-join.node.json",
  "Graph/graph-to-path.node.json",
  "Graph/graph-smooth.node.json",
  "Graph/graph-metrics.node.json",
  "Graph/show-direction.node.json",
  "Graph/graph-to-spaces.node.json",
  "Graph/graph-reduce.node.json",
  "Graph/voronoi-bloom.node.json",
  "Graph/spring-layout.node.json",
  "Graph/pipe-solver.node.json",
  "Grid/grid-source.node.json",
  "Grid/graph-to-grid.node.json",
  "Grid/grid-field.node.json",
  "Grid/cellular-automaton.node.json",
  "Grid/laplace-solver.node.json",
  "Grid/fill-depressions.node.json",
  "Grid/flow-direction.node.json",
  "Grid/flow-accumulation.node.json",
  "Grid/watershed.node.json",
  "Grid/morphology.node.json",
  "Grid/grid-distance.node.json",
  "Grid/grid-threshold.node.json",
  "Grid/marching-squares.node.json",
  "Image/image.node.json",
  "Image/vectorise.node.json",
  "Image/object-detection.node.json",
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
  "Building/segment-to-3d.node.json",
  "Building/space-to-3d.node.json",
  "Mass/mass.node.json",
  "Mass/inset-3d.node.json",
  "Mass/smooth-3d.node.json",
  "Mass/mesh-to-3d.node.json",
  "Parametric/param-object.node.json",
  "Parametric/grab-object.node.json",
  "Parametric/param-grab.node.json",
  "Parametric/param-output-metrics.node.json",
  "Parametric/param-geometry.node.json",
  "Calculate/math.node.json",
  "Calculate/match.node.json",
  "Calculate/random.node.json",
  "Calculate/expr.node.json",
  "Calculate/bua.node.json",
  "Calculate/file-upload.node.json",
  "Calculate/text.node.json",
  "Output/output.node.json",
  "Output/render.node.json",
  "Output/analyse.node.json",
  "Output/generate.node.json",
  "AI/agent.node.json",
];

/** Every `.json` under public/Library/Flows/Nodes, folder-relative (e.g. "2d primitives/point.node.json").
 *  Live dev-bridge listing when available — so user-saved node templates appear alongside the bundled
 *  set — otherwise the {@link BUNDLED_FLOW_NODE_FILES} manifest. */
export async function listFlowNodeFiles(): Promise<string[]> {
  const listed = await listLibraryFiles("Flows/Nodes");
  return listed?.length ? listed.filter((rel) => rel.toLowerCase().endsWith(".json")) : BUNDLED_FLOW_NODE_FILES;
}

/** Delete ONE `.json` file inside public/Library by its Library-relative path (e.g.
 *  "Flows/Nodes/Space/inset.node.json"). Path-locked inside public/Library by the bridge; degrades to
 *  ok:false on production hosting. Used by the Flow Agent to remove node / workflow templates. */
export async function deleteLibraryFile(relPath: string): Promise<{ ok: boolean; deleted?: string; error?: string }> {
  try {
    const res = await fetch("/__library/delete-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: relPath }),
    });
    const body = (await res.json().catch(() => null)) as { ok?: unknown; deleted?: unknown; error?: unknown } | null;
    return res.ok && body?.ok === true
      ? { ok: true, deleted: typeof body.deleted === "string" ? body.deleted : relPath }
      : { ok: false, error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Delete the .pobj files under public/Library/Parametric Objects whose meta.id matches one of
 *  `ids` (the server scans and matches by file content, so renamed files are found too). */
export async function deleteLibraryObjectFiles(ids: string[]): Promise<{ deleted: string[] } | null> {
  try {
    const res = await fetch("/__library/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (!res.ok) return null;
    const body = (await res.json().catch(() => null)) as { ok?: unknown; deleted?: unknown } | null;
    return body?.ok === true ? { deleted: Array.isArray(body.deleted) ? body.deleted.map(String) : [] } : null;
  } catch {
    return null;
  }
}
