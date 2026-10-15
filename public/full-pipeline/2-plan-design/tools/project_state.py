"""Save a space-brief project to the library and restore it in a later chat (pipeline_kit.state, shared by every pipeline).

  python tools/project_state.py pack <CODE>                        → <work>/state/state.json + index-entry.json + SAVE.md
  python tools/project_state.py index --entry <index-entry.json> [--current <index.json>] -o <new index.json>
  python tools/project_state.py unpack <state.json> [--work-dir <dir>] → projects/<CODE>/ + RESTORE.md (what to fetch)
  python tools/project_state.py check <CODE>                       → every file to fetch is in place
  python tools/project_state.py list --current <index.json>         → every project, every pipeline, link, next step

Library: `Projects/<PROJECT>/2-plan/space-brief/[<CODE>/]state.json` (this project's small files) and `Projects/index.json` (all projects,
all pipelines). References and the library catalog come back from the published brief (`Artifact read url=<brief>
paths=[…]`), never through the connector; their original ids are pinned in inputs/refs/refs.ids.json so a rerun keeps
every element's links.
"""
import argparse, csv, io, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path[:0] = [ROOT, os.path.join(ROOT, "_vendor")]
from pipeline_kit import state as S, paths as PK

PIPE = "space-brief"
PATTERNS = ["project.json", "scope.json", "scope.draft.json", "apps.json", "decks.json", "TASKS.csv", "REPORT.md", "run.state.json", "run.json",
            "inputs/plan.canvas.json", "briefing/*/*"]
EXCLUDE = ["briefing/*/run.json", "briefing/*/bad*", "briefing/*/batch/*"]

def _pdir(code): return os.path.join(ROOT, "projects", code)
def _version(): return open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()
def _work(code): return PK.Layout(ROOT, work_default="../../_work").work_dir(code)

def pack(code):
    pd = _pdir(code)
    if not os.path.isdir(pd): raise SystemExit(f"no project {code}")
    files = S.collect(pd, PATTERNS, EXCLUDE)
    proj = json.loads(files["project.json"]); apps = json.loads(files.get("apps.json", "{}")); work = _work(code)
    refs = json.load(open(os.path.join(work, "brief.json"), encoding="utf-8")).get("references", []) if os.path.exists(os.path.join(work, "brief.json")) else []
    jpg = lambda f: f.rsplit(".", 1)[0] + ".jpg"
    # restored references are the brief's JPEG copies: pin their ids and point refs.csv at the .jpg names
    files["inputs/refs/refs.ids.json"] = json.dumps({jpg(r["file"]): r["id"] for r in refs}, indent=1)
    csvp = os.path.join(pd, "inputs", "refs", "refs.csv")
    if os.path.exists(csvp):
        rows = list(csv.DictReader(open(csvp, encoding="utf-8")))
        if rows:
            for row in rows: row["file"] = jpg(row["file"])
            buf = io.StringIO(); w = csv.DictWriter(buf, fieldnames=list(rows[0]), lineterminator="\n"); w.writeheader(); w.writerows(rows); files["inputs/refs/refs.csv"] = buf.getvalue()
    fetch = [{"from": f"refs/{r['asset']}", "to": f"inputs/refs/{jpg(r['file'])}", "via": "brief"} for r in refs if r.get("asset")]
    cat = os.path.join(work, "apps", "site", "data", "library.json")
    fetch.append({"from": "data/library.json", "to": "inputs/library.catalog.json", "via": "brief"})
    if os.path.exists(cat):
        fetch += [{"from": i["file"], "to": "inputs/library.files/" + os.path.basename(i["file"]), "via": "brief"}
                  for i in json.load(open(cat, encoding="utf-8")).get("items", []) if i.get("kind") == "image" and i.get("file")]
    rows = list(csv.DictReader(open(os.path.join(pd, "TASKS.csv"), encoding="utf-8"))) if os.path.exists(os.path.join(pd, "TASKS.csv")) else []
    nxt = next((r["task_id"] for r in rows if r.get("status") not in ("done", "skipped")), None)
    decks = json.loads(files.get("decks.json", "{}")).get("versions", [])
    st = S.pack(PIPE, _version(), code, proj.get("title", code), files, link=apps.get("url"), next_task=nxt, fetch=fetch,
                summary={"decks": [f"v{d['k']} I{d['issue']}" for d in decks], "upstream": proj.get("upstream")}, fixture=proj.get("fixture"))
    out = os.path.join(work, "state"); os.makedirs(out, exist_ok=True)
    PK.save_json(os.path.join(out, "state.json"), st, compact=True)
    PK.save_json(os.path.join(out, "index-entry.json"), S.entry(st))
    open(os.path.join(out, "SAVE.md"), "w", encoding="utf-8").write(S.save_steps(st, out))
    print(f"packed {code}: {len(files)} files, {len(fetch)} to fetch back from the brief, {os.path.getsize(os.path.join(out, 'state.json')) / 1e3:.0f} kB → {out}/state.json\nnext: follow {out}/SAVE.md")

