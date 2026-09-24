/** The mesh upgrade.
 *
 *  Every object in this library except bed / staircase / wall builds its solids the same way:
 *  a `Q` table whose rows are [x1,y1, x2,y2, x3,y3, x4,y4, z0, z1, group] and then ~20 lines of
 *  identical kernel that sweeps each quad into a hard six-face box. That is why they read as
 *  CAD blocks: every arris is a perfect 90°, which nothing manufactured ever is.
 *
 *  `bed.json` is the exception, and the thing it does differently is one call: Solid.SoftBox
 *  samples a superellipsoid as loft sections, Solid.Skin stitches them into a face list. At
 *  exponent 0 it returns an EXACT cuboid, so the same call covers a crisp carcass panel and a
 *  plump pillow — the only difference is a number.
 *
 *  So the upgrade is a drop-in replacement for the shared kernel, driven by two new dials that
 *  bed.json already uses by those names: `detail` and `edgeCharacter`.
 */

/** The kernel as it appears, byte for byte, in every object that has it. */
export const OLD_KERNEL = `# Quad prism — every part is a quad swept from z0 to z1 (6 faces)
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

/** The replacement. Same inputs (`Q`), same outputs (`_FL`, `_PL`) so nothing downstream moves.
 *
 *  A quad that is NOT an axis-aligned rectangle (a tapered leg, a mitred return) has no
 *  superellipsoid to be softened into, so it keeps the hard sweep — the two paths live side by
 *  side and are chosen per row. That is why the old six faces are still built below.
 */
export const NEW_KERNEL = `# ── Solids ────────────────────────────────────────────────────────────────────────────────
# Every part is a quad swept from z0 to z1. A box-shaped part becomes a SUPERELLIPSOID — an
# eased arris instead of a perfect 90°, which is the single thing that separates a rendered
# object from a CAD block. Solid.SoftBox samples it as loft sections and Solid.Skin stitches
# them; at exponent 0 that returns an exact cuboid, so one call covers a crisp carcass panel
# and a plump cushion and the only difference is a number.
#
# A quad that is NOT an axis-aligned rectangle — a tapered leg, a mitred return — has no
# superellipsoid to be, so it keeps the hard six-face sweep. Both paths are built and chosen
# per row.
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
_HARD = vcat(_q0,_q1,_q2,_q3,_q4,_q5)
_PL = hcat(reshape(hcat(_a1,_b1,_a2,_b2,_a3,_b3,_a4,_b4), 4*_nq, 2), kron(arange(_nq), _r4), _gq)

# ── the two dials ─────────────────────────────────────────────────────────────────────────
# ONE detail dial drives every sample count in the file, so face count is a decision rather
# than a discovery. Blocky reproduces the old hard box exactly, which is what makes this
# upgrade safe to apply everywhere: the old look is still one setting away.
_dBlocky = detail == 'Blocky'
_dMedium = detail == 'Medium'
_dFine = detail == 'Fine'
_stnWant = _dBlocky ? 2 : (_dMedium ? 5 : (_dFine ? 8 : 12))
_pts = _dBlocky ? 4 : (_dMedium ? 12 : (_dFine ? 20 : 32))

# Edge character is an EXPONENT, not a radius: 0 is a true cuboid and comes back exact. Crisp
# is deliberately not zero — a hair of ease is what catches a highlight along an arris, and a
# dead-square edge is the tell of a generated mesh.
#
# THE ONE THAT MATTERS: roundTop and roundBase DOME the solid. Measured on a 1 × 1 × 0.6 box,
# any non-zero roundTop collapses the top ring to a point — right for a mattress, wrong for a
# wardrobe top you put a lamp on. So hard goods take roundTop = roundBase = 0 and round only in
# PLAN: the top and bottom faces stay dead flat at full size while the vertical arrises ease.
# Only 'Plump', which means upholstery, rolls the top as well.
#
# Measured plan-corner inset on a 1 m box: 0.012 → 3 mm, 0.045 → 10 mm, 0.20 → 47 mm. The
# exponent scales with the part, so a 86 mm switch plate gets its own proportionate 0.3 mm.
_eCrisp = edgeCharacter == 'Crisp'
_eSoft = edgeCharacter == 'Soft'
_ePlump = edgeCharacter == 'Plump'
_eTop = _ePlump ? 0.14 : 0
_eBase = _ePlump ? 0.05 : 0
_ePlan = _eCrisp ? 0.012 : (_eSoft ? 0.045 : (_ePlump ? 0.20 : 0))

