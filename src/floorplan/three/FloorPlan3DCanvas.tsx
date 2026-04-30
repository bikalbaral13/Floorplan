import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlanModel, FurnitureItem, Room, Wall } from "../types";
import { computeMiteredUnion, computeMiteredWallPolygons } from "../wallGeometry";
import type { Point } from "../types";

/** A `<mesh>` that automatically adds dark edge lines to any geometry it contains.
 *  Drop-in replacement for `<mesh>`. Improves visual separation between adjacent meshes. */
function EdgedMesh(props: ComponentProps<"mesh">) {
  return (
    <mesh {...props}>
      {props.children}
      <Edges color="#0f172a" threshold={15} lineWidth={1} />
    </mesh>
  );
}

interface Props {
  model: FloorPlanModel;
  pixelsPerMeter: number;
  placementMode?: "polygon" | "2dSymbol" | "rendered";
  /** Visible rooms (manual + auto-detected). When present, each is extruded as a thin floor slab
   *  and click-selectable. Falls back to model.rooms (manual only) if not provided. */
  rooms?: Room[];
  /** IDs of walls or rooms currently selected in the parent (selection state shared with 2D). */
  selectedWallIds?: string[];
  /** Click handler — id may be a wall id or a room id. additive=true on shift-click for multi-select. */
  onSelectWall?: (id: string | null, additive: boolean) => void;
}

type PlacementKind =
  | PlacementKind
  | "desk" | "wardrobe" | "bookshelf" | "bench"
  | "piano" | "tv-unit" | "fridge" | "toilet" | "bathtub"
  | "guitar" | "whiteboard" | "flute" | "clock" | "mirror";

const PLACEMENT_KIND_COLOR: Record<PlacementKind, string> = {
  bed: "#94a3b8",
  table: "#a16207",
  chair: "#2563eb",
  sofa: "#16a34a",
  desk: "#7c3aed",
  wardrobe: "#0f766e",
  bookshelf: "#9a3412",
  bench: "#6b7280",
  piano: "#1f2937",
  "tv-unit": "#0369a1",
  fridge: "#475569",
  toilet: "#6366f1",
  bathtub: "#0891b2",
  guitar: "#b45309",
  whiteboard: "#0ea5e9",
  flute: "#a855f7",
  clock: "#dc2626",
  mirror: "#0d9488",
};

const WALL_HEIGHT_M = 2.7;
const DEFAULT_WALL_THICKNESS_M = 0.15;
const DEFAULT_DOOR_LINTEL_M = 2.1;
const DEFAULT_WINDOW_LINTEL_M = 2.1;
const DEFAULT_WINDOW_SILL_M = 0.9;
const GREY = "#d6dae0";
const FLOOR_GREY = "#b8bec6";

const FURNITURE_DIMS: Record<FurnitureItem["type"], { w: number; d: number; h: number }> = {
  bed: { w: 2.0, d: 1.6, h: 0.5 },
  sofa: { w: 2.0, d: 0.9, h: 0.8 },
  table: { w: 1.4, d: 0.8, h: 0.75 },
  chair: { w: 0.5, d: 0.5, h: 0.5 },
  door: { w: 0.9, d: 0.1, h: 2.1 },
  window: { w: 1.2, d: 0.1, h: 1.2 },
};

const isExtrudableWall = (w: Wall) => {
  const t = w.segmentType ?? "wall";
  return t === "wall" || t === "door" || t === "window";
};

const wallBands = (w: Wall): Array<{ yMin: number; yMax: number }> => {
  const t = w.segmentType ?? "wall";
  if (t === "door") {
    const lintel = Math.min(WALL_HEIGHT_M, Math.max(0, w.lintelHeightM ?? DEFAULT_DOOR_LINTEL_M));
    return lintel < WALL_HEIGHT_M ? [{ yMin: lintel, yMax: WALL_HEIGHT_M }] : [];
  }
  if (t === "window") {
    const sill = Math.max(0, Math.min(WALL_HEIGHT_M, w.sillHeightM ?? DEFAULT_WINDOW_SILL_M));
    const lintel = Math.max(sill, Math.min(WALL_HEIGHT_M, w.lintelHeightM ?? DEFAULT_WINDOW_LINTEL_M));
    const bands: Array<{ yMin: number; yMax: number }> = [];
    if (sill > 0) bands.push({ yMin: 0, yMax: sill });
    if (lintel < WALL_HEIGHT_M) bands.push({ yMin: lintel, yMax: WALL_HEIGHT_M });
    return bands;
  }
  return [{ yMin: 0, yMax: WALL_HEIGHT_M }];
};