def unpack(sp, work_dir=None):
    st = json.load(open(sp, encoding="utf-8")); code = st["code"]; pd = _pdir(code)
    if st.get("schema") == "spacebrief-project/1":                     # 0.4.0 bundles
        R = st["restore"]; jpg = lambda f: f.rsplit(".", 1)[0] + ".jpg"
        st["files"]["inputs/refs/refs.ids.json"] = json.dumps({jpg(r["file"]): r["id"] for r in R["refs"]}, indent=1)
        st["fetch"] = [{"from": p, "to": f"inputs/refs/{jpg(r['file'])}"} for r, p in zip([r for r in R["refs"] if r.get("asset")], R["refs_from_brief"])]
        st["fetch"].append({"from": R["library_catalog_from_brief"], "to": "inputs/library.catalog.json"}); st["link"] = st.get("brief_url")
    S.unpack(st, pd)
    proj = json.load(open(os.path.join(pd, "project.json"), encoding="utf-8")); proj["work_dir"] = work_dir or f"../../../../../pipeline-work/{PIPE}/{code}"
    json.dump(proj, open(os.path.join(pd, "project.json"), "w", encoding="utf-8"), indent=1)
    json.dump(st["fetch"], open(os.path.join(pd, "RESTORE.fetch.json"), "w", encoding="utf-8"), indent=1)
    open(os.path.join(pd, "RESTORE.md"), "w", encoding="utf-8").write(f"""# Restore {code} — fetch from the published brief
Brief: {st.get('link')}
1. `Artifact read url={st.get('link')} paths=[…]` with every `from` in RESTORE.fetch.json ({len(st['fetch'])} files).
2. Copy each saved file to its `to` path under projects/{code}/ (the result lists where each one landed).
3. `python tools/project_state.py check {code}`, then `python tools/run_task.py {code}`.
Next task when saved: {st.get('next_task') or 'none — all done'}.
""")
    print(f"restored projects/{code}: {len(st['files'])} files. Fetch {len(st['fetch'])} files from the brief: see projects/{code}/RESTORE.md")

def check(code):
    pd = _pdir(code); fx = json.load(open(os.path.join(pd, "RESTORE.fetch.json"), encoding="utf-8"))
    miss = [f["to"] for f in fx if not os.path.exists(os.path.join(pd, f["to"]))]
    print("all restored files in place" if not miss else "missing:\n  " + "\n  ".join(miss)); return 1 if miss else 0

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0]); sp = ap.add_subparsers(dest="cmd", required=True)
    a = sp.add_parser("pack"); a.add_argument("code")
    b = sp.add_parser("index"); b.add_argument("--entry", required=True); b.add_argument("--current"); b.add_argument("-o", "--out", required=True)
    c = sp.add_parser("unpack"); c.add_argument("state"); c.add_argument("--work-dir")
    d = sp.add_parser("check"); d.add_argument("code")
    e = sp.add_parser("list"); e.add_argument("--current")
    ns = ap.parse_args()
    if ns.cmd == "pack": pack(ns.code)
    elif ns.cmd == "index":
        cur = json.load(open(ns.current, encoding="utf-8")) if ns.current and os.path.exists(ns.current) else None
        idx = S.merge_index(cur, json.load(open(ns.entry, encoding="utf-8"))); PK.save_json(ns.out, idx); print(f"index: {len(idx['projects'])} project(s) → {ns.out}")
    elif ns.cmd == "unpack": unpack(ns.state, ns.work_dir)
    elif ns.cmd == "check": sys.exit(check(ns.code))
    elif ns.cmd == "list": print("\n".join(S.listing(json.load(open(ns.current, encoding="utf-8")) if ns.current else {})))

if __name__ == "__main__":
    main()
