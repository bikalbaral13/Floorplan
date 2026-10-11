"""Seed the element schedule (spacebrief/1) from geo.json + views + references.

Every element starts from something the PLAN knows: a space (floor, ceiling), a wall run (finish or glazed
partition), an opening (door), or a group of node objects of one kind (furniture, joinery, rugs, planters).
Nothing about materials is invented: spec fields start empty, dims come from the plan (src=plan) or from the
scope's stated levels (src=convention). The architect fills the rest in the generated apps.
"""
import csv, hashlib, json, math, os, re, shutil
from . import geometry as G, views as V

CATS = {  # id: (prefix, name)
    "floor": ("FL", "Flooring"), "ceiling": ("CL", "Ceiling"), "wall": ("WL", "Walls & finishes"), "light": ("LT", "Lighting"),
    "joinery": ("JN", "Joinery"), "furniture": ("FN", "Furniture"), "soft": ("SF", "Soft furnishing"), "planting": ("PL", "Planting"),
    "partition": ("DR", "Doors & partitions"), "signage": ("SG", "Signage & AV"), "services": ("SV", "Services"),
}
EMPTY_SPEC = {"material": "", "finish": "", "colourName": "", "hex": "", "link": ""}

def mm(m): return f"{round(m * 1000)} mm"

def _sheet(sheets, sid): return next(s for s in sheets if s["id"] == sid)

def _circle(c, r, n=20): return [(c[0] + r * math.cos(2 * math.pi * i / n), c[1] + r * math.sin(2 * math.pi * i / n)) for i in range(n)]

def _elev_rect(sheet, t0, t1, z0, z1):
    return {"sheet": sheet["id"], "type": "poly", "pts": V.to_norm(sheet, tz=[(t0, z1), (t1, z1), (t1, z0), (t0, z0)])}

