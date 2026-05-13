import type { Point, Wall, WallMethod, WallMode, WallPolygonGeometry } from "../../types";

export const wallWithDefaults = (
  wall: Wall
): Wall & { mode: WallMode; method: WallMethod; thickness: number } => ({
  ...wall,
  thickness: wall.thickness ?? 10,
  mode: wall.mode ?? "fill",
  method: wall.method ?? "center",
});

/** Rectangle corners for a wall as a polygon (spine = start→end, thickness perpendicular). */
export const getWallCorners = (wall: Wall): Point[] => {
  const { start, end, thickness, method } = wallWithDefaults(wall);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return [start, start, start, start];
  }
  const nx = -dy / len;
  const ny = dx / len;
  const T = thickness;

  if (method === "center") {
    const h = T / 2;
    return [
      { x: start.x + nx * h, y: start.y + ny * h },
      { x: end.x + nx * h, y: end.y + ny * h },
      { x: end.x - nx * h, y: end.y - ny * h },
      { x: start.x - nx * h, y: start.y - ny * h },
    ];
  }
  if (method === "left") {
    return [
      { x: start.x, y: start.y },
      { x: end.x, y: end.y },
      { x: end.x + nx * T, y: end.y + ny * T },
      { x: start.x + nx * T, y: start.y + ny * T },
    ];
  }
  return [
    { x: start.x - nx * T, y: start.y - ny * T },
    { x: end.x - nx * T, y: end.y - ny * T },
    { x: end.x, y: end.y },
    { x: start.x, y: start.y },
  ];
};

/** Full polygonal-rectangle description: four boundary edges, spine (center line), and corners. */
export const getWallPolygonGeometry = (wall: Wall): WallPolygonGeometry => {
  const corners = getWallCorners(wall);
  const edges: [Point, Point][] = [];
  for (let i = 0; i < 4; i++) {
    edges.push([corners[i], corners[(i + 1) % 4]]);
  }
  return {
    corners,
    edges,
    spine: { start: wall.start, end: wall.end },
  };
};

export const wallPolygonPoints = (wall: Wall) => getWallCorners(wall).flatMap((p) => [p.x, p.y]);

export const clampWallThicknessPx = (t: number) => Math.max(2, Math.min(5000, t));

/** Dotted-line segment for thickness preview (world px); length equals thickness. */
export const getWallThicknessPreviewSegment = (
  spine: { start: Point; end: Point; method?: WallMethod },
  thicknessPx: number
): { a: Point; b: Point } => {
  const { start, end } = spine;
  const method = spine.method ?? "center";
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) {
    return { a: start, b: start };
  }
  const nx = -dy / len;
  const ny = dx / len;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const T = thicknessPx;

  if (method === "center") {
    const h = T / 2;
    return { a: { x: mx + nx * h, y: my + ny * h }, b: { x: mx - nx * h, y: my - ny * h } };
  }
  if (method === "left") {
    return { a: { x: mx, y: my }, b: { x: mx + nx * T, y: my + ny * T } };
  }
  return { a: { x: mx, y: my }, b: { x: mx - nx * T, y: my - ny * T } };
};

export type WallThicknessHandleLayout = {
  key: string;
  /** Outward normal for this handle (drag positive along this increases thickness). */
  normal: Point;
  x: number;
  y: number;
  /** center -> 2, left/right single handle -> 1 */
  thicknessFactor: number;
};

export const getWallThicknessHandleLayouts = (wall: Wall, thicknessPx: number): WallThicknessHandleLayout[] => {
  const { start, end, method } = wallWithDefaults(wall);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.hypot(dx, dy);
  const nx = len < 1e-9 ? 0 : -dy / len;
  const ny = len < 1e-9 ? 0 : dx / len;
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  const T = thicknessPx;

  if (method === "center") {
    const h = T / 2;
    return [
      { key: `${wall.id}-th-a`, normal: { x: nx, y: ny }, x: mx + nx * h, y: my + ny * h, thicknessFactor: 2 },
      { key: `${wall.id}-th-b`, normal: { x: -nx, y: -ny }, x: mx - nx * h, y: my - ny * h, thicknessFactor: 2 },
    ];
  }
  if (method === "left") {
    return [{ key: `${wall.id}-th-o`, normal: { x: nx, y: ny }, x: mx + nx * T, y: my + ny * T, thicknessFactor: 1 }];
  }
  return [{ key: `${wall.id}-th-o`, normal: { x: -nx, y: -ny }, x: mx - nx * T, y: my - ny * T, thicknessFactor: 1 }];
};

export const getWallJustifiedSpine = (wall: Wall): { start: Point; end: Point } => {
  const { start, end } = wallWithDefaults(wall);
  // For all justifications the rendered single-line spine is the user's clicks (start→end).
  return { start, end };
};
