"""BUILDING — exterior envelope of one design from adapter geometry (see family.json → geometry).

LOD2 (detailed): plinth + stone band, exterior walls split exactly around openings (true reveals),
floor slabs with a projecting edge band, roof slabs with screed, parapets with weathered copings,
balcony / terrace parapets with steel railings; windows with set-back frames, mullions, transoms,
glass, precast sills with drip grooves and RCC sunshades (chajja); doors with frames, panelled
leaves, hardware, sunshade and entrance steps where the door opens off the plinth.
LOD1 (massing): plinth, one prism per level, slab bands, roofs, plain parapets, flush glass cards.
All parts are separate child objects (material assignment later); local frame = design (0, 0),
plinth bottom at -0.10 (sinks into the ground), finished floor at plinth_h.
"""
import math
from core.geom import MB, empty_root, part

SLAB = 0.15

def _o(w):
    return w["out"] if w["out"] else 1

def _outer_profile(o, t, prof):
    """Profile given in (q, z) — q measured outward from the wall's outer face — → (u, z) left offsets."""
    return [(o * (t / 2 + q), z) for q, z in prof]

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    lod = int(p["lod"]); zf = geo["plinth_h"]
    M = {k: MB() for k in ("Plinth", "Walls", "Slabs", "Roof", "Screed", "Parapet", "Coping", "Rail", "WinFrame", "Glass", "Sill", "Chajja",
                           "DoorFrame", "DoorLeaf", "Hardware", "Steps")}
    for pg in geo["plinth"]:
        M["Plinth"].prism_holes(pg[0], pg[1], -0.10, zf - 0.08)
    for pg in geo.get("plinth_band", geo["plinth"]):
        M["Plinth"].prism_holes(pg[0], pg[1], zf - 0.08, zf)
    for lv in geo["levels"]:
        e = zf + lv["e"]; h = lv["h"]
        for pg in lv.get("floor", []):
            M["Slabs"].prism_holes(pg[0], pg[1], e - SLAB, e)
        for pg in lv.get("roof", []):
            M["Roof"].prism_holes(pg[0], pg[1], e + h - SLAB, e + h)
        if lod >= 2:
            for pg in lv.get("roof_screed", []):
                M["Screed"].prism_holes(pg[0], pg[1], e + h, e + h + 0.05)
        if lod >= 2:
            for w in lv["walls"]: _wall_lod2(M, w, e, h)
        else:
            for pg in lv.get("mass", []):
                M["Walls"].prism_holes(pg[0], pg[1], e, e + h - SLAB)
            for w in lv["walls"]: _cards_lod1(M, w, e)
        for pa in lv.get("parapets", []):
            base = e + h if pa["kind"] == "roof" else e
            _parapet(M, pa, base, lod)
    for k, mb in M.items():
        ob = part(root, coll, k, mb)
        if ob is not None and k == "Glass": ob["open_mesh_ok"] = False
    return root

# ---------------------------------------------------------------------------------------- walls --
def _wall_lod2(M, w, e, h):
    a, b, t = w["a"], w["b"], w["t"]; mb = M["Walls"]
    A, d, n, L = mb.frame(a, b)
    if L < 0.05: return
    low = w["h"] < h - 0.25                                  # a low wall (parapet-like) ends at its own height
    z0 = e; z1 = e + (w["h"] if low else h - SLAB)
    t0, t1 = -w["ea"], L + w["eb"]
    ops = sorted([o for o in w["open"] if _valid(o, z1 - z0)], key=lambda o: o["c"])
    cur = t0
    for op in ops:
        s0, s1 = op["c"] - op["w"] / 2, op["c"] + op["w"] / 2
        s0, s1 = max(s0, t0 + 0.02), min(s1, t1 - 0.02)
        if s1 - s0 < 0.2: continue
        if s0 > cur + 1e-4: mb.obox(a, b, cur, s0, -t / 2, t / 2, z0, z1)
        sill = op["sill"] if op["kind"] == "window" else 0.0
        head = min(op["head"], z1 - z0 - 0.05)
        if sill > 0.01: mb.obox(a, b, s0, s1, -t / 2, t / 2, z0, z0 + sill)
        mb.obox(a, b, s0, s1, -t / 2, t / 2, z0 + head, z1)
        if op["kind"] == "window": _window(M, w, op, s0, s1, z0 + sill, z0 + head)
        elif op["kind"] == "door": _door(M, w, op, s0, s1, z0, z0 + head)
        cur = s1
    if t1 > cur + 1e-4: mb.obox(a, b, cur, t1, -t / 2, t / 2, z0, z1)
    if low:                                                   # coping on a low wall
        cp = [(-t / 2 - 0.03, 0), (t / 2 + 0.03, 0), (t / 2 + 0.03, 0.04), (0, 0.065), (-t / 2 - 0.03, 0.04)]
        M["Coping"].sweep([tuple(A + d * t0) + (z1,), tuple(A + d * t1) + (z1,)], cp)

