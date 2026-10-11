# ── Math Engine runtime (generated objects embed this file verbatim) ──────────────────────────────────────
# A faithful port of packages/engine/src/expr/expr.ts value semantics + matrix/matrixCore.ts kernels +
# matrix/axisMesh.ts face builders + prism/lathe from matrix/meshBool.ts, so a six-node object translated by
# pyobject.spine2py computes the same numbers in pure Python (Pyodide, CPython, Blender). Conventions match
# the engine: a matrix is a list of rows; failures return [] or 0 instead of raising; results round to
# 12 significant digits (round6).
import math as _m


class _Unsupported(Exception):
    pass


def _isM(v): return isinstance(v, list)


_P10 = {k: 10.0 ** k for k in range(-300, 40)}   # ceil(-log10 a) + 12 for 1e-12 <= a < 1e308
_log10, _ceil, _floor, _INF = _m.log10, _m.ceil, _m.floor, _m.inf


def round6(x):
    if x.__class__ is bool or not isinstance(x, (int, float)) or x != x or x == _INF or x == -_INF: return x
    a = x if x >= 0 else -x
    if a < 1e-12: return 0
    f = _P10[_ceil(-_log10(a)) + 12]
    v = x * f
    if v != v or v == _INF or v == -_INF: return x
    return _floor(v + 0.5) / f


def _jsround(x):
    if x != x or x in (_m.inf, -_m.inf): return x
    return _m.floor(x + 0.5)


def _parsefloat(s):
    s = s.strip(); best = 0.0; ok = False
    for i in range(1, len(s) + 1):
        try: best = float(s[:i]); ok = True
        except ValueError:
            if ok and s[i - 1] not in "eE+-.": break
    return best if ok and best == best else 0


def _num(x):
    if isinstance(x, bool): return 1 if x else 0
    if isinstance(x, (int, float)): return x
    if _isM(x):
        try: return x[0][0]
        except (IndexError, TypeError): return 0
    if isinstance(x, str): return _parsefloat(x) or 0
    return 0


def _truthy(x):
    if isinstance(x, bool): return x
    if isinstance(x, (int, float)): return x != 0
    if _isM(x): return len(x) > 0
    return x != ""


def _asM(v):
    if isinstance(v, bool): return []
    if isinstance(v, (int, float)): return [[v]] if v == v and v not in (_m.inf, -_m.inf) else []
    if isinstance(v, str):
        t = v.strip()
        if t and t[0] not in "[{":
            try:
                n = float(t)
                return [[n]] if n == n and n not in (_m.inf, -_m.inf) else []
            except ValueError: return []
        if t.startswith("["):
            import json as _j
            try:
                r = _j.loads(t)
                if isinstance(r, list) and r and isinstance(r[0], list): return [[(float(x) if isinstance(x, (int, float)) else 0) for x in row] if isinstance(row, list) else [] for row in r]
            except ValueError: pass
        return []
    return v if _isM(v) else []


def _rect(M):
    if not M or not isinstance(M[0], list) or not M[0]: return False
    if len(M) == 1: return True
    try: lens = set(map(len, M))
    except TypeError: return False
    return len(lens) == 1


def _bshape(A, B):
    if not _rect(A) or not _rect(B): return None
    ar, ac, br, bc = len(A), len(A[0]), len(B), len(B[0])
    if ar != br and ar != 1 and br != 1: return None
    if ac != bc and ac != 1 and bc != 1: return None
    return max(ar, br), max(ac, bc)


def _bc(M, i, j):
    try: return M[0 if len(M) == 1 else i][0 if len(M[0]) == 1 else j]
    except IndexError: return 0


def _ew(A, B, f):
    s = _bshape(A, B)
    if not s: return None
    r = round6
    ar, ac, br, bc = len(A), len(A[0]), len(B), len(B[0])
    if ar == br and ac == bc: return [[r(f(x, y)) for x, y in zip(ra, rb)] for ra, rb in zip(A, B)]
    if br == 1 and bc == 1:
        y = B[0][0]; return [[r(f(x, y)) for x in ra] for ra in A]
    if ar == 1 and ac == 1:
        x = A[0][0]; return [[r(f(x, y)) for y in rb] for rb in B]
    if ar == br and bc == 1: return [[r(f(x, rb[0])) for x in ra] for ra, rb in zip(A, B)]
    if ar == br and ac == 1: return [[r(f(ra[0], y)) for y in rb] for ra, rb in zip(A, B)]
    return [[r(f(_bc(A, i, j), _bc(B, i, j))) for j in range(s[1])] for i in range(s[0])]


