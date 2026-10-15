"""S3 geometry: trace.px.json (agent-read plan pixels) + roombrief.json -> tracer-plan/1 + canvas shell.

    python tools/geometry.py <project_dir> <deck_dir>

- scale from the trace's reference (desk 3300 mm), checked against its other references
- walls cut at their openings; frame: X east, Y north, metres, origin = trace origin_px
- every wall must lie on the designer's zone outline (roombrief zones) within TOL_PX
- canvas via the Floorplan Tracer's own exporter (one place knows the editor format)
- zones become spaces; walls/zones that an item names get the spec + provenance params
Writes <project>/plan.json, <project>/<CODE>.canvas.json, <work>/geometry_check.png
"""
import importlib.util, json, math, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TRACER = HERE.parent.parent / "floorplan-tracer-pipeline"
TOL_PX = 3.0
R2_PROJECTS = "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev/Projects"  # images: Projects/<CODE>/3-build/build-from-deck/output/images/


def load_tracer_canvas():
    spec = importlib.util.spec_from_file_location("tracer_canvas", TRACER / "exporters" / "canvas.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def seg_dist(p, a, b):
    ax, ay, bx, by = *a, *b
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy or 1)))
    return math.hypot(p[0] - ax - t * dx, p[1] - ay - t * dy)


def on_outline(p, rings):
    return min(seg_dist(p, r[i], r[(i + 1) % len(r)]) for r in rings for i in range(len(r)))


def snap_zones(rings, walls, tol=0.25):
    """Hand-drawn zone outlines -> shared edges on wall centrelines: a vertex near another zone's
    vertex takes the mean; then a vertex near a wall line (or two) moves onto it (corner = both)."""
    pts = [p for r in rings for p in r]
    for i, p in enumerate(pts):
        near = [q for q in pts if q is not p and math.hypot(q[0] - p[0], q[1] - p[1]) < tol]
        if near:
            grp = [p] + near
            p[0] = q0 = sum(q[0] for q in grp) / len(grp); p[1] = q1 = sum(q[1] for q in grp) / len(grp)
            for q in near:
                q[0], q[1] = q0, q1
    lines = [(w["a"], w["b"]) for w in walls]
    for p in pts:
        hits = [(a, b) for a, b in lines if seg_dist(p, a, b) < tol]
        if len(hits) >= 2:  # corner: intersection of the first two non-parallel lines
            (a, b), (c, d) = hits[0], next((h for h in hits[1:] if abs((h[1][0] - h[0][0]) * (hits[0][1][1] - hits[0][0][1]) - (h[1][1] - h[0][1]) * (hits[0][1][0] - hits[0][0][0])) > 1e-6), (None, None))
            if c is not None:
                x1, y1, x2, y2, x3, y3, x4, y4 = *a, *b, *c, *d
                den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
                t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
                p[0], p[1] = x1 + t * (x2 - x1), y1 + t * (y2 - y1)
                continue
        if hits:
            a, b = hits[0]
            dx, dy = b[0] - a[0], b[1] - a[1]
            t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)
            p[0], p[1] = a[0] + t * dx, a[1] + t * dy
    return [[[round(x, 4), round(y, 4)] for x, y in r] for r in rings]


def provenance(item, code):
    """The flat param group every placed object carries (attachment params are primitives only)."""
    imgs = [f"{R2_PROJECTS}/{code}/3-build/build-from-deck/output/images/{Path(f).name}" for f in item.get("refImages", [])]
    p = {"specId": item["id"], "specCategory": item["category"], "specNote": item.get("note", ""),
         "deckSlides": ",".join(map(str, item["slides"])), "refImages": ",".join(imgs),
         "productUrl": (item.get("productUrls") or [""])[0]}
    for k, v in item["params"].items():
        p[f"spec_{k}"] = v
    return p