def _window(M, w, op, s0, s1, zs, zh):
    a, b, t = w["a"], w["b"], w["t"]; o = _o(w)
    fw, fd, setb = 0.06, 0.07, 0.05                         # frame face, depth, set-back from the outer face
    q0, q1 = -(setb + fd), -setb                             # frame depth band (outward coordinate)
    u = lambda q: o * (t / 2 + q)
    S0, S1 = sorted((u(q0), u(q1)))
    F = M["WinFrame"]
    F.obox(a, b, s0, s0 + fw, S0, S1, zs, zh); F.obox(a, b, s1 - fw, s1, S0, S1, zs, zh)
    F.obox(a, b, s0 + fw, s1 - fw, S0, S1, zh - fw, zh); F.obox(a, b, s0 + fw, s1 - fw, S0, S1, zs, zs + fw)
    panes = max(1, int(op.get("panes", 2)))
    inner = (s1 - s0 - 2 * fw); mw = 0.05
    for k in range(1, panes):
        c = s0 + fw + inner * k / panes
        F.obox(a, b, c - mw / 2, c + mw / 2, S0, S1, zs + fw, zh - fw)
    zt = None
    if zh - zs > 1.7:                                         # transom with a top-hung ventilator band
        zt = zh - 0.45; F.obox(a, b, s0 + fw, s1 - fw, S0, S1, zt - mw / 2, zt + mw / 2)
    # sash frames (thin, 25 mm proud of the glass plane) per pane
    qs = (q0 + q1) / 2; G0, G1 = sorted((u(qs - 0.004), u(qs + 0.004)))
    M["Glass"].obox(a, b, s0 + fw, s1 - fw, G0, G1, zs + fw, zh - fw)
    # precast sill with weathered top and drip groove
    if zs - (w.get("_z0") or 0) >= 0:
        prof = [(-0.13, -0.04), (0.015, -0.04), (0.015, -0.03), (0.025, -0.03), (0.025, -0.04), (0.05, -0.04), (0.05, -0.014), (-0.13, 0.0)]
        A, d, n, L = M["Sill"].frame(a, b)
        M["Sill"].sweep([tuple(A + d * (s0 - 0.05)) + (zs,), tuple(A + d * (s1 + 0.05)) + (zs,)], _outer_profile(o, t, prof))
    _chajja(M, w, s0, s1, zh)

def _chajja(M, w, s0, s1, zh):
    if w["out"] == 0: return
    a, b, t = w["a"], w["b"], w["t"]; o = w["out"]
    prof = [(-0.05, 0.0), (0.39, 0.0), (0.39, 0.012), (0.41, 0.012), (0.41, 0.0), (0.45, 0.0), (0.45, 0.06), (-0.05, 0.10)]
    A, d, n, L = M["Chajja"].frame(a, b); z = zh + 0.15
    M["Chajja"].sweep([tuple(A + d * (s0 - 0.15)) + (z,), tuple(A + d * (s1 + 0.15)) + (z,)], _outer_profile(o, t, prof))

def _door(M, w, op, s0, s1, zb, zh):
    a, b, t = w["a"], w["b"], w["t"]; o = _o(w)
    fw, fd, setb = 0.10, 0.075, 0.05
    u = lambda q: o * (t / 2 + q)
    S0, S1 = sorted((u(-(setb + fd)), u(-setb)))
    F = M["DoorFrame"]
    F.obox(a, b, s0, s0 + fw, S0, S1, zb, zh); F.obox(a, b, s1 - fw, s1, S0, S1, zb, zh); F.obox(a, b, s0 + fw, s1 - fw, S0, S1, zh - fw, zh)
    leaves = 2 if str(op.get("leaves", "")).lower().startswith("double") else 1
    lt = 0.04; qc = -(setb + fd / 2); L0, L1 = sorted((u(qc - lt / 2), u(qc + lt / 2)))
    span0, span1 = s0 + fw + 0.003, s1 - fw - 0.003; lw = (span1 - span0 - 0.003 * (leaves - 1)) / leaves
    zl0, zl1 = zb + 0.008, zh - fw - 0.003
    pr = 0.008                                                     # raised panel projection
    P0, P1 = sorted((u(qc + lt / 2), u(qc + lt / 2 + pr)))
    for k in range(leaves):
        x0 = span0 + k * (lw + 0.003); x1 = x0 + lw
        M["DoorLeaf"].obox(a, b, x0, x1, L0, L1, zl0, zl1)
        mx = 0.09; cols = 1 if lw < 0.6 else 2; rows = 3
        pw = (lw - mx * (cols + 1)) / cols; ph = (zl1 - zl0 - mx * (rows + 1)) / rows
        for c in range(cols):
            for r in range(rows):
                px = x0 + mx + c * (pw + mx); pz = zl0 + mx + r * (ph + mx)
                M["DoorLeaf"].obox(a, b, px, px + pw, P0, P1, pz, pz + ph)
        hx = x1 - 0.07 if (k == 0 and leaves == 1) or k == 0 else x0 + 0.07
        H0, H1 = sorted((u(qc + lt / 2), u(qc + lt / 2 + 0.012)))
        M["Hardware"].obox(a, b, hx - 0.025, hx + 0.025, H0, H1, zb + 0.95, zb + 1.13)            # rose plate
        A, d, n, L = M["Hardware"].frame(a, b)
        hq = u(qc + lt / 2 + 0.06); base = A + d * hx
        M["Hardware"].tube([tuple(base + n * u(qc + lt / 2 + 0.012)) + (zb + 1.05,), tuple(base + n * hq) + (zb + 1.05,),
                            tuple(base + n * hq + d * (-0.11 if hx > (s0 + s1) / 2 else 0.11)) + (zb + 1.05,)], 0.009, 8)
    _chajja(M, w, s0, s1, zh)
    if op.get("steps") and w["out"] != 0:
        ox = w["out"]; zf = zb
        n_st = max(1, int(round(zf / 0.15)) - 1) if zf > 0.2 else 0
        for k in range(1, n_st + 1):
            q0, q1 = 0.06, 0.06 + 0.30 * k
            U0, U1 = sorted((ox * (t / 2 + q0), ox * (t / 2 + q1)))
            M["Steps"].obox(a, b, s0 - 0.30, s1 + 0.30, U0, U1, -0.10, zf - 0.15 * k)