# STATIONS ONLY EARN THEIR KEEP WHEN THE TOP ROLLS. With roundTop = roundBase = 0 the solid is
# a straight prism between two flat faces, so every station above the first two subdivides a
# vertical wall and changes nothing: measured, the footprint at 12 stations is identical to the
# footprint at 2, for 7.7× the vertices. So the detail dial drives stations for upholstery and
# points for everything — which is where the shape actually is.
_stn = _ePlump ? _stnWant : 2

# ── per part: soften it when it is a box, sweep it when it is not ─────────────────────────
# The rectangle test is on the quad itself, so a generator that emits a trapezoid keeps its
# shape instead of being silently squared off. NOTE there is no M[i,j] element indexing in
# this language — Q[i, 10] returns the whole matrix, silently — so a row is pulled with sub().
_SOFT = zeros(0, 5)
_keep = zeros(0, 1)
loop i in _nq:
  _qi = sub(Q, i, 0, 1, 11)
  _ax = hcat(col(_qi,0), col(_qi,2), col(_qi,4), col(_qi,6))
  _by = hcat(col(_qi,1), col(_qi,3), col(_qi,5), col(_qi,7))
  _x0 = min(_ax)
  _x1 = max(_ax)
  _y0 = min(_by)
  _y1 = max(_by)
  _z0 = col(_qi,8)
  _z1 = col(_qi,9)
  _bw = _x1 - _x0
  _bh = _y1 - _y0
  _area = _bw * _bh
  _sh = col(_qi,0) * (col(_qi,3) - col(_qi,7)) + col(_qi,2) * (col(_qi,5) - col(_qi,1)) + col(_qi,4) * (col(_qi,7) - col(_qi,3)) + col(_qi,6) * (col(_qi,1) - col(_qi,5))
  _qa = abs(_sh) / 2
  _isRect = _area > 0.0000001 && abs(_qa - _area) < _area * 0.02
  _tall = abs(_z1 - _z0) > 0.0005
  _ok = (_isRect && _tall && !_dBlocky) ? 1 : 0
  # Sample count follows the PART, not the object. A 26 mm socket aperture and a 2 m wardrobe
  # door do not need the same ring count: at the small end the extra points land inside a
  # millimetre of each other and cost face count for nothing a camera can resolve.
  _big = max(_bw, max(_bh, abs(_z1 - _z0)))
  _tiny = _big < 0.05
  _small = _big < 0.2
  _sI = _tiny ? min(_stn, 3) : (_small ? min(_stn, 5) : _stn)
  _pI = _tiny ? min(_pts, 8) : (_small ? min(_pts, 12) : _pts)
  _sec = Solid.SoftBox(hcat(_x0, _y0, _z0, _x1, _y1, _z1), _eTop, _eBase, _ePlan, _sI, _pI)
  _sk = Solid.Skin(_sec, i * 100000)
  _SOFT = _ok > 0 ? vcat(_SOFT, hcat(_sk, fill(rows(_sk), 1, col(_qi,10)))) : _SOFT
  _keep = vcat(_keep, hcat(1 - _ok))
end

# The hard list is SIX blocks of 4·_nq rows — face-major, not part-major — so the mask that
# drops a softened part has to be built in that order too. Get this wrong and the wrong parts
# survive, which looks like a random half of the object turning square.
_hardMask = kron(ones(6, 1), kron(_keep, _r4))
_FL = vcat(compress(_HARD, _hardMask), _SOFT)`;

/** The two props to add, in bed.json's own vocabulary so the library stays consistent. */
export const NEW_PROPS = [
  { id: "detail", name: "Mesh detail", type: "select", value: "Fine",
    options: ["Blocky", "Medium", "Fine", "Smooth"],
    min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
  { id: "edgeCharacter", name: "Edge character", type: "select", value: "Soft",
    options: ["Crisp", "Soft", "Plump"],
    min: 0, max: 10, step: 1, editable: true, showInCanvas: false, necessary: true },
];
