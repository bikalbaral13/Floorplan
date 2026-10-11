import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core import typology as typ
from core.stage import F, result

QUESTIONS = ["How many rental units / what building, and on how many floors now and later?",
             "Which entrance facings are acceptable?",
             "Will floors be added later (keep a court / staircase)?",
             "Smallest unit you would rent out (sq ft), and target tenants?",
             "Which layout options should be studied (default: all the typology offers)?"]
GENERIC = {"unit_count": None, "facing_allowed": [], "future_floors": True, "options": []}

def fit_table(site_d, brief):
    rows = []
    for tid, info in typ.registry().items():
        try:
            T = typ.load(tid)
        except Exception as e:
            rows.append({"ref": f"{tid}@{info.get('version')}", "status": info.get("status"), "fits": False, "notes": [f"cannot load: {e}"]}); continue
        a = typ.applicability(T, site_d, brief)
        rows.append({"ref": T.ref, "status": info.get("status"), "fits": all(ok for ok, _ in a) and info.get("status") == "tested", "notes": [("ok  " if ok else "NO  ") + t for ok, t in a]})
    return rows

def run(ctx):
    site_d = ctx.sload("site.json") if ctx.shas("site.json") else None
    pin = ctx.pin(); pinned = bool(pin.get("typology") or pin.get("variant"))
    T = ctx.typology() if pinned else None
    if not ctx.shas("brief.json"):
        base = dict(T.schema.get("brief_defaults", {})) if T else dict(GENERIC)
        cands = fit_table(site_d, base if T else None)
        b = dict(base, status="draft", confirmed_on="", tenants="", notes="", questions=QUESTIONS,
                 typology_match={"decision": "", "typology": T.ref if T else "", "variant": pin.get("variant", ""), "reason": "",
                                 "_help": "decision: existing (registered typology as is, parameters only) | variant (project-local extends) | new (new typology). See AGENTS.md section 2."},
                 candidates=cands)
        ctx.ssave("brief.json", b)
        good = [c["ref"] for c in cands if c["fits"]]
        return result("blocked", "Draft brief written with typology candidates (" + (", ".join(good) or "none fit") + "). Ask the user: " + " | ".join(QUESTIONS) +
                      " Then record typology_match and confirm.", [ctx.rel(ctx.s("brief.json"))])
    b = ctx.sload("brief.json")
    if b.get("status") != "confirmed":
        return result("blocked", "brief.json is still a draft. Confirm it and typology_match with the user, set status=confirmed and confirmed_on, then rerun.")
    m = b.get("typology_match") or {}
    dec = m.get("decision")
    if dec not in ("existing", "variant", "new"):
        return result("failed", "typology_match.decision must be existing / variant / new (AGENTS.md section 2)")
    if not m.get("reason"): return result("failed", "typology_match.reason is empty — record why this typology fits (or why it had to change)")
    if not pinned:
        how = {"existing": f"python tools/set_typology.py {ctx.code} {m.get('typology')}",
               "variant": f"python tools/new_variant.py {ctx.code} --extends {m.get('typology')} --id <VARIANT_ID>",
               "new": "python tools/new_typology.py <ID> ... then implement, test, and set_typology"}[dec]
        return result("blocked", f"Decision '{dec}' recorded but no typology is pinned for {ctx.scope}. Next: {how}")
    missing = [k for k, v in T.schema.get("brief_defaults", {}).items() if b.get(k) in (None, [], "")]
    if missing:
        for k in missing: b[k] = T.schema["brief_defaults"][k]
        b.update(status="draft", confirmed_on="", notes=(b.get("notes", "") + f" Filled from {T.ref} defaults: {', '.join(missing)}.").strip())
        ctx.ssave("brief.json", b)
        return result("blocked", f"brief.json had no {', '.join(missing)}; filled from {T.ref} defaults ({', '.join(f'{k}={b[k]}' for k in missing)}). Confirm them with the user, then rerun.", [ctx.rel(ctx.s("brief.json"))])
    fnd = []
    if dec == "variant" and not pin.get("variant"): fnd.append(F("fail", "match", "pin", "decision is variant but the pin is a registered typology"))
    if dec != "variant" and pin.get("variant"): fnd.append(F("fail", "match", "pin", f"decision is {dec} but the pin is a project variant"))
    if dec in ("existing", "new") and m.get("typology") and m["typology"].split("@")[0] != T.id: fnd.append(F("fail", "match", "pin", f"brief says {m['typology']}, pinned {T.ref}"))
    if dec == "variant" and typ.registry().get(T.lineage[1].split("@")[0], {}).get("status") != "tested":
        fnd.append(F("fail", "match", T.lineage[1], "a variant must extend a tested typology"))
    if dec in ("existing", "new") and typ.registry().get(T.id, {}).get("status") != "tested":
        fnd.append(F("fail", "match", T.id, f"{T.id} status is {typ.registry().get(T.id, {}).get('status')} — only tested typologies run projects"))
    if "unit_count" in T.schema and b.get("unit_count") != T.schema["unit_count"]: fnd.append(F("fail", "units", "brief", f"{T.ref} makes {T.schema['unit_count']} units, brief asks {b.get('unit_count')}"))
    bad = set(b.get("facing_allowed", [])) - set(T.schema.get("facings", b.get("facing_allowed", [])))
    if bad: fnd.append(F("fail", "facing", "brief", f"facings {sorted(bad)} not offered by {T.ref}"))
    if not b.get("facing_allowed"): fnd.append(F("fail", "facing", "brief", "facing_allowed is empty"))
    bad = set(b.get("options", [])) - set(T.schema["options"])
    if bad or not b.get("options"): fnd.append(F("fail", "options", "brief", f"options {sorted(bad) or '[]'} not in {T.ref}"))
    if not b.get("confirmed_on"): fnd.append(F("fail", "confirm", "brief", "confirmed_on missing"))
    for ok, t in typ.applicability(T, site_d, b):
        if not ok: fnd.append(F("fail", "fit", T.ref, t))
    st = "failed" if any(x["level"] == "fail" for x in fnd) else "done"
    return result(st, f"brief confirmed {b.get('confirmed_on')}: {dec} -> {T.ref}" + (f" (variant of {T.lineage[1]})" if dec == "variant" else "") +
                  f", options {''.join(b.get('options', []))}", [ctx.rel(ctx.s("brief.json"))], fnd, [f"typology match: {dec} {T.ref} — {m.get('reason')}"])
