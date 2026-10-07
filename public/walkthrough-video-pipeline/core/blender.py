"""Run a bscripts/ job in Blender headless and read its JSON result back.

    run("build_walkthrough.py", {"blend": "...", ...}, job_path)
The job dict is written to job_path; the script reads it (argv after "--"), writes job_path + ".result.json"
with {"ok": bool, ...}. Blender is found from: the argument, $BLENDER_EXE, standards, then common install folders.
"""
import glob, json, os, shutil, subprocess
from . import paths

COMMON = [r"C:\Program Files\Blender Foundation\Blender *\blender.exe", "/Applications/Blender.app/Contents/MacOS/Blender", "/usr/bin/blender"]

def find(exe=""):
    for c in (exe, os.environ.get("BLENDER_EXE", ""), shutil.which("blender") or ""):
        if c and os.path.exists(c): return c
    for pat in COMMON:
        hits = sorted(glob.glob(pat))
        if hits: return hits[-1]
    raise FileNotFoundError("blender not found — set scope.json blender_exe or $BLENDER_EXE")

def run(script, job, job_path, exe="", timeout=3600):
    os.makedirs(os.path.dirname(job_path), exist_ok=True)
    paths.save_json(job_path, job)
    res_path = job_path + ".result.json"
    if os.path.exists(res_path): os.remove(res_path)
    cmd = [find(exe), "-b"] + ([job["blend"]] if job.get("blend") else ["--factory-startup"])
    cmd += ["--python", os.path.join(paths.BSCRIPTS, script), "--", job_path]
    p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
    open(job_path + ".log", "w", encoding="utf-8").write(p.stdout + "\n--- stderr ---\n" + p.stderr)
    if not os.path.exists(res_path):
        tail = "\n".join((p.stdout + p.stderr).strip().splitlines()[-8:])
        return {"ok": False, "error": f"{script} wrote no result (exit {p.returncode})", "log": job_path + ".log", "tail": tail}
    return json.load(open(res_path, encoding="utf-8"))
