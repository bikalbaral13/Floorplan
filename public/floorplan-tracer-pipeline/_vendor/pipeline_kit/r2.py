"""R2 (S3 API) client, stdlib only — the same conventions as the app's tools/r2.mjs so the two are interchangeable:
path-style SigV4, `x-amz-meta-sha256` on every put (publishes skip unchanged files by HEAD), `cache-control: no-cache`.

Stores share one interface — head(key) -> sha256|None|"" (exists, digest unknown), get(key) -> bytes|None,
put(key, data, content_type) — so tests and dry runs use LocalStore instead of the bucket.

Credentials: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (+ R2_PUBLIC_URL) from the environment,
else from the first .env / .env.local found walking up from the current folder. Keys are bucket-root keys
("library/…", "Projects/…"). Never print the secrets."""
import datetime, hashlib, hmac, os, urllib.error, urllib.parse, urllib.request

def sha256(b): return hashlib.sha256(b).hexdigest()

CT = {".json": "application/json", ".md": "text/markdown; charset=utf-8", ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml",
      ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".pdf": "application/pdf", ".glb": "model/gltf-binary",
      ".txt": "text/plain; charset=utf-8", ".py": "text/x-python; charset=utf-8"}
def content_type(path): return CT.get(os.path.splitext(path)[1].lower(), "application/octet-stream")

def _dotenv(start):
    env, d = {}, os.path.abspath(start)
    while True:
        for f in (".env", ".env.local"):
            p = os.path.join(d, f)
            if os.path.exists(p):
                for line in open(p, encoding="utf-8", errors="replace"):
                    k, sep, v = line.strip().partition("=")
                    if sep and k.isupper() and k not in env: env[k] = v.strip().strip('"')
        if env.get("R2_ENDPOINT") or os.path.dirname(d) == d: return env
        d = os.path.dirname(d)

def config(start="."):
    env = {**_dotenv(start), **{k: v for k, v in os.environ.items() if k.startswith("R2_")}}
    cfg = {k: env.get("R2_" + k.upper(), "") for k in ("endpoint", "access_key_id", "secret_access_key", "bucket", "public_url")}
    return cfg if all(cfg[k] for k in ("endpoint", "access_key_id", "secret_access_key", "bucket")) else None

class R2Store:
    def __init__(self, cfg):
        self.cfg = cfg; self.public_url = cfg.get("public_url", "").rstrip("/")
    def __repr__(self): return f"R2Store({self.cfg['bucket']})"

    def _request(self, method, key, body=b"", headers=None):
        u = urllib.parse.urlparse(self.cfg["endpoint"].rstrip("/"))
        uri = "/" + "/".join(urllib.parse.quote(s, safe="-_.~") for s in [self.cfg["bucket"], *key.split("/")])
        now = datetime.datetime.now(datetime.timezone.utc); amz = now.strftime("%Y%m%dT%H%M%SZ"); day = amz[:8]
        h = {"host": u.netloc, "x-amz-content-sha256": sha256(body), "x-amz-date": amz, **{k.lower(): str(v) for k, v in (headers or {}).items()}}
        names = sorted(h); signed = ";".join(names)
        creq = "\n".join([method, uri, "", "".join(f"{n}:{h[n].strip()}\n" for n in names), signed, h["x-amz-content-sha256"]])
        scope = f"{day}/auto/s3/aws4_request"
        sts = "\n".join(["AWS4-HMAC-SHA256", amz, scope, sha256(creq.encode())])
        k = ("AWS4" + self.cfg["secret_access_key"]).encode()
        for part in (day, "auto", "s3", "aws4_request"): k = hmac.new(k, part.encode(), hashlib.sha256).digest()
        sig = hmac.new(k, sts.encode(), hashlib.sha256).hexdigest()
        h["authorization"] = f"AWS4-HMAC-SHA256 Credential={self.cfg['access_key_id']}/{scope}, SignedHeaders={signed}, Signature={sig}"
        req = urllib.request.Request(f"{u.scheme}://{u.netloc}{uri}", data=body if method in ("PUT", "POST") else None, method=method,
                                     headers={k: v for k, v in h.items() if k != "host"})
        return urllib.request.urlopen(req, timeout=120)

    def head(self, key):
        try:
            with self._request("HEAD", key) as r: return r.headers.get("x-amz-meta-sha256", "") or ""
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            raise
    def get(self, key):
        try:
            with self._request("GET", key) as r: return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            raise
    def put(self, key, data, ctype=None):
        with self._request("PUT", key, data, {"content-type": ctype or content_type(key), "cache-control": "no-cache",
                                              "x-amz-meta-sha256": sha256(data)}): pass
        return key
    def public(self, key): return f"{self.public_url}/{key}" if self.public_url else ""

class LocalStore:
    """A folder standing in for the bucket (tests, offline dry runs). Digests kept in a sidecar like x-amz-meta-sha256."""
    def __init__(self, root): self.root = root; self.puts = []
    def __repr__(self): return f"LocalStore({self.root})"
    def _p(self, key): return os.path.join(self.root, *key.split("/"))
    def head(self, key):
        p = self._p(key)
        return (open(p + ".sha256").read() if os.path.exists(p + ".sha256") else "") if os.path.exists(p) else None
    def get(self, key):
        p = self._p(key)
        return open(p, "rb").read() if os.path.exists(p) else None
    def put(self, key, data, ctype=None):
        p = self._p(key); os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "wb").write(data); open(p + ".sha256", "w").write(sha256(data)); self.puts.append(key); return key
    def public(self, key): return ""

def default_store(start="."):
    cfg = config(start)
    if not cfg: raise RuntimeError("R2 is not configured: set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (env or .env)")
    return R2Store(cfg)
