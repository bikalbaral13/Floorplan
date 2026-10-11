import glob, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core import archive as A
from core.ctx import validate

def run(ctx):
    a = ctx.load("apps.json", default={}); d = ctx.w("archive")
    docs = sorted((json.load(open(p, encoding="utf-8")) for p in glob.glob(os.path.join(d, "decks", "*.json"))), key=lambda x: x.get("k", 0))
    docs = [x.get("data", x) if isinstance(x, dict) and set(x) <= {"data", "id", "version"} else x for x in docs]
    if not docs: return result("blocked", "no brief deck exported yet — the architect generates one in the app (Brief deck), then export as stages/S8_ARCHIVE/prompt.md says")
    fs, out, geo = [], [], ctx.jw("geo.json")
    for doc in docs:
        k = doc["k"]; aid = str(doc.get("asset", "")).split(":", 1)[-1]
        pp = os.path.join(d, "assets", aid + ".json")
        if not os.path.exists(pp): fs.append(F("fail", "package", f"v{k}", f"package {aid} not exported")); continue
        pkg = A.load_package(pp); b, sha = A.pptx_bytes(pkg)
        if sha != doc["sha256"] or sha != pkg["pptx"]["sha256"]: fs.append(F("fail", "integrity", f"v{k}", "pptx bytes do not match the recorded sha256")); continue
        for line in A.parity(pkg): fs.append(F("fail", "parity", f"v{k}", line))
        base = doc["filename"][:-5]; open(ctx.w("decks", doc["filename"]), "wb").write(b)
        fb = A.final_brief(pkg); ok, msg = validate(fb, "spacebrief.v1"); fs.append(F("info" if ok else "fail", "spacebrief.v1", f"v{k}", msg))
        ctx.sw(f"decks/{base}.spacebrief.json", fb)
        out.append({"k": k, "issue": doc["issue"], "filename": doc["filename"], "sha256": sha, "bytes": len(b), "slides": doc.get("slides"), "at": doc["at"], "by": doc.get("by"),
                    "note": doc.get("note", ""), "counts": doc.get("counts"), "outstanding": doc.get("outstanding"), "fixture": bool(pkg.get("fixture"))})
        if pkg.get("fixture"): fs.append(F("warn", "fixture", f"v{k}", "FIXTURE deck — test decisions, not a client's"))
        latest = pkg
    if out:
        ctx.sw("decks/roombrief.json", A.roombrief(latest, geo, ctx.code))
        ctx.save("decks.json", {"url": a.get("url"), "versions": out})
    return result(status_from(fs), f"{len(out)} deck version(s): " + ", ".join(f"v{o['k']} (I{o['issue']}, {o['slides']} slides)" for o in out), ["decks/", "decks.json"], fs)