def build(geo, sheets, levels, refs):
    plan, rcp = _sheet(sheets, "plan"), _sheet(sheets, "rcp")
    elev = {s["run"]: s for s in sheets if s["kind"] == "elevation"}
    walls = {w["id"]: w for w in geo["walls"]}
    els, counters = [], {}
    def add(cat, name, origin, shapes, dims, notes=""):
        p = CATS[cat][0]; counters[p] = counters.get(p, 0) + 1
        key = json.dumps({k: origin.get(k) for k in ("type", "ref", "facet", "kind")}, sort_keys=True)
        e = {"id": f"{p.lower()}-{hashlib.sha1(key.encode()).hexdigest()[:8]}", "code": f"{p}-{counters[p]:02d}", "name": name, "cat": cat, "origin": origin,
             "shapes": shapes, "spec": dict(EMPTY_SPEC), "dims": dims, "notes": notes, "refs": [], "options": [],
             "order": len(els) + 1, "rev": 0, "dirty": True}
        els.append(e); return e
    fc = levels["ceiling_mm"] / 1000
    for sp in geo["spaces"]:
        add("floor", f"Floor · {sp['label']}", {"type": "space", "ref": sp["id"], "facet": "floor"},
            [{"sheet": "plan", "type": "poly", "pts": V.to_norm(plan, sp["ring"])}],
            [{"k": "Area", "v": f"{sp['area']:.1f} m²", "src": "plan"}])
    for sp in geo["spaces"]:
        add("ceiling", f"Ceiling · {sp['label']}", {"type": "space", "ref": sp["id"], "facet": "ceiling"},
            [{"sheet": "rcp", "type": "poly", "pts": V.to_norm(rcp, sp["ring"])}],
            [{"k": "Ceiling level", "v": f"+{levels['ceiling_mm']} mm", "src": "convention"}, {"k": "Area", "v": f"{sp['area']:.1f} m²", "src": "plan"}])
    for r in geo["runs"]:
        sh = elev[r["id"]]; top = r.get("height") or levels["soffit_mm"] / 1000
        line = {"sheet": "plan", "type": "line", "pts": V.to_norm(plan, [r["a"], r["b"]])}
        if r["glazed"]:
            add("partition", f"Glazed partition · Elev {r['letter']}", {"type": "run", "ref": r["id"], "letter": r["letter"]},
                [line, _elev_rect(sh, 0, r["length"], 0, levels.get("partition_mm", 2600) / 1000)],
                [{"k": "Length", "v": mm(r["length"]), "src": "plan"}, {"k": "Head", "v": f"+{levels.get('partition_mm', 2600)} mm", "src": "convention"}])
        else:
            add("wall", f"Wall finish · Elev {r['letter']} ({r['looks']})", {"type": "run", "ref": r["id"], "letter": r["letter"]},
                [line, _elev_rect(sh, 0, r["length"], 0, min(fc, top))],
                [{"k": "Length", "v": mm(r["length"]), "src": "plan"}, {"k": "Finish up to", "v": f"+{levels['ceiling_mm']} mm (FC)", "src": "convention"}])
    for r in geo["runs"]:
        sh = elev[r["id"]]; X = lambda p: (p[0] - r["frame"]["origin"][0]) * r["frame"]["right"][0] + (p[1] - r["frame"]["origin"][1]) * r["frame"]["right"][1]
        for wid in r["walls"]:
            w = walls[wid]; op = w.get("opening")
            if not op or op["kind"] != "door": continue
            t0, t1 = sorted((X(w["a"]), X(w["b"])))
            add("partition", f"Door · {w.get('label') or 'Elev ' + r['letter']}", {"type": "opening", "ref": wid, "letter": r["letter"]},
                [{"sheet": "plan", "type": "line", "pts": V.to_norm(plan, [w["a"], w["b"]])}, _elev_rect(sh, t0, t1, 0, op["lintel"])],
                [{"k": "Clear width", "v": mm(op["width"]), "src": "plan"}, {"k": "Head", "v": f"+{round(op['lintel'] * 1000)} mm", "src": "plan"},
                 {"k": "Leaves", "v": str(op.get("leaves") or "Single"), "src": "plan"}])
    groups = {}
    for o in geo["objects"]:
        if o["kind"] == "column" or o["category"] not in CATS: continue
        groups.setdefault(o["kind"], []).append(o)
    for kind, objs in groups.items():
        cat = objs[0]["category"]; shapes = []
        for o in objs:
            ring = _circle(o["at"], o["length"] / 2) if kind == "rug" else V.footprint(o)
            shapes.append({"sheet": "plan", "type": "poly", "pts": V.to_norm(plan, ring)})
            for r in geo["runs"]:
                inw = r["frame"]["inward"]; ra, rb = tuple(r["a"]), tuple(r["b"])
                fp = V.footprint(o)
                if kind == "rug" or min(G.seg_dist(p, ra, rb) for p in fp) > 2.2 or G.dot(G.sub(tuple(o["at"]), ra), inw) < 0: continue
                T = lambda p: (p[0] - r["frame"]["origin"][0]) * r["frame"]["right"][0] + (p[1] - r["frame"]["origin"][1]) * r["frame"]["right"][1]
                ts = [T(p) for p in fp]; t0, t1 = max(0, min(ts)), min(r["length"], max(ts))
                if t1 - t0 > 0.05: shapes.append(_elev_rect(elev[r["id"]], t0, t1, 0, o["height"]))
        nm = kind.replace("-", " ").capitalize() + (f"s ×{len(objs)}" if len(objs) > 1 else "")
        o = objs[0]
        add(cat, nm, {"type": "object", "ref": [x["id"] for x in objs], "kind": kind}, shapes,
            [{"k": "Size (L × D × H)", "v": f"{round(o['length'] * 1000)} × {round(o['depth'] * 1000)} × {round(o['height'] * 1000)} mm", "src": "plan"},
             {"k": "Count", "v": str(len(objs)), "src": "plan"}])
    # references
    unassigned = []
    for ref in refs:
        hit = match(ref.get("for", ""), els, geo)
        for e in hit: e["refs"].append(ref["id"])
        if not hit: unassigned.append(ref["id"])
    return els, unassigned

