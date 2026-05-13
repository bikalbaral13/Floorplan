import type { Point } from "../../types";

export interface MarchingSquaresSegment {
  p1: Point;
  p2: Point;
  /** Index into the `isoLevels` array that produced this segment. */
  level: number;
}

/** Standard marching-squares contouring on a regular grid.
 *  `values` is row-major (row j, col i) of size gridW * gridH.
 *  Returns line segments (one or two per cell × per iso-level).
 *  Pass an `accept(midX, midY)` predicate to clip results (e.g. against a polygon). */
export const marchingSquaresContours = (
  values: ArrayLike<number>,
  gridW: number,
  gridH: number,
  originX: number,
  originY: number,
  cellSize: number,
  isoLevels: number[],
  accept?: (mx: number, my: number) => boolean,
): MarchingSquaresSegment[] => {
  const segs: MarchingSquaresSegment[] = [];

  const interp = (a: number, b: number, va: number, vb: number, iso: number): number => {
    const d = vb - va;
    if (Math.abs(d) < 1e-9) return a;
    return a + (b - a) * ((iso - va) / d);
  };

  for (let j = 0; j < gridH - 1; j++) {
    for (let i = 0; i < gridW - 1; i++) {
      const x0 = originX + i * cellSize, y0 = originY + j * cellSize;
      const x1 = x0 + cellSize, y1 = y0 + cellSize;
      const v00 = values[j * gridW + i];
      const v10 = values[j * gridW + i + 1];
      const v01 = values[(j + 1) * gridW + i];
      const v11 = values[(j + 1) * gridW + i + 1];
      for (let k = 0; k < isoLevels.length; k++) {
        const iso = isoLevels[k];
        let code = 0;
        if (v00 >= iso) code |= 1;
        if (v10 >= iso) code |= 2;
        if (v11 >= iso) code |= 4;
        if (v01 >= iso) code |= 8;
        if (code === 0 || code === 15) continue;
        const eB = (): Point => ({ x: interp(x0, x1, v00, v10, iso), y: y0 });
        const eR = (): Point => ({ x: x1, y: interp(y0, y1, v10, v11, iso) });
        const eT = (): Point => ({ x: interp(x0, x1, v01, v11, iso), y: y1 });
        const eL = (): Point => ({ x: x0, y: interp(y0, y1, v00, v01, iso) });
        const pairs: Array<[Point, Point]> = [];
        switch (code) {
          case 1: case 14: pairs.push([eB(), eL()]); break;
          case 2: case 13: pairs.push([eB(), eR()]); break;
          case 3: case 12: pairs.push([eL(), eR()]); break;
          case 4: case 11: pairs.push([eR(), eT()]); break;
          case 5: pairs.push([eB(), eR()]); pairs.push([eT(), eL()]); break;
          case 6: case 9: pairs.push([eB(), eT()]); break;
          case 7: case 8: pairs.push([eL(), eT()]); break;
          case 10: pairs.push([eB(), eL()]); pairs.push([eR(), eT()]); break;
        }
        for (const [a, b] of pairs) {
          if (accept) {
            const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
            if (!accept(mx, my)) continue;
          }
          segs.push({ p1: a, p2: b, level: k });
        }
      }
    }
  }
  return segs;
};
