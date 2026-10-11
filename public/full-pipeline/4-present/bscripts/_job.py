"""Shared by every bscripts/ file (runs inside Blender): read the job JSON (argv after '--'), write the result next to it."""
import json, sys, traceback

def job():
    path = sys.argv[sys.argv.index("--") + 1]
    with open(path, encoding="utf-8") as f: return path, json.load(f)

def finish(path, data):
    with open(path + ".result.json", "w", encoding="utf-8") as f: json.dump(data, f, indent=1)

def main(fn):
    path, j = job()
    try: res = fn(j); res.setdefault("ok", True)
    except Exception as e: res = {"ok": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc().splitlines()[-6:]}
    finish(path, res)
