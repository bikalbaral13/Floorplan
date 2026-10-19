"""The cloud runner: runs ONE queued script stage of a pipeline inside this Vercel deployment — the twin of
tools/runner/worker.mjs for stages that are plain Python (no Blender, no GPU, under the function's time limit).

  POST /__run  { "key": "Projects/<CODE>/<n-phase>/<pipeline>/jobs/<STAGE>.json" }

The editor's Run button and the connector's project.job queue the job in R2 as before, then call this. It claims the
job (status running), fetches the pipeline's CURRENT release and the skills it pins from R2 (every file checked against
release.json's sha256), checks the release is APPROVED, checks the stage gate (the user approved S(n-1) in the step
bar), pulls the inputs, runs the commands with this function's Python, pushes the outputs and writes the job back as
done or failed — with the same progress file (<DIR>stages/<Sn>/progress.json) the pipeline app polls.

APPROVAL without a machine: library/Pipelines/approvals/<pipeline>.json holds an HMAC-SHA256 over the release sha and
the pinned skills' shas, keyed by the R2 secret access key. Only someone holding that key — the publisher, and this
deployment — can write a valid one (tools/runner/approve-cloud.mjs, run on publish); a connector token holder who
edits a release in R2 gets "not approved". A stage that needs a real machine says "host": "runner" in runner.json.

Packages the stages can import come from requirements.txt at the repo root (bundled at deploy).
"""

from http.server import BaseHTTPRequestHandler
import datetime
import fnmatch
import hashlib
import hmac
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

JOB_RE = re.compile(r"^Projects/([A-Z0-9][A-Z0-9_]*)/(\d-[a-z]+)/([a-z0-9-]+)/jobs/([A-Z0-9_]+)\.json$")
TMP = os.environ.get("BP_RUN_TMP") or "/tmp/bp-run"
MIME = {".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
        ".pdf": "application/pdf", ".dxf": "application/dxf", ".txt": "text/plain; charset=utf-8",
        ".md": "text/markdown; charset=utf-8", ".svg": "image/svg+xml", ".csv": "text/csv"}
WORKER = "vercel"


class NeedsMachine(Exception):
    """The stage runs on a machine runner: the job goes back to the queue for worker.mjs."""


def now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def sha256(b):
    return hashlib.sha256(b).hexdigest()


# ── R2 (S3 SigV4, path-style — the same signing as tools/r2.mjs) ───────────────────────────────────────────────
def _env(k):
    return (os.environ.get("MCP_" + k) or os.environ.get(k) or "").strip().strip("'\"")


CFG = {"endpoint": _env("R2_ENDPOINT").rstrip("/"), "key": _env("R2_ACCESS_KEY_ID"), "secret": _env("R2_SECRET_ACCESS_KEY"),
       "bucket": _env("R2_BUCKET"), "prefix": (_env("R2_LIBRARY_PREFIX") or "library").strip("/")}


def _q(s, safe="-_.~"):
    return urllib.parse.quote(s, safe=safe)


def r2(method, key="", body=b"", query=None, ctype=None):
    url = urllib.parse.urlsplit(CFG["endpoint"])
    uri = "/" + "/".join(_q(x) for x in [CFG["bucket"], *(key.split("/") if key else [])])
    if not key:
        uri += "/"
    cq = "&".join(f"{_q(k)}={_q(str(v))}" for k, v in sorted((query or {}).items()))
    amz = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    ph = sha256(body)
    headers = {"host": url.netloc, "x-amz-content-sha256": ph, "x-amz-date": amz}
    if ctype:
        headers["content-type"] = ctype
    names = sorted(headers)
    creq = "\n".join([method, uri, cq, "".join(f"{n}:{headers[n].strip()}\n" for n in names), ";".join(names), ph])
    scope = f"{amz[:8]}/auto/s3/aws4_request"
    sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, sha256(creq.encode())])
    k = ("AWS4" + CFG["secret"]).encode()
    for part in (amz[:8], "auto", "s3", "aws4_request"):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
    headers["Authorization"] = f"AWS4-HMAC-SHA256 Credential={CFG['key']}/{scope}, SignedHeaders={';'.join(names)}, Signature={sig}"
    full = f"{url.scheme}://{url.netloc}{uri}" + (f"?{cq}" if cq else "")
    for attempt in range(4):
        req = urllib.request.Request(full, data=None if method in ("GET", "HEAD") else body, method=method,
                                     headers={k2: v for k2, v in headers.items() if k2 != "host"})
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf8", "replace")
            if e.code >= 500 and attempt < 3:
                time.sleep(0.8 * 2 ** attempt)
                continue
            m = re.search(r"<Message>([^<]+)</Message>", text)
            raise RuntimeError(f"R2 {method} {key} failed: {e.code} {m.group(1) if m else (text[:200] or e.reason)}")
        except urllib.error.URLError as e:
            if attempt >= 3:
                raise RuntimeError(f"R2 {method} {key} failed: {e.reason}")
            time.sleep(0.8 * 2 ** attempt)


