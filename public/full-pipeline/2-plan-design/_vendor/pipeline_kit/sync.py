"""Pull and publish — the R2 side of pipeline/1 (library/Schemas/pipeline.v1.schema.json, rules 13–15 in
library/Skills/Shared/pipeline-rules.md).

    pull     inputs whose `from` is an R2 key → <work_dir>/cache/<key> (skipped when the digest matches); cache/pulled.json
    publish  outputs.keep → Projects/<CODE>/… : waits for each item's `after` task, validates `schema` against
             library/Schemas, skips files whose x-amz-meta-sha256 already matches, then writes run.json (run/1)
             to Projects/<CODE>/runs/<pipeline>/<run_id>/run.json and a copy in <work_dir>/runs/.
             Nothing outside `keep` is uploaded; nothing is ever written to library/ (that is a promote, with approval).
    dry_run  plans everything (reads R2, validates) and uploads nothing.

Schema validation needs the `jsonschema` package; without it files are published unvalidated and the report says so."""
import csv, datetime, glob, json, os
from . import paths as P, tasks as T, r2

SCHEMAS = "library/Schemas/"

def load_contract(root):
    p = os.path.join(root, "pipeline.json")
    if not os.path.exists(p): raise FileNotFoundError(f"{p} — this pipeline has no pipeline/1 contract yet")
    man = P.load_json(p)
    if man.get("schema") != "pipeline/1": raise ValueError(f"{p}: schema is {man.get('schema')!r}, expected 'pipeline/1'")
    return man

def _sub(s, code): return s.replace("{CODE}", code)

def _glob(layout, code, local):
    """-> [(abs path, path relative to the pattern's fixed base)]"""
    local = _sub(local, code)
    base = layout.project_dir(code) if local.startswith("project:") else layout.work_dir(code, create=False)
    pat = local[8:] if local.startswith("project:") else local
    fixed = []
    for part in pat.replace("\\", "/").split("/"):
        if any(c in part for c in "*?["): break
        fixed.append(part)
    if len(fixed) == len(pat.split("/")): fixed = fixed[:-1]          # no wildcard: base is the file's folder
    fbase = os.path.join(base, *fixed)
    hits = sorted(h for h in glob.glob(os.path.join(base, pat), recursive=True) if os.path.isfile(h))
    return [(h, os.path.relpath(h, fbase).replace("\\", "/")) for h in hits]

def _now(): return datetime.datetime.now(datetime.timezone.utc)

class _Schemas:
    def __init__(self, store, cache_dir):
        self.store, self.cache_dir, self.v = store, cache_dir, {}
        try:
            import jsonschema; self.js = jsonschema
        except ImportError: self.js = None
    def errors(self, sid, doc):
        """-> list of messages, or None when validation was not possible."""
        if not self.js: return None
        if sid not in self.v:
            key = f"{SCHEMAS}{sid}.schema.json"; cp = os.path.join(self.cache_dir, *key.split("/"))
            raw = self.store.get(key)
            if raw is not None:
                os.makedirs(os.path.dirname(cp), exist_ok=True); open(cp, "wb").write(raw)
            elif os.path.exists(cp): raw = open(cp, "rb").read()
            self.v[sid] = self.js.Draft202012Validator(json.loads(raw)) if raw else None
        if not self.v[sid]: return [f"schema {sid} not found in {SCHEMAS}"]
        return [f"{'/'.join(map(str, e.path)) or '(root)'}: {e.message}"[:200] for e in self.v[sid].iter_errors(doc)][:5]

