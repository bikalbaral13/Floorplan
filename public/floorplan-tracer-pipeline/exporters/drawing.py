"""Human-readable proof: plan.json → SVG drawing (per level) and, for traced drawings, an overlay PNG of the
model on its source image. Wall bands at real thickness, openings as gaps (door leaf + arc on the hinge /
swing side, window glass lines, dotted vacant openings), spaces with name + clear size + area, columns,
stairs (footprint + flight split + UP arrow), fixtures as footprints with a heavy line on their back side.
"""
import math
from xml.sax.saxutils import escape
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from core import units as U, model as M

def _bounds(L):
    pts = [p for w in L["walls"] for p in (w["a"], w["b"])] + [p for s in L["spaces"] for p in s["ring"]] + [p for o in L["openings"] for p in (o["a"], o["b"])]
    if not pts: return 0, 0, 1, 1
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return min(xs), min(ys), max(xs), max(ys)

def svg(L, title="", px_per_m=60, pad=1.2):
    x0, y0, x1, y1 = _bounds(L); x0 -= pad; y0 -= pad; x1 += pad; y1 += pad
    k = px_per_m; W, H = (x1 - x0) * k, (y1 - y0) * k + 40
    X = lambda x: round((x - x0) * k, 2); Y = lambda y: round((y1 - y) * k + 30, 2)
    o = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W:.0f}" height="{H:.0f}" viewBox="0 0 {W:.0f} {H:.0f}" font-family="Arial, Helvetica, sans-serif">',
         '<rect width="100%" height="100%" fill="#ffffff"/>', f'<text x="10" y="20" font-size="14" font-weight="bold">{escape(title)}</text>']
    for s in L["spaces"]:
        fill = {"toilet": "#dbeafe", "balcony": "#dcfce7", "area": "#f1f5f9"}.get(s["type"], "#f8fafc")
        o.append('<polygon fill="%s" stroke="none" points="%s"/>' % (fill, " ".join(f"{X(p[0])},{Y(p[1])}" for p in s["ring"])))
    def band(a, b, t, fill="#1e293b"):
        ux, uy, _ = M.unit(a, b); nx, ny = -uy * t / 2, ux * t / 2
        pts = [(a[0] + nx, a[1] + ny), (b[0] + nx, b[1] + ny), (b[0] - nx, b[1] - ny), (a[0] - nx, a[1] - ny)]
        o.append('<polygon fill="%s" points="%s"/>' % (fill, " ".join(f"{X(x)},{Y(y)}" for x, y in pts)))
    for w in L["walls"]: band(w["a"], w["b"], w["t"], "#1e293b" if w["kind"] == "wall" else "#94a3b8")
    for op in L["openings"]:
        a, b = op["a"], op["b"]; ux, uy, Lw = M.unit(a, b); nx, ny = -uy, ux
        if op["kind"] == "door":
            h = a if op["hinge"] == "a" else b; far = b if op["hinge"] == "a" else a
            sgn = 1 if op["swing"] == "L" else -1; R = Lw / (2 if op["leaves"] >= 2 else 1)
            hinges = [(h, far)] if op["leaves"] < 2 else [(a, b), (b, a)]
            for hh, ff in hinges:
                vx, vy, _ = M.unit(hh, ff); tip = (hh[0] + nx * sgn * R, hh[1] + ny * sgn * R); end = (hh[0] + vx * R, hh[1] + vy * R)
                o.append(f'<line x1="{X(hh[0])}" y1="{Y(hh[1])}" x2="{X(tip[0])}" y2="{Y(tip[1])}" stroke="#b91c1c" stroke-width="2"/>')
                sweep = 1 if (vx * ny * sgn - vy * nx * sgn) > 0 else 0
                o.append(f'<path d="M {X(tip[0])} {Y(tip[1])} A {R*k:.1f} {R*k:.1f} 0 0 {sweep} {X(end[0])} {Y(end[1])}" fill="none" stroke="#b91c1c" stroke-width="1" stroke-dasharray="3 2"/>')
        elif op["kind"] in ("window", "sliding"):
            for f in (-0.25, 0.0, 0.25):
                d = op["t"] * f
                o.append(f'<line x1="{X(a[0]+nx*d)}" y1="{Y(a[1]+ny*d)}" x2="{X(b[0]+nx*d)}" y2="{Y(b[1]+ny*d)}" stroke="#0e7490" stroke-width="1.5"/>')
            for p in (a, b): o.append(f'<line x1="{X(p[0]+nx*op["t"]/2)}" y1="{Y(p[1]+ny*op["t"]/2)}" x2="{X(p[0]-nx*op["t"]/2)}" y2="{Y(p[1]-ny*op["t"]/2)}" stroke="#0e7490" stroke-width="1.5"/>')
        elif op["kind"] == "gate":
            o.append(f'<line x1="{X(a[0])}" y1="{Y(a[1])}" x2="{X(b[0])}" y2="{Y(b[1])}" stroke="#7c2d12" stroke-width="3" stroke-dasharray="2 4"/>')
        else:
            o.append(f'<line x1="{X(a[0])}" y1="{Y(a[1])}" x2="{X(b[0])}" y2="{Y(b[1])}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="2 3"/>')
    for c in L["columns"]:
        sx, sy = c["size"]; o.append(f'<rect x="{X(c["c"][0]-sx/2)}" y="{Y(c["c"][1]+sy/2)}" width="{sx*k:.1f}" height="{sy*k:.1f}" fill="#4c1d95"/>')
    for st in L["stairs"]:
        fx0, fy0, fx1, fy1 = st["footprint"]
        o.append(f'<rect x="{X(fx0)}" y="{Y(fy1)}" width="{(fx1-fx0)*k:.1f}" height="{(fy1-fy0)*k:.1f}" fill="#fff7ed" stroke="#7c2d12" stroke-width="1.5"/>')
        n = max(2, math.ceil(st["risers"] / (2 if st["config"] == "dogleg" else 1)))
        vertical = st["toe"] in ("N", "S")
        for i in range(1, n):
            if vertical:
                yy = fy0 + (fy1 - fy0 - (st["landing"] if st["config"] == "dogleg" else 0)) * i / n if st["toe"] == "S" else fy1 - (fy1 - fy0 - (st["landing"] if st["config"] == "dogleg" else 0)) * i / n
                o.append(f'<line x1="{X(fx0)}" y1="{Y(yy)}" x2="{X(fx1)}" y2="{Y(yy)}" stroke="#7c2d12" stroke-width="0.6"/>')
            else:
                xx = fx0 + (fx1 - fx0 - (st["landing"] if st["config"] == "dogleg" else 0)) * i / n if st["toe"] == "W" else fx1 - (fx1 - fx0 - (st["landing"] if st["config"] == "dogleg" else 0)) * i / n
                o.append(f'<line x1="{X(xx)}" y1="{Y(fy0)}" x2="{X(xx)}" y2="{Y(fy1)}" stroke="#7c2d12" stroke-width="0.6"/>')
        if st["config"] == "dogleg":
            if vertical: o.append(f'<line x1="{X((fx0+fx1)/2)}" y1="{Y(fy0)}" x2="{X((fx0+fx1)/2)}" y2="{Y(fy1)}" stroke="#7c2d12" stroke-width="1.2"/>')
            else: o.append(f'<line x1="{X(fx0)}" y1="{Y((fy0+fy1)/2)}" x2="{X(fx1)}" y2="{Y((fy0+fy1)/2)}" stroke="#7c2d12" stroke-width="1.2"/>')
        o.append(f'<text x="{X((fx0+fx1)/2)}" y="{Y((fy0+fy1)/2)}" font-size="10" text-anchor="middle" fill="#7c2d12">UP ({st["risers"]})</text>')
    for fx in L["fixtures"]:
        a, l = fx["size"]; th = math.radians(fx["rot"]); ca, sa = math.cos(th), math.sin(th); c = fx["c"]
        loc = [(-a / 2, -l / 2), (a / 2, -l / 2), (a / 2, l / 2), (-a / 2, l / 2)]
        pts = [(c[0] + x * ca - y * sa, c[1] + x * sa + y * ca) for x, y in loc]
        o.append('<polygon fill="#fdf4ff" stroke="#a21caf" stroke-width="1" points="%s"/>' % " ".join(f"{X(x)},{Y(y)}" for x, y in pts))
        if fx.get("back"): o.append(f'<line x1="{X(pts[0][0])}" y1="{Y(pts[0][1])}" x2="{X(pts[1][0])}" y2="{Y(pts[1][1])}" stroke="#a21caf" stroke-width="3"/>')
        o.append(f'<text x="{X(c[0])}" y="{Y(c[1])+3}" font-size="8" text-anchor="middle" fill="#86198f">{escape(fx["kind"])}</text>')
    for s in L["spaces"]:
        from shapely.geometry import Polygon
        p = Polygon(s["ring"]).representative_point()
        o.append(f'<text x="{X(p.x)}" y="{Y(p.y)-6}" font-size="11" font-weight="bold" text-anchor="middle">{escape(s["name"])}</text>')
        sub = (f'{U.ftin(s["clear"][0])} × {U.ftin(s["clear"][1])}' if s.get("clear") else "") + f'  {U.sqft(s["net_area"]):.0f} sq ft'
        o.append(f'<text x="{X(p.x)}" y="{Y(p.y)+8}" font-size="9" text-anchor="middle" fill="#334155">{escape(sub)}</text>')
    o.append("</svg>")
    return "\n".join(o)