def get_bytes(key):
    return r2("GET", key)


def get_text(key):
    return get_bytes(key).decode("utf8")


def read_json(key):
    try:
        return json.loads(get_text(key))
    except Exception:
        return None


def put(key, body, ctype="application/json"):
    r2("PUT", key, body if isinstance(body, bytes) else body.encode("utf8"), ctype=ctype)


def put_json(key, v):
    put(key, json.dumps(v, indent=1, ensure_ascii=False))


def list_keys(prefix):
    keys, token = [], None
    while True:
        q = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            q["continuation-token"] = token
        xml = r2("GET", "", query=q).decode("utf8")
        for m in re.finditer(r"<Contents>([\s\S]*?)</Contents>", xml):
            k = re.search(r"<Key>([^<]*)</Key>", m.group(1))
            if k:
                keys.append(k.group(1).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"').replace("&apos;", "'"))
        t = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if "<IsTruncated>true</IsTruncated>" in xml and t:
            token = t.group(1)
        else:
            return keys


# ── releases: current in R2, verified, approved ───────────────────────────────────────────────────────────────
def approval_mac(pipeline, sha, skills):
    """The approval signature: tools/runner/approve-cloud.mjs computes the same."""
    msg = json.dumps({"pipeline": pipeline, "sha": sha, "skills": dict(sorted(skills.items()))}, separators=(",", ":"))
    return hmac.new(("bp-run-approval:" + CFG["secret"]).encode(), msg.encode(), hashlib.sha256).hexdigest()


def release_at(index_key, list_name, id_, kind):
    idx = read_json(index_key) or {}
    entry = next((p for p in idx.get(list_name, []) if p.get("id") == id_), None)
    if not entry or not entry.get("path"):
        raise RuntimeError(f'{kind} "{id_}" is not in {index_key}')
    base = entry["path"] if entry["path"].endswith("/") else entry["path"] + "/"
    try:
        text = get_text(base + "release.json")
    except Exception:
        raise RuntimeError(f"{base}release.json is missing — publish the {kind} first")
    rel = json.loads(text)
    if not isinstance(rel.get("files"), dict):
        raise RuntimeError(f"{base}release.json lists no files")
    return base, rel, sha256(text.encode("utf8"))


def materialise(kind, id_, base, rel, sha, log):
    d = os.path.join(TMP, "cache", kind, id_, f"{rel.get('version', '0')}-{sha[:12]}")
    if os.path.exists(os.path.join(d, ".complete")):
        return d
    shutil.rmtree(d, ignore_errors=True)
    for rp in rel["files"]:
        if re.search(r"(^|/)\.\.(/|$)", rp) or rp.startswith("/") or ":" in rp:
            raise RuntimeError(f"release lists a bad path: {rp}")

    def fetch(item):
        rp, meta = item
        b = get_bytes(base + rp)
        if (meta or {}).get("sha256") and sha256(b) != meta["sha256"]:
            raise RuntimeError(f"{rp} in R2 does not match its release.json sha256 — the release changed after it was published; republish it")
        dst = os.path.join(d, *rp.split("/"))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(b)

    with ThreadPoolExecutor(16) as pool:          # one file at a time was ~20 s per skill
        list(pool.map(fetch, rel["files"].items()))
    with open(os.path.join(d, ".complete"), "w") as f:
        f.write(json.dumps({"id": id_, "version": rel.get("version"), "sha": sha}))
    log(f"fetched {id_} {rel.get('version')} from R2 ({len(rel['files'])} files, sha256 checked)")
    return d


def load_pipeline(pipeline, log):
    base, rel, sha = release_at(f"{CFG['prefix']}/Pipelines/index.json", "pipelines", pipeline, "pipeline")
    root = materialise("pipelines", pipeline, base, rel, sha, log)
    pins = (read_local_json(os.path.join(root, "pipeline.json")) or {}).get("skills") or {}
    skills, shas = {}, {}
    for alias, pin in pins.items():
        sbase, srel, ssha = release_at(f"{CFG['prefix']}/Skills/index.json", "skills", pin["id"], "skill")
        if srel.get("version") != pin.get("version"):
            raise RuntimeError(f"{pipeline} pins skill {pin['id']} {pin.get('version')} but R2 has {srel.get('version')} — publish the pipeline with the new pin")
        shas[pin["id"]] = ssha
        skills[alias] = {"id": pin["id"], "version": pin["version"], "base": sbase, "rel": srel, "sha": ssha}
    ap = read_json(f"{CFG['prefix']}/Pipelines/approvals/{pipeline}.json")
    if not ap or ap.get("sha") != sha or not hmac.compare_digest(str(ap.get("mac", "")), approval_mac(pipeline, sha, shas)):
        was = f" (approved: {ap.get('version')}, sha {str(ap.get('sha', ''))[:12]})" if ap else ""
        raise RuntimeError(f"{pipeline} {rel.get('version')} is not approved for the cloud runner{was}. The publisher approves it: "
                           f"node tools/runner/approve-cloud.mjs {pipeline} — then Run again.")
    return root, {"version": rel.get("version"), "sha": sha[:12], "source": "r2"}, skills


def read_local_json(p):
    try:
        with open(p, encoding="utf8") as f:
            return json.load(f)
    except Exception:
        return None


# ── stage gate: the user's approval of S(n-1) in the editor (run.json) ───────────────────────────────────────
def iso_ms(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp() * 1000
    except Exception:
        return 0


def gate_block(root, recipe, d, group):
    order = (read_local_json(os.path.join(root, "pipeline.json")) or {}).get("stages")
    if not isinstance(order, list) or not group:
        return None
    i = next((n for n, s in enumerate(order) if s.get("id") == group), -1)
    if i <= 0:
        return None
    prev = order[i - 1]
    if not prev.get("gate"):
        return None
    run = read_json(f"{d}run.json") or {}
    oks = [e for e in run.get("events", []) if (e.get("step") == prev["gate"] and e.get("type") == "approve")
           or (e.get("type") == "ui" and e.get("note") == "reapprove" and (e.get("data") or {}).get("gate") == prev["gate"])]
    if not oks:
        return f"{group} waits for the user to approve {prev['id']} ({prev.get('title') or prev['gate']}) in the step bar"
    last = max(float(e.get("at") or 0) for e in oks)
    for k, st in recipe["stages"].items():
        if st.get("stage") != prev["id"]:
            continue
        j = read_json(f"{d}jobs/{k}.json")
        if j and j.get("finished") and iso_ms(j["finished"]) > last + 1000:
            return f"{prev['id']} was re-run ({k} at {j['finished'][11:19]}) after it was approved — the user approves {prev['id']} again"
    return None


# ── live progress: <DIR>stages/<Sn>/progress.json ────────────────────────────────────────────────────────────
class Progress:
    def __init__(self, key, seed):
        self.key, self.seed, self.doc, self.last, self.lock = key, seed, None, 0.0, threading.Lock()

    def flush(self, force=False):
        if not self.doc or (not force and time.time() - self.last < 2):
            return
        self.last = time.time()
        self.doc["updated"] = now()
        try:
            put_json(self.key, self.doc)
        except Exception:
            pass

    def start(self, step, title):
        self.doc = read_json(self.key) or {"schema": "progress/1", "steps": {}, "log": []}
        self.doc.update(self.seed)
        self.doc.update({"state": "running", "current": step, "heartbeat": now()})
        self.doc.setdefault("steps", {})[step] = {"state": "running", "title": title, "pct": 0, "msg": "Starting…", "started": now()}
        self.doc.setdefault("log", [])
        self.flush(True)

    def _log(self, step, msg):
        self.doc["log"].append({"t": now(), "step": step, "msg": str(msg)[:300]})
        self.doc["log"] = self.doc["log"][-100:]

    def report(self, step, pct, msg):
        s = (self.doc or {}).get("steps", {}).get(step)
        if not s:
            return
        if pct is not None:
            s["pct"] = round(max(0, min(100, float(pct or 0))))
        if msg:
            s["msg"] = msg
            self._log(step, msg)
        self.flush()

    def line(self, step, msg):
        if self.doc and str(msg).strip():
            self._log(step, msg)
            self.flush()

    def end(self, step, state, **extra):
        s = (self.doc or {}).get("steps", {}).get(step)
        if not s:
            return
        s.update({"state": state, "finished": now(), "secs": round((time.time() * 1000 - iso_ms(s["started"])) / 1000)}, **extra)
        if state == "done":
            s["pct"], s["msg"] = 100, extra.get("msg", "Done")
        self.doc["state"] = "failed" if state == "failed" else "idle"
        self.doc["heartbeat"] = now()
        self.flush(True)

    def beat(self):
        if self.doc:
            self.doc["heartbeat"] = now()
            self.flush(True)


# ── placeholders, the same as worker.mjs ─────────────────────────────────────────────────────────────────────
def expand(s, ctx):
    s = str(s)
    s = re.sub(r"\{IF:([a-z0-9_]+):([^}]*)\}", lambda m: "" if ctx["args"].get(m.group(1)) in (None, "") else m.group(2), s, flags=re.I)

    def arg(m):
        k, a = m.group(1), m.group(2)
        v = ctx["args"].get(a)
        if v in (None, ""):
            if k == "ARG?":
                return ""
            raise RuntimeError(f"the job needs args.{a}")
        return os.path.basename(str(v)) if k.upper() == "BASENAME" else str(v)

    s = re.sub(r"\{(ARG\?|ARG|BASENAME):([a-z0-9_]+)\}", arg, s, flags=re.I)
    return re.sub(r"\{(CODE|WORK|PROJ|ROOT|STEPS|OUT|DIR|REPO|SKILL)\}", lambda m: str(ctx[m.group(1)]), s)


def walk_local(d):
    out = []
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x != "__pycache__"]
        for f in files:
            p = os.path.join(root, f)
            out.append((p, os.path.relpath(p, d).replace(os.sep, "/")))
    return out


def glob_local(pattern):
    d, base = os.path.dirname(pattern), os.path.basename(pattern)
    if "*" not in base:
        return [pattern] if os.path.isfile(pattern) else []
    if not os.path.isdir(d):
        return []
    return sorted(os.path.join(d, f) for f in os.listdir(d) if fnmatch.fnmatchcase(f, base) and os.path.isfile(os.path.join(d, f)))


# a child `python` does not inherit the packages Vercel put on THIS process's sys.path (requirements.txt)
PYPATH = os.pathsep.join(p for p in sys.path if p and os.path.isdir(p))


def run_cmd(cmd, cwd, log, env, on_progress):
    opts = cmd[-1] if isinstance(cmd[-1], dict) else {}
    argv = [x for x in cmd if isinstance(x, str)]
    if argv[0] == "python":
        argv[0] = sys.executable
    elif argv[0] in ("node", "blender"):
        raise RuntimeError(f"the cloud runner has no {argv[0]} — give this stage \"host\": \"runner\" in runner.json")
    log("$ " + " ".join(argv))
    p = subprocess.Popen(argv, cwd=opts.get("cwd") or cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         env={**os.environ, "PYTHONPATH": PYPATH, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1", **env})
    for raw in p.stdout:
        line = raw.decode("utf8", "replace").rstrip("\r\n")
        m = re.match(r"^@@progress (\{.*\})\s*$", line)
        if m:
            try:
                o = json.loads(m.group(1))
                on_progress(o.get("pct"), o.get("msg"), None)
            except Exception:
                pass
            continue
        log(line)
        on_progress(None, None, line)
    code = p.wait()
    if code != 0:
        raise RuntimeError(f"{os.path.basename(argv[0])} {os.path.basename(argv[1]) if len(argv) > 1 else ''} exited {code}")


# ── one job ────────────────────────────────────────────────────────────────────────────────────────────────
def run_job(key):
    m = JOB_RE.match(key)
    if not m:
        return 400, {"error": "key must be Projects/<CODE>/<n-phase>/<pipeline>/jobs/<STAGE>.json"}
    code, phase_dir, pipeline, stage = m.groups()
    job = read_json(key)
    if not job:
        return 404, {"error": f"no job at {key}"}
    if job.get("status") not in ("queued", "queued-cloud"):
        return 409, {"error": f"{stage} is {job.get('status')} — only a queued job runs", "status": job.get("status")}
    lines, started, state = [], now(), {"release": None, "prog": None, "step": stage}

    def log(s):
        for l in str(s).splitlines() or [""]:
            lines.append(l)
            print(f"  [{code} {stage}] {l}", flush=True)

    def write(**extra):
        doc = {**job, **extra, "worker": WORKER, "started": started, "log": "\n".join(lines[-200:])}
        if state["release"]:
            doc["release"] = state["release"]
        put_json(key, doc)

    write(status="running", heartbeat=started)       # claim it before anything slow, so no other runner takes it
    stop, wlock = threading.Event(), threading.Lock()

    def heartbeat():
        while not stop.wait(20):
            try:
                with wlock:          # never lands after the final done/failed write
                    if stop.is_set():
                        break
                    write(status="running", heartbeat=now())
                if state["prog"]:
                    state["prog"].beat()
            except Exception:
                pass

    threading.Thread(target=heartbeat, daemon=True).start()
    try:
        root, state["release"], skills = load_pipeline(pipeline, log)
        recipe = read_local_json(os.path.join(root, "runner.json"))
        if not recipe:
            raise RuntimeError(f"{pipeline} {state['release']['version']} has no runner.json — it has no script stages")
        st = recipe["stages"].get(stage)
        if not st:
            raise RuntimeError(f"{pipeline} has no runner stage {stage} (has {', '.join(recipe['stages'])})")
        if st.get("host") == "runner":
            raise NeedsMachine(f"{stage} runs on a machine runner (\"host\": \"runner\")")
        d = f"Projects/{code}/{phase_dir}/{pipeline}/"
        blocked = gate_block(root, recipe, d, st.get("stage"))
        if blocked:
            raise RuntimeError(blocked)
        uses = str(st.get("uses") or "").split(":")[0]
        for s in skills.values():          # only the skill this stage runs is downloaded (all are verified + approved)
            if uses and uses not in (s["id"], next(a for a, v in skills.items() if v is s)):
                continue
            s["root"] = materialise("skills", s["id"], s["base"], s["rel"], s["sha"], log)
            s["manifest"] = read_local_json(os.path.join(s["root"], "skill.json")) or {}
            if s["manifest"].get("version") != s["version"]:
                raise RuntimeError(f"skill {s['id']}: skill.json is {s['manifest'].get('version')}, the pipeline pins {s['version']}")
        skills = {a: v for a, v in skills.items() if "root" in v}
        skill_env = {f"BP_SKILL_{re.sub(r'[^A-Z0-9]', '_', s['id'].upper())}": s["root"] for s in skills.values()}
        cwd, commands, step_id, step_title, skill = root, st.get("run") or [], stage, st.get("title"), None
        if st.get("uses"):
            alias, step = str(st["uses"]).split(":")
            skill = skills.get(alias) or next((s for s in skills.values() if s["id"] == alias), None)
            if not skill:
                raise RuntimeError(f'stage {stage} uses skill "{alias}", which {pipeline}\'s pipeline.json does not pin')
            dfn = (skill["manifest"].get("steps") or {}).get(step) or {}
            if not dfn.get("run"):
                raise RuntimeError(f"skill {skill['id']} {skill['version']} has no script step {step}")
            cwd, commands, step_id, step_title = skill["root"], dfn["run"], step, st.get("title") or dfn.get("title")
            log(f"skill {skill['id']} {skill['version']} · step {step}")
        steps = skill["manifest"]["steps"] if skill else {step_id: {"title": step_title, "kind": "script", "weight": 1}}
        pick = lambda f: {k: f(v) for k, v in steps.items()}
        prog = Progress(f"{d}stages/{st['stage']}/progress.json", {
            "stage": st["stage"], "skill": f"{skill['id']}@{skill['version']}" if skill else None, "order": list(steps),
            "weights": pick(lambda v: v.get("weight", 0)), "kinds": pick(lambda v: v.get("kind")), "titles": pick(lambda v: v.get("title"))}) if st.get("stage") else None
        state["prog"], state["step"] = prog, step_id
        if prog:
            prog.start(step_id, step_title)
        work = os.path.join(TMP, "work", code, pipeline)
        ctx = {"CODE": code, "WORK": work, "PROJ": os.path.join(work, "project", code), "ROOT": root, "STEPS": d + "steps/",
               "OUT": d + "output/", "DIR": d, "REPO": root, "SKILL": cwd, "args": job.get("args") or {}}
        os.makedirs(ctx["PROJ"], exist_ok=True)
        for p in st.get("pull") or []:
            frm, to = expand(p["from"], ctx), expand(p["to"], ctx)
            if frm.endswith("/"):
                if p.get("clean"):
                    shutil.rmtree(to, ignore_errors=True)
                keys = [k for k in list_keys(frm) if not k.endswith("/")]
                if not keys and not p.get("optional"):
                    raise RuntimeError(f"nothing in R2 under {frm} — has the stage before run?")
                for k in keys:
                    dst = os.path.join(to, *k[len(frm):].split("/"))
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    with open(dst, "wb") as f:
                        f.write(get_bytes(k))
                log(f"pulled {len(keys)} files from {frm}")
            else:
                try:
                    b = get_bytes(frm)
                except Exception as e:
                    if p.get("optional"):
                        continue
                    raise RuntimeError(f"missing {frm} — {'not written yet' if re.search('404|NoSuchKey', str(e)) else e}")
                os.makedirs(os.path.dirname(to), exist_ok=True)
                with open(to, "wb") as f:
                    f.write(b)
                log(f"pulled {frm} ({len(b)} B)")
        for p in st.get("push") or []:
            f = expand(p["from"], ctx)
            if not f.startswith("Projects/"):
                os.makedirs(f if f.endswith("/") else os.path.dirname(f), exist_ok=True)
        for ci, c in enumerate(commands):
            last = {"pct": 0}
            share = lambda pc, ci=ci: (100 * ci + float(pc)) / len(commands)

            def on_prog(pct, msg, line):
                if not prog:
                    return
                if line is not None:
                    prog.line(step_id, line)
                else:
                    if pct is not None:
                        last["pct"] = pct
                    prog.report(step_id, share(last["pct"]), msg)

            cmd = [expand(x, ctx) if isinstance(x, str) else {**x, "cwd": expand(x["cwd"], ctx) if x.get("cwd") else None} for x in c]
            run_cmd([x for x in cmd if x != ""], cwd, log, skill_env, on_prog)
            if prog:
                prog.report(step_id, share(100), f"{os.path.basename(str(c[1] if len(c) > 1 else c[0]))} finished")
        outputs = []
        for p in st.get("push") or []:
            if p["from"].endswith("/"):
                frm, to = expand(p["from"], ctx), expand(p["to"], ctx)
                for f, rel in walk_local(frm):
                    with open(f, "rb") as fh:
                        put(to + rel, fh.read(), MIME.get(os.path.splitext(f)[1].lower(), "application/octet-stream"))
                    outputs.append(to + rel)
                continue
            files, to = glob_local(expand(p["from"], ctx)), expand(p["to"], ctx)
            if not files:
                if p.get("optional") or "*" in p["from"]:
                    continue
                raise RuntimeError(f"the stage did not make {expand(p['from'], ctx)}")
            for f in files:
                k = to + os.path.basename(f) if to.endswith("/") else to
                with open(f, "rb") as fh:
                    put(k, fh.read(), MIME.get(os.path.splitext(f)[1].lower(), "application/octet-stream"))
                outputs.append(k)
        log(f"pushed {len(outputs)} files")
        with wlock:
            stop.set()
        if prog:
            prog.end(step_id, "done", msg=f"Done · {len(outputs)} files written")
        done = {"status": "done", "finished": now(), "outputs": outputs}
        if st.get("next"):
            done["next"] = expand(st["next"], ctx)
        write(**done)
        return 200, {"ok": True, "key": key, "status": "done", "outputs": outputs}
    except NeedsMachine as e:
        with wlock:
            stop.set()
            put_json(key, {**job, "status": "queued", "cloud": False, "note": f"{e} — waiting for node tools/runner/worker.mjs"})
        return 202, {"ok": True, "key": key, "status": "queued", "note": str(e)}
    except Exception as e:
        with wlock:
            stop.set()
        log(f"FAILED: {e}")
        try:
            if state["prog"]:
                state["prog"].end(state["step"], "failed", msg=str(e), tail=lines[-20:])
        except Exception:
            pass
        try:
            write(status="failed", finished=now(), error=str(e))
        except Exception:
            pass
        return 200, {"ok": False, "key": key, "status": "failed", "error": str(e)}


class handler(BaseHTTPRequestHandler):
    def _send(self, status, body):
        data = json.dumps(body).encode("utf8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        ok = all(CFG[k] for k in ("endpoint", "key", "secret", "bucket"))
        self._send(200, {"runner": "vercel", "python": sys.version.split()[0], "r2": ok})

    def do_POST(self):
        if not all(CFG[k] for k in ("endpoint", "key", "secret", "bucket")):
            return self._send(503, {"error": "R2 is not configured on this deployment"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"error": "body must be JSON { key }"})
        status, out = run_job(str(body.get("key") or ""))
        self._send(status, out)
