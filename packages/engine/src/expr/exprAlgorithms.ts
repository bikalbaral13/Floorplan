/** Named algorithms (`Algorithms.Inset`, `Algorithms.Voronoi`, …).
 *
 *  Each one's `body` is A PROGRAM IN THIS LANGUAGE, run through `runExprBody` like any other — not a
 *  native builtin. That is deliberate and load-bearing: what a node displays is exactly what
 *  executes, so an algorithm can be read, copied into a formula box and modified. Keep it that way
 *  when adding entries here.
 */

/* RECONSTRUCTED 2026-08-10. The original file was lost; this was rebuilt from an esbuild bundle
 * dated 2026-08-03 that a tooling run had left behind. The DATA and LOGIC are byte-faithful to that
 * bundle. What the bundler stripped — type annotations and the original prose comments — has been
 * written back by hand from how the consumers use these exports, so the types are inferred rather
 * than original. Any edit made to this file between 2026-08-03 and 2026-08-10 is NOT here.
 */

import type { ExprFnParam } from "./exprCatalog.js";

/** One named algorithm: its documentation plus the language body that implements it. */
export interface ExprAlgorithm {
  qualified: string;
  params: ExprFnParam[];
  /** Name of the value the body assigns as the result. */
  returns: string;
  summary: string;
  /** Where the algorithm was ported from, when it came from a Library tool. */
  source?: string;
  example?: string;
  /** The program text, evaluated by `runExprBody`. */
  body: string;
}

