"""2-D plan helpers for the adapters (system Python + shapely; never imported inside Blender)."""
import math, random
from shapely.geometry import Polygon, MultiPolygon, LineString, MultiLineString, Point, GeometryCollection
from shapely.ops import unary_union, linemerge

R = 4  # decimals kept in item geometry (0.1 mm)

def rp(p): return [round(p[0], R), round(p[1], R)]

def polys(g):
    """Polygon / MultiPolygon / collection → list of Polygons (empty and slivers dropped)."""
    if g is None or g.is_empty: return []
    if isinstance(g, Polygon): return [g] if g.area > 1e-4 else []
    if isinstance(g, (MultiPolygon, GeometryCollection)): return [p for x in g.geoms for p in polys(x)]
    return []

def lines(g, min_len=0.05):
    if g is None or g.is_empty: return []
    if isinstance(g, LineString): return [g] if g.length >= min_len else []
    if isinstance(g, (MultiLineString, GeometryCollection)):
        parts = [x for x in g.geoms if isinstance(x, LineString)] + [y for x in g.geoms if isinstance(x, MultiLineString) for y in x.geoms]
        if not parts: return []
        merged = linemerge(parts)
        out = [merged] if isinstance(merged, LineString) else (list(merged.geoms) if isinstance(merged, MultiLineString) else parts)
        return [x for x in out if x.length >= min_len]
    return []

def poly_json(p, simplify=0.002):
    p = p.simplify(simplify, preserve_topology=True)
    ext = [rp(c) for c in list(p.exterior.coords)[:-1]]
    return [ext, [[rp(c) for c in list(h.coords)[:-1]] for h in p.interiors]]

def multipoly_json(g, simplify=0.002):
    return [poly_json(p, simplify) for p in polys(g)]

def line_json(l, simplify=0.002):
    return [rp(c) for c in l.simplify(simplify).coords]

def orient_left_inside(line, region, probe=0.3):
    """Return the line oriented so that `region` lies on its LEFT (probe at mid-length)."""
    L = line.length; m = line.interpolate(L / 2); a = line.interpolate(max(0, L / 2 - 0.05)); b = line.interpolate(min(L, L / 2 + 0.05))
    dx, dy = b.x - a.x, b.y - a.y; n = math.hypot(dx, dy) or 1
    left = Point(m.x - dy / n * probe, m.y + dx / n * probe)
    return line if region.contains(left) else LineString(list(line.coords)[::-1])

def points_along(line, spacing, start=None, offset=0.0):
    """Points every `spacing` m along a line, `offset` m to its LEFT; returns [(x, y, heading_deg)]."""
    out = []; L = line.length; s = spacing / 2 if start is None else start
    while s <= L - 1e-6:
        p = line.interpolate(s); q = line.interpolate(min(L, s + 0.05)); o = line.interpolate(max(0, s - 0.05))
        dx, dy = q.x - o.x, q.y - o.y; n = math.hypot(dx, dy) or 1
        out.append((p.x - dy / n * offset, p.y + dx / n * offset, math.degrees(math.atan2(dy, dx))))
        s += spacing
    return out

def jitter_grid(poly, spacing, rnd, jitter=0.35):
    x0, y0, x1, y1 = poly.bounds; out = []
    y = y0 + spacing / 2
    while y < y1:
        x = x0 + spacing / 2
        while x < x1:
            p = Point(x + rnd.uniform(-jitter, jitter) * spacing, y + rnd.uniform(-jitter, jitter) * spacing)
            if poly.contains(p): out.append((p.x, p.y))
            x += spacing
        y += spacing
    return out
