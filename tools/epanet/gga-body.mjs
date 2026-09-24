/** The Todini-Pilati Global Gradient Algorithm as ONE Math Engine body, reading the CANVAS.
 *
 *  Nothing is wired in but the global settings: the network itself arrives through the node's `decode`
 *  block, which runs Graph Interpreter before the formulas and seeds the scope with `nodes`, `nodeTypes`,
 *  `segNodes`, `nodeVals`, `segVals`, `types` and `length`. So the topology, the elevations, the demands
 *  and every pipe's diameter and roughness are read off the drawing and the objects attached to it.
 *
 *  THE INCIDENCE IS BUILT WITH MASKS, NOT INDEX MAPS. The classical GGA eliminates the fixed-head nodes
 *  and works on an nn x nn junction system, which needs a junction-numbering map — a prefix sum the
 *  expression language has no cheap way to write. Instead the system is assembled over ALL N nodes and
 *  the pinned rows are REPLACED by identity rows, which is algebraically the same thing: a pinned row
 *  says H = H_known, and its column is zeroed out of every other row with its contribution moved to the
 *  right-hand side. Everything stays a matrix expression, so there is no per-node loop at all.
 *
 *  ISOLATED NODES ARE PINNED TOO. A node that no live pipe touches has an all-zero row, which makes the
 *  matrix singular and takes the whole solve with it — one stray segment would turn every head into NaN.
 *  Treating it exactly like a fixed head leaves it reporting its own elevation and the rest of the
 *  network unaffected.
 */

/** Column order of the `nodeParams` the decode block lifts off each node's attached object. */
export const NODE_PARAM_KEYS = ["elevation", "demand", "head", "totalHead", "baseElevation", "bottomElevation", "initLevel"];
/** Column order of the `segParams` lifted off each segment's attached Pipe. */
export const SEG_PARAM_KEYS = ["diameter", "roughC", "minorLoss", "lengthOverride"];
/** `typeNames` for the decode block. 1-based codes: pipe = 1, junction = 2, reservoir = 3, tank = 4. */
export const TYPE_NAMES = ["pipe", "junction", "reservoir", "tank"];

