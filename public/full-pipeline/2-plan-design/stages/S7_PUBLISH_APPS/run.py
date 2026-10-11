import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from

def run(ctx):
    pub = ctx.jw("apps", "publish.json")
    if not ctx.has("apps.json"):
        return result("blocked", "publish work/apps/site and seed the store as stages/S7_PUBLISH_APPS/prompt.md says, then write apps.json")
    a = ctx.load("apps.json"); fs = []
    if not str(a.get("url", "")).startswith("https://claude.ai/"): fs.append(F("fail", "url", "apps.json", "url must be the published artifact link"))
    if a.get("site_sha256") != pub["site_sha256"]: fs.append(F("fail", "stale", "apps.json", f"published site {str(a.get('site_sha256'))[:12]} ≠ current build {pub['site_sha256'][:12]} — republish"))
    if a.get("mode") not in ("first", "republish"): fs.append(F("fail", "mode", "apps.json", "mode must be first or republish"))
    if not a.get("seeded"): fs.append(F("fail", "seed", "apps.json", "store not seeded — run the ArtifactData batches"))
    if a.get("seed_documents") is not None and a.get("mode") == "first":
        want = sum(len(b) for b in ctx.jw("apps", "dbseed", "batches.json")["first_publish"])
        if a["seed_documents"] != want: fs.append(F("fail", "seed", "count", f"{a['seed_documents']} documents written, {want} expected"))
    return result(status_from(fs), f"published {a.get('url')} ({a.get('mode')}), run {pub['run_id']}", ["apps.json"], fs,
                  [f"apps published at {a.get('url')} — share as Contributor with the client and modeler; architects as Editor"])
