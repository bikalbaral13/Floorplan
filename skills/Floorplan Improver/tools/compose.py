"""S5 compose: shell canvas (S3) + resolve.json (S4) + roombrief -> the full room canvas.

    python tools/compose.py <project_dir>

Every placed attachment carries its object's real params from resolve.json PLUS the deck spec and
provenance group (specId, specNote, deckSlides, refImages, productUrl, spec_*), so the canvas holds
everything the deck said about it. Writes projects/<CODE>/<CODE>.room.canvas.json + compose.report.txt.

Conventions measured on the engine (S5 notes in AGENTS.md):
- canvas px = plan px - origin_px (ppm = 1/m_per_px); canvas y points DOWN.
- FRAME: u = (cos r, sin r) in canvas axes, v = perp(u) = (-u_y, u_x); flipSide negates v.
- library wall finishes (fluted / upholstered panel, TV) build toward -v from their host line, so they
  are hosted on FACE LINES: a non-wall segment on the room-side face, ordered so the room is on -v.
- sofa / chair backs are on +v; the reception desk's visitor side is -v.
"""
import json, math, os, sys
from pathlib import Path

# Skills this step reads from (the runner names every skill the pipeline pins as BP_SKILL_<ID>; beside it in the
# repo's skills/ folder otherwise): the tracer's geometry.provenance, and the Object Resolver's own objects.
SKILLS = Path(__file__).resolve().parent.parent.parent
TRACER = Path(os.environ.get("BP_SKILL_FLOORPLAN_TRACER") or SKILLS / "Floorplan Tracer")
RESOLVER = Path(os.environ.get("BP_SKILL_OBJECT_RESOLVER") or SKILLS / "Object Resolver")
sys.path.insert(0, str(TRACER / "tools"))
from geometry import provenance  # noqa: E402

LAYERS_EXTRA = [("finish", "Finish", "#a16207"), ("ceiling", "Ceiling", "#0369a1"), ("lighting", "Lighting", "#ca8a04"),
                ("furniture", "Furniture", "#7c3aed"), ("signage", "Signage", "#0B2D6B"), ("camera", "Camera", "#0f766e")]


class Canvas:
    def __init__(self, doc, origin):
        self.doc, self.ox, self.oy = doc, origin[0], origin[1]
        self.seq = 0
        self.log = []
        doc.setdefault("graphAttrs", {"nodes": {}, "segments": {}})

    def nid(self, p):
        self.seq += 1
        return f"L0-d{p}{self.seq:03x}"

    def c(self, px):  # plan px -> canvas px
        return [round(px[0] - self.ox, 3), round(px[1] - self.oy, 3)]

    def node(self, xy, layer="0"):
        n = {"id": self.nid("n"), "x": xy[0], "y": xy[1], "layer": layer}
        self.doc["nodes"].append(n)
        return n

    def att(self, path, params, t=0.5):
        stem = Path(path).stem
        return {"id": self.nid("att"), "objectId": f"{stem}-with-math", "objectPath": path, "params": params, "t": t, "flip": False}

    def node_object(self, xy, path, params, layer):
        n = self.node(xy, "0")
        n.setdefault("attachments", []).append(self.att(path, params, t=0))
        sid = self.nid("obj")
        self.doc["segments"].append({"id": sid, "fromNodeId": n["id"], "toNodeId": n["id"], "layer": layer, "thickness": 0.5,
                                     "color": "#334155", "dashed": False, "mode": "line", "method": "center", "segmentType": "wall"})
        self.doc["graphAttrs"]["nodes"]["|".join(sorted([f"{sid}:start", f"{sid}:end"]))] = {"node-type": "object"}
        return n

    def line(self, a, b, layer, label, attachments):
        na, nb = self.node(a, layer), self.node(b, layer)
        s = {"id": self.nid("s"), "fromNodeId": na["id"], "toNodeId": nb["id"], "layer": layer, "thickness": 1, "color": "#a16207",
             "dashed": False, "lineStyle": "solid", "mode": "line", "method": "center", "segmentType": "line", "hatch": False,
             "showLabel": False, "label": label, "attachments": attachments}
        self.doc["segments"].append(s)
        return s

    def rect_space(self, r, layer, label, attachments):
        x0, y0, x1, y1 = r
        ids = [self.node(self.c(p), layer)["id"] for p in [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]]
        sp = {"id": self.nid("sp"), "nodeIds": ids, "layer": layer, "label": label, "showLabel": False, "roomType": "area",
              "fill": "rgba(0,0,0,0)", "stroke": "#0369a1", "fillOpacity": 0, "attachments": attachments}
        self.doc["spaces"].append(sp)
        return sp


