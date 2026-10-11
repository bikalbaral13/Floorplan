"""Build the three-party site from templates/app + the seeded brief.

    site/index.html        router — sends each person to their page by roster role (owner = architect)
    site/architect.html    author, issue, team, review
    site/client.html       decisions on issued revisions, render comments
    site/modeler.html      punch list, mark fixed, issued spec
    site/sheets/*.svg      the derived drawings     site/refs/*.jpg   downscaled references
    site/data/local.json   the same data for a local (no-login) preview
    dbseed/                one JSON file per document + batches.json (ArtifactData batch writes, <= 50 each)
    publish.json           what S7 passes to the Artifact tool: files, capabilities (with the db access rules), title

Permissions are enforced in two layers:
  * server — db rules: everything is editor-only except inputs/<uid>, which only that person may write;
  * data   — every page counts a decision / fix only when its author is rostered in that role and it targets the
             current issued revision (see templates/app/core.js).
"""
import hashlib, json, os, shutil

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TPL = os.path.join(ROOT, "templates", "app")
PAGES = {"architect": "Architect", "client": "Client", "modeler": "3D modeler"}
DB_RULES = [
    {"path": "", "read": "view", "write": "admin"},
    {"path": "inputs", "read": "view", "write": "admin"},
    {"path": "inputs/{self}", "write": "interact"},
]
CAPABILITIES = {"db": {"rules": DB_RULES}, "user": {"scopes": ["profile"]}, "assets": {}, "downloads": True}
SNAP = ["code", "name", "cat", "shapes", "spec", "dims", "notes", "refs", "options", "lib", "refInfo"]

def _ascii(s, js):
    return "".join(c if ord(c) < 128 else (f"\\u{ord(c):04X}" if js else f"&#x{ord(c):X};") for c in s)

def _read(name): return open(os.path.join(TPL, name), encoding="utf-8").read()

def element_docs(brief, seed_issue, at):
    out = {}
    for e in brief["elements"]:
        d = json.loads(json.dumps(e)); d.pop("dirty", None)
        d.update({"dirty": True, "updatedAt": at})
        if seed_issue:
            snap = {k: json.loads(json.dumps(e.get(k))) for k in SNAP}; snap.update({"rev": 1, "at": at, "issue": 1})
            d.update({"issued": snap, "rev": 1, "dirty": False})
        out[e["id"]] = d
    return out

def meta_doc(brief, build, issue):
    refs = [{"id": r["id"], "title": r["title"], "url": r.get("url", ""), "asset": r["asset"], "tags": r.get("tags", [])} for r in brief["references"]]
    sheets = [{"id": s["id"], "kind": s["kind"], "name": s["name"], "w": s["w"], "h": s["h"], "file": s["file"]} for s in brief["sheets"]]
    return {"schema": "spacebrief/1", "project": brief["project"], "space": brief["space"], "levels": brief["levels"], "sheets": sheets,
            "references": refs, "tray": brief["tray"], "rounds": [], "dismissed": [], "issue": issue,
            "pipeline": {"id": "space-brief", "version": build["version"], "run_id": build["run_id"], "built": build["built"]}}

