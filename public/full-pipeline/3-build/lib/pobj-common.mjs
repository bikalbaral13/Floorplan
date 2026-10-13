// Vendored copy of the app repo's tools/tmp-pobj/common.mjs so this pipeline runs standalone.
/** Shared building blocks for the Architectural parametric objects (six-node spine, see bike.json). */

/** Host frame: turns `P` (node / segment / space outline) into an (u,v) frame + bounding box.
 *  Publishes _ux/_uy/_vx/_vy (world axes), _hcu/_hcv (host centre), _hostL/_hostW. */
export const FRAME = `# Host frame — node, segment or space
_e1 = hcat(1, 0)
_np = rows(P)
_isSeg = _np == 2
_isSpace = _np > 2
_edges = _isSpace ? (shift(P, -1) - P) : _e1
_edgeLen = len(_edges)
_longest = max(_edgeLen)
_spaceDir = _isSpace ? row(compress(_edges, eq(_edgeLen, _longest)), 0) : _e1
_segDir = _isSeg ? (row(P, 1) - row(P, 0)) : _e1
_dir = _isSpace ? _spaceDir : (_isSeg ? _segDir : _e1)
_dirLen = len(_dir)
_axisB = _dirLen > 0 ? normalize(_dir) : _e1
_rot = rotation * PI / 180
_crot = cos(_rot)
_srot = sin(_rot)
_bx = sub(_axisB, 0, 0, 1, 1)
_by = sub(_axisB, 0, 1, 1, 1)
_axisU = hcat(_bx * _crot - _by * _srot, _bx * _srot + _by * _crot)
_axisV = (flipSide > 0 ? -1 : 1) * perp(_axisU)
_ux = sub(_axisU, 0, 0, 1, 1)
_uy = sub(_axisU, 0, 1, 1, 1)
_vx = sub(_axisV, 0, 0, 1, 1)
_vy = sub(_axisV, 0, 1, 1, 1)
_Qu = col(P, 0) * _ux + col(P, 1) * _uy
_Qv = col(P, 0) * _vx + col(P, 1) * _vy
_hu0 = _np > 0 ? min(_Qu) : 0
_hu1 = _np > 0 ? max(_Qu) : 0
_hv0 = _np > 0 ? min(_Qv) : 0
_hv1 = _np > 0 ? max(_Qv) : 0
_hcu = (_hu0 + _hu1) / 2
_hcv = (_hv0 + _hv1) / 2
_hostL = _hu1 - _hu0
_hostW = _hv1 - _hv0`;

/** Uniform fit to the host's long axis. Needs `_natL` (natural length) defined above. Publishes `scale`/`_s`. */
export const FIT = `# Fit to host — one uniform scale, Max never enlarges
_availL = max(0, _hostL - 2 * margin)
_notOff = fitMode != 'Off'
_exact = fitMode == 'Exact'
_sRaw = _natL > 0 ? _availL / _natL : 1
_sFit = (_notOff && _availL > 0) ? (_exact ? _sRaw : min(1, _sRaw)) : 1
scale = max(0.15, min(5, _sFit))
_s = scale`;

/** Anchor placement. Needs `_bodyL` / `_bodyW` (scaled footprint). Publishes _cu/_cv. */
export const ANCHOR = `# Anchor — place the footprint by any of the nine box points
_anchorL = anchorDir == 'Top-Left' || anchorDir == 'Left-Center' || anchorDir == 'Bottom-Left'
_anchorR = anchorDir == 'Top-Right' || anchorDir == 'Right-Center' || anchorDir == 'Bottom-Right'
_anchorT = anchorDir == 'Top-Left' || anchorDir == 'Top-Center' || anchorDir == 'Top-Right'
_anchorB = anchorDir == 'Bottom-Left' || anchorDir == 'Bottom-Center' || anchorDir == 'Bottom-Right'
_ax = _anchorR - _anchorL
_ay = _anchorB - _anchorT
_hau = _hcu + _ax * max(0, _hostL / 2 - margin)
_hav = _hcv + _ay * max(0, _hostW / 2 - margin)
_cu = _hau - _ax * _bodyL / 2
_cv = _hav - _ay * _bodyW / 2`;

