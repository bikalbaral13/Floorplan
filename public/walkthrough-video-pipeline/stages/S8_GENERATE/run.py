"""S8 — generate one AI clip per shot, resumable.

jobs.json  {"<ID>": {"ref_url", "job_id", "status", "result_url", "file", "error"}}   (project file, small)
connector  the agent submits generate/requests.json entries through the Krea MCP connector one at a time and records
           ref_url / job_id / result_url here; this stage downloads finished clips and reports what is left.
api        upload → submit → wait → download with $KREA_API_KEY; 402 / 429 block with the shot to resume from.
"""
import os
from core import krea, shots as SH
from core.stage import result, F

def payload(p, sh, ref_url):
    return {"prompt": SH.full_prompt(p, sh["id"]), "reference_videos": [ref_url] if ref_url else [], "duration": int(sh["duration"]),
            "resolution": p["resolution"], "aspect_ratio": p["aspect_ratio"], "seed": p["seed"]}

def run(ctx):
    s, std, p, pv, doc = ctx.scope, ctx.standards(), ctx.load("prompts.json"), ctx.load("preview.json"), ctx.load("shots.json")
    if not ctx.load("budget.json", default={}).get("approved"): return result("failed", "S7 budget not approved")
    jobs = ctx.load("jobs.json", default={}); cfg = std["krea"]; mode = s.get("ai_mode") or cfg["mode_default"]
    clips = {x["id"]: ctx.p(x["clip"]) for x in pv["shots"]}
    fnd, got = [], []
    def save(): ctx.save("jobs.json", jobs)
    for sh in doc["shots"]:
        sid = sh["id"]; j = jobs.setdefault(sid, {}); dst = ctx.out("ai", f"{sid}.mp4")
        if j.get("file") and os.path.exists(ctx.p(j["file"])): got.append(sid); continue
        if mode == "api":
            try:
                if not j.get("ref_url"): j["ref_url"] = krea.upload(cfg, clips[sid]); save()
                if not j.get("job_id"): j["job_id"] = krea.submit(cfg, p["model"], payload(p, sh, j["ref_url"]))["job_id"]; save()
                res = krea.wait(cfg, j["job_id"]); j["status"] = res.get("status")
                if j["status"] == "completed": j["result_url"] = res["result"]["urls"][0]
                else: j["error"] = str(res.get("error") or res.get("status")); save()
            except krea.KreaError as e:
                j["error"] = str(e); save()
                why = {402: "out of credits / model not on the plan", 429: "provider busy (concurrency)"}.get(e.status, "request failed")
                return result("blocked", f"{sid}: {why} — {len(got)}/{len(doc['shots'])} clips done; top up or wait, then rerun to resume from {sid}",
                              ["jobs.json"], [F("fail", "generate", sid, str(e)[:300])])
        if j.get("result_url"):
            krea.download(j["result_url"], dst); j["file"] = ctx.wrel(dst); j["status"] = "completed"; save(); got.append(sid)
        elif j.get("status") in ("failed", "cancelled"): fnd.append(F("fail", "generate", sid, f"job {j.get('job_id')} {j['status']}: {j.get('error', '')}"))
    if mode == "connector":
        reqs = {sh["id"]: {"model": p["model"], "reference_clip": clips[sh["id"]], "input": payload(p, sh, "<upload reference_clip, put its URL here>")}
                for sh in doc["shots"] if sh["id"] not in got}
        ctx.save("generate.requests.json", reqs)
    save()
    left = [sh["id"] for sh in doc["shots"] if sh["id"] not in got]
    if fnd: return result("failed", f"{len(fnd)} failed jobs", ["jobs.json"], fnd)
    if left:
        how = ("Submit each entry of generate.requests.json through the Krea connector ONE AT A TIME (upload the reference clip, then generate_video), "
               "record ref_url / job_id / result_url in jobs.json, then rerun to download.") if mode == "connector" else "rerun to continue"
        return result("blocked", f"{len(got)}/{len(doc['shots'])} clips downloaded; next {left[0]}. {how}", ["jobs.json", "generate.requests.json"])
    return result("done", f"all {len(got)} clips downloaded → {ctx.wrel(os.path.dirname(ctx.out('ai', 'x')))}", ["jobs.json"])
