import datetime, json, os, re, shutil, subprocess, sys, tempfile
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit.findings import result, F, status_from
from core import apps as A
from core.ctx import VERSION

def run(ctx):
    sc = ctx.scope(); brief = ctx.jw("brief.json"); now = datetime.datetime.now(datetime.timezone.utc)
    build = {"project": ctx.code, "version": VERSION, "run_id": ctx.run_id(), "built": now.isoformat(timespec="seconds"), "epoch_ms": int(now.timestamp() * 1000), "schema": "spacebrief/1", "fixture": ctx.fixture}
    fx = None
    if ctx.fixture and ctx.has("fixture", "inputs.json"):
        fx = ctx.load("fixture", "inputs.json"); rd = ctx.p("fixture", "renders")
        for r in fx.get("renders", {}).values():          # local preview serves fixture renders from fixture/
            r["img"] = "fixture/" + r["img"].split(":", 1)[1] + ".jpg"
    lib = ctx.p("inputs", "library")
    if not os.path.isdir(lib) and os.path.isfile(ctx.p("inputs", "library.catalog.json")): lib = ctx.p("inputs", "library.catalog.json")   # restored project
    pub, nwrites = A.build(ctx.w("apps"), brief, ctx.w("views"), ctx.w("refs"), build, bool(sc.get("seed_issue")), fx, lib if os.path.exists(lib) else None)
    if fx:
        os.makedirs(os.path.join(pub["root"], "fixture"), exist_ok=True)
        for f in os.listdir(ctx.p("fixture", "renders")): shutil.copy(ctx.p("fixture", "renders", f), os.path.join(pub["root"], "fixture", f))
    fs = []; site = pub["root"]
    if fx and ctx.has("fixture", "agent-session", "patch.json"):   # FIXTURE: the sample agent run the trial copy offers
        from tools import brief_agent as BA
        try:
            local = json.load(open(os.path.join(site, "data", "local.json"), encoding="utf-8"))
            run_ = BA.compile_patch(ctx.load("fixture", "agent-session", "patch.json"), BA.db_from_local(local),
                                    BA.load_catalog(os.path.join(site, "data", "library.json")), ctx.p("fixture", "agent-session"), now_ms=build["epoch_ms"] + 1)
            os.makedirs(os.path.join(site, "fixture"), exist_ok=True)
            json.dump(run_, open(os.path.join(site, "fixture", "agent-run.json"), "w", encoding="utf-8"), separators=(",", ":"))
            fs.append(F("info", "agent-sample", "fixture/agent-session", f"sample run {run_['label']}: {run_['summary']}"))
        except BA.PatchError as e:
            fs.append(F("fail", "agent-sample", "fixture/agent-session/patch.json", str(e)))
    lc = pub.get("library") or {}
    fs.append(F("info" if lc else "warn", "library", "inputs/library", (f"cloud library: {lc.get('material', 0)} materials, {lc.get('object', 0)} objects, {lc.get('image', 0)} images" if lc else "no library mirror — the Library picker will be empty (agents/BRIEFING_AGENT.md: mirror the library)")))
    for n in pub.get("library_notes") or []:
        if n != "no library mirror": fs.append(F("warn", "library", "mirror", n))
    sa, sz = A.build_standalone(site, ctx.w("apps", f"{ctx.code}_architect_standalone.html"), build)
    fs.append(F("info", "standalone", os.path.basename(sa), f"{sz / 1e6:.1f} MB — open from disk to try the architect app"))
    for rel in list(pub["files"]) + ["index.html"]:
        if not os.path.exists(os.path.join(site, rel)): fs.append(F("fail", "files", rel, "missing"))
    size = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fl in os.walk(site) for f in fl)
    if size > 16e6: fs.append(F("fail", "size", "site", f"{size / 1e6:.1f} MB > 16 MB"))
    node = shutil.which("node")
    for page in ("index", "architect", "client", "modeler"):
        html = open(os.path.join(site, page + ".html"), encoding="utf-8").read()
        if any(ord(c) > 127 for c in html): fs.append(F("fail", "ascii", page, "non-ASCII character in the page"))
        if re.search(r"\son(change|click|input)=", html): fs.append(F("fail", "inline-handler", page, "inline event handler (blocked by the page CSP)"))
        if node:
            for i, js in enumerate(re.findall(r"<script>(.*?)</script>", html, re.S)):
                with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False) as t: t.write(js)
                r = subprocess.run([node, "--check", t.name], capture_output=True, text=True, encoding="utf-8"); os.unlink(t.name)
                if r.returncode: fs.append(F("fail", "js-syntax", f"{page}#{i}", r.stderr.strip().splitlines()[-1] if r.stderr else "syntax error"))
        else: fs.append(F("warn", "js-syntax", page, "node not found — scripts not syntax-checked"))
    rules = pub["capabilities"]["db"]["rules"]
    if not any(r["path"] == "" and r["write"] == "admin" for r in rules) or not any(r["path"] == "inputs/{self}" for r in rules):
        fs.append(F("fail", "rules", "db", "shared data must be editor-only and inputs/{self} writable by its owner"))
    return result(status_from(fs), f"router + 3 role pages, {len(pub['files'])} files, {size / 1e6:.1f} MB, {nwrites} seed documents; site {pub['site_sha256'][:12]}",
                  ["apps/site/", "apps/dbseed/", "apps/publish.json"], fs)
