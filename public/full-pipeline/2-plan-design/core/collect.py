"""Merge an export of the published brief's store into one judged record.

The SAME trust rules as templates/app/core.js — keep them in step (tests/test_trust.py pins both):
  * a decision counts only if its author is rostered as `client`, and it is CURRENT only if made on the element's
    issued rev (otherwise the element is `stale`: changed since the client decided);
  * a fix counts only if its author is rostered as `modeler` and it is newer than the pin's last reopen;
  * only issued elements exist for the client and modeler; unissued ones are `draft`.
Export layout (what ArtifactData list --out_dir writes): <dir>/<collection>/<doc_id>.json for collections
brief, elements, renders, pins, roster, issues, inputs. Documents may be wrapped ({"data": {...}}) or bare.
"""
import glob, json, os

COLLECTIONS = ("brief", "elements", "renders", "pins", "roster", "issues", "inputs")

def _body(d):
    if isinstance(d, dict) and "data" in d and isinstance(d["data"], dict) and set(d) <= {"data", "id", "version", "path", "doc_id", "collection", "updated", "created"}: return d["data"]
    return d

def load_export(d):
    out = {c: {} for c in COLLECTIONS}
    for c in COLLECTIONS:
        for p in sorted(glob.glob(os.path.join(d, c, "*.json"))):
            out[c][os.path.splitext(os.path.basename(p))[0]] = _body(json.load(open(p, encoding="utf-8")))
    return out

def role_of(db, uid): return (db["roster"].get(uid) or {}).get("role")

def _num(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0.0

def _newer(a, au, b):
    """Latest wins; ties go to the higher uid — the same rule as core.js `newer`."""
    return b is None or _num(a.get("at")) > _num(b.get("at")) or (_num(a.get("at")) == _num(b.get("at")) and au > b["uid"])

def decision_of(db, eid):
    best = None
    for uid, doc in db["inputs"].items():
        if role_of(db, uid) != "client": continue
        d = (doc.get("decisions") or {}).get(eid)
        if isinstance(d, dict) and _newer(d, uid, best): best = dict(d, uid=uid, rev=int(_num(d.get("rev"))), at=_num(d.get("at")))
    return best

def ap_state(db, e):
    iss = e.get("issued")
    if not iss: return "draft"
    d = decision_of(db, e["id"])
    if not d: return "pending"
    if d.get("rev") != iss.get("rev"): return "stale"
    return "approved" if d.get("state") == "approved" else "changes"

def fix_of(db, p):
    best = None
    for uid, doc in db["inputs"].items():
        if role_of(db, uid) != "modeler": continue
        f = (doc.get("fixes") or {}).get(p["id"])
        if isinstance(f, dict) and _num(f.get("at")) > 0 and _newer(f, uid, best): best = dict(f, uid=uid, at=_num(f.get("at")))
    return best

def pin_state(db, p):
    if p.get("status") == "closed": return "closed"
    f = fix_of(db, p)
    return "fixed" if f and f["at"] > _num(p.get("reopenedAt")) else "open"

def replies_of(db, pid):
    out = []
    for uid, doc in db["inputs"].items():
        if not role_of(db, uid): continue
        for k, r in (doc.get("replies") or {}).items():
            if r.get("pin") == pid: out.append(dict(r, uid=uid, role=role_of(db, uid)))
    return sorted(out, key=lambda r: r.get("at", 0))

def ignored_inputs(db):
    """Inputs written by people who are not rostered in the role their input needs — reported, never counted."""
    out = []
    for uid, doc in db["inputs"].items():
        r = role_of(db, uid)
        if (doc.get("decisions") and r != "client"): out.append(f"{uid}: {len(doc['decisions'])} decision(s) ignored — not rostered as client (role {r or 'none'})")
        live = {k: f for k, f in (doc.get("fixes") or {}).items() if isinstance(f, dict) and _num(f.get("at")) > 0}
        if (live and r != "modeler"): out.append(f"{uid}: {len(live)} fix mark(s) ignored — not rostered as modeler (role {r or 'none'})")
    return out

def judge(db):
    meta = db["brief"].get("meta") or {}
    rounds = meta.get("rounds") or []; ridx = {r["id"]: i for i, r in enumerate(rounds)}
    els = []
    for e in sorted(db["elements"].values(), key=lambda e: (e.get("order", 0), e.get("code", ""))):
        iss = e.get("issued"); st = ap_state(db, e); d = decision_of(db, e["id"])
        view = dict(iss or e); view.update(id=e["id"], order=e.get("order", 0), origin=e.get("origin"))
        choice = None
        if d and iss and d.get("rev") == iss.get("rev") and d.get("choice"):
            choice = next((o for o in (iss.get("options") or []) if o["id"] == d["choice"]), None)
        pins = [p for p in db["pins"].values() if p.get("element") == e["id"]]
        els.append({"element": view, "issued": bool(iss), "rev": (iss or {}).get("rev", 0), "dirty": bool(e.get("dirty")) and bool(iss),
                    "state": st, "decision": d, "choice": choice, "pins": [p["id"] for p in pins]})
    pins = []
    for p in db["pins"].values():
        r = db["renders"].get(p.get("render"), {})
        pins.append(dict(p, state=pin_state(db, p), fix=fix_of(db, p), replies=replies_of(db, p["id"]), round=r.get("round"), view=r.get("view"),
                         round_name=next((x["name"] for x in rounds if x["id"] == r.get("round")), "")))
    pins.sort(key=lambda p: (ridx.get(p.get("round"), 99), p.get("at", 0)))
    counts = {k: sum(1 for e in els if e["state"] == k) for k in ("draft", "pending", "stale", "approved", "changes")}
    pcounts = {k: sum(1 for p in pins if p["state"] == k) for k in ("open", "fixed", "closed")}
    return {"schema": "spacebrief-collected/1", "meta": meta, "issue": meta.get("issue"), "issues": sorted(db["issues"].values(), key=lambda i: i.get("n", 0)),
            "roster": db["roster"], "elements": els, "renders": sorted(db["renders"].values(), key=lambda r: (ridx.get(r.get("round"), 99), r.get("order", 0))),
            "pins": pins, "counts": counts, "pin_counts": pcounts, "ignored": ignored_inputs(db)}
