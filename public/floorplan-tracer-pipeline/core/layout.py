"""The layout spec — tracer-layout/1. What both branches author (the agent's real output), then built.

layout.json
  schema "tracer-layout/1"
  frame  {"type": "image", "px_per_m": 66.36, "origin_px": [750, 543]}   image pixels, y DOWN
         {"type": "metric"}                                              metres, Y north (sketch branch)
  grid   {"x": {"A": 0, "B": 3.048, ...}, "y": {"1": 0, ...}}            named lines (metric) — usually copied
                                                                         from dims.resolved.json by S3
  snap   tolerance in frame units for run ends / ring corners (default 0.35 m or the px equivalent)
  levels [{ id, name, elevation, height, wall_h, frame? (per-sheet override),
            lines:    [["H"|"V", c, t, [[kind, s, e, {opts}], ...]], ...]
                       kind  w wall · r parapet (opts.h) · k kerb · d door · win window · g glazed sliding
                             · o opening (vacant gap) · gate (channel gate) · l drawn line, not a wall (shower screen)
                       H: c = y, runs along x (s < e).  V: c = x, runs along the frame's y (s < e).
                       door opts: hinge "s"|"e" (which end of the run), swing "+"|"-" (toward increasing
                       perpendicular FRAME coordinate: +y for H lines, +x for V lines), leaves 1|2
                       window opts: sill, head, panes;  any: label, t (piece thickness), src
            spaces:   [[name, [x0, y0, x1, y1] | [[x, y], ...], {type, printed: "12'5\\" x 16'6\\"", src}]]
            columns:  [[cx, cy, size_x, size_y, {src}]]
            stairs:   [{bay: [x0, y0, x1, y1], risers, tread, flight_w, mid, landing, config: dogleg|straight,
                        toe: N|E|S|W, first_flight: N|E|S|W, src}]
            fixtures: [[kind, cx, cy, across, along, back N|E|S|W|null, {rot, label, src}]]
            not_placed: [[kind, why]] }]
Every coordinate may be a number or a grid expression: "B", "B+0.0508", "2-0.1143+3.874".
Compass in an image frame: N = image up (unless the plan says otherwise — then rotate the image first).
"""
import re

_TOK = re.compile(r"\s*([+-]?)\s*([A-Za-z_][\w']*|\d+(?:\.\d+)?)")

class Frame:
    def __init__(self, spec, grid):
        self.spec = spec or {"type": "metric"}; self.grid = grid or {"x": {}, "y": {}}
        self.image = self.spec.get("type") == "image"
        self.ppm = float(self.spec.get("px_per_m", 1.0)) if self.image else 1.0
        self.o = self.spec.get("origin_px", [0, 0]) if self.image else [0, 0]

    def val(self, v, axis):
        """number | grid expression → frame units along axis ('x' or 'y')."""
        if isinstance(v, (int, float)): return float(v)
        s = str(v).strip(); tot = 0.0; pos = 0; first = True
        while pos < len(s):
            m = _TOK.match(s, pos)
            if not m: raise ValueError(f"bad coordinate expression {v!r}")
            sign = -1.0 if m.group(1) == "-" else 1.0; tok = m.group(2)
            if re.fullmatch(r"\d+(?:\.\d+)?", tok) and not (first and tok in self.grid.get(axis, {})):
                x = float(tok)
            else:
                g = self.grid.get(axis, {})
                if tok not in g: raise KeyError(f"grid line {tok!r} not defined on axis {axis} (expression {v!r})")
                x = float(g[tok])
            tot += sign * x; pos = m.end(); first = False
        return tot

    def X(self, x): return (x - self.o[0]) / self.ppm if self.image else x
    def Y(self, y): return -(y - self.o[1]) / self.ppm if self.image else y
    def L(self, d): return d / self.ppm if self.image else d
    def tol(self, snap): return snap if snap is not None else (0.35 * self.ppm if self.image else 0.35)
    def plus_y_world(self): return -1.0 if self.image else 1.0      # world Y direction of frame +y
