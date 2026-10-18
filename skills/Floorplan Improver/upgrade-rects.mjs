/** The second pattern: door and window.
 *
 *  Neither carries the shared quad table. They build a `_Rects` table of ROTATED rectangles —
 *  centre, unit axis, half-extents, z range — and extrude each with mprism inside a loop. That
 *  is still a box, so it still softens; it just has to be built in the part's own axis frame
 *  and rotated back, which is the same frame rule bed.json uses.
 *
 *  Only the one line that makes the solid changes. The ring, the plan list, the group routing
 *  and the mesh flag are all left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { NEW_PROPS } from "./softkernel.mjs";

const DIALS = `# ── mesh dials ────────────────────────────────────────────────────────────────────────────
# Same two dials as the rest of the library. Stations stay at 2 because a frame member has flat
# ends: with roundTop = 0 the solid is a straight prism and extra stations subdivide a vertical
# wall for nothing. The points go into the PLAN corners, which is where a jamb or a leaf edge
# actually catches the light.
_dBlocky = detail == 'Blocky'
_dMedium = detail == 'Medium'
_dFine = detail == 'Fine'
_pts = _dBlocky ? 4 : (_dMedium ? 12 : (_dFine ? 20 : 32))
_eCrisp = edgeCharacter == 'Crisp'
_eSoft = edgeCharacter == 'Soft'
_ePlan = _eCrisp ? 0.012 : (_eSoft ? 0.045 : 0.20)
`;

/** The one line each file uses to make a solid, and what it becomes. */
const SWAP = [
  {
    // window: the ring is already world-space, built from _ux/_uy and _px/_py
    from: `_solid = mprism(_ring, _z0, _z1)`,
    to: `_secW = Solid.SoftBox(hcat(0 - _hL, 0 - _hT, _z0, _hL, _hT, _z1), 0, 0, _ePlan, 2, _pts)
_skW = Solid.Skin(_secW, i * 100000)
_suW = col(_skW, 0)
_svW = col(_skW, 1)
_solid = _dBlocky ? mprism(_ring, _z0, _z1) : hcat(_ccx + _suW * _ux + _svW * _px, _ccy + _suW * _uy + _svW * _py, col(_skW, 2), col(_skW, 3))`,
  },
  {
    // door: same shape, its own axis columns
    from: `_solid = _mf > 0.5 ? mprism(_ring, _z0, _z1) : zeros(0, 4)`,
    to: `_secD = Solid.SoftBox(hcat(0 - _rL, 0 - _rT, _z0, _rL, _rT, _z1), 0, 0, _ePlan, 2, _pts)
_skD = Solid.Skin(_secD, i * 100000)
_suD = col(_skD, 0)
_svD = col(_skD, 1)
_softD = hcat(_rcx + _suD * _rax - _svD * _ray, _rcy + _suD * _ray + _svD * _rax, col(_skD, 2), col(_skD, 3))
_solid = _mf > 0.5 ? (_dBlocky ? mprism(_ring, _z0, _z1) : _softD) : zeros(0, 4)`,
  },
];

export function upgradeRects(obj) {
  const props = obj.nodes.find((n) => n.data?.tool === "input-props");
  const math = obj.nodes.find((n) => n.data?.tool === "expr");
  if (!props || !math) return { changed: false, why: "no props/math" };
  let expr = math.data.params.expr;
  if (expr.includes("Solid.SoftBox")) return { changed: false, why: "already upgraded" };

  const hit = SWAP.find((s) => expr.includes(s.from));
  if (!hit) return { changed: false, why: "no known mprism line" };
  expr = expr.replace(hit.from, hit.to);

  // the dials go in just above the loop that consumes them
  const anchor = "_All = zeros(0, 4)";
  if (!expr.includes(anchor)) return { changed: false, why: "no place to put the dials" };
  expr = expr.replace(anchor, DIALS + anchor);
  math.data.params.expr = expr;

  const have = new Set(props.data.params.props.map((p) => p.id));
  for (const p of NEW_PROPS) if (!have.has(p.id)) props.data.params.props.push(JSON.parse(JSON.stringify(p)));
  const ids = new Set(obj.edges.map((e) => e.id));
  for (const p of NEW_PROPS) {
    const src = `val-${p.id}`, dst = `valin-${p.id}`;
    if (obj.edges.some((e) => e.sourceHandle === src && e.targetHandle === dst)) continue;
    let id = `e-${p.id}`; while (ids.has(id)) id += "x";
    ids.add(id);
    obj.edges.push({ id, source: props.id, target: math.id, sourceHandle: src, targetHandle: dst });
  }
  return { changed: true };
}

if (process.argv[1]?.endsWith("upgrade-rects.mjs")) {
  fs.mkdirSync("upgraded", { recursive: true });
  for (const base of ["door", "window"]) {
    const j = JSON.parse(fs.readFileSync(`objsrc/${base}.json`, "utf8"));
    const r = upgradeRects(j);
    if (r.changed) { fs.writeFileSync(`upgraded/${base}.json`, JSON.stringify(j, null, 1)); console.log(`${base}: upgraded`); }
    else console.log(`${base}: ${r.why}`);
  }
}
