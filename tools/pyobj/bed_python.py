"""Bed (Python mesh generator) — platform base, mattress, draped duvet with folded-back sheet cuff, 3 rows of pillows.

Contract (shared by Blender and the editor's Pyodide runtime):
    PARAMS                      list of {key,label,kind,default,min,max,step,unit,options}
    build(params: dict) -> {
        "meshes": [{"name", "color", "material", "positions": [x,y,z,...], "indices": [i,j,k,...]}],
        "plan":   [[[x,y], ...], ...]   # closed outlines for the 2D symbol
    }
Units metres. Frame: origin = centre of the bed footprint on the floor, +x across the width, +y from the HEAD
(against the wall, y = -L/2) to the FOOT, +z up. Pure Python (no numpy) so Pyodide runs it without packages.
"""
import math

PARAMS = [
    {"key": "length", "label": "Mattress length", "kind": "number", "default": 2.0, "min": 1.8, "max": 2.4, "step": 0.01, "unit": "m"},
    {"key": "width", "label": "Mattress width", "kind": "number", "default": 1.8, "min": 0.9, "max": 2.2, "step": 0.01, "unit": "m"},
    {"key": "baseHeight", "label": "Platform height", "kind": "number", "default": 0.24, "min": 0.1, "max": 0.5, "step": 0.01, "unit": "m"},
    {"key": "baseOversail", "label": "Platform oversail", "kind": "number", "default": 0.1, "min": 0.0, "max": 0.3, "step": 0.01, "unit": "m"},
    {"key": "baseEdgeRadius", "label": "Platform edge radius", "kind": "number", "default": 0.018, "min": 0.0, "max": 0.08, "step": 0.002, "unit": "m"},
    {"key": "mattressThk", "label": "Mattress thickness", "kind": "number", "default": 0.2, "min": 0.1, "max": 0.35, "step": 0.01, "unit": "m"},
    {"key": "mattressRadius", "label": "Mattress edge radius", "kind": "number", "default": 0.05, "min": 0.01, "max": 0.1, "step": 0.005, "unit": "m"},
    {"key": "duvetStart", "label": "Duvet starts from head", "kind": "number", "default": 0.62, "min": 0.2, "max": 1.2, "step": 0.01, "unit": "m"},
    {"key": "duvetThk", "label": "Duvet thickness", "kind": "number", "default": 0.035, "min": 0.01, "max": 0.08, "step": 0.005, "unit": "m"},
    {"key": "duvetDrop", "label": "Duvet overhang", "kind": "number", "default": 0.29, "min": 0.05, "max": 0.6, "step": 0.01, "unit": "m"},
    {"key": "drapeFlare", "label": "Hem flare", "kind": "number", "default": 0.3, "min": 0.0, "max": 1.0, "step": 0.05},
    {"key": "folds", "label": "Fold depth", "kind": "number", "default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1},
    {"key": "wrinkles", "label": "Surface wrinkles", "kind": "number", "default": 1.0, "min": 0.0, "max": 2.0, "step": 0.1},
    {"key": "cuffDepth", "label": "Sheet cuff depth", "kind": "number", "default": 0.14, "min": 0.0, "max": 0.4, "step": 0.01, "unit": "m"},
    {"key": "backPillows", "label": "Back pillows", "kind": "number", "default": 2, "min": 0, "max": 3, "step": 1},
    {"key": "middlePillows", "label": "Middle pillows", "kind": "number", "default": 2, "min": 0, "max": 3, "step": 1},
    {"key": "frontPillows", "label": "Front pillows", "kind": "number", "default": 2, "min": 0, "max": 3, "step": 1},
    {"key": "pillowPlump", "label": "Pillow plumpness", "kind": "number", "default": 1.0, "min": 0.5, "max": 1.6, "step": 0.05},
    {"key": "seed", "label": "Fold seed", "kind": "number", "default": 7, "min": 0, "max": 99, "step": 1},
    {"key": "headboardStyle", "label": "Headboard", "kind": "select", "default": "Channelled", "options": ["Channelled", "Panel", "None"]},
    {"key": "headboardHeight", "label": "Headboard height", "kind": "number", "default": 1.05, "min": 0.6, "max": 1.6, "step": 0.01, "unit": "m"},
    {"key": "headboardThk", "label": "Headboard thickness", "kind": "number", "default": 0.09, "min": 0.04, "max": 0.2, "step": 0.005, "unit": "m"},
    {"key": "headboardOverhang", "label": "Headboard overhang", "kind": "number", "default": 0.06, "min": 0.0, "max": 0.3, "step": 0.01, "unit": "m"},
    {"key": "hbChannels", "label": "Headboard channels", "kind": "number", "default": 8, "min": 3, "max": 16, "step": 1},
    {"key": "plinth", "label": "Recessed plinth", "kind": "checkbox", "default": True},
    {"key": "runner", "label": "Runner", "kind": "checkbox", "default": True},
    {"key": "runnerWidth", "label": "Runner width", "kind": "number", "default": 0.62, "min": 0.2, "max": 1.0, "step": 0.01, "unit": "m"},
    {"key": "runnerFromFoot", "label": "Runner from foot", "kind": "number", "default": 0.28, "min": 0.0, "max": 1.0, "step": 0.01, "unit": "m"},
    {"key": "platformColor", "label": "Platform colour", "kind": "color", "default": "#b3a595"},
    {"key": "plinthColor", "label": "Plinth colour", "kind": "color", "default": "#9c8f80"},
    {"key": "headboardColor", "label": "Headboard colour", "kind": "color", "default": "#b3a595"},
    {"key": "mattressColor", "label": "Mattress colour", "kind": "color", "default": "#faf8f4"},
    {"key": "duvetColor", "label": "Duvet colour", "kind": "color", "default": "#f3f0ea"},
    {"key": "sheetColor", "label": "Sheet / cuff colour", "kind": "color", "default": "#ffffff"},
    {"key": "pillowColor", "label": "Pillow colour", "kind": "color", "default": "#f7f4ee"},
    {"key": "cushionColor", "label": "Cushion colour", "kind": "color", "default": "#c2622f"},
    {"key": "runnerColor", "label": "Runner colour", "kind": "color", "default": "#4a4744"},
    {"key": "detail", "label": "Mesh detail", "kind": "select", "default": "Fine", "options": ["Draft", "Fine", "Ultra"]},
]

DEFAULTS = {p["key"]: p["default"] for p in PARAMS}


# ── small mesh toolkit ──────────────────────────────────────────────────────────────────────────────────────
class Mesh:
    def __init__(self, name, color, material):
        self.name, self.color, self.material = name, color, material
        self.v = []  # [(x,y,z)]
        self.f = []  # [(a,b,c)]

    def grid(self, rows, close_u=False, flip=False):
        """rows: list of rows, each a list of (x,y,z). Quads between consecutive rows/columns → 2 triangles."""
        base = len(self.v)
        nr, nc = len(rows), len(rows[0])
        for r in rows:
            self.v.extend(r)
        cols = nc if close_u else nc - 1
        for i in range(nr - 1):
            for j in range(cols):
                j2 = (j + 1) % nc
                a, b = base + i * nc + j, base + i * nc + j2
                c, d = base + (i + 1) * nc + j2, base + (i + 1) * nc + j
                if flip:
                    self.f += [(a, c, b), (a, d, c)]
                else:
                    self.f += [(a, b, c), (a, c, d)]
        return base

    def poly(self, pts, flip=False):
        base = len(self.v)
        self.v.extend(pts)
        for k in range(1, len(pts) - 1):
            self.f.append((base, base + k + 1, base + k) if flip else (base, base + k, base + k + 1))

    def out(self):
        # flat lists, no rounding: they become Float32/Uint32 arrays on the other side anyway
        pos = [c for p in self.v for c in p]
        idx = [i for f in self.f for i in f]
        return {"name": self.name, "color": self.color, "material": self.material, "positions": pos, "indices": idx}


def smooth_noise(seed):
    """Deterministic smooth 2D noise: a sum of a few rotated sines with seeded phases (fast, no tables)."""
    rnd = _lcg(seed)
    waves = []
    for k in range(6):
        ang = rnd() * math.pi
        freq = 2.0 + 9.0 * rnd()
        waves.append((math.cos(ang) * freq, math.sin(ang) * freq, rnd() * 6.283, 1.0 / (1 + k * 0.6)))
    tot = sum(w[3] for w in waves)
    # Unrolled (no generator per call): this is evaluated ~400k times per bed, and in Pyodide the per-call
    # overhead of a generator expression dominated the build.
    (a0, b0, p0, w0), (a1, b1, p1, w1), (a2, b2, p2, w2), (a3, b3, p3, w3), (a4, b4, p4, w4), (a5, b5, p5, w5) =         [(fx, fy, ph, a / tot) for fx, fy, ph, a in waves]
    sin = math.sin

    def n(x, y):
        return (w0 * sin(a0 * x + b0 * y + p0) + w1 * sin(a1 * x + b1 * y + p1) + w2 * sin(a2 * x + b2 * y + p2)
                + w3 * sin(a3 * x + b3 * y + p3) + w4 * sin(a4 * x + b4 * y + p4) + w5 * sin(a5 * x + b5 * y + p5))
    return n


def _lcg(seed):
    st = [int(seed) * 7919 + 12345]

    def r():
        st[0] = (st[0] * 1103515245 + 12345) % 2147483648
        return st[0] / 2147483648.0
    return r


def rounded_box(m, cx, cy, z0, sx, sy, sz, r, seg):
    """Box [cx±sx/2, cy±sy/2, z0..z0+sz] with every edge rounded by r: a UV sphere of radius r whose octants are
    pushed out to the box corners (duplicated rings at the octant seams become the flat faces)."""
    r = max(1e-4, min(r, sx / 2 - 1e-4, sy / 2 - 1e-4, sz / 2 - 1e-4))
    hx, hy, hz = sx / 2 - r, sy / 2 - r, sz / 2 - r
    zc = z0 + sz / 2
    phis = [(-math.pi / 2 + (math.pi / 2) * i / seg, -1) for i in range(seg + 1)] + \
           [((math.pi / 2) * i / seg, 1) for i in range(seg + 1)]
    rows = []
    for phi, sz_ in phis:
        row = []
        for q in range(4):
            for j in range(seg + 1):
                th = (q + j / seg) * math.pi / 2
                ox = hx if math.cos(th) > 1e-9 or (abs(math.cos(th)) <= 1e-9 and q in (0, 3)) else -hx
                oy = hy if math.sin(th) > 1e-9 or (abs(math.sin(th)) <= 1e-9 and q in (0, 1)) else -hy
                # quadrant decides the corner, robustly
                ox = hx if q in (0, 3) else -hx
                oy = hy if q in (0, 1) else -hy
                x = cx + ox + r * math.cos(phi) * math.cos(th)
                y = cy + oy + r * math.cos(phi) * math.sin(th)
                z = zc + sz_ * hz + r * math.sin(phi)
                row.append((x, y, z))
        rows.append(row)
    m.grid(rows, close_u=True)
    # flat caps (the pole rings collapse to the 4 corners)
    bot = [(cx + hx, cy + hy, z0), (cx - hx, cy + hy, z0), (cx - hx, cy - hy, z0), (cx + hx, cy - hy, z0)]
    top = [(x, y, z0 + sz) for x, y, _ in bot]
    m.poly(bot, flip=True)
    m.poly(top)


# ── components ─────────────────────────────────────────────────────────────────────────────────────────────
def build(params=None):
    P = dict(DEFAULTS)
    P.update({k: v for k, v in (params or {}).items() if k in DEFAULTS})
    num = lambda k: float(P[k])
    L, W = num("length"), num("width")
    bh, ov, br = num("baseHeight"), num("baseOversail"), num("baseEdgeRadius")
    mt, mr = num("mattressThk"), num("mattressRadius")
    detail = {"Draft": 0.55, "Fine": 1.0, "Ultra": 1.7}.get(str(P["detail"]), 1.0)
    seed = int(num("seed"))
    head_y, foot_y = -L / 2, L / 2
    col = lambda k: str(P[k])
    flag = lambda k: P[k] in (True, "true", "True", 1, "1")

    meshes = []

    # Platform: flush with the mattress at the head (against the wall), oversailing the sides and the foot.
    base = Mesh("Platform", col("platformColor"), "Fabric/boucle.json")
    bseg = max(2, int(4 * detail))
    ph = min(0.06, bh * 0.3) if flag("plinth") else 0.0
    rounded_box(base, 0.0, ov / 2, ph, W + 2 * ov, L + ov, bh - ph, br, bseg)
    meshes.append(base)
    if ph > 0:
        # recessed plinth: a darker shadow-gap base the platform floats on
        pl = Mesh("Plinth", col("plinthColor"), "Finishes/light-oak.json")
        rounded_box(pl, 0.0, ov / 2, 0.0, W + 2 * ov - 0.09, L + ov - 0.09, ph + 0.002, 0.004, 2)
        meshes.append(pl)

    # Mattress (with fitted sheet) sitting on the platform.
    mat = Mesh("Mattress", col("mattressColor"), "Fabric/cotton-sateen.json")
    rounded_box(mat, 0.0, 0.0, bh, W, L, mt, mr, max(3, int(6 * detail)))
    meshes.append(mat)
    ztop = bh + mt

    # Duvet + cuff share one drape mapping: (X, Y) on the unfolded fabric → 3D point.
    duvet_top = ztop + num("duvetThk")
    drop = num("duvetDrop")
    flare = num("drapeFlare")
    folds = num("folds")
    wrink = num("wrinkles")
    noise = smooth_noise(seed)
    noise2 = smooth_noise(seed + 31)
    puff = num("duvetThk") * 0.9
    rr0 = mr * 1.15  # the cloth rolls over the mattress edge radius

    def drape(X, Y, zsurf, hang, off=0.0):
        """Map unfolded fabric coords to 3D. Inside the mattress outline the fabric lies flat at zsurf; past an
        edge it rolls over a radius, hangs, flares at the hem, folds (more at the corners) and pools on the
        platform if it is long enough to reach it. `off` lays a second layer `off` above the base cloth: it rolls
        round the SAME centre with a radius `off` larger, so it stays clear on the sides too, not only on top."""
        zsurf += off
        rr = rr0 + off
        ex = max(-W / 2, min(W / 2, X))
        ey = min(foot_y, Y)
        dx = abs(X) - W / 2 if abs(X) > W / 2 else 0.0
        dy = Y - foot_y if Y > foot_y else 0.0
        d = math.hypot(dx, dy)
        if d <= 1e-9:
            # flat top: soft wrinkles, fading toward the cuff and edges
            # a duvet billows: thicker in the middle, settling toward the edges (and toward its head fold)
            edge = min(W / 2 - abs(X), foot_y - Y, max(0.0, Y - (head_y + num("duvetStart"))) + 0.05)
            billow = puff * (1 - math.exp(-max(0.0, edge) / 0.16))
            near_foot = math.exp(-max(0.0, foot_y - Y) / 0.55)
            diag = 0.0
            for sx_ in (-1.0, 1.0):
                cx_, cy_ = sx_ * W / 2, foot_y
                rx, ry = X - cx_, Y - cy_
                ang = math.atan2(ry, -sx_ * rx)          # radial angle from the corner, into the bed
                dist = math.hypot(rx, ry)
                diag += math.exp(-dist / 0.45) * (0.5 + 0.5 * math.sin(ang * 9.0 + seed * 0.7)) ** 3
            z = zsurf + billow + wrink * 0.010 * noise(X * 0.8, Y * 0.8) + wrink * 0.004 * noise2(X * 3.1, Y * 2.7)                 + folds * 0.012 * diag + wrink * 0.006 * near_foot * noise2(X * 5.0, Y * 1.5)
            return (X, Y, z)
        ux, uy = (math.copysign(dx, X) / d, dy / d)
        # corner factor: 0 on a straight side, 1 at 45° on a corner
        cf = math.sin(2 * math.atan2(dy, dx)) ** 2 if dx > 0 and dy > 0 else 0.0
        a = min(d, rr * math.pi / 2)
        h = rr * math.sin(a / rr)
        v = rr * (1 - math.cos(a / rr))
        s = d - a
        if s > 0:
            t = min(1.0, s / max(1e-6, hang))
            fl = 0.08 + flare * 0.45 * t * t
            h += s * math.sin(fl)
            v += s * math.cos(fl)
        # folds: vertical pleats along each side, deepening toward the hem; extra cascade at the corners
        along = (ey if dx > 0 else ex)
        hem_t = min(1.0, s / 0.12 if s > 0 else 0.0)
        pleat = folds * (0.010 + 0.016 * cf) * hem_t * (
            math.sin(along * 9.0 + seed) + 0.6 * math.sin(along * 17.0 + 2 * seed) + 1.0 * cf * math.sin(math.atan2(dy, dx + 1e-9) * 9.0))
        # the corner's spare fabric also drops a little lower and swings outward (the cascade)
        h += folds * 0.018 * cf * hem_t
        h += pleat
        z = zsurf - v
        # pool on the platform: whatever would go below its top spreads outward instead
        zfloor = bh + 0.004
        if z < zfloor:
            extra = zfloor - z
            z = zfloor + 0.004 * abs(noise(X * 2, Y * 2))
            h += extra * 0.3 * (0.4 + 0.5 * cf)  # mostly folds under; the corners pool a little outward
        px = ex + ux * h
        py = ey + uy * h
        # sides drape only where there is fabric (head end of the side is cut straight by the domain)
        return (px, py, z)

    def fabric_rows(Y0, Y1, zsurf, hang, nx, ny, xpad):
        rows = []
        for i in range(ny + 1):
            Y = Y0 + (Y1 - Y0) * i / ny
            row = []
            for j in range(nx + 1):
                X = -W / 2 - xpad + (W + 2 * xpad) * j / nx
                row.append(drape(X, Y, zsurf, hang))
            rows.append(row)
        return rows

    def solidify(m, rows, thk, hem_taper=0.35):
        """Top surface rows + an offset underside (along local normals, thinning toward the hem) + edge walls."""
        nr, nc = len(rows), len(rows[0])
        # The grid is ordered (rows along Y, columns along X), so cross(tu, tv) has ONE consistent sense over the
        # whole sheet. Pick its sign once from the middle (flat, facing up) — flipping per vertex on the hanging
        # sides, where nz ~ 0, is what punched knots into the hem.
        mi, mj = nr // 2, nc // 2
        def raw_n(i, j):
            a_ = rows[i][min(nc - 1, j + 1)]; b_ = rows[i][max(0, j - 1)]
            c_ = rows[min(nr - 1, i + 1)][j]; d_ = rows[max(0, i - 1)][j]
            tu = (a_[0] - b_[0], a_[1] - b_[1], a_[2] - b_[2]); tv = (c_[0] - d_[0], c_[1] - d_[1], c_[2] - d_[2])
            return (tu[1] * tv[2] - tu[2] * tv[1], tu[2] * tv[0] - tu[0] * tv[2], tu[0] * tv[1] - tu[1] * tv[0])
        sense = 1.0 if raw_n(mi, mj)[2] >= 0 else -1.0
        under = []
        for i in range(nr):
            urow = []
            for j in range(nc):
                p = rows[i][j]
                nx_, ny_, nz_ = (sense * c for c in raw_n(i, j))
                ln = math.sqrt(nx_ * nx_ + ny_ * ny_ + nz_ * nz_) or 1.0
                edge = min(j, nc - 1 - j, nr - 1 - i) / max(1, min(nc, nr) * 0.08)
                k = thk * (hem_taper + (1 - hem_taper) * min(1.0, edge))
                urow.append((p[0] - nx_ / ln * k, p[1] - ny_ / ln * k, p[2] - nz_ / ln * k))
            under.append(urow)
        m.grid(rows)
        m.grid(under, flip=True)
        # stitch the four borders
        def wall(seq_top, seq_bot, flip):
            m.grid([seq_top, seq_bot], flip=flip)
        wall(rows[0], under[0], True)
        wall(rows[-1], under[-1], False)
        wall([r[0] for r in rows], [r[0] for r in under], False)
        wall([r[-1] for r in rows], [r[-1] for r in under], True)

    # Duvet: from duvetStart (measured from the head) to past the foot, wide enough to hang both sides.
    y0 = head_y + num("duvetStart")
    hang = drop
    nx = int(150 * detail)
    ny = int(120 * detail)
    duvet = Mesh("Duvet", col("duvetColor"), "Fabric/cotton.json")
    rows = fabric_rows(y0, foot_y + drop, duvet_top, hang, nx, ny, drop)
    # round the head edge of the duvet (its fold-back thickness) by lifting the first rows slightly
    solidify(duvet, rows, num("duvetThk"))
    meshes.append(duvet)

    # Cuff: the top sheet folded back over the duvet's head edge — a band on top with a rolled fold and a seam.
    cd = num("cuffDepth")
    if cd > 0.005:
        cuff = Mesh("Sheet cuff", col("sheetColor"), "Fabric/cotton.json")
        zc = duvet_top + 0.006
        cny = max(6, int(14 * detail))
        crows = []
        for i in range(cny + 1):
            t = i / cny
            Y = y0 - 0.02 + (cd + 0.02) * t
            row = []
            for j in range(nx + 1):
                X = -W / 2 - drop * 0.55 + (W + drop * 1.1) * j / nx
                x, y, z = drape(X, Y, zc, hang * 0.55)
                # rolled fold at the head edge, seam ridge a third of the way in
                if t < 0.18:
                    z += 0.010 * math.sin(t / 0.18 * math.pi / 2)
                seam = math.exp(-((t - 0.62) / 0.05) ** 2)
                z += 0.0035 * seam
                row.append((x, y, z))
            crows.append(row)
        solidify(cuff, crows, 0.006, hem_taper=0.6)
        meshes.append(cuff)
        # piping line along the cuff seam (a thin tube)
        pipe = Mesh("Cuff piping", col("duvetColor"), "Fabric/cotton.json")
        ring_n = 8
        Ys = y0 - 0.02 + (cd + 0.02) * 0.62
        line = [drape(-W / 2 - drop * 0.55 + (W + drop * 1.1) * j / nx, Ys, zc + 0.0045, hang * 0.55) for j in range(nx + 1)]
        tube_rows = []
        for (x, y, z) in line:
            tube_rows.append([(x, y + 0.004 * math.cos(2 * math.pi * k / ring_n), z + 0.004 * math.sin(2 * math.pi * k / ring_n)) for k in range(ring_n)])
        # columns = along the line, rows = around the tube
        around = [[tube_rows[j][k] for j in range(len(tube_rows))] for k in range(ring_n)]
        pipe.grid(around + [around[0]])
        meshes.append(pipe)

    # Runner: a wool band across the foot, lying on the duvet (so it follows the billow) and draping both sides.
    if flag("runner"):
        rw, rf = num("runnerWidth"), num("runnerFromFoot")
        run = Mesh("Runner", col("runnerColor"), "Fabric/wool.json")
        rny = max(8, int(24 * detail))
        rpad = drop * 0.8
        rrows = []
        for i in range(rny + 1):
            Y = foot_y - rf - rw + rw * i / rny
            row = []
            for j in range(nx + 1):
                X = -W / 2 - rpad + (W + 2 * rpad) * j / nx
                row.append(drape(X, Y, duvet_top, hang, off=0.02))
            rrows.append(row)
        solidify(run, rrows, 0.016, hem_taper=0.7)
        meshes.append(run)

    # Pillows: three rows leaning against the headboard (or the wall when there is none).
    plump = num("pillowPlump")

    def pillow(m, cx, cy, cz, a, b, thk, lean_deg, yaw_deg, sd):
        """a×b pillow (a across), thickness thk, rotated about x by lean (0 = lying flat, 90 = upright),
        corners pinched into ears, puffy profile, soft creases."""
        nu, nv = int(34 * detail), int(26 * detail)
        nz = smooth_noise(sd)
        lean = math.radians(lean_deg)
        yaw = math.radians(yaw_deg)
        top, bot = [], []
        for i in range(nv + 1):
            v = -1 + 2 * i / nv
            rt, rb = [], []
            for j in range(nu + 1):
                u = -1 + 2 * j / nu
                # outline with slightly concave sides (ears at the corners)
                x = a / 2 * u * (1 - 0.07 * (1 - v * v))
                y = b / 2 * v * (1 - 0.08 * (1 - u * u))
                fu = max(0.0, 1 - abs(u) ** 2.2) ** 0.6
                fv = max(0.0, 1 - abs(v) ** 2.2) ** 0.6
                h = thk / 2 * fu * fv * plump
                crease = 0.10 * thk * nz(u * 1.3, v * 1.3) * fu * fv
                dent = -0.12 * thk * math.exp(-((u * 1.1) ** 2 + (v * 1.4) ** 2)) * fu
                for sgn, dst in ((1, rt), (-1, rb)):
                    lz = sgn * (h + crease * 0.5) + (dent if sgn > 0 else 0)
                    # local (x, y, lz) → lean about x (y toward the foot, rising up the wall)
                    yy = y * math.cos(lean) - lz * math.sin(lean)
                    zz = y * math.sin(lean) + lz * math.cos(lean)
                    xx = x * math.cos(yaw) - yy * math.sin(yaw)
                    yy2 = x * math.sin(yaw) + yy * math.cos(yaw)
                    dst.append((cx + xx, cy + yy2, cz + zz))
            top.append(rt)
            bot.append(rb)
        m.grid(top)
        m.grid(bot, flip=True)

    pil = Mesh("Pillows", col("pillowColor"), "Fabric/linen.json")
    cush = Mesh("Cushions", col("cushionColor"), "Fabric/velvet.json")
    zbed = ztop
    rows_spec = [
        # count, a, b, thk, lean(deg from flat), y offset from head, centre height above mattress, spacing, yaw jitter
        (int(num("backPillows")), 0.74, 0.52, 0.17, 72, 0.13, 0.245, 0.80, 3),
        (int(num("middlePillows")), 0.50, 0.33, 0.12, 64, 0.30, 0.165, 0.54, -4),
        (int(num("frontPillows")), 0.74, 0.50, 0.16, 38, 0.48, 0.125, 0.80, 2),
    ]
    for r_i, (cnt, a, b, thk, lean, dy, hz, gap, yaw) in enumerate(rows_spec):
        if cnt <= 0:
            continue
        xs = [(-(cnt - 1) / 2 + k) * gap for k in range(cnt)]
        for k, x in enumerate(xs):
            pillow(cush if r_i == 1 else pil, x, head_y + dy, zbed + hz, a, b, thk, lean + (k - (cnt - 1) / 2) * 3, yaw * (1 if k % 2 else -1), seed + 10 * r_i + k)
    meshes.append(pil)
    if cush.v:
        meshes.append(cush)

    # Headboard: behind the head (y < -L/2), on the floor. A thin backer, plus either padded vertical CHANNELS
    # (each a bulging strip with rounded ends, separated by a stitched gap) or one padded PANEL.
    style = str(P["headboardStyle"])
    hb_h, hb_t, hb_o = num("headboardHeight"), num("headboardThk"), num("headboardOverhang")
    hb_w = W + 2 * ov + 2 * hb_o
    if style != "None":
        hb = Mesh("Headboard", col("headboardColor"), "Fabric/boucle.json")
        back_t = hb_t * 0.35
        y_back = head_y - hb_t
        rounded_box(hb, 0.0, y_back + back_t / 2, 0.0, hb_w, back_t, hb_h, 0.012, 3)
        y_face = y_back + back_t                       # padding grows from here toward the bed (+y)
        pad = hb_t - back_t
        z0, z1 = ph + 0.02, hb_h - 0.015
        n = max(1, int(num("hbChannels"))) if style == "Channelled" else 1
        gap = 0.006 if n > 1 else 0.0
        cw = (hb_w - 0.02) / n
        nu, nv = (max(6, int(10 * detail)), max(12, int(36 * detail))) if n > 1 else (max(16, int(40 * detail)), max(12, int(30 * detail)))
        hbn = smooth_noise(seed + 77)
        for i in range(n):
            xa = -hb_w / 2 + 0.01 + i * cw + gap / 2
            xb = xa + cw - gap
            front, rear = [], []
            for jv in range(nv + 1):
                v = jv / nv
                fr, rr_ = [], []
                for ju in range(nu + 1):
                    u = -1 + 2 * ju / nu
                    x = (xa + xb) / 2 + u * (xb - xa) / 2
                    # rounded top and bottom of each channel
                    endv = min(1.0, (v / 0.05) ** 0.5, ((1 - v) / 0.05) ** 0.5) if 0 < v < 1 else 0.0
                    bulge = pad * max(0.0, 1 - abs(u) ** 2.4) ** 0.5 * endv
                    if n == 1:  # one panel: softer, wider crown and a little surface give
                        bulge = pad * max(0.0, 1 - abs(u) ** 6) ** 0.4 * endv * (1 + 0.04 * hbn(u * 2, v * 3))
                    z = z0 + (z1 - z0) * v - 0.012 * (u * u) * (1 if v > 0.97 else 0)
                    fr.append((x, y_face + bulge, z))
                    rr_.append((x, y_face, z))
                front.append(fr)
                rear.append(rr_)
            hb.grid(front, flip=True)
            hb.grid(rear)
        meshes.append(hb)

    # 2D plan symbol: platform outline, mattress outline, duvet head edge, pillow footprints.
    plan = [
        [[-W / 2 - ov, head_y], [W / 2 + ov, head_y], [W / 2 + ov, foot_y + ov], [-W / 2 - ov, foot_y + ov]],
        [[-W / 2, head_y], [W / 2, head_y], [W / 2, foot_y], [-W / 2, foot_y]],
        [[-W / 2, y0], [W / 2, y0]],
    ]
    if style != "None":
        plan.append([[-hb_w / 2, head_y - hb_t], [hb_w / 2, head_y - hb_t], [hb_w / 2, head_y], [-hb_w / 2, head_y]])
    for cnt, a, b, thk, lean, dy, hz, gap, yaw in rows_spec:
        for k in range(max(0, cnt)):
            x = (-(cnt - 1) / 2 + k) * gap
            depth = b * math.cos(math.radians(lean)) + thk * math.sin(math.radians(lean))
            plan.append([[x - a / 2, head_y + dy - depth / 2], [x + a / 2, head_y + dy - depth / 2],
                         [x + a / 2, head_y + dy + depth / 2], [x - a / 2, head_y + dy + depth / 2]])
    return {"meshes": [m.out() for m in meshes], "plan": plan,
            "stats": {"vertices": sum(len(m.v) for m in meshes), "triangles": sum(len(m.f) for m in meshes)}}


if __name__ == "__main__":
    import json, sys, time
    t = time.time()
    r = build({})
    print(json.dumps(r["stats"]), f"{time.time() - t:.2f}s", file=sys.stderr)
