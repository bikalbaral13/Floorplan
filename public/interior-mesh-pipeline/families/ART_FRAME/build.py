"""Family ART_FRAME — four-member frame around an inset canvas. STATUS: implemented (reference family).
Pivot back-bottom-centre on the wall plane (y = 0); the frame stands 2 mm off the wall toward -Y."""
from core import geom

def build(p, name, coll):
    Wd, H = p["L"], p["H"]
    fw, fd, inset, off = p.get("frame_w", 30), p.get("frame_d", 40), p.get("canvas_inset", 5), 2
    y0, y1 = -(off + fd), -off
    root = geom.empty_root(name, coll)
    bm = geom.new()
    geom.rounded_box(bm, -Wd / 2, y0, H - fw, Wd / 2, y1, H, 1.5, 2)              # top
    geom.rounded_box(bm, -Wd / 2, y0, 0, Wd / 2, y1, fw, 1.5, 2)                  # bottom
    geom.rounded_box(bm, -Wd / 2, y0, fw, -Wd / 2 + fw, y1, H - fw, 1.5, 2)       # left
    geom.rounded_box(bm, Wd / 2 - fw, y0, fw, Wd / 2, y1, H - fw, 1.5, 2)         # right
    geom.to_object(name + "_frame", bm, coll, root)
    bm = geom.new(); geom.box(bm, -Wd / 2 + fw, y0 + inset, fw, Wd / 2 - fw, y0 + inset + 4, H - fw)
    geom.to_object(name + "_canvas", bm, coll, root)
    return root