export const GGA_BODY = `# Shape and index helpers
_N = rows(nodes)
_M = rows(a)
_iN = arange(_N)
_iM = arange(_M)
_rowN = T(_iN)
_ones1N = ones(1, _N)
_I = eq(kron(_iN, _ones1N), kron(ones(_N, 1), _rowN))

# Node classification — typeNames = [pipe, junction, reservoir, tank], so 2 / 3 / 4 here.
_code = col(nodeTypes, 0)
_isJ = eq(_code, 2)
_isR = eq(_code, 3)
_isT = eq(_code, 4)
_fix = max(_isR, _isT)

# Node data — nodeVals columns: 0 elevation, 1 demand, 2 head, 3 totalHead, 4 baseElevation,
# 5 bottomElevation, 6 initLevel. Each kind reads the columns its own object actually carries.
_elev = _isJ * col(nodeVals, 0) + _isR * col(nodeVals, 4) + _isT * col(nodeVals, 5)
_demLps = _isJ * col(nodeVals, 1) * demandFactor
_dem = _demLps / 1000
# A tank's head MOVES with its level; a reservoir's is the level you typed.
_hFix = _isR * col(nodeVals, 3) + _isT * (col(nodeVals, 5) + col(nodeVals, 6))

# Segment data — segVals columns: 0 diameter (mm), 1 Hazen-Williams C, 2 minor loss K,
# 3 hydraulic length override. Only segments carrying a Pipe object are part of the network.
_isPipe = eq(col(types, 0), 1)
_d = max(0.005, col(segVals, 0) / 1000)
_C = max(1, col(segVals, 1))
_K = max(0, col(segVals, 2))
# The override wins when set; 0 means "use the drawn length". A network layout is a schematic, so the
# true length is DATA on the pipe rather than a distance on the drawing.
_useOv = gt(col(segVals, 3), 0)
_L = max(0.01, _useOv * col(segVals, 3) + (1 - _useOv) * col(length, 0))
_area = PI * _d * _d / 4
_r = 10.667 * _L / (pow(_C, 1.852) * pow(_d, 4.871))
_mK = 8 * _K / (PI * PI * 9.81 * pow(_d, 4))
_nE = 1.852

# Incidence, from the node indices the decoder resolved. -1 at the from-node, +1 at the to-node, so
# A @ H is the head DROP along each pipe. A row of an endpoint that resolved to nothing is all zeros.
_fromOH = eq(kron(col(segNodes, 0), _ones1N), kron(ones(_M, 1), _rowN))
_toOH = eq(kron(col(segNodes, 1), _ones1N), kron(ones(_M, 1), _rowN))
_pipeN = kron(_isPipe, _ones1N)
_A = (_toOH - _fromOH) * _pipeN
_AT = T(_A)

# Which rows are PINNED — the fixed heads, plus any node no live pipe reaches.
_deg = T(abs(_A)) @ ones(_M, 1)
_iso = eq(_deg, 0)
_pin = max(_fix, _iso)
_free = 1 - _pin
_pr = kron(_pin, _ones1N)
_pc = kron(ones(_N, 1), T(_pin))
_keep = (1 - _pr) * (1 - _pc)

# Initial state: fixed nodes at their head, everything else at its own ground level, every pipe at
# about 0.3 m/s. The GGA converges from almost anywhere; this just keeps the first linearisation sane.
_H = _hFix * _fix + _elev * _free
_Q = _area * 0.3 * _isPipe
# THE RUN GATE. The button publishes a counter; until it is pressed this is 0 iterations, so the node
# costs nothing while sliders move and the expensive solve happens when it is asked for.
_iters = run > 0 ? max(1, min(200, round(maxIter))) : 0

loop k in _iters:
  _aq = max(abs(_Q), 1e-9)
  # h(Q) = r Q|Q|^(n-1) + m Q|Q|, linearised about the current Q.
  _hq = _r * _Q * pow(_aq, _nE - 1) + _mK * _Q * _aq
  _g = max(_nE * _r * pow(_aq, _nE - 1) + 2 * _mK * _aq, 1e-12)
  _c = _isPipe / _g
  _qs = _Q - _hq * _c
  _Am = _AT @ (_A * kron(_c, _ones1N))
  # Pinned rows become identity rows; the pinned COLUMNS are zeroed out of the free rows and their
  # known heads moved across to the right-hand side. Same system, no renumbering.
  _Mm = _Am * _keep + _I * _pr
  _known = _H * _pin
  _rhs = (_AT @ _qs - _dem - _Am @ _known) * _free + _known
  _H = inv(_Mm) @ _rhs
  _Q = _qs - _c * (_A @ _H)
end

# ── Results ────────────────────────────────────────────────────────────────────
_aqf = max(abs(_Q), 1e-9)
_vel = abs(_Q) / _area * _isPipe
_press = _H - _elev
_net = _AT @ _Q
_energy = (_r * _Q * pow(_aqf, _nE - 1) + _mK * _Q * _aqf + _A @ _H) * _isPipe
_cont = (_net - _dem) * _free
_hl = (_r * _Q * pow(_aqf, _nE - 1) + _mK * _Q * _aqf) * _isPipe

Qsolved = _Q
Hsolved = _H
Pressure = _press
Velocity = _vel
Headloss = _hl

# ── Assignment matrices — [indexInBundle, value] rows for the Set Object Param nodes ────────────
# One row per element that should be written, and only for the kind that owns that parameter: a
# junction has no "supply" and a reservoir no "head", so a single matrix over all nodes would write
# a parameter onto objects that do not have one.
NodeHead = compress(hcat(_iN, _H), _isJ)
ResSupply = compress(hcat(_iN, _net * 1000), _isR)
TankInflow = compress(hcat(_iN, _net * 1000), _isT)
SegFlow = compress(hcat(_iM, _Q * 1000), _isPipe)
SegHeadA = compress(hcat(_iM, _fromOH @ _H), _isPipe)
SegHeadB = compress(hcat(_iM, _toOH @ _H), _isPipe)

# ── Global metrics ─────────────────────────────────────────────────────────────
nodesRead = _N
segmentsRead = _M
pipeCount = sum(_isPipe)
junctionCount = sum(_isJ)
fixedHeadCount = sum(_fix)
isolatedNodes = sum(_iso)
danglingEnds = unresolvedEnds
solved = _iters > 0 ? 1 : 0
iterationsRun = _iters

totalDemand = sum(_demLps * _isJ)
totalSupply = 0 - sum(_net * _fix) * 1000
maxVelocity = max(_vel)
minPressure = junctionCount > 0 ? min(_press * _isJ + (1 - _isJ) * 1e9) : 0
maxHeadloss = max(abs(_hl))
totalPipeLength = sum(_L * _isPipe)
waterVolume = sum(_area * _L * _isPipe)

maxEnergyResidual = max(abs(_energy))
maxContinuityResidual = max(abs(_cont))
balanceError = abs(totalDemand - totalSupply)

# ── Design check against the global settings ───────────────────────────────────
peakDemand = totalDemand * peakFactor
peakDemandM3h = totalDemand * peakFactor * 3.6
peakDemandMld = totalDemand * peakFactor * 0.0864
dailyVolume = totalDemand * peakFactor * max(0.5, supplyHours) * 3.6
populationServed = perCapita > 0 ? dailyVolume * 1000 / perCapita : 0
pressureMargin = minPressure - minPressureReq
pressureOk = minPressure >= minPressureReq ? 1 : 0
velocityMargin = maxVelocityAllowed - maxVelocity
velocityOk = maxVelocity <= maxVelocityAllowed ? 1 : 0
scouringOk = maxVelocity >= minVelocityReq ? 1 : 0
designOk = (minPressure >= minPressureReq && maxVelocity <= maxVelocityAllowed) ? 1 : 0`;
