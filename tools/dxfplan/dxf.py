"""
Drawing-geometry JSON (from tools/dxfplan/run.mjs) -> professional architectural DXF (R2010, ezdxf).

    python tools/dxfplan/dxf.py geo.json out.dxf [--png out_prefix]

What the file holds
  MODEL SPACE (metres, y up)
    - Ground floor plan: mitred wall bands as closed outlines + ANSI31 HATCH, openings as DOOR-*/WIN-* blocks
      with schedule marks, open boundaries as dashed break lines, spaces with name / area / L x B, every
      furniture / fixture / casework object as a BLOCK insert, three tiers of dimensions on all four sides
      (clear + wall thickness string, centre-to-centre, overall).
    - North / South / East / West elevations with hidden-line depth sweep, openings, roof slab, parapet,
      plinth, ground line and level markers.
  PAPER SPACE  "A1 - GROUND FLOOR PLAN" (mm)
    - A1 landscape sheet: plan viewport 1:50, four elevation viewports 1:100, schedule of openings,
      general notes, legend and a full title block (placeholder values).
"""
import json, math, sys, datetime
from collections import defaultdict
import ezdxf
from ezdxf import units as ezunits
from ezdxf.enums import TextEntityAlignment as TA
from ezdxf.lldxf import const
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union

argv = sys.argv[1:]
GEO, OUT = argv[0], argv[1]
PNG = argv[argv.index("--png") + 1] if "--png" in argv else None
geo = json.load(open(GEO, encoding="utf8"))

# ───────────────────────────── defaults (real-world, metres) ─────────────────────────────
GL, FFL, LINTEL, SLAB_BOT, ROOF, PARAPET, COPING = -0.45, 0.0, 2.10, 2.85, 3.00, 4.00, 0.075
CHAJJA_PROJ = 0.0          # chajja shown as a lintel band only (no projection in a flat orthographic elevation)
THIN_MAX_T = 0.10          # bands thinner than this are parapets / duct outlines, not walls
HATCH_SPACING = 0.06       # ANSI31 line spacing in metres

# ───────────────────────────── frame: plan (y down) -> DXF (y up) ─────────────────────────────
F = lambda p: (round(p[0], 4), round(-p[1], 4))
walls = []
for w in geo["walls"]:
    d = dict(w); d["a"], d["b"] = F(w["a"]), F(w["b"]); d["poly"] = [F(p) for p in w["poly"]]
    if "opening" in w:
        o = dict(w["opening"]); o["anchor"] = F(o["anchor"]) if o.get("anchor") else None
        o["fill"] = [[F(p) for p in r] for r in o["fill"]]; o["lines"] = [[F(p) for p in r] for r in o["lines"]]
        d["opening"] = o
    walls.append(d)
dashed = [dict(d, a=F(d["a"]), b=F(d["b"])) for d in geo["dashed"]]
spaces = [dict(s, pts=[F(p) for p in s["pts"]]) for s in geo["spaces"]]
objects = []
for o in geo["objects"]:
    objects.append(dict(o, anchor=F(o["anchor"]), rotation=-o["rotation"], fill=[[F(p) for p in r] for r in o["fill"]], lines=[[F(p) for p in r] for r in o["lines"]]))

# ───────────────────────────── document ─────────────────────────────
doc = ezdxf.new("R2010", setup=True)
doc.units = ezunits.M
doc.header["$INSUNITS"] = 6
doc.header["$MEASUREMENT"] = 1
doc.header["$LTSCALE"] = 0.02
doc.header["$PSLTSCALE"] = 1
msp = doc.modelspace()
doc.styles.add("ARCH", font="arial.ttf")

LAYERS = {  # AIA-style naming, ACI colours, lineweight in 1/100 mm
    "A-WALL": (7, 50), "A-WALL-PATT": (8, 13), "A-WALL-THIN": (8, 25), "A-DOOR": (30, 25), "A-GLAZ": (4, 25),
    "A-FLOR-FURN": (6, 18), "A-FLOR-PFIX": (4, 18), "A-FLOR-CASE": (32, 18), "A-FLOR-EQPM": (3, 18), "L-PLNT": (92, 18),
    "A-AREA-IDEN": (7, 18), "A-ANNO-DIMS": (2, 13), "A-ANNO-DIMS-CC": (2, 13), "A-ANNO-DIMS-OVR": (2, 13),
    "A-ANNO-TEXT": (7, 18), "A-ANNO-SYMB": (1, 18), "A-FLOR-OPEN": (8, 13),
    "A-ELEV": (7, 35), "A-ELEV-GLAZ": (4, 18), "A-ELEV-DOOR": (30, 18), "A-ELEV-PATT": (8, 9), "A-ELEV-GRND": (7, 70), "A-ELEV-LEVL": (2, 13),
    "A-ANNO-TTLB": (7, 35), "A-ANNO-SCHD": (7, 18), "A-ANNO-NOTE": (7, 13), "G-ANNO-NPLT": (8, 13), "0": (7, 25),
}
for name, (color, lw) in LAYERS.items():
    if name in doc.layers: doc.layers.get(name).color = color; doc.layers.get(name).dxf.lineweight = lw
    else: doc.layers.add(name, color=color, lineweight=lw)
doc.layers.get("G-ANNO-NPLT").plot = 0
doc.layers.get("A-FLOR-OPEN").dxf.linetype = "DASHED"
doc.layers.get("A-ELEV-LEVL").dxf.linetype = "DASHDOT"

def dimstyle(name, txt, asz, lfac=1000, dec=0):
    ds = doc.dimstyles.new(name) if name not in doc.dimstyles else doc.dimstyles.get(name)
    ds.dxf.dimtxt = txt; ds.dxf.dimasz = asz; ds.dxf.dimtsz = asz * 0.6; ds.dxf.dimexe = asz * 0.8; ds.dxf.dimexo = asz * 0.6
    ds.dxf.dimgap = txt * 0.25; ds.dxf.dimlfac = lfac; ds.dxf.dimdec = dec; ds.dxf.dimtad = 1; ds.dxf.dimtih = 0; ds.dxf.dimtoh = 0
    ds.dxf.dimtxsty = "ARCH"; ds.dxf.dimclrd = 2; ds.dxf.dimclre = 2; ds.dxf.dimclrt = 7; ds.dxf.dimzin = 8
    return ds
dimstyle("ARCH-50", 0.16, 0.10)      # plan tiers (reads at 1:50)
dimstyle("ARCH-100", 0.28, 0.16)     # elevations (reads at 1:100)

# ───────────────────────────── helpers ─────────────────────────────
def T(x, y, s, h, layer, align=TA.MIDDLE_CENTER, rot=0, space=None, color=None):
    attrs = {"height": h, "layer": layer, "style": "ARCH", "rotation": rot}
    if color is not None: attrs["color"] = color
    return (space or msp).add_text(s, dxfattribs=attrs).set_placement((x, y), align=align)
def L(a, b, layer, space=None, **kw):
    return (space or msp).add_line(a, b, dxfattribs=dict(layer=layer, **kw))
