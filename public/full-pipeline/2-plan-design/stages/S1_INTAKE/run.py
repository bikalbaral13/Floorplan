import csv, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core.ctx import sha256, validate

def run(ctx):
    fs, plan = [], ctx.p("inputs", "plan.canvas.json")
    if not os.path.exists(plan):
        return result("blocked", "put the plan at inputs/plan.canvas.json — Export JSON from the editor, the floorplan-tracer hand-off (Projects/<CODE>/plan/<CODE>.canvas.json), or tools/summary_to_canvas.py from a connector summary")
    canvas = json.load(open(plan, encoding="utf-8"))
    ok, msg = validate(canvas, "canvas.v1"); fs.append(F("info" if ok else "fail", "canvas.v1", "plan", msg))
    L = canvas["levels"][0] if canvas.get("levels") else canvas
    bands = [s for s in L.get("segments", []) if s["fromNodeId"] != s["toNodeId"] and float(s.get("thickness") or 0) > 1]
    if not bands: fs.append(F("fail", "walls", "plan", "no wall segments with thickness"))
    if not L.get("spaces"): fs.append(F("fail", "spaces", "plan", "no closed spaces — close the rooms in the editor so each becomes a space"))
    refdir = ctx.p("inputs", "refs"); imgs = sorted(f for f in os.listdir(refdir) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))) if os.path.isdir(refdir) else []
    if not imgs: fs.append(F("warn", "refs", "inputs/refs", "no reference images — the architect can still add them in the app"))
    csvp = os.path.join(refdir, "refs.csv")
    if os.path.exists(csvp):
        for i, row in enumerate(csv.DictReader(open(csvp, encoding="utf-8")), 2):
            if row.get("file", "").strip() not in imgs: fs.append(F("fail", "refs.csv", f"line {i}", f"file '{row.get('file')}' is not in inputs/refs"))
    inputs = [{"id": "plan", "local": "inputs/plan.canvas.json", "sha256": sha256(plan), "bytes": os.path.getsize(plan)}] + \
             [{"id": "ref:" + f, "local": "inputs/refs/" + f, "sha256": sha256(os.path.join(refdir, f)), "bytes": os.path.getsize(os.path.join(refdir, f))} for f in imgs]
    libdir = ctx.p("inputs", "library")
    if os.path.isdir(libdir):
        for dp, _, fl in os.walk(libdir):
            for f in sorted(fl):
                full = os.path.join(dp, f); rel = os.path.relpath(full, libdir).replace(os.sep, "/")
                inputs.append({"id": "lib:" + rel, "local": "inputs/library/" + rel, "sha256": sha256(full), "bytes": os.path.getsize(full)})
    catp = ctx.p("inputs", "library.catalog.json")
    if not os.path.isdir(libdir) and os.path.isfile(catp):
        inputs.append({"id": "lib:catalog", "local": "inputs/library.catalog.json", "sha256": sha256(catp), "bytes": os.path.getsize(catp)})
    nlib = sum(1 for i in inputs if i["id"].startswith("lib:"))
    ctx.save("intake.json", {"run_id": ctx.run_id(), "inputs": inputs, "pixelsPerMeter": canvas["settings"]["pixelsPerMeter"],
                             "counts": {"segments": len(L.get("segments", [])), "walls": len(bands), "spaces": len(L.get("spaces", [])), "refs": len(imgs), "library_files": nlib}})
    return result(status_from(fs), f"plan: {len(bands)} band segments, {len(L.get('spaces', []))} spaces; {len(imgs)} references; {nlib} library files", ["intake.json"], fs)
