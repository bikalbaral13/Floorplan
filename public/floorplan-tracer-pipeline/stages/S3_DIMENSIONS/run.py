"""S3 — close the dimensions into one grid (the constants module the layout is built on).
SKETCH: dims.json = {"x": {outer, wall_out, lines, bays: [{value | null, px}], round}, "y": {...}} → closed chains.
DRAWING: dims.json optional = {"solve": {px_per_m, lines, chain}} → centrelines placed from printed clear spans."""
from core import dims, paths, units as U
from core.stage import result
from core.model import F

def run(ctx):
    out = ctx.w("dims.resolved.json"); fnd = []; dec = []
    if not ctx.has("dims.json"):
        if ctx.branch == "sketch": return result("blocked", "dims.json missing — write the bay chains (stages/S4_LAYOUT/prompt.md § dimensions)")
        paths.save_json(out, {"grid": {"x": {}, "y": {}}, "note": "measured centrelines used directly (no printed-span solve)"})
        return result("done", "no dims.json — the layout uses measured centrelines", [ctx.wrel(out)])
    d = ctx.load("dims.json"); grid = {"x": {}, "y": {}}; rep = {}
    if ctx.branch == "sketch" or "x" in d:
        for ax in ("x", "y"):
            if ax not in d: continue
            try:
                r = dims.close_chain(d[ax])
            except (ValueError, AssertionError) as e:
                fnd.append(F("fail", "chain", ax, str(e))); continue
            grid[ax].update(r["lines"]); rep[ax] = r
            fit = [r["bays_ftin"][i] for i in r["fitted"]]
            dec.append(f"{ax}: c-c {U.ftin(r['cc_m'])} (outer {U.ftin(r['outer_m'])}), bays {' + '.join(r['bays_ftin'])}" + (f"; fitted {', '.join(fit)} from sketch proportions" if fit else ""))
            fnd.append(F("info", "chain", ax, dec[-1]))
        for ax in ("x", "y"):
            for k, v in (d.get("extra", {}).get(ax, {}) or {}).items():   # derived lines (partitions off-grid), expressions allowed
                from core.layout import Frame
                grid[ax][k] = round(Frame({"type": "metric"}, grid).val(v, ax), 6)
    if "solve" in d:
        s = dims.solve_centrelines(d["solve"]); rep["solve"] = s
        for n, v in s.items():
            grid.setdefault(d["solve"].get("axis_of", {}).get(n, "x"), {})[n] = v["px"]
            if abs(v["moved_px"]) > 0.01: fnd.append(F("warn" if abs(v["moved_px"]) > 12 else "info", "solve", n, f"moved {v['moved_px']:+.1f} px ({v['from']})" + ("  — a jump this size is usually a mis-read digit" if abs(v["moved_px"]) > 12 else "")))
    paths.save_json(out, {"grid": grid, "report": rep})
    st = "failed" if any(f["level"] == "fail" for f in fnd) else "done"
    return result(st, f"grid: {len(grid['x'])} x-lines, {len(grid['y'])} y-lines", [ctx.wrel(out)], fnd, dec)