def PL(pts, layer, closed=True, space=None, **kw):
    return (space or msp).add_lwpolyline(pts, close=closed, dxfattribs=dict(layer=layer, **kw))
def rect(x0, y0, x1, y1, layer, space=None, **kw):
    return PL([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], layer, True, space, **kw)
def mm(v): return int(round(v * 1000))
def rnd25(v): return int(round(v * 1000 / 25.0) * 25)

def add_hatch(loops, layer, spacing=HATCH_SPACING, angle=0.0, pattern="ANSI31", space=None, color=None):
    h = (space or msp).add_hatch(dxfattribs={"layer": layer, **({"color": color} if color is not None else {})})
    h.set_pattern_fill(pattern, scale=1.0, angle=angle)
    off = h.pattern.lines[0].offset; base = math.hypot(off[0], off[1]) or 1.0
    h.set_pattern_fill(pattern, scale=spacing / base, angle=angle)
    for i, ring in enumerate(loops):
        h.paths.add_polyline_path(ring, is_closed=True, flags=const.BOUNDARY_PATH_EXTERNAL if i == 0 else const.BOUNDARY_PATH_DEFAULT)
    return h

def poly_of(ring):
    p = Polygon(ring)
    return p if p.is_valid else p.buffer(0)

# ───────────────────────────── 1. WALLS ─────────────────────────────
solid = [w for w in walls if not w["isOpening"] and w["thickness"] > THIN_MAX_T]
thin = [w for w in walls if not w["isOpening"] and w["thickness"] <= THIN_MAX_T]
openings = [w for w in walls if w["isOpening"]]
band = unary_union([poly_of(w["poly"]) for w in solid if len(w["poly"]) >= 3]).buffer(0.0005).buffer(-0.0005).simplify(0.0008)
band_polys = list(band.geoms) if band.geom_type == "MultiPolygon" else [band]
for p in band_polys:
    ext = [(round(x, 4), round(y, 4)) for x, y in p.exterior.coords[:-1]]
    holes = [[(round(x, 4), round(y, 4)) for x, y in h.coords[:-1]] for h in p.interiors]
    PL(ext, "A-WALL"); [PL(h, "A-WALL") for h in holes]
    add_hatch([ext] + holes, "A-WALL-PATT")
for w in thin: PL(w["poly"], "A-WALL-THIN")
# Building footprint (walls + opening pieces) — used by dimensions, elevations and the duct test.
# The envelope is the wall-band union with its room holes filled. Spaces are deliberately NOT part of it:
# their rings sit on pixel-rounded inner faces a few mm off the bands, and those slivers split the union.
# Thin bands (balcony parapet, duct outlines) are in too, slightly buffered so they seal the loop: a balcony
# closed only by its parapet is still inside the building line, not an exterior face to dimension from.
wall_union = unary_union([poly_of(w["poly"]) for w in walls if w["thickness"] > THIN_MAX_T and len(w["poly"]) >= 3]
                         + [poly_of(w["poly"]).buffer(0.03) for w in walls if w["thickness"] <= THIN_MAX_T and len(w["poly"]) >= 3]).buffer(0.02).buffer(-0.02)
footprint = unary_union([Polygon(p.exterior) for p in (wall_union.geoms if wall_union.geom_type == "MultiPolygon" else [wall_union])])
outer = max(footprint.geoms, key=lambda g: g.area) if footprint.geom_type == "MultiPolygon" else footprint
allx = [p[0] for w in walls for p in w["poly"]]; ally = [p[1] for w in walls for p in w["poly"]]
EXT = {"N": max(ally), "S": min(ally), "E": max(allx), "W": min(allx)}   # side extremes incl. thin ducts / parapets
sx = [p[0] for w in solid for p in w["poly"]] + [p[0] for w in openings for p in w["poly"]]; sy = [p[1] for w in solid for p in w["poly"]] + [p[1] for w in openings for p in w["poly"]]
SOLID = {"N": max(sy), "S": min(sy), "E": max(sx), "W": min(sx)}          # outer faces of the real walls
rooms_union = unary_union([Polygon(s["pts"]) for s in spaces if s["roomType"] != "area"]).buffer(0.012)   # habitable inside; ducts are outside
duct_polys = [Polygon(s["pts"]) for s in spaces if s["label"].upper().startswith("DUCT")]

# ───────────────────────────── 2. OPEN BOUNDARIES ─────────────────────────────
for d in dashed: L(d["a"], d["b"], "A-FLOR-OPEN")

# ───────────────────────────── 3. SPACES ─────────────────────────────
for s in spaces:
    P = Polygon(s["pts"]); c = P.representative_point(); xs = [p[0] for p in s["pts"]]; ys = [p[1] for p in s["pts"]]
    if s["label"].upper().startswith("DUCT"):
        L((min(xs), min(ys)), (max(xs), max(ys)), "A-WALL-THIN"); L((min(xs), max(ys)), (max(xs), min(ys)), "A-WALL-THIN")
        T(c.x, c.y, "DUCT", 0.10, "A-AREA-IDEN", rot=90 if (max(ys) - min(ys)) > (max(xs) - min(xs)) else 0); continue
    T(c.x, c.y + 0.16, s["label"], 0.20, "A-AREA-IDEN")
    T(c.x, c.y - 0.08, f"{mm(max(xs) - min(xs))} x {mm(max(ys) - min(ys))}", 0.12, "A-AREA-IDEN")
    T(c.x, c.y - 0.28, f"{s['area']:.2f} m²", 0.12, "A-AREA-IDEN")

# ───────────────────────────── 4. OBJECT BLOCKS ─────────────────────────────
LAYER_FOR = {"toilet": "A-FLOR-PFIX", "washbasin": "A-FLOR-PFIX", "shower": "A-FLOR-PFIX", "kitchen-sink": "A-FLOR-PFIX", "washing-machine": "A-FLOR-EQPM",
             "stove": "A-FLOR-EQPM", "refrigerator": "A-FLOR-EQPM", "cabinet": "A-FLOR-CASE", "wardrobe": "A-FLOR-CASE", "shoe-rack": "A-FLOR-CASE",
             "tv-unit": "A-FLOR-CASE", "mirror": "A-FLOR-CASE", "plant": "L-PLNT", "north-arrow": "A-ANNO-SYMB"}
sig_cache, kind_count, block_of = {}, defaultdict(int), {}
def object_block(o):
    key = (o["kind"], json.dumps([[round(v, 3) for p in r for v in p] for r in o["fill"] + o["lines"]]))
    if key in sig_cache: return sig_cache[key]
    kind_count[o["kind"]] += 1; name = f"{o['kind'].upper()}-{kind_count[o['kind']]:02d}"
    blk = doc.blocks.new(name=name)
    for r in o["fill"]:
        if len(r) >= 3: blk.add_lwpolyline(r, close=True, dxfattribs={"layer": "0", "color": 0})
    for r in o["lines"]:
        if len(r) >= 2: blk.add_lwpolyline(r, close=False, dxfattribs={"layer": "0", "color": 0})
    sig_cache[key] = name; return name
