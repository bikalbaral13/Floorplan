/** WALKTHROUGH — a plan-level entity beside nodes / segments / spaces (`walkthrough` in the plan file).
 *
 *  It is a SPACE TRAVERSAL GRAPH plus one chosen route through it:
 *    stops  — one per space: where a visitor stands in it (a well-inside point, not a centroid that may fall
 *             outside an L-shaped room or on a wall)
 *    links  — undirected edges between spaces, each with the PASSAGE it goes through: a door / opening
 *             segment (its midpoint), or a shared open edge with no wall on it (an open living–dining)
 *    route  — the order the stops are visited, FORWARD (entrance first, depth-first, walking back through
 *             rooms already seen so the path never jumps); BACKWARD is the same route reversed
 *    path   — the resolved polyline (plan px) a camera follows: stop → just inside the door → door → just
 *             inside the next room → next stop
 *  plus how a person moves: eye height, walking speed, field of view, a pause at each stop.
 *
 *  Pure data in, pure data out, on the plan FILE shape (nodes / segments / spaces in plan px), so the same
 *  builder runs in the editor and in `tools/walkthrough/run.mjs` on a JSON file. */

export interface WalkPoint { x: number; y: number }
export interface WalkStop { id: string; spaceId: string; label: string; point: WalkPoint }
export interface WalkLink { from: string; to: string; kind: "door" | "opening" | "open"; segmentId?: string; via: WalkPoint }
export interface Walkthrough {
  schema: "walkthrough/1";
  /** Eye height above the floor, metres. */
  eyeHeight: number;
  /** Walking speed, metres / second. */
  speed: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Seconds to linger at each stop (the camera keeps turning toward the next leg). */
  pauseAtStops: number;
  /** The space the walk starts in. */
  start: string;
  stops: WalkStop[];
  links: WalkLink[];
  /** Stop ids in FORWARD order (may revisit a stop when walking back). Backward = reversed. */
  route: string[];
  /** The polyline the camera follows, plan px, forward. */
  path: WalkPoint[];
  /** Index into `path` of each route entry, so a player can pause / label at stops. */
  routePathIndex: number[];
  generatedAt?: string;
}

interface PlanNodeIn { id: string; x: number; y: number }
interface AttachmentIn { objectId?: string; objectPath?: string; params?: Record<string, unknown> }
interface PlanSegmentIn { id: string; fromNodeId: string; toNodeId: string; layer?: string; label?: string; isObjectOpening?: boolean; segmentType?: string; attachments?: AttachmentIn[] }
interface PlanSpaceIn { id: string; nodeIds: string[]; label?: string; roomType?: string }
export interface WalkPlanIn { settings?: { pixelsPerMeter?: number }; nodes: PlanNodeIn[]; segments: PlanSegmentIn[]; spaces: PlanSpaceIn[] }

const ENTRY = /\b(porch|sit-?out|entrance|entry|foyer|lobby|verandah|veranda)\b/i;

const area = (p: WalkPoint[]) => Math.abs(p.reduce((a, q, i) => { const r = p[(i + 1) % p.length]; return a + q.x * r.y - r.x * q.y; }, 0)) / 2;
const inside = (pt: WalkPoint, poly: WalkPoint[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > pt.y) !== (b.y > pt.y) && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};
const segDist = (p: WalkPoint, a: WalkPoint, b: WalkPoint) => {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const edgeDist = (p: WalkPoint, poly: WalkPoint[]) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length])));

/** A point well inside the polygon: the grid sample farthest from every edge (a cheap pole of inaccessibility). */
function standPoint(poly: WalkPoint[]): WalkPoint {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const n = 24;
  let best = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, bd = -1;
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const p = { x: x0 + ((x1 - x0) * i) / n, y: y0 + ((y1 - y0) * j) / n };
    if (!inside(p, poly)) continue;
    const d = edgeDist(p, poly);
    if (d > bd) { bd = d; best = p; }
  }
  return best;
}

