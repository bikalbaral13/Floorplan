"""Adapter: BuilderPluss canvas master plan (masterplan/1 + site design + placed designs) → exterior items.

Frames. Canvas designs are pixels at settings.pixelsPerMeter (100) with y pointing DOWN. World = metres,
X east, Y north:  X = x_px / ppm,  Y = -y_px / ppm. A design instance places the design's (0, 0) at the
site position (canvas metres) → world (px, -py); canvas rotation (clockwise on screen) → world -rotation.

What becomes what (site, level "Ground floor")
    road-with-math spaces           → ROAD (asphalt slab) + KERB lines (road outline minus gates)
    plot-with-math + designInstance → GROUND_PATCH lawn + BUILDING instance + plot walls / gate / driveway
    plot-with-math "SERVICE YARD"   → GROUND_PATCH paving
    plot-with-math "OSR AREA"       → GROUND_PATCH lawn + tree / shrub fill
    room-with-math "SECURITY CABIN" → BUILDING (unique, synthesised walls / door / windows / roof)
    plot-boundary segments          → COMPOUND_WALL (site boundary) ; opening segment → GATE_SLIDING
    everything                      → TERRAIN (flat, rough, with earth dumps in the free margin)

Building exterior (per design level): spaces are unioned into an INDOOR region (rooms, shafts, voids)
and an OUTDOOR region (balcony, deck, terrace, courtyard, entrance …). A wall segment is EXTERIOR when
its centreline runs on the indoor boundary (or it stands free); its outside is the side not indoors.
Floors = indoor ∪ outdoor of the level (voids cut out) grown to the wall outer face; roofs = indoor
not covered by the level above; parapets on roof / terrace / balcony edges that no wall closes.
"""
import json, math, os, random, re, urllib.request
from shapely.geometry import Polygon, LineString, Point, box as sbox
from shapely.ops import unary_union
from core import plan2d as P

OUTDOOR = re.compile(r"BALCON|DECK|TERRACE|COURTYARD|THULASI|SIT ?OUT|PORCH|ENTRANCE|SHAFT OPEN|OTS|VERANDA|SKY", re.I)
VOID = re.compile(r"VOID|DOUBLE HEIGHT", re.I)
WALL_LAYERS = {"wall", "window", "door", "opening"}

# ------------------------------------------------------------------------------------------ io --
def fetch_design(path, cache_dir, library_url):
    os.makedirs(cache_dir, exist_ok=True)
    f = os.path.join(cache_dir, os.path.basename(path))
    if not os.path.exists(f):
        url = library_url.rstrip("/") + "/" + "/".join(urllib.request.quote(s) for s in path.split("/"))
        req = urllib.request.Request(url, headers={"User-Agent": "exterior-mesh-pipeline/0.1 (+BuilderPluss)"})   # the CDN rejects urllib's default agent
        with urllib.request.urlopen(req, timeout=180) as r, open(f, "wb") as o: o.write(r.read())
    return json.load(open(f, encoding="utf-8"))

def _ppm(d): return float((d.get("settings") or {}).get("pixelsPerMeter") or 100)

def _nodes(level, ppm):
    return {n["id"]: (n["x"] / ppm, -n["y"] / ppm) for n in level.get("nodes", [])}

def _att(seg, oid):
    return next((a for a in seg.get("attachments", []) if a.get("objectId") == oid), None)

def _space_poly(sp, nodes):
    pts = [nodes[i] for i in sp.get("nodeIds", []) if i in nodes]
    if len(pts) < 3: return None
    p = Polygon(pts)
    if not p.is_valid: p = p.buffer(0)
    return p if p.area > 0.05 else None