def _jsdiv(a, b):
    if b == 0: return _m.nan if a == 0 or a != a else _m.copysign(_m.inf, a) * (1 if _m.copysign(1, b) > 0 else -1)
    return a / b


def _jsmod(a, b):
    if b == 0 or a in (_m.inf, -_m.inf): return _m.nan
    return _m.fmod(a, b)


def _jspow(a, b):
    try: r = a ** b
    except ZeroDivisionError: return _m.inf
    except OverflowError: return _m.inf
    return _m.nan if isinstance(r, complex) else r


_EW = {"+": lambda a, b: a + b, "-": lambda a, b: a - b, "*": lambda a, b: a * b,
       "/": lambda a, b: 0 if abs(b) < 1e-12 else a / b, "%": lambda a, b: 0 if abs(b) < 1e-12 else _m.fmod(a, b), "^": _jspow}


def _jsnumber(x):
    """JavaScript Number(x) for the scalar kinds a scope holds."""
    if isinstance(x, bool): return 1 if x else 0
    if isinstance(x, (int, float)): return x
    if isinstance(x, str):
        t = x.strip()
        if t == "": return 0
        if t in ("Infinity", "+Infinity"): return _m.inf
        if t == "-Infinity": return -_m.inf
        if t.lower() in ("inf", "+inf", "-inf", "nan", "infinity") : return _m.nan
        try: return int(t, 16) if t.lower().startswith("0x") else float(t)
        except ValueError: return _m.nan
    return _m.nan


def _eq(a, b):
    """expr.ts eq(): identical → true; a matrix compares by JSON; otherwise both finite Numbers and equal."""
    if type(a) == type(b) and a == b and not _isM(a): return True
    if _isM(a) or _isM(b): return a == b
    na, nb = _jsnumber(a), _jsnumber(b)
    finite = lambda v: v == v and v not in (_m.inf, -_m.inf)
    return finite(na) and finite(nb) and na == nb


def _bin(op, a, b):
    if op == "@":
        A, B = _asM(a), _asM(b)
        if not _rect(A) or not _rect(B) or len(A[0]) != len(B): return []
        return [[round6(sum(A[i][t] * B[t][j] for t in range(len(B)))) for j in range(len(B[0]))] for i in range(len(A))]
    if (_isM(a) or _isM(b)) and op in _EW:
        r = _ew(_asM(a), _asM(b), _EW[op]); return r if r is not None else []
    x, y = _num(a), _num(b)
    if op == "*": return x * y
    if op == "/": return _jsdiv(x, y)
    if op == "%": return _jsmod(x, y)
    if op == "^": return _jspow(x, y)
    if op == "+": return x + y
    if op == "-": return x - y
    if op == "<": return x < y
    if op == "<=": return x <= y
    if op == ">": return x > y
    if op == ">=": return x >= y
    if op == "==": return _eq(a, b)
    if op == "!=": return not _eq(a, b)
    return 0


def _neg(v):
    return [[round6(-x) for x in r] for r in v] if _isM(v) and _rect(v) else ([] if _isM(v) else -_num(v))


# ── matrix kernels (matrixCore.ts) ──
def _shift(M, by, axis="rows"):
    n = len(M)
    if n == 0: return []
    b = int(_jsround(by)) if by == by else 0
    if axis == "cols":
        c = len(M[0]) if M[0] else 0
        if c == 0: return [list(r) for r in M]
        return [[row[((j - b) % c + c) % c] for j in range(len(row))] for row in M]
    return [list(M[((i - b) % n + n) % n]) for i in range(n)]


def _vecop(V, op):
    if not _rect(V): return []
    if op == "length": return [[round6(_m.hypot(*r))] for r in V]
    if op == "angle": return [[round6(_m.atan2(r[1] if len(r) > 1 else 0, r[0]) * 180 / _m.pi)] for r in V]
    if op == "perp": return [[round6(-(r[1] if len(r) > 1 else 0)), round6(r[0])] for r in V]
    if op == "perp-cw": return [[round6(r[1] if len(r) > 1 else 0), round6(-r[0])] for r in V]
    out = []
    for r in V:
        L = _m.hypot(*r)
        out.append([0 for _ in r] if L < 1e-12 else [round6(x / L) for x in r])
    return out


