"""python tests/test_archive.py — S8's integrity and parity checks catch a tampered deck package."""
import base64, copy, hashlib, os, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from core import archive as A
res = []
def check(c, m): res.append((bool(c), m))
b = b"PK\x03\x04 fake pptx bytes"
iss = {"rev": 1, "code": "FL-01", "name": "Floor", "cat": "floor", "shapes": [], "spec": {}, "dims": [], "notes": "", "refs": [], "options": []}
raw = {"meta": {}, "elements": {"e1": {"id": "e1", "issued": iss}}, "pins": {"p1": {"id": "p1", "status": "open", "render": "r"}},
       "renders": {}, "roster": {"c": {"role": "client"}, "m": {"role": "modeler"}}, "inputs": {"c": {"decisions": {"e1": {"state": "approved", "rev": 1, "at": 5}}}, "m": {"fixes": {"p1": {"at": 6}}}}, "issues": {}}
pkg = {"schema": "spacebrief-deck/1", "version": 1, "elements": [dict(iss, id="e1", state="approved")], "pins": [{"id": "p1", "state": "fixed"}], "raw": raw,
       "pptx": {"base64": base64.b64encode(b).decode(), "sha256": hashlib.sha256(b).hexdigest()}}
check(A.parity(pkg) == [], "an honest package passes parity")
_, sha = A.pptx_bytes(pkg); check(sha == pkg["pptx"]["sha256"], "decoded bytes match the recorded sha256")
t = copy.deepcopy(pkg); t["pptx"]["base64"] = base64.b64encode(b + b"x").decode()
check(A.pptx_bytes(t)[1] != pkg["pptx"]["sha256"], "changed deck bytes are detected")
t = copy.deepcopy(pkg); t["elements"][0]["state"] = "pending"
check(any("e1" in d or "FL-01" in d for d in A.parity(t)), "a frozen state that disagrees with the trust rules is reported")
t = copy.deepcopy(pkg); t["raw"]["roster"]["c"]["role"] = "modeler"
check(any("FL-01" in d for d in A.parity(t)), "an approval from someone not rostered as client is not accepted as 'approved'")
t = copy.deepcopy(pkg); t["raw"]["pins"]["p1"]["reopenedAt"] = 9
check(any("p1" in d for d in A.parity(t)), "a fix older than the reopen is not accepted as 'fixed'")
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