# --------------------------------------------------------------------------- building exterior --
def extract_building(d, plinth_h=0.45):
    ppm = _ppm(d); levels = []; floors = []; indoor_l = []; walls_l = []; cover_l = []
    for i, L in enumerate(d["levels"]):
        nodes = _nodes(L, ppm); ind, out, void = [], [], []
        for sp in L.get("spaces", []):
            p = _space_poly(sp, nodes)
            if p is None: continue
            lab = sp.get("label", "")
            if VOID.search(lab) and (i > 0 or "VOID" in lab.upper()): void.append(p)
            elif OUTDOOR.search(lab): out.append(p)
            else: ind.append(p)
        indoor = unary_union(ind + void).buffer(0.03, join_style=2).buffer(-0.03, join_style=2)
        outdoor = unary_union(out).buffer(0.03, join_style=2).buffer(-0.03, join_style=2) if out else Polygon()
        voids = unary_union(void) if void else Polygon()
        segs = []
        for s in L.get("segments", []):
            if s.get("layer") not in WALL_LAYERS or s.get("fromNodeId") == s.get("toNodeId"): continue
            wa = _att(s, "wall-with-math"); oa = _att(s, "opening-with-math")
            if not wa and not oa: continue
            a, b = nodes.get(s["fromNodeId"]), nodes.get(s["toNodeId"])
            if not a or not b or math.dist(a, b) < 0.05: continue
            t = float((wa or oa)["params"].get("thickness") or s.get("thickness", 23) / ppm)
            h = float((wa["params"].get("height") if wa else None) or L.get("height", 3.2))
            segs.append(dict(id=s["id"], na=s["fromNodeId"], nb=s["toNodeId"], a=a, b=b, t=t, h=h, layer=s["layer"], seg=s))
        bnd = indoor.boundary
        ext = []
        for w in segs:
            ax, ay = w["a"]; bx, by = w["b"]; L2 = math.dist(w["a"], w["b"]); dx, dy = (bx - ax) / L2, (by - ay) / L2; nx, ny = -dy, dx
            samples = [(ax + dx * L2 * f, ay + dy * L2 * f) for f in (0.15, 0.3, 0.5, 0.7, 0.85)]
            on = sum(bnd.distance(Point(p)) < max(0.08, w["t"] * 0.6) for p in samples)
            pr = w["t"] / 2 + 0.25; mx, my = samples[2]
            left_in = indoor.contains(Point(mx + nx * pr, my + ny * pr)); right_in = indoor.contains(Point(mx - nx * pr, my - ny * pr))
            if on >= 3 and left_in != right_in: w["out"] = -1 if left_in else 1
            elif not left_in and not right_in: w["out"] = 0                     # free-standing (both faces outside)
            else: continue
            ext.append(w)
        # corner joints: at a node shared by two non-collinear exterior walls the first runs through
        # (+t_other/2) and the second stops short (-t_first/2) → clean butt joint, no overlapping solids
        bynode = {}
        for k, w in enumerate(ext):
            w["ea"] = w["eb"] = 0.0
            bynode.setdefault(w["na"], []).append((k, "a")); bynode.setdefault(w["nb"], []).append((k, "b"))
        def direction(w, end):
            (ax, ay), (bx, by) = w["a"], w["b"]
            return (bx - ax, by - ay) if end == "b" else (ax - bx, ay - by)
        for nid, lst in bynode.items():
            if len(lst) != 2: continue
            (k1, e1), (k2, e2) = lst; w1, w2 = ext[k1], ext[k2]
            d1, d2 = direction(w1, e1), direction(w2, e2)
            c = abs(d1[0] * d2[0] + d1[1] * d2[1]) / (math.hypot(*d1) * math.hypot(*d2))
            if c > 0.985: continue
            w1["e" + e1] = w2["t"] / 2; w2["e" + e2] = -w1["t"] / 2
        wall_json = []
        for w in ext:
            L2 = math.dist(w["a"], w["b"]); ops = []
            for oid, kind in (("window-with-math", "window"), ("door-with-math", "door"), ("opening-with-math", "opening")):
                a = _att(w["seg"], oid)
                if not a: continue
                pa = a.get("params", {}); width = min(float(pa.get("width") or L2), L2 - 0.02)
                if str(pa.get("fitMode", "")).lower().startswith("fill"): width = max(width, L2 - 0.02) if kind == "window" and L2 < 3.5 else width
                c = float(a.get("t", 0.5)) * L2; c = min(max(c, width / 2 + 0.005), L2 - width / 2 - 0.005)
                head = float(pa.get("lintelHeight") or 2.1); sill = float(pa.get("sillHeight") or 0.0) if kind == "window" else 0.0
                ops.append(dict(kind=kind, c=round(c, 4), w=round(width, 4), sill=round(sill, 3), head=round(min(head, w["h"] - 0.2), 3),
                                panes=int(pa.get("panes") or 2), leaves=str(pa.get("leaves") or "Single")))
            wall_json.append(dict(a=P.rp(w["a"]), b=P.rp(w["b"]), t=round(w["t"], 4), h=round(w["h"], 3), out=w["out"], ea=round(w["ea"], 4), eb=round(w["eb"], 4), open=ops))
        tmax = max([w["t"] for w in ext] or [0.23])
        floor = unary_union([indoor, outdoor]).buffer(tmax / 2, join_style=2)
        if not voids.is_empty: floor = floor.difference(voids.buffer(-tmax / 2, join_style=2))
        levels.append(dict(name=L.get("name", f"L{i}"), e=float(L.get("elevation", 0)), h=float(L.get("height", 3.2)), walls=wall_json))
        cover_l.append(unary_union([indoor, outdoor]).buffer(tmax / 2, join_style=2))
        floors.append(floor); indoor_l.append(indoor.buffer(tmax / 2, join_style=2)); walls_l.append((ext, outdoor, indoor, tmax))
    for i, lv in enumerate(levels):
        ext, outdoor, indoor, tmax = walls_l[i]
        lv["floor"] = P.multipoly_json(floors[i].buffer(0.05, join_style=2)) if i > 0 else []      # slab edge band 50 mm proud
        lv["mass"] = P.multipoly_json(indoor_l[i])                                                     # LOD1 massing
        above = cover_l[i + 1] if i + 1 < len(levels) else Polygon()      # level above incl. its voids (a void is still enclosed)
        roof = indoor_l[i].difference(above.buffer(0.01, join_style=2)) if not above.is_empty else indoor_l[i]
        roof = roof.buffer(-0.3, join_style=2).buffer(0.3, join_style=2).intersection(indoor_l[i])   # drop wall-thick slivers
        lv["roof"] = P.multipoly_json(roof.buffer(0.05, join_style=2))
        lv["roof_screed"] = P.multipoly_json(roof.buffer(-0.25, join_style=2))
        par = []
        upper_walls = unary_union([LineString([w["a"], w["b"]]).buffer(w["t"] / 2 + 0.06, cap_style=2) for w in walls_l[i + 1][0]]) if i + 1 < len(levels) and walls_l[i + 1][0] else Polygon()
        for p in P.polys(roof):
            for ln in P.lines(p.exterior.difference(above.buffer(0.02, join_style=2)).difference(upper_walls), 0.3):
                ln = P.orient_left_inside(ln, roof.buffer(0.01, join_style=2), 0.2)
                par.append(dict(line=P.line_json(ln), h=0.9 if i + 1 < len(levels) else 0.6, kind="roof"))
        if i > 0 and not outdoor.is_empty:
            own_walls = unary_union([LineString([w["a"], w["b"]]).buffer(tmax / 2 + 0.08, cap_style=2) for w in ext]) if ext else Polygon()
            o = outdoor.buffer(tmax / 2, join_style=2)
            edge = o.boundary.difference(indoor.buffer(tmax / 2 + 0.06, join_style=2)).difference(own_walls)
            for ln in P.lines(edge, 0.3):
                ln = P.orient_left_inside(ln, o.buffer(0.01, join_style=2), 0.2)
                par.append(dict(line=P.line_json(ln), h=1.05, kind="terrace" if o.area > 12 else "balcony"))
        lv["parapets"] = par
    plinth = floors[0].buffer(0.06, join_style=2)
    for wj in levels[0]["walls"]:                       # entrance steps where a ground-floor door opens off the plinth
        (ax, ay), (bx, by) = wj["a"], wj["b"]; L2 = math.dist(wj["a"], wj["b"]); dx, dy = (bx - ax) / L2, (by - ay) / L2
        o = wj["out"] or 1
        for op in wj["open"]:
            if op["kind"] == "door" and wj["out"] != 0:
                px, py = ax + dx * op["c"] - dy * o * (wj["t"] / 2 + 0.4), ay + dy * op["c"] + dx * o * (wj["t"] / 2 + 0.4)
                op["steps"] = not plinth.contains(Point(px, py))
    allw = [w for lv in levels for w in lv["walls"]]
    return dict(levels=levels, plinth=P.multipoly_json(plinth), plinth_band=P.multipoly_json(floors[0].buffer(0.09, join_style=2)), plinth_h=plinth_h,
                stats=dict(levels=len(levels), ext_walls=len(allw), openings=sum(len(w["open"]) for w in allw)))