for o in objects:
    if not o["fill"] and not o["lines"]: continue
    if o["kind"] == "north-arrow": continue      # the traced arrow sits in the dimension zone; a drafted symbol goes top-right instead
    name = object_block(o)
    msp.add_blockref(name, o["anchor"], dxfattribs={"layer": LAYER_FOR.get(o["kind"], "A-FLOR-FURN"), "rotation": o["rotation"]})

# ───────────────────────────── 5. DOORS & WINDOWS ─────────────────────────────
def seg_frame(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]; ln = math.hypot(dx, dy); u = (dx / ln, dy / ln); n = (-u[1], u[0]); return ln, u, n
def door_hinge_and_side(w):
    """Hinge end + swing side read off the baked leaf/arc rings: the vertex farthest from the wall axis is the
    open leaf tip / arc apex; its along-axis coordinate sits over the hinge, its normal sign is the swing side."""
    a, b = w["a"], w["b"]; ln, u, n = seg_frame(a, b); o = w["opening"]; an = o["anchor"] or ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    best = None
    for r in o["fill"] + o["lines"]:
        for p in r:
            wx, wy = an[0] + p[0], an[1] + p[1]; s = (wx - a[0]) * u[0] + (wy - a[1]) * u[1]; t = (wx - a[0]) * n[0] + (wy - a[1]) * n[1]
            if best is None or abs(t) > abs(best[1]): best = (s, t)
    if best is None: return a, b, 1
    s, t = best
    hinge, other = (a, b) if abs(s) < abs(s - ln) else (b, a)
    return hinge, other, (1 if t > 0 else -1)

door_types, win_types, door_blocks, win_blocks = {}, {}, {}, {}
# Marks and schedule sizes are NOMINAL: a traced opening of 1229 mm is a 1200 window, so the schedule
# reads like a specification, not like a survey. Block geometry keeps the traced width so it fits the gap.
DOOR_NOMINAL = (650, 700, 750, 825, 900, 1000, 1200, 1500, 1800)
WIN_NOMINAL = (450, 600, 750, 900, 1200, 1500, 1800, 2100, 2400, 3000)
def nominal(v, table): return min(table, key=lambda n: abs(n - v * 1000))
marks, counters = {}, defaultdict(int)
def mark_for(cls, key):
    if (cls, key) not in marks: counters[cls] += 1; marks[(cls, key)] = f"{cls}{counters[cls]}"
    return marks[(cls, key)]
variants = defaultdict(int)
def blockname(prefix, mark):
    variants[(prefix, mark)] += 1; n = variants[(prefix, mark)]
    return f"{prefix}-{mark}" if n == 1 else f"{prefix}-{mark}{chr(96 + n)}"
def door_block(W, Tk, leaves):
    key = (rnd25(W), rnd25(Tk), leaves)
    if key not in door_blocks:
        nom = nominal(W, DOOR_NOMINAL); mark = mark_for("D", (nom, leaves)); name = blockname("DOOR", mark); blk = doc.blocks.new(name=name); Wm, Tm = key[0] / 1000, key[1] / 1000
        blk.add_line((0, -Tm / 2), (0, Tm / 2), dxfattribs={"layer": "0", "color": 0}); blk.add_line((Wm, -Tm / 2), (Wm, Tm / 2), dxfattribs={"layer": "0", "color": 0})
        leaf_t = 0.04
        if leaves == "Double":
            for hx, sgn in ((0, 1), (Wm, -1)):
                blk.add_lwpolyline([(hx, Tm / 2), (hx + sgn * leaf_t, Tm / 2), (hx + sgn * leaf_t, Tm / 2 + Wm / 2), (hx, Tm / 2 + Wm / 2)], close=True, dxfattribs={"layer": "0", "color": 0})
                blk.add_arc((hx, Tm / 2), Wm / 2, 0 if sgn > 0 else 90, 90 if sgn > 0 else 180, dxfattribs={"layer": "0", "color": 0})
        else:
            blk.add_lwpolyline([(0, Tm / 2), (leaf_t, Tm / 2), (leaf_t, Tm / 2 + Wm), (0, Tm / 2 + Wm)], close=True, dxfattribs={"layer": "0", "color": 0})
            blk.add_arc((0, Tm / 2), Wm, 0, 90, dxfattribs={"layer": "0", "color": 0})
        door_blocks[key] = (name, mark); door_types.setdefault(mark, dict(width=nom, height=2100, sill=0, type="Double leaf flush door" if leaves == "Double" else "Single leaf flush door", count=0, where=[]))
    return door_blocks[key]
def win_block(W, Tk, panes, op, sill):
    key = (rnd25(W), rnd25(Tk), int(panes), op, rnd25(sill))
    if key not in win_blocks:
        nom = nominal(W, WIN_NOMINAL); sill_n = int(round(sill * 1000 / 50.0) * 50)
        cls = "SD" if op == "Sliding" and sill < 0.3 else "V" if sill >= 1.2 else "W"
        mark = mark_for(cls, (nom, sill_n, int(panes), op)); name = blockname("WIN", mark)
        blk = doc.blocks.new(name=name); Wm, Tm = key[0] / 1000, key[1] / 1000; fr = 0.05; A = {"layer": "0", "color": 0}
        blk.add_line((0, -Tm / 2), (0, Tm / 2), dxfattribs=A); blk.add_line((Wm, -Tm / 2), (Wm, Tm / 2), dxfattribs=A)
        blk.add_line((0, -Tm / 2), (Wm, -Tm / 2), dxfattribs=A); blk.add_line((0, Tm / 2), (Wm, Tm / 2), dxfattribs=A)
        if op == "Sliding":
            for (x0, x1, y) in ((fr, Wm / 2 + 0.04, 0.025), (Wm / 2 - 0.04, Wm - fr, -0.025)):
                blk.add_lwpolyline([(x0, y - 0.012), (x1, y - 0.012), (x1, y + 0.012), (x0, y + 0.012)], close=True, dxfattribs=A)
        else:
            blk.add_line((fr, 0.018), (Wm - fr, 0.018), dxfattribs=A); blk.add_line((fr, -0.018), (Wm - fr, -0.018), dxfattribs=A)
            for i in range(1, int(panes)): x = fr + (Wm - 2 * fr) * i / panes; blk.add_line((x, -0.04), (x, 0.04), dxfattribs=A)
        win_blocks[key] = (name, mark)
        win_types.setdefault(mark, dict(width=nom, height=2100 - sill_n, sill=sill_n, type=("Sliding glazed door" if cls == "SD" else "Ventilator, top hung" if cls == "V" else f"{'Casement' if op == 'Casement' else op} window, {int(panes)} pane{'s' if panes > 1 else ''}"), count=0, where=[]))
    return win_blocks[key]

def tag(x, y, mark, layer):
    msp.add_circle((x, y), 0.15, dxfattribs={"layer": layer}); T(x, y, mark, 0.11, layer)

