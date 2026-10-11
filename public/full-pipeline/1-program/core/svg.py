"""Tiny SVG builder (feet in, px out)."""
from xml.sax.saxutils import escape

class Svg:
    def __init__(self, w, h, scale=6.0, pad=40):
        self.k, self.pad, self.items = scale, pad, []
        self.W, self.H = w * scale + 2 * pad, h * scale + 2 * pad
    def X(self, x): return round(self.pad + x * self.k, 2)
    def Y(self, y): return round(self.pad + y * self.k, 2)
    def rect(self, x, y, w, h, fill="none", stroke="#1b1f24", sw=1.0, extra=""):
        self.items.append(f'<rect x="{self.X(x)}" y="{self.Y(y)}" width="{round(w*self.k,2)}" height="{round(h*self.k,2)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>')
    def line(self, a, b, stroke="#1b1f24", sw=0.6):
        self.items.append(f'<line x1="{self.X(a[0])}" y1="{self.Y(a[1])}" x2="{self.X(b[0])}" y2="{self.Y(b[1])}" stroke="{stroke}" stroke-width="{sw}"/>')
    def poly(self, pts, fill="#0B6E99"):
        self.items.append('<polygon points="' + " ".join(f"{self.X(x)},{self.Y(y)}" for x, y in pts) + f'" fill="{fill}"/>')
    def text(self, x, y, s, size=10, anchor="middle", color="#1b1f24", bold=False, rot=0, raw=False):
        px, py = (x, y) if raw else (self.X(x), self.Y(y))
        tr = f' transform="rotate({rot} {px} {py})"' if rot else ""
        self.items.append(f'<text x="{px}" y="{py}" font-family="Arial, Helvetica, sans-serif" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-weight="{"bold" if bold else "normal"}"{tr}>{escape(str(s))}</text>')
    def render(self):
        return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.W:.0f}" height="{self.H:.0f}" viewBox="0 0 {self.W:.0f} {self.H:.0f}">'
                f'<rect width="100%" height="100%" fill="#ffffff"/>' + "".join(self.items) + "</svg>\n")