def cabin_building(poly, door_toward, h=3.0, t=0.23):
    """Synthesise a one-room building (security cabin) on a polygon: door on the edge facing
    `door_toward` (world point), a window on every other edge longer than 1.8 m, roof with overhang."""
    ring = list(poly.exterior.coords)[:-1]
    if Polygon(ring).exterior.is_ccw is False: ring = ring[::-1]
    n = len(ring); walls = []
    mids = [((ring[k][0] + ring[(k + 1) % n][0]) / 2, (ring[k][1] + ring[(k + 1) % n][1]) / 2) for k in range(n)]
    dk = min(range(n), key=lambda k: math.dist(mids[k], door_toward))
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]; L = math.dist(a, b); ops = []
        if k == dk: ops.append(dict(kind="door", c=round(L / 2, 4), w=min(1.0, L - 0.3), sill=0, head=2.1, panes=1, leaves="Single"))
        elif L > 1.8: ops.append(dict(kind="window", c=round(L / 2, 4), w=min(1.2, L - 0.6), sill=0.9, head=2.1, panes=2, leaves="Single"))
        walls.append(dict(a=P.rp(a), b=P.rp(b), t=t, h=h, out=-1, ea=t / 2 if k % 2 == 0 else -t / 2, eb=t / 2 if k % 2 == 0 else -t / 2, open=ops))
    roof = poly.buffer(t / 2, join_style=2)
    eave = roof.buffer(0.45, join_style=2)
    ring = LineString(list(eave.exterior.coords)); ring = P.orient_left_inside(ring, eave, 0.2)
    lv = dict(name="Ground floor", e=0.0, h=h, walls=walls, floor=[], mass=P.multipoly_json(roof), roof=P.multipoly_json(eave),
              roof_screed=P.multipoly_json(eave.buffer(-0.3, join_style=2)), parapets=[dict(line=P.line_json(ring), h=0.3, kind="roof")])
    for wj in walls:
        for op in wj["open"]:
            if op["kind"] == "door": op["steps"] = True
    return dict(levels=[lv], plinth=P.multipoly_json(roof.buffer(0.06, join_style=2)), plinth_band=P.multipoly_json(roof.buffer(0.09, join_style=2)),
                plinth_h=0.3, stats=dict(levels=1, ext_walls=len(walls), openings=len(walls)))