def match(spec, els, geo):
    """refs.csv `for` column: space:<label>/floor|ceiling · run:<letter> · object:<kind> · door:<label words> · (blank = tray)."""
    if not spec: return []
    kind, _, val = spec.partition(":"); val = val.strip().lower()
    if kind == "space":
        label, _, facet = val.partition("/"); facet = facet or "floor"
        ids = [s["id"] for s in geo["spaces"] if s["label"].lower() == label]
        return [e for e in els if e["origin"]["type"] == "space" and e["origin"]["ref"] in ids and e["origin"]["facet"] == facet]
    if kind == "run": return [e for e in els if e["origin"]["type"] == "run" and e["origin"]["letter"].lower() == val]
    if kind == "object": return [e for e in els if e["origin"]["type"] == "object" and e["origin"]["kind"] == val]
    if kind == "door": return [e for e in els if e["origin"]["type"] == "opening" and val in e["name"].lower()]
    return []

def read_refs(ref_dir):
    """Every image in inputs/refs/ is a reference. refs.csv (optional): file,title,for,url,tags."""
    meta = {}
    csvp = os.path.join(ref_dir, "refs.csv")
    if os.path.exists(csvp):
        for row in csv.DictReader(open(csvp, encoding="utf-8")): meta[row["file"].strip()] = row
    # refs.ids.json pins ids for references restored from a saved project (their bytes are the brief's downscaled
    # copies, so hashing them again would give new ids and break every element that points at them)
    pins = {}
    pp = os.path.join(ref_dir, "refs.ids.json")
    if os.path.exists(pp): pins = json.load(open(pp, encoding="utf-8"))
    out = []
    for f in sorted(os.listdir(ref_dir)) if os.path.isdir(ref_dir) else []:
        if not re.search(r"\.(jpe?g|png|webp)$", f, re.I): continue
        p = os.path.join(ref_dir, f); h = hashlib.sha256(open(p, "rb").read()).hexdigest()
        m = meta.get(f, {})
        out.append({"id": pins.get(f) or "ref-" + h[:10], "file": f, "sha256": h, "title": (m.get("title") or os.path.splitext(f)[0].replace("-", " ")).strip(),
                    "for": (m.get("for") or "").strip(), "url": (m.get("url") or "").strip(), "tags": [t for t in (m.get("tags") or "").split(";") if t]})
    return out

def copy_refs(refs, ref_dir, out_dir, max_px=1200):
    """Downscale references for the apps / deck (originals stay in inputs/)."""
    from PIL import Image
    os.makedirs(out_dir, exist_ok=True)
    for r in refs:
        im = Image.open(os.path.join(ref_dir, r["file"])); im = im.convert("RGB") if im.mode not in ("RGB", "L") else im
        im.thumbnail((max_px, max_px)); name = r["id"] + ".jpg"; im.save(os.path.join(out_dir, name), quality=84, optimize=True)
        r["asset"] = name
    return refs

def brief_doc(project, scope, levels, geo, sheets, els, refs, unassigned, pipeline):
    return {"schema": "spacebrief/1", "project": {"code": project["code"], "title": project.get("title", project["code"]), "client": scope.get("client", "")},
            "space": {"label": scope.get("label") or " · ".join(s["label"] for s in geo["spaces"]), "ids": geo["scope"]},
            "levels": levels, "sheets": [{k: s[k] for k in ("id", "kind", "name", "w", "h") if k in s} | {"file": "sheets/" + s["svg"], "png": "sheets/" + s["png"]} for s in sheets],
            "references": refs, "tray": unassigned, "elements": els, "pipeline": pipeline}