/** Quad-prism kernel: `Q` (n x 11 = u1,v1,u2,v2,u3,v3,u4,v4,z0,z1,group) -> local face list `_FL`
 *  (u,v,z,face,group) and local plan `_PL` (u,v,ring,group). Any convex-or-not quad works, so a
 *  rotated fan blade and a tapered arm take the same path as an axis-aligned carcass panel. */
export const KERNEL = `# Quad prism — every part is a quad swept from z0 to z1 (6 faces)
_nq = rows(Q)
_r4 = ones(4,1)
_a1 = col(Q,0)
_b1 = col(Q,1)
_a2 = col(Q,2)
_b2 = col(Q,3)
_a3 = col(Q,4)
_b3 = col(Q,5)
_a4 = col(Q,6)
_b4 = col(Q,7)
_qz0 = col(Q,8)
_qz1 = col(Q,9)
_gq = kron(col(Q,10), _r4)
_fq = kron(arange(_nq), _r4) * 6
_q0 = hcat(reshape(hcat(_a1,_b1,_qz0,_a2,_b2,_qz0,_a3,_b3,_qz0,_a4,_b4,_qz0), 4*_nq, 3), _fq + 0, _gq)
_q1 = hcat(reshape(hcat(_a1,_b1,_qz1,_a2,_b2,_qz1,_a3,_b3,_qz1,_a4,_b4,_qz1), 4*_nq, 3), _fq + 1, _gq)
_q2 = hcat(reshape(hcat(_a1,_b1,_qz0,_a2,_b2,_qz0,_a2,_b2,_qz1,_a1,_b1,_qz1), 4*_nq, 3), _fq + 2, _gq)
_q3 = hcat(reshape(hcat(_a2,_b2,_qz0,_a3,_b3,_qz0,_a3,_b3,_qz1,_a2,_b2,_qz1), 4*_nq, 3), _fq + 3, _gq)
_q4 = hcat(reshape(hcat(_a3,_b3,_qz0,_a4,_b4,_qz0,_a4,_b4,_qz1,_a3,_b3,_qz1), 4*_nq, 3), _fq + 4, _gq)
_q5 = hcat(reshape(hcat(_a4,_b4,_qz0,_a1,_b1,_qz0,_a1,_b1,_qz1,_a4,_b4,_qz1), 4*_nq, 3), _fq + 5, _gq)
_FL = vcat(_q0,_q1,_q2,_q3,_q4,_q5)
_PL = hcat(reshape(hcat(_a1,_b1,_a2,_b2,_a3,_b3,_a4,_b4), 4*_nq, 2), kron(arange(_nq), _r4), _gq)`;

/** Local (u,v) -> world (x,y). Publishes `_W` (x,y,z,face,group) and `_WP` (x,y,ring,group). */
export const MAPW = `# Local (u,v,z) -> world, once, for every part at the same time
_U = _cu + col(_FL,0)
_V = _cv + col(_FL,1)
_W = hcat(_U * _ux + _V * _vx, _U * _uy + _V * _vy, col(_FL,2), col(_FL,3), col(_FL,4))
_nw = rows(_W)
_PU = _cu + col(_PL,0)
_PV = _cv + col(_PL,1)
_WP = hcat(_PU * _ux + _PV * _vx, _PU * _uy + _PV * _vy, col(_PL,2), col(_PL,3))
_nwp = rows(_WP)`;

/** One 3D polyhedron output for group `g`. */
export const solid = (name, g) => `${name} = sub(compress(_W, eq(col(_W,4), ${g})), 0, 0, _nw, 4)`;
/** One 2D grouped-outline output for group `g`. */
export const plan = (name, g) => `${name} = sub(compress(_WP, eq(col(_WP,3), ${g})), 0, 0, _nwp, 3)`;

/** Map a local tube/ring table `T` ([u1,v1,z1,u2,v2,z2,...extra]) to world, keeping `extra` columns. */
export const tubes = (name, src, extra = 1) => {
  const cols = ["_t1u * _ux + _t1v * _vx", "_t1u * _uy + _t1v * _vy", `col(${src},2)`,
                "_t2u * _ux + _t2v * _vx", "_t2u * _uy + _t2v * _vy", `col(${src},5)`];
  for (let i = 0; i < extra; i++) cols.push(`col(${src},${6 + i})`);
  return `_t1u = _cu + col(${src},0)
_t1v = _cv + col(${src},1)
_t2u = _cu + col(${src},3)
_t2v = _cv + col(${src},4)
${name} = hcat(${cols.join(", ")})`;
};

