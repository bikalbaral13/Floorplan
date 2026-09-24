// Mirrors the plan-json scoping in evaluateFlow.ts exactly, to check the boundary-wall case.
const pointInPolyEO = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi)) inside = !inside;
  }
  return inside;
};
const build = (scope, segments, nodes, tolPx) => {
  const nearBoundary = (p, poly) => {
    if (tolPx <= 0) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx*dx + dy*dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x-a.x)*dx + (p.y-a.y)*dy)/L2)) : 0;
      if (Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy)) <= tolPx) return true;
    }
    return false;
  };
  const inScope = (p, edge) => !scope || pointInPolyEO(p.x, p.y, scope) || (edge && nearBoundary(p, scope));
  const segs = segments.filter(sg => inScope({ x:(sg[0].x+sg[1].x)/2, y:(sg[0].y+sg[1].y)/2 }, true));
  const nds  = nodes.filter(n => inScope(n, true));
  return { segs: segs.length, nodes: nds.length };
};
const PPM = 50;                                   // 50 px per metre
const P = (x,y) => ({x: x*PPM, y: y*PPM});
// Room A: 0,0 -> 5,4.  Room B shares the x=5 wall and runs 5,0 -> 9,4.
const roomA = [P(0,0), P(5,0), P(5,4), P(0,4)];
const wallsA = [[P(0,0),P(5,0)], [P(5,0),P(5,4)], [P(5,4),P(0,4)], [P(0,4),P(0,0)]]; // the 4 bounding walls
const wallsB = [[P(5,0),P(9,0)], [P(9,0),P(9,4)], [P(9,4),P(5,4)]];                   // neighbour's other 3
const inner  = [[P(1,1),P(3,1)]];                                                     // a partition inside A
const nodesAll = [P(0,0),P(5,0),P(5,4),P(0,4),P(9,0),P(9,4),P(2,2)];
const all = [...wallsA, ...wallsB, ...inner];

const tol = 0.15 * PPM;
const r = build(roomA, all, nodesAll, tol);
console.log(`tol 0.15 m -> ${r.segs} segments, ${r.nodes} nodes   (want 5 segs: 4 bounding + 1 inner; 5 nodes: 4 corners + 1 interior)`);
const r0 = build(roomA, all, nodesAll, 0);
console.log(`tol 0    m -> ${r0.segs} segments   (want < 5: a midpoint lying exactly ON the outline is UNDEFINED under even-odd ray casting, so a strict test keeps some bounding walls and drops others - non-deterministic, which is what the tolerance fixes)`);
const rBig = build(roomA, all, nodesAll, 2.5 * PPM);
console.log(`tol 2.5  m -> ${rBig.segs} segments   (want > 5: too generous, pulls in the neighbour's walls)`);
const rNone = build(null, all, nodesAll, tol);
console.log(`unscoped   -> ${rNone.segs} segments, ${rNone.nodes} nodes   (want all ${all.length}, ${nodesAll.length})`);
const ok = r.segs === 5 && r.nodes === 5 && r0.segs < 5 && rBig.segs > 5 && rNone.segs === all.length && rNone.nodes === nodesAll.length;
console.log(ok ? "\nall scoping checks passed" : "\nSCOPING CHECK FAILED");