def _valid(op, wall_h):
    """An opening needs >= 0.3 m between sill and head inside the wall (low walls clamp heads below sills)."""
    sill = op["sill"] if op["kind"] == "window" else 0.0
    return min(op["head"], wall_h - 0.05) - sill >= 0.3 and op["w"] >= 0.2

def _cards_lod1(M, w, e):
    a, b, t = w["a"], w["b"], w["t"]; o = _o(w)
    for op in w["open"]:
        if not _valid(op, w["h"] - SLAB): continue
        s0, s1 = op["c"] - op["w"] / 2, op["c"] + op["w"] / 2
        zs = e + (op["sill"] if op["kind"] == "window" else 0.0); zh = e + op["head"]
        S0, S1 = sorted((o * (t / 2 + 0.002), o * (t / 2 + 0.02)))
        M["Glass" if op["kind"] == "window" else "DoorLeaf"].obox(a, b, s0, s1, S0, S1, zs, zh)

# ------------------------------------------------------------------------------------- parapets --
def _parapet(M, pa, base, lod):
    line = pa["line"]
    if len(line) < 2: return
    pt = 0.115 if pa["kind"] == "roof" else 0.15
    closed = len(line) > 3 and math.dist(line[0], line[-1]) < 1e-4
    if closed: line = line[:-1]
    path = [(x, y, base) for x, y in line]
    if pa["kind"] == "balcony" and lod >= 2:
        hs = 0.6                                                    # solid upstand + steel railing to 1.05
        M["Parapet"].sweep(path, [(0, 0), (pt, 0), (pt, hs - 0.04), (0, hs - 0.04)], closed=closed)
        M["Coping"].sweep([(x, y, base + hs - 0.04) for x, y in line], [(-0.03, 0), (pt + 0.03, 0), (pt + 0.03, 0.03), (pt / 2, 0.045), (-0.03, 0.03)], closed=closed)
        _railing(M["Rail"], line + ([line[0]] if closed else []), base + hs + 0.005, pa["h"] - hs - 0.005, pt / 2)
        return
    hb = pa["h"] - (0.06 if lod >= 2 else 0.0)
    M["Parapet"].sweep(path, [(0, 0), (pt, 0), (pt, hb), (0, hb)], closed=closed)
    if lod >= 2:
        M["Coping"].sweep([(x, y, base + hb) for x, y in line], [(-0.035, 0), (pt + 0.035, 0), (pt + 0.035, 0.04), (pt / 2, 0.06), (-0.035, 0.04)], closed=closed)

def _railing(mb, line, z0, h, u):
    """Steel railing on a polyline: 40×40 top rail, 30×10 bottom rail, 16 mm square balusters @120."""
    off = lambda q: [(q, 0)]
    pts = []
    for i in range(len(line) - 1):
        (ax, ay), (bx, by) = line[i], line[i + 1]
        L = math.dist(line[i], line[i + 1])
        if L < 1e-6: continue
        dx, dy = (bx - ax) / L, (by - ay) / L; nx, ny = -dy, dx
        cx, cy = ax + nx * u, ay + ny * u
        k = 0.06
        while k < L - 0.03:
            px, py = cx + dx * k, cy + dy * k
            mb.obox((px - dx * 0.008, py - dy * 0.008), (px + dx * 0.008, py + dy * 0.008), 0, 0.016, -0.008, 0.008, z0 + 0.04, z0 + h - 0.04)
            k += 0.12
    mb.sweep([(x, y, z0 + h - 0.04) for x, y in line], [(u - 0.02, 0), (u + 0.02, 0), (u + 0.02, 0.04), (u - 0.02, 0.04)])
    mb.sweep([(x, y, z0) for x, y in line], [(u - 0.015, 0), (u + 0.015, 0), (u + 0.015, 0.04), (u - 0.015, 0.04)])
