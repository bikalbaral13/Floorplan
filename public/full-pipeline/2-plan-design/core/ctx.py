"""BriefCtx — the stage context with this pipeline's conveniences."""
import datetime, hashlib, json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "_vendor"))
from pipeline_kit import stage as S, paths as P   # noqa: E402

VERSION = open(os.path.join(ROOT, "VERSION"), encoding="utf-8").read().strip()

def sha256(path): return hashlib.sha256(open(path, "rb").read()).hexdigest()

def validate(data, schema_name):
    """Validate against schemas/<name>.schema.json (or schemas/library/). Returns (ok, message). jsonschema optional."""
    for d in ("schemas", os.path.join("schemas", "library")):
        p = os.path.join(ROOT, d, f"{schema_name}.schema.json")
        if os.path.exists(p): break
    else: return False, f"no schema {schema_name}"
    try: import jsonschema
    except ImportError: return True, "jsonschema not installed — structure not checked"
    errs = sorted(jsonschema.Draft202012Validator(json.load(open(p, encoding="utf-8"))).iter_errors(data), key=lambda e: list(e.path))
    if not errs: return True, "valid"
    return False, "; ".join(f"{'/'.join(map(str, e.path)) or '<root>'}: {e.message[:120]}" for e in errs[:5])

class BriefCtx(S.Ctx):
    @property
    def standards(self):
        from pipeline_kit import standards as STD          # library/Standards copy, extends merged (shared loader)
        return STD.load(os.path.join(ROOT, "standards"), self.project.get("standards") or "DEFAULT")
    def scope(self): return self.load("scope.json", default={})
    def jw(self, *parts, default=None):
        p = self.w(*parts); return P.load_json(p, default) if os.path.exists(p) or default is not None else P.load_json(p)
    def sw(self, rel, data): return P.save_json(self.w(rel), data)
    def run_id(self):
        r = self.load("run.state.json", default={})
        if not r.get("run_id"):
            r = {"run_id": datetime.datetime.utcnow().strftime("%Y%m%dT%H%M%SZ"), "started": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
            self.save("run.state.json", r)
        return r["run_id"]
