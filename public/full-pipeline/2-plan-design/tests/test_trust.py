"""python tests/test_trust.py — the trust rules shared by templates/app/core.js and core/collect.py."""
import os, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); sys.path.insert(0, ROOT)
from core import collect as C
res = []
def check(c, m): res.append((bool(c), m))
def db(**k):
    d = {c: {} for c in C.COLLECTIONS}; d["brief"]["meta"] = {"rounds": [{"id": "r1", "name": "R1"}]}
    for c, v in k.items(): d[c] = v
    return d
E = lambda rev: {"id": "e1", "code": "FL-01", "order": 1, "rev": rev, "issued": {"rev": rev, "code": "FL-01", "options": [{"id": "o1", "label": "Oak"}]}} if rev else {"id": "e1", "code": "FL-01"}
dec = lambda st, rev, at=1, choice=None: {"decisions": {"e1": {"state": st, "rev": rev, "at": at, "choice": choice}}}
check(C.ap_state(db(), E(0)) == "draft", "an element never issued is draft")
check(C.ap_state(db(), E(1)) == "pending", "issued with no decision is pending")
check(C.ap_state(db(roster={"c": {"role": "client"}}, inputs={"c": dec("approved", 1)}), E(1)) == "approved", "a rostered client's approval on the issued rev counts")
check(C.ap_state(db(roster={"c": {"role": "client"}}, inputs={"c": dec("approved", 1)}), E(2)) == "stale", "an approval on an older rev is stale")
check(C.ap_state(db(roster={"m": {"role": "modeler"}}, inputs={"m": dec("approved", 1)}), E(1)) == "pending", "a modeler's approval is ignored")
check(C.ap_state(db(roster={}, inputs={"x": dec("approved", 1)}), E(1)) == "pending", "an approval from someone not on the roster is ignored")
check(C.ap_state(db(roster={"a": {"role": "client"}, "b": {"role": "client"}}, inputs={"a": dec("approved", 1, 1), "b": dec("changes", 1, 2)}), E(1)) == "changes", "the latest client decision wins")
J = C.judge(db(elements={"e1": E(1)}, roster={"c": {"role": "client"}}, inputs={"c": dec("approved", 1, choice="o1")}))
check(J["elements"][0]["choice"]["label"] == "Oak", "the chosen option is resolved from the issued options")
P = {"id": "p1", "status": "open", "render": "x"}
check(C.pin_state(db(), P) == "open", "a pin starts open")
check(C.pin_state(db(roster={"m": {"role": "modeler"}}, inputs={"m": {"fixes": {"p1": {"at": 5}}}}), P) == "fixed", "a rostered modeler's fix marks it fixed")
check(C.pin_state(db(roster={"m": {"role": "client"}}, inputs={"m": {"fixes": {"p1": {"at": 5}}}}), P) == "open", "a fix from a non-modeler is ignored")
check(C.pin_state(db(roster={"m": {"role": "modeler"}}, inputs={"m": {"fixes": {"p1": {"at": 5}}}}), dict(P, reopenedAt=9)) == "open", "a fix older than the reopen does not count")
check(C.pin_state(db(roster={"m": {"role": "modeler"}}, inputs={"m": {"fixes": {"p1": {"at": 0}}}}), P) == "open", "an undone fix (at 0) does not count")
check(C.pin_state(db(), dict(P, status="closed")) == "closed", "the architect's close wins")
check(len(C.ignored_inputs(db(roster={"m": {"role": "modeler"}}, inputs={"m": dec("approved", 1)}))) == 1, "ignored inputs are reported")
# the JS core must state the same rules — guard against one side drifting
js = open(os.path.join(ROOT, "templates", "app", "core.js"), encoding="utf-8").read()
for frag in ("roleOf(uid) !== 'client'", "d.rev !== iss.rev", "roleOf(uid) !== 'modeler'", "f.at > num(p.reopenedAt)", "if (!e.issued) return null"):
    check(frag in js, f"core.js still contains: {frag}")
bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
