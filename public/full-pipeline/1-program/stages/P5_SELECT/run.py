import sys, re
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from core.stage import F, result, summarize
from stages._common import confirmed, site, resolved, site_matches, accepted_keys, params_md

def run(ctx):
    if not ctx.shas("work", "selection.json"):
        return result("blocked", "No selection. Either: in the planner press 'Save settings' and copy the file to " + ctx.rel(ctx.s("work", "selection.json")) +
                      "; or the agent writes it as {\"option\": \"<letter>\"} from the user's choice.")
    s = site(ctx); brief, e1 = confirmed(ctx, "brief.json"); rules, e2 = confirmed(ctx, "rules.json")
    if e1 or e2: return result("blocked", e1 or e2)
    T = ctx.typology(); sel = ctx.sload("work", "selection.json"); dec = []
    if sel.get("typology", T.id) not in [l.split("@")[0] for l in T.lineage]:
        return result("failed", f"selection is for {sel.get('typology')}, this scope uses {T.ref}")
    sp = {k: v for k, v in sel.get("params", {}).items()}
    if "option" in sel: sp["option"] = sel["option"]
    if "option" not in sp: return result("failed", "selection has no option")
    sv = sel.get("typology_version")
    if sv and sv != T.version:
        if not T.has("migrate"): return result("failed", f"selection saved with {sv}; {T.ref} has no migrate()")
        try:
            sp, notes = T.call("migrate", sp, sv)
        except ValueError as e:
            return result("failed", str(e))
        dec += [f"selection migrated {sv} -> {T.version}: {n}" for n in notes] or [f"selection migrated {sv} -> {T.version} (no changes)"]
    opt = sp.pop("option")
    r = resolved(ctx, T, s, rules, opt, selection=sp)
    if r["errors"]: return result("failed", "; ".join(r["errors"]))
    p = r["params"]; dec += [f"param: {n}" for n in r["notes"]]
    fnd = []
    if not site_matches(s, p, T): fnd.append(F("fail", "site", "selection", "site values in the selection (plot size / sides / road side) differ from site.json — the planner was set to a different plot"))
    if p["option"] not in brief["options"]: fnd.append(F("warn", "brief", p["option"], "option was not in the brief's study list"))
    if ctx.approved and not re.search(rf"\boption\s*{p['option']}\b", ctx.approved, re.I):
        fnd.append(F("fail", "approval", p["option"], f"approval text must name 'option {p['option']}'"))
    res = T.call("generate", p); q = T.call("qc", res, rules, brief); acc = accepted_keys(sel)
    for x in q:
        if x["level"] == "fail" and (x["check"], x["ref"]) in acc:
            x["level"] = "warn"; x["msg"] += f" (accepted: {acc[(x['check'], x['ref'])]})"; dec.append(f"accepted QC finding {x['check']}:{x['ref']} — {acc[(x['check'], x['ref'])]}")
    fnd += q
    settings = {"typology": T.id, "typology_version": T.version, "app": "Town Home Rental Planner", "params": p, "title_block": sel.get("title_block", {})}
    outs = [ctx.ssave("selected.json", {"typology": T.id, "typology_version": T.version, "lineage": T.lineage, "pin": ctx.pin(), "params": p,
                                        "provenance": r["provenance"], "locks": r["locks"], "layers": r["manifest"], "result": res, "qc": q, "selected_from": sel.get("app", "chat"), "approved": ctx.approved}),
            ctx.ssave_text("output/selected_plan.svg", T.call("render_svg", res, f"Selected: option {p['option']}, {res['option_title']}")),
            ctx.ssave("output/planner_settings.json", settings),
            ctx.ssave_text("output/PARAMS.md", f"# Parameters — option {p['option']} ({T.ref})\n\n" + params_md(r) + "\n")]
    n = summarize(fnd)
    if n["fail"]:
        return result("blocked", f"option {p['option']} has {n['fail']} failing finding(s). Change parameters, or list them in selection.accepted with the user's reason.", outs, fnd, dec)
    return result("done", f"option {p['option']} ({res['option_title']}) selected with {T.ref}: {res['total']:.0f} sq ft, {res['coverage_pct']:.1f}% coverage", outs, fnd, dec)