export function buildWalkthrough(plan: WalkPlanIn, opts: Partial<Pick<Walkthrough, "eyeHeight" | "speed" | "fov" | "pauseAtStops" | "start">> = {}): Walkthrough {
  const ppm = Number(plan.settings?.pixelsPerMeter) || 50;
  const nodeById = new Map(plan.nodes.map((n) => [n.id, n]));
  const spaces = plan.spaces
    .map((s) => ({ s, poly: s.nodeIds.map((id) => nodeById.get(id)).filter((n): n is PlanNodeIn => !!n).map((n) => ({ x: n.x, y: n.y })) }))
    .filter((x) => x.poly.length >= 3 && x.s.roomType !== "floorplate-boundary");
  // Which space a point is in: the SMALLEST containing one (traced plans overlap rooms).
  const spaceAt = (p: WalkPoint) => spaces.filter((x) => inside(p, x.poly)).sort((a, b) => area(a.poly) - area(b.poly))[0];

  const stops: WalkStop[] = spaces.map(({ s, poly }) => ({ id: `stop-${s.id}`, spaceId: s.id, label: s.label ?? s.id, point: standPoint(poly) }));
  const links: WalkLink[] = [];
  const linked = new Set<string>();
  const addLink = (a: string, b: string, kind: WalkLink["kind"], via: WalkPoint, segmentId?: string) => {
    if (a === b) return;
    const k = [a, b].sort().join("|");
    if (linked.has(k)) return;
    linked.add(k);
    links.push({ from: `stop-${a}`, to: `stop-${b}`, kind, via, ...(segmentId ? { segmentId } : {}) });
  };

  // 1. Doors and openings: the two spaces on either side of the opening segment's midpoint.
  const probe = 0.6 * ppm;
  const passageKind = (seg: PlanSegmentIn): WalkLink["kind"] | null => {
    const paths = (seg.attachments ?? []).map((a) => `${a.objectPath ?? ""} ${a.objectId ?? ""}`.toLowerCase());
    if (paths.some((p) => /door/.test(p)) || seg.layer === "door" || seg.segmentType === "door") return "door";
    if (paths.some((p) => /opening/.test(p)) || seg.layer === "opening") return "opening";
    return null;
  };
  for (const seg of plan.segments) {
    const kind = passageKind(seg);
    if (!kind) continue;
    const a = nodeById.get(seg.fromNodeId), b = nodeById.get(seg.toNodeId);
    if (!a || !b) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const s1 = spaceAt({ x: m.x + nx * probe, y: m.y + ny * probe });
    const s2 = spaceAt({ x: m.x - nx * probe, y: m.y - ny * probe });
    if (s1 && s2) addLink(s1.s.id, s2.s.id, kind, m, seg.id);
  }

  // 2. Open plan: two spaces sharing a boundary run with NO wall segment on it (living–dining, kitchen–dining).
  const wallSegs = plan.segments
    .filter((g) => !passageKind(g) && (g.layer === "wall" || g.segmentType === "wall" || (g.attachments ?? []).some((a) => /wall/.test(`${a.objectPath ?? ""}${a.objectId ?? ""}`))))
    .map((g) => [nodeById.get(g.fromNodeId), nodeById.get(g.toNodeId)] as const)
    .filter((p): p is readonly [PlanNodeIn, PlanNodeIn] => !!p[0] && !!p[1]);
  const onWall = (p: WalkPoint) => wallSegs.some(([a, b]) => segDist(p, a, b) < 0.12 * ppm);
  for (let i = 0; i < spaces.length; i++) for (let j = i + 1; j < spaces.length; j++) {
    const A = spaces[i], B = spaces[j];
    const k = [A.s.id, B.s.id].sort().join("|");
    if (linked.has(k)) continue;
    // sample A's boundary; a run of samples that lie on B's boundary, off any wall, is an open edge
    // the passage is the MIDDLE of the longest shared open run — its end would hug a wall corner
    let run = 0, runStart: WalkPoint | null = null, bestRun = 0, best: WalkPoint | null = null;
    for (let e = 0; e < A.poly.length; e++) {
      const p = A.poly[e], q = A.poly[(e + 1) % A.poly.length];
      const len = Math.hypot(q.x - p.x, q.y - p.y), steps = Math.max(2, Math.round(len / (0.2 * ppm)));
      for (let t = 0; t <= steps; t++) {
        const s = { x: p.x + ((q.x - p.x) * t) / steps, y: p.y + ((q.y - p.y) * t) / steps };
        const shared = edgeDist(s, B.poly) < 0.1 * ppm && !onWall(s);
        if (shared) { if (!run) runStart = s; run++; } else run = 0;
        if (run > bestRun && runStart) { bestRun = run; best = { x: (runStart.x + s.x) / 2, y: (runStart.y + s.y) / 2 }; }
      }
      run = 0;
    }
    if (best && bestRun * 0.2 >= 0.9) addLink(A.s.id, B.s.id, "open", best);
  }

  // 3. Route: start at the entrance (else the space reached by an outside door, else the largest), depth-first,
  //    biggest rooms first, walking BACK through rooms already visited so the camera path is continuous.
  const adj = new Map<string, WalkLink[]>();
  for (const l of links) for (const [x, y] of [[l.from, l.to], [l.to, l.from]] as const) {
    if (!adj.has(x)) adj.set(x, []);
    adj.get(x)!.push({ ...l, from: x, to: y });
  }
  const areaOf = new Map(spaces.map((x) => [`stop-${x.s.id}`, area(x.poly)]));
  const startStop = opts.start ?? stops.find((s) => ENTRY.test(s.label))?.id ?? [...stops].sort((a, b) => (areaOf.get(b.id) ?? 0) - (areaOf.get(a.id) ?? 0))[0]?.id;
  const route: string[] = [];
  const legs: (WalkLink | null)[] = [];
  const seen = new Set<string>();
  const visit = (id: string, via: WalkLink | null) => {
    seen.add(id);
    route.push(id); legs.push(via);
    const next = (adj.get(id) ?? []).filter((l) => !seen.has(l.to)).sort((a, b) => (areaOf.get(b.to) ?? 0) - (areaOf.get(a.to) ?? 0));
    for (const l of next) {
      if (seen.has(l.to)) continue;
      visit(l.to, l);
      route.push(id); legs.push({ ...l, from: l.to, to: id }); // walk back
    }
  };
  if (startStop) visit(startStop, null);
  // 4. Path: stop → just inside the door → door → just inside the next room → next stop.
  const stopById = new Map(stops.map((s) => [s.id, s]));
  const path: WalkPoint[] = [];
  const routePathIndex: number[] = [];
  const inset = 0.7 * ppm;
  route.forEach((sid, i) => {
    const st = stopById.get(sid)!;
    const leg = legs[i];
    if (leg && i > 0) {
      const prev = stopById.get(route[i - 1])!;
      const toward = (from: WalkPoint, to: WalkPoint, d: number) => { const L = Math.hypot(to.x - from.x, to.y - from.y) || 1; return { x: from.x + ((to.x - from.x) / L) * d, y: from.y + ((to.y - from.y) / L) * d }; };
      path.push(toward(leg.via, prev.point, Math.min(inset, Math.hypot(prev.point.x - leg.via.x, prev.point.y - leg.via.y) * 0.5)));
      path.push(leg.via);
      path.push(toward(leg.via, st.point, Math.min(inset, Math.hypot(st.point.x - leg.via.x, st.point.y - leg.via.y) * 0.5)));
    }
    routePathIndex.push(path.length);
    path.push(st.point);
  });

  return {
    schema: "walkthrough/1",
    eyeHeight: opts.eyeHeight ?? 1.6,
    speed: opts.speed ?? 1.1,
    fov: opts.fov ?? 62,
    pauseAtStops: opts.pauseAtStops ?? 1.2,
    start: startStop ?? "",
    stops, links, route, path, routePathIndex,
    generatedAt: new Date().toISOString(),
  };
}

/** Arc-length parameterisation of a polyline (plan px): total length and a sampler t∈[0,1] → point + heading. */
export function pathSampler(path: WalkPoint[]) {
  const cum = [0];
  for (let i = 1; i < path.length; i++) cum.push(cum[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
  const total = cum[cum.length - 1] || 1;
  const at = (t: number): WalkPoint => {
    const d = Math.max(0, Math.min(1, t)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1, u = (d - cum[i - 1]) / seg;
    return { x: path[i - 1].x + (path[i].x - path[i - 1].x) * u, y: path[i - 1].y + (path[i].y - path[i - 1].y) * u };
  };
  return { total, cum, at };
}