def rot_from_u(u):
    return round(math.degrees(math.atan2(u[1], u[0])) % 360, 2)


def unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    L = math.hypot(dx, dy)
    return [dx / L, dy / L], L


def main(project_dir):
    P = Path(project_dir)
    code = P.name
    doc = json.loads((P / f"{code}.canvas.json").read_text(encoding="utf-8"))
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
    tr = json.loads((P / "trace.px.json").read_text(encoding="utf-8"))
    items = {i["id"]: i for i in brief["items"]}
    walls = {w["id"]: w for w in tr["walls"]}
    m = tr["scale"]["ref_mm"] / 1000 / math.dist(*tr["scale"]["ref_px"])
    C = Canvas(doc, tr["origin_px"])
    ids = {l["id"] for l in doc["layers"]}
    for k, (i, n, col) in enumerate(LAYERS_EXTRA):
        if i not in ids:
            doc["layers"].append({"id": i, "name": n, "color": col, "visible": True, "locked": False, "order": len(doc["layers"])})

    # the room's centroid (plan px) decides which side of a wall is "inside"
    ring = [p for z in brief["zones"] for p in z["points_px"]]
    room_c = [sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)]

    def spec(item_id, params):
        out = provenance(items[item_id], code)
        out.update(params)
        return out

    # an object's own material binding lives in its definition; the renderer reads only the attachment's
    # params, so copy the defaults onto every attachment that does not state its own
    defaults = {}
    # the S3 catalog: <project>/catalog.json (the stage pulls it), else the Object Resolver's work/catalog.json
    cat = next((c for c in [P / "catalog.json", RESOLVER / "work" / "catalog.json"] if c.exists()), P / "catalog.json")
    if cat.exists():
        for o in json.loads(cat.read_text(encoding="utf-8"))["objects"]:
            defaults[o["path"]] = {q["id"]: q["value"] for q in o["params"] if q["id"] in ("materialPath", "finishes") and q["value"]}
    for f in (RESOLVER / "objects" / "out").glob("*.json"):
        if f.name.startswith("_"):
            continue
        d = json.loads(f.read_text(encoding="utf-8"))
        props = next(n for n in d["nodes"] if n["data"]["tool"] == "input-props")["data"]["params"]["props"]
        cat_name = d.get("category", "Architectural")
        defaults[f"Objects/{cat_name}/{f.name}"] = {q["id"]: q["value"] for q in props if q["id"] in ("materialPath", "finishes") and q["value"]}

    def face_line(wall_id, from_m, to_m, extra=0.0):
        """Room-side face of a wall run, ordered so the room is on -v. Returns canvas a, b, length m."""
        w = walls[wall_id]
        u, Lpx = unit(w["a"], w["b"])
        off = (w["t_mm"] / 2000 + extra) / m  # px
        nrm = [-u[1], u[0]]  # +v of a->b in canvas axes
        mid = [(w["a"][0] + w["b"][0]) / 2, (w["a"][1] + w["b"][1]) / 2]
        side = 1 if (room_c[0] - mid[0]) * nrm[0] + (room_c[1] - mid[1]) * nrm[1] > 0 else -1
        p = lambda d: [w["a"][0] + u[0] * d / m + nrm[0] * side * off, w["a"][1] + u[1] * d / m + nrm[1] * side * off]
        a, b = p(from_m), p(min(to_m, Lpx * m))
        if side > 0:  # room on +v of a->b: reverse so it is on -v
            a, b = b, a
        return C.c(a), C.c(b), round(math.dist(a, b) * m, 4)

    def segs_of(wall_id):
        lab = walls[wall_id]["label"]
        return [s for s in doc["segments"] if s.get("label") == lab]

    for b in res["bindings"]:
        it, st, path, h = b["item"], b["status"], b["object"], b["host"]
        if st == "omitted":
            C.log.append(f"{it}: omitted in the review")
            continue
        if st == "render-only":
            C.log.append(f"{it}: render-only ({b.get('note', '')})")
            continue
        path_obj = path
        P0 = dict(b.get("params", {}))

        if "space" in h:  # finish on an existing zone space: merge into its room attachment
            zl = next(z["label"] for z in brief["zones"] if z["id"] == h["space"])
            sp = next(s for s in doc["spaces"] if s["label"] == zl)
            sp["attachments"][0]["params"].update(spec(it, P0))
            C.log.append(f"{it}: {h['space']} room <- {P0}")

        elif "rect_px" in h and path_obj.endswith("planter-box.json"):
            x0, y0, x1, y1 = h["rect_px"]
            L, W = (y1 - y0) * m, (x1 - x0) * m
            n = C.node_object(C.c([(x0 + x1) / 2, (y0 + y1) / 2]), path_obj,
                              spec(it, {**P0, "length": round(L, 3), "width": round(W, 3), "rotation": 90, "fitMode": "Off"}), "furniture")
            C.log.append(f"{it}: planter {L:.2f} x {W:.2f} m at {n['x']},{n['y']}")

        elif "rect_px" in h:
            layer = "ceiling"
            C.rect_space(h["rect_px"], layer, h.get("label", it), [C.att(path_obj, spec(it, P0), t=0)])
            r = h["rect_px"]
            C.log.append(f"{it}: {Path(path_obj).stem} on {(r[2] - r[0]) * m:.2f} x {(r[3] - r[1]) * m:.2f} m zone")

        elif "nodes_px" in h or "node_px" in h:
            pts = h.get("nodes_px") or [h["node_px"]]
            per = b.get("per_instance", [{}] * len(pts))
            layer = "lighting" if path_obj.endswith("pendant.json") else "furniture"
            for k, p in enumerate(pts):
                q = dict(P0, **per[k % len(per)])
                if "face_toward_px" in h:  # back (+v) away from the target
                    v, _ = unit(h["face_toward_px"], p)
                    q["rotation"] = rot_from_u([v[1], -v[0]])
                if "axis_px" in h:  # desk: u along its long side; visitor side (-v) toward the given point
                    u, _ = unit(*h["axis_px"])
                    q["rotation"] = rot_from_u(u)
                    vt = [h["visitor_toward_px"][0] - p[0], h["visitor_toward_px"][1] - p[1]]
                    q["flipSide"] = (-(-u[1]) * vt[0] - u[0] * vt[1]) < 0
                C.node_object(C.c(p), path_obj, spec(it, q), layer)
            C.log.append(f"{it}: {len(pts)} x {Path(path_obj).stem}")

        elif "pieces_px" in h:  # sofa L: back (+v) toward the given wall point
            for pc in h["pieces_px"]:
                v, _ = unit(pc["centre"], pc["back_toward"])
                q = dict(P0, length=pc["length"], seats=pc["seats"], rotation=rot_from_u([v[1], -v[0]]))
                C.node_object(C.c(pc["centre"]), path_obj, spec(it, q), "furniture")
            C.log.append(f"{it}: sofa in {len(h['pieces_px'])} pieces")

        elif "runs" in h or ("wall" in h and "from_m" in h):
            runs = h.get("runs") or [{"wall": h["wall"], "from_m": h.get("from_m", 0), "to_m": h.get("to_m", 1e9)}]
            for r in runs:
                extra = 0.09 if path_obj.endswith("cove-light.json") else 0.0
                a, bb, L = face_line(r["wall"], r["from_m"], r["to_m"], extra)
                q = dict(P0, **r.get("params", {}))
                if "length" in {p for p in ("length",)} and not path_obj.endswith(("tv.json", "logo-signage.json")):
                    q["length"] = L
                if path_obj.endswith("logo-signage.json"):
                    q.update(wallHalfThk=0.06, flipSide=True)  # built toward +v: flip onto the room side, clear of the moss
                C.line(a, bb, "finish", f"{it} on {r['wall']} {r['from_m']}-{min(r['to_m'], 99):g} m", [C.att(path_obj, spec(it, q))])
                C.log.append(f"{it}: {Path(path_obj).stem} {L:.2f} m on {r['wall']} face")

        elif h.get("wall") and h.get("run") == "every piece" and path_obj.endswith("window.json"):
            for s in segs_of(h["wall"]):
                L = math.dist(*[(n["x"], n["y"]) for n in doc["nodes"] if n["id"] in (s["fromNodeId"], s["toNodeId"])]) * m
                q = {k: v for k, v in P0.items() if k != "panesEveryM"}
                q.update(width=round(L, 4), panes=max(1, round(L / P0["panesEveryM"])), wallDepth=walls[h["wall"]]["t_mm"] / 1000)
                wall_att = s["attachments"][0]
                wall_att["params"]["height"] = tr["level"]["height_m"]
                s.update(layer="window", isObjectOpening=True)
                s["attachments"] = [wall_att, C.att(path_obj, spec(it, q))]
                C.log.append(f"{it}: glass partition {L:.2f} m, {q['panes']} panes")
            dp = b["doors"]["params"]
            for s in doc["segments"]:
                for a in s.get("attachments", []):
                    if a["objectId"] == "door-with-math" and a["params"].get("specId") == it:
                        a["params"].update(dp)
                        C.log.append(f"{it}: door {s['label']} -> glass leaf, black frame")

        elif h.get("wall") and h.get("run") == "every piece":  # wall material
            for s in segs_of(h["wall"]):
                s["attachments"][0]["params"].update(spec(it, P0))
            C.log.append(f"{it}: {h['wall']} wall material {P0.get('materialPath')}")
        else:
            raise SystemExit(f"{it}: host {h} not handled")

    # cameras: the deck's own views (final renders / review asks) + eye-level corners; rotation = view direction
    for k, cam in enumerate(res.get("cameras", [])):
        u, _ = unit(cam["at_px"], cam["look_px"])
        q = dict(res.get("camera_params", {}), rotation=rot_from_u(u), shotName=cam["name"], shotOrder=k + 1, shotActive=True,
                 specId=cam["id"], deckSlides=",".join(map(str, cam["slides"])), specNote=cam["name"])
        C.node_object(C.c(cam["at_px"]), "Objects/Architectural/camera.json", q, "camera")
        C.log.append(f"{cam['id']}: camera rot {q['rotation']} - {cam['name']}")

    filled = 0
    for coll in (doc["nodes"], doc["segments"], doc["spaces"]):
        for host in coll:
            for a in host.get("attachments", []):
                # the renderer ranks params.finishes > its global rules > params.materialPath, so a material the
                # BRIEF chose would lose to a generic rule ("fluted panel -> oak"); make it the finishes fallback
                mp, fin = a["params"].get("materialPath"), a["params"].get("finishes", "")
                if mp and a["params"].get("specId") and "*=" not in fin:
                    a["params"]["finishes"] = (fin + "; " if fin else "") + f"*={mp}"
                for k, v in defaults.get(a.get("objectPath"), {}).items():
                    if k not in a["params"]:
                        a["params"][k] = v
                        filled += 1
    C.log.append(f"material defaults copied onto attachments: {filled} params")

    doc["settings"]["keywords"] = f"{brief['project']} - {brief['room']} (build-from-deck S5 composed room)"
    out = P / f"{code}.room.canvas.json"
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    n_att = sum(len(s.get("attachments", [])) for s in doc["segments"]) + sum(len(n.get("attachments", [])) for n in doc["nodes"]) \
        + sum(len(s.get("attachments", [])) for s in doc["spaces"])
    with_spec = sum(1 for coll in (doc["segments"], doc["nodes"], doc["spaces"]) for x in coll for a in x.get("attachments", []) if a["params"].get("specId"))
    C.log.append(f"canvas: {len(doc['nodes'])} nodes, {len(doc['segments'])} segments, {len(doc['spaces'])} spaces, "
                 f"{n_att} attachments ({with_spec} carry deck spec params) -> {out.name}")
    (P / "compose.report.txt").write_text("\n".join(C.log) + "\n", encoding="utf-8")
    print("\n".join(C.log))


if __name__ == "__main__":
    main(sys.argv[1])
