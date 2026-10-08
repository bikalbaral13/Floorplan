"""S6 drawings: baked room (tools/bakeplan) + roombrief + resolve -> interior drawing set (DXF + PDF/PNG).

    python tools/drawings.py <project_dir> <baked.json> <out_dir>

Everything is drawn FROM THE BAKED 3D MESHES, so drawings and model cannot disagree:
  A-101 floor plan    cut at CUT_Z: walls/columns/glazing cut + hatched, furniture as silhouettes, door swings,
                      floor finishes hatched with each material's own `dxf` pattern, spec-id tags, dimensions
  A-102 RCP           ceiling elements (baffles, ducts, tray, pipes, pendants, cove) with ceiling levels
  A-201 elevations    every wall's room face: meshes within DEPTH of the face projected to (s, z), hidden lines
                      removed nearest-first with shapely, finish tags with spec ids
  A-601 schedules     finishes, FF&E + lighting, doors & partitions — spec id, material, product, deck slides
One DXF (R2010, mm, 4 paper-space A1 layouts with 1:50 viewports) + one PNG per sheet + a multi-page PDF.
"""
import json, math, sys, urllib.request
from pathlib import Path

import ezdxf
from ezdxf import units
from ezdxf.enums import TextEntityAlignment
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely.ops import unary_union

CUT_Z, DEPTH, SCALE = 1.2, 2.0, 50
PLAN_SCALE = 25
TS = [SCALE]  # model text scale of the drawing being drawn (1:25 plans, 1:50 elevations)
A1 = (841, 594)
LIB = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/library"
MM = 1000.0
CEILING_OBJ = ("baffle-ceiling", "services-ceiling", "pendant", "cove-light")
CUT_OBJ = ("wall", "column", "window", "door")
FLOOR_OBJ = ("room",)


# ── data ───────────────────────────────────────────────────────────────────────────────────────────
def load(project_dir, baked_path):
    P = Path(project_dir)
    baked = json.loads(Path(baked_path).read_text(encoding="utf-8"))
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
    trace = json.loads((P / "trace.px.json").read_text(encoding="utf-8"))
    return P, baked, brief, res, trace


def attachments(baked):
    """Every baked attachment -> (stem, params, [(mesh name, colour, faces in world metres X east / Y north / Z)])."""
    for coll in ("nodes", "segments", "spaces"):
        for h in baked.get(coll, []):
            for a in h.get("attachments", []):
                b = a.get("baked")
                if not b:
                    continue
                ax, ay = b["anchor"][0], b["anchor"][1]
                meshes = [(m["name"], m["color"], [[(ax + p[0], -(ay + p[1]), p[2]) for p in f] for f in m["faces"]]) for m in b["meshes"]]
                yield Path(a["objectPath"]).stem, a["params"], meshes


_mat_cache = {}


def material(path):
    if not path:
        return None
    if path not in _mat_cache:
        local = Path(__file__).resolve().parent.parent / "materials" / Path(path).name
        try:
            if local.exists():
                _mat_cache[path] = json.loads(local.read_text(encoding="utf-8"))
            else:
                req = urllib.request.Request(f"{LIB}/Materials/{path}", headers={"User-Agent": "Mozilla/5.0 build-from-deck"})
                _mat_cache[path] = json.loads(urllib.request.urlopen(req, timeout=20).read().decode("utf-8"))
        except Exception:
            _mat_cache[path] = None
    return _mat_cache[path]


def poly(faces, proj):
    ps = []
    for f in faces:
        q = [proj(p) for p in f]
        if len(q) >= 3:
            g = Polygon(q)
            if g.is_valid and g.area > 1e-7:
                ps.append(g)
            elif not g.is_valid:
                g = g.buffer(0)
                if g.area > 1e-7:
                    ps.append(g)
    return unary_union(ps) if ps else None


def rings(g):
    if g is None or g.is_empty:
        return []
    geoms = [g] if isinstance(g, Polygon) else list(getattr(g, "geoms", []))
    out = []
    for p in geoms:
        if isinstance(p, Polygon):
            out.append(list(p.exterior.coords))
            out += [list(i.coords) for i in p.interiors]
    return out