/** An axis-aligned box row for the Q table (11 columns). */
export const box = (u0, v0, u1, v1, z0, z1, g) =>
  `hcat(${u0}, ${v0}, ${u1}, ${v0}, ${u1}, ${v1}, ${u0}, ${v1}, ${z0}, ${z1}, ${g})`;

/** Props every object shares — host geometry in, then placement. */
export const hostProp = {
  id: "P", name: "Host — node / segment / space [[x, y], …]", type: "text",
  value: "[[0, 0]]", options: [],
};
export const placementProps = [
  { id: "rotation", name: "Rotation (deg)", type: "range", value: 0, min: 0, max: 360, step: 1, options: [] },
  { id: "anchorDir", name: "Anchor Direction", type: "select", value: "Center",
    options: ["Top-Left", "Top-Center", "Top-Right", "Left-Center", "Center", "Right-Center", "Bottom-Left", "Bottom-Center", "Bottom-Right"] },
  { id: "fitMode", name: "Fit to host", type: "select", value: "Off", options: ["Off", "Max", "Exact"] },
  { id: "margin", name: "Margin from host", type: "range", value: 0, min: 0, max: 1, step: 0.01, options: [] },
  { id: "flipSide", name: "Flip side", type: "checkbox", value: false, options: [] },
];

const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const sel = (id, name, value, options) => ({ id, name, type: "select", value, options });
const chk = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
export { rng, sel, chk };

/** Assemble the six-node flow file. */
export function buildFlow(spec) {
  const props = [hostProp, ...spec.props, ...placementProps];
  const wired = props.map((p) => p.id);
  const edges = [
    { id: "e_geo_props", source: "geo", target: "props", sourceHandle: "val-points", targetHandle: "valin-P" },
    ...wired.map((k) => ({ id: `e_props_math_${k}`, source: "props", target: "math", sourceHandle: `val-${k}`, targetHandle: `valin-${k}` })),
  ];
  const slots = [];
  spec.outputs.forEach((o, i) => {
    const id = `s${i + 1}`;
    slots.push({ id, label: o.label });
    edges.push({ id: `e_math_out_${id}`, source: "math", target: "out", sourceHandle: `val-${o.from}`, targetHandle: `valin-${id}` });
    o.slot = id;
  });
  const slotOf = (name) => spec.outputs.find((o) => o.from === name)?.slot;
  for (const p of spec.prims2d) edges.push({ id: `e_out_r2d_${p.id}`, source: "out", target: "r2d", sourceHandle: `val-${slotOf(p.from)}`, targetHandle: `valin-${p.id}` });
  for (const p of spec.prims3d) edges.push({ id: `e_out_r3d_${p.id}`, source: "out", target: "r3d", sourceHandle: `val-${slotOf(p.from)}`, targetHandle: `valin-${p.id}` });

  const strip = (rows) => rows.map(({ from, ...r }) => r);
  return {
    version: 1,
    id: spec.id,
    title: spec.title,
    category: spec.category ?? "Furniture",
    object: { hostKind: "node", name: spec.name, units: "m", icon: { paths: spec.icon } },
    description: spec.description,
    nodes: [
      { id: "geo", position: { x: -960, y: 60 }, data: { tool: "source", params: { grabFromSelection: true, id: "", nodeLabel: "Geometry" } } },
      { id: "props", position: { x: -640, y: 60 }, data: { tool: "input-props", params: { props } } },
      { id: "math", position: { x: -180, y: 40 }, data: { tool: "expr", params: { name: `${spec.name} maths`, expr: spec.expr } } },
      { id: "out", position: { x: 240, y: 60 }, data: { tool: "output", params: { slots } } },
      { id: "r2d", position: { x: 620, y: -80 }, data: { tool: "render-2d", params: { prims: strip(spec.prims2d) } } },
      { id: "r3d", position: { x: 900, y: -80 }, data: { tool: "render-3d", params: { prims: strip(spec.prims3d) } } },
    ],
    edges,
  };
}
