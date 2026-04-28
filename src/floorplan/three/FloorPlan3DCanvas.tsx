import { useMemo, type ComponentProps, type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Edges, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import type { FloorPlanModel, FurnitureItem, Wall } from "../types";
import { computeMiteredWallPolygons } from "../wallGeometry";

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

export default function FloorPlan3DCanvas({ model, pixelsPerMeter, placementMode = "polygon" }: Props) {
  const ppm = Math.max(1e-6, pixelsPerMeter);
  const useSymbol = placementMode === "2dSymbol";

  // Per-wall mitered polygon footprints (plan coords). Used in 3D for seamless-corner extrusion
  // when the wall's mode is "mitered" or "mitered-union" (i.e. when 2D Sharp view is on).
  const miteredPolygons = useMemo(() => computeMiteredWallPolygons(model.walls), [model.walls]);

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
    >
      <ambientLight intensity={1.1} />
      <directionalLight position={[20, 30, 15]} intensity={0.5} />
      <directionalLight position={[-15, 20, -10]} intensity={0.35} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.12} target={[0, 1, 0]} />

      {model.walls.filter((w) => {
        if (!isExtrudableWall(w)) return false;
        if (useSymbol && (w.isPlacementWall || w.isPlacementPreview) && w.placementObjectId && w.placementKind) return false;
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
            <EdgedMesh key={`${w.id}:sharp`} rotation={[-Math.PI / 2, 0, 0]}>
              <extrudeGeometry args={[shape, { depth: WALL_HEIGHT_M, bevelEnabled: false, steps: 1 }]} />
              <meshStandardMaterial color={GREY} />
            </EdgedMesh>,
          ];
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
            <EdgedMesh key={`${w.id}:${i}`} position={[sx, yCenter, sz]} rotation={[0, rotY, 0]}>
              <boxGeometry args={[lenM, h, thicknessM]} />
              <meshStandardMaterial color={GREY} />
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
          return (
            <group key={`door-prim-${w.id}`} position={[sx, 0, sz]} rotation={[0, rotY, 0]}>
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
              <EdgedMesh position={[0, slabH / 2, 0]}>
                <boxGeometry args={[innerLen, slabH - 0.02, slabD]} />
                <meshStandardMaterial color={wood} />
              </EdgedMesh>
              <EdgedMesh position={[innerLen * 0.4, slabH * 0.5, slabD / 2 + 0.005]}>
                <boxGeometry args={[0.04, 0.06, 0.04]} />
                <meshStandardMaterial color={handleColor} metalness={0.7} roughness={0.3} />
              </EdgedMesh>
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
            {/* Glass pane */}
            <EdgedMesh position={[0, cy, 0]}>
              <boxGeometry args={[innerW, innerH, glassT]} />
              <meshStandardMaterial color="#7dd3fc" transparent opacity={0.35} metalness={0.15} roughness={0.05} />
            </EdgedMesh>
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