def lines_of(g):
    if g is None or g.is_empty:
        return []
    if g.geom_type in ("LineString", "LinearRing"):
        return [list(g.coords)]
    if g.geom_type == "Polygon":
        return rings(g)
    return [c for x in getattr(g, "geoms", []) for c in lines_of(x)]


# ── dxf helpers ────────────────────────────────────────────────────────────────────────────────────
LAYERS = {"A-WALL": 7, "A-WALL-PATT": 8, "A-GLAZ": 4, "A-DOOR": 1, "A-FURN": 6, "A-FLOR-PATT": 252, "A-CLNG": 5,
          "A-CLNG-PATT": 150, "A-LITE": 2, "A-ELEV": 7, "A-ELEV-FIN": 33, "A-ANNO-TAG": 1, "A-ANNO-TEXT": 7,
          "A-ANNO-DIMS": 3, "A-ANNO-TTLB": 7, "A-OVHD": 8}


def setup():
    doc = ezdxf.new("R2010", setup=True)
    doc.units = units.MM
    for n, c in LAYERS.items():
        doc.layers.add(n, color=c)
    doc.layers.get("A-OVHD").dxf.linetype = "DASHED"
    return doc


def pl(msp, pts, layer, closed=True, off=(0, 0)):
    msp.add_lwpolyline([((x + off[0]) * MM, (y + off[1]) * MM) for x, y in pts], close=closed, dxfattribs={"layer": layer})


def hatch(msp, pts_list, layer, pattern="SOLID", scale=1.0, angle=0.0, color=None, off=(0, 0)):
    h = msp.add_hatch(color=color or 256, dxfattribs={"layer": layer})
    if pattern == "SOLID":
        h.set_solid_fill(color=color or 8)
    else:
        try:
            h.set_pattern_fill(pattern, scale=scale * 20, angle=angle)
        except Exception:
            h.set_pattern_fill("ANSI31", scale=scale * 20, angle=angle)
    for pts in pts_list:
        h.paths.add_polyline_path([((x + off[0]) * MM, (y + off[1]) * MM) for x, y in pts], is_closed=True)


def clean(s):
    return str(s).replace("—", "-").replace("–", "-").replace("·", "|").replace("²", "2").replace("±", "+/-").replace("…", "...")


def text(msp, s, xy, h_paper, layer="A-ANNO-TEXT", align=TextEntityAlignment.MIDDLE_CENTER, off=(0, 0), rot=0.0):
    t = msp.add_text(clean(s), height=h_paper * TS[0], rotation=rot, dxfattribs={"layer": layer, "style": "OpenSans"})
    t.set_placement(((xy[0] + off[0]) * MM, (xy[1] + off[1]) * MM), align=align)


def tag(msp, s, xy, off=(0, 0)):
    r = 3.2 * TS[0]
    c = ((xy[0] + off[0]) * MM, (xy[1] + off[1]) * MM)
    msp.add_circle(c, r, dxfattribs={"layer": "A-ANNO-TAG"})
    t = msp.add_text(s, height=1.6 * TS[0], dxfattribs={"layer": "A-ANNO-TAG", "style": "OpenSans"})
    t.set_placement(c, align=TextEntityAlignment.MIDDLE_CENTER)


def dim(msp, a, b, distance, off=(0, 0)):
    d = msp.add_aligned_dim(text=str(round(math.dist(a, b) * MM)), p1=((a[0] + off[0]) * MM, (a[1] + off[1]) * MM), p2=((b[0] + off[0]) * MM, (b[1] + off[1]) * MM),
                            distance=distance * MM, dimstyle="EZDXF", override={"dimtxt": 2.2 * TS[0], "dimasz": 1.8 * TS[0], "dimexe": 1 * TS[0], "dimexo": 1 * TS[0]},
                            dxfattribs={"layer": "A-ANNO-DIMS"})
    d.render()


