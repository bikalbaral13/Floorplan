import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.stage import F, result

def run(ctx):
    T = ctx.typology()
    want = {k: v for k, v in T.schema.get("rule_defaults", {}).items() if not k.startswith("_")}
    for o in T.objects.values():
        for rk in o.schema.get("rule_keys", {}).values(): want.setdefault(rk, None)
    if not ctx.shas("rules.json"):
        src = None
        if ctx.scope != "PROJECT" and ctx.has("rules.json"): src = ctx.load("rules.json")
        r = dict(want); r.update({k: v for k, v in (src or {}).items() if k in want or k in ("authority", "source")})
        r.update(status="draft", confirmed_on="", source=(src or {}).get("source", ""), note=T.schema.get("rule_defaults", {}).get("_note", "Placeholders until confirmed."))
        out = ctx.ssave("rules.json", r)
        return result("blocked", f"Draft rules written ({'from project rules + ' if src else ''}{T.ref} defaults; placeholders). Ask the user for the authority, the source and each value; then confirm.", [out])
    r = ctx.sload("rules.json")
    if r.get("status") != "confirmed": return result("blocked", "rules.json is still a draft. Confirm every value with the user, then rerun.")
    new = [k for k in want if k not in r]
    if new:
        for k in new: r[k] = T.schema.get("rule_defaults", {}).get(k)
        r.update(status="draft", pending=new); ctx.ssave("rules.json", r)
        return result("blocked", f"{T.ref} needs rules not in the confirmed set: {', '.join(new)} (placeholders added). Confirm them with the user, then rerun.", [ctx.rel(ctx.s("rules.json"))])
    r.pop("pending", None)
    fnd = []
    for k in ("confirmed_on", "source"):
        if not r.get(k): fnd.append(F("fail", "confirm", k, f"{k} missing"))
    for k, v in r.items():
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v < 0: fnd.append(F("fail", "value", k, f"{k} = {v} < 0"))
    if (r.get("side_setback_min_ft") or 0) > (r.get("side_setback_max_ft") or 1e9): fnd.append(F("fail", "value", "side_setback", "min > max"))
    c = r.get("coverage_max_pct")
    if c is not None and not (0 < c <= 100): fnd.append(F("fail", "value", "coverage_max_pct", f"{c} not in (0, 100]"))
    for k in want:
        if k not in r: fnd.append(F("fail", "missing", k, f"{k} missing (needed by {T.ref} or its objects)"))
        elif r[k] is None: fnd.append(F("warn", "unset", k, f"{k} is null — its check is skipped"))
    st = "failed" if any(x["level"] == "fail" for x in fnd) else "done"
    return result(st, f"rules confirmed {r.get('confirmed_on')} (source: {r.get('source')})", [ctx.rel(ctx.s("rules.json"))], fnd)