def pull(layout, code, store, dry_run=False):
    man = load_contract(layout.root); wd = layout.work_dir(code); lines, rec, blocked = [], [], False
    for inp in man["inputs"]:
        src = _sub(inp["from"], code)
        if src.startswith("project:"):
            hits = _glob(layout, code, src)
            lines.append(f"  {'ok  ' if hits or not inp['required'] else 'MISS'} {inp['id']}: {len(hits)} project file(s) {src[8:]}")
            blocked |= inp["required"] and not hits
            rec += [{"id": inp["id"], "local": os.path.relpath(h, layout.root).replace("\\", "/"), **_digest(h)} for h, _ in hits]
            continue
        if any(c in src for c in "*?["):
            lines.append(f"  skip {inp['id']}: {src} is a pattern — the pipeline's adapter fetches it"); continue
        cp = os.path.join(wd, "cache", *src.split("/")); remote = store.head(src)
        if remote is None:
            lines.append(f"  {'MISS' if inp['required'] else 'none'} {inp['id']}: {src} not in R2"); blocked |= inp["required"]; continue
        if os.path.exists(cp) and remote and r2.sha256(open(cp, "rb").read()) == remote:
            lines.append(f"  same {inp['id']}: {src}")
        elif dry_run: lines.append(f"  get  {inp['id']}: {src} → cache/")
        else:
            data = store.get(src); os.makedirs(os.path.dirname(cp), exist_ok=True); open(cp, "wb").write(data)
            lines.append(f"  got  {inp['id']}: {src} ({len(data)} B)")
        if os.path.exists(cp): rec.append({"id": inp["id"], "key": src, **_digest(cp)})
    if not dry_run: P.save_json(os.path.join(wd, "cache", "pulled.json"), rec)
    head = f"[{code}] pull{' (dry run)' if dry_run else ''} from {store!r}: " + ("BLOCKED — a required input is missing" if blocked else "ok")
    return {"status": "blocked" if blocked else "done", "inputs": rec, "text": "\n".join([head] + lines)}

def _digest(p):
    b = open(p, "rb").read(); return {"sha256": r2.sha256(b), "bytes": len(b)}

def plan(layout, code, store, man=None):
    """Every kept file with its fate: upload | same | wait | missing | invalid."""
    man = man or load_contract(layout.root); pdir = layout.project_dir(code)
    rows = {r["task_id"]: r for r in T.load(pdir)} if os.path.exists(os.path.join(pdir, "TASKS.csv")) else {}
    sch = _Schemas(store, os.path.join(layout.work_dir(code), "cache")); items, keys = [], {}
    for k in man["outputs"]["keep"]:
        after = k.get("after"); ready = not after or rows.get(after, {}).get("status") == "done"
        hits = _glob(layout, code, k["local"]); to = _sub(k["to"], code)
        if not hits:
            items.append({"id": k["id"], "fate": "wait" if not ready else "missing", "local": _sub(k["local"], code), "key": to,
                          "why": f"waits for {after}" if not ready else "no file matches"}); continue
        if not to.endswith("/") and len(hits) > 1:
            items.append({"id": k["id"], "fate": "invalid", "local": k["local"], "key": to, "why": f"{len(hits)} files for one key"}); continue
        for h, rel in hits:
            key = to + rel if to.endswith("/") else to
            data = open(h, "rb").read(); it = {"id": k["id"], "local": h, "key": key, "sha256": r2.sha256(data), "bytes": len(data)}
            if k.get("schema"): it["schema"] = k["schema"]
            if k.get("binary"): it["binary"] = True
            if not key.startswith(f"Projects/{code}/"): it.update(fate="invalid", why="keep must write under Projects/<CODE>/")
            elif key in keys: it.update(fate="invalid", why=f"same key as {keys[key]}")
            else:
                errs = None                                   # validated even while waiting: problems show before the review
                if k.get("schema"):
                    try: errs = sch.errors(k["schema"], json.loads(data))
                    except ValueError as e: errs = [f"not JSON: {e}"]
                    it["valid"] = None if errs is None else not errs
                if errs: it.update(fate="invalid", why="; ".join(errs))
                elif not ready: it.update(fate="wait", why=f"waits for {after}")
                else:
                    remote = store.head(key)
                    it["fate"] = "same" if remote == it["sha256"] else "upload"
                    if errs is None and k.get("schema"): it["why"] = "not validated (jsonschema not installed)"
            keys.setdefault(key, k["id"]); items.append(it)
    return items