export const EXPR_ALGORITHMS: ExprAlgorithm[] = [
  {
    qualified: "Algorithms.Inset",
    params: [
      { name: "P", about: "Outline as an N×2 point matrix" },
      { name: "inset", about: "Offset in metres — positive inward, negative outward" }
    ],
    returns: "Q",
    summary: "Offset a closed outline by a constant distance, mitring every corner.",
    source: "Library/Tools/New Tools/inset_with_math.json",
    example: "Q = Algorithms.Inset(P, 0.3)",
    // The MITER-VECTOR offset. Each edge has an inward normal; a vertex moves along the sum of the two
    // normals meeting there, scaled by 1/(1 + n·n') so the offset distance stays exact however sharp the
    // corner is. Loop-free: `shift` supplies the neighbour list, so this is the whole algorithm.
    body: [
      "E = shift(P, -1) - P",
      "n = perp(normalize(E))",
      "np = shift(n, 1)",
      "M = (n + np) / (1 + dot(n, np))",
      "Q = P + inset * M"
    ].join("\n")
  },
  {
    qualified: "Algorithms.ConvexHull",
    params: [
      { name: "P", about: "Point cloud as an N×2 matrix" },
      { name: "tol", about: "Angular tolerance in DEGREES — how flat a turn may be and still be dropped" }
    ],
    returns: "Q",
    summary: "Smallest convex outline containing every point, wound counter-clockwise.",
    source: "Library/Tools/New Tools/convex_hull_with_math.json",
    example: "H = Algorithms.ConvexHull(P, 0.5)",
    // Loop-free: every point is kept or dropped by ONE test — sort the directions to all other points and
    // ask whether the widest angular gap exceeds a half-turn. A point with such a gap has all the others to
    // one side of it, which is exactly the definition of a hull vertex.
    body: [
      "X = col(P,0)",
      "Y = col(P,1)",
      "DX = X - T(X)",
      "DY = Y - T(Y)",
      "Dg = le(DX^2 + DY^2, 1e-9)",
      "A = atan2(DY, DX)",
      "Am = A - 100 * Dg",
      "mx = max(Am, 'rows')",
      "A2 = where(Dg, mx, Am)",
      "S = sort(A2, 'rows')",
      "G = shift(S, -1, 'cols') - S",
      "Gw = G + 2 * PI * lt(G, 0)",
      "keep = gt(max(Gw, 'rows'), PI + tol * PI / 180)",
      "H = compress(P, keep)",
      "c = mean(H, 'cols')",
      "R = sortby(H, angle(H - c))",
      "D = R - shift(R, 1)",
      "U = gt(sum(D^2, 'rows'), 1e-12)",
      "Q = compress(R, U)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Voronoi",
    params: [
      { name: "P", about: "Boundary outline as an N×2 point matrix — cells are clipped to it" },
      { name: "seeds", about: "How many cells (default 4) — OR an N×2 matrix of seed points to use instead", optional: true },
      { name: "jitter", about: "0…0.5, how far each seed is pushed off its lattice cell. 0 (the default) is a regular lattice", optional: true },
      { name: "gx", about: "Seeds per row. 0 (the default) picks the grid from the outline's aspect ratio", optional: true }
    ],
    returns: "E",
    summary: "Voronoi cells clipped to a boundary, returned as edge segments [x1, y1, x2, y2]. Seeds itself.",
    source: "Library/Tools/New Tools/voronoi_with_math.json",
    example: "E = Algorithms.Voronoi(P, 6)",
    // SEEDS ITSELF, so a call needs nothing but the outline. `seeds` is polymorphic on WIDTH — a 1-column
    // value is a COUNT and the lattice below is built; anything 2 columns wide is a seed-point matrix and is
    // used as-is, which is what keeps the older `Voronoi(P, S)` call working unchanged. A missing argument
    // arrives as 0, so each default is expressed as a guard rather than needing engine support: 0 seeds → 4,
    // and jitter / gx default to 0, whose meaning (regular lattice, automatic grid) is deliberately the same
    // as "not supplied" — a value that means something ELSE at 0 could not have a non-zero default at all.
    //
    // Then each cell is the boundary clipped by one half-plane per OTHER seed (the perpendicular bisector),
    // via the Sutherland–Hodgman interleave: keep-flags and crossing points woven together, then compressed.
    // The final line composes the two accumulators into one segment list, since a call returns one value.
    body: [
      "# Seeds",
      "_isM = cols(seeds) > 1",
      "_n = _isM ? rows(seeds) : (seeds > 0 ? seeds : 4)",
      "_x0 = min(col(P,0))",
      "_x1 = max(col(P,0))",
      "_y0 = min(col(P,1))",
      "_y1 = max(col(P,1))",
      "_w = max(_x1 - _x0, 1e-9)",
      "_h = max(_y1 - _y0, 1e-9)",
      "_gx = gx > 0 ? gx : max(1, min(_n, round(sqrt(_n * _w / _h))))",
      "_gy = ceil(_n / _gx)",
      "_k = arange(_n)",
      "_u = ((_k % _gx) + 0.5) / _gx",
      "_v = (floor(_k / _gx) + 0.5) / _gy",
      "_jx = jitter * sin(_k * 12.9898 + 1.3) / _gx",
      "_jy = jitter * sin(_k * 78.233 + 4.7) / _gy",
      "S = _isM ? seeds : hcat(_x0 + (_u + _jx) * _w, _y0 + (_v + _jy) * _h)",
      "# Cells",
      "n = rows(S)",
      "A = zeros(0,2)",
      "B = zeros(0,2)",
      "loop i in n:",
      "  si = row(S,i)",
      "  C = P",
      "  loop j in n:",
      "    sj = row(S,j)",
      "    m = (si + sj) / 2",
      "    nv = si - sj",
      "    d = dot(C - m, nv)",
      "    dn = shift(d, -1)",
      "    Cn = shift(C, -1)",
      "    t = d / (d - dn)",
      "    X = C + t * (Cn - C)",
      "    kv = ge(d, 0)",
      "    kx = abs(ge(d,0) - ge(dn,0))",
      "    C = compress(reshape(hcat(C, X), 2*rows(C), 2), reshape(hcat(kv, kx), 2*rows(C), 1))",
      "  end",
      "  A = vcat(A, C)",
      "  B = vcat(B, shift(C,-1))",
      "end",
      "E = hcat(A, B)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.MiteredJoin",
    params: [
      { name: "Ga", about: "Edge start points, N×2 — Points to Graph in Pairs mode gives these" },
      { name: "Gb", about: "Edge end points, N×2" },
      { name: "Gt", about: "Per-edge thickness, N×1 — 0 falls back to the width argument" },
      { name: "width", about: "Default band width in metres" },
      { name: "capEnds", about: "1 extends a free end by half its width, 0 leaves it flush" },
      { name: "merge", about: "Distance below which two endpoints count as the same junction" }
    ],
    returns: "Q",
    summary: "Thicken a graph into seamless mitred bands — one grouped ring per edge, joints solved at each junction.",
    source: "Library/Tools/New Tools/mitered_join_with_math.json",
    example: "Q = Algorithms.MiteredJoin(Ga, Gb, Gt, 0.15, 1, 0.01)",
    // Every endpoint is assigned a canonical junction id from the pairwise distance table, spokes are put in
    // angular order round each junction, and each band edge is mitred against its neighbour's opposite edge.
    // Output is the grouped [x, y, ring] list a Polygon row reads, so the bands arrive as separate outlines.
    body: [
      "_BIG = 1e18",
      "_TOL = merge",
      "_MAXM = 20",
      "_HWMIN = 0.0025",
      "_live = gt(len(Gb - Ga), 1e-9)",
      "_A0 = compress(Ga, _live)",
      "_B0 = compress(Gb, _live)",
      "_n = rows(_A0)",
      "_tk = compress(Gt, _live)",
      "_hw = max(where(gt(_tk, 0), _tk, width), 0.02) / 2",
      "_U = normalize(_B0 - _A0)",
      "_EX = vcat(col(_A0,0), col(_B0,0))",
      "_EY = vcat(col(_A0,1), col(_B0,1))",
      "_DEG = sum(le((_EX - T(_EX)) * (_EX - T(_EX)) + (_EY - T(_EY)) * (_EY - T(_EY)), _TOL * _TOL), 'rows')",
      "_free = capEnds > 0 ? eq(_DEG, 1) : zeros(2*_n,1)",
      "A = _A0 - sub(_free,0,0,_n,1) * _hw * _U",
      "B = _B0 + sub(_free,_n,0,_n,1) * _hw * _U",
      "_NP = vcat(A, B)",
      "_DIR = vcat(_U, 0 - _U)",
      "_HW = vcat(_hw, _hw)",
      "_k2 = arange(2 * _n)",
      "_R2 = T(_k2)",
      "_QX = col(_NP,0)",
      "_QY = col(_NP,1)",
      "_D2 = (_QX - T(_QX)) * (_QX - T(_QX)) + (_QY - T(_QY)) * (_QY - T(_QY))",
      "_NID = min(where(le(_D2, _TOL * _TOL), _R2, _BIG), 'rows')",
      "_ANG = angle(_DIR)",
      "_KEY = _NID * 1000 + _ANG + 180",
      "S = sortby(hcat(hcat(hcat(hcat(_NP, _DIR), _HW), _NID), _k2), _KEY)",
      "_sn = col(S,5)",
      "_EQ = eq(_sn, T(_sn))",
      "_FIRST = min(where(_EQ, _R2, _BIG), 'rows')",
      "_LAST = max(where(_EQ, _R2, 0 - _BIG), 'rows')",
      "_NEXTI = where(le(_k2 + 1, _LAST), _k2 + 1, _FIRST)",
      "_PREVI = where(ge(_k2 - 1, _FIRST), _k2 - 1, _LAST)",
      "_SN = eq(_NEXTI, _R2) @ S",
      "_SP = eq(_PREVI, _R2) @ S",
      "Pos = sub(S,0,0,2*_n,2)",
      "Dir = sub(S,0,2,2*_n,2)",
      "Hw = col(S,4)",
      "LA = Pos + Hw * perp(Dir)",
      "RA = Pos + Hw * perpcw(Dir)",
      "_PosN = sub(_SN,0,0,2*_n,2)",
      "_DirN = sub(_SN,0,2,2*_n,2)",
      "_HwN = col(_SN,4)",
      "_RAN = _PosN + _HwN * perpcw(_DirN)",
      "_PosP = sub(_SP,0,0,2*_n,2)",
      "_DirP = sub(_SP,0,2,2*_n,2)",
      "_HwP = col(_SP,4)",
      "_LAP = _PosP + _HwP * perp(_DirP)",
      "_dn1 = cross(Dir, _DirN)",
      "_ok1 = gt(abs(_dn1), 1e-10)",
      "_t1 = cross(_RAN - LA, _DirN) / _dn1",
      "LC = where(_ok1, LA + _t1 * Dir, (LA + _RAN) / 2)",
      "_dn2 = cross(_DirP, Dir)",
      "_ok2 = gt(abs(_dn2), 1e-10)",
      "_t2 = cross(RA - _LAP, Dir) / _dn2",
      "RC = where(_ok2, _LAP + _t2 * _DirP, (_LAP + RA) / 2)",
      "_hwLA = max((Hw + _HwN) / 2, _HWMIN)",
      "_hwRA = max((_HwP + Hw) / 2, _HWMIN)",
      "_fL = min(1, _MAXM * _hwLA / max(len(LC - Pos), 1e-12))",
      "_fR = min(1, _MAXM * _hwRA / max(len(RC - Pos), 1e-12))",
      "LC = Pos + (LC - Pos) * _fL",
      "RC = Pos + (RC - Pos) * _fR",
      "_one = eq(_FIRST, _LAST)",
      "LC = where(_one, LA, LC)",
      "RC = where(_one, RA, RC)",
      "_BACK = eq(_k2, T(col(S,6)))",
      "_LCo = _BACK @ LC",
      "_RCo = _BACK @ RC",
      "LF = sub(_LCo,0,0,_n,2)",
      "RF = sub(_RCo,0,0,_n,2)",
      "LT = sub(_LCo,_n,0,_n,2)",
      "RT = sub(_RCo,_n,0,_n,2)",
      "Q = zeros(0,3)",
      "loop i in _n:",
      "  _a = row(A,i)",
      "  _b = row(B,i)",
      "  _u = row(_U,i)",
      "  _P4 = vcat(vcat(vcat(row(LF,i), row(LT,i)), row(RF,i)), row(RT,i))",
      "  _dd = _P4 - _a",
      "  _sd = cross(_u, _dd)",
      "  _al = dot(_dd, _u)",
      "  _mL = gt(_sd, 1e-9)",
      "  _mR = lt(_sd, 0 - 1e-9)",
      "  _L = sortby(compress(_P4, _mL), compress(_al, _mL))",
      "  _R = sortby(compress(_P4, _mR), 0 - compress(_al, _mR))",
      "  _ring = vcat(vcat(vcat(_a, _L), _b), _R)",
      "  Q = vcat(Q, hcat(_ring, fill(rows(_ring),1,i)))",
      "end"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Straight_skeleton",
    params: [
      { name: "P", about: "Outline as an N×2 point matrix — either winding" },
      { name: "merge", about: "Merge tolerance in metres — two wavefront vertices this close count as one (0.002 is the source flow's default)" }
    ],
    returns: "E",
    summary: "Full event-driven straight skeleton of an outline, returned as arc segments [x1, y1, x2, y2].",
    source: "Library/Tools/New Tools/straight_skeleton_with_math.json",
    example: "E = Algorithms.Straight_skeleton(P, 0.002)",
    // The wavefront as a WORK LIST — one flat matrix W of [x, y, componentId] rows — advanced one EVENT per
    // loop pass: an edge COLLAPSE at t = −|E| / ((v' − v)·Ê), or a reflex vertex SPLIT at t = −d₀ / (v·n̂ − 1)
    // found by an argmin over the whole i×j vertex/edge table read as a linear index. Vertices travel along
    // the miter vector (Np + Nm) / (1 + Np·Nm) — the SAME formula as Algorithms.Inset, which is why offsetting
    // and skeletonisation are one piece of mathematics seen from two ends. Three sanitisers run first
    // (coincident merge, fold-back spike, pinch), because rectilinear plans collapse with exactly simultaneous
    // events; every emitted arc is then sampled at its quarter, half and three-quarter points and kept only if
    // all three lie inside the outline. The final line composes the two guarded endpoint lists into one
    // segment list, since a call returns one value.
    body: [
      "n0 = rows(P)",
      "_sa = sum(col(P,0) * col(shift(P,-1),1) - col(shift(P,-1),0) * col(P,1))",
      "s0 = _sa > 0 ? 1 : -1",
      "_BIG = 1e18",
      "_EPS = merge",
      "_EPT = 1e-9",
      "_VCAP = 50",
      "LIM = 6 * n0 + 8",
      "W = hcat(P, zeros(n0,1))",
      "EA = zeros(0,2)",
      "EB = zeros(0,2)",
      "_nid = 1",
      "loop it in LIM:",
      "  _p = min(col(W,2))",
      "  _sel = eq(col(W,2), _p)",
      "  _V0 = compress(sub(W,0,0,rows(W),2), _sel)",
      "  _REST = compress(W, 1 - _sel)",
      "  V = compress(_V0, ge(len(shift(_V0,-1) - _V0), _EPS))",
      "  m = rows(V)",
      "  _mm = max(m, 1)",
      "  _k = arange(m)",
      "  _Kr = T(_k)",
      "  _IDX = _k * m + _Kr",
      "  _VX = col(V,0)",
      "  _VY = col(V,1)",
      "  _Vn = shift(V,-1)",
      "  _Vp = shift(V,1)",
      "  Ed = _Vn - V",
      "  Le = len(Ed)",
      "  U = normalize(Ed)",
      "  Nm = perp(U) * s0",
      "  Np = shift(Nm,1)",
      "  vel = (Np + Nm) / (1 + dot(Np, Nm))",
      "  vel = vel * min(1, _VCAP / max(len(vel), 1e-12))",
      "  _velN = shift(vel,-1)",
      "  rate = dot(_velN - vel, U)",
      "  _tev = where(lt(rate, -1e-9), 0 - Le / rate, _BIG)",
      "  tE = min(_tev)",
      "  _ie = min(where(le(_tev, tE), _k, _BIG))",
      "  _d1 = V - _Vp",
      "  _d2 = _Vn - V",
      "  _crs = cross(_d1, _d2)",
      "  rfx = lt(_crs * s0, 0)",
      "  _cs = dot(normalize(_d1), normalize(_d2))",
      "  _spk = lt(_cs, -0.999)",
      "  _nsp = sum(_spk)",
      "  _is = min(where(_spk, _k, _BIG))",
      "  _vis = row(V, _is)",
      "  _qp = row(V, (_is - 1 + m) % _mm)",
      "  _qn = row(V, (_is + 1) % _mm)",
      "  _qq = len(_vis - _qp) <= len(_vis - _qn) ? _qp : _qn",
      "  _Vk = compress(V, 1 - eq(_k, _is))",
      "  _AX = T(_VX)",
      "  _AY = T(_VY)",
      "  _BX = T(col(_Vn,0))",
      "  _BY = T(col(_Vn,1))",
      "  _NX = T(col(Nm,0))",
      "  _NY = T(col(Nm,1))",
      "  _WX = col(vel,0)",
      "  _WY = col(vel,1)",
      "  _UX = T(_WX)",
      "  _UY = T(_WY)",
      "  _ZX = T(col(_velN,0))",
      "  _ZY = T(col(_velN,1))",
      "  _d0 = (_VX - _AX) * _NX + (_VY - _AY) * _NY",
      "  _rt = _WX * _NX + _WY * _NY - 1",
      "  _tsp = 0 - _d0 / _rt",
      "  _hx = _VX + _WX * _tsp",
      "  _hy = _VY + _WY * _tsp",
      "  _ax = _AX + _UX * _tsp",
      "  _ay = _AY + _UY * _tsp",
      "  _bx = _BX + _ZX * _tsp",
      "  _by = _BY + _ZY * _tsp",
      "  _ex = _bx - _ax",
      "  _ey = _by - _ay",
      "  _el2 = _ex * _ex + _ey * _ey",
      "  _sq = ((_hx - _ax) * _ex + (_hy - _ay) * _ey) / _el2",
      "  _exc = min(eq(_Kr, _k) + eq(_Kr, (_k - 1 + m) % _mm), 1)",
      "  _okS = rfx * ge(_tsp, 0) * gt(abs(_rt), 1e-6) * gt(_el2, 1e-12) * ge(_sq, -0.02) * le(_sq, 1.02) * (1 - _exc)",
      "  _tsv = where(_okS, _tsp, _BIG)",
      "  tS = min(_tsv)",
      "  _lin = min(where(le(_tsv, tS), _IDX, _BIG))",
      "  _ri = floor(_lin / _mm)",
      "  _ji = _lin - _ri * _mm",
      "  _DX = _VX - _AX",
      "  _DY = _VY - _AY",
      "  _D2 = _DX * _DX + _DY * _DY",
      "  _adj = min(eq(_Kr, _k) + eq(_Kr, (_k + 1) % _mm) + eq(_Kr, (_k - 1 + m) % _mm), 1)",
      "  _pk = le(_D2, _EPS * _EPS) * (1 - _adj) * lt(_k, _Kr)",
      "  _npn = sum(_pk)",
      "  _lp = min(where(_pk, _IDX, _BIG))",
      "  _pi = floor(_lp / _mm)",
      "  _pj = _lp - _pi * _mm",
      "  dead = m < 3 ? 1 : 0",
      "  spi = (1 - dead) * (_nsp > 0 ? 1 : 0)",
      "  pin = (1 - dead) * (1 - spi) * (_npn > 0 ? 1 : 0)",
      "  tEv = min(tE, tS)",
      "  _hasE = tEv < 1e17 ? 1 : 0",
      "  _doE = (1 - dead) * (1 - spi) * (1 - pin) * _hasE",
      "  spl = _doE * (tS < tE ? 1 : 0)",
      "  cls = dead + (1 - dead) * (1 - spi) * (1 - pin) * (1 - _hasE)",
      "  V2 = V + vel * tEv",
      "  _i2 = (_ie + 1) % _mm",
      "  _mid = (row(V2, _ie) + row(V2, _i2)) / 2",
      "  _Vm = where(eq(_k, _ie), _mid, V2)",
      "  _Ve = compress(_Vm, 1 - eq(_k, _i2))",
      "  _hit = row(V2, _ri)",
      "  _jj = (_ji - _ri + m) % _mm",
      "  _Vr = shift(V2, 0 - _ri)",
      "  _CA = vcat(sub(_Vr, 1, 0, _jj, 2), _hit)",
      "  _CB = vcat(sub(_Vr, _jj + 1, 0, m - 1 - _jj, 2), _hit)",
      "  _pmid = (row(V, _pi) + row(V, _pj)) / 2",
      "  _j2 = (_pj - _pi + m) % _mm",
      "  _Vq = shift(V, 0 - _pi)",
      "  _PA = vcat(sub(_Vq, 1, 0, _j2 - 1, 2), _pmid)",
      "  _PB = vcat(sub(_Vq, _j2 + 1, 0, m - 1 - _j2, 2), _pmid)",
      "  _cen = mean(V, 'cols')",
      "  _SA = _doE + cls > 0 ? V : (spi > 0 ? _vis : zeros(0,2))",
      "  _SB = _doE > 0 ? V2 : (cls > 0 ? V * 0 + _cen : (spi > 0 ? _qq : zeros(0,2)))",
      "  _kpE = gt(len(_SB - _SA), _EPT)",
      "  EA = vcat(EA, compress(_SA, _kpE))",
      "  EB = vcat(EB, compress(_SB, _kpE))",
      "  _Wk = vcat(_REST, hcat(_Vk, fill(rows(_Vk),1,_p)))",
      "  _Wp = vcat(vcat(_REST, hcat(_PA, fill(rows(_PA),1,_p))), hcat(_PB, fill(rows(_PB),1,_nid)))",
      "  _Ws = vcat(vcat(_REST, hcat(_CA, fill(rows(_CA),1,_p))), hcat(_CB, fill(rows(_CB),1,_nid)))",
      "  _Wg = vcat(_REST, hcat(_Ve, fill(rows(_Ve),1,_p)))",
      "  W = cls > 0 ? _REST : (spi > 0 ? _Wk : (pin > 0 ? _Wp : (spl > 0 ? _Ws : _Wg)))",
      "  _nid = pin + spl > 0 ? _nid + 1 : _nid",
      "end",
      "_ns = rows(EA)",
      "_SM = vcat(vcat(EA + (EB - EA) * 0.25, (EA + EB) / 2), EA + (EB - EA) * 0.75)",
      "_MX = col(_SM,0)",
      "_MY = col(_SM,1)",
      "_GX = T(col(P,0))",
      "_GY = T(col(P,1))",
      "_HX = T(col(shift(P,-1),0))",
      "_HY = T(col(shift(P,-1),1))",
      "_cr1 = ne(gt(_GY, _MY), gt(_HY, _MY))",
      "_xin = _GX + (_HX - _GX) * (_MY - _GY) / (_HY - _GY)",
      "_ins = sum(_cr1 * lt(_MX, _xin), 'rows') % 2",
      "_bex = _HX - _GX",
      "_bey = _HY - _GY",
      "_bt = min(1, max((_MX - _GX) * _bex + (_MY - _GY) * _bey, 0) / (_bex * _bex + _bey * _bey))",
      "_bdx = _MX - _GX - _bt * _bex",
      "_bdy = _MY - _GY - _bt * _bey",
      "_bd = min(_bdx * _bdx + _bdy * _bdy, 'rows')",
      "_ok = min(_ins + le(_bd, _EPS * _EPS), 1)",
      "keep = sub(_ok,0,0,_ns,1) * sub(_ok,_ns,0,_ns,1) * sub(_ok,2*_ns,0,_ns,1)",
      "QA = compress(EA, keep)",
      "QB = compress(EB, keep)",
      "E = hcat(QA, QB)"
    ].join("\n")
  },
  {
    qualified: "Algorithms.Optimise_rectangle",
    params: [
      { name: "P", about: "Outline as an N×2 point matrix" },
      { name: "lock", about: "Lock the rectangle's axis to this angle in DEGREES. 0 (the default) sweeps every angle; use 180 for axis-aligned, which is ~6× faster", optional: true },
      { name: "step", about: "Sweep step in degrees, default 30. Halve it for a better angle, at double the cost", optional: true },
      { name: "res", about: "Grid cells across the longer axis, default 32. Cost grows as res³", optional: true }
    ],
    returns: "R",
    summary: "Largest rectangle that fits inside an outline, at the best angle. Returns its 4 corners.",
    source: "src/floorplan/algorithms/layout/optimiseRect.ts (largestInscribedRectangle)",
    example: "R = Algorithms.Optimise_rectangle(P, 180)",
    // The TS construction, re-expressed: rotate the outline into each candidate axis, rasterise it, and take
    // the largest all-ones block. Two things make it affordable here, where a per-cell loop would not be.
    //
    // THE INSIDE TEST IS TWO PIP PASSES, NOT FIVE. The TS tests each cell's centre AND its four inset
    // corners — five point-in-polygon tests per cell. But adjacent cells SHARE corners, so one pass over the
    // (H+1)×(W+1) corner LATTICE plus one over the H×W centres covers the same five points for every cell at
    // once; `sub(_L,…)` reads the four corners of every cell as four overlapping slices of one matrix. Each
    // pass is the ray-crossing parity of the whole grid against one edge, accumulated by `abs(_IN - cross)`
    // — XOR, because a matrix has no boolean type.
    //
    // THE LARGEST ALL-ONES BLOCK IS A RUNNING MINIMUM, NOT A STACK. The TS uses a monotonic stack per row,
    // which is sequential and inexpressible. Instead `_UP` is each column's run of ones ending at that row
    // (H passes of `_G * (shift(_UP,1) + 1)`, the row-0 wrap masked off), and then ONE loop over WIDTH turns
    // the whole search into W matrix operations: `min(_mw, shift(_UP, -w, 'cols'))` is, for every cell at
    // once, the shortest column in the w-wide window starting there — which IS the tallest rectangle of that
    // width anchored there. The argmax over the resulting i×j table is read as a linear index and split by
    // floor / remainder, the documented idiom. Cost is O(angles · res³) matrix cells, which is why `res`
    // defaults to 32 rather than the TS's 150 — see the summary for what that costs in accuracy.
    body: [
      "# Setup",
      "_rs = res > 0 ? res : 32",
      "_st = step > 0 ? step : 30",
      "_na = lock > 0 ? 1 : ceil(180 / _st)",
      "_x0 = min(col(P,0))",
      "_x1 = max(col(P,0))",
      "_y0 = min(col(P,1))",
      "_y1 = max(col(P,1))",
      "_cx = (_x0 + _x1) / 2",
      "_cy = (_y0 + _y1) / 2",
      "_np = rows(P)",
      "_bA = 0 - 1",
      "_bR = zeros(4,2)",
      "# Angle sweep",
      "loop a in _na:",
      "  _th = lock > 0 ? lock * PI / 180 : a * _st * PI / 180",
      "  _co = cos(0 - _th)",
      "  _si = sin(0 - _th)",
      "  _PX = (col(P,0) - _cx) * _co - (col(P,1) - _cy) * _si + _cx",
      "  _PY = (col(P,0) - _cx) * _si + (col(P,1) - _cy) * _co + _cy",
      "  _rx = min(_PX)",
      "  _ry = min(_PY)",
      "  _cs = max(max(max(_PX) - _rx, max(_PY) - _ry) / _rs, 1e-9)",
      "  _W = max(1, ceil((max(_PX) - _rx) / _cs))",
      "  _H = max(1, ceil((max(_PY) - _ry) / _cs))",
      "# Inside test — one pip pass on the corner LATTICE, one on the cell CENTRES",
      "  _LX = _rx + ones(_H+1,1) @ T(arange(_W+1)) * _cs",
      "  _LY = _ry + arange(_H+1) @ ones(1,_W+1) * _cs",
      "  _CI = ones(_H,1) @ T(arange(_W))",
      "  _RI = arange(_H) @ ones(1,_W)",
      "  _XC = _rx + (_CI + 0.5) * _cs",
      "  _YC = _ry + (_RI + 0.5) * _cs",
      "  _L = zeros(_H+1, _W+1)",
      "  _C = zeros(_H, _W)",
      "  loop e in _np:",
      "    _ea = row(_PX, e)",
      "    _fa = row(_PY, e)",
      "    _eb = row(_PX, (e + 1) % _np)",
      "    _fb = row(_PY, (e + 1) % _np)",
      "    _dv = _fb - _fa == 0 ? 1e-9 : _fb - _fa",
      "    _L = abs(_L - ne(gt(_fa, _LY), gt(_fb, _LY)) * lt(_LX, _ea + (_eb - _ea) * (_LY - _fa) / _dv))",
      "    _C = abs(_C - ne(gt(_fa, _YC), gt(_fb, _YC)) * lt(_XC, _ea + (_eb - _ea) * (_YC - _fa) / _dv))",
      "  end",
      "  _G = _C * sub(_L,0,0,_H,_W) * sub(_L,0,1,_H,_W) * sub(_L,1,0,_H,_W) * sub(_L,1,1,_H,_W)",
      "# Largest all-ones block — column runs, then a running minimum across widths",
      "  _UP = _G",
      "  loop u in _H:",
      "    _UP = _G * (shift(_UP,1) * gt(_RI,0) + 1)",
      "  end",
      "  _IX = _RI * _W + _CI",
      "  _mw = _UP",
      "  _aA = 0",
      "  _aW = 1",
      "  _aL = 0",
      "  loop w in _W:",
      "    _mw = min(_mw, shift(_UP, 0 - w, 'cols'))",
      "    _ar = (w + 1) * _mw * le(_CI + w + 1, _W)",
      "    _mx = max(_ar)",
      "    _aW = _mx > _aA ? w + 1 : _aW",
      "    _aL = _mx > _aA ? min(where(ge(_ar, _mx), _IX, 1e18)) : _aL",
      "    _aA = max(_aA, _mx)",
      "  end",
      "# Winning block → metres, corners rotated back to world",
      "  _j = floor(_aL / _W)",
      "  _i = _aL - _j * _W",
      "  _sf = 0.05 * _cs",
      "  _gx0 = _rx + _i * _cs + _sf",
      "  _gy0 = _ry + (_j - _aA / _aW + 1) * _cs + _sf",
      "  _gx1 = _rx + (_i + _aW) * _cs - _sf",
      "  _gy1 = _ry + (_j + 1) * _cs - _sf",
      "  _ra = _aA > 0 && _gx1 > _gx0 && _gy1 > _gy0 ? (_gx1 - _gx0) * (_gy1 - _gy0) : 0",
      "  _RL = vcat(vcat(vcat(hcat(_gx0,_gy0), hcat(_gx1,_gy0)), hcat(_gx1,_gy1)), hcat(_gx0,_gy1))",
      "  _cb = cos(_th)",
      "  _sb = sin(_th)",
      "  _RW = hcat((col(_RL,0) - _cx) * _cb - (col(_RL,1) - _cy) * _sb + _cx, (col(_RL,0) - _cx) * _sb + (col(_RL,1) - _cy) * _cb + _cy)",
      "  _bR = _ra > _bA ? _RW : _bR",
      "  _bA = max(_bA, _ra)",
      "end",
      "R = _bR"
    ].join("\n")
  },
  {
    qualified: "Solid.Skin",
    params: [
      { name: "sections", about: "Stacked rings as [x, y, z, sectionId] — what Solid.SoftBox returns" },
      { name: "idBase", about: "First face id. Give each solid its own block so several can share one row", optional: true }
    ],
    returns: "F",
    summary: "Stitch loft sections into a closed FACE LIST [x, y, z, faceId] for a Polyhedron row — the " +
      "skinning a Loft row would do, done here instead so SEVERAL separate solids can share one row.",
    example: "Pillows = vcat(Solid.Skin(a, 0), Solid.Skin(b, 10000))",
    // WHY THIS EXISTS AT ALL. A Loft row skins whatever it is given by stitching every adjacent pair of
    // sections — so two solids concatenated into one row are joined by a band of geometry bridging the last
    // ring of the first to the first ring of the second. Fine for one object, useless for six pillows, and
    // the failure is a visible web strung between them rather than an error. A Polyhedron row has no such
    // rule: faces are independent, so once the sections are skinned HERE any number of solids share one row
    // and one material. That is what makes a repeated soft part a broadcast instead of a row per instance.
    //
    // The caps are wound the way a loft winds them — near cap reversed, far cap as-is — so a solid skinned
    // here and the same solid through a Loft row are the same mesh, not two conventions that drift apart.
    //
    // `idBase` is not decoration: face grouping keys off RUNS of equal id, so two solids whose ids both
    // start at 0 weld their touching faces into one. Stride the bases well apart.
    body: [
      "_S = max(col(sections, 3)) + 1",
      "_Nn = rows(sections) / max(1, _S)",
      "_b = idBase",
      "_A0 = sub(sections, 0, 0, _Nn, 3)",
      "F = hcat(sortby(_A0, 0 - arange(_Nn)), fill(_Nn, 1, _b))",
      "loop i in _S - 1:",
      "  _A = sub(sections, i * _Nn, 0, _Nn, 3)",
      "  _B = sub(sections, (i + 1) * _Nn, 0, _Nn, 3)",
      "  _V = reshape(hcat(_A, shift(_A, -1), shift(_B, -1), _B), 4 * _Nn, 3)",
      "  F = vcat(F, hcat(_V, kron(arange(_Nn), ones(4, 1)) + (_b + 1 + i * _Nn)))",
      "end",
      "_AL = sub(sections, (_S - 1) * _Nn, 0, _Nn, 3)",
      "F = vcat(F, hcat(_AL, fill(_Nn, 1, _b + 1 + (_S - 1) * _Nn)))"
    ].join("\n")
  },
  {
    qualified: "Solid.SoftBox",
    params: [
      { name: "box", about: "Extent as a 1×6 row [x0, y0, z0, x1, y1, z1], in whatever frame you want it built in" },
      { name: "roundTop", about: "0 = square top arris, 1 = domed. A superellipsoid exponent, NOT a fillet radius" },
      { name: "roundBase", about: "The same for the underside — 0 keeps it flat on whatever it stands on", optional: true },
      { name: "roundPlan", about: "0 = square plan corners, 1 = elliptical footprint", optional: true },
      { name: "stations", about: "Rings up the height (default 12)", optional: true },
      { name: "points", about: "Points per ring (default 24)", optional: true }
    ],
    returns: "M",
    summary: "Soften a box into upholstery: a superellipsoid sampled as LOFT SECTIONS. Three exponents carry " +
      "the whole family — cuboid, eased plinth, mattress, cushion, pillow, bolster — so a soft part is a row " +
      "of numbers rather than its own generator. Feed the result to a 3D Render LOFT row.",
    example: "Mattress = Solid.SoftBox(hcat(x0,y0,z0,x1,y1,z1), 0.18, 0.06, 0.15, 11, 24)",
    // WHY A SUPERELLIPSOID. Every upholstered part in an interior is a box with its arrises taken off by
    // some amount, and that is precisely what the two exponents of a superellipsoid say. At 0 it is exactly
    // a cuboid; raise the plan exponent and the corners round in plan; raise the top exponent and the top
    // arris rolls. One operation covers the plinth, the mattress and the pillows, which is the whole point:
    // a generator is an OPERATION, not an item.
    //
    // WHAT IT IS NOT. The exponent is not a radius. There is no setting that gives a dead-flat top with an
    // exact 40 mm roll — raising the exponent rolls the edge and domes the top together, because in a
    // superellipsoid they are the same number. For a stated radius, sweep a profile instead.
    //
    // WHY BOTH RINGS ARE RESAMPLED BY ARC LENGTH. Walked at even angle, a near-square superellipse puts
    // almost every point on the four corners and almost none along the edges — the ring is geometrically
    // right and metrically useless, and the duplicate points become zero-area quads in the skin. The same
    // happens up the elevation, where even sampling in the angle clusters rings on the flat top and skips
    // the arris, which is the one place the curvature lives. Respacing both by arc length puts the points
    // where the shape actually turns, and is what lets the exponent go to zero and still produce a clean box.
    //
    // …BUT ARC LENGTH ALONE LOSES THE CORNERS. Evenly spaced points are not the same as well chosen ones:
    // respacing a square ring into four points lands them on the four EDGE MIDPOINTS and inscribes a
    // diamond of half the area. The box was not approximated badly, it was replaced. So the ring is built
    // as ONE QUARTER between two corners and rotated into the other three quadrants: the quarter joins ARE
    // the corners, so they are pinned by construction at every exponent, and a cuboid comes back exact.
    // The rotation also makes the ring symmetric by construction rather than by floating-point luck.
    // The point count is rounded to a multiple of EIGHT for the same reason one step down: a quarter
    // needs an even number of points for one to land on its midpoint, and the midpoint of a quarter is
    // the middle of a FACE — the widest point of the whole solid. Miss it and the part comes out quietly
    // under its stated size (60 µm on a 2.1 m plinth, which is nothing to look at and still a dimension
    // that does not match the drawing).
    //
    // THE TOP AND BASE EXPONENTS ARE SEPARATE because a mattress is rolled where you see it and square where
    // it meets the divan. They meet continuously: at the equator the varying term is zero on one axis and
    // one on the other whatever the exponents are, so the seam cannot open.
    body: [
      "_eT = max(0, min(1, roundTop))",
      "_eB = max(0, min(1, roundBase))",
      "_eP = max(0, min(1, roundPlan))",
      "_S = stations > 0 ? max(2, round(stations)) : 12",
      "_Nr = points > 0 ? max(8, round(points)) : 24",
      "_q = 2 * max(1, round(_Nr / 8))",
      "_N = 4 * _q",
      "_x0 = sub(box, 0, 0, 1, 1)",
      "_y0 = sub(box, 0, 1, 1, 1)",
      "_z0 = sub(box, 0, 2, 1, 1)",
      "_x1 = sub(box, 0, 3, 1, 1)",
      "_y1 = sub(box, 0, 4, 1, 1)",
      "_z1 = sub(box, 0, 5, 1, 1)",
      "_D = 96",
      "_eta = (arange(_D + 1) / _D - 0.5) * PI",
      "_sh = sin(_eta)",
      "_ch = cos(_eta)",
      "_ev = where(ge(_sh, 0), fill(_D + 1, 1, _eT), fill(_D + 1, 1, _eB))",
      "_prof = resample(hcat(pow(abs(_ch), _ev), sign(_sh) * pow(abs(_sh), _ev)), _S)",
      "_Dp = 64",
      "_th = PI / 4 + arange(_Dp + 1) / _Dp * (PI / 2)",
      "_ct = cos(_th)",
      "_st = sin(_th)",
      "_arc = resample(hcat(sign(_ct) * pow(abs(_ct), _eP), sign(_st) * pow(abs(_st), _eP)), _q + 1)",
      "_qx = sub(_arc, 0, 0, _q, 1)",
      "_qy = sub(_arc, 0, 1, _q, 1)",
      "_cx = vcat(vcat(_qx, 0 - _qy), vcat(0 - _qx, _qy))",
      "_cy = vcat(vcat(_qy, _qx), vcat(0 - _qy, 0 - _qx))",
      "_o1 = ones(_N, 1)",
      "_rs = kron(sub(_prof, 0, 0, _S, 1), _o1)",
      "_zs = kron(sub(_prof, 0, 1, _S, 1), _o1)",
      "_sid = kron(arange(_S), _o1)",
      "_tx = kron(ones(_S, 1), _cx)",
      "_ty = kron(ones(_S, 1), _cy)",
      "M = hcat((_x0 + _x1) / 2 + (_x1 - _x0) / 2 * _rs * _tx, (_y0 + _y1) / 2 + (_y1 - _y0) / 2 * _rs * _ty, (_z0 + _z1) / 2 + (_z1 - _z0) / 2 * _zs, _sid)"
    ].join("\n")
  }
];
export const EXPR_ALGORITHM_BY_NAME: Record<string, ExprAlgorithm> = Object.fromEntries(
  EXPR_ALGORITHMS.map((a: ExprAlgorithm) => [a.qualified.toLowerCase(), a])
);
export const algorithmsUsedIn = (src: unknown): ExprAlgorithm[] => {
  const text = typeof src === "string" ? src : "";
  const seen = /* @__PURE__ */ new Set();
  const out: ExprAlgorithm[] = [];
  for (const a of EXPR_ALGORITHMS) {
    const re = new RegExp(`${a.qualified.replace(/\./g, "\\.")}\\s*\\(`, "i");
    if (re.test(text) && !seen.has(a.qualified)) {
      seen.add(a.qualified);
      out.push(a);
    }
  }
  return out;
};