# ── drawings ───────────────────────────────────────────────────────────────────────────────────────
def zone_rings(baked, brief):
    """Zone spaces (floor finishes) from the baked plan: canvas px -> metres."""
    ppm = baked["settings"]["pixelsPerMeter"]
    nodes = {n["id"]: n for n in baked["nodes"]}
    labels = {z["label"]: z["id"] for z in brief["zones"]}
    out = []
    for s in baked["spaces"]:
        if s.get("label") in labels:
            ring = [(nodes[i]["x"] / ppm, -nodes[i]["y"] / ppm) for i in s["nodeIds"]]
            out.append((labels[s["label"]], s["label"], ring, s["attachments"][0]["params"]))
    return out


def floor_plan(msp, A, zones, items, off, cut=True, rcp=False):
    """Plan (cut at CUT_Z) or RCP at offset `off` (metres). Returns the cut-wall union for later use."""
    top = lambda p: (p[0], p[1])
    cut_polys, tags, furn = [], [], []
    for stem, params, meshes in A:
        allf = [f for _, _, fs in meshes for f in fs]
        if not allf:
            continue
        zmin = min(p[2] for f in allf for p in f)
        zmax = max(p[2] for f in allf for p in f)
        sid = params.get("specId")
        if stem in FLOOR_OBJ:
            continue
        if stem in ("wall", "column"):
            g = poly(allf, top)
            cut_polys.append(g)
            continue
        if stem == "window":
            for name, col, fs in meshes:
                g = poly(fs, top)
                if g is not None:
                    for r in rings(g):
                        pl(msp, r, "A-GLAZ", off=off)
            if sid and not rcp:
                c = poly(allf, top).centroid
                tags.append((sid, (c.x, c.y - 0.45)))
            continue
        if stem == "door":
            if rcp:
                continue
            for name, col, fs in meshes:
                g = poly([f for f in fs if min(p[2] for p in f) < CUT_Z], top)
                for r in rings(g):
                    pl(msp, r, "A-DOOR", off=off)
            continue
        is_ceiling = stem in CEILING_OBJ or zmin >= CUT_Z
        if rcp != is_ceiling and not (rcp and stem == "pendant"):
            if not rcp and zmin >= CUT_Z and stem in ("baffle-ceiling", "services-ceiling"):
                g = poly(allf, top)  # overhead outline, dashed
                for r in rings(g.envelope if g is not None else None):
                    pl(msp, r, "A-OVHD", off=off)
            continue
        layer = "A-CLNG" if rcp else "A-FURN"
        if stem == "pendant":
            layer = "A-LITE"
        if stem == "cove-light":
            layer = "A-LITE"
        for name, col, fs in meshes:
            if not rcp:
                fs = [f for f in fs if min(p[2] for p in f) < CUT_Z]
            g = poly(fs, top)
            if g is not None and not rcp and stem not in ("rug", "cove-light"):
                furn.append(g)
            for r in rings(g):
                pl(msp, r, layer, off=off)
        if sid and sid not in [t[0] for t in tags]:
            c = poly(allf, top).centroid
            tags.append((sid, (c.x, c.y)))
    walls = unary_union([g for g in cut_polys if g is not None])
    for r in rings(walls):
        pl(msp, r, "A-WALL", off=off)
    hatch(msp, rings(walls), "A-WALL-PATT", "ANSI31", 0.5, off=off)
    if not rcp:
        for zid, label, ring, params in zones:
            mat = material(params.get("materialPath"))
            dx = (mat or {}).get("dxf") or {"pattern": "ANSI37", "scale": 1, "angle": 0}
            area = Polygon(ring).buffer(0)
            if furn:  # a floor hatch stops at furniture, as drawn by hand
                area = area.difference(unary_union(furn).buffer(0.02))
            hatch(msp, rings(area), "A-FLOR-PATT", dx["pattern"], dx.get("scale", 1) * 0.6, dx.get("angle", 0), color=252, off=off)
    for sid, xy in tags:
        tag(msp, sid, xy, off=off)
    return walls


