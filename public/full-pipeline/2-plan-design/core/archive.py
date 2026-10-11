"""Archive the brief decks the architect generated in the app.

Each deck version is stored in the brief as a JSON package (spacebrief-deck/1): the frozen snapshot the deck was
built from + the .pptx bytes (base64) + their sha256. This module decodes a package, proves the bytes are the ones the
app recorded, re-judges the snapshot's raw store copy with core/collect.py (the same trust rules as the app) and
writes the hand-off files.
"""
import base64, hashlib, json, os
from . import collect as C

def load_package(path):
    pkg = json.load(open(path, encoding="utf-8"))
    if pkg.get("schema") != "spacebrief-deck/1": raise ValueError(f"{os.path.basename(path)}: not a spacebrief-deck/1 package")
    return pkg

def pptx_bytes(pkg):
    b = base64.b64decode(pkg["pptx"]["base64"]); return b, hashlib.sha256(b).hexdigest()

def parity(pkg):
    """Judge the raw store copy in Python; list every element / comment whose state differs from what the app froze."""
    raw = pkg.get("raw") or {}
    db = {c: dict(raw.get(c) or {}) for c in C.COLLECTIONS}; db["brief"] = {"meta": raw.get("meta") or {}}
    diffs = []
    for e in pkg["elements"]:
        live = db["elements"].get(e["id"])
        if not live: diffs.append(f"{e['code']}: missing from the raw copy"); continue
        st = C.ap_state(db, live)
        if st != e["state"]: diffs.append(f"{e['code']}: app froze '{e['state']}', pipeline judges '{st}'")
    for p in pkg["pins"]:
        live = db["pins"].get(p["id"])
        if live and C.pin_state(db, live) != p["state"]: diffs.append(f"comment {p['id']}: app froze '{p['state']}', pipeline judges '{C.pin_state(db, live)}'")
    return diffs

def final_brief(pkg):
    """spacebrief/1 as frozen in this deck version."""
    m = pkg["meta"]; els = []
    for e in pkg["elements"]:
        el = {k: e.get(k) for k in ("id", "code", "name", "cat", "origin", "shapes", "spec", "dims", "notes", "refs", "options", "rev")}
        el["origin"] = el["origin"] or {"type": "manual"}
        d = e.get("decision")
        el["decision"] = {"state": e["state"], "rev": d.get("rev"), "choice": d.get("choice"), "note": d.get("note", ""), "by": d.get("uid", ""), "at": d.get("at", 0)} if d else {"state": e["state"]}
        el["comments"] = [{k: p.get(k) for k in ("id", "round_name", "view", "text", "state", "x", "y")} for p in pkg["pins"] if p.get("element") == e["id"]]
        els.append(el)
    sheets = [{k: s[k] for k in ("id", "kind", "name", "w", "h", "file")} for s in m["sheets"]]
    refs = [{"id": r["id"], "file": r.get("asset", ""), "title": r["title"], "url": r.get("url", ""), "tags": r.get("tags", []), "asset": r.get("asset", "")} for r in m.get("references", [])]
    return {"schema": "spacebrief/1", "project": m["project"], "space": m["space"], "levels": m["levels"], "sheets": sheets, "references": refs,
            "elements": els, "rounds": m.get("rounds", []), "issue": pkg.get("issue"), "fixture": bool(pkg.get("fixture")),
            "pipeline": {"deck_version": pkg["version"], "generated": pkg["generated"]}}

CATMAP = {"floor": "flooring", "ceiling": "ceiling", "wall": "wall", "light": "lighting", "joinery": "furniture", "furniture": "furniture", "soft": "flooring",
          "planting": "furniture", "partition": "wall", "signage": "wall", "services": "ceiling"}

def roombrief(pkg, geo, code):
    """roombrief/1 for build-from-deck (zones in METRES — see README known gaps)."""
    m = pkg["meta"]; lv = m["levels"]; refs = {r["id"]: r for r in m.get("references", [])}
    rb = {"schema": "roombrief/1", "project": m["project"]["title"], "room": m["space"]["label"].upper(), "room_id": code.lower(),
          "precedence": f"brief deck v{pkg['version']} (issue I{(pkg.get('issue') or {}).get('n', 0)}) > plan defaults",
          "heights_mm": {"false_ceiling": lv["ceiling_mm"], "partition": lv.get("partition_mm"), "slab_soffit": lv["soffit_mm"]},
          "zones": [{"id": s["id"], "label": s["label"], "points_m": s["ring"]} for s in geo["spaces"]],
          "items": [], "cameras": [], "checks": [p["text"] for p in pkg["pins"] if p["state"] != "closed"], "openQuestions": pkg["outstanding"],
          "source": {"pipeline": "space-brief", "deck_version": pkg["version"], "issue": (pkg.get("issue") or {}).get("n", 0), "sha256": pkg["pptx"]["sha256"]}}
    for e in pkg["elements"]:
        sp = e.get("spec") or {}; ch = e.get("choice") or {}; o = e.get("origin") or {}
        rb["items"].append({"id": e["code"], "category": CATMAP.get(e["cat"], e["cat"]), "zone": o.get("ref") if o.get("type") == "space" else None,
                            "object": {"kind": o.get("kind") or e["cat"], "hint": e["name"]},
                            "params": {k: v for k, v in {"material": sp.get("material"), "finish": sp.get("finish"), "colour": ch.get("hex") or sp.get("hex"), "choice": ch.get("label")}.items() if v},
                            "note": e.get("notes", ""), "status": e["state"], "rev": e["rev"],
                            "refImages": [refs[r]["asset"] for r in e.get("refs", []) if r in refs], "productUrls": [u for u in [sp.get("link")] + [refs[r].get("url") for r in e.get("refs", []) if r in refs] if u]})
    return rb
