/** A faithful re-implementation of evaluateFlow's `plan-json` branch, so the harness grades the REAL
 *  behaviour rather than an idealised one. Kept line-for-line with the source; if the two drift, the
 *  harness stops being evidence. */

const pointInPolyEO = (x, y, poly) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-12) + xi)) inside = !inside;
  }
  return inside;
};

export function planJson({ spaces, spaceMeta, segments, segmentMeta, nodes, nodeMeta }, opts) {
  const { ppm, anchor = { x: 0, y: 0 }, scope, edgeTolerance = 0.15, decimals = 3, includeParams = true, includeNodes = true } = opts;
  const r = (v) => Math.round(v * 10 ** decimals) / 10 ** decimals;
  const toM = (p) => [r((p.x - anchor.x) / ppm), r((p.y - anchor.y) / ppm)];
  const tolPx = Math.max(0, edgeTolerance) * ppm;

  const nearBoundary = (p, poly) => {
    if (tolPx <= 0) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[j], b = poly[i];
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
      if (Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)) <= tolPx) return true;
    }
    return false;
  };
  const inScope = (p, edge) => !scope || pointInPolyEO(p.x, p.y, scope) || (edge && nearBoundary(p, scope));
  const meta = (mm) => (mm?.objectId ? { objectId: mm.objectId, ...(includeParams && mm.params ? { params: mm.params } : {}) } : {});

  let objectCount = 0;
  const spacesOut = [];
  spaces.forEach((sp, i) => {
    if (sp.length < 3) return;
    let cx = 0, cy = 0;
    for (const p of sp) { cx += p.x; cy += p.y; }
    cx /= sp.length; cy /= sp.length;
    if (scope && !pointInPolyEO(cx, cy, scope)) return;
    let a2 = 0;
    for (let k = 0; k < sp.length; k++) { const p = sp[k], q = sp[(k + 1) % sp.length]; a2 += p.x * q.y - q.x * p.y; }
    const mm = spaceMeta?.[i];
    if (mm?.objectId) objectCount += 1;
    spacesOut.push({ boundary: sp.map(toM), areaM2: r(Math.abs(a2 / 2) / (ppm * ppm)), ...meta(mm) });
  });

  const segsOut = [];
  segments.forEach((sg, i) => {
    if (sg.length < 2) return;
    const mid = { x: (sg[0].x + sg[1].x) / 2, y: (sg[0].y + sg[1].y) / 2 };
    if (!inScope(mid, true)) return;
    const mm = segmentMeta?.[i];
    if (mm?.objectId) objectCount += 1;
    segsOut.push({
      ...(mm?.id ? { id: mm.id } : {}),
      type: mm?.type ?? "wall",
      from: toM(sg[0]), to: toM(sg[1]),
      lengthM: r(Math.hypot(sg[1].x - sg[0].x, sg[1].y - sg[0].y) / ppm),
      ...(typeof mm?.thicknessPx === "number" ? { thicknessM: r(mm.thicknessPx / ppm) } : {}),
      ...meta(mm),
    });
  });

  const nodesOut = [];
  if (includeNodes) nodes.forEach((nd, i) => {
    const p = nd[0];
    if (!p || !inScope(p, true)) return;
    const mm = nodeMeta?.[i];
    if (mm?.objectId) objectCount += 1;
    nodesOut.push({ ...(mm?.id ? { id: mm.id } : {}), at: toM(p), ...meta(mm) });
  });

  const json = JSON.stringify({
    units: "m", scoped: Boolean(scope),
    ...(spacesOut.length === 1 ? { space: spacesOut[0] } : { spaces: spacesOut }),
    segments: segsOut,
    ...(includeNodes ? { nodes: nodesOut } : {}),
  });
  return { json, spaceCount: spacesOut.length, segmentCount: segsOut.length, nodeCount: nodesOut.length, objectCount, bytes: json.length };
}
