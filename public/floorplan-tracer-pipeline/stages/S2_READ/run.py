"""S2 — validate reading.json; drawings: fit / cross-check the scale (least squares, residual per pair);
sketches: require the user's confirmation of the reading."""
from core import dims, paths
from core.stage import result
from core.model import F

def run(ctx):
    if not ctx.has("reading.json"):
        return result("blocked", f"reading.json missing — the agent reads the source per stages/S2_READ/prompt.md ({ctx.branch} branch)")
    r = ctx.load("reading.json"); fnd = []; outs = ["reading.json"]; ch = ctx.standards().get("checks", {})
    if r.get("branch") != ctx.branch: fnd.append(F("fail", "reading", "branch", f"reading is {r.get('branch')!r}, scope says {ctx.branch!r}"))
    if ctx.scope.get("objects", "all") == "all" and "symbols" not in r:
        fnd.append(F("fail", "reading", "symbols", "objects are mandatory: list every drawn symbol by kind and count (empty list if none)"))
    if ctx.branch == "drawing":
        cal = r.get("calibration", {}); user = cal.get("user_px_per_m") or ctx.scope.get("user_px_per_m")
        pairs = cal.get("pairs", [])
        if ctx.scope.get("scale_owner") == "user" and not user:
            fnd.append(F("fail", "scale", "user", "the user owns the scale: put their px/m in calibration.user_px_per_m (from scope or their Set Scale)"))
        fit = dims.calibrate(pairs) if len(pairs) >= 1 else None
        if fit:
            if user:
                k = float(user) * 0.3048
                for p in fit["pairs"]: p["residual_ft"] = round(p["px"] / k - p["ft"], 3)
                fit["max_residual_ft"] = max(abs(p["residual_ft"]) for p in fit["pairs"])
                fit.update(px_per_m=float(user), method="user", lsq_px_per_m=fit["px_per_m"])
            else:
                fit["method"] = "least-squares"
                if len(pairs) < 3: fnd.append(F("warn", "scale", "pairs", f"only {len(pairs)} printed pair(s): one digit mis-read hides in a short list"))
            worst = sorted(fit["pairs"], key=lambda p: -abs(p["residual_ft"]))[:3]
            lvl = "fail" if fit["max_residual_ft"] > ch.get("calibration_fail_ft", 0.6) else ("warn" if fit["max_residual_ft"] > ch.get("calibration_warn_ft", 0.25) else "info")
            fnd.append(F(lvl, "scale", fit["method"], f"{fit['px_per_m']} px/m; worst residuals " + ", ".join(f"{p['name']} {p['residual_ft']:+.2f} ft" for p in worst)
                         + ("  (a pair ~1 ft off = a mis-read digit or the wrong face: fix it, do not average it in)" if lvl != "info" else "")))
        elif user: fit = {"px_per_m": float(user), "method": "user", "pairs": [], "n_pairs": 0, "max_residual_ft": None}
        else: fnd.append(F("fail", "scale", "none", "no scale: printed pairs, the user's px/m, an overall dimension or a stated standard — say which"))
        if fit:
            paths.save_json(ctx.w("calib.json"), fit); outs.append(ctx.wrel(ctx.w("calib.json")))
        for sh in r.get("sheets", []):
            if not sh.get("origin_px"): fnd.append(F("fail", "reading", sh.get("page"), "sheet needs origin_px (world origin in image px; W/2, H/2 keeps the underlay centred)"))
    else:
        for k in ("given", "drawn", "inferred", "rooms", "block_diagram"):
            if not r.get(k): fnd.append(F("fail", "reading", k, f"sketch reading needs {k!r}"))
        if not ctx.approved:
            return result("blocked", "Sketch reading written. Present the block diagram, the inferred values and the ambiguous cell to the user; rerun with --approved \"<their answer>\".", outs, fnd)
    st = "failed" if any(f["level"] == "fail" for f in fnd) else "done"
    dec = [f"sketch reading confirmed by the user: {ctx.approved}"] if ctx.branch == "sketch" and st == "done" else []
    return result(st, f"reading ok ({ctx.branch})" if st == "done" else "reading has failures", outs, fnd, dec)
