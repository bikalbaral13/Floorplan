"""S4: embed the object/2 (Python) objects a room canvas places, then bake every instance.

    python tools/embed_python.py <room.canvas.json> [<out.json>]       (default: in place)

compose.py places library objects by objectPath; the editor resolves Math Engine objects itself, but a Python object
has to travel inside the plan (objectLibrary[objectId]) with its runs baked (python.baked), or the editor would start
Pyodide for every instance on load (minutes for a furnished room). Objects come from R2 library/ over the public URL
(with a browser User-Agent: r2.dev answers 403 to urllib's default). Baking is packages/pyobject's own bake.
"""
import json, os, sys, urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from progress import report  # noqa: E402

PUBLIC = os.environ.get("R2_PUBLIC_URL", "https://pub-156fd74325894cccb9467e68a6e5cc82.r2.dev").rstrip("/")
REPO = Path(os.environ.get("BP_REPO") or Path(__file__).resolve().parents[3])
sys.path.insert(0, str(REPO / "packages" / "pyobject"))


def fetch(path):
    req = urllib.request.Request(f"{PUBLIC}/library/{path}", headers={"User-Agent": "Mozilla/5.0 (BuilderPluss pipeline)"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def attachments(plan):
    for n in plan.get("nodes", []): yield from n.get("attachments") or []
    for s in plan.get("segments", []): yield from s.get("attachments") or []
    for s in plan.get("spaces", []): yield from s.get("attachments") or []


def main(src, out=None):
    plan = json.loads(Path(src).read_text(encoding="utf-8"))
    lib = plan.setdefault("objectLibrary", {})
    wanted = {}
    for a in attachments(plan):
        p = a.get("objectPath") or ""
        if "/Python/" in p: wanted[a["objectId"]] = p
    for i, (oid, path) in enumerate(sorted(wanted.items()), 1):
        obj = fetch(path)
        if obj.get("version") != 2 or not (obj.get("python") or {}).get("source"):
            sys.exit(f"{path} is not an object/2 Python object")
        obj["python"].pop("baked", None)
        lib[oid] = obj
        report(30 * i / max(1, len(wanted)), f"Fetched {path}")
    if not wanted:
        print("no Python objects on this canvas: nothing to embed")
    else:
        from pyobject.bake import bake
        report(35, f"Baking {len(wanted)} Python objects")
        rep = bake(plan)
        report(95, f"Baked {rep['baked']} instance runs in {rep['ms']} ms")
        print(f"embedded {len(wanted)} Python objects, baked {rep['baked']} instance runs in {rep['ms']} ms: " + ", ".join(f"{k} x{v}" for k, v in rep["objects"].items()))
    Path(out or src).write_text(json.dumps(plan, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main(*sys.argv[1:3])
