import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { FloorPlanModel, FurnitureItem, Wall } from "../types";

interface Props {
  model: FloorPlanModel;
  pixelsPerMeter: number;
}

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

export default function FloorPlan3DCanvas({ model, pixelsPerMeter }: Props) {
  const ppm = Math.max(1e-6, pixelsPerMeter);

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

      {model.walls.filter(isExtrudableWall).flatMap((w) => {
        const dx = w.end.x - w.start.x;
        const dy = w.end.y - w.start.y;
        const lenPx = Math.hypot(dx, dy);
        if (lenPx < 1) return [];
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
            <mesh key={`${w.id}:${i}`} position={[sx, yCenter, sz]} rotation={[0, rotY, 0]}>
              <boxGeometry args={[lenM, h, thicknessM]} />
              <meshStandardMaterial color={GREY} />
            </mesh>
          );
        });
      })}

      {model.furniture.map((f) => {
        const dims = FURNITURE_DIMS[f.type];
        if (!dims) return null;
        const [sx, sz] = toScene(f.x, f.y);
        const rotY = -((f.rotation ?? 0) * Math.PI) / 180;
        const sX = Math.max(0.1, f.scaleX || 1);
        const sY = Math.max(0.1, f.scaleY || 1);
        return (
          <mesh key={f.id} position={[sx, dims.h / 2, sz]} rotation={[0, rotY, 0]} scale={[sX, 1, sY]}>
            <boxGeometry args={[dims.w, dims.h, dims.d]} />
            <meshStandardMaterial color={GREY} />
          </mesh>
        );
      })}
    </Canvas>
  );
}
