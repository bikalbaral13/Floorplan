"""S9 — join the AI clips in shot order into <CODE>_final.mp4 (optionally under scope.audio_file)."""
from core.stage import result, F, status_from

def run(ctx):
    doc, jobs, s = ctx.load("shots.json"), ctx.load("jobs.json", default={}), ctx.scope
    missing = [x["id"] for x in doc["shots"] if not jobs.get(x["id"], {}).get("file")]
    if missing: return result("failed", f"no AI clip for {missing} — finish S8 first")
    out = ctx.out(f"{ctx.code}_final.mp4")
    r = ctx.blender("assemble.py", {"clips": [ctx.p(jobs[x["id"]]["file"]) for x in doc["shots"]], "out": out, "audio": s.get("audio_file") or ""})
    if not r.get("ok"): return result("failed", f"assemble: {r.get('error')}", findings=[F("fail", "blender", "assemble", r.get("tail") or "")])
    want = sum(x["duration"] for x in doc["shots"]); fnd = []
    if abs(r["seconds"] - want) > want * 0.1: fnd.append(F("warn", "timing", "total", f"final {r['seconds']} s vs shot list {want:g} s (AI clips may differ in length)"))
    ctx.save("final.json", {"video": ctx.wrel(out), "seconds": r["seconds"], "res": r["res"], "fps": r["fps"], "clips": [jobs[x["id"]]["file"] for x in doc["shots"]]})
    return result(status_from(fnd), f"{r['seconds']} s at {r['res'][0]}x{r['res'][1]} → {ctx.wrel(out)}", ["final.json", ctx.wrel(out)], fnd)