def overlay_png(L, image_path, frame, out_path, scale=2):
    """Model drawn over its source image (traced drawings): red wall bands, orange doors, blue windows, green rings."""
    from PIL import Image, ImageDraw
    im = Image.open(image_path).convert("RGB"); im = im.resize((im.width * scale, im.height * scale))
    d = ImageDraw.Draw(im, "RGBA"); ppm, (ox, oy) = frame["px_per_m"], frame["origin_px"]
    P = lambda p: ((p[0] * ppm + ox) * scale, (-p[1] * ppm + oy) * scale)
    def band(a, b, t, col):
        ux, uy, _ = M.unit(a, b); nx, ny = -uy * t / 2, ux * t / 2
        d.polygon([P((a[0] + nx, a[1] + ny)), P((b[0] + nx, b[1] + ny)), P((b[0] - nx, b[1] - ny)), P((a[0] - nx, a[1] - ny))], fill=col)
    for w in L["walls"]: band(w["a"], w["b"], w["t"], (220, 30, 30, 110))
    for op in L["openings"]:
        band(op["a"], op["b"], op["t"], {"door": (255, 140, 0, 150), "window": (30, 120, 255, 150), "sliding": (30, 120, 255, 150)}.get(op["kind"], (120, 120, 120, 120)))
    for s in L["spaces"]: d.line([P(p) for p in s["ring"]] + [P(s["ring"][0])], fill=(0, 160, 0, 255), width=2 * scale)
    for fx in L["fixtures"]:
        c = P(fx["c"]); d.ellipse([c[0] - 4 * scale, c[1] - 4 * scale, c[0] + 4 * scale, c[1] + 4 * scale], fill=(200, 0, 200, 220))
    im.save(out_path); return out_path