def publish(layout, code, store, dry_run=False, agent="agent", run_id=None, started=None):
    man = load_contract(layout.root); pdir = layout.project_dir(code); wd = layout.work_dir(code)
    t0 = started or _now(); items = plan(layout, code, store, man)
    for it in items:
        if it["fate"] == "upload" and not dry_run:
            store.put(it["key"], open(it["local"], "rb").read(), r2.content_type(it["key"]))
    fates = {f: sum(1 for i in items if i["fate"] == f) for f in ("upload", "same", "wait", "missing", "invalid")}
    status = "failed" if fates["invalid"] or fates["missing"] else "partial" if fates["wait"] else "done"
    rid = run_id or t0.strftime("%Y%m%dT%H%M%SZ")
    rows = T.load(pdir) if os.path.exists(os.path.join(pdir, "TASKS.csv")) else []
    pulled = P.load_json(os.path.join(wd, "cache", "pulled.json"), [])
    run = {"schema": "run/1", "run_id": rid, "project": code,
           "pipeline": {"id": man["id"], "version": man["version"], **({"kit": man["kit"]} if man.get("kit") else {})},
           "agent": agent, "fixture": bool(layout.project(code).get("fixture")),
           "started": t0.strftime("%Y-%m-%dT%H:%M:%SZ"), "finished": _now().strftime("%Y-%m-%dT%H:%M:%SZ"), "status": status,
           "inputs": pulled, "library": _pins(layout.root, man),
           "outputs": [{k: v for k, v in {"id": i["id"], "key": i["key"], "local": os.path.relpath(i["local"], layout.root).replace("\\", "/"),
                        "sha256": i["sha256"], "bytes": i["bytes"], "schema": i.get("schema"), "valid": i.get("valid"),
                        "binary": i.get("binary"), "skipped_unchanged": True if i["fate"] == "same" else None}.items() if v is not None}
                       for i in items if i["fate"] in ("upload", "same")],
           "tasks": [{"task_id": r["task_id"], "status": _st(r.get("status", "")), **({"approved": r["approved"]} if r.get("approved") else {})} for r in rows]}
    waiting = [f"{i['id']} ({i['why']})" for i in items if i["fate"] == "wait"]
    if waiting: run["notes"] = "not published yet: " + ", ".join(dict.fromkeys(waiting))
    rerr = _Schemas(store, os.path.join(wd, "cache")).errors("run.v1", run)
    run_key = f"Projects/{code}/runs/{man['id']}/{rid}/run.json"
    if not dry_run:
        P.save_json(os.path.join(wd, "runs", f"{rid}.json"), run)
        if not rerr: store.put(run_key, json.dumps(run, ensure_ascii=False, indent=1).encode("utf-8"), "application/json")
    lines = [f"[{code}] publish{' (DRY RUN — nothing uploaded)' if dry_run else ''} → {store!r}: {status.upper()}  "
             + ", ".join(f"{n} {f}" for f, n in fates.items() if n)]
    for i in items:
        lines.append(f"  {i['fate']:7} {i['key']}" + (f"  ({i['bytes']:,} B)" if "bytes" in i else "") + (f"  — {i['why']}" if i.get("why") else ""))
    lines.append(f"  {'run.json' if not rerr else 'run.json INVALID'} → {run_key}" + (f"  {rerr}" if rerr else ""))
    return {"status": status, "items": items, "run": run, "run_key": run_key, "run_errors": rerr, "text": "\n".join(lines)}

def _st(s): return {"doing": "running"}.get(s, s if s in ("todo", "running", "done", "blocked", "skipped", "failed") else "todo")

def _pins(root, man):
    out = []
    for pin in man.get("library_pins", []):
        e = {"path": pin["path"]}
        if pin.get("version"): e["version"] = pin["version"]
        lc = pin.get("local_copy")
        if lc and os.path.isfile(os.path.join(root, lc)):
            e.update(sha256=_digest(os.path.join(root, lc))["sha256"], source="local_copy")
        elif lc: e["source"] = "vendored" if "_vendor" in lc else "local_copy"
        else: e["source"] = "r2"
        out.append(e)
    return out

def publish_stage(ctx, store=None):
    """For a pipeline's publish stage run.py: `def run(ctx): return sync.publish_stage(ctx)`."""
    from .findings import result, F
    res = publish(ctx.layout, ctx.code, store or r2.default_store(ctx.layout.root))
    fs = [F("fail", "publish", i["key"], i["why"]) for i in res["items"] if i["fate"] in ("invalid", "missing")]
    fs += [F("warn", "publish", i["key"], i["why"]) for i in res["items"] if i["fate"] == "wait"]
    st = {"done": "done", "partial": "done", "failed": "failed"}[res["status"]]
    return result(st, res["text"].splitlines()[0], [res["run_key"]], fs)