export default function FloorPlan3DCanvas({ model, pixelsPerMeter, placementMode = "polygon", rooms, selectedWallIds, onSelectWall }: Props) {
  const ppm = Math.max(1e-6, pixelsPerMeter);
  const useSymbol = placementMode === "2dSymbol";
  const selectedSet = useMemo(() => new Set(selectedWallIds ?? []), [selectedWallIds]);
  const slabRooms = rooms ?? model.rooms ?? [];
  const ROOM_SLAB_THICKNESS_M = 0.2;
  /** Click handler for a wall mesh. Stops propagation so OrbitControls doesn't claim the gesture
   *  and so background clicks (which clear selection) don't fire on the same pointer event. */
  const handleWallClick = (wallId: string) => (ev: { stopPropagation: () => void; nativeEvent?: { shiftKey?: boolean } }) => {
    ev.stopPropagation();
    onSelectWall?.(wallId, !!ev.nativeEvent?.shiftKey);
  };
  /** Material colour for a wall. Selected walls get a vivid highlight; the rest stay grey. */
  const wallColor = (wallId: string): string => selectedSet.has(wallId) ? "#f97316" : GREY;

  // Per-wall mitered polygon footprints (plan coords). Used in 3D for seamless-corner extrusion
  // when the wall's mode is "mitered" or "mitered-union" (i.e. when 2D Sharp view is on).
  const miteredPolygons = useMemo(() => computeMiteredWallPolygons(model.walls), [model.walls]);

  // For each wall in mitered/mitered-union mode, identify which of its mitered-polygon edges are
  // SHARED with another wall's polygon (i.e., junction edges where two walls meet). When rendering
  // door/window lintel/sill bands in union mode, the side faces at these shared edges butt against
  // adjacent walls — we hide their wireframe edges so the band reads as part of one continuous mass.
  const sharedPolyEdgesByWall = useMemo<Map<string, Set<number>>>(() => {
    const result = new Map<string, Set<number>>();
    const all = new Map<string, Point[]>();
    for (const w of model.walls) {
      if (w.mode !== "mitered" && w.mode !== "mitered-union") continue;
      if (useSymbol && (w.isPlacementWall || w.isPlacementPreview) && w.placementObjectId && w.placementKind) continue;
      const poly = miteredPolygons.get(w.id);
      if (poly && poly.length >= 3) all.set(w.id, poly);
    }
    if (all.size === 0) return result;
    const { outerEdges } = computeMiteredUnion(all);
    const TOL = 1.5;
    // outerEdges = edges NOT shared. Mark each polygon's outer-edge indices, then `shared = total \ outer`.
    for (const [wallId, poly] of all) {
      const outerIdx = new Set<number>();
      for (const oe of outerEdges) {
        if (oe.wallId !== wallId) continue;
        for (let i = 0; i < poly.length; i++) {
          const a = poly[i], b = poly[(i + 1) % poly.length];
          const fwd = Math.hypot(a.x - oe.a.x, a.y - oe.a.y) < TOL && Math.hypot(b.x - oe.b.x, b.y - oe.b.y) < TOL;
          const rev = Math.hypot(a.x - oe.b.x, a.y - oe.b.y) < TOL && Math.hypot(b.x - oe.a.x, b.y - oe.a.y) < TOL;
          if (fwd || rev) { outerIdx.add(i); break; }
        }
      }
      const shared = new Set<number>();
      for (let i = 0; i < poly.length; i++) if (!outerIdx.has(i)) shared.add(i);
      if (shared.size > 0) result.set(wallId, shared);
    }
    return result;
  }, [model.walls, miteredPolygons, useSymbol]);

  // Union-mode extrusion: when walls share mode "mitered-union", their per-wall mitered footprints
  // butt seamlessly. Computing the union outerEdges (boundary edges not shared with another wall) and
  // chaining them into closed loops gives one polygon per connected wall network — extruded as a single
  // Shape, the result has no internal seams between adjacent walls (matches the 2D Sharp+Union look).
  // Only plain "wall" segments are unified; doors/windows still extrude per-wall bands so openings show.
  const unionLoops = useMemo<Point[][]>(() => {
    const KEY = (p: Point) => `${Math.round(p.x * 100)},${Math.round(p.y * 100)}`;
    // Mitered polygons restricted to plain walls in union mode. Placement walls (the 4-side polygon
     // markers around a placed object) are excluded when 2dSymbol mode is on — those objects are rendered
     // only as 3D primitives, so their outline shouldn't fold into the wall union mass either.
    const filtered = new Map<string, Point[]>();
    for (const w of model.walls) {
      if (w.mode !== "mitered-union") continue;
      if ((w.segmentType ?? "wall") !== "wall") continue;
      if (useSymbol && (w.isPlacementWall || w.isPlacementPreview) && w.placementObjectId && w.placementKind) continue;
      const poly = miteredPolygons.get(w.id);
      if (poly && poly.length >= 3) filtered.set(w.id, poly);
    }
    if (filtered.size === 0) return [];
    const { outerEdges } = computeMiteredUnion(filtered);
    if (outerEdges.length === 0) return [];

    // Walk edges into closed loops by chaining endpoint matches.
    const used = new Array<boolean>(outerEdges.length).fill(false);
    const loops: Point[][] = [];
    for (let start = 0; start < outerEdges.length; start++) {
      if (used[start]) continue;
      used[start] = true;
      const seed = outerEdges[start];
      const loop: Point[] = [seed.a, seed.b];
      let endKey = KEY(seed.b);
      const startKey = KEY(seed.a);
      // Cap chain length defensively to avoid pathological infinite walks.
      for (let safety = 0; safety < outerEdges.length + 1; safety++) {
        if (endKey === startKey) break;
        let nextIdx = -1, reversed = false;
        for (let i = 0; i < outerEdges.length; i++) {
          if (used[i]) continue;
          if (KEY(outerEdges[i].a) === endKey) { nextIdx = i; reversed = false; break; }
          if (KEY(outerEdges[i].b) === endKey) { nextIdx = i; reversed = true; break; }
        }
        if (nextIdx === -1) break;
        used[nextIdx] = true;
        const ne = outerEdges[nextIdx];
        const np = reversed ? ne.a : ne.b;
        if (KEY(np) === startKey) break; // closed
        loop.push(np);
        endKey = KEY(np);
      }
      if (loop.length >= 3) loops.push(loop);
    }
    return loops;
  }, [model.walls, miteredPolygons, useSymbol]);

  const placementGroups = useMemo(() => {
    if (!useSymbol) return [];
    const map = new Map<string, { walls: Wall[]; kind: PlacementKind; heightM: number; clearanceM: number; roomId?: string }>();
    for (const w of model.walls) {
      if ((w.isPlacementWall || w.isPlacementPreview) && w.placementObjectId && w.placementKind) {
        const g = map.get(w.placementObjectId) ?? {
          walls: [],
          kind: w.placementKind,
          heightM: w.placementHeightM ?? 1,
          clearanceM: w.placementClearanceM ?? 0,
          roomId: w.placementSourceRoomId,
        };
        g.walls.push(w);
        map.set(w.placementObjectId, g);
      }
    }
    const out: Array<{ id: string; cx: number; cy: number; lengthM: number; breadthM: number; rotY: number; kind: PlacementKind; heightM: number; clearanceM: number }> = [];
    for (const [id, g] of map.entries()) {
      if (g.walls.length < 4) continue;
      let cx = 0, cy = 0;
      for (const w of g.walls) { cx += w.start.x + w.end.x; cy += w.start.y + w.end.y; }
      cx /= 8; cy /= 8;
      let lenLong = 0, lenShort = Infinity, longest = g.walls[0];
      for (const w of g.walls) {
        const L = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
        if (L > lenLong) { lenLong = L; longest = w; }
        if (L < lenShort) lenShort = L;
      }
      // walls[0] = long edge along the polygon boundary (length = the placement object's length,
      // regardless of length-vs-breadth ordering). walls[1] = perpendicular short edge (= breadth).
      const wall0 = g.walls[0];
      const wall1 = g.walls[1];
      const w0Len = Math.hypot(wall0.end.x - wall0.start.x, wall0.end.y - wall0.start.y);
      const w1Len = Math.hypot(wall1.end.x - wall1.start.x, wall1.end.y - wall1.start.y);
      const ux_plan = w0Len > 1e-6 ? (wall0.end.x - wall0.start.x) / w0Len : (longest.end.x - longest.start.x) / lenLong;
      const uy_plan = w0Len > 1e-6 ? (wall0.end.y - wall0.start.y) / w0Len : (longest.end.y - longest.start.y) / lenLong;
      let rotY = -Math.atan2(uy_plan, ux_plan);
      // Make local −z point at the wall (toward walls[0]'s midpoint).
      const m0x = (wall0.start.x + wall0.end.x) / 2;
      const m0y = (wall0.start.y + wall0.end.y) / 2;
      const wallDirX = m0x - cx;
      const wallDirY = m0y - cy;
      if (wallDirX * uy_plan + wallDirY * (-ux_plan) < 0) rotY += Math.PI;
      out.push({ id, cx, cy, lengthM: w0Len / ppm, breadthM: w1Len / ppm, rotY, kind: g.kind, heightM: g.heightM, clearanceM: g.clearanceM });
      void lenShort;
    }
    return out;
  }, [model.walls, useSymbol, ppm]);

  const bounds = useMemo(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const expand = (x: number, y: number) => {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    };
    for (const w of model.walls) {
      expand(w.start.x, w.start.y);
      expand(w.end.x, w.end.y);
    }
    for (const f of model.furniture) expand(f.x, f.y);
    if (!isFinite(minX)) {
      minX = 0; minY = 0; maxX = ppm * 10; maxY = ppm * 10;
    }
    return { minX, minY, maxX, maxY };
  }, [model.walls, model.furniture, ppm]);

  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const widthM = Math.max(4, (bounds.maxX - bounds.minX) / ppm);
  const depthM = Math.max(4, (bounds.maxY - bounds.minY) / ppm);
  const floorPad = 2;

  const toScene = (planX: number, planY: number): [number, number] => [
    (planX - cx) / ppm,
    (planY - cy) / ppm,
  ];

  const camDist = Math.max(widthM, depthM) * 1.1 + 6;

  return (
    <Canvas
      camera={{ position: [camDist, camDist * 0.8, camDist], fov: 45, near: 0.1, far: 1000 }}
      style={{ width: "100%", height: "100%", background: "#eef2f7" }}
      onPointerMissed={() => onSelectWall?.(null, false)}
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[20, 30, 15]} intensity={0.5} />
      <directionalLight position={[-15, 20, -10]} intensity={0.35} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={[0, 1, 0]} />

      {/* Room slabs — extrude each room polygon as a thin floor plate at y=0. Click-selectable; the
           selection list is shared with walls (a single id list keyed by room.id or wall.id). */}
      {slabRooms.filter((r) => Array.isArray(r.points) && r.points.length >= 3).map((r) => {
        const shape = new THREE.Shape(
          r.points.map((p) => {
            const [sx, sz] = toScene(p.x, p.y);
            return new THREE.Vector2(sx, -sz);
          })
        );
        const isSelected = selectedSet.has(r.id);
        const baseColor = (typeof r.fill === "string" && r.fill.startsWith("#")) ? r.fill : "#cbd5e1";
        const color = isSelected ? "#f97316" : baseColor;
        return (
          <EdgedMesh
            key={`room-${r.id}`}
            rotation={[-Math.PI / 2, 0, 0]}
            position={[0, isSelected ? 0.001 : 0, 0]}
            onClick={handleWallClick(r.id)}
          >
            <extrudeGeometry args={[shape, { depth: ROOM_SLAB_THICKNESS_M, bevelEnabled: false, steps: 1 }]} />
            <meshStandardMaterial color={color} />
          </EdgedMesh>
        );
      })}

      {/* Union extrusion: one continuous mass per connected wall network in mitered-union mode.
           For a closed room the loop walker emits both an outer perimeter and an inner perimeter
           (the room interior); the inner one must be added as a Shape hole, otherwise the room's
           floor area would be extruded as a solid block. */}
      {(() => {
        const signedArea = (loop: Point[]): number => {
          let a = 0;
          for (let i = 0; i < loop.length; i++) {
            const p1 = loop[i], p2 = loop[(i + 1) % loop.length];
            a += p1.x * p2.y - p2.x * p1.y;
          }
          return a / 2;
        };
        const pointInPoly = (px: number, py: number, poly: Point[]): boolean => {
          let inside = false;
          for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i], b = poly[j];
            if (((a.y > py) !== (b.y > py)) && (px < (b.x - a.x) * (py - a.y) / ((b.y - a.y) || 1e-9) + a.x)) inside = !inside;
          }
          return inside;
        };
        // Larger absolute area first → outer rings before holes.
        const ranked = unionLoops
          .map((loop) => ({ loop, area: signedArea(loop) }))
          .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
        const outerSign = ranked.length > 0 ? Math.sign(ranked[0].area) : 1;
        const outers: Array<{ loop: Point[]; holes: Point[][] }> = [];
        for (const { loop, area } of ranked) {
          if (Math.sign(area) === outerSign) {
            outers.push({ loop, holes: [] });
          } else {
            // Hole: assign to the smallest enclosing outer ring.
            let host: { loop: Point[]; holes: Point[][] } | null = null;
            let hostAbsArea = Infinity;
            const hx = loop[0].x, hy = loop[0].y;
            for (const o of outers) {
              const oa = Math.abs(signedArea(o.loop));
              if (oa < hostAbsArea && pointInPoly(hx, hy, o.loop)) { host = o; hostAbsArea = oa; }
            }
            if (host) host.holes.push(loop);
          }
        }
        return outers.map(({ loop, holes }, li) => {
          const shape = new THREE.Shape(
            loop.map((p) => {
              const [sx, sz] = toScene(p.x, p.y);
              return new THREE.Vector2(sx, -sz);
            })
          );
          for (const h of holes) {
            shape.holes.push(new THREE.Path(h.map((p) => {
              const [sx, sz] = toScene(p.x, p.y);
              return new THREE.Vector2(sx, -sz);
            })));
          }
          return (
            <EdgedMesh key={`union-${li}`} rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[shape, { depth: WALL_HEIGHT_M, bevelEnabled: false, steps: 1 }]} />
              <meshStandardMaterial color={GREY} />
            </EdgedMesh>
          );
        });
      })()}

      {model.walls.filter((w) => {
        if (!isExtrudableWall(w)) return false;
        if (useSymbol && (w.isPlacementWall || w.isPlacementPreview) && w.placementObjectId && w.placementKind) return false;
        // Union mode: plain walls are absorbed into the union extrusion above. Doors/windows still
        // need per-wall band extrusion so the lintel/sill show.
        if (w.mode === "mitered-union" && (w.segmentType ?? "wall") === "wall") return false;
        return true;
      }).flatMap((w) => {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) return [];
        const segType = w.segmentType ?? "wall";
        const isSharp = (w.mode === "mitered" || w.mode === "mitered-union");
        const polyPlan = miteredPolygons.get(w.id);

        // Sharp-mode extrusion using the mitered footprint polygon — corners join seamlessly
        // because adjacent walls share the same vertex coordinates at junctions. Only available
        // for plain walls (door/window walls still use the band approach below to keep openings).
        if (isSharp && segType === "wall" && polyPlan && polyPlan.length >= 3) {
          const shape = new THREE.Shape(
            polyPlan.map((p) => {
              const [sx, sz] = toScene(p.x, p.y);
              // Build the 2D shape in (X, -Z) so that after rotating −π/2 around X the polygon
              // lands on the world XZ plane with correct orientation, and ExtrudeGeometry's +Z
              // extrude direction maps to world +Y.
              return new THREE.Vector2(sx, -sz);
            })
          );
          return [
            <EdgedMesh key={`${w.id}:sharp`} rotation={[-Math.PI / 2, 0, 0]} onClick={handleWallClick(w.id)}>
              <extrudeGeometry args={[shape, { depth: WALL_HEIGHT_M, bevelEnabled: false, steps: 1 }]} />
              <meshStandardMaterial color={wallColor(w.id)} />
            </EdgedMesh>,
          ];
        }

        // Sharp-mode lintel/sill bands for doors/windows: extrude the mitered footprint polygon
        // for each above/below band. The mitered polygon shares vertices with adjacent plain walls'
        // mitered polygons, so the lintel band visually merges with the surrounding union mass —
        // no boxy seam where door/window meets the rest of the wall.
        if (isSharp && (segType === "door" || segType === "window") && polyPlan && polyPlan.length >= 3) {
          const shape = new THREE.Shape(
            polyPlan.map((p) => {
              const [sx, sz] = toScene(p.x, p.y);
              return new THREE.Vector2(sx, -sz);
            })
          );
          // In mitered-union mode, render the band as a plain mesh and draw ONLY the wireframe edges
          // for non-shared polygon edges (and the verticals at vertices whose neighbours are also
          // non-shared). Edges of side faces touching an adjacent wall — i.e. shared polygon edges —
          // are dropped, so the band visually merges with the union mass with no seams.
          const isUnionBand = w.mode === "mitered-union";
          const sharedSet = isUnionBand ? (sharedPolyEdgesByWall.get(w.id) ?? new Set<number>()) : new Set<number>();
          const N = polyPlan.length;
          const isEdgeShared = (ei: number) => sharedSet.has(ei);
          const isVertHidden = (vi: number) => sharedSet.has((vi - 1 + N) % N) || sharedSet.has(vi);

          return wallBands(w).map((band, i) => {
            const h = band.yMax - band.yMin;
            if (h <= 0) return null;
            const key = `${w.id}:band-sharp:${i}`;
            if (isUnionBand) {
              const positions: number[] = [];
              for (let ei = 0; ei < N; ei++) {
                if (isEdgeShared(ei)) continue;
                const a = polyPlan[ei], b = polyPlan[(ei + 1) % N];
                const [ax, az] = toScene(a.x, a.y);
                const [bx, bz] = toScene(b.x, b.y);
                // Bottom horizontal (band.yMin) and top horizontal (band.yMax). Note: Z in scene
                // coords maps from (planY - cy)/ppm; toScene returns (sx, sz) → world (sx, _, sz).
                positions.push(ax, band.yMin, az, bx, band.yMin, bz);
                positions.push(ax, band.yMax, az, bx, band.yMax, bz);
              }
              for (let vi = 0; vi < N; vi++) {
                if (isVertHidden(vi)) continue;
                const p = polyPlan[vi];
                const [px, pz] = toScene(p.x, p.y);
                positions.push(px, band.yMin, pz, px, band.yMax, pz);
              }
              const lineGeom = new THREE.BufferGeometry();
              lineGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
              return (
                <group key={key}>
                  <mesh
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, band.yMin, 0]}
                    onClick={handleWallClick(w.id)}
                  >
                    <extrudeGeometry args={[shape, { depth: h, bevelEnabled: false, steps: 1 }]} />
                    <meshStandardMaterial color={wallColor(w.id)} />
                  </mesh>
                  {positions.length > 0 && (
                    <lineSegments geometry={lineGeom}>
                      <lineBasicMaterial color="#0f172a" />
                    </lineSegments>
                  )}
                </group>
              );
            }
            return (
              <EdgedMesh
                key={key}
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, band.yMin, 0]}
                onClick={handleWallClick(w.id)}
              >
                <extrudeGeometry args={[shape, { depth: h, bevelEnabled: false, steps: 1 }]} />
                <meshStandardMaterial color={wallColor(w.id)} />
              </EdgedMesh>
            );
          });
        }

        // Default per-wall axis-aligned box (or band) extrusion.
        const lenM = lenPx / ppm;
        const thicknessM = Math.max(0.05, (w.thickness ?? 0) / ppm || DEFAULT_WALL_THICKNESS_M);
        const midX = (w.start.x + w.end.x) / 2;
        const midY = (w.start.y + w.end.y) / 2;
        const [sx, sz] = toScene(midX, midY);
        const rotY = -Math.atan2(dy, dx);
        return wallBands(w).map((band, i) => {
          const h = band.yMax - band.yMin;
          if (h <= 0) return null;
          const yCenter = (band.yMin + band.yMax) / 2;
          return (
            <EdgedMesh key={`${w.id}:${i}`} position={[sx, yCenter, sz]} rotation={[0, rotY, 0]} onClick={handleWallClick(w.id)}>
              <boxGeometry args={[lenM, h, thicknessM]} />
              <meshStandardMaterial color={wallColor(w.id)} />
            </EdgedMesh>
          );
        });
      })}

      {/* Door / Window primitives — only in 2D-Symbol placement mode. Sit inside the wall opening
          (lintel / sill bands are still drawn by the wall extrusion above). */}
      {useSymbol && model.walls.map((w) => {
        if (w.segmentType !== "door" && w.segmentType !== "window") return null;
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) return null;
        const lenM = lenPx / ppm;
        const thicknessM = Math.max(0.05, (w.thickness ?? 0) / ppm || DEFAULT_WALL_THICKNESS_M);
        const midX = (w.start.x + w.end.x) / 2;
        const midY = (w.start.y + w.end.y) / 2;
        const [sx, sz] = toScene(midX, midY);
        const rotY = -Math.atan2(dy, dx);

        if (w.segmentType === "door") {
          const lintel = Math.min(WALL_HEIGHT_M, Math.max(0.1, w.lintelHeightM ?? DEFAULT_DOOR_LINTEL_M));
          const slabH = Math.max(0.1, lintel - 0.02);
          const frameW = 0.05;
          const frameT = Math.max(thicknessM * 1.05, 0.06);
          const slabD = Math.max(0.025, thicknessM * 0.3);
          const wood = "#92400e";
          const woodLight = "#b45309";
          const handleColor = "#fbbf24";
          const innerLen = Math.max(0.1, lenM - frameW * 2);

          // Hinge end: "left" = wall start (-x), "right" = wall end (+x). The slab pivots around
          // its hinge edge, so we position a sub-group AT the hinge and let it rotate around Y.
          // Swing side: doorPlacement "left" = perpendicular -z half, "right" = +z half. The open
          // angle's direction depends on both hinge end and swing side (open into the requested side).
          const hingeSign = w.doorHinge === "right" ? -1 : 1; // +1 → slab extends in +x from hinge; -1 → in -x
          const placementSign = w.doorPlacement === "right" ? 1 : -1; // +1 → swings into +z half
          const OPEN_ANGLE = (Math.PI / 180) * 75; // visual open angle (75°)
          const swingAngle = -hingeSign * placementSign * OPEN_ANGLE;
          const hingeX = hingeSign * (lenM / 2 - frameW);
          // Slab body's centre, in the hinge-group's local frame, before rotation: half its length
          // away from the hinge along the wall.
          const slabCx = hingeSign * innerLen / 2;
          const handleX = hingeSign * (innerLen - 0.08);

          return (
            <group key={`door-prim-${w.id}`} position={[sx, 0, sz]} rotation={[0, rotY, 0]}>
              {/* Lintel + side jambs stay in the wall plane */}
              <EdgedMesh position={[0, lintel + frameW / 2, 0]}>
                <boxGeometry args={[lenM, frameW, frameT]} />
                <meshStandardMaterial color={woodLight} />
              </EdgedMesh>
              <EdgedMesh position={[-lenM / 2 + frameW / 2, slabH / 2, 0]}>
                <boxGeometry args={[frameW, slabH, frameT]} />
                <meshStandardMaterial color={woodLight} />
              </EdgedMesh>
              <EdgedMesh position={[lenM / 2 - frameW / 2, slabH / 2, 0]}>
                <boxGeometry args={[frameW, slabH, frameT]} />
                <meshStandardMaterial color={woodLight} />
              </EdgedMesh>

              {/* Hinge group: pivots the slab around the hinge edge by `swingAngle` so the door
                   visibly opens toward `doorPlacement` from `doorHinge`. */}
              <group position={[hingeX, 0, 0]} rotation={[0, swingAngle, 0]}>
                <EdgedMesh position={[slabCx, slabH / 2, 0]}>
                  <boxGeometry args={[innerLen, slabH - 0.02, slabD]} />
                  <meshStandardMaterial color={wood} />
                </EdgedMesh>
                {/* Handle sits near the latch end (opposite the hinge) on the swing-side face */}
                <EdgedMesh position={[handleX, slabH * 0.5, placementSign * (slabD / 2 + 0.005)]}>
                  <boxGeometry args={[0.04, 0.06, 0.04]} />
                  <meshStandardMaterial color={handleColor} metalness={0.7} roughness={0.3} />
                </EdgedMesh>
              </group>
            </group>
          );
        }

        // Window
        const sill = Math.max(0, Math.min(WALL_HEIGHT_M, w.sillHeightM ?? DEFAULT_WINDOW_SILL_M));
        const lintel = Math.max(sill + 0.1, Math.min(WALL_HEIGHT_M, w.lintelHeightM ?? DEFAULT_WINDOW_LINTEL_M));
        const winH = lintel - sill;
        const cy = sill + winH / 2;
        const frameW = 0.06;
        const frameT = Math.max(thicknessM * 1.05, 0.06);
        const glassT = Math.max(0.015, thicknessM * 0.2);
        const wood = "#a16207";
        const innerH = Math.max(0.1, winH - frameW * 2);
        const innerW = Math.max(0.1, lenM - frameW * 2);
        return (
          <group key={`win-prim-${w.id}`} position={[sx, 0, sz]} rotation={[0, rotY, 0]}>
            {/* Top frame */}
            <EdgedMesh position={[0, lintel - frameW / 2, 0]}>
              <boxGeometry args={[lenM, frameW, frameT]} />
              <meshStandardMaterial color={wood} />
            </EdgedMesh>
            {/* Sill (bottom frame) */}
            <EdgedMesh position={[0, sill + frameW / 2, 0]}>
              <boxGeometry args={[lenM, frameW, frameT]} />
              <meshStandardMaterial color={wood} />
            </EdgedMesh>
            {/* Left frame */}
            <EdgedMesh position={[-lenM / 2 + frameW / 2, cy, 0]}>
              <boxGeometry args={[frameW, innerH, frameT]} />
              <meshStandardMaterial color={wood} />
            </EdgedMesh>
            {/* Right frame */}
            <EdgedMesh position={[lenM / 2 - frameW / 2, cy, 0]}>
              <boxGeometry args={[frameW, innerH, frameT]} />
              <meshStandardMaterial color={wood} />
            </EdgedMesh>
            {/* Center vertical mullion */}
            <EdgedMesh position={[0, cy, 0]}>
              <boxGeometry args={[frameW * 0.55, innerH, frameT * 0.7]} />
              <meshStandardMaterial color={wood} />
            </EdgedMesh>
            {/* Two casement sashes. Each pivots around its outer vertical jamb when `isOpen`,
                 swinging outward (into +Z half-space). When closed both sashes lie flat in the
                 wall plane and visually behave like the old single glass pane. */}
            {(() => {
              const isOpen = !!w.isOpen;
              const OPEN_ANGLE = (Math.PI / 180) * 60;
              const sashLen = innerW / 2;
              const leftHingeX = -lenM / 2 + frameW;
              const rightHingeX = lenM / 2 - frameW;
              const glassMat = (
                <meshStandardMaterial color="#7dd3fc" transparent opacity={0.35} metalness={0.15} roughness={0.05} />
              );
              return (
                <>
                  <group position={[leftHingeX, cy, 0]} rotation={[0, isOpen ? -OPEN_ANGLE : 0, 0]}>
                    <EdgedMesh position={[sashLen / 2, 0, 0]}>
                      <boxGeometry args={[sashLen, innerH, glassT]} />
                      {glassMat}
                    </EdgedMesh>
                  </group>
                  <group position={[rightHingeX, cy, 0]} rotation={[0, isOpen ? OPEN_ANGLE : 0, 0]}>
                    <EdgedMesh position={[-sashLen / 2, 0, 0]}>
                      <boxGeometry args={[sashLen, innerH, glassT]} />
                      {glassMat}
                    </EdgedMesh>
                  </group>
                </>
              );
            })()}
          </group>
        );
      })}

      {placementGroups.map((g) => {
        const [sx, sz] = toScene(g.cx, g.cy);
        const color = PLACEMENT_KIND_COLOR[g.kind];
        const w = Math.max(0.05, g.lengthM);
        const d = Math.max(0.05, g.breadthM);
        const h = Math.max(0.05, g.heightM);
        if (g.kind === "table") {
          // Tabletop + 4 legs + 4 apron rails = 9 cuboids
          const legSize = Math.min(w, d) * 0.06;
          const topH = 0.04;
          const apronH = h * 0.05;
          const apronT = legSize * 0.7;
          const legH = h - apronH - topH;
          const lx = (w - legSize) / 2, lz = (d - legSize) / 2;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h - topH / 2, 0]}>
                <boxGeometry args={[w, topH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              {[[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].map(([x, z], i) => (
                <EdgedMesh key={`leg${i}`} position={[x, legH / 2, z]}>
                  <boxGeometry args={[legSize, legH, legSize]} />
                  <meshStandardMaterial color={color} />
                </EdgedMesh>
              ))}
              <EdgedMesh position={[0, legH + apronH / 2, -lz]}>
                <boxGeometry args={[w - legSize * 2, apronH, apronT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, legH + apronH / 2, lz]}>
                <boxGeometry args={[w - legSize * 2, apronH, apronT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-lx, legH + apronH / 2, 0]}>
                <boxGeometry args={[apronT, apronH, d - legSize * 2]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[lx, legH + apronH / 2, 0]}>
                <boxGeometry args={[apronT, apronH, d - legSize * 2]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "chair") {
          // 4 legs + seat + backrest = 6 cuboids
          const legSize = Math.min(w, d) * 0.08;
          const legH = h * 0.45;
          const seatH = h * 0.08;
          const backT = Math.min(w, d) * 0.08;
          const lx = (w - legSize) / 2, lz = (d - legSize) / 2;
          const seatTopY = legH + seatH;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              {[[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].map(([x, z], i) => (
                <EdgedMesh key={`l${i}`} position={[x, legH / 2, z]}>
                  <boxGeometry args={[legSize, legH, legSize]} />
                  <meshStandardMaterial color="#475569" />
                </EdgedMesh>
              ))}
              <EdgedMesh position={[0, legH + seatH / 2, 0]}>
                <boxGeometry args={[w, seatH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, seatTopY + (h - seatTopY) / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[w, h - seatTopY, backT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "sofa") {
          // Frame base + 2 seat cushions + 2 back cushions + backrest + 2 arms = 8 cuboids
          const frameH = h * 0.25;
          const seatCushionH = h * 0.18;
          const backH = h - frameH;
          const backT = Math.min(w, d) * 0.18;
          const armT = w * 0.1;
          const armH = (h - frameH) * 0.85;
          const armY = frameH + armH / 2;
          const seatY = frameH + seatCushionH / 2;
          const seatD = d - backT;
          const seatZ = backT / 2;
          const cushionGap = w * 0.01;
          const cushionWFull = w - armT * 2;
          const cushionW = (cushionWFull - cushionGap) / 2;
          const backCushionW = cushionW;
          const backCushionH = backH * 0.55;
          const backCushionT = backT * 0.55;
          const backCushionZ = -d / 2 + backT + backCushionT / 2;
          const backCushionY = frameH + seatCushionH + backCushionH / 2;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, frameH / 2, 0]}>
                <boxGeometry args={[w, frameH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-(cushionGap / 2 + cushionW / 2), seatY, seatZ]}>
                <boxGeometry args={[cushionW, seatCushionH, seatD]} />
                <meshStandardMaterial color="#f1f5f9" />
              </EdgedMesh>
              <EdgedMesh position={[(cushionGap / 2 + cushionW / 2), seatY, seatZ]}>
                <boxGeometry args={[cushionW, seatCushionH, seatD]} />
                <meshStandardMaterial color="#f1f5f9" />
              </EdgedMesh>
              <EdgedMesh position={[0, frameH + backH / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[w, backH, backT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-(cushionGap / 2 + backCushionW / 2), backCushionY, backCushionZ]}>
                <boxGeometry args={[backCushionW, backCushionH, backCushionT]} />
                <meshStandardMaterial color="#f1f5f9" />
              </EdgedMesh>
              <EdgedMesh position={[(cushionGap / 2 + backCushionW / 2), backCushionY, backCushionZ]}>
                <boxGeometry args={[backCushionW, backCushionH, backCushionT]} />
                <meshStandardMaterial color="#f1f5f9" />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + armT / 2, armY, 0]}>
                <boxGeometry args={[armT, armH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - armT / 2, armY, 0]}>
                <boxGeometry args={[armT, armH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "bed") {
          // 4 legs + mattress + headboard + 2 pillows = 8 cuboids
          const legH = h * 0.14;
          const legSize = Math.min(w, d) * 0.06;
          const mattressBodyH = h * 0.55;
          const mattressTop = legH + mattressBodyH;
          const headT = Math.min(w, d) * 0.08;
          const pillowH = Math.min(0.1, h * 0.1);
          const pillowW = Math.min(w * 0.4, 0.6);
          const pillowD = Math.min(d * 0.22, 0.45);
          const pillowZ = -d / 2 + headT + pillowD / 2 + 0.03;
          const pillowY = mattressTop + pillowH / 2;
          const pillowGap = w * 0.04;
          const lx = w / 2 - legSize / 2;
          const lz = d / 2 - legSize / 2;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              {[[-lx, -lz], [lx, -lz], [lx, lz], [-lx, lz]].map(([x, z], i) => (
                <EdgedMesh key={`l${i}`} position={[x, legH / 2, z]}>
                  <boxGeometry args={[legSize, legH, legSize]} />
                  <meshStandardMaterial color="#475569" />
                </EdgedMesh>
              ))}
              <EdgedMesh position={[0, legH + mattressBodyH / 2, 0]}>
                <boxGeometry args={[w, mattressBodyH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h / 2, -d / 2 + headT / 2]}>
                <boxGeometry args={[w, h, headT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-(pillowGap / 2 + pillowW / 2), pillowY, pillowZ]}>
                <boxGeometry args={[pillowW, pillowH, pillowD]} />
                <meshStandardMaterial color="#f8fafc" />
              </EdgedMesh>
              <EdgedMesh position={[(pillowGap / 2 + pillowW / 2), pillowY, pillowZ]}>
                <boxGeometry args={[pillowW, pillowH, pillowD]} />
                <meshStandardMaterial color="#f8fafc" />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "desk") {
          // Top + 2 pedestal sides + modesty panel + 2 drawer fronts + 2 drawer pulls = 8 cuboids
          const topH = h * 0.05;
          const pedT = Math.min(w, d) * 0.1;
          const pedH = h - topH;
          const px = (w - pedT) / 2;
          const drawerH = pedH * 0.18;
          const drawerY1 = pedH - drawerH * 1.1;
          const drawerY2 = drawerY1 - drawerH * 1.4;
          const drawerW = pedT * 0.85;
          const handleW = drawerW * 0.55;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h - topH / 2, 0]}>
                <boxGeometry args={[w, topH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-px, pedH / 2, 0]}>
                <boxGeometry args={[pedT, pedH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[px, pedH / 2, 0]}>
                <boxGeometry args={[pedT, pedH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, pedH / 2, -d / 2 + pedT / 2]}>
                <boxGeometry args={[w - pedT * 2, pedH * 0.7, pedT * 0.5]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[px, drawerY1, d / 2 - 0.005]}>
                <boxGeometry args={[drawerW, drawerH, 0.01]} />
                <meshStandardMaterial color="#9d62db" />
              </EdgedMesh>
              <EdgedMesh position={[px, drawerY2, d / 2 - 0.005]}>
                <boxGeometry args={[drawerW, drawerH, 0.01]} />
                <meshStandardMaterial color="#9d62db" />
              </EdgedMesh>
              <EdgedMesh position={[px, drawerY1, d / 2 + 0.012]}>
                <boxGeometry args={[handleW, drawerH * 0.18, 0.015]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[px, drawerY2, d / 2 + 0.012]}>
                <boxGeometry args={[handleW, drawerH * 0.18, 0.015]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "wardrobe") {
          // Body + 2 doors + 2 handles + top molding + base plinth = 7 cuboids
          const bodyD = d * 0.95;
          const doorT = d * 0.05;
          const moldingH = h * 0.04;
          const plinthH = h * 0.05;
          const doorH = h - moldingH - plinthH;
          const doorW = w / 2 - 0.01;
          const doorY = plinthH + doorH / 2;
          const handleH = doorH * 0.4;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h / 2, -d / 2 + bodyD / 2]}>
                <boxGeometry args={[w, h, bodyD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 4 - 0.005, doorY, d / 2 - doorT / 2]}>
                <boxGeometry args={[doorW, doorH, doorT]} />
                <meshStandardMaterial color="#0d6b62" />
              </EdgedMesh>
              <EdgedMesh position={[w / 4 + 0.005, doorY, d / 2 - doorT / 2]}>
                <boxGeometry args={[doorW, doorH, doorT]} />
                <meshStandardMaterial color="#0d6b62" />
              </EdgedMesh>
              <EdgedMesh position={[-0.04, doorY, d / 2 + 0.012]}>
                <boxGeometry args={[0.02, handleH, 0.02]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
              </EdgedMesh>
              <EdgedMesh position={[0.04, doorY, d / 2 + 0.012]}>
                <boxGeometry args={[0.02, handleH, 0.02]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.5} roughness={0.4} />
              </EdgedMesh>
              <EdgedMesh position={[0, h - moldingH / 2, 0]}>
                <boxGeometry args={[w + 0.04, moldingH, d + 0.02]} />
                <meshStandardMaterial color="#0a554d" />
              </EdgedMesh>
              <EdgedMesh position={[0, plinthH / 2, 0]}>
                <boxGeometry args={[w * 0.98, plinthH, d * 0.98]} />
                <meshStandardMaterial color="#0a554d" />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "bookshelf") {
          // Plinth + back + 2 sides + 4 shelves + crown = 9 cuboids
          const backT = d * 0.08;
          const sideT = w * 0.04;
          const shelfT = h * 0.03;
          const plinthH = h * 0.04;
          const crownH = h * 0.04;
          const inner = h - plinthH - crownH;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, plinthH / 2, 0]}>
                <boxGeometry args={[w, plinthH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, plinthH + inner / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[w, inner, backT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + sideT / 2, plinthH + inner / 2, 0]}>
                <boxGeometry args={[sideT, inner, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - sideT / 2, plinthH + inner / 2, 0]}>
                <boxGeometry args={[sideT, inner, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              {[0.2, 0.4, 0.6, 0.8].map((f, i) => (
                <EdgedMesh key={`shelf${i}`} position={[0, plinthH + inner * f, 0]}>
                  <boxGeometry args={[w - sideT * 2, shelfT, d - backT]} />
                  <meshStandardMaterial color={color} />
                </EdgedMesh>
              ))}
              <EdgedMesh position={[0, h - crownH / 2, 0]}>
                <boxGeometry args={[w + 0.04, crownH, d + 0.02]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "bench") {
          // Seat slab + 2 end-leg panels + lower stretcher + backrest panel + 2 back supports = 7 cuboids
          const seatY = h * 0.45;
          const seatH = h * 0.08;
          const legW = w * 0.06;
          const legD = d * 0.85;
          const stretcherY = seatY * 0.3;
          const stretcherH = h * 0.05;
          const backH = h - seatY - seatH;
          const backT = d * 0.1;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, seatY + seatH / 2, 0]}>
                <boxGeometry args={[w, seatH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + legW / 2, seatY / 2, 0]}>
                <boxGeometry args={[legW, seatY, legD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - legW / 2, seatY / 2, 0]}>
                <boxGeometry args={[legW, seatY, legD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, stretcherY, 0]}>
                <boxGeometry args={[w - legW * 2, stretcherH, stretcherH]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, seatY + seatH + backH / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[w * 0.85, backH, backT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w * 0.4, seatY + seatH + backH / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[legW, backH * 1.05, backT * 0.6]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.4, seatY + seatH + backH / 2, -d / 2 + backT / 2]}>
                <boxGeometry args={[legW, backH * 1.05, backT * 0.6]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "piano") {
          // Body + keyboard + lid + music rest + 3 legs + 2 pedals = 9 cuboids
          const bodyD = d * 0.7;
          const bodyH = h * 0.95;
          const kbH = h * 0.15;
          const kbD = d * 0.3;
          const legSize = Math.min(w, d) * 0.06;
          const legH = h * 0.3;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, bodyH / 2 + legH * 0.5, -d / 2 + bodyD / 2]}>
                <boxGeometry args={[w, bodyH, bodyD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h * 0.5, d / 2 - kbD / 2]}>
                <boxGeometry args={[w * 0.95, kbH, kbD]} />
                <meshStandardMaterial color="#f8fafc" />
              </EdgedMesh>
              <EdgedMesh position={[0, h - kbH * 0.3, d / 2 - kbD / 2]}>
                <boxGeometry args={[w * 0.95, kbH * 0.3, kbD * 0.4]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h - kbH * 0.5, d / 2 - kbD * 1.05]}>
                <boxGeometry args={[w * 0.7, kbH * 1.2, kbD * 0.05]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              {[[-w / 2 + legSize, -d / 2 + bodyD - legSize], [w / 2 - legSize, -d / 2 + bodyD - legSize], [0, d / 2 - legSize]].map(([x, z], i) => (
                <EdgedMesh key={`leg${i}`} position={[x, legH / 2, z]}>
                  <boxGeometry args={[legSize, legH, legSize]} />
                  <meshStandardMaterial color="#0b1220" />
                </EdgedMesh>
              ))}
              <EdgedMesh position={[-0.04, 0.02, d / 2 - legSize * 0.5]}>
                <boxGeometry args={[0.04, 0.015, 0.04]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[0.04, 0.02, d / 2 - legSize * 0.5]}>
                <boxGeometry args={[0.04, 0.015, 0.04]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "tv-unit") {
          // Cabinet base + 2 doors + 2 handles + screen frame + screen panel = 7 cuboids
          const baseH = h * 0.4;
          const screenT = d * 0.08;
          const screenH = h - baseH - 0.02;
          const doorT = d * 0.04;
          const doorW = w * 0.45;
          const handleSize = 0.025;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, baseH / 2, 0]}>
                <boxGeometry args={[w, baseH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w * 0.23, baseH / 2, d / 2 - doorT / 2]}>
                <boxGeometry args={[doorW, baseH * 0.85, doorT]} />
                <meshStandardMaterial color="#075985" />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.23, baseH / 2, d / 2 - doorT / 2]}>
                <boxGeometry args={[doorW, baseH * 0.85, doorT]} />
                <meshStandardMaterial color="#075985" />
              </EdgedMesh>
              <EdgedMesh position={[-0.02, baseH / 2, d / 2 + 0.008]}>
                <boxGeometry args={[handleSize, handleSize, handleSize]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[0.02, baseH / 2, d / 2 + 0.008]}>
                <boxGeometry args={[handleSize, handleSize, handleSize]} />
                <meshStandardMaterial color="#fbbf24" metalness={0.7} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[0, baseH + screenH / 2, -d / 2 + screenT / 2]}>
                <boxGeometry args={[w * 0.9, screenH, screenT]} />
                <meshStandardMaterial color="#0b1220" />
              </EdgedMesh>
              <EdgedMesh position={[0, baseH + screenH / 2, -d / 2 + screenT + 0.005]}>
                <boxGeometry args={[w * 0.85, screenH * 0.85, 0.005]} />
                <meshStandardMaterial color="#1e293b" />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "fridge") {
          // Fridge body + freezer body + 2 doors + 2 handles = 6 cuboids
          const freezerH = h * 0.3;
          const fridgeH = h - freezerH;
          const doorT = d * 0.04;
          const handleW = 0.025;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, fridgeH / 2, 0]}>
                <boxGeometry args={[w, fridgeH, d]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, fridgeH + freezerH / 2, 0]}>
                <boxGeometry args={[w, freezerH, d]} />
                <meshStandardMaterial color="#334155" />
              </EdgedMesh>
              <EdgedMesh position={[0, fridgeH / 2, d / 2 - doorT / 2]}>
                <boxGeometry args={[w * 0.95, fridgeH * 0.95, doorT]} />
                <meshStandardMaterial color="#1e293b" />
              </EdgedMesh>
              <EdgedMesh position={[0, fridgeH + freezerH / 2, d / 2 - doorT / 2]}>
                <boxGeometry args={[w * 0.95, freezerH * 0.9, doorT]} />
                <meshStandardMaterial color="#1e293b" />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.4, fridgeH * 0.65, d / 2 + 0.012]}>
                <boxGeometry args={[handleW, fridgeH * 0.5, handleW]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.4, fridgeH + freezerH * 0.5, d / 2 + 0.012]}>
                <boxGeometry args={[handleW, freezerH * 0.5, handleW]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.4} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "toilet") {
          // Tank + tank lid + flush button + pedestal foot + bowl + seat + lid = 7 cuboids
          const tankD = d * 0.25;
          const tankH = h * 0.85;
          const tankLidH = h * 0.05;
          const bowlH = h * 0.45;
          const bowlD = d - tankD;
          const seatH = h * 0.04;
          const lidH = h * 0.05;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, tankH / 2, -d / 2 + tankD / 2]}>
                <boxGeometry args={[w * 0.7, tankH, tankD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, tankH + tankLidH / 2, -d / 2 + tankD / 2]}>
                <boxGeometry args={[w * 0.75, tankLidH, tankD * 1.05]} />
                <meshStandardMaterial color="#e2e8f0" />
              </EdgedMesh>
              <EdgedMesh position={[0, tankH + tankLidH + 0.005, -d / 2 + tankD / 2]}>
                <boxGeometry args={[0.04, 0.012, 0.04]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.5} roughness={0.4} />
              </EdgedMesh>
              <EdgedMesh position={[0, bowlH * 0.25, -d / 2 + tankD + bowlD / 2]}>
                <boxGeometry args={[w * 0.55, bowlH * 0.5, bowlD * 0.7]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, bowlH / 2, -d / 2 + tankD + bowlD / 2]}>
                <boxGeometry args={[w * 0.85, bowlH, bowlD]} />
                <meshStandardMaterial color="#e2e8f0" />
              </EdgedMesh>
              <EdgedMesh position={[0, bowlH + seatH / 2, -d / 2 + tankD + bowlD / 2]}>
                <boxGeometry args={[w * 0.85, seatH, bowlD]} />
                <meshStandardMaterial color="#94a3b8" />
              </EdgedMesh>
              <EdgedMesh position={[0, bowlH + seatH + lidH / 2, -d / 2 + tankD + bowlD / 2]}>
                <boxGeometry args={[w * 0.85, lidH, bowlD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "guitar") {
          // 3 body parts + bridge + neck + headstock = 6 cuboids (vertical-on-wall orientation)
          const bodyW = w * 0.55;
          const bodyH = h * 0.55;
          const waistW = w * 0.35;
          const waistH = h * 0.15;
          const upperW = w * 0.5;
          const upperH = h * 0.3;
          const neckW = w * 0.18;
          const neckH = h * 0.45;
          const slabD = Math.max(0.04, d * 0.6);
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[-w * 0.3, bodyH / 2, 0]}>
                <boxGeometry args={[bodyW, bodyH, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, bodyH + waistH / 2, 0]}>
                <boxGeometry args={[waistW, waistH, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.18, bodyH + waistH + upperH / 2, 0]}>
                <boxGeometry args={[upperW, upperH, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w * 0.3, bodyH * 0.65, slabD / 2 + 0.005]}>
                <boxGeometry args={[bodyW * 0.45, bodyH * 0.04, 0.015]} />
                <meshStandardMaterial color="#1f2937" />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.4, bodyH + waistH + upperH + neckH / 2 - upperH * 0.5, 0]}>
                <boxGeometry args={[neckW, neckH, slabD * 0.7]} />
                <meshStandardMaterial color="#78350f" />
              </EdgedMesh>
              <EdgedMesh position={[w * 0.45, bodyH + waistH + upperH + neckH - upperH * 0.5 + 0.02, 0]}>
                <boxGeometry args={[neckW * 1.6, neckH * 0.18, slabD * 0.7]} />
                <meshStandardMaterial color="#78350f" />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "whiteboard") {
          // Slab + 4 frame strips + marker tray + 2 markers = 8 cuboids
          const slabD = Math.max(0.02, d * 0.4);
          const frameT = Math.min(w, h) * 0.04;
          const trayH = h * 0.05;
          const trayY = -trayH * 0.3;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h / 2, 0]}>
                <boxGeometry args={[w, h, slabD * 0.6]} />
                <meshStandardMaterial color="#f8fafc" />
              </EdgedMesh>
              <EdgedMesh position={[0, h - frameT / 2, slabD / 2]}>
                <boxGeometry args={[w, frameT, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, frameT / 2, slabD / 2]}>
                <boxGeometry args={[w, frameT, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + frameT / 2, h / 2, slabD / 2]}>
                <boxGeometry args={[frameT, h, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - frameT / 2, h / 2, slabD / 2]}>
                <boxGeometry args={[frameT, h, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, trayY, slabD * 1.2]}>
                <boxGeometry args={[w * 0.95, trayH, slabD * 1.5]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w * 0.2, trayY + trayH * 0.6, slabD * 1.2]} rotation={[0, 0, Math.PI / 2]}>
                <boxGeometry args={[0.018, 0.12, 0.018]} />
                <meshStandardMaterial color="#dc2626" />
              </EdgedMesh>
              <EdgedMesh position={[0.05, trayY + trayH * 0.6, slabD * 1.2]} rotation={[0, 0, Math.PI / 2]}>
                <boxGeometry args={[0.018, 0.1, 0.018]} />
                <meshStandardMaterial color="#1f2937" />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "flute") {
          // Tube + mouthpiece + right endcap + 5 key markers = 8 cuboids
          const tubeT = Math.min(h, d) * 0.5;
          const slabD = Math.max(0.03, d * 0.7);
          const dots: ReactNode[] = [];
          const HOLES = 5;
          for (let k = 0; k < HOLES; k++) {
            const xOff = -w * 0.3 + (w * 0.6 * k) / (HOLES - 1);
            dots.push(
              <EdgedMesh key={`k${k}`} position={[xOff, h / 2 + tubeT * 0.4, 0]}>
                <boxGeometry args={[tubeT * 0.3, tubeT * 0.3, tubeT * 0.3]} />
                <meshStandardMaterial color="#1f2937" />
              </EdgedMesh>
            );
          }
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h / 2, 0]}>
                <boxGeometry args={[w, tubeT, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + w * 0.05, h / 2, 0]}>
                <boxGeometry args={[w * 0.1, tubeT * 1.2, slabD * 1.1]} />
                <meshStandardMaterial color="#1f2937" />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - w * 0.03, h / 2, 0]}>
                <boxGeometry args={[w * 0.06, tubeT * 1.15, slabD * 1.05]} />
                <meshStandardMaterial color="#7e22ce" />
              </EdgedMesh>
              {dots}
            </group>
          );
        }
        if (g.kind === "clock") {
          // Face + 4 quadrant markers + 2 hands + center pin = 8 cuboids
          const faceT = Math.max(0.02, d * 0.5);
          const face = Math.min(w, h) * 0.85;
          const markerSize = face * 0.04;
          const markerOffset = face * 0.42;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h / 2, 0]}>
                <boxGeometry args={[face, face, faceT]} />
                <meshStandardMaterial color="#f8fafc" />
              </EdgedMesh>
              <EdgedMesh position={[0, h / 2 + markerOffset, faceT / 2 + 0.005]}>
                <boxGeometry args={[markerSize, markerSize * 2, 0.005]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[markerOffset, h / 2, faceT / 2 + 0.005]}>
                <boxGeometry args={[markerSize * 2, markerSize, 0.005]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h / 2 - markerOffset, faceT / 2 + 0.005]}>
                <boxGeometry args={[markerSize, markerSize * 2, 0.005]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-markerOffset, h / 2, faceT / 2 + 0.005]}>
                <boxGeometry args={[markerSize * 2, markerSize, 0.005]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h / 2 + face * 0.15, faceT / 2 + 0.008]}>
                <boxGeometry args={[face * 0.04, face * 0.3, 0.008]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[face * 0.18, h / 2, faceT / 2 + 0.008]}>
                <boxGeometry args={[face * 0.4, face * 0.04, 0.008]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h / 2, faceT / 2 + 0.012]}>
                <boxGeometry args={[face * 0.06, face * 0.06, 0.005]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "mirror") {
          // Glass + 4 frame strips + top ornament = 6 cuboids
          const slabD = Math.max(0.02, d * 0.4);
          const frameT = Math.min(w, h) * 0.05;
          const ornamentH = h * 0.06;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, h / 2, 0]}>
                <boxGeometry args={[w - frameT, h - frameT, slabD * 0.5]} />
                <meshStandardMaterial color="#cbd5e1" metalness={0.6} roughness={0.1} />
              </EdgedMesh>
              <EdgedMesh position={[0, h - frameT / 2, slabD / 2]}>
                <boxGeometry args={[w, frameT, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, frameT / 2, slabD / 2]}>
                <boxGeometry args={[w, frameT, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + frameT / 2, h / 2, slabD / 2]}>
                <boxGeometry args={[frameT, h, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - frameT / 2, h / 2, slabD / 2]}>
                <boxGeometry args={[frameT, h, slabD]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, h + ornamentH / 2, slabD / 2]}>
                <boxGeometry args={[w * 1.1, ornamentH, slabD * 1.2]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
            </group>
          );
        }
        if (g.kind === "bathtub") {
          // Base + 4 rim strips + faucet + 2 tap handles = 8 cuboids
          const rimT = Math.min(w, d) * 0.1;
          const rimH = h;
          const baseH = h * 0.15;
          const faucetX = -w / 2 + rimT * 1.5;
          return (
            <group key={g.id} position={[sx, g.clearanceM, sz]} rotation={[0, g.rotY, 0]}>
              <EdgedMesh position={[0, baseH / 2, 0]}>
                <boxGeometry args={[w, baseH, d]} />
                <meshStandardMaterial color="#cbd5e1" />
              </EdgedMesh>
              <EdgedMesh position={[0, rimH / 2, -d / 2 + rimT / 2]}>
                <boxGeometry args={[w, rimH, rimT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[0, rimH / 2, d / 2 - rimT / 2]}>
                <boxGeometry args={[w, rimH, rimT]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[-w / 2 + rimT / 2, rimH / 2, 0]}>
                <boxGeometry args={[rimT, rimH, d - rimT * 2]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[w / 2 - rimT / 2, rimH / 2, 0]}>
                <boxGeometry args={[rimT, rimH, d - rimT * 2]} />
                <meshStandardMaterial color={color} />
              </EdgedMesh>
              <EdgedMesh position={[faucetX, rimH + 0.05, 0]}>
                <boxGeometry args={[0.04, 0.1, 0.04]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[faucetX, rimH + 0.025, -0.08]}>
                <boxGeometry args={[0.025, 0.025, 0.025]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
              </EdgedMesh>
              <EdgedMesh position={[faucetX, rimH + 0.025, 0.08]}>
                <boxGeometry args={[0.025, 0.025, 0.025]} />
                <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.3} />
              </EdgedMesh>
            </group>
          );
        }
        return null;
      })}

      {model.furniture.map((f) => {
        const dims = FURNITURE_DIMS[f.type];
        if (!dims) return null;
        const [sx, sz] = toScene(f.x, f.y);
        const rotY = -((f.rotation ?? 0) * Math.PI) / 180;
        const sX = Math.max(0.1, f.scaleX || 1);
        const sY = Math.max(0.1, f.scaleY || 1);
        return (
          <EdgedMesh key={f.id} position={[sx, dims.h / 2, sz]} rotation={[0, rotY, 0]} scale={[sX, 1, sY]}>
            <boxGeometry args={[dims.w, dims.h, dims.d]} />
            <meshStandardMaterial color={GREY} />
          </EdgedMesh>
        );
      })}
    </Canvas>
  );
}
