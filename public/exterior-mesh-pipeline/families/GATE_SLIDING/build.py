"""GATE_SLIDING — main estate gate in a wall gap from a to b: two gate pillars with moulded caps and
lantern, a single sliding leaf (60×60 frame, mid rail, 20 mm bars at 120 with spear finials),
ground track extended one leaf-width beyond a (the parked side), and two V-groove wheels."""
import math
from core.geom import MB, empty_root, part

def build(p, geo, name, coll):
    root = empty_root(name, coll)
    a, b = geo["a"], geo["b"]; L = math.dist(a, b); d = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
    h, pw = p["height"], p["pillar"]; ph = h + 0.6
    M = {k: MB() for k in ("Pillars", "PillarCaps", "Lantern", "Leaf", "Bars", "Track", "Wheels")}
    for c in ((a[0] - d[0] * pw / 2, a[1] - d[1] * pw / 2), (b[0] + d[0] * pw / 2, b[1] + d[1] * pw / 2)):
        M["Pillars"].ocbox(c, d, pw, pw, -0.3, ph)
        M["Pillars"].ocbox(c, d, pw + 0.08, pw + 0.08, -0.3, 0.45)                                   # plinth course
        M["PillarCaps"].ocbox(c, d, pw + 0.14, pw + 0.14, ph, ph + 0.08)
        M["PillarCaps"].ocbox(c, d, pw + 0.14, pw + 0.14, ph + 0.08, ph + 0.14, pw + 0.04, pw + 0.04)
        M["PillarCaps"].ocbox(c, d, pw + 0.04, pw + 0.04, ph + 0.14, ph + 0.2)
        M["Lantern"].cyl(c[0], c[1], ph + 0.2, 0.08, 0.07, 12)
        M["Lantern"].tube([(c[0], c[1], ph + 0.28), (c[0], c[1], ph + 0.5)], [0.11, 0.11], 8)
        M["Lantern"].tube([(c[0], c[1], ph + 0.5), (c[0], c[1], ph + 0.62)], [0.14, 0.01], 8)
    g = 0.03; s0, s1 = g, L - g; F = M["Leaf"]
    F.obox(a, b, s0, s1, -0.03, 0.03, 0.08, 0.14); F.obox(a, b, s0, s1, -0.03, 0.03, h - 0.06, h)
    F.obox(a, b, s0, s1, -0.025, 0.025, 1.0, 1.05)
    F.obox(a, b, s0, s0 + 0.06, -0.03, 0.03, 0.08, h); F.obox(a, b, s1 - 0.06, s1, -0.03, 0.03, 0.08, h)
    n = int((s1 - s0 - 0.12) / 0.12)
    for k in range(n):
        s = s0 + 0.06 + (s1 - s0 - 0.12) * (k + 0.5) / n
        M["Bars"].obox(a, b, s - 0.01, s + 0.01, -0.01, 0.01, 0.14, h + 0.1)
        M["Bars"].opyramid((a[0] + d[0] * s, a[1] + d[1] * s), d, 0.04, 0.04, h + 0.1, 0.09)
    M["Track"].obox(a, b, -L - pw, L + 0.1, -0.02, 0.02, 0.0, 0.03)
    for s in (s0 + 0.3, s1 - 0.3):
        c = (a[0] + d[0] * s, a[1] + d[1] * s); nx, ny = -d[1], d[0]
        M["Wheels"].tube([(c[0] - nx * 0.025, c[1] - ny * 0.025, 0.07), (c[0] + nx * 0.025, c[1] + ny * 0.025, 0.07)], 0.06, 16)
    for k, mb in M.items(): part(root, coll, k, mb)
    return root