def build(out_dir, brief, views_dir, refs_dir, build, seed_issue=False, fixture_inputs=None, library_dir=None):
    site = os.path.join(out_dir, "site")
    if os.path.isdir(site): shutil.rmtree(site)
    os.makedirs(os.path.join(site, "sheets")); os.makedirs(os.path.join(site, "refs")); os.makedirs(os.path.join(site, "data"))
    for s in brief["sheets"]: shutil.copy(os.path.join(views_dir, os.path.basename(s["file"])), os.path.join(site, s["file"]))
    for r in brief["references"]: shutil.copy(os.path.join(refs_dir, r["asset"]), os.path.join(site, "refs", r["asset"]))
    css, core, deck = _read("base.css"), _read("core.js"), _read("deck.js")
    title_space = brief["space"]["label"].split(" · ")[0]
    for role, label in PAGES.items():
        b = dict(build, role=role)
        html = (_read("page.html").replace("%%TITLE%%", f"{title_space} · {label}").replace("%%CSS%%", css)
                .replace("%%BUILD%%", json.dumps(b)).replace("%%CORE%%", core).replace("%%DECK%%", deck).replace("%%ROLE%%", _read(role + ".js")))
        open(os.path.join(site, role + ".html"), "w", encoding="utf-8").write(_escape_page(html))
    router = (_read("router.html").replace("%%TITLE%%", f"{title_space} Brief").replace("%%CSS%%", css).replace("%%PROJECT%%", brief["project"]["title"])
              .replace("%%SPACE%%", title_space).replace("%%VERSION%%", build["version"]).replace("%%RUN%%", build["run_id"]))
    open(os.path.join(site, "index.html"), "w", encoding="utf-8").write(_escape_page(router))
    # data
    at = build["epoch_ms"]
    issue = {"n": 1, "at": at} if seed_issue else None
    meta = meta_doc(brief, build, issue); elements = element_docs(brief, seed_issue, at)
    issues = {"1": {"n": 1, "at": at, "note": "Schedule derived from the plan by the pipeline (scope approval).", "by": "pipeline",
                    "changed": [{"id": e["id"], "code": e["code"], "name": e["name"], "rev": 1, "fields": ["new"]} for e in elements.values()]}} if seed_issue else {}
    local = {"meta": meta, "elements": elements, "renders": {}, "pins": {}, "issues": issues, "inputs": {}, "decks": {},
             "roster": {f"local-{r}": {"role": r} for r in PAGES}}
    if fixture_inputs:   # FIXTURE projects only: test decisions / rounds / pins in the LOCAL preview (never seeded into the live store)
        fx = fixture_inputs
        for c in ("roster", "inputs", "pins"): local[c].update(fx.get(c, {}))
        local["renders"] = fx.get("renders", {}); local["meta"] = dict(meta, rounds=fx.get("rounds", []))
    json.dump(local, open(os.path.join(site, "data", "local.json"), "w", encoding="utf-8"), indent=None, separators=(",", ":"))
    from core import library as LIB      # cloud-library catalog the architect picks from (empty when no mirror)
    if library_dir and library_dir.endswith(".json") and os.path.isfile(library_dir):   # restored project: catalog saved from the brief
        catalog, lib_notes = json.load(open(library_dir, encoding="utf-8")), []
        files_dir = library_dir[:-len(".catalog.json")] + ".files" if library_dir.endswith(".catalog.json") else None
        if files_dir and os.path.isdir(files_dir): shutil.copytree(files_dir, os.path.join(site, "library"), dirs_exist_ok=True)
    else:
        catalog, lib_notes = LIB.build(library_dir, os.path.join(site, "library"))
    json.dump(catalog, open(os.path.join(site, "data", "library.json"), "w", encoding="utf-8"), separators=(",", ":"))
    seed = os.path.join(out_dir, "dbseed")
    if os.path.isdir(seed): shutil.rmtree(seed)
    os.makedirs(seed)
    docs = [("brief", "meta", meta)] + [("elements", k, v) for k, v in elements.items()] + [("issues", k, v) for k, v in issues.items()]
    writes = []
    for col, did, body in docs:
        fp = os.path.join(seed, f"{col}-{did}.json"); json.dump(body, open(fp, "w", encoding="utf-8"), indent=1); writes.append({"op": "set", "collection": col, "doc_id": did, "file_path": os.path.abspath(fp)})
    batches = [writes[i:i + 50] for i in range(0, len(writes), 50)]
    # republish: only the pipeline-owned fields of meta, and only elements that do not exist yet
    upd = {k: meta[k] for k in ("pipeline", "sheets", "references", "levels", "project", "space")}
    up = os.path.join(seed, "meta-update.json"); json.dump(upd, open(up, "w", encoding="utf-8"), indent=1)
    json.dump({"first_publish": batches, "republish": {"update_meta": {"collection": "brief", "doc_id": "meta", "file_path": os.path.abspath(up)},
               "add_missing_elements": [w for w in writes if w["collection"] == "elements"]}}, open(os.path.join(seed, "batches.json"), "w", encoding="utf-8"), indent=1)
    files = {}
    for dp, _, fs in os.walk(site):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), site).replace(os.sep, "/")
            if rel != "index.html": files[rel] = rel
    h = hashlib.sha256()
    for rel in sorted(list(files) + ["index.html"]): h.update(rel.encode()); h.update(open(os.path.join(site, rel), "rb").read())
    pub = {"file_path": os.path.abspath(os.path.join(site, "index.html")), "root": os.path.abspath(site), "files": files,
           "capabilities": CAPABILITIES, "icon": "blueprint", "title": f"{title_space} Brief",
           "description": f"Interactive brief for {brief['project']['title']} · {brief['space']['label']}: architect authors and issues, client approves, modeler works the punch list.",
           "site_sha256": h.hexdigest(), "run_id": build["run_id"], "seed_issue": seed_issue,
           "library": catalog.get("counts", {}), "library_notes": lib_notes}
    json.dump(pub, open(os.path.join(out_dir, "publish.json"), "w", encoding="utf-8"), indent=1)
    return pub, len(writes)

