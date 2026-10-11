"""Cloud-library catalog (spacebrief-library/1) from a local mirror of library/Materials, library/Objects, library/Images.

The mirror keeps library-relative paths (inputs/library/Materials/Finishes/terrazzo.json …). It is filled by an R2 sync or
by an agent through the BuilderPluss connector (see agents/BRIEFING_AGENT.md). Objects may be the full node graph or a
trimmed copy (top-level keys + the input-props / render-2d / render-3d nodes) — both read the same here.

Each catalog item is everything the app needs to show a card and to fill an element when the architect picks it:
  material  title, hex (pbr.baseColor), colors (procedural A/B), finish (matte/satin/gloss/metallic/emissive), hatch
  object    title, icon paths, colors (render prims), dims (default length/width/depth/height… in m), material text,
            finishes (library material paths it points to)
  image     title, file (copied next to the app) — only images present in the mirror
"""
import hashlib, json, os, re, shutil

DIM = re.compile(r"^(length|width|depth|height|diameter|seatHeight|drop|dia|size|rise|thickness)$", re.I)
SKIP_CAT = {"Hydraulics", "Structural", "Site", "Photometry", "Miscellaneous"}

def _id(path): return "lib-" + hashlib.sha1(path.encode()).hexdigest()[:10]

def _first_sentence(t, n=160):
    t = re.sub(r"\s+", " ", (t or "").strip()); m = re.match(r"(.+?[.!?])(\s|$)", t)
    s = m.group(1) if m else t
    return s if len(s) <= n else s[:n - 1].rstrip() + "…"

def finish_of(pbr, surface=None, emission=None):
    pbr = pbr or {}; coat = ((surface or {}).get("coat") or {}).get("weight", 0)
    if emission or pbr.get("emission") or pbr.get("emissionStrength"): return "emissive"
    if float(pbr.get("metallic") or 0) >= 0.5: return "metallic"
    r = float(pbr.get("roughness", 0.5))
    if r < 0.25 or coat >= 0.4: return "gloss"
    return "satin" if r < 0.55 else "matte"

def material_item(path, d):
    proc = (d.get("procedural") or {}).get("params") or {}
    cols = [proc[k] for k in ("colorA", "colorB", "colorC") if isinstance(proc.get(k), str)]
    pbr = d.get("pbr") or {}; em = d.get("emission")
    hexv = ((d.get("plan2d") or {}).get("color") if em else None) or pbr.get("baseColor") or (cols[0] if cols else "#cccccc")
    return {"id": _id(path), "kind": "material", "path": path, "title": d.get("title") or os.path.basename(path)[:-5],
            "group": d.get("category") or path.split("/")[1], "hex": hexv,
            "colors": cols, "finish": finish_of(pbr, d.get("surface"), em), "kelvin": (em or {}).get("kelvin"), "hatch": (d.get("plan2d") or {}).get("hatch", ""),
            "pattern": (d.get("procedural") or {}).get("type", ""), "desc": _first_sentence(d.get("description"))}

def object_item(path, d):
    props, prims = [], []
    for n in d.get("nodes", []):
        t = (n.get("data") or {}).get("tool"); p = (n.get("data") or {}).get("params") or {}
        if t == "input-props": props = p.get("props", [])
        elif t in ("render-2d", "render-3d"): prims += p.get("prims", [])
    pv = {p.get("id"): p.get("value") for p in props}
    dims = [{"k": p.get("name") or p["id"], "id": p["id"], "v": round(float(p["value"]), 3)} for p in props
            if p.get("type") == "range" and DIM.match(p.get("id", "")) and isinstance(p.get("value"), (int, float)) and 0.005 < float(p["value"]) < 20]
    cols, seen = [], set()
    for q in prims:
        c = (q.get("color") or "").lower()
        if re.match(r"^#[0-9a-f]{6}$", c) and c not in seen: seen.add(c); cols.append(c)
    fin = re.findall(r"[A-Za-z]+/[\w.\-]+\.json", str(pv.get("finishes") or "") + " " + str(pv.get("materialPath") or ""))
    ob = d.get("object") or {}
    return {"id": _id(path), "kind": "object", "path": path, "title": ob.get("name") or d.get("title") or os.path.basename(path)[:-5],
            "group": d.get("category") or path.split("/")[1], "desc": _first_sentence(d.get("title") if ob.get("name") else d.get("description")),
            "icon": (ob.get("icon") or {}).get("paths", []), "colors": cols[:4], "hex": (pv.get("baseColor") if str(pv.get("baseColor") or "").upper() not in ("", "#B8B2A7") else (cols[0] if cols else "#bbbbbb")),
            "dims": dims, "material": str(pv.get("material") or ""), "semantics": str(pv.get("semantics") or ""),
            "finishes": ["Materials/" + f for f in dict.fromkeys(fin)]}

def build(mirror, out_files_dir=None):
    """→ (catalog, findings[]) ; copies mirror images into out_files_dir (site/library/) when given."""
    items, notes = [], []
    if not mirror or not os.path.isdir(mirror): return {"schema": "spacebrief-library/1", "items": [], "source": None}, ["no library mirror"]
    for dp, _, fs in os.walk(mirror):
        for f in sorted(fs):
            full = os.path.join(dp, f); rel = os.path.relpath(full, mirror).replace(os.sep, "/"); top = rel.split("/")[0]
            if ".bak" in f: continue
            try:
                if top == "Materials" and f.endswith(".json"): items.append(material_item(rel, json.load(open(full, encoding="utf-8"))))
                elif top == "Objects" and f.endswith(".json"):
                    if rel.split("/")[1] in SKIP_CAT: continue
                    items.append(object_item(rel, json.load(open(full, encoding="utf-8"))))
                elif top == "Images" and f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
                    it = {"id": _id(rel), "kind": "image", "path": rel, "title": os.path.splitext(f)[0].replace("-", " ").replace("_", " "),
                          "group": rel.split("/")[1] if rel.count("/") > 1 else "Images", "file": "library/" + _id(rel) + os.path.splitext(f)[1].lower()}
                    if out_files_dir:
                        os.makedirs(out_files_dir, exist_ok=True); shutil.copy(full, os.path.join(out_files_dir, os.path.basename(it["file"])))
                    items.append(it)
            except Exception as e:
                notes.append(f"{rel}: {e}")
    # resolve object finishes to items that exist in this catalog
    have = {i["path"] for i in items}
    for i in items:
        if i["kind"] == "object": i["finishes"] = [p for p in i["finishes"] if p in have]
    order = {"material": 0, "object": 1, "image": 2}
    items.sort(key=lambda i: (order[i["kind"]], i["group"], i["title"]))
    return {"schema": "spacebrief-library/1", "items": items, "source": "library mirror", "counts": {k: sum(1 for i in items if i["kind"] == k) for k in order}}, notes
