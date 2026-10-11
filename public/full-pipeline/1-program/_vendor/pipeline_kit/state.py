"""Save a project to the library and resume it in a later chat — the same way for every pipeline.

A chat's working folder is wiped when the chat ends. Each pipeline packs the SMALL text files of a project
(task sheet, report, decisions, links, plan …) into one JSON the agent writes to the library through the
BuilderPluss connector, and every pipeline shares one registry of projects:

    Projects/index.json                        projects-index/1: per project code, per pipeline → link, state, next step
    Projects/<CODE>/<pipeline id>/state.json   pipeline-project/1: the packed files + what to fetch back on restore

Binary files never travel through the connector (a library read shows an image to the agent, it does not return
bytes). A pipeline lists them under `fetch` with where they can be fetched back from (a published brief, Projects/).
"""
import datetime, fnmatch, json, os

SCHEMA = "pipeline-project/1"
INDEX = "projects-index/1"
LIMIT = 400_000          # bytes: one connector write
TEXT = (".json", ".md", ".csv", ".txt")

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")

def collect(pdir, patterns, exclude=(), max_file=200_000):
    """{relative path: text} of the project's text files matching any glob pattern (relative to pdir)."""
    out = {}
    for dp, _, fs in os.walk(pdir):
        for f in sorted(fs):
            full = os.path.join(dp, f); rel = os.path.relpath(full, pdir).replace(os.sep, "/")
            if not f.endswith(TEXT) or os.path.getsize(full) > max_file: continue
            if any(fnmatch.fnmatch(rel, p) for p in patterns) and not any(fnmatch.fnmatch(rel, x) for x in exclude):
                out[rel] = open(full, encoding="utf-8").read()
    return dict(sorted(out.items()))

def pack(pipeline, version, code, title, files, link=None, next_task=None, fetch=None, summary=None, fixture=False):
    st = {"schema": SCHEMA, "pipeline": pipeline, "pipeline_version": version, "code": code, "title": title, "fixture": bool(fixture),
          "saved_at": now(), "link": link, "next_task": next_task, "files": files, "fetch": fetch or [], "summary": summary or {}}
    size = len(json.dumps(st, ensure_ascii=False, separators=(",", ":")).encode())
    if size > LIMIT: raise ValueError(f"state is {size / 1e3:.0f} kB > {LIMIT / 1e3:.0f} kB — leave large files out (they belong in Projects/ or the work dir)")
    return st

def library_path(code, pipeline): return f"Projects/{code}/{pipeline}/state.json"

def entry(st):
    return {"code": st["code"], "title": st["title"], "pipeline": st["pipeline"], "link": st.get("link"), "state": library_path(st["code"], st["pipeline"]),
            "updated": st["saved_at"], "version": st["pipeline_version"], "next_task": st.get("next_task"), "summary": st.get("summary", {}), "fixture": st.get("fixture", False)}

def merge_index(current, e):
    """Add or replace one pipeline's entry for a project; other pipelines' entries for the same code stay."""
    idx = current if isinstance(current, dict) and current.get("schema") == INDEX else {"schema": INDEX, "projects": {}}
    p = idx["projects"].setdefault(e["code"], {"title": e["title"], "pipelines": {}})
    p["title"] = p.get("title") or e["title"]
    pl = p.setdefault("pipelines", {})
    old = pl.get(e["pipeline"], {})
    v = {k: e[k] for k in ("link", "state", "updated", "version", "next_task", "summary", "fixture")}
    if v.get("link") is None and old.get("link"): v["link"] = old["link"]
    if "brief_url" in old and not v.get("link"): v["link"] = old["brief_url"]      # 0.1 entries named the link brief_url
    pl[e["pipeline"]] = v
    idx["updated"] = e["updated"]
    return idx

def unpack(st, pdir, overwrite=False):
    if st.get("schema") not in (SCHEMA, "spacebrief-project/1"): raise ValueError("not a pipeline-project/1 bundle")
    if os.path.exists(os.path.join(pdir, "project.json")) and not overwrite: raise FileExistsError(f"{pdir} already holds a project — move it away first")
    for rel, text in st["files"].items():
        p = os.path.join(pdir, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "w", encoding="utf-8") as f: f.write(text)
    return list(st["files"])

def listing(idx):
    rows = []
    for code, p in sorted((idx or {}).get("projects", {}).items()):
        for pl, v in sorted(p.get("pipelines", {}).items()):
            rows.append(f"{code:20} {p['title'][:38]:38} {pl:12} {v.get('link') or v.get('brief_url') or '-':52} next: {v.get('next_task') or 'done'}  saved {str(v.get('updated', ''))[:10]}")
    return rows

def save_steps(st, out_dir):
    """SAVE.md: the connector calls that put a packed state into the library."""
    code, pl = st["code"], st["pipeline"]
    return f"""# Save {code} ({pl}) to the library
1. `library read Projects/index.json` (missing on the very first save of any project: skip) → save it as `{out_dir}/index.current.json`.
2. Merge this pipeline's entry: `python -c "import json,sys; sys.path.insert(0,'_vendor'); from pipeline_kit import state as S; cur=json.load(open('{out_dir}/index.current.json')) if __import__('os').path.exists('{out_dir}/index.current.json') else None; json.dump(S.merge_index(cur, json.load(open('{out_dir}/index-entry.json'))), open('{out_dir}/index.json','w'), indent=1, ensure_ascii=False)"`
   (or the pipeline's own `tools/project_state.py index …`).
3. `library write {library_path(code, pl)}` with `content` = `{out_dir}/state.json`, `overwrite: true`.
4. `library write Projects/index.json` with `content` = `{out_dir}/index.json`, `overwrite: true`.
5. Read `Projects/index.json` back and check {code} → {pl} shows {st.get('link') or 'its entry'}.
"""