def _vecprod(A, B, op):
    s = _bshape(A, B)
    if not s: return []
    rows, cols = s
    def dot(i): return sum(_bc(A, i, j) * _bc(B, i, j) for j in range(cols))
    def c2(i): return _bc(A, i, 0) * _bc(B, i, 1) - _bc(A, i, 1) * _bc(B, i, 0)
    def c3(i): return [_bc(A, i, 1) * _bc(B, i, 2) - _bc(A, i, 2) * _bc(B, i, 1), _bc(A, i, 2) * _bc(B, i, 0) - _bc(A, i, 0) * _bc(B, i, 2),
                       _bc(A, i, 0) * _bc(B, i, 1) - _bc(A, i, 1) * _bc(B, i, 0)]
    R = []
    for i in range(rows):
        if op == "cross": R.append([round6(v) for v in c3(i)] if cols >= 3 else [round6(c2(i))])
        elif op == "angle":
            c = _m.hypot(*c3(i)) if cols >= 3 else c2(i)
            R.append([round6(_m.atan2(c, dot(i)) * 180 / _m.pi)])
        else: R.append([round6(dot(i))])
    return R


def _fold(xs, op):
    if op == "min": return min(xs, default=_m.inf)
    if op == "max": return max(xs, default=-_m.inf)
    if op == "mean": return sum(xs) / (len(xs) or 1)
    if op == "product":
        p = 1
        for x in xs: p *= x
        return p
    return sum(xs)


def _reduce(M, op, axis):
    if not _rect(M): return []
    if axis == "rows": return [[round6(_fold(r, op))] for r in M]
    if axis == "cols": return [[round6(_fold([r[j] for r in M], op)) for j in range(len(M[0]))]]
    return [[round6(_fold([x for r in M for x in r], op))]]


def _reduceFn(op):
    def f(a):
        axis = a[1] if len(a) > 1 and isinstance(a[1], str) else "all"
        R = _reduce(_asM(a[0]), op, axis)
        if axis == "all":
            try: return R[0][0]
            except IndexError: return 0
        return R
    return f


def _minmax(op):
    f = min if op == "min" else max
    def g(a):
        if len(a) > 1 and isinstance(a[1], str): return _reduceFn(op)(a)
        if len(a) == 1 and _isM(a[0]): return _reduceFn(op)(a)
        if len(a) == 2 and any(_isM(x) for x in a):
            r = _ew(_asM(a[0]), _asM(a[1]), lambda x, y: f(x, y)); return r if r is not None else []
        xs = [_num(x) for x in a]
        if not xs: return _m.inf if op == "min" else -_m.inf
        if any(x != x for x in xs): return _m.nan
        return f(xs)
    return g


def _cmp(f):
    def g(a):
        r = _ew(_asM(a[0]), _asM(a[1] if len(a) > 1 else 0), lambda x, y: 1 if f(x, y) else 0); return r if r is not None else []
    return g


def _fill(r, c, v):
    r = max(0, int(_jsround(r)) if r == r else 0); c = max(0, int(_jsround(c)) if c == c else 0)
    return [[v] * c for _ in range(r)]


def _arange(a):
    if len(a) > 1: lo, hi = int(_jsround(_num(a[0]))), int(_jsround(_num(a[1])))
    else: lo, hi = 0, int(_jsround(_num(a[0])))
    return [[i] for i in range(lo, hi)]