opening_marks = {}
for w in openings:
    o = w["opening"]; a, b = w["a"], w["b"]; ln, u, n = seg_frame(a, b); mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    inside_sign = 1 if outer.contains(Point(mid[0] + n[0] * 0.5, mid[1] + n[1] * 0.5)) else -1
    if o["kind"] == "door":
        hinge, other, side = door_hinge_and_side(w)
        name, mark = door_block(ln, w["thickness"], o["params"].get("leaves", "Single"))
        rot = math.degrees(math.atan2(other[1] - hinge[1], other[0] - hinge[0]))
        _, hu, hn = seg_frame(hinge, other); ys = 1 if side * ((hn[0] * n[0] + hn[1] * n[1])) > 0 else -1
        msp.add_blockref(name, hinge, dxfattribs={"layer": "A-DOOR", "rotation": rot, "yscale": ys})
        # non-swing side, clear of the arc and the room label — unless that side is OUTSIDE the building (an
        # entrance door), where the tag would land on the dimension strings: then beyond the arc on the inside
        tx_, ty_ = mid[0] - n[0] * side * 0.38, mid[1] - n[1] * side * 0.38
        if not outer.contains(Point(tx_, ty_)): tx_, ty_ = mid[0] + n[0] * side * (ln + 0.28), mid[1] + n[1] * side * (ln + 0.28)
        tag(tx_, ty_, mark, "A-DOOR")
        door_types[mark]["count"] += 1; door_types[mark]["where"].append(w["label"])
    else:
        p = o["params"]; name, mark = win_block(ln, w["thickness"], p.get("panes", 2), p.get("operation", "Casement"), float(p.get("sillHeight", 0.9)))
        rot = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        msp.add_blockref(name, a, dxfattribs={"layer": "A-GLAZ", "rotation": rot})
        # inside the room, off the tiers, and pulled toward the window's start so it never lands on a room label
        tag(mid[0] + n[0] * inside_sign * 0.42 - u[0] * ln * 0.3, mid[1] + n[1] * inside_sign * 0.42 - u[1] * ln * 0.3, mark, "A-GLAZ")
        win_types[mark]["count"] += 1; win_types[mark]["where"].append(w["label"])
    opening_marks[w["id"]] = mark

# ───────────────────────────── 6. DIMENSIONS (3 tiers, 4 sides) ─────────────────────────────
def near(v, w, tol=0.002): return abs(v - w) < tol
def horizontal(w): return near(w["a"][1], w["b"][1]) and not near(w["a"][0], w["b"][0])
def vertical(w): return near(w["a"][0], w["b"][0]) and not near(w["a"][1], w["b"][1])
bands_all = [w for w in walls if w["thickness"] > THIN_MAX_T]
minx, miny, maxx, maxy = outer.bounds
OFF1, OFF2, OFF3 = 0.55, 1.05, 1.55   # tier offsets from the outer face (m)

_dims_seen = set()
def dim(p1, p2, base, angle, layer, style="ARCH-50"):
    if math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 0.02: return
    # two facade runs meeting at a step both name the shared wall — one dimension, not two on top of each other
    key = (layer, tuple(sorted((round(p1[0], 2), round(p1[1], 2), round(p2[0], 2), round(p2[1], 2)))))
    if key in _dims_seen: return
    _dims_seen.add(key)
    msp.add_linear_dim(base=base, p1=p1, p2=p2, angle=angle, dimstyle=style, dxfattribs={"layer": layer}).render()

def side_dims(side):
    """side ∈ N,S,E,W. Facing runs = axis-parallel band segments whose outer face is on the footprint boundary
    and whose outward side is outside the building. Each run is dimensioned in its own two tiers; the
    overall tier spans the whole side."""
    horiz = side in ("N", "S"); sgn = {"N": 1, "S": -1, "E": 1, "W": -1}[side]
    along = 0 if horiz else 1; across = 1 if horiz else 0
    runs = defaultdict(list)   # face coordinate -> list of segments on that face line
    for w in bands_all:
        if not (horizontal(w) if horiz else vertical(w)): continue
        c = w["a"][across]; face = c + sgn * w["thickness"] / 2
        probe_out = [0, 0]; probe_out[across] = face + sgn * 0.06; probe_out[along] = (w["a"][along] + w["b"][along]) / 2
        probe_in = [0, 0]; probe_in[across] = c - sgn * (w["thickness"] / 2 + 0.06); probe_in[along] = probe_out[along]
        # exterior-facing = nothing habitable outside it (a piece hiding behind a corner band still counts, a
        # duct shaft outside it still counts) and the building inside it
        if rooms_union.contains(Point(probe_out)) or not outer.contains(Point(probe_in)): continue
        runs[round(face, 3)].append(w)
    # perpendicular walls meeting a run: any band segment perpendicular to it with an endpoint on the run's centreline
    tier3 = []
    # the OUTERMOST run is the facade: its strings sit beyond the side's extreme (ducts included). A recess
    # run keeps its strings just off its own face, so no extension line has to cross the building.
    main_face = max(runs, key=lambda f: sgn * f) if runs else None
    for face, segs in runs.items():
        c = segs[0]["a"][across]
        base_ref = EXT[side] if face == main_face else face
        run_len = max(max(w["a"][along], w["b"][along]) for w in segs) - min(min(w["a"][along], w["b"][along]) for w in segs)
        if face != main_face and run_len < 3.0: continue   # a short recess is already covered by the adjacent sides' strings
        lo = min(min(w["a"][along], w["b"][along]) for w in segs); hi = max(max(w["a"][along], w["b"][along]) for w in segs)
        perps = {}
        for w in bands_all:
            if not (vertical(w) if horiz else horizontal(w)): continue
            for e in (w["a"], w["b"]):
                if near(e[across], c, 0.003) and lo - 0.003 <= e[along] <= hi + 0.003: perps[round(e[along], 3)] = max(perps.get(round(e[along], 3), 0), w["thickness"])
        # (an exterior corner needs no fallback: the perpendicular wall shares the corner node and is found above)
        # merge keys within 5 mm (a node reached from two segments rounds two ways), keeping the thickest wall
        merged = {}
        for x in sorted(perps):
            hit = next((k for k in merged if abs(k - x) < 0.005), None)
            if hit is None: merged[x] = perps[x]
            else: merged[hit] = max(merged[hit], perps[x])
        perps = merged; xs = sorted(perps)
        if "--debug" in argv: print(f"  dims {side} face {face:+.3f}: " + "  ".join(f"{x:+.3f}/{perps[x]:.3f}" for x in xs))
        if len(xs) < 2: continue
        # tiers sit outside the side's EXTREME (duct outlines and parapets included), so a stepped facade's
        # runs share one string line and nothing crosses the drawing
        base1 = base_ref + sgn * OFF1; base2 = base_ref + sgn * OFF2; angle = 0 if horiz else 90
        mk = lambda v: ((v, base1) if horiz else (base1, v))
        # tier 1: outer face | thickness | clear | thickness | ... | outer face
        pts = []
        for x in xs: t = perps[x]; pts += [x - t / 2, x + t / 2]
        pts[0] = xs[0] - perps[xs[0]] / 2; pts[-1] = xs[-1] + perps[xs[-1]] / 2
        for i in range(len(pts) - 1):
            dim(mk(pts[i]), mk(pts[i + 1]), mk(0), angle, "A-ANNO-DIMS")
        # tier 2: centre to centre
        mk2 = lambda v: ((v, base2) if horiz else (base2, v))
        for i in range(len(xs) - 1): dim(mk2(xs[i]), mk2(xs[i + 1]), mk2(0), angle, "A-ANNO-DIMS-CC")
        tier3 += [pts[0], pts[-1]]
    # tier 3: overall, on the outermost face of this side
    if tier3:
        base3 = EXT[side] + sgn * OFF3; mk3 = lambda v: ((v, base3) if horiz else (base3, v))
        lo, hi = (SOLID["W"], SOLID["E"]) if horiz else (SOLID["S"], SOLID["N"])   # overall = outer wall faces, ducts excluded
        dim(mk3(lo), mk3(hi), mk3(0), 0 if horiz else 90, "A-ANNO-DIMS-OVR")
