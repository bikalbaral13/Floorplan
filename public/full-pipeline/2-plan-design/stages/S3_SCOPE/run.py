import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from

def run(ctx):
    if not ctx.has("scope.json"):
        return result("blocked", "show the user scope.draft.json (questions included) — then write scope.json from their answers, per stages/S3_SCOPE/prompt.md")
    sc = ctx.load("scope.json"); geo = ctx.jw("geo.all.json"); fs = []
    ids = {s["id"] for s in geo["spaces_all"]}
    sel = sc.get("spaces") or []
    if not sel: fs.append(F("fail", "spaces", "scope", "no space selected"))
    for s in sel:
        if s not in ids: fs.append(F("fail", "spaces", s, "not a space in the plan"))
    lv = sc.get("levels") or {}
    for k in ("ceiling_mm", "soffit_mm"):
        if not isinstance(lv.get(k), (int, float)) or lv[k] <= 0: fs.append(F("fail", "levels", k, "missing or not a positive number (mm)"))
    if isinstance(lv.get("ceiling_mm"), (int, float)) and isinstance(lv.get("soffit_mm"), (int, float)) and lv["ceiling_mm"] > lv["soffit_mm"]:
        fs.append(F("fail", "levels", "ceiling_mm", "ceiling above the soffit"))
    if lv.get("partition_mm") and lv.get("ceiling_mm") and lv["partition_mm"] > lv["ceiling_mm"]:
        fs.append(F("warn", "levels", "partition_mm", "partition head above the false ceiling"))
    if not isinstance(sc.get("seed_issue"), bool): fs.append(F("fail", "seed_issue", "scope", "say true or false — the user decides whether I1 goes out now"))
    if not (sc.get("approved_words") or "").strip(): fs.append(F("fail", "approval", "scope", "scope.json must quote the user's answer (approved_words)"))
    return result(status_from(fs), f"scope: {len(sel)} space(s), FC +{lv.get('ceiling_mm')}, soffit +{lv.get('soffit_mm')}, seed issue {sc.get('seed_issue')}", ["scope.json"], fs,
                  [f"scope confirmed: {ctx.approved}"])