def plan_annotations(msp, zones, walls, items, off, rcp, levels, diag_walls=()):
    minx, miny, maxx, maxy = walls.bounds
    for zid, label, ring, params in zones:
        g = Polygon(ring)
        c = g.representative_point()
        it = items.get(params.get("specId"), {})
        if rcp:
            continue
        text(msp, label.split(" (")[0].upper(), (c.x, c.y + 0.35), 3.5, off=off)
        text(msp, f"{params.get('specId', '')} {it.get('params', {}).get('material', '')}".strip(), (c.x, c.y - 0.05), 2.2, off=off)
        text(msp, f"{g.area:.2f} m²", (c.x, c.y - 0.4), 2.2, off=off)
    if not rcp:
        dim(msp, (minx, maxy), (maxx, maxy), 1.2, off=off)
        dim(msp, (maxx, miny), (maxx, maxy), -1.2, off=off)
        for a, b in diag_walls:  # the angled wall gets its own aligned dimension
            dim(msp, a, b, -0.9, off=off)
    else:
        for (x, y), s in levels:
            text(msp, s, (x, y), 2.4, layer="A-ANNO-TAG", off=off)


def elevations(msp, A, trace, m_per_px, items, origin, zones, row_w=26.0):
    """One elevation per wall face; returns [(title, (x0, y0, w, h))] in model metres for the viewports."""
    ox, oy = trace["origin_px"]
    W = lambda p: ((p[0] - ox) * m_per_px, (oy - p[1]) * m_per_px)
    H = trace["level"]["height_m"]
    rc = unary_union([Polygon(z[2]) for z in zones]).representative_point()  # inside the room, whatever its shape
    views, x, y, row_h = [], origin[0], origin[1], H + 2.2
    for w in trace["walls"]:
        a, b = W(w["a"]), W(w["b"])
        L = math.dist(a, b)
        u = ((b[0] - a[0]) / L, (b[1] - a[1]) / L)
        n = (-u[1], u[0])
        if (rc.x - a[0]) * n[0] + (rc.y - a[1]) * n[1] < 0:
            n = (u[1], -u[0])
        face = (w["t_mm"] / 2000)
        # viewer stands in the room looking at the wall: s runs left->right as seen, so flip u if needed
        if u[0] * (-n[1]) + u[1] * n[0] < 0:
            a, b, u = b, a, (-u[0], -u[1])
        proj = lambda p: ((p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], p[2])
        depth = lambda p: (p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] - face
        if x + L > origin[0] + row_w:
            x, y = origin[0], y - row_h - 1.5
        off = (x, y)
        items_seen, cands = {}, []
        for stem, params, meshes in A:
            if stem in FLOOR_OBJ:
                continue
            for name, col, fs in meshes:
                keep = [f for f in fs if all(-0.35 <= depth(p) <= DEPTH for p in f)
                        and all(-0.05 <= proj(p)[0] <= L + 0.05 for p in f)]
                if not keep:
                    continue
                g = poly(keep, proj)
                if g is None:
                    continue
                d = max(depth(p) for f in keep for p in f)
                cands.append((d, stem, params, g))
        cands.sort(key=lambda c: -c[0])  # nearest the viewer (deepest into the room) first, the wall body last
        covered = None
        for d, stem, params, g in cands:
            vis = g if covered is None else g.difference(covered)
            for r in lines_of(vis.boundary if hasattr(vis, "boundary") else vis):
                pl(msp, r, "A-ELEV-FIN" if params.get("specId") else "A-ELEV", closed=False, off=off)
            covered = g if covered is None else unary_union([covered, g])
            sid = params.get("specId")
            if sid and sid not in items_seen and not vis.is_empty:
                items_seen[sid] = vis.representative_point()
        pl(msp, [(0, 0), (L, 0), (L, H), (0, H)], "A-ELEV", off=off)
        pl(msp, [(-0.6, 0), (L + 0.6, 0)], "A-WALL", closed=False, off=off)
        for sid, p in items_seen.items():
            tag(msp, sid, (p.x, p.y), off=off)
        for z, s in ((0, "FFL ±0.00"), (2.7, "+2.70"), (H, f"+{H:.2f} SOFFIT")):
            text(msp, s, (L + 0.3, z), 1.8, align=TextEntityAlignment.MIDDLE_LEFT, off=off)
        dim(msp, (0, 0), (L, 0), -0.6, off=off)
        title = w["label"].split(" - ")[0].split(" (")[0].upper()
        text(msp, f"ELEVATION — {title}", (L / 2, -1.3), 3.0, off=off)
        views.append((title, (x - 0.8, y - 1.8, L + 2.4, H + 2.4)))
        x += L + 4.0
    return views