for s in "NSEW": side_dims(s)
# North symbol, top-right, clear of the tiers (plan is drawn with north up the page: northbearing 0)
nx_, ny_ = EXT["E"] + OFF3 + 0.85, EXT["N"] + 0.95      # beside the east strings, level with the north tiers
msp.add_circle((nx_, ny_), 0.45, dxfattribs={"layer": "A-ANNO-SYMB"})
PL([(nx_, ny_ + 0.40), (nx_ - 0.16, ny_ - 0.30), (nx_, ny_ - 0.16), (nx_ + 0.16, ny_ - 0.30)], "A-ANNO-SYMB", closed=True)
add_hatch([[(nx_, ny_ + 0.40), (nx_ - 0.16, ny_ - 0.30), (nx_, ny_ - 0.16)]], "A-ANNO-SYMB", spacing=0.03, angle=45)
T(nx_, ny_ - 0.70, "N", 0.25, "A-ANNO-SYMB")

T((minx + maxx) / 2, miny - OFF3 - 1.2, "GROUND FLOOR PLAN", 0.45, "A-ANNO-TEXT")
T((minx + maxx) / 2, miny - OFF3 - 1.75, "SCALE 1:50   ·   ALL DIMENSIONS IN MM   ·   LEVELS IN METRES FROM FFL ±0.00", 0.18, "A-ANNO-TEXT")

# ───────────────────────────── 7. ELEVATIONS ─────────────────────────────
def wall_top(w):
    if w["thickness"] > THIN_MAX_T: return PARAPET
    c = LineString([w["a"], w["b"]])
    if any(c.distance(d) < 0.12 for d in duct_polys): return PARAPET       # duct shaft walls run full height
    return FFL + float(w["height"])                                          # balcony parapet / railing