def _escape_page(html):
    """Non-ASCII → escapes: JS \\uXXXX inside <script>, HTML entities elsewhere (pages render the same with or without a charset)."""
    out, i = [], 0
    while True:
        j = html.find("<script>", i)
        if j < 0: out.append(_ascii(html[i:], False)); break
        k = html.find("</script>", j)
        out.append(_ascii(html[i:j], False)); out.append(_ascii(html[j:k], True)); i = k
    return "".join(out)


def build_standalone(site, out_path, build, role="architect"):
    """One self-contained HTML of a role page: local-preview data + every sheet, reference and render as data URIs.
    Opens from disk in any browser; saves to that browser; the deck downloads directly. Never published."""
    import base64, mimetypes
    files = {}
    for dp, _, fs in os.walk(site):
        for f in fs:
            rel = os.path.relpath(os.path.join(dp, f), site).replace(os.sep, "/")
            if rel.startswith(("sheets/", "refs/", "fixture/", "library/")) or rel == "data/library.json":
                mt = mimetypes.guess_type(f)[0] or "application/octet-stream"
                files[rel] = f"data:{mt};base64," + base64.b64encode(open(os.path.join(dp, f), "rb").read()).decode()
    local = json.load(open(os.path.join(site, "data", "local.json"), encoding="utf-8"))
    b = dict(build, role=role, standalone=True)
    css, core, deck = _read("base.css"), _read("core.js"), _read("deck.js")
    title_space = local["meta"]["space"]["label"].split(" \u00b7 ")[0]
    page = (_read("page.html").replace("%%TITLE%%", f"{title_space} \u00b7 {PAGES[role]} (standalone)").replace("%%CSS%%", css)
            .replace("<script>window.__BRIEF_BUILD__ = %%BUILD%%;</script>",
                     "<script>window.__BRIEF_BUILD__ = %%BUILD%%; window.__BRIEF_LOCAL__ = %%LOCAL%%; window.__BRIEF_FILES__ = %%FILES%%;</script>")
            .replace("%%BUILD%%", json.dumps(b)).replace("%%LOCAL%%", json.dumps(local, separators=(",", ":")))
            .replace("%%FILES%%", json.dumps(files, separators=(",", ":"))).replace("%%CORE%%", core).replace("%%DECK%%", deck).replace("%%ROLE%%", _read(role + ".js")))
    open(out_path, "w", encoding="utf-8").write(_escape_page(page))
    return out_path, os.path.getsize(out_path)
