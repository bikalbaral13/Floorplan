"""Start (or refresh) a tracer project from ONE plan image for a run driven through the runner (tools/runner/worker.mjs
in the app repo): makes projects/<CODE> if missing (work dir INSIDE the project, so its whole state travels to R2),
copies the image — optionally cropped to the part being traced — into inputs/, and records the crop offset in
project.json (`crop_px`), so anything traced here maps back to the full image: full_px = crop_px[:2] + crop px.

    python tools/runner_intake.py <CODE> <image> [--crop x0,y0,x1,y1] [--title "..."]
"""
import argparse, json, os, shutil, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    try: sys.stdout.reconfigure(encoding="utf-8")
    except Exception: pass
    ap = argparse.ArgumentParser()
    ap.add_argument("code"); ap.add_argument("image"); ap.add_argument("--crop", default=""); ap.add_argument("--title", default="")
    a = ap.parse_args()
    pdir = os.path.join(ROOT, "projects", a.code)
    if not os.path.exists(os.path.join(pdir, "project.json")):
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "new_project.py"), a.code, "--title", a.title or a.code, "--work-dir", "work"], check=True)
    pj_path = os.path.join(pdir, "project.json")
    pj = json.load(open(pj_path, encoding="utf-8"))
    im = Image.open(a.image)
    crop = [0, 0, im.width, im.height]
    if a.crop:
        crop = [int(round(float(v))) for v in a.crop.split(",")]
        if len(crop) != 4 or crop[2] <= crop[0] or crop[3] <= crop[1]:
            sys.exit("--crop needs x0,y0,x1,y1 with x1 > x0 and y1 > y0")
        crop = [max(0, crop[0]), max(0, crop[1]), min(im.width, crop[2]), min(im.height, crop[3])]
        im = im.crop(tuple(crop))
    os.makedirs(os.path.join(pdir, "inputs"), exist_ok=True)
    for f in os.listdir(os.path.join(pdir, "inputs")):
        if f.startswith("plan."): os.remove(os.path.join(pdir, "inputs", f))
    out = os.path.join(pdir, "inputs", "plan.png")
    im.convert("RGB").save(out)
    pj.update(work_dir="work", crop_px=crop, source_image=os.path.basename(a.image), source_size_px=list(Image.open(a.image).size))
    json.dump(pj, open(pj_path, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    print(f"{a.code}: inputs/plan.png {im.width}x{im.height} px (crop {crop} of {os.path.basename(a.image)}) — next: S0_SCOPE (the user answers scope.json)")


if __name__ == "__main__":
    main()
