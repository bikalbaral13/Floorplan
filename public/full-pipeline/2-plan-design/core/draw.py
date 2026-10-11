"""One drawing, two outputs. Record primitives in sheet pixels, then write SVG (apps) and PNG (deck).

Only Pillow is needed for PNG; the SVG writer is plain text. Fonts: DejaVu / Arial if present, else Pillow's default.
"""
import math, os
from xml.sax.saxutils import escape

INK = "#1E2421"; MUTED = "#6B7470"; FAINT = "#C9CFCC"; ROOM = "#F3F4F2"; GLASS = "#DCE9EE"; OBJ = "#E9E4DB"

def _font_path(bold=False):
    cands = (["DejaVuSans-Bold.ttf", "arialbd.ttf", "Arial Bold.ttf"] if bold else ["DejaVuSans.ttf", "arial.ttf", "Arial.ttf"])
    dirs = ["/usr/share/fonts/truetype/dejavu", "/usr/share/fonts/dejavu", "C:/Windows/Fonts", "/Library/Fonts", "/System/Library/Fonts/Supplemental"]
    for d in dirs:
        for c in cands:
            p = os.path.join(d, c)
            if os.path.exists(p): return p
    return None

class Sheet:
    def __init__(self, w, h, bg="#FFFFFF"):
        self.w, self.h, self.bg = int(w), int(h), bg; self.ops = []
    # primitives -------------------------------------------------------------
    def poly(self, pts, fill=None, stroke=INK, width=1.0, dash=None, close=True):
        self.ops.append(("poly", [tuple(map(float, p)) for p in pts], fill, stroke, width, dash, close))
    def line(self, a, b, stroke=INK, width=1.0, dash=None): self.poly([a, b], None, stroke, width, dash, False)
    def rect(self, x0, y0, x1, y1, **k): self.poly([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], **k)
    def circle(self, c, r, fill=None, stroke=INK, width=1.0, dash=None):
        self.ops.append(("circle", (float(c[0]), float(c[1])), float(r), fill, stroke, width, dash))
    def arc(self, c, r, a0, a1, stroke=INK, width=1.0, dash=None, steps=24):
        pts = [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / steps)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / steps))) for i in range(steps + 1)]
        self.poly(pts, None, stroke, width, dash, False)
    def text(self, x, y, s, size=12, fill=INK, anchor="start", bold=False, rotate=0):
        self.ops.append(("text", float(x), float(y), str(s), float(size), fill, anchor, bold, rotate))
    # writers ----------------------------------------------------------------
    def svg(self):
        out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" height="{self.h}" font-family="Archivo, DejaVu Sans, Arial, sans-serif">',
               f'<rect width="{self.w}" height="{self.h}" fill="{self.bg}"/>']
        for op in self.ops:
            if op[0] == "poly":
                _, pts, fill, stroke, width, dash, close = op
                d = " ".join(f"{x:.1f},{y:.1f}" for x, y in pts)
                tag = "polygon" if close else "polyline"
                da = f' stroke-dasharray="{dash}"' if dash else ""
                out.append(f'<{tag} points="{d}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width}"{da} stroke-linejoin="round" stroke-linecap="round"/>')
            elif op[0] == "circle":
                _, c, r, fill, stroke, width, dash = op
                da = f' stroke-dasharray="{dash}"' if dash else ""
                out.append(f'<circle cx="{c[0]:.1f}" cy="{c[1]:.1f}" r="{r:.1f}" fill="{fill or "none"}" stroke="{stroke or "none"}" stroke-width="{width}"{da}/>')
            else:
                _, x, y, s, size, fill, anchor, bold, rot = op
                tr = f' transform="rotate({rot} {x:.1f} {y:.1f})"' if rot else ""
                fw = ' font-weight="700"' if bold else ""
                out.append(f'<text x="{x:.1f}" y="{y:.1f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}"{fw}{tr}>{escape(s)}</text>')
        out.append("</svg>")
        return "\n".join(out)

    def png(self, path, scale=1.0, ss=2):
        from PIL import Image, ImageDraw, ImageFont
        k = scale * ss; W, H = int(self.w * k), int(self.h * k)
        im = Image.new("RGB", (W, H), self.bg); dr = ImageDraw.Draw(im)
        fonts = {}
        def font(size, bold):
            key = (round(size * k), bold)
            if key not in fonts:
                fp = _font_path(bold)
                fonts[key] = ImageFont.truetype(fp, key[0]) if fp else ImageFont.load_default()
            return fonts[key]
        def P(p): return (p[0] * k, p[1] * k)
        def dashed(pts, color, w, dash):
            on, off = [float(v) * k for v in str(dash).replace(",", " ").split()[:2]]
            for i in range(len(pts) - 1):
                (x1, y1), (x2, y2) = P(pts[i]), P(pts[i + 1]); L = math.hypot(x2 - x1, y2 - y1); t = 0
                while t < L:
                    t2 = min(L, t + on); dr.line([(x1 + (x2 - x1) * t / L, y1 + (y2 - y1) * t / L), (x1 + (x2 - x1) * t2 / L, y1 + (y2 - y1) * t2 / L)], fill=color, width=max(1, int(w)))
                    t = t2 + off
        for op in self.ops:
            if op[0] == "poly":
                _, pts, fill, stroke, width, dash, close = op
                if fill and close and len(pts) > 2: dr.polygon([P(p) for p in pts], fill=fill)
                if stroke and width > 0:
                    seq = pts + [pts[0]] if close else pts
                    if dash: dashed(seq, stroke, width * k, dash)
                    else: dr.line([P(p) for p in seq], fill=stroke, width=max(1, int(round(width * k))), joint="curve")
            elif op[0] == "circle":
                _, c, r, fill, stroke, width, dash = op
                box = [c[0] * k - r * k, c[1] * k - r * k, c[0] * k + r * k, c[1] * k + r * k]
                dr.ellipse(box, fill=fill, outline=stroke if not dash else None, width=max(1, int(round(width * k))) if stroke else 0)
                if dash and stroke:
                    pts = [(c[0] + r * math.cos(a / 36 * math.pi), c[1] + r * math.sin(a / 36 * math.pi)) for a in range(73)]
                    dashed(pts, stroke, width * k, dash)
            else:
                _, x, y, s, size, fill, anchor, bold, rot = op
                f = font(size, bold)
                tw = dr.textlength(s, font=f); asc = f.getmetrics()[0] if hasattr(f, "getmetrics") else size * k
                if rot:
                    tmp = Image.new("RGBA", (int(tw) + 4, int(size * k * 1.4)), (0, 0, 0, 0)); ImageDraw.Draw(tmp).text((2, 0), s, font=f, fill=fill)
                    tmp = tmp.rotate(-rot, expand=True)
                    ox = {"start": 0, "middle": tmp.width / 2, "end": tmp.width}[anchor] if rot % 180 == 0 else tmp.width / 2
                    oy = tmp.height / 2 if rot % 180 else asc
                    im.paste(tmp, (int(x * k - ox), int(y * k - oy)), tmp)
                else:
                    ox = {"start": 0, "middle": tw / 2, "end": tw}[anchor]
                    dr.text((x * k - ox, y * k - asc), s, font=f, fill=fill)
        if ss > 1: im = im.resize((int(self.w * scale), int(self.h * scale)), Image.LANCZOS)
        im.save(path, optimize=True)
        return path
