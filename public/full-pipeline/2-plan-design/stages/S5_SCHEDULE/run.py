import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core import brief as Bf
from core.ctx import validate, VERSION

def run(ctx):
    sc = ctx.scope(); geo = ctx.jw("geo.json"); sheets = ctx.jw("views.json")
    refs = Bf.read_refs(ctx.p("inputs", "refs")); Bf.copy_refs(refs, ctx.p("inputs", "refs"), ctx.w("refs"))
    els, tray = Bf.build(geo, sheets, sc["levels"], refs)
    doc = Bf.brief_doc(dict(ctx.project), sc, sc["levels"], geo, sheets, els, refs, tray, {"id": "space-brief", "version": VERSION, "run_id": ctx.run_id()})
    doc["levels"] = dict(sc["levels"]); ctx.sw("brief.json", doc); fs = []
    ok, msg = validate(doc, "spacebrief.v1"); fs.append(F("info" if ok else "fail", "spacebrief.v1", "brief", msg))
    for sp in geo["spaces"]:
        for facet in ("floor", "ceiling"):
            if not any(e["origin"].get("ref") == sp["id"] and e["origin"].get("facet") == facet for e in els): fs.append(F("fail", "schedule", sp["id"], f"no {facet} element"))
    for r in geo["runs"]:
        n = sum(1 for e in els if e["origin"]["type"] == "run" and e["origin"]["ref"] == r["id"])
        if n != 1: fs.append(F("fail", "schedule", r["letter"], f"{n} elements for wall run {r['letter']}"))
    for e in els:
        if any(v for v in e["spec"].values()): fs.append(F("fail", "invented", e["code"], "spec filled by the pipeline"))
        if any(d.get("src") not in ("plan", "convention") for d in e["dims"]): fs.append(F("fail", "dims", e["code"], "dimension without a plan/convention source"))
    if tray: fs.append(F("info", "tray", "refs", f"{len(tray)} reference(s) not matched to an element — the architect assigns them in the app"))
    by = {}
    for e in els: by[e["cat"]] = by.get(e["cat"], 0) + 1
    return result(status_from(fs), f"{len(els)} elements ({', '.join(f'{k} {v}' for k, v in by.items())}); {len(refs) - len(tray)} refs attached, {len(tray)} in the tray",
                  ["brief.json", "refs/"], fs)