ELEV_GAP = 4.0
def elevation(side, origin):
    """Hidden-line elevation seen from `side`, drawn with its left edge at origin[0] and FFL at origin[1]."""
    horiz = side in ("N", "S"); along = 0 if horiz else 1; across = 1 if horiz else 0
    # depth: smaller = nearer the viewer
    depth_sign = {"S": 1, "N": -1, "W": 1, "E": -1}[side]
    mirror = side in ("N", "W")      # viewer on the far side sees the plan axis reversed
    faces = []
    for w in walls:
        if not (horizontal(w) if horiz else vertical(w)): continue
        # extent along the facade from the MITRED band polygon (the corner extension included), depth from
        # the centreline — so two walls meeting at a corner reach the full outer-face width
        pts_along = [p[along] for p in w["poly"]] or [w["a"][along], w["b"][along]]
        a0, a1 = min(pts_along), max(pts_along); d = depth_sign * w["a"][across]
        faces.append(dict(a0=a0, a1=a1, d=d, top=wall_top(w), w=w))
    if not faces: return
    lo = min(f["a0"] for f in faces); hi = max(f["a1"] for f in faces); span = hi - lo
    def X(v): return origin[0] + ((hi - v) if mirror else (v - lo))
    def Y(z): return origin[1] + z
    step = 0.01; n = int(span / step) + 1
    # per-sample visible strata: [(hlo, hhi, face)] from ground up
    cols = []
    for i in range(n):
        v = lo + i * step + step / 2
        cand = sorted((f for f in faces if f["a0"] - 1e-6 <= v <= f["a1"] + 1e-6), key=lambda f: f["d"])
        strata, h = [], FFL
        for f in cand:
            if f["top"] > h + 1e-6: strata.append((h, f["top"], f)); h = f["top"]
        cols.append((v, strata))
    # merge runs of identical stacks into rectangles per stratum
    pieces = []   # (v0, v1, hlo, hhi, face)
    open_run = {}
    for idx, (v, strata) in enumerate(cols + [(hi + step, [])]):
        keyset = {}
        for (hl, hh, f) in strata: keyset[(hl, hh, round(f["d"], 3))] = f
        for k, f in keyset.items():
            if k in open_run: continue
            open_run[k] = (v - step / 2, f)
        for k in list(open_run):
            if k not in keyset:
                v0, f = open_run.pop(k); pieces.append((v0, v - step / 2, k[0], k[1], f))
    # draw wall pieces
    for (v0, v1, hl, hh, f) in pieces:
        x0, x1 = sorted((X(v0), X(v1)))
        rect(x0, Y(hl), x1, Y(hh), "A-ELEV")
        if hh >= PARAPET - 1e-6:
            L((x0, Y(SLAB_BOT)), (x1, Y(SLAB_BOT)), "A-ELEV"); L((x0, Y(ROOF)), (x1, Y(ROOF)), "A-ELEV")
            L((x0, Y(PARAPET - COPING)), (x1, Y(PARAPET - COPING)), "A-ELEV")
            add_hatch([[(x0, Y(SLAB_BOT)), (x1, Y(SLAB_BOT)), (x1, Y(ROOF)), (x0, Y(ROOF))]], "A-ELEV-PATT", spacing=0.05)
    # openings: visible where their piece is the nearest stratum at that sample, above whatever is nearer
    for f in faces:
        w = f["w"]
        if not w["isOpening"]: continue
        o = w["opening"]; sill = FFL + (float(o["params"].get("sillHeight", 0.9)) if o["kind"] == "window" else 0.0); lint = FFL + float(o["params"].get("lintelHeight", LINTEL))
        runs, cur = [], None
        for (v, strata) in cols:
            if not (f["a0"] <= v <= f["a1"]): continue
            block_h = FFL
            for (hl, hh, g) in strata:
                if g is f: break
                block_h = max(block_h, hh)
            else:
                block_h = None
            vis = block_h is not None and lint > max(sill, block_h) + 0.05
            key = (round(max(sill, block_h), 3) if vis else None)
            if cur and cur[2] == key: cur[1] = v
            else:
                if cur and cur[2] is not None: runs.append(cur)
                cur = [v, v, key]
        if cur and cur[2] is not None: runs.append(cur)
        for (v0, v1, hl) in runs:
            x0, x1 = sorted((X(v0 - step / 2), X(v1 + step / 2))); lay = "A-ELEV-GLAZ" if o["kind"] == "window" else "A-ELEV-DOOR"
            rect(x0, Y(hl), x1, Y(lint), lay); rect(x0 + 0.05, Y(hl) + (0.05 if hl > FFL else 0), x1 - 0.05, Y(lint) - 0.05, lay)
            if o["kind"] == "window":
                panes = int(o["params"].get("panes", 2)); ww = x1 - x0
                for i in range(1, panes): L((x0 + ww * i / panes, Y(hl)), (x0 + ww * i / panes, Y(lint)), lay)
                if hl > FFL: L((x0 - 0.08, Y(hl)), (x1 + 0.08, Y(hl)), "A-ELEV")             # sill
            else:
                L((x0 + 0.05, Y(hl)), (x1 - 0.05, Y(hl)), lay); L((x1 - 0.12, Y(hl + 1.0)), (x1 - 0.12, Y(hl + 1.05)), lay)  # threshold + handle
            L((x0 - 0.10, Y(lint)), (x1 + 0.10, Y(lint)), "A-ELEV"); L((x0 - 0.10, Y(lint + 0.15)), (x1 + 0.10, Y(lint + 0.15)), "A-ELEV")  # lintel / chajja band
    # ground, plinth, levels, title
    xl, xr = origin[0] - 1.0, origin[0] + span + 1.0
    L((xl, Y(GL)), (xr, Y(GL)), "A-ELEV-GRND"); L((origin[0], Y(GL)), (origin[0], Y(FFL)), "A-ELEV"); L((origin[0] + span, Y(GL)), (origin[0] + span, Y(FFL)), "A-ELEV")
    L((origin[0], Y(FFL)), (origin[0] + span, Y(FFL)), "A-ELEV")
    add_hatch([[(origin[0], Y(GL)), (origin[0] + span, Y(GL)), (origin[0] + span, Y(FFL)), (origin[0], Y(FFL))]], "A-ELEV-PATT", spacing=0.04, angle=0)
    for k in range(int((xr - xl) / 0.3) + 1):
        x = xl + k * 0.3; L((x, Y(GL)), (x - 0.2, Y(GL) - 0.2), "A-ELEV-GRND")
    for z, name in ((GL, "GL"), (FFL, "FFL"), (LINTEL, "LINTEL"), (ROOF, "ROOF SLAB"), (PARAPET, "PARAPET")):
        L((xr, Y(z)), (xr + 0.6, Y(z)), "A-ELEV-LEVL"); PL([(xr + 0.6, Y(z)), (xr + 0.45, Y(z) + 0.09), (xr + 0.75, Y(z) + 0.09)], "A-ELEV-LEVL")
        T(xr + 0.85, Y(z), f"{name} {'+' if z >= 0 else '-'}{abs(z):.2f}", 0.20, "A-ELEV-LEVL", align=TA.MIDDLE_LEFT)
    msp.add_linear_dim(base=(origin[0], Y(GL) - 0.9), p1=(origin[0], Y(GL)), p2=(origin[0] + span, Y(GL)), angle=0, dimstyle="ARCH-100", dxfattribs={"layer": "A-ANNO-DIMS-OVR"}).render()
    msp.add_linear_dim(base=(xl - 0.4, Y(FFL)), p1=(xl, Y(FFL)), p2=(xl, Y(PARAPET)), angle=90, dimstyle="ARCH-100", dxfattribs={"layer": "A-ANNO-DIMS-OVR"}).render()
    name = {"N": "NORTH", "S": "SOUTH", "E": "EAST", "W": "WEST"}[side]
    T(origin[0] + span / 2, Y(GL) - 1.9, f"{name} ELEVATION", 0.45, "A-ANNO-TEXT"); T(origin[0] + span / 2, Y(GL) - 2.4, "SCALE 1:100", 0.22, "A-ANNO-TEXT")
    return (origin[0] - 2.4, Y(GL) - 2.8, origin[0] + span + 4.6, Y(PARAPET) + 0.6)

W_plan = maxx - minx; H_plan = maxy - miny
ELEV = {}
ELEV["S"] = elevation("S", (minx, miny - OFF3 - 2.5 - ELEV_GAP - PARAPET))
ELEV["N"] = elevation("N", (minx + W_plan + ELEV_GAP + 6, miny - OFF3 - 2.5 - ELEV_GAP - PARAPET))
ELEV["E"] = elevation("E", (minx, ELEV["S"][1] - 2.0 - PARAPET - 3.0))
ELEV["W"] = elevation("W", (minx + W_plan + ELEV_GAP + 6, ELEV["S"][1] - 2.0 - PARAPET - 3.0))

# ───────────────────────────── 8. PAPER SPACE — A1 SHEET ─────────────────────────────
SW, SH = 841.0, 594.0
lay = doc.layouts.new("A1 - GROUND FLOOR PLAN")
lay.page_setup(size=(SW, SH), margins=(0, 0, 0, 0), units="mm", scale=(1, 1))
psp = lay
def PT(x, y, s, h, layer="A-ANNO-TTLB", align=TA.MIDDLE_LEFT, color=None): return T(x, y, s, h, layer, align=align, space=psp, color=color)
def PLN(a, b, layer="A-ANNO-TTLB", **kw): return L(a, b, layer, space=psp, **kw)
def PRECT(x0, y0, x1, y1, layer="A-ANNO-TTLB", **kw): return rect(x0, y0, x1, y1, layer, space=psp, **kw)
M = 10.0; TBW = 165.0
PRECT(M, M, SW - M, SH - M, lineweight=70)
tx0 = SW - M - TBW; PLN((tx0, M), (tx0, SH - M), lineweight=70)

def viewport(cx, cy, w, h, mx, my, scale_den):
    vp = psp.add_viewport(center=(cx, cy), size=(w, h), view_center_point=(mx, my), view_height=h * scale_den / 1000.0)
    vp.dxf.layer = "G-ANNO-NPLT"; vp.dxf.status = 1; return vp
# Plan viewport at 1:50 (left 2/3 of the sheet)
pw, ph = (W_plan + 2 * OFF3 + 3.0) * 20, (H_plan + 2 * OFF3 + 3.4) * 20
pcx, pcy = M + 8 + pw / 2, SH - M - 8 - ph / 2
viewport(pcx, pcy, pw, ph, (minx + maxx) / 2, (miny + maxy) / 2 - 1.0, 50)
# Elevation viewports at 1:100 (right column, two rows) — each frames its own bbox from model space
ex0 = M + 8 + pw + 10; ex1 = tx0 - 8; ew = (ex1 - ex0 - 8) / 2
rows = [("N", "S"), ("E", "W")]; ey = SH - M - 8
for r, pair in enumerate(rows):
    for c, side in enumerate(pair):
        bx0, by0, bx1, by1 = ELEV[side]; w_mm = (bx1 - bx0) * 10; h_mm = (by1 - by0) * 10
        s = min(ew / w_mm, 1.0); w_mm *= s; h_mm *= s
        cx = ex0 + c * (ew + 8) + ew / 2; cy = ey - h_mm / 2
        viewport(cx, cy, w_mm, h_mm, (bx0 + bx1) / 2, (by0 + by1) / 2, 100 / s)
    ey -= max((ELEV[p][3] - ELEV[p][1]) * 10 for p in pair) + 12
