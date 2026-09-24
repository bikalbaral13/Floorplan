/** The DIRECT STIFFNESS METHOD for a plane frame, as ONE Math Engine body, reading the CANVAS.
 *
 *  Nothing is wired in but the global settings: the structure arrives through the node's `decode`
 *  block, which seeds the scope with `nodes`, `segNodes`, `types` and the PARAMETERS off every joint
 *  and member object — restraints, loads, E, section, releases. So the model is the drawing.
 *
 *  THREE ALGORITHMS, ONE ASSEMBLY. They differ in two scalars and one extra matrix, not in three
 *  code paths:
 *    Plane frame (first-order)  — the full 6×6 member stiffness, axial + bending.
 *    Plane truss (axial only)   — the SAME assembly with the flexural terms switched off and every
 *                                 rotational freedom restrained. A truss is not a different solver;
 *                                 it is a frame with no bending stiffness and no rotational DOF.
 *    Plane frame (P-Delta)      — first-order, then the geometric stiffness Kg built from the axial
 *                                 forces just found, re-solved, repeated. Second-order effects come
 *                                 from iterating the SAME assembly, which is why the outer loop is
 *                                 the only addition.
 *
 *  CONSTRAINTS BY ROW REPLACEMENT, not by renumbering. A restrained DOF's row becomes an identity
 *  row and its column is cleared from every other row — algebraically the same system as deleting it,
 *  without the free-DOF numbering map that the expression language has no cheap way to build. Nodes
 *  no member reaches, and DOFs left with no stiffness (every member at them released), are pinned the
 *  same way: a zero on the diagonal is a singular matrix and would take every result with it.
 *
 *  MOMENT RELEASES BY STATIC CONDENSATION, one DOF at a time and GATED, so a member with no release
 *  runs the identical arithmetic with a multiplier of zero. Condensing local DOF 2 then DOF 5 from the
 *  already-condensed matrix is the correct sequential form for a member released at both ends.
 */

/** Column order of the joint object's parameters, lifted by the decode block. */
export const NODE_PARAM_KEYS = ["fixX", "fixY", "fixR", "Fx", "Fy", "Mz"];
/** Column order of the member object's parameters. */
export const SEG_PARAM_KEYS = ["E", "b", "h", "udl", "releaseStart", "releaseEnd", "density", "selfWeight"];
/** 1-based type codes: beam = 1, column = 2, joint = 3. */
export const TYPE_NAMES = ["frame-beam", "frame-column", "frame-joint"];

export const ANALYSES = ["Plane frame (first-order)", "Plane truss (axial only)", "Plane frame (P-Delta)"];
/** Diagram options, in CODE ORDER — the Set Object Param value map is positional, so this list is
 *  the contract between the code the Math Engine emits and the member object's own select. */
export const DIAGRAMS = ["None", "Bending moment", "Shear force", "Axial force", "Deflected shape"];