# --------------------------------------------------------------------------------------- site --
def build_items(site, mp, envelopes, design_geo, cfg):
    """→ (items, instances, summary). cfg: dict of heights / spacings / seed (project.json → site)."""
    rnd = random.Random(cfg.get("seed", 7))
    ppm = _ppm(site)
    G = next(L for L in site["levels"] if abs(float(L.get("elevation", 0))) < 1e-6)
    nodes = _nodes(G, ppm)
    roads, plots, yards, osrs, cabins = [], [], [], [], []
    for sp in G.get("spaces", []):
        p = _space_poly(sp, nodes); lab = sp.get("label", "")
        if p is None: continue
        ids = {a.get("objectId") for a in sp.get("attachments", [])}
        if "road-with-math" in ids: roads.append((lab, p))
        elif "plot-with-math" in ids and sp.get("designInstance"): plots.append((lab, p, sp["designInstance"]))
        elif "plot-with-math" in ids and "YARD" in lab.upper(): yards.append((lab, p))
        elif "plot-with-math" in ids and ("OSR" in lab.upper() or "OPEN" in lab.upper() or "PARK" in lab.upper()): osrs.append((lab, p))
        elif "room-with-math" in ids and "CABIN" in lab.upper(): cabins.append((lab, p))
    bsegs, gates = [], []
    for s in G.get("segments", []):
        a, b = nodes.get(s.get("fromNodeId")), nodes.get(s.get("toNodeId"))
        if not a or not b or math.dist(a, b) < 0.05: continue
        if _att(s, "plot-boundary-with-math"):
            wa = _att(s, "wall-with-math"); pa = (wa or {}).get("params", {})
            bsegs.append(dict(a=a, b=b, t=float(pa.get("thickness", 0.23)), h=float(pa.get("height", 2.1))))
        elif _att(s, "opening-with-math") and s.get("layer") == "opening":
            gates.append(dict(a=a, b=b, w=math.dist(a, b)))
    bsm_items, ground_open, ramp_top_edges, bsm_outline = extract_basements(site, ppm, gates[0]["a"] if gates else (0, 0), cfg)
    # the canvas draws roads UNDER the plots (one estate-wide polygon): the carriageway is what no plot / yard / OSR / cabin covers
    covered = unary_union([p for _, p, _ in plots] + [p for _, p in yards] + [p for _, p in osrs] + [p for _, p in cabins] + [ground_open])
    road_u = unary_union([p for _, p in roads]).difference(covered).buffer(-0.02, join_style=2).buffer(0.02, join_style=2)
    dedup, seen = [], Polygon()
    for lab, p in roads:                                       # overlapping road polygons (turning circle on the road) → one surface each, no coplanar overlap
        q = p.difference(covered).difference(seen)
        if q.area > 0.5: dedup.append((lab, q))
        seen = seen.union(p)
    roads = dedup
    site_line = unary_union([LineString([s["a"], s["b"]]) for s in bsegs])
    items, inst = [], {"buildings": [], "trees": [], "shrubs": [], "lights": []}
    zg = cfg["ground"]
    def item(code, family, group, params, geometry, proto=None, unique=True):
        items.append(dict(code=code, family=family, group=group, params=params, geometry=geometry, proto=proto))
    items += bsm_items
    # roads + kerbs (kerbs drop at the main gate and at every plot gate)
    for k, (lab, p) in enumerate(roads):
        item(f"ROAD-{k + 1:02d}", "ROAD", "roads", {"top_z": zg["road"], "thickness": 0.2}, {"polygons": P.multipoly_json(p), "label": lab})
    # plots, walls, gates, driveways
    plot_u = unary_union([p for _, p, _ in plots])
    green = unary_union([p for _, p, _ in plots] + [p for _, p in osrs])
    env_world, gate_pts, front_lines, divider_lines = [], [], [], []
    for lab, p, di in plots:
        dname = di["design"]; pos = di["position"]; rot = -float(di.get("rotation", 0)); mir = bool(di.get("mirror"))
        env = envelopes.get(dname)
        fp = None
        if env:
            c, s_ = math.cos(math.radians(rot)), math.sin(math.radians(rot)); parts = []
            for fpr in env["footprint"]:                       # an envelope may hold several blocks
                ring = [(x * (-1 if mir else 1), -y) for x, y in fpr]
                parts.append(Polygon([(pos[0] + x * c - y * s_, -pos[1] + x * s_ + y * c) for x, y in ring]).buffer(0))
            fp = unary_union(parts); env_world.append(fp)
        num = int(re.sub(r"\D", "", lab) or 0) or len(inst["buildings"]) + 1
        proto = f"BLD_{dname.replace('-', '_')}" + ("_M" if mir else "")
        inst["buildings"].append(dict(name=f"BLD_P{num:02d}_{dname.replace('-', '_')}", proto=proto, design=dname, x=round(pos[0], 4), y=round(-pos[1], 4), z=zg["plot"], rot=rot, plot=num))
        item(f"PLOT-{num:02d}", "GROUND_PATCH", "plots", {"surface": "lawn", "top_z": zg["plot"], "edge": "brick"}, {"polygons": P.multipoly_json(p)})
        front = p.exterior.intersection(road_u.buffer(0.4, join_style=2))
        fl = max(P.lines(front, 1.0), key=lambda l: l.length, default=None)
        if fl is not None:
            target = fp.centroid if fp is not None else p.centroid
            sd = fl.project(target); gw = cfg["plot_gate_w"]; sd = min(max(sd, gw / 2 + 0.8), fl.length - gw / 2 - 0.8)
            g = fl.interpolate(sd); g2 = fl.interpolate(min(fl.length, sd + 0.05)); g1 = fl.interpolate(max(0, sd - 0.05))
            hd = math.degrees(math.atan2(g2.y - g1.y, g2.x - g1.x))
            gate_pts.append((g.x, g.y, gw))
            item(f"GATE-P{num:02d}", "GATE_SWING", "gates", {"width": gw, "height": 1.5, "pillar": 0.45, "base_z": zg["plot"]}, {"center": P.rp((g.x, g.y)), "heading": round(hd, 3)})
            front_lines.append(fl.difference(g.buffer(gw / 2 + 0.23)))
            # driveway: gate → plinth, perpendicular into the plot
            ux, uy = math.cos(math.radians(hd)), math.sin(math.radians(hd)); nx, ny = -uy, ux
            if not p.contains(Point(g.x + nx * 1.0, g.y + ny * 1.0)): nx, ny = -nx, -ny
            ray = LineString([(g.x, g.y), (g.x + nx * 12, g.y + ny * 12)])
            stop = 12.0
            if fp is not None and ray.intersects(fp): stop = max(1.0, Point(g.x, g.y).distance(ray.intersection(fp)) + 0.3)
            dw = sbox(-gw / 2, 0, gw / 2, stop)
            corners = [(g.x + ux * x + nx * y, g.y + uy * x + ny * y) for x, y in list(dw.exterior.coords)[:-1]]
            drive = Polygon(corners).intersection(p)
            item(f"DRIVE-P{num:02d}", "GROUND_PATCH", "plots", {"surface": "pavers", "top_z": zg["paving"], "edge": "none"}, {"polygons": P.multipoly_json(drive)})
    # plot walls: road frontage (low wall + railing) and plot dividers (solid), site boundary excluded
    shared = unary_union([p.exterior for _, p, _ in plots])
    dividers = shared.difference(road_u.buffer(0.45, join_style=2)).difference(site_line.buffer(0.6))
    fronts = unary_union(front_lines) if front_lines else None
    for k, ln in enumerate(P.lines(fronts, 0.4) if fronts is not None else []):
        item(f"PWALL-F{k + 1:02d}", "COMPOUND_WALL", "walls", {"height": 0.9, "thickness": 0.15, "pier_spacing": 3.0, "pier": 0.3, "railing_h": 0.6, "base_z": zg["plot"]}, {"line": P.line_json(ln)})
    for k, ln in enumerate(P.lines(dividers, 0.4)):
        item(f"PWALL-D{k + 1:02d}", "COMPOUND_WALL", "walls", {"height": 1.5, "thickness": 0.15, "pier_spacing": 3.0, "pier": 0.3, "railing_h": 0.0, "base_z": zg["plot"]}, {"line": P.line_json(ln)})
    # site boundary compound wall (2.1 m) with the main gate gap
    gate_cut = unary_union([LineString([g["a"], g["b"]]).buffer(0.65, cap_style=2) for g in gates]) if gates else Polygon()   # wall stops at the gate pillar's outer face
    for k, ln in enumerate(P.lines(site_line.difference(gate_cut), 0.3)):
        h = max(s["h"] for s in bsegs)
        item(f"CWALL-{k + 1:02d}", "COMPOUND_WALL", "walls", {"height": h, "thickness": 0.23, "pier_spacing": 3.0, "pier": 0.4, "railing_h": 0.0, "base_z": zg["road"]}, {"line": P.line_json(ln)})
    for k, g in enumerate(gates):
        item(f"GATE-MAIN-{k + 1}", "GATE_SLIDING", "gates", {"width": round(g["w"], 3), "height": 2.1, "pillar": 0.6}, {"a": P.rp(g["a"]), "b": P.rp(g["b"])})
    # kerbs
    cuts = unary_union([Point(x, y).buffer(w / 2 + 0.3) for x, y, w in gate_pts] + [LineString([g["a"], g["b"]]).buffer(1.0, cap_style=2) for g in gates]
                       + [LineString(e).buffer(0.3, cap_style=2) for e in ramp_top_edges] + [Polygon()])   # the road runs on at a ramp's top end
    kerb_lines = []
    for p in P.polys(road_u):
        for ring in [p.exterior] + list(p.interiors):
            for ln in P.lines(LineString(ring.coords).difference(cuts), 0.3):
                ln = P.orient_left_inside(ln, road_u.buffer(0.01)); kerb_lines.append(ln)
    for k, ln in enumerate(kerb_lines):
        item(f"KERB-{k + 1:02d}", "KERB", "roads", {"top_z": zg["kerb"], "road_z": zg["road"]}, {"line": P.line_json(ln, 0.001)})
    for k, (lab, p) in enumerate(yards):
        item(f"YARD-{k + 1:02d}", "GROUND_PATCH", "open", {"surface": "concrete", "top_z": zg["yard"], "edge": "kerb"}, {"polygons": P.multipoly_json(p)})
    for k, (lab, p) in enumerate(osrs):
        item(f"OSR-{k + 1:02d}", "GROUND_PATCH", "open", {"surface": "lawn", "top_z": zg["plot"], "edge": "brick"}, {"polygons": P.multipoly_json(p)})
    for k, (lab, p) in enumerate(cabins):
        tgt = gates[0]["a"] if gates else p.centroid.coords[0]
        item(f"CABIN-{k + 1:02d}", "BUILDING", "buildings_unique", {"lod": 2, "base_z": zg["yard"] if yards else zg["plot"]}, cabin_building(p, tgt))
    # vegetation + lights (seeded, deterministic)
    blocked = unary_union(env_world + [Point(x, y).buffer(w / 2 + 2.0) for x, y, w in gate_pts] + [road_u.buffer(0.6)]).buffer(1.2)
    species = cfg["tree_species"]
    def plant(x, y, kind, z):
        sp = rnd.choice(species) if kind == "tree" else kind
        inst["trees" if kind == "tree" else ("shrubs" if kind == "SHRUB" else "lights")].append(
            dict(name=f"{sp}_{len(inst['trees']) + len(inst['shrubs']) + len(inst['lights']) + 1:04d}", proto=f"{sp}", x=round(x, 3), y=round(y, 3), z=z,
                 rot=round(rnd.uniform(0, 360), 1), scale=round(rnd.uniform(0.85, 1.15), 3)))
    for ln in kerb_lines:
        for x, y, hd in P.points_along(ln, cfg["tree_spacing"], offset=-cfg["tree_offset"]):
            pt = Point(x, y)
            if green.contains(pt) and not blocked.contains(pt): plant(x, y, "tree", zg["plot"])
        if ln.length < cfg["light_spacing"] * 0.6: continue
        for x, y, hd in P.points_along(ln, cfg["light_spacing"], start=cfg["light_spacing"] / 3, offset=0.75):   # road side, in front of the kerb
            pt = Point(x, y)
            if road_u.buffer(-0.3).contains(pt) and not unary_union([Point(gx, gy).buffer(gw / 2 + 1.5) for gx, gy, gw in gate_pts] + [Polygon()]).contains(pt):
                inst["lights"].append(dict(name=f"LIGHT_{len(inst['lights']) + 1:03d}", proto="STREET_LIGHT", x=round(x, 3), y=round(y, 3), z=zg["road"], rot=round(hd + 90, 2), scale=1.0))
    for lab, p in osrs:
        inner = p.buffer(-1.5)
        for x, y in P.jitter_grid(inner, cfg["osr_spacing"], rnd):
            plant(x, y, "tree", zg["plot"])
        for ln in P.lines(inner.boundary, 1):
            for x, y, hd in P.points_along(ln, 1.3):
                if not blocked.contains(Point(x, y)): plant(x, y, "SHRUB", zg["plot"])
    for ln in front_lines:
        for l2 in P.lines(ln, 0.5):
            for side in (0.7, -0.7):
                for x, y, hd in P.points_along(l2, 1.2, offset=side):
                    pt = Point(x, y)
                    if plot_u.contains(pt) and not road_u.buffer(0.3).contains(pt) and not blocked.difference(road_u.buffer(1.8)).contains(pt): plant(x, y, "SHRUB", zg["plot"])
    # terrain with earth dumps in the free margin
    allx = [x for x, _ in nodes.values()]; ally = [y for _, y in nodes.values()]
    m = cfg["terrain_margin"]; tb = (min(allx) - m, min(ally) - m, max(allx) + m, max(ally) + m)
    occupied = unary_union([p for _, p in roads] + [p for _, p, _ in plots] + [p for _, p in yards] + [p for _, p in osrs] + [p for _, p in cabins] + [site_line.buffer(1.5)])
    free = sbox(*tb).buffer(-2).difference(occupied.buffer(2.5))
    dumps = []
    tries = 0
    while len(dumps) < cfg["dumps"] and tries < 4000:
        tries += 1
        x, y = rnd.uniform(tb[0], tb[2]), rnd.uniform(tb[1], tb[3]); r = rnd.uniform(1.6, 4.2)
        if free.contains(Point(x, y).buffer(r)) and all(math.dist((x, y), (d[0], d[1])) > d[2] + r for d in dumps):
            dumps.append((round(x, 3), round(y, 3), round(r, 3), round(rnd.uniform(0.35, 1.3), 3), rnd.randint(0, 9999)))
    item("TERRAIN", "TERRAIN", "terrain", {"base_z": zg["terrain"], "roughness": cfg["roughness"], "cell": cfg["terrain_cell"], "seed": cfg.get("seed", 7)},
         {"bounds": [round(v, 3) for v in tb], "dumps": dumps, "holes": P.multipoly_json(bsm_outline) if not bsm_outline.is_empty else []})
    summary = dict(basement_items=len(bsm_items), roads=len(roads), plots=len(plots), yards=len(yards), osr=len(osrs), cabins=len(cabins), boundary_segments=len(bsegs), main_gates=len(gates),
                   kerb_lines=len(kerb_lines), plot_gates=len(gate_pts), dumps=len(dumps), **{f"inst_{k}": len(v) for k, v in inst.items()})
    return items, inst, summary

