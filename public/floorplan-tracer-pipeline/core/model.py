"""The neutral plan model — tracer-plan/1. App-independent; metres; X east, Y north, Z up.

plan.json
  schema "tracer-plan/1", units "m", source {kind: drawing|sketch|import, files, tracer_version, standards}
  scale  {px_per_m, method, residuals_ft, n_pairs}                       (drawing branch; null for sketches)
  levels [ {id, name, elevation, height,
            walls:    [{id, a, b, t, h, kind: wall|parapet|kerb, label, src}],
            openings: [{id, a, b, t, kind: door|window|opening|sliding|gate, sill, head, hinge: a|b,
                        swing: L|R, leaves: 1|2, panes, label, src}],
            spaces:   [{id, name, type: room|toilet|balcony|area, ring, area, clear, printed, src}],
            columns:  [{id, c, size:[x, y], rot, src}],
            stairs:   [{id, bay:[x0,y0,x1,y1], footprint:[x0,y0,x1,y1], risers, riser, tread, flight_w,
                        config, toe: N|E|S|W, first_flight: N|E|S|W, src}],
            fixtures: [{id, kind, c, size:[across, along], back: N|E|S|W|null, rot, room, label, src}],
            not_placed: [{kind, why}] } ]
Conventions
  * A wall / opening piece runs a→b along its centreline; t is its thickness. Openings are the gap
    pieces themselves (pre-cut), never symbols over a solid wall.
  * hinge = the end (a or b) the leaf pivots on; swing = the side the leaf opens to, L = the LEFT of the
    direction a→b (world, Y north), R = the right.
  * Space rings run on wall CENTRELINES (shared nodes); `clear` is the face-to-face size (centreline span
    minus the bounding walls' half-thicknesses), which is what a printed room size means.
  * `back` of a fixture = the side of the room its back is against (world compass); rot = degrees CCW of
    the fixture's own +x axis from world +x (exporters convert to their library's conventions).
  * src (provenance) on every element: measured | derived | convention | user | sketch | imported.
"""
import math

SCHEMA = "tracer-plan/1"
LAYOUT_SCHEMA = "tracer-layout/1"

from pipeline_kit.findings import F, summarize   # noqa: F401  (shared finding shape)

def empty_plan(source):
    return {"schema": SCHEMA, "units": "m", "source": source, "scale": None, "levels": []}

def empty_level(lid, name, elevation=0.0, height=3.0):
    return {"id": lid, "name": name, "elevation": elevation, "height": height,
            "walls": [], "openings": [], "spaces": [], "columns": [], "stairs": [], "fixtures": [], "not_placed": []}

def ring_area(r):
    return abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2

def unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy) or 1.0
    return dx / L, dy / L, L

def left_normal(a, b):
    ux, uy, _ = unit(a, b); return -uy, ux

COMPASS = {"N": (0, 1), "S": (0, -1), "E": (1, 0), "W": (-1, 0)}