# Schedule of openings (below the elevations)
sx0, sy = ex0, ey - 4
cols = [("MARK", 16), ("TYPE", 62), ("WIDTH", 18), ("HEIGHT", 18), ("SILL", 16), ("NOS", 12), ("LOCATION", (ex1 - ex0) - 142)]
def table(title, rows_, y):
    PT(sx0, y, title, 3.2, align=TA.BOTTOM_LEFT); y -= 2
    x = sx0; rh = 6.0
    for name, wdt in cols: PRECT(x, y - rh, x + wdt, y, "A-ANNO-SCHD"); PT(x + 1.5, y - rh / 2, name, 2.2, "A-ANNO-SCHD"); x += wdt
    y -= rh
    for row in rows_:
        x = sx0
        for (name, wdt), val in zip(cols, row): PRECT(x, y - rh, x + wdt, y, "A-ANNO-SCHD"); PT(x + 1.5, y - rh / 2, str(val), 2.0, "A-ANNO-SCHD"); x += wdt
        y -= rh
    return y - 6
def rows_of(types):
    out = []
    for mark in sorted(types, key=lambda m: (m.rstrip("0123456789"), int(m.lstrip("DWSV") or 0))):
        t = types[mark]; out.append((mark, t["type"], t["width"], t["height"], t["sill"], t["count"], ", ".join(t["where"])[:96]))
    return out
sy = table("SCHEDULE OF DOORS", rows_of(door_types), sy)
sy = table("SCHEDULE OF WINDOWS & VENTILATORS", rows_of(win_types), sy)
# General notes + legend (below the plan)
ny = pcy - ph / 2 - 6; nx = M + 8
PT(nx, ny, "GENERAL NOTES", 3.2, align=TA.BOTTOM_LEFT)
NOTES = [
    "1. All dimensions are in millimetres, levels in metres relative to finished floor level FFL ±0.00 unless noted otherwise.",
    "2. Do not scale off the drawing; figured dimensions govern. Verify all dimensions on site before commencing work.",
    "3. External walls 230 mm and internal walls 115 / 150 mm brick masonry in CM 1:6, plastered both sides, unless noted.",
    "4. Plinth level FFL ±0.00 is 450 mm above ground level GL −0.45. Roof slab 150 mm RCC at +2.85 / +3.00; parapet to +4.00 with coping.",
    "5. Door and window sizes in the schedules are clear structural openings; lintel level +2.10 throughout. Ventilators sill +1.50.",
    "6. Toilet, utility and balcony floors to be sunk 100 mm and finished with slope to floor drain; waterproofing as per specification.",
    "7. Furniture, casework and sanitary fixtures are shown for layout intent only and are to be confirmed with the interior scheme.",
    "8. Duct shafts to be provided with removable covers at floor level; carry all services vertically through ducts.",
]
for i, n in enumerate(NOTES): PT(nx, ny - 4 - i * 4.2, n, 2.1, "A-ANNO-NOTE")
ly = ny - 4 - len(NOTES) * 4.2 - 4
PT(nx, ly, "LEGEND", 3.2, align=TA.BOTTOM_LEFT)
PRECT(nx, ly - 9, nx + 14, ly - 3, "A-ANNO-NOTE"); add_hatch([[(nx, ly - 9), (nx + 14, ly - 9), (nx + 14, ly - 3), (nx, ly - 3)]], "A-ANNO-NOTE", spacing=1.2, space=psp); PT(nx + 18, ly - 6, "230 / 115 brick masonry wall (hatched)", 2.1, "A-ANNO-NOTE")
PLN((nx, ly - 15), (nx + 14, ly - 15), "A-FLOR-OPEN"); PT(nx + 18, ly - 15, "Open boundary between spaces (no leaf)", 2.1, "A-ANNO-NOTE")
psp.add_circle((nx + 7, ly - 24), 3, dxfattribs={"layer": "A-ANNO-NOTE"}); PT(nx + 7, ly - 24, "D1", 2.0, "A-ANNO-NOTE", align=TA.MIDDLE_CENTER); PT(nx + 18, ly - 24, "Opening mark — see schedules", 2.1, "A-ANNO-NOTE")
# Area statement (right of the notes): carpet area per space, totals, built-up area from the envelope
ax0, ay = nx + 190, ny
PT(ax0, ay, "AREA STATEMENT", 3.2, align=TA.BOTTOM_LEFT); ay -= 2
acols = [("SPACE", 46), ("SIZE (mm)", 34), ("AREA (m²)", 24)]
def arow(vals, y, bold=False):
    x = ax0
    for (name, wdt), v in zip(acols, vals): PRECT(x, y - 5.2, x + wdt, y, "A-ANNO-SCHD"); PT(x + 1.5, y - 2.6, str(v), 2.4 if bold else 2.0, "A-ANNO-SCHD"); x += wdt
    return y - 5.2
ay = arow([c[0] for c in acols], ay, True)
carpet = 0.0
for s in sorted(spaces, key=lambda s: -s["area"]):
    if s["label"].upper().startswith("DUCT"): continue
    xs_ = [p[0] for p in s["pts"]]; ys_ = [p[1] for p in s["pts"]]
    ay = arow([s["label"], f"{mm(max(xs_) - min(xs_))} x {mm(max(ys_) - min(ys_))}", f"{s['area']:.2f}"], ay); carpet += s["area"]
_bu = unary_union([poly_of(w["poly"]) for w in walls if w["thickness"] > THIN_MAX_T and len(w["poly"]) >= 3]).buffer(0.01).buffer(-0.01)
builtup = unary_union([Polygon(p.exterior) for p in (_bu.geoms if _bu.geom_type == "MultiPolygon" else [_bu])])
ay = arow(["TOTAL CARPET AREA", "", f"{carpet:.2f}"], ay, True)
ay = arow(["BUILT-UP AREA", "to outer wall face", f"{builtup.area:.2f}"], ay, True)
ay = arow(["MASONRY IN PLAN", "", f"{band.area:.2f}"], ay)

# Title block (mirrors the app's Layout sheet; placeholders where the project has not filled a field)
today = datetime.date.today().strftime("%d %b %Y").upper()
def field(y0, y1, label, value, x0=tx0, x1=SW - M, vh=4.5):
    PRECT(x0, y0, x1, y1); PT(x0 + 3, y1 - 4, label, 2.0, color=8); PT(x0 + 3, (y0 + y1) / 2 - 1.5, value, vh)
