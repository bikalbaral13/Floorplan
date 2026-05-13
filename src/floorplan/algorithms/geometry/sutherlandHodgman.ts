import type { Point } from "../../types";

const signedPolygonArea = (poly: Point[]): number => {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
    a += p1.x * p2.y - p2.x * p1.y;
  }
  return a / 2;
};

/** Sutherland–Hodgman polygon clipping. The clip polygon is implicitly normalised to CCW so the
 *  half-plane "inside" test is consistent. Works for convex clip polygons; for concave clip
 *  polygons it falls back to clipping against each edge as a half-plane (slightly-too-large output
 *  in deep concavities — acceptable for typical floorplate shapes). */
export const sutherlandHodgmanClip = (subject: Point[], clipPolygon: Point[]): Point[] => {
  if (subject.length === 0 || clipPolygon.length === 0) return [];
  const clipPoly = signedPolygonArea(clipPolygon) < 0 ? [...clipPolygon].reverse() : clipPolygon.slice();
  let output = subject;
  const N = clipPoly.length;
  for (let i = 0; i < N; i++) {
    if (output.length === 0) break;
    const input = output;
    output = [];
    const a = clipPoly[i], b = clipPoly[(i + 1) % N];
    const edgeDx = b.x - a.x, edgeDy = b.y - a.y;
    const inside = (p: Point) => edgeDx * (p.y - a.y) - edgeDy * (p.x - a.x) >= -1e-6;
    const intersect = (p: Point, q: Point): Point => {
      const denom = (q.x - p.x) * edgeDy - (q.y - p.y) * edgeDx;
      const t = denom === 0 ? 0 : ((a.x - p.x) * edgeDy - (a.y - p.y) * edgeDx) / denom;
      return { x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) };
    };
    for (let j = 0; j < input.length; j++) {
      const curr = input[j];
      const prev = input[(j - 1 + input.length) % input.length];
      const currIn = inside(curr);
      const prevIn = inside(prev);
      if (currIn) {
        if (!prevIn) output.push(intersect(prev, curr));
        output.push(curr);
      } else if (prevIn) {
        output.push(intersect(prev, curr));
      }
    }
  }
  return output;
};
