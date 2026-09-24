# mc_image.py — measure a reference photo, or compare it with a render. Blender headless + numpy (bundled).
#
#   blender -b --python mc_image.py -- <image> [--crop x0,y0,x1,y1]
#   blender -b --python mc_image.py -- <reference> <render> [--crop x0,y0,x1,y1] [--crop2 …] [--out compare.png]
#
# --crop is in FRACTIONS of the image (0..1, origin top-left): crop the reference to the material only —
# no furniture, no sky, no shadow falling across it — or every number below describes the room, not the
# surface.
#
# Prints JSON:
#   mean          average colour (sRGB hex)
#   tones         colours at luminance 10/30/50/70/90 % — dark grain … light figure; the colour-ramp stops
#   dominant      5 k-means colours with their share
#   contrast      luminance p90 - p10 (0..1): how strong the figure is
#   orientation   dominant stripe direction in the IMAGE (deg, 0 = horizontal) and anisotropy 0..1
#   detail        mean gradient magnitude: how busy the texture is at pixel scale
# With two images it prints both and the differences, and writes a side-by-side PNG.

import bpy, sys, os, json
import numpy as np

argv = sys.argv[sys.argv.index("--") + 1:]
files = [a for i, a in enumerate(argv) if not a.startswith("--") and (i == 0 or not argv[i - 1].startswith("--"))]
opt = {argv[i][2:]: argv[i + 1] for i in range(len(argv) - 1) if argv[i].startswith("--")}


def load(path, crop=None):
    img = bpy.data.images.load(os.path.abspath(path))
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[::-1, :, :3]   # top-left origin
    if crop:
        x0, y0, x1, y1 = [float(v) for v in crop.split(",")]
        px = px[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]
    return np.clip(px, 0, 1)


def hexc(c):
    return "#" + "".join(f"{int(round(max(0, min(1, v)) * 255)):02x}" for v in c)


def stats(px):
    flat = px.reshape(-1, 3)
    lum = flat @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    order = np.argsort(lum)
    tones = {}
    for q in (10, 30, 50, 70, 90):
        i = int(len(order) * q / 100)
        band = order[max(0, i - len(order) // 50): i + len(order) // 50 + 1]
        tones[f"p{q}"] = hexc(flat[band].mean(0))
    # k-means, 5 colours, on a subsample
    rng = np.random.default_rng(1)
    sub = flat[rng.choice(len(flat), min(20000, len(flat)), replace=False)]
    cent = sub[rng.choice(len(sub), 5, replace=False)]
    for _ in range(12):
        lab = np.argmin(((sub[:, None, :] - cent[None]) ** 2).sum(-1), 1)
        cent = np.array([sub[lab == k].mean(0) if np.any(lab == k) else cent[k] for k in range(5)])
    share = np.bincount(lab, minlength=5) / len(lab)
    dom = sorted([(float(share[k]), hexc(cent[k])) for k in range(5)], reverse=True)
    # structure tensor on luminance: stripe direction and how strongly directional the texture is
    L = (px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32))
    gy, gx = np.gradient(L)
    jxx, jyy, jxy = (gx * gx).mean(), (gy * gy).mean(), (gx * gy).mean()
    ang = 0.5 * np.degrees(np.arctan2(2 * jxy, jxx - jyy))          # direction of strongest CHANGE
    stripe = (ang + 90) % 180                                        # stripes run across it
    tr = jxx + jyy
    aniso = float(np.sqrt((jxx - jyy) ** 2 + 4 * jxy ** 2) / tr) if tr > 0 else 0.0
    return {
        "size": [int(px.shape[1]), int(px.shape[0])],
        "mean": hexc(flat.mean(0)),
        "tones": tones,
        "dominant": [{"share": round(s, 3), "color": c} for s, c in dom],
        "contrast": round(float(np.percentile(lum, 90) - np.percentile(lum, 10)), 4),
        "orientation": {"stripeDeg": round(float(stripe if stripe <= 90 else stripe - 180), 1), "anisotropy": round(aniso, 3)},
        "detail": round(float(np.sqrt(gx ** 2 + gy ** 2).mean()), 5),
    }


a = load(files[0], opt.get("crop"))
res = {"reference": stats(a)}
if len(files) > 1:
    b = load(files[1], opt.get("crop2"))
    sb = stats(b)
    res["render"] = sb
    ma = np.array([int(res["reference"]["mean"][i:i + 2], 16) for i in (1, 3, 5)]) / 255
    mb = np.array([int(sb["mean"][i:i + 2], 16) for i in (1, 3, 5)]) / 255
    res["delta"] = {
        "meanRGB": [round(float(v), 3) for v in (mb - ma)],          # + = render too bright in that channel
        "contrast": round(sb["contrast"] - res["reference"]["contrast"], 4),
        "anisotropy": round(sb["orientation"]["anisotropy"] - res["reference"]["orientation"]["anisotropy"], 3),
        "detail": round(sb["detail"] - res["reference"]["detail"], 5),
    }
    # side by side at the same height
    h = min(a.shape[0], b.shape[0], 512)
    def fit(p):
        ys = (np.arange(h) * p.shape[0] / h).astype(int)
        w = int(p.shape[1] * h / p.shape[0])
        xs = (np.arange(w) * p.shape[1] / w).astype(int)
        return p[ys][:, xs]
    sbs = np.concatenate([fit(a), np.ones((h, 8, 3), np.float32), fit(b)], 1)
    outp = os.path.abspath(opt.get("out", os.path.join(os.path.dirname(os.path.abspath(files[1])), "compare.png")))
    H, W = sbs.shape[:2]
    im = bpy.data.images.new("cmp", W, H, alpha=True)
    rgba = np.concatenate([sbs[::-1], np.ones((H, W, 1), np.float32)], 2)
    im.pixels = rgba.ravel().tolist()
    im.filepath_raw = outp; im.file_format = "PNG"; im.save()
    res["compare"] = outp
print("MC_IMAGE " + json.dumps(res, indent=1))