# ----------------------------------------------------------------------------------- basements --
def extract_basements(site, ppm, entry_pt, cfg):
    """Basement levels (elevation < 0) → one BASEMENT item per level + one RAMP item per ramp.

    Level outline = its 'BASEMENT …' room (else the union of its spaces). Ramps are road-with-math
    spaces; a footprint drawn on several levels is one ramp: bottom = the lowest level it is drawn on,
    top = the level directly above. The first ramp's top end is the end nearer the site entry, each
    next ramp's top end is the end nearer the previous ramp's bottom. Slabs: each basement floor
    (300 mm, openings where a ramp descends from it) and the ground deck over the top basement (250 mm,
    under the road base, opening over the ground ramp). Walls: every wall segment of the level up to
    the slab above, except the ramp side walls (the RAMP family builds them following the slope) and
    walls standing inside a ramp footprint on the level it lands on. Bays: plot-with-math stalls →
    painted lines (open on the aisle side, opposite the stall direction) + wheel stops.
    Returns (items, ground_open polygon, ramp top edges at ground, outline of the top basement)."""
    lv = sorted([L for L in site["levels"] if float(L.get("elevation", 0)) < -1e-6], key=lambda L: -float(L["elevation"]))
    if not lv: return [], Polygon(), [], Polygon()
    ground_slab = cfg.get("deck_top", -0.20); deck_t = 0.25; slab_t = 0.30
    elev = [0.0] + [float(L["elevation"]) for L in lv]
    data, ramps = [], []
    for k, L in enumerate(lv):
        nodes = _nodes(L, ppm); outline, bays, walls = None, [], []
        for sp in L.get("spaces", []):
            p = _space_poly(sp, nodes)
            if p is None: continue
            ids = {a.get("objectId") for a in sp.get("attachments", [])}
            if "road-with-math" in ids:
                hit = next((r for r in ramps if r["poly"].intersection(p).area > 0.8 * min(r["poly"].area, p.area)), None)
                if hit: hit["levels"].append(k + 1)
                else: ramps.append(dict(poly=p, levels=[k + 1], label=sp.get("label", "RAMP")))
            elif "plot-with-math" in ids:
                pa = next(a for a in sp["attachments"] if a["objectId"] == "plot-with-math").get("params", {})
                bays.append((p, str(pa.get("direction", "North"))))
            elif sp.get("label", "").upper().startswith("BASEMENT"):
                outline = p if outline is None else outline.union(p)
        if outline is None:
            outline = unary_union([q for q in (_space_poly(sp, nodes) for sp in L.get("spaces", [])) if q is not None])
        for s in L.get("segments", []):
            wa = _att(s, "wall-with-math"); a, b = nodes.get(s.get("fromNodeId")), nodes.get(s.get("toNodeId"))
            if wa and a and b and math.dist(a, b) > 0.05: walls.append(dict(a=a, b=b, t=float(wa["params"].get("thickness", 0.23))))
        data.append(dict(L=L, outline=outline, bays=bays, walls=walls))
    prev_pt = entry_pt; ramp_geo = []
    mid = lambda e: ((e[0][0] + e[1][0]) / 2, (e[0][1] + e[1][1]) / 2)
    for r in sorted(ramps, key=lambda r: max(r["levels"])):
        bot = max(r["levels"]); top = bot - 1
        ring = list(r["poly"].minimum_rotated_rectangle.exterior.coords)[:4]
        edges = [(ring[i], ring[(i + 1) % 4]) for i in range(4)]
        ends = sorted(edges, key=lambda e: math.dist(*e))[:2]
        te = min(ends, key=lambda e: math.dist(mid(e), prev_pt)); be = ends[1] if te is ends[0] else ends[0]
        prev_pt = mid(be)
        ramp_geo.append(dict(r=r, top=top, bot=bot, te=te, be=be))
    items, ground_open, top_edges = [], Polygon(), []
    for k, g in enumerate(ramp_geo):
        zt, zb = elev[g["top"]], elev[g["bot"]]
        if g["top"] == 0:
            ground_open = ground_open.union(g["r"]["poly"]); top_edges.append([P.rp(g["te"][0]), P.rp(g["te"][1])])
        (t0, t1), (b0, b1) = g["te"], g["be"]
        if math.dist(t0, b1) < math.dist(t0, b0): b0, b1 = b1, b0          # t0–b0 and t1–b1 are the long sides
        items.append(dict(code=f"RAMP-{k + 1}", family="RAMP", group="basement",
                          params={"z_top": zt, "z_bottom": zb, "guard_h": 1.05},
                          geometry={"top": [P.rp(t0), P.rp(t1)], "bottom": [P.rp(b0), P.rp(b1)], "label": g["r"]["label"], "levels": [g["top"], g["bot"]]}, proto=None))
    ramp_sides = unary_union([LineString(sd).buffer(0.25) for g in ramp_geo
                              for sd in ((g["te"][0], g["be"][0]), (g["te"][0], g["be"][1]), (g["te"][1], g["be"][0]), (g["te"][1], g["be"][1]))] + [Polygon()])
    for k, d in enumerate(data):
        e = elev[k + 1]; above = elev[k]
        opens = unary_union([g["r"]["poly"] for g in ramp_geo if g["top"] == k + 1] + [Polygon()])
        lands = [g["r"]["poly"] for g in ramp_geo if g["bot"] == k + 1]
        walls = []
        for w in d["walls"]:
            ln = LineString([w["a"], w["b"]]); m = ln.interpolate(0.5, normalized=True)
            if ln.intersection(ramp_sides).length > 0.8 * ln.length: continue           # ramp side walls (any level) → RAMP family
            if any(lp.buffer(-0.1).contains(m) for lp in lands): continue                 # under the ramp on its landing level
            walls.append(dict(a=P.rp(w["a"]), b=P.rp(w["b"]), t=w["t"]))
        bays = []
        for p, direc in d["bays"]:
            ring = list(p.exterior.coords)[:-1]
            if len(ring) != 4: continue
            dv = {"North": (0, 1), "South": (0, -1), "East": (1, 0), "West": (-1, 0)}.get(direc, (0, 1)); c = p.centroid
            ed = [(ring[i], ring[(i + 1) % 4]) for i in range(4)]
            short = sorted(range(4), key=lambda i: math.dist(*ed[i]))[:2]
            dot = lambda i: (mid(ed[i])[0] - c.x) * dv[0] + (mid(ed[i])[1] - c.y) * dv[1]
            bays.append(dict(ring=[P.rp(q) for q in ring], open=min(short, key=dot), head=max(short, key=dot)))
        deck = d["outline"].difference(ground_open) if k == 0 else Polygon()
        floor = d["outline"].difference(opens)
        name = str(d["L"].get("name", f"B{k + 1}"))
        items.append(dict(code="BSMT-" + name.replace("Basement ", "B").replace(" ", ""), family="BASEMENT", group="basement",
                          params={"floor_z": e, "slab": slab_t, "wall_top": (ground_slab - deck_t) if k == 0 else (above - slab_t), "deck_top": ground_slab, "deck": deck_t},
                          geometry={"floor": P.multipoly_json(floor), "deck": P.multipoly_json(deck), "walls": walls, "bays": bays, "name": name}, proto=None))
    return items, ground_open, top_edges, data[0]["outline"]

def mirror_building(geo):
    """Mirrored copy of a building geometry (x → -x) for mirrored placements: no negative scale ever."""
    M = lambda pt: [-pt[0], pt[1]]
    def mp(polys): return [[[M(p) for p in o], [[M(p) for p in h] for h in hs]] for o, hs in polys]
    out = json.loads(json.dumps(geo))
    for lv in out["levels"]:
        for w in lv["walls"]:
            w["a"], w["b"] = M(w["a"]), M(w["b"]); w["out"] = -w["out"]
        for k in ("floor", "roof", "roof_screed", "mass"): lv[k] = mp(lv.get(k, []))
        for pa in lv.get("parapets", []): pa["line"] = [M(p) for p in pa["line"]][::-1]
    for k in ("plinth", "plinth_band"): out[k] = mp(out.get(k, []))
    return out