y = SH - M
PRECT(tx0, y - 48, SW - M, y); PRECT(tx0 + 4, y - 20, tx0 + 20, y - 4); PT(tx0 + 12, y - 12, "LOGO", 2.2, align=TA.MIDDLE_CENTER, color=8)
PT(tx0 + 24, y - 9, "CONSULTANCY / FIRM NAME", 4.2); PT(tx0 + 24, y - 16, "Street Address, City, Country", 2.4, color=8); PT(tx0 + 4, y - 42, "+00 000 0000 · info@firm.com", 2.4, color=8); y -= 48
field(y - 40, y, "PROJECT", "PROJECT NAME"); PT(tx0 + 3, y - 32, "Plot / Street, City", 2.4, color=8); y -= 40
field(y - 24, y, "CLIENT", "CLIENT NAME"); y -= 24
field(y - 26, y, "DRAWING TITLE", "GROUND FLOOR PLAN, ELEVATIONS & SCHEDULES", vh=4.0); y -= 26
field(y - 22, y, "DISCIPLINE", "ARCHITECTURAL"); PRECT(tx0 + 95, y - 16, SW - M - 4, y - 6); PT(tx0 + 100, y - 11, "FOR CONSTRUCTION", 3.0); y -= 22
w3 = TBW / 3
for i, (lab, val) in enumerate((("DRAWN", "—"), ("CHECKED", "—"), ("APPROVED", "—"))): field(y - 22, y, lab, val, tx0 + i * w3, tx0 + (i + 1) * w3)
y -= 22
for i, (lab, val) in enumerate((("DATE", today), ("PROJECT NO", "—"), ("SHEET SIZE", "A1"))): field(y - 22, y, lab, val, tx0 + i * w3, tx0 + (i + 1) * w3)
y -= 22
PRECT(tx0, y - 40, tx0 + w3, y); PT(tx0 + 3, y - 4, "NORTH", 2.0, color=8)
psp.add_circle((tx0 + w3 / 2, y - 22), 10, dxfattribs={"layer": "A-ANNO-TTLB"}); PLN((tx0 + w3 / 2, y - 13), (tx0 + w3 / 2 - 4, y - 30)); PLN((tx0 + w3 / 2, y - 13), (tx0 + w3 / 2 + 4, y - 30)); PLN((tx0 + w3 / 2 - 4, y - 30), (tx0 + w3 / 2, y - 26)); PLN((tx0 + w3 / 2 + 4, y - 30), (tx0 + w3 / 2, y - 26)); PT(tx0 + w3 / 2, y - 36, "N", 2.5, align=TA.MIDDLE_CENTER)
field(y - 40, y, "SCALE", "PLAN 1:50 · ELEVATIONS 1:100", tx0 + w3, SW - M, vh=3.4); y -= 40
PRECT(tx0, y - 60, SW - M, y)
rc = [("REV", 14), ("DATE", 28), ("DESCRIPTION", TBW - 14 - 28 - 22), ("BY", 22)]
x = tx0
for lab, wd in rc: PRECT(x, y - 7, x + wd, y); PT(x + 2, y - 3.5, lab, 2.0, color=8); x += wd
for r in range(5):
    x = tx0
    for lab, wd in rc: PRECT(x, y - 7 - (r + 1) * 10.6, x + wd, y - 7 - r * 10.6); x += wd
PT(tx0 + 2, y - 3.5 - 7, "0", 2.2); PT(tx0 + 16, y - 3.5 - 7, today, 2.0); PT(tx0 + 44, y - 3.5 - 7, "ISSUED FOR CONSTRUCTION", 2.0)
y -= 60
PRECT(tx0, y - 70, SW - M, y); PT(tx0 + 3, y - 4, "SEAL / STAMP", 2.0, color=8); psp.add_circle((tx0 + TBW / 2, y - 37), 22, dxfattribs={"layer": "A-ANNO-TTLB", "linetype": "DASHED"}); y -= 70
PRECT(tx0, y - 30, tx0 + TBW * 0.62, y); PT(tx0 + 3, y - 4, "SHEET NO", 2.0, color=8); PT(tx0 + 3, y - 20, "A-101", 9.0)
PRECT(tx0 + TBW * 0.62, y - 30, SW - M, y); PT(tx0 + TBW * 0.62 + 3, y - 4, "REV", 2.0, color=8); PT(tx0 + TBW * 0.62 + 3, y - 20, "0", 9.0); y -= 30
PT(tx0 + 3, y - 5, "This drawing is the property of the firm and may not be reproduced or used without written consent.", 1.6, color=8)
PT(tx0 + 3, y - 9, "Do not scale off this drawing — use figured dimensions only.", 1.6, color=8)
PT(M + 4, M + 3, f"{OUT.split('/')[-1].split(chr(92))[-1]}   ·   generated {today} from the traced canvas plan (52.889 px/m)", 1.8, "A-ANNO-NOTE", color=8)

# ───────────────────────────── save + audit ─────────────────────────────
doc.set_modelspace_vport(height=(maxy - miny) * 4.5, center=((minx + maxx) / 2 + (W_plan + ELEV_GAP + 6) / 2, (ELEV["E"][1] + maxy) / 2))
doc.saveas(OUT)
aud = doc.audit()
print(f"wrote {OUT}: {len(msp)} model entities, {len(psp)} paper entities, {len(doc.blocks)} blocks, audit errors {len(aud.errors)} fixes {len(aud.fixes)}")
for e in aud.errors[:10]: print("  !", e)
print("door types:", {k: (v['width'], v['count']) for k, v in door_types.items()})
print("window types:", {k: (v['width'], v['sill'], v['count']) for k, v in win_types.items()})

if PNG:
    import matplotlib; matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy
    def render(layout, path, bbox=None, size=(30, 24), dpi=110):
        if bbox:  # figure aspect follows the crop, so the fixed data aspect never fights the limits
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]; size = (size[0], size[0] * h / w)
        fig = plt.figure(figsize=size, dpi=dpi); ax = fig.add_axes([0, 0, 1, 1]); ctx = RenderContext(doc); ctx.set_current_layout(layout)
        Frontend(ctx, MatplotlibBackend(ax, adjust_figure=False), config=Configuration(background_policy=BackgroundPolicy.WHITE, lineweight_scaling=0.5)).draw_layout(layout, finalize=True)
        if bbox: ax.set_aspect("equal", adjustable="box"); ax.set_xlim(bbox[0], bbox[2]); ax.set_ylim(bbox[1], bbox[3])
        fig.savefig(path, dpi=dpi); plt.close(fig); print("rendered", path)
    pad = OFF3 + 2.6
    render(msp, f"{PNG}_plan.png", (minx - pad, miny - pad - 0.6, maxx + pad, maxy + pad), size=(26, 30))
    for side in "NSEW":
        b = ELEV[side]; render(msp, f"{PNG}_elev_{side}.png", b, size=(30, 30 * (b[3] - b[1]) / (b[2] - b[0])))
    render(psp, f"{PNG}_sheet.png", size=(33.64, 23.76), dpi=120)