def main(project_dir, deck_dir):
    P, D = Path(project_dir), Path(deck_dir)
    code = P.name
    tr = json.loads((P / "trace.px.json").read_text(encoding="utf-8"))
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    items = {i["id"]: i for i in brief["items"]}
    findings = []

    # scale
    (ax, ay), (bx, by) = tr["scale"]["ref_px"]
    m_per_px = tr["scale"]["ref_mm"] / 1000 / math.hypot(bx - ax, by - ay)
    ppm = 1 / m_per_px
    ox, oy = tr["origin_px"]
    W = lambda p: [round((p[0] - ox) * m_per_px, 4), round((oy - p[1]) * m_per_px, 4)]
    findings.append(f"scale {m_per_px * 1000:.2f} mm/px ({tr['scale']['method']})")

    # walls must sit on the designer's zone outlines
    rings = [z["points_px"] for z in brief["zones"]]
    for w in tr["walls"]:
        d = max(on_outline(w["a"], rings), on_outline(w["b"], rings))
        findings.append(f"{'ok  ' if d <= TOL_PX else 'FAIL'} {w['id']} on zone outline (max {d:.1f} px)")

    # cut walls at openings -> tracer-plan/1
    H = tr["level"]["height_m"]
    lvl = {"id": tr["level"]["id"], "name": tr["level"]["name"], "elevation": 0.0, "height": H,
           "walls": [], "openings": [], "spaces": [], "columns": [], "stairs": [], "fixtures": [], "not_placed": []}
    for w in tr["walls"]:
        a, b = w["a"], w["b"]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        t_of = lambda p: ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / L / L
        ops = sorted((o for o in tr["openings"] if o["wall"] == w["id"]), key=lambda o: min(t_of(o["from_px"]), t_of(o["to_px"])))
        cur, k = a, 0
        for o in ops:
            p0, p1 = sorted([o["from_px"], o["to_px"]], key=t_of)
            if t_of(p0) > t_of(cur) + 1e-6:
                k += 1
                lvl["walls"].append({"id": f"{w['id']}.{k}", "a": W(cur), "b": W(p0), "t": w["t_mm"] / 1000,
                                     "h": w.get("h_mm", H * 1000) / 1000, "kind": "wall", "label": w["label"], "src": "measured"})
            fa, fb = (o["from_px"], o["to_px"])
            lvl["openings"].append({"id": o["id"], "a": W(fa), "b": W(fb), "t": w["t_mm"] / 1000, "kind": o["kind"], "sill": 0.0,
                                    "head": o["head_mm"] / 1000, "hinge": o["hinge"], "swing": o["swing"], "leaves": o["leaves"],
                                    "panes": 1, "label": o["label"], "src": "measured",
                                    "width": round(math.hypot(fb[0] - fa[0], fb[1] - fa[1]) * m_per_px, 3)})
            cur = p1
        if t_of(cur) < 1 - 1e-6:
            k += 1
            lvl["walls"].append({"id": f"{w['id']}.{k}", "a": W(cur), "b": W(b), "t": w["t_mm"] / 1000,
                                 "h": w.get("h_mm", H * 1000) / 1000, "kind": "wall", "label": w["label"], "src": "measured"})
    for c in tr["columns"]:
        lvl["columns"].append({"id": c["id"], "c": W(c["c_px"]), "size": [s / 1000 for s in c["size_mm"]], "rot": 0, "src": "measured"})
    rings_m = snap_zones([[W(p) for p in z["points_px"]] for z in brief["zones"]], lvl["walls"] + lvl["openings"])
    for z, ring in zip(brief["zones"], rings_m):
        area = abs(sum(ring[i][0] * ring[i - 1][1] - ring[i - 1][0] * ring[i][1] for i in range(len(ring)))) / 2
        lvl["spaces"].append({"id": z["id"], "name": z["label"], "type": "room" if z["id"] == brief["zones"][0]["id"] else "area",
                              "ring": ring, "area": round(area, 2), "src": "deck-outline"})
        findings.append(f"zone {z['id']}: {area:.1f} m2")
    for o in lvl["openings"]:
        findings.append(f"opening {o['id']}: {o['width'] * 1000:.0f} mm")

    plan = {"schema": "tracer-plan/1", "units": "m",
            "source": {"kind": "drawing", "files": [brief["source"]["deck"]], "tracer_version": "build-from-deck/S3", "standards": None},
            "scale": {"px_per_m": round(ppm, 4), "method": tr["scale"]["method"]}, "levels": [lvl]}
    (P / "plan.json").write_text(json.dumps(plan, indent=1), encoding="utf-8")

    # canvas via the tracer's exporter; underlay = the deck plan picture at its native pixels
    canvas = load_tracer_canvas()
    plan_file = brief["plan"]["file"]
    und = {"id": f"img-{code}", "src": f"{R2_PROJECTS}/{code}/3-build/build-from-deck/output/images/{Path(plan_file).name}", "x": -ox, "y": -oy,
           "width": brief["plan"]["px"][0], "height": brief["plan"]["px"][1], "opacity": 0.55, "scale": 1, "locked": True, "layerId": "image"}
    doc = canvas.export(plan, {"fixture_backs": {}}, und)

    # spec + provenance params onto the canvas elements the brief names
    # A wall can carry several finishes: the wall lists them (specIds); each finish gets its own
    # attachment with the full spec + provenance in S5. A door is one spec element: full params now.
    by_label = {}
    for s in doc["segments"]:
        ids = [x for x in items if f"({x})" in (s.get("label") or "")]
        if not ids:
            continue
        for a in s.get("attachments", []):
            if a["objectId"] == "wall-with-math":
                a["params"]["specIds"] = ",".join(ids)
            elif a["objectId"] == "door-with-math" and len(ids) == 1:
                a["params"].update(provenance(items[ids[0]], code))
        for x in ids:
            by_label[x] = by_label.get(x, 0) + 1
    zone_items = {}
    for it in brief["items"]:
        if it["category"] == "flooring" and it["object"]["kind"] == "floor-finish":
            zone_items[it["zone"]] = it
    for sp, z in zip(doc["spaces"], brief["zones"]):
        if z["id"] in zone_items:
            sp["attachments"][0]["params"].update(provenance(zone_items[z["id"]], code))
            by_label[zone_items[z["id"]]["id"]] = 1
    doc["settings"]["keywords"] = f"{brief['project']} - {brief['room']} (build-from-deck S3 shell)"
    doc["settings"]["deckBrief"] = f"Projects/{code}/3-build/build-from-deck/output/roombrief.json"
    out = P / f"{code}.canvas.json"
    out.write_text(json.dumps(doc, indent=1), encoding="utf-8")
    findings.append(f"spec params attached: {sorted(by_label)}")
    findings.append(f"canvas: {len(doc['nodes'])} nodes, {len(doc['segments'])} segments, {len(doc['spaces'])} spaces -> {out.name}")

    check_png(D, brief, plan, ox, oy, ppm, tr, P / "geometry_check.png")
    (P / "geometry.findings.txt").write_text("\n".join(findings) + "\n", encoding="utf-8")
    print("\n".join(findings))


