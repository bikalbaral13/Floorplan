"""Quick look at a baked plan (tools/bakeplan output): a coloured top view and a 3D view, no Blender.
    python tools/preview_baked.py <baked.json> <out.png> [--cut 2.0] [--elev 18] [--azim -60]
--cut drops faces whose lowest point is above the cut height in the TOP view (so ceilings don't hide the floor).
"""
import json, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from mpl_toolkits.mplot3d.art3d import Poly3DCollection


def faces(doc):
    for coll in ("nodes", "segments", "spaces"):
        for h in doc.get(coll, []):
            for a in h.get("attachments", []):
                b = a.get("baked")
                if not b:
                    continue
                ax, ay = b["anchor"][0], b["anchor"][1]
                for m in b["meshes"]:
                    for f in m["faces"]:
                        yield a["objectPath"].split("/")[-1], m["color"], [(ax + p[0], -(ay + p[1]), p[2]) for p in f]


def main(src, out, cut=2.0, elev=18, azim=-60):
    doc = json.load(open(src, encoding="utf-8"))
    F = list(faces(doc))
    fig = plt.figure(figsize=(18, 8))
    a1 = fig.add_subplot(1, 2, 1)
    top = sorted([f for f in F if min(p[2] for p in f[2]) <= cut], key=lambda f: max(p[2] for p in f[2]))
    a1.add_collection(PolyCollection([[(p[0], p[1]) for p in f[2]] for f in top], facecolors=[f[1] for f in top], edgecolors="none"))
    xs = [p[0] for f in F for p in f[2]]; ys = [p[1] for f in F for p in f[2]]
    a1.set_xlim(min(xs) - 0.3, max(xs) + 0.3); a1.set_ylim(min(ys) - 0.3, max(ys) + 0.3); a1.set_aspect("equal")
    a1.set_title(f"top view (faces starting below {cut} m)")
    a2 = fig.add_subplot(1, 2, 2, projection="3d")
    a2.add_collection3d(Poly3DCollection([f[2] for f in F], facecolors=[f[1] for f in F], edgecolors="none", alpha=1))
    a2.set_xlim(min(xs), max(xs)); a2.set_ylim(min(ys), max(ys)); a2.set_zlim(0, 4)
    a2.set_box_aspect((max(xs) - min(xs), max(ys) - min(ys), 4)); a2.view_init(elev, azim); a2.set_title("3D")
    plt.tight_layout(); plt.savefig(out, dpi=100)
    print(f"{len(F)} faces -> {out}")


if __name__ == "__main__":
    args = sys.argv[1:]
    kw = {k.lstrip("-"): float(v) for k, v in zip(args[2::2], args[3::2])}
    main(args[0], args[1], **kw)