def _kron(A, B):
    if not _rect(A) or not _rect(B): return []
    ra, ca, rb, cb = len(A), len(A[0]), len(B), len(B[0])
    return [[round6(A[i // rb][j // cb] * B[i % rb][j % cb]) for j in range(ca * cb)] for i in range(ra * rb)]


def _sub(M, r0, c0, nr, nc):
    if not _rect(M): return []
    R = lambda x: max(0, int(_jsround(x)) if x == x else 0)
    a, b = R(r0), R(c0)
    return [row[b:b + R(nc)] for row in M[a:a + R(nr)]]


def _hcat2(A, B):
    if not _rect(A): return [list(r) for r in B] if _rect(B) else []
    if not _rect(B): return [list(r) for r in A]
    if len(A) != len(B): return None
    return [list(A[i]) + list(B[i]) for i in range(len(A))]


def _vcat2(A, B):
    if not _rect(A): return [list(r) for r in B] if _rect(B) else []
    if not _rect(B): return [list(r) for r in A]
    if len(A[0]) != len(B[0]): return None
    return [list(r) for r in A] + [list(r) for r in B]


def _foldcat(a, f):
    if not a: return []
    acc = _asM(a[0])
    for x in a[1:]:
        nxt = f(acc, _asM(x))
        if nxt is None: return []
        acc = nxt
    return acc


def _reshape(M, r, c):
    r = max(0, int(_jsround(r)) if r == r else 0); c = max(0, int(_jsround(c)) if c == c else 0)
    if r == 0 or c == 0: return []
    flat = [x for row in M for x in row]
    return [[flat[i * c + j] if i * c + j < len(flat) else 0 for j in range(c)] for i in range(r)]


def _compress(M, mask):
    if not _rect(M): return []
    def mv(i):
        try: return mask[0 if len(mask) == 1 else i][0]
        except (IndexError, TypeError): return 0
    return [list(r) for i, r in enumerate(M) if abs(mv(i)) > 1e-12]


def _sortby(M, key):
    if not _rect(M): return []
    def k(i):
        try: return key[0 if len(key) == 1 else i][0]
        except (IndexError, TypeError): return 0
    return [list(M[i]) for i in sorted(range(len(M)), key=lambda i: (k(i), i))]


def _sort(M, axis="rows"):
    if not _rect(M): return []
    if axis == "cols":
        cols = [sorted(r[j] for r in M) for j in range(len(M[0]))]
        return [[c[i] for c in cols] for i in range(len(M))]
    return [sorted(r) for r in M]


def _where(mask, A, B):
    s1, s2 = _bshape(mask, A), _bshape(A, B)
    if not s1 or not s2: return []
    rows, cols = max(s1[0], s2[0]), max(s1[1], s2[1])
    return [[round6(_bc(A, i, j) if _bc(mask, i, j) != 0 else _bc(B, i, j)) for j in range(cols)] for i in range(rows)]


def _T(M):
    cols = len(M[0]) if M and M[0] else 0
    return [[(M[i][j] if j < len(M[i]) else 0) for i in range(len(M))] for j in range(cols)]


def _diag(M):
    if not _rect(M): return []
    r, c = len(M), len(M[0])
    if r == 1 or c == 1:
        v = M[0] if r == 1 else [row[0] for row in M]
        return [[v[i] if i == j else 0 for j in range(len(v))] for i in range(len(v))]
    return [[row[i] if i < len(row) else 0] for i, row in enumerate(M)]


def _rings(M):
    if not _rect(M) or len(M) < 3: return []
    if len(M[0]) < 3: return [[[r[0], r[1]] for r in M]]
    out, cur, key = [], [], None
    for r in M:
        if key is not None and r[2] != key:
            if len(cur) >= 3: out.append(cur)
            cur = []
        key = r[2]; cur.append([r[0], r[1]])
    if len(cur) >= 3: out.append(cur)
    return out


def _inpoly(P, R):
    if not _rect(P): return []
    rings = _rings(R); out = []
    for p in P:
        x, y = p[0], p[1]; inside = False
        for ring in rings:
            j = len(ring) - 1
            for i in range(len(ring)):
                xi, yi, xj, yj = ring[i][0], ring[i][1], ring[j][0], ring[j][1]
                if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi: inside = not inside
                j = i
        out.append([1 if inside else 0])
    return out


# ── solids (meshBool.ts prism / lathe, axisMesh.ts) ──
def _sub3(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def _add3(a, b): return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
def _mul3(v, s): return [v[0] * s, v[1] * s, v[2] * s]
def _cross3(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def _dot3(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _basis(d):
    ax, ay, az = abs(d[0]), abs(d[1]), abs(d[2])
    seed = [1, 0, 0] if ax <= ay and ax <= az else ([0, 1, 0] if ay <= az else [0, 0, 1])
    raw = _cross3(d, seed); L = _m.hypot(*raw)
    e1 = _mul3(raw, 1 / L) if L > 1e-9 else [1, 0, 0]
    return e1, _cross3(d, e1)


def _prism(ring, z0, z1):
    if not _rect(ring) or len(ring) < 3: return []
    if len(ring[0]) >= 3:
        key = ring[0][2]; pts = []
        for r in ring:
            if r[2] != key: break
            pts.append([r[0], r[1]])
    else: pts = [[r[0], r[1]] for r in ring]
    if len(pts) < 3: return []
    a2 = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    if a2 < 0: pts = pts[::-1]
    lo, hi = min(z0, z1), max(z0, z1)
    if not (hi - lo > 1e-9): return []
    n = len(pts)
    rings = [[[p[0], p[1], lo] for p in pts][::-1], [[p[0], p[1], hi] for p in pts]]
    for i in range(n):
        j = (i + 1) % n
        rings.append([[pts[i][0], pts[i][1], lo], [pts[j][0], pts[j][1], lo], [pts[j][0], pts[j][1], hi], [pts[i][0], pts[i][1], hi]])
    return [[round6(v[0]), round6(v[1]), round6(v[2]), f] for f, rg in enumerate(rings) for v in rg]


def _lathe_faces(a, b, profile, sides=24):
    d = _sub3(b, a); L = _m.hypot(*d)
    if L < 1e-9 or len(profile) < 3: return []
    n = max(3, int(_jsround(sides))); u = _mul3(d, 1 / L); e1, e2 = _basis(u)
    P = [[p[0], max(0, p[1])] for p in profile if len(p) >= 2]
    if len(P) < 3: return []
    def at(t, r, k):
        th = 2 * _m.pi * k / n
        return _add3(_add3(a, _mul3(u, t)), _add3(_mul3(e1, r * _m.cos(th)), _mul3(e2, r * _m.sin(th))))
    faces = []
    for i in range(len(P)):
        j = (i + 1) % len(P); t0, r0 = P[i]; t1, r1 = P[j]
        if abs(t0 - t1) < 1e-12 and abs(r0 - r1) < 1e-12: continue
        x0, x1 = r0 < 1e-12, r1 < 1e-12
        if x0 and x1: continue
        for k in range(n):
            k2 = (k + 1) % n
            faces.append([at(t0, 0, 0), at(t1, r1, k), at(t1, r1, k2)] if x0 else
                         [at(t0, r0, k), at(t1, 0, 0), at(t0, r0, k2)] if x1 else
                         [at(t0, r0, k), at(t1, r1, k), at(t1, r1, k2), at(t0, r0, k2)])
    return faces


def _faces_to_matrix(faces):
    vol = 0; anytri = False
    for ring in faces:
        for i in range(1, len(ring) - 1):
            raw = _cross3(_sub3(ring[i], ring[0]), _sub3(ring[i + 1], ring[0]))
            if not (_m.hypot(*raw) > 1e-13): continue
            anytri = True; vol += _dot3(ring[0], _cross3(ring[i], ring[i + 1]))
    if not anytri: return []
    flip = vol < 0
    return [[round6(v[0]), round6(v[1]), round6(v[2]), f] for f, ring in enumerate(faces) for v in (ring[::-1] if flip else ring)]


def _lathe(seg, profile, sides):
    if not _rect(seg) or len(seg[0]) < 6 or not _rect(profile) or len(profile) < 3: return []
    s = seg[0]
    return _faces_to_matrix(_lathe_faces(s[0:3], s[3:6], [[p[0], p[1]] for p in profile], max(3, int(_jsround(sides)) or 24)))


def _loft_faces(secs):
    secs = [s for s in secs if len(s) >= 3]
    if len(secs) < 2: return []
    faces = [secs[0][::-1]]
    for i in range(len(secs) - 1):
        A, B = secs[i], secs[i + 1]; n = min(len(A), len(B))
        for k in range(n):
            j = (k + 1) % n; faces.append([A[k], A[j], B[j], B[k]])
    faces.append(secs[-1]); return faces


def _tube_faces(a, b, radius, sides=12):
    d = _sub3(b, a); L = _m.hypot(*d)
    if L < 1e-6: return []
    n = max(3, int(_jsround(sides))); r = max(1e-5, radius); u = _mul3(d, 1 / L); e1, e2 = _basis(u)
    ring = lambda o: [_add3(o, _add3(_mul3(e1, r * _m.cos(2 * _m.pi * k / n)), _mul3(e2, r * _m.sin(2 * _m.pi * k / n)))) for k in range(n)]
    A, B = ring(a), ring(b)
    faces = [A[::-1], B]
    for k in range(n):
        j = (k + 1) % n; faces.append([A[k], A[j], B[j], B[k]])
    return faces


def _ring_faces(a, b, ringR, tubeR, seg=20, sides=8):
    d = _sub3(b, a); L = _m.hypot(*d)
    if L < 1e-9: return []
    R, t = max(1e-4, ringR), max(1e-4, tubeR); u = _mul3(d, 1 / L); c = _mul3(_add3(a, b), 0.5); e1, e2 = _basis(u)
    grid = []
    for i in range(seg):
        phi = 2 * _m.pi * i / seg; rad = _add3(_mul3(e1, _m.cos(phi)), _mul3(e2, _m.sin(phi))); ce = _add3(c, _mul3(rad, R))
        grid.append([_add3(ce, _add3(_mul3(rad, t * _m.cos(2 * _m.pi * k / sides)), _mul3(u, t * _m.sin(2 * _m.pi * k / sides)))) for k in range(sides)])
    return [[grid[i][k], grid[i][(k + 1) % sides], grid[(i + 1) % seg][(k + 1) % sides], grid[(i + 1) % seg][k]] for i in range(seg) for k in range(sides)]


def _faces_from_matrix(M):
    if not _isM(M) or len(M) < 3: return []
    if len(M[0]) < 4: return [[[r[0], r[1], r[2]] for r in M if len(r) >= 3]]
    out, cur, key = [], [], None
    for r in M:
        if len(r) < 4: continue
        if key is not None and r[3] != key:
            if len(cur) >= 3: out.append(cur)
            cur = []
        key = r[3]; cur.append([r[0], r[1], r[2]])
    if len(cur) >= 3: out.append(cur)
    return out


def _sweep(profile, rail, closed=0):
    """meshBool.ts sweepMatrix: a 2D profile carried along a 3D rail with a minimum-twist frame."""
    if not _rect(profile) or len(profile) < 3 or not _rect(rail) or len(rail) < 2: return []
    prof = [[p[0], p[1]] for p in profile]
    path = [[p[0], p[1], p[2] if len(p) > 2 else 0] for p in rail]
    pts = [path[0]]
    for q in path[1:]:
        pp = pts[-1]
        if _m.hypot(q[0] - pp[0], q[1] - pp[1], q[2] - pp[2]) > 1e-9: pts.append(q)
    if closed and len(pts) > 2:
        a, b = pts[0], pts[-1]
        if _m.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 1e-9: pts.pop()
    if len(pts) < 2: return []
    def nrm(v):
        L = _m.hypot(v[0], v[1], v[2]) or 1
        return [v[0] / L, v[1] / L, v[2] / L]
    n = len(pts)
    tan = [nrm(_sub3(pts[min(n - 1, i + 1)], pts[max(0, i - 1)])) for i in range(n)]
    u = nrm(_cross3(tan[0], [0, 0, 1])) if abs(tan[0][2]) < 0.9 else nrm(_cross3(tan[0], [1, 0, 0]))
    sections = []
    for i in range(n):
        if i > 0:
            axis = _cross3(tan[i - 1], tan[i]); sinA = _m.hypot(*axis)
            if sinA > 1e-9:
                k = nrm(axis); ang = _m.atan2(sinA, _dot3(tan[i - 1], tan[i])); ca, sa = _m.cos(ang), _m.sin(ang)
                kxu = _cross3(k, u); kdu = _dot3(k, u)
                u = nrm([u[j] * ca + kxu[j] * sa + k[j] * kdu * (1 - ca) for j in range(3)])
        v = nrm(_cross3(tan[i], u)); o = pts[i]
        sections.append([[o[j] + u[j] * p[0] + v[j] * p[1] for j in range(3)] for p in prof])
    if closed: sections.append(sections[0])
    return _faces_to_matrix(_loft_faces(sections))


# ── curves (matrix/curves.ts) ──
def _ctrl(M, least=2):
    if not _rect(M) or len(M) < least: return None
    d = min(3, max(2, len(M[0])))
    return [[r[0], r[1]] if d == 2 else [r[0], r[1], r[2] if len(r) > 2 else 0] for r in M]


def _arclen(pts):
    P = _ctrl(pts, 1)
    if not P: return []
    out, acc = [[0]], 0
    for i in range(1, len(P)):
        a, b = P[i - 1], P[i]
        acc += _m.hypot(b[0] - a[0], b[1] - a[1], (b[2] if len(b) > 2 else 0) - (a[2] if len(a) > 2 else 0))
        out.append([round6(acc)])
    return out


def _resample(pts, n):
    P = _ctrl(pts, 2)
    if not P: return []
    count = max(2, min(4096, int(_jsround(n)) if n == n and n not in (_m.inf, -_m.inf) else 2) or 2)
    cum = [0]
    for i in range(1, len(P)):
        a, b = P[i - 1], P[i]
        cum.append(cum[i - 1] + _m.hypot(b[0] - a[0], b[1] - a[1], (b[2] if len(b) > 2 else 0) - (a[2] if len(a) > 2 else 0)))
    total = cum[-1]
    if total < 1e-12: return [[round6(v) for v in P[0]] for _ in range(count)]
    out, seg = [], 0
    for s in range(count):
        target = total * s / (count - 1)
        while seg < len(P) - 2 and cum[seg + 1] < target: seg += 1
        span = cum[seg + 1] - cum[seg]
        t = (target - cum[seg]) / span if span > 1e-12 else 0
        a, b = P[seg], P[seg + 1]
        out.append([round6(v + (b[i] - v) * t) for i, v in enumerate(a)])
    return out


def _unsupported(name):
    def f(a): raise _Unsupported(name)
    return f


_SCALAR = {"floor": _m.floor, "ceil": _m.ceil, "round": _jsround, "abs": abs, "sqrt": lambda x: _m.sqrt(x) if x >= 0 else _m.nan,
           "cos": _m.cos, "sin": _m.sin, "tan": _m.tan, "atan2": _m.atan2, "pow": _jspow,
           "sign": lambda x: _m.nan if x != x else (0 if x == 0 else (1 if x > 0 else -1)),
           "log": lambda x: _m.log(x) if x > 0 else 0, "log2": lambda x: _m.log2(x) if x > 0 else 0,
           "log10": lambda x: _m.log10(x) if x > 0 else 0, "exp": lambda x: _m.exp(x) if x < 709 else _m.inf}

_MATRIX = {
    "T": lambda a: _T(_asM(a[0])), "rows": lambda a: len(_asM(a[0])), "cols": lambda a: len(_asM(a[0])[0]) if _asM(a[0]) else 0,
    "shift": lambda a: _shift(_asM(a[0]), _num(a[1]) if len(a) > 1 else 0, a[2] if len(a) > 2 and isinstance(a[2], str) else "rows"),
    "normalize": lambda a: _vecop(_asM(a[0]), "normalize"), "perp": lambda a: _vecop(_asM(a[0]), "perp"),
    "perpcw": lambda a: _vecop(_asM(a[0]), "perp-cw"), "len": lambda a: _vecop(_asM(a[0]), "length"),
    "dot": lambda a: _vecprod(_asM(a[0]), _asM(a[1]), "dot"), "cross": lambda a: _vecprod(_asM(a[0]), _asM(a[1]), "cross"),
    "angle": lambda a: _vecprod(_asM(a[0]), _asM(a[1]), "angle") if len(a) >= 2 else _vecop(_asM(a[0]), "angle"),
    "sum": _reduceFn("sum"), "mean": _reduceFn("mean"), "prod": _reduceFn("product"), "min": _minmax("min"), "max": _minmax("max"),
    "eye": lambda a: [[1 if i == j else 0 for j in range(max(0, int(_jsround(_num(a[0])))))] for i in range(max(0, int(_jsround(_num(a[0])))))],
    "zeros": lambda a: _fill(_num(a[0]), _num(a[1]) if len(a) > 1 else 1, 0), "ones": lambda a: _fill(_num(a[0]), _num(a[1]) if len(a) > 1 else 1, 1),
    "fill": lambda a: _fill(_num(a[0]), _num(a[1]), _num(a[2])), "arange": _arange, "diag": lambda a: _diag(_asM(a[0])),
    "sort": lambda a: _sort(_asM(a[0]), a[1] if len(a) > 1 and isinstance(a[1], str) else "rows"),
    "sortby": lambda a: _sortby(_asM(a[0]), a[1] if _isM(a[1]) else _sub(_asM(a[0]), 0, _num(a[1]), len(_asM(a[0])), 1)),
    "compress": lambda a: _compress(_asM(a[0]), _asM(a[1])), "where": lambda a: _where(_asM(a[0]), _asM(a[1]), _asM(a[2])),
    "gt": _cmp(lambda x, y: x > y), "lt": _cmp(lambda x, y: x < y), "ge": _cmp(lambda x, y: x >= y), "le": _cmp(lambda x, y: x <= y),
    "eq": _cmp(lambda x, y: x == y), "ne": _cmp(lambda x, y: x != y),
    "sub": lambda a: _sub(_asM(a[0]), _num(a[1]), _num(a[2]), _num(a[3]), _num(a[4])),
    "row": lambda a: _sub(_asM(a[0]), _num(a[1]), 0, 1, len(_asM(a[0])[0]) if _asM(a[0]) else 0),
    "col": lambda a: _sub(_asM(a[0]), 0, _num(a[1]), len(_asM(a[0])), 1),
    "hcat": lambda a: _foldcat(a, _hcat2), "vcat": lambda a: _foldcat(a, _vcat2),
    "reshape": lambda a: _reshape(_asM(a[0]), _num(a[1]), _num(a[2])), "kron": lambda a: _kron(_asM(a[0]), _asM(a[1])),
    "inpoly": lambda a: _inpoly(_asM(a[0]), _asM(a[1])),
    "mprism": lambda a: _prism(_asM(a[0]), _num(a[1]), _num(a[2])),
    "mlathe": lambda a: _lathe(_asM(a[0]), _asM(a[1]), _num(a[2]) if len(a) > 2 else 24),
    "arclen": lambda a: _arclen(_asM(a[0])),
    "msweep": lambda a: _sweep(_asM(a[0]), _asM(a[1]), _num(a[2]) if len(a) > 2 else 0),
    "resample": lambda a: _resample(_asM(a[0]), _num(a[1]) if len(a) > 1 else 32),
}
_UNPORTED = ("inv", "solve", "subtract", "union", "intersect", "xor", "msubtract", "munion", "mintersect", "mcyl", "bezier", "bspline",
             "nurbs", "catenary", "geodesic")
for _n in _UNPORTED:
    _MATRIX[_n] = _unsupported(_n)


_ALGOS = {}      # lower-case qualified name → translated function (filled by the generated object)
_ALIASES = {}    # lower-case qualified builtin name → bare name (exprCatalog EXPR_ALIASES)
_DEPTH = [0]


def _call(name, args):
    if "." in name:
        alg = _ALGOS.get(name.lower())
        if alg is not None:
            if _DEPTH[0] >= 8: return 0
            _DEPTH[0] += 1
            try: return alg(args)
            finally: _DEPTH[0] -= 1
        name = _ALIASES.get(name.lower(), name)
    f = _MATRIX.get(name)
    if f: return f(args)
    sf = _SCALAR.get(name)
    if not sf: return 0
    if any(_isM(x) for x in args):
        if len(args) == 1: return [[round6(sf(x)) for x in r] for r in _asM(args[0])]
        if len(args) == 2:
            r = _ew(_asM(args[0]), _asM(args[1]), sf); return r if r is not None else []
    return sf(*[_num(x) for x in args])


def _var(sc, name): return sc[name] if name in sc else 0


def _lift(raw):
    if isinstance(raw, bool): return 1 if raw else 0
    if isinstance(raw, (int, float)): return raw
    if isinstance(raw, str):
        t = raw.strip()
        if t.startswith("["):
            import json as _j
            try:
                v = _j.loads(t)
                if isinstance(v, list) and all(isinstance(r, list) and all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in r) for r in v): return v
            except ValueError: pass
        return raw
    return 0


def _tris(faces, color, name, material=None):
    """Face list (polygons in plan-frame metres, +z up) → an object/2 mesh, fan-triangulated."""
    pos, idx = [], []
    for f in faces:
        if len(f) < 3: continue
        b = len(pos) // 3
        for p in f: pos += [float(p[0]), float(p[1]), float(p[2])]
        for i in range(1, len(f) - 1): idx += [b, b + i, b + i + 1]
    m = {"name": name, "color": color, "positions": pos, "indices": idx}
    if material: m["material"] = material
    return m
# ── end of Math Engine runtime ──
