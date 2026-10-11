"""Krea REST client for S8_GENERATE in api mode (standard library only).

The key is read from the environment variable named in standards krea.key_env (default KREA_API_KEY) — never from
a project file, never VITE_-prefixed. Paths come from standards krea.*; they stay `verified: false` until checked
against Krea's REST docs. In connector mode the agent submits through the Krea MCP connector instead and records
the jobs in jobs.json; this module then only downloads finished clips.
"""
import json, os, time, urllib.request, urllib.error, uuid

class KreaError(Exception):
    def __init__(self, status, body): super().__init__(f"HTTP {status}: {body}"); self.status, self.body = status, body

def _key(cfg):
    k = os.environ.get(cfg.get("key_env", "KREA_API_KEY"), "")
    if not k: raise KreaError(0, f"set ${cfg.get('key_env', 'KREA_API_KEY')} in the environment")
    return k

def _req(cfg, method, path, body=None):
    url = path if path.startswith("http") else cfg["api_base"].rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    hdr = {"Authorization": f"Bearer {_key(cfg)}", **({"Content-Type": "application/json"} if data else {})}
    try:
        with urllib.request.urlopen(urllib.request.Request(url, data=data, method=method, headers=hdr), timeout=120) as r:
            txt = r.read().decode("utf-8", "replace")
            try: return json.loads(txt)
            except ValueError: return txt.strip()
    except urllib.error.HTTPError as e:
        raise KreaError(e.code, e.read().decode("utf-8", "replace")[:500])

def upload(cfg, file_path):
    """Presigned upload: get a URL, POST the file as multipart field 'file'; the answer is the asset URL (plain text)."""
    up = _req(cfg, "GET", cfg["upload_path"]); url = up if isinstance(up, str) else up.get("url")
    b = uuid.uuid4().hex; name = os.path.basename(file_path)
    body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
            f"Content-Type: application/octet-stream\r\n\r\n").encode() + open(file_path, "rb").read() + f"\r\n--{b}--\r\n".encode()
    r = urllib.request.Request(url, data=body, method="POST", headers={"Content-Type": f"multipart/form-data; boundary={b}"})
    with urllib.request.urlopen(r, timeout=600) as resp: return resp.read().decode().strip()

def submit(cfg, model, payload): return _req(cfg, "POST", cfg["generate_path"].format(endpoint=f"video/{model}"), payload)

def job(cfg, job_id): return _req(cfg, "GET", cfg["job_path"].format(job_id=job_id))

def wait(cfg, job_id, poll_s=15, timeout_s=1800):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        j = job(cfg, job_id)
        if j.get("status") in ("completed", "failed", "cancelled"): return j
        time.sleep(poll_s)
    return {"status": "timeout", "job_id": job_id}

def download(url, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    with urllib.request.urlopen(url, timeout=600) as r, open(dst, "wb") as f: f.write(r.read())
    return dst
