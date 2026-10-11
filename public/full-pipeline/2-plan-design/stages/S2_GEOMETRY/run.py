import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core import geometry as G

def run(ctx):
    canvas = json.load(open(ctx.p("inputs", "plan.canvas.json"), encoding="utf-8"))
    geo = G.build(canvas, None, ctx.project.get("level")); ctx.sw("geo.all.json", geo); fs = []
    std = ctx.standards
    heights = [w["height"] for w in geo["walls"] if w.get("height")]
    lintels = [w["opening"]["lintel"] for w in geo["walls"] if (w.get("opening") or {}).get("kind") == "window"]
    soffit = (max(heights), "plan") if heights else (std["levels"]["floor_to_floor"], "convention")
    ceiling = (std["walls"]["height"], "convention")
    partition = (max(lintels), "plan") if lintels else (std["openings"]["door_head"], "convention")
    if ceiling[0] > soffit[0]: ceiling = (soffit[0], "plan"); fs.append(F("warn", "levels", "ceiling", "convention ceiling above the wall height — using the wall height"))
    for w in geo["walls"]:
        if w["thickness"] <= 0.02: fs.append(F("warn", "walls", w["id"], "thin band treated as a wall"))
    if not geo["runs"]: fs.append(F("fail", "runs", "plan", "no wall run faces a space — check that spaces are closed by walls"))
    draft = {"_about": "Proposed by S2. The user confirms or changes it at S3; the agent then writes scope.json.",
             "spaces": [dict(s, selected=True) for s in geo["spaces_all"]],
             "label": " · ".join(s["label"] for s in geo["spaces_all"]), "client": "",
             "levels": {"ceiling_mm": round(ceiling[0] * 1000), "soffit_mm": round(soffit[0] * 1000), "partition_mm": round(partition[0] * 1000),
                        "src": {"ceiling_mm": ceiling[1], "soffit_mm": soffit[1], "partition_mm": partition[1]}},
             "seed_issue": False, "team": [{"role": "client", "who": ""}, {"role": "modeler", "who": ""}],
             "questions": ["Which space(s) does this brief cover?", "False-ceiling level (mm)? The plan does not say; the firm default is used.",
                           "Slab soffit (mm)?", "Glazed partition head (mm)?", "Client name for the title block?",
                           "Issue the plan-derived schedule to the client as I1 now, or after you fill the specs?", "Who are the client and the 3D modeler?"]}
    ctx.save("scope.draft.json", draft)
    conv = [k for k, v in draft["levels"]["src"].items() if v == "convention"]
    return result(status_from(fs), f"{len(geo['walls'])} band segments, {len(geo['spaces_all'])} spaces, {len(geo['runs'])} facing wall runs, {len(geo['objects'])} objects",
                  ["geo.all.json", "scope.draft.json"], fs, [f"levels from convention (standards {std['id']} {std['version']}): {', '.join(conv)}"] if conv else [])
