"""Findings and stage results — one shape for every pipeline's checks and stages."""

def F(level, check, ref, msg):
    """A finding. level: fail | warn | info."""
    assert level in ("fail", "warn", "info"), level
    return {"level": level, "check": check, "ref": ref, "msg": msg}

def summarize(findings):
    n = {"fail": 0, "warn": 0, "info": 0}
    for f in findings: n[f["level"]] = n.get(f["level"], 0) + 1
    return n

def result(status, message="", outputs=None, findings=None, decisions=None):
    """status: done | blocked (needs input) | failed (something is wrong) | skipped."""
    return {"status": status, "message": message, "outputs": outputs or [], "findings": findings or [], "decisions": decisions or []}

def status_from(findings, ok="done"):
    return "failed" if any(f["level"] == "fail" for f in findings) else ok
