"""python tools/selftest.py — every phase's own self-test, the shared kit, and the person-to-person handover."""
import json, os, subprocess, sys
for _s in (sys.stdout, sys.stderr):
    try: _s.reconfigure(encoding="utf-8")
    except Exception: pass

FULL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT_MASTER = os.path.normpath(os.path.join(FULL, "..", "..", "packages", "pipeline-kit"))
res = []

def run(label, args, cwd):
    r = subprocess.run([sys.executable, *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8")
    tail = [l for l in (r.stdout + r.stderr).strip().splitlines() if l.strip()][-1:] or [""]
    res.append((r.returncode == 0, f"{label}: {tail[0]}"))

cfg = json.load(open(os.path.join(FULL, "full.json"), encoding="utf-8"))
for ph in cfg["phases"]:
    root = os.path.join(FULL, ph["dir"])
    if os.path.exists(os.path.join(root, "tools", "selftest.py")): run(f"{ph['label']} self-test", ["tools/selftest.py"], root)
    if os.path.isdir(os.path.join(root, "_vendor")) and os.path.isdir(KIT_MASTER):
        run(f"{ph['label']} kit {cfg['kit']} matches the master", [os.path.join(KIT_MASTER, "tools", "vendor.py"), root, "--check"], FULL)
    pj = json.load(open(os.path.join(root, "pipeline.json"), encoding="utf-8"))
    res.append((pj.get("kit") in (None, cfg["kit"]) and pj.get("phase") in (ph["id"], "design" if ph["id"] == "plan" else ph["id"]),
                f"{ph['label']} pipeline.json: phase {pj.get('phase')}, kit {pj.get('kit')}"))
if os.path.isdir(KIT_MASTER): run(f"orchestrator kit {cfg['kit']} matches the master", [os.path.join(KIT_MASTER, "tools", "vendor.py"), FULL, "--check"], FULL)
run("handover across machines", ["tests/test_handover.py"], FULL)

bad = [m for ok, m in res if not ok]
print("\n".join(("PASS " if ok else "FAIL ") + m for ok, m in res)); print(f"\n{len(res) - len(bad)}/{len(res)} passed"); sys.exit(1 if bad else 0)