def check_png(D, brief, plan, ox, oy, ppm, tr, out):
    from PIL import Image, ImageDraw
    im = Image.open(D / brief["plan"]["file"]).convert("RGB")
    S = 4
    x0, y0, x1, y1 = 380, 425, 640, 615
    im = im.crop((x0, y0, x1, y1)).resize(((x1 - x0) * S, (y1 - y0) * S), Image.LANCZOS)
    d = ImageDraw.Draw(im, "RGBA")
    P = lambda p: ((p[0] * ppm + ox - x0) * S, (-p[1] * ppm + oy - y0) * S)
    L = plan["levels"][0]
    for s, col in zip(L["spaces"], [(22, 163, 74, 50), (37, 99, 235, 60)]):
        d.polygon([P(p) for p in s["ring"]], fill=col)
    for w in L["walls"]:
        d.line([P(w["a"]), P(w["b"])], fill=(220, 38, 38, 230), width=max(2, int(w["t"] * ppm * S)))
    for o in L["openings"]:
        d.line([P(o["a"]), P(o["b"])], fill=(234, 179, 8, 255), width=6)
        m = P([(o["a"][0] + o["b"][0]) / 2, (o["a"][1] + o["b"][1]) / 2])
        d.text((m[0] + 6, m[1] + 4), f"{o['id']} {o['width'] * 1000:.0f}", fill=(120, 60, 0, 255))
    for c in L["columns"]:
        cx, cy = P(c["c"]); hw, hh = c["size"][0] * ppm * S / 2, c["size"][1] * ppm * S / 2
        d.rectangle([cx - hw, cy - hh, cx + hw, cy + hh], outline=(124, 58, 237, 255), width=3)
    for h in tr["furniture_hints"]:
        pts = h.get("corners_px") or ([(h["bbox_px"][0], h["bbox_px"][1]), (h["bbox_px"][2], h["bbox_px"][1]),
                                       (h["bbox_px"][2], h["bbox_px"][3]), (h["bbox_px"][0], h["bbox_px"][3])] if "bbox_px" in h else None)
        if pts:
            d.polygon([((x - x0) * S, (y - y0) * S) for x, y in pts], outline=(14, 116, 144, 255))
            d.text(((pts[0][0] - x0) * S + 3, (pts[0][1] - y0) * S + 3), h["item"], fill=(14, 116, 144, 255))
    im.save(out)


if __name__ == "__main__":
    main(*sys.argv[1:3])