export const FRAME_BODY = `# ── Shape, indices, identity ───────────────────────────────────────────────────
_N = rows(nodes)
_M = rows(a)
_ND = 3 * _N
_iN = arange(_N)
_iM = arange(_M)
_rowN = T(_iN)
_rowND = T(arange(_ND))
_I3 = eye(_ND)

# ── The structural frame. Canvas y runs DOWN the page; structural Y runs UP, so every
# ── y is negated once, here, and nothing downstream has to remember it again.
_X = col(nodes, 0)
_Y = 0 - col(nodes, 1)

# ── Joint data — nodeVals columns: 0 fixX, 1 fixY, 2 fixR, 3 Fx, 4 Fy, 5 Mz ────
_fixX = gt(col(nodeVals, 0), 0)
_fixY = gt(col(nodeVals, 1), 0)
_fixR = gt(col(nodeVals, 2), 0)
_Fx = col(nodeVals, 3) * loadFactor
_Fy = col(nodeVals, 4) * loadFactor
_Mz = col(nodeVals, 5) * loadFactor

# ── Member data — segVals columns: 0 E, 1 b, 2 h, 3 udl, 4 relStart, 5 relEnd,
# ── 6 density, 7 selfWeight. Only segments carrying a beam or column object are members.
_isMem = max(eq(col(types, 0), 1), eq(col(types, 0), 2))
_Ev = max(1, col(segVals, 0)) * 1e6
_bv = max(0.02, col(segVals, 1) / 1000)
_hv = max(0.02, col(segVals, 2) / 1000)
_Av = _bv * _hv
_Iv = _bv * pow(_hv, 3) / 12 * max(0.01, stiffnessFactor)
_relS = gt(col(segVals, 4), 0)
_relE = gt(col(segVals, 5), 0)
# Self weight is opt-in PER MEMBER and joins the span load, so one number reaches the analysis.
_swv = gt(col(segVals, 7), 0) * _Av * col(segVals, 6)
_wv = (col(segVals, 3) + _swv) * loadFactor * _isMem
_EAv = _Ev * _Av
_EIv = _Ev * _Iv

# ── Geometry from the incidence the decoder resolved ───────────────────────────
_na = col(segNodes, 0)
_nb = col(segNodes, 1)
_Oa = eq(kron(_na, ones(1, _N)), kron(ones(_M, 1), _rowN))
_Ob = eq(kron(_nb, ones(1, _N)), kron(ones(_M, 1), _rowN))
_x1 = _Oa @ _X
_y1 = _Oa @ _Y
_x2 = _Ob @ _X
_y2 = _Ob @ _Y
_dxv = _x2 - _x1
_dyv = _y2 - _y1
_Lv = max(1e-6, sqrt(_dxv * _dxv + _dyv * _dyv))
_csv = _dxv / _Lv
_snv = _dyv / _Lv
_DOFv = hcat(3 * _na, 3 * _na + 1, 3 * _na + 2, 3 * _nb, 3 * _nb + 1, 3 * _nb + 2)

# ── Which algorithm ────────────────────────────────────────────────────────────
_isTruss = analysis == 'Plane truss (axial only)'
_isPD = analysis == 'Plane frame (P-Delta)'
_bend = _isTruss ? 0 : 1
# A comparison yields a BOOLEAN, and multiplying a matrix by one gives an empty matrix rather than a
# scaled copy — every mask that meets a matrix has to be a number first.
_trussN = _isTruss ? 1 : 0
_pdN = _isPD ? 1 : 0

# ── Restrained DOFs. reshape is row-major, so node i's three freedoms land at 3i, 3i+1, 3i+2.
_pinJ = reshape(hcat(_fixX, _fixY, _fixR), _ND, 1)
# A truss has no rotational freedom at all.
_rotAll = reshape(hcat(zeros(_N, 1), zeros(_N, 1), ones(_N, 1)), _ND, 1)
_pin0 = max(_pinJ, _trussN * _rotAll)
# A node no member reaches would leave three empty rows.
_degN = T(_Oa) @ _isMem + T(_Ob) @ _isMem
_isoN = eq(_degN, 0)
_pin1 = max(_pin0, reshape(hcat(_isoN, _isoN, _isoN), _ND, 1))

_Fjoint = reshape(hcat(_Fx, _Fy, _Mz), _ND, 1)

# ── Solve ──────────────────────────────────────────────────────────────────────
# The RUN GATE: no presses, no iterations, no work. A P-Delta run repeats the whole assembly with
# the axial forces from the pass before; first-order runs it once.
_outer = run > 0 ? (_isPD ? max(1, min(20, round(pdeltaIters))) : 1) : 0
_Pax = zeros(_M, 1)
_D = zeros(_ND, 1)
_Fv = zeros(_ND, 1)
_K = zeros(_ND, _ND)
_MF = zeros(_M, 6)
_MD = zeros(_M, 6)

loop it in _outer:
  _K = zeros(_ND, _ND)
  _Fv = _Fjoint
  loop i in _M:
    _Li = row(_Lv, i)
    _ci = row(_csv, i)
    _si = row(_snv, i)
    _mi = row(_isMem, i)
    _ea = row(_EAv, i) / _Li * _mi
    _ei = row(_EIv, i) * _bend * _mi
    _e1 = 12 * _ei / pow(_Li, 3)
    _e2 = 6 * _ei / pow(_Li, 2)
    _e3 = 4 * _ei / _Li
    _e4 = 2 * _ei / _Li
    _k = vcat( hcat(_ea, 0, 0, 0 - _ea, 0, 0), hcat(0, _e1, _e2, 0, 0 - _e1, _e2), hcat(0, _e2, _e3, 0, 0 - _e2, _e4), hcat(0 - _ea, 0, 0, _ea, 0, 0), hcat(0, 0 - _e1, 0 - _e2, 0, _e1, 0 - _e2), hcat(0, _e2, _e4, 0, 0 - _e2, _e3))
    # Geometric stiffness — the only structural difference a second-order analysis makes. Built from
    # the axial force of the PREVIOUS pass, which is zero on the first, so pass 1 is first-order.
    _Pi = row(_Pax, i) * _pdN
    _g = _Pi / _Li
    _Kg = _g * vcat( hcat(0, 0, 0, 0, 0, 0), hcat(0, 1.2, _Li / 10, 0, 0 - 1.2, _Li / 10), hcat(0, _Li / 10, 2 * _Li * _Li / 15, 0, 0 - _Li / 10, 0 - _Li * _Li / 30), hcat(0, 0, 0, 0, 0, 0), hcat(0, 0 - 1.2, 0 - _Li / 10, 0, 1.2, 0 - _Li / 10), hcat(0, _Li / 10, 0 - _Li * _Li / 30, 0, 0 - _Li / 10, 2 * _Li * _Li / 15))
    _k = _k + _Kg * _bend
    # Span load, resolved from GLOBAL gravity onto the member's own axes: a load of w per metre
    # acting down has a transverse component w·cos and an axial component w·sin, so an inclined
    # member takes its share of both instead of being loaded perpendicular to itself.
    _wi = row(_wv, i)
    _qt = 0 - _wi * _ci
    _qa = 0 - _wi * _si
    _fef = vcat( hcat(0 - _qa * _Li / 2), hcat(0 - _qt * _Li / 2), hcat(0 - _qt * _Li * _Li / 12), hcat(0 - _qa * _Li / 2), hcat(0 - _qt * _Li / 2), hcat(_qt * _Li * _Li / 12))
    # Moment releases, by gated static condensation — local DOF 2 (start), then DOF 5 (end) from the
    # already-condensed matrix. A member with no release multiplies by zero and is untouched.
    _r1 = row(_relS, i) * _bend
    _c2 = sub(_k, 0, 2, 6, 1)
    _r2 = sub(_k, 2, 0, 1, 6)
    _d2 = max(abs(sub(_k, 2, 2, 1, 1)), 1e-12)
    _f2 = sub(_fef, 2, 0, 1, 1)
    _k = _k - _r1 * (_c2 @ _r2) / _d2
    _fef = _fef - _r1 * _c2 * _f2 / _d2
    _r5 = row(_relE, i) * _bend
    _c5 = sub(_k, 0, 5, 6, 1)
    _r5r = sub(_k, 5, 0, 1, 6)
    _d5 = max(abs(sub(_k, 5, 5, 1, 1)), 1e-12)
    _f5 = sub(_fef, 5, 0, 1, 1)
    _k = _k - _r5 * (_c5 @ _r5r) / _d5
    _fef = _fef - _r5 * _c5 * _f5 / _d5
    # Local → global, and scatter into the structure by a one-hot selection matrix.
    _Tm = vcat( hcat(_ci, _si, 0, 0, 0, 0), hcat(0 - _si, _ci, 0, 0, 0, 0), hcat(0, 0, 1, 0, 0, 0), hcat(0, 0, 0, _ci, _si, 0), hcat(0, 0, 0, 0 - _si, _ci, 0), hcat(0, 0, 0, 0, 0, 1))
    _Lsel = eq(kron(T(row(_DOFv, i)), ones(1, _ND)), kron(ones(6, 1), _rowND))
    _K = _K + T(_Lsel) @ (T(_Tm) @ _k @ _Tm) @ _Lsel
    _Fv = _Fv - T(_Lsel) @ (T(_Tm) @ _fef)
  end
  # A DOF with no stiffness at all — every member at it released, or an orphan — is pinned rather
  # than left to make the matrix singular.
  _pin = max(_pin1, le(abs(diag(_K)), 1e-9))
  _pr = kron(_pin, ones(1, _ND))
  _pc = kron(ones(_ND, 1), T(_pin))
  _Kc = _K * (1 - _pr) * (1 - _pc) + _I3 * _pr
  _D = solve(_Kc, _Fv * (1 - _pin))
  # Member end actions, and the axial force the next P-Delta pass needs.
  _MF = zeros(0, 6)
  _MD = zeros(0, 6)
  loop i in _M:
    _Li = row(_Lv, i)
    _ci = row(_csv, i)
    _si = row(_snv, i)
    _mi = row(_isMem, i)
    _ea = row(_EAv, i) / _Li * _mi
    _ei = row(_EIv, i) * _bend * _mi
    _e1 = 12 * _ei / pow(_Li, 3)
    _e2 = 6 * _ei / pow(_Li, 2)
    _e3 = 4 * _ei / _Li
    _e4 = 2 * _ei / _Li
    _k = vcat( hcat(_ea, 0, 0, 0 - _ea, 0, 0), hcat(0, _e1, _e2, 0, 0 - _e1, _e2), hcat(0, _e2, _e3, 0, 0 - _e2, _e4), hcat(0 - _ea, 0, 0, _ea, 0, 0), hcat(0, 0 - _e1, 0 - _e2, 0, _e1, 0 - _e2), hcat(0, _e2, _e4, 0, 0 - _e2, _e3))
    # The SAME geometric stiffness the assembly used. Recovering member actions from the elastic
    # matrix alone would contradict the reactions, which come from the assembled K.
    _Pi = row(_Pax, i) * _pdN
    _g = _Pi / _Li
    _Kg = _g * vcat( hcat(0, 0, 0, 0, 0, 0), hcat(0, 1.2, _Li / 10, 0, 0 - 1.2, _Li / 10), hcat(0, _Li / 10, 2 * _Li * _Li / 15, 0, 0 - _Li / 10, 0 - _Li * _Li / 30), hcat(0, 0, 0, 0, 0, 0), hcat(0, 0 - 1.2, 0 - _Li / 10, 0, 1.2, 0 - _Li / 10), hcat(0, _Li / 10, 0 - _Li * _Li / 30, 0, 0 - _Li / 10, 2 * _Li * _Li / 15))
    _k = _k + _Kg * _bend
    _wi = row(_wv, i)
    _qt = 0 - _wi * _ci
    _qa = 0 - _wi * _si
    _fef = vcat( hcat(0 - _qa * _Li / 2), hcat(0 - _qt * _Li / 2), hcat(0 - _qt * _Li * _Li / 12), hcat(0 - _qa * _Li / 2), hcat(0 - _qt * _Li / 2), hcat(_qt * _Li * _Li / 12))
    _r1 = row(_relS, i) * _bend
    _c2 = sub(_k, 0, 2, 6, 1)
    _r2 = sub(_k, 2, 0, 1, 6)
    _d2 = max(abs(sub(_k, 2, 2, 1, 1)), 1e-12)
    _f2 = sub(_fef, 2, 0, 1, 1)
    _k = _k - _r1 * (_c2 @ _r2) / _d2
    _fef = _fef - _r1 * _c2 * _f2 / _d2
    _r5 = row(_relE, i) * _bend
    _c5 = sub(_k, 0, 5, 6, 1)
    _r5r = sub(_k, 5, 0, 1, 6)
    _d5 = max(abs(sub(_k, 5, 5, 1, 1)), 1e-12)
    _f5 = sub(_fef, 5, 0, 1, 1)
    _k = _k - _r5 * (_c5 @ _r5r) / _d5
    _fef = _fef - _r5 * _c5 * _f5 / _d5
    _Tm = vcat( hcat(_ci, _si, 0, 0, 0, 0), hcat(0 - _si, _ci, 0, 0, 0, 0), hcat(0, 0, 1, 0, 0, 0), hcat(0, 0, 0, _ci, _si, 0), hcat(0, 0, 0, 0 - _si, _ci, 0), hcat(0, 0, 0, 0, 0, 1))
    _Lsel = eq(kron(T(row(_DOFv, i)), ones(1, _ND)), kron(ones(6, 1), _rowND))
    _dloc = _Tm @ (_Lsel @ _D)
    _fi = _k @ _dloc + _fef
    _MF = vcat(_MF, T(_fi))
    _MD = vcat(_MD, T(_dloc))
  end
  # Axial, TENSION POSITIVE: the local x action at the far end. Feeds the next P-Delta pass.
  _Pax = col(_MF, 3)
end

# ── Results ────────────────────────────────────────────────────────────────────
_pin = max(_pin1, le(abs(diag(_K)), 1e-9))
_Dn = reshape(_D, _N, 3)
_ux = col(_Dn, 0)
_uy = col(_Dn, 1)
_rz = col(_Dn, 2)
# Reactions are the residual of the UNCONSTRAINED system, and are meaningful only where restrained.
_Rall = _K @ _D - _Fv
_Rn = reshape(_Rall * _pin, _N, 3)
_Rx = col(_Rn, 0)
_Ry = col(_Rn, 1)
_Rz = col(_Rn, 2)
_isSup = gt(_fixX + _fixY + _fixR, 0)

_N1 = col(_MF, 0)
_V1 = col(_MF, 1)
_M1 = col(_MF, 2)
_N2 = col(_MF, 3)
_V2 = col(_MF, 4)
_M2 = col(_MF, 5)

Displacements = _Dn
MemberActions = _MF

# ── Assignment matrices for the Set Object Param writers ───────────────────────
# Displacements in mm and rotations in mrad, because that is what a joint reports; the analysis
# works in m and rad and converts once, here, rather than in six places downstream.
JointUx = hcat(_iN, _ux * 1000)
JointUy = hcat(_iN, _uy * 1000)
JointRot = hcat(_iN, _rz * 1000)
JointRx = hcat(_iN, _Rx)
JointRy = hcat(_iN, _Ry)
JointRz = hcat(_iN, _Rz)
MemN1 = compress(hcat(_iM, _N1), _isMem)
MemV1 = compress(hcat(_iM, _V1), _isMem)
MemM1 = compress(hcat(_iM, _M1), _isMem)
MemN2 = compress(hcat(_iM, _N2), _isMem)
MemV2 = compress(hcat(_iM, _V2), _isMem)
MemM2 = compress(hcat(_iM, _M2), _isMem)
# Local end displacements, mm and mrad.
MemDu1 = compress(hcat(_iM, col(_MD, 0) * 1000), _isMem)
MemDv1 = compress(hcat(_iM, col(_MD, 1) * 1000), _isMem)
MemDr1 = compress(hcat(_iM, col(_MD, 2) * 1000), _isMem)
MemDu2 = compress(hcat(_iM, col(_MD, 3) * 1000), _isMem)
MemDv2 = compress(hcat(_iM, col(_MD, 4) * 1000), _isMem)
MemDr2 = compress(hcat(_iM, col(_MD, 5) * 1000), _isMem)
# One diagram choice for the whole model, written onto every member so a single control switches them
# all. The writer maps the code back to the member object's own select.
_dgc = diagram == 'Bending moment' ? 1 : (diagram == 'Shear force' ? 2 : (diagram == 'Axial force' ? 3 : (diagram == 'Deflected shape' ? 4 : 0)))
MemDiagram = compress(hcat(_iM, _dgc * ones(_M, 1)), _isMem)
# Each joint's height above the lowest support, so it can report a DRIFT RATIO rather than millimetres.
JointHeight = hcat(_iN, _Y - min(_Y))

# ── Global metrics ─────────────────────────────────────────────────────────────
nodesRead = _N
segmentsRead = _M
memberCount = sum(_isMem)
beamCount = sum(eq(col(types, 0), 1))
columnCount = sum(eq(col(types, 0), 2))
supportCount = sum(_isSup)
restrainedDofs = sum(_pin)
freeDofs = _ND - sum(_pin)
totalDofs = _ND
danglingEnds = unresolvedEnds
isolatedNodes = sum(_isoN)
solved = _outer > 0 ? 1 : 0
iterationsRun = _outer
analysisCode = _isTruss ? 2 : (_isPD ? 3 : 1)

_span = sum(_Lv * _isMem)
totalMemberLength = _span
structureWeight = sum(_swv * _Lv * _isMem)
totalSpanLoad = sum(_wv * _Lv * _isMem)
appliedFx = sum(_Fx)
appliedFy = sum(_Fy)
reactionFx = sum(_Rx)
reactionFy = sum(_Ry)
# The analysis's own audit: every applied force must come back out through the supports.
equilibriumX = abs(sum(_Fx) + sum(_Rx))
equilibriumY = abs(appliedFy - sum(_wv * _Lv * _isMem) + sum(_Ry))
verticalCheck = abs(appliedFy - sum(_wv * _Lv * _isMem) + reactionFy)

maxDispX = max(abs(_ux)) * 1000
maxDispY = max(abs(_uy)) * 1000
maxDisplacement = max(sqrt(_ux * _ux + _uy * _uy)) * 1000
maxRotation = max(abs(_rz)) * 1000
maxAxialTension = max(_N2)
maxAxialCompression = max(0 - _N2)
maxShear = max(abs(_V1)) > max(abs(_V2)) ? max(abs(_V1)) : max(abs(_V2))
maxEndMoment = max(abs(_M1)) > max(abs(_M2)) ? max(abs(_M1)) : max(abs(_M2))
maxReaction = max(sqrt(_Rx * _Rx + _Ry * _Ry))
strainEnergy = 0.5 * sum(_D * (_K @ _D))

# ── Serviceability, against the global limits ──────────────────────────────────
_lim = max(1, deflectionLimit)
allowableDeflection = _span > 0 ? max(_Lv * _isMem) / _lim * 1000 : 0
deflectionOk = maxDisplacement <= allowableDeflection ? 1 : 0
_dlim = max(1, driftLimit)
_height = max(_Y) - min(_Y)
allowableDrift = _height / _dlim * 1000
storeyDrift = maxDispX
driftOk = maxDispX <= (_height / _dlim * 1000) ? 1 : 0
# Sway at the TOP of the structure, which is what a drift limit is written against — the largest
# horizontal displacement anywhere can belong to a mid-height node on a soft storey.
_topMask = eq(_Y, max(_Y))
topSway = max(abs(_ux) * _topMask) * 1000
swayIndex = topSway > 1e-9 ? _height / (topSway / 1000) : 0
swayRatio = _height > 1e-9 ? (topSway / 1000) / _height : 0
baseShear = abs(sum(_Rx))
overturningMoment = abs(sum(_Rx * (_Y - min(_Y))))
equilibriumOk = (abs(sum(_Fx) + sum(_Rx)) < 0.001 * max(1, abs(sum(_Fx)))) ? 1 : 0
analysisOk = (solved > 0 && isolatedNodes == 0 && danglingEnds == 0) ? 1 : 0`;