# ── sheets ─────────────────────────────────────────────────────────────────────────────────────────
def title_block(ps, brief, sheet_no, title, scale_txt, rev="0"):
    X, Y = A1
    ps.add_lwpolyline([(10, 10), (X - 10, 10), (X - 10, Y - 10), (10, Y - 10)], close=True, dxfattribs={"layer": "A-ANNO-TTLB"})
    tb = X - 130
    ps.add_line((tb, 10), (tb, Y - 10), dxfattribs={"layer": "A-ANNO-TTLB"})
    rows = [("PROJECT", brief["project"]), ("ROOM", brief["room"]), ("DRAWING", title), ("SCALE", scale_txt),
            ("SOURCE", f"plan-phase deck · slides {brief['source']['slides'][0]}–{brief['source']['slides'][-1]}"),
            ("STAGE", "BUILD — from plan deck (build-from-deck S6)"), ("DATE", "08 OCT 2026")]
    y = Y - 20
    for k, v in rows:
        ps.add_text(clean(k), height=2.2, dxfattribs={"layer": "A-ANNO-TTLB"}).set_placement((tb + 5, y), align=TextEntityAlignment.LEFT)
        for i, chunk in enumerate([v[j:j + 38] for j in range(0, len(v), 38)][:3]):
            ps.add_text(clean(chunk), height=3.2, dxfattribs={"layer": "A-ANNO-TTLB"}).set_placement((tb + 5, y - 6 - i * 5), align=TextEntityAlignment.LEFT)
        y -= 26
        ps.add_line((tb, y + 6), (X - 10, y + 6), dxfattribs={"layer": "A-ANNO-TTLB"})
    ps.add_text("SHEET", height=2.2).set_placement((tb + 5, 45), align=TextEntityAlignment.LEFT)
    ps.add_text(sheet_no, height=12).set_placement((tb + 5, 22), align=TextEntityAlignment.LEFT)
    ps.add_text(f"REV {rev}", height=4).set_placement((X - 30, 22), align=TextEntityAlignment.LEFT)
    return tb


def viewport(ps, center_paper, size_paper, view_center_m, scale=SCALE):
    w, h = size_paper
    vp = ps.add_viewport(center=center_paper, size=(w, h), view_center_point=(view_center_m[0] * MM, view_center_m[1] * MM),
                         view_height=h * scale)
    vp.dxf.status = 1
    return vp


def table(ps, x, y, cols, rows, title, h=1.9, row_h=5.0):
    ps.add_text(clean(title), height=3.2, dxfattribs={"layer": "A-ANNO-TEXT"}).set_placement((x, y + 4), align=TextEntityAlignment.LEFT)
    total = sum(c[1] for c in cols)
    for r, row in enumerate([[c[0] for c in cols]] + rows):
        yy = y - r * row_h
        ps.add_line((x, yy), (x + total, yy), dxfattribs={"layer": "A-ANNO-TTLB"})
        cx = x
        for (name, wdt), val in zip(cols, row):
            s = str(val)
            maxc = int((wdt - 2) / (h * 0.92))
            s = clean(s)
            ps.add_text(s if len(s) <= maxc else s[:maxc - 1] + "…", height=h, dxfattribs={"layer": "A-ANNO-TEXT"}).set_placement(
                (cx + 1.2, yy - row_h + 1.6), align=TextEntityAlignment.LEFT)
            cx += wdt
    yy = y - (len(rows) + 1) * row_h
    ps.add_line((x, yy), (x + total, yy), dxfattribs={"layer": "A-ANNO-TTLB"})
    cx = x
    for _, wdt in cols + [("", 0)]:
        ps.add_line((cx, y), (cx, yy), dxfattribs={"layer": "A-ANNO-TTLB"})
        cx += wdt
    return yy


def schedules(brief, res):
    B = {b["item"]: b for b in res["bindings"]}
    fin, ffe = [], []
    for it in brief["items"]:
        b = B.get(it["id"], {})
        p = b.get("params", {})
        mat = p.get("materialPath", "") or ""
        prod = (it.get("productUrls") or [""])[0].replace("https://", "").replace("www.", "")
        spec = ", ".join(f"{k}={v}" for k, v in it["params"].items() if k not in ("material",))
        row = [it["id"], it.get("note", "").split(";")[0].split(" (")[0], it.get("zone", "").replace("Z-", ""), it["params"].get("material", it["object"]["kind"]),
               spec, Path(mat).stem, prod[:40], ",".join(map(str, it["slides"])), b.get("status", "")]
        (fin if it["category"] in ("flooring", "wall", "ceiling") else ffe).append(row)
    return fin, ffe


def main(project_dir, baked_path, out_dir):
    P, baked, brief, res, trace = load(project_dir, baked_path)
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    code = P.name
    m_per_px = trace["scale"]["ref_mm"] / 1000 / math.dist(*trace["scale"]["ref_px"])
    A = list(attachments(baked))
    items = {i["id"]: i for i in brief["items"]}
    zones = zone_rings(baked, brief)
    doc = setup()
    msp = doc.modelspace()

    # model space: plan at (0,0), RCP at (0,-14), elevations from (0,-30)
    PLAN, RCP = (0, 0), (0, -14)
    TS[0] = PLAN_SCALE
    walls = floor_plan(msp, A, zones, items, PLAN)
    ox, oy = trace["origin_px"]
    Wm = lambda p: ((p[0] - ox) * m_per_px, (oy - p[1]) * m_per_px)
    diag = [(Wm(w["a"]), Wm(w["b"])) for w in trace["walls"] if abs(w["a"][0] - w["b"][0]) > 1 and abs(w["a"][1] - w["b"][1]) > 1]
    plan_annotations(msp, zones, walls, items, PLAN, False, [], diag)
    floor_plan(msp, A, zones, items, RCP, rcp=True)
    lv = [((9.2, 0.6), "BAFFLES  U/S +2.70 (WAVE TO +2.82)"), ((6.0, 7.6), "EXPOSED SOFFIT +3.60 · DUCTS U/S +3.15"),
          ((2.4, 4.8), "COVE +1.50 ALONG MOSS")]
    plan_annotations(msp, zones, walls, items, RCP, True, lv)
    TS[0] = SCALE
    views = elevations(msp, A, trace, m_per_px, items, (0, -32), zones)
    bx0, by0, bx1, by1 = walls.bounds
    fin, ffe = schedules(brief, res)

    # paper space sheets
    sheets = []
    for name, title in (("A-101", "FLOOR PLAN — FINISHES & FURNITURE"), ("A-102", "REFLECTED CEILING PLAN"),
                        ("A-201", "INTERIOR ELEVATIONS"), ("A-601", "SCHEDULES — FINISHES, FF&E, OPENINGS")):
        lay = doc.layouts.new(name)
        lay.page_setup(size=A1, margins=(0, 0, 0, 0), units="mm")
        tb = title_block(lay, brief, name, title, {"A-101": "1:25", "A-102": "1:25", "A-201": "1:50"}.get(name, "NTS"))
        sheets.append((name, lay, tb, title))
    pad = 1.8
    cx, cy = (bx0 + bx1) / 2, (by0 + by1) / 2
    for (name, lay, tb, title), (vx, vy) in zip(sheets[:2], (PLAN, RCP)):
        w = (bx1 - bx0 + 2 * pad) * MM / PLAN_SCALE
        h = (by1 - by0 + 2 * pad) * MM / PLAN_SCALE
        viewport(lay, (30 + w / 2, A1[1] - 40 - h / 2), (w, h), (cx + vx, cy + vy), PLAN_SCALE)
        lay.add_text(clean(title), height=7).set_placement((30, A1[1] - 32), align=TextEntityAlignment.LEFT)
    # plan sheet: finish legend
    lay = sheets[0][1]
    legend = [[z[0], z[1], Path(z[3].get("materialPath", "")).stem, (material(z[3].get("materialPath")) or {}).get("dxf", {}).get("pattern", "")] for z in zones]
    table(lay, 30, 70, [("ZONE", 30), ("NAME", 70), ("MATERIAL", 55), ("HATCH", 30)], legend, "FLOOR FINISH LEGEND")
    lay.add_text("Cut at +1.20. Ceiling elements dashed (see A-102). Tags = roombrief spec ids (see A-601).", height=2.5).set_placement((30, 40), align=TextEntityAlignment.LEFT)
    # elevations sheet: viewports in rows
    lay = sheets[2][1]
    px, py, rowmax = 25, A1[1] - 30, 0
    for t, (x0, y0, w, h) in views:
        wp, hp = w * MM / SCALE, h * MM / SCALE
        if px + wp > sheets[2][2] - 10:
            px, py, rowmax = 25, py - rowmax - 10, 0
        viewport(lay, (px + wp / 2, py - hp / 2), (wp, hp), (x0 + w / 2, y0 + h / 2))
        px += wp + 8
        rowmax = max(rowmax, hp)
    # schedules sheet
    lay = sheets[3][1]
    cols = [("ID", 16), ("ITEM", 110), ("ZONE", 30), ("MATERIAL / KIND", 60), ("SPEC (from deck)", 250), ("LIBRARY MATERIAL", 50),
            ("PRODUCT / REF", 110), ("SLIDES", 30), ("STATUS", 32)]
    y = table(lay, 20, A1[1] - 35, cols, fin, "FINISH SCHEDULE — FLOORS, WALLS, CEILINGS")
    y = table(lay, 20, y - 18, cols, ffe, "FF&E AND LIGHTING SCHEDULE")
    ops = []
    for o in trace["openings"]:
        ops.append([o["id"], o["label"][:60], f"{o['leaves']} leaf", round(math.dist(o['from_px'], o['to_px']) * m_per_px * 1000), o["head_mm"], o.get("spec", "")])
    ops.append(["W-N", "Glass partition, black frame, fixed panes @600", "16 panes", 9950, 2600, "WL-04"])
    table(lay, 20, y - 18, [("MARK", 16), ("DESCRIPTION", 150), ("TYPE", 34), ("WIDTH", 26), ("HEAD", 26), ("SPEC", 26)], ops, "DOORS & PARTITIONS")

    dxf_path = out / f"{code}_drawings.dxf"
    doc.saveas(dxf_path)
    auditor = doc.audit()
    print(f"wrote {dxf_path.name}: {len(msp)} model entities, audit errors {len(auditor.errors)} fixes {len(auditor.fixes)}")
    render(doc, [s[0] for s in sheets], out, code)


def render(doc, names, out, code):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from ezdxf.addons.drawing import RenderContext, Frontend
    from ezdxf.addons.drawing.matplotlib import MatplotlibBackend
    from ezdxf.addons.drawing.config import Configuration, BackgroundPolicy, ColorPolicy
    cfg = Configuration(background_policy=BackgroundPolicy.WHITE, color_policy=ColorPolicy.BLACK, lineweight_scaling=0.6)
    with PdfPages(out / f"{code}_drawings.pdf") as pdf:
        for n in names:
            fig = plt.figure(figsize=(A1[0] / 25.4 / 2, A1[1] / 25.4 / 2))
            ax = fig.add_axes([0, 0, 1, 1])
            lay = doc.layouts.get(n)
            Frontend(RenderContext(doc), MatplotlibBackend(ax, adjust_figure=False), config=cfg).draw_layout(lay, finalize=True)
            ax.set_xlim(0, A1[0]); ax.set_ylim(0, A1[1]); ax.set_aspect("equal")
            fig.savefig(out / f"{code}_{n}.png", dpi=150)
            pdf.savefig(fig)
            plt.close(fig)
            print(f"rendered {code}_{n}.png")


if __name__ == "__main__":
    main(*sys.argv[1:4])
