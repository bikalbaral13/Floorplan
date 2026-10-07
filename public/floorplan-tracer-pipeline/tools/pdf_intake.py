# Vendored unchanged from R2 library/Skills/Floorplan Tracer/pdf/intake.py (2026-10-02). Run by stage S1_INTAKE for PDFs.
"""PDF intake for the Floorplan Tracer: find every plan on every page, crop it, classify the set.

    python intake.py <drawing.pdf> <outDir> [--project NAME] [--dpi 300] [--pages 1-5,9]

Writes into <outDir>:
  crops/<project>-p<NN>-<label>.png   one image per plan region, rendered at --dpi (default 300)
  contact/p<NN>.png                   each page at low res with every region boxed and numbered
  manifest.json                       pages, regions, kinds, titles, scales, and the document kind

Nothing is uploaded and nothing is traced: the manifest is reviewed by the user first
(see pdf-intake.md). Needs PyMuPDF, numpy, scipy, Pillow.
"""
import argparse, json, re, sys
from pathlib import Path

import numpy as np
import pymupdf
from PIL import Image, ImageDraw
from scipy import ndimage

LOW_DPI = 50  # region finding works on a thumbnail; crops are re-rendered at --dpi

TITLE_BLOCK_WORDS = re.compile(
    r"DRAWING\s*TITLE|DRAWING\s*(NO|NUMBER)|DRAWN\s*BY|CHECKED\s*BY|REVISION|GENERAL\s*NOTES|CONSULTANT|"
    r"ARCHITECTS?\b|DRAWINGS?\s*NOT\s*TO\s*BE\s*SCALED|COPYRIGHT|CLIENT|APPROVED", re.I)
SKIP_WORDS = re.compile(r"\b(ELEVATION|SECTION|DETAIL|SCHEDULE|3D|VIEW|PERSPECTIVE|ISOMETRIC)\b", re.I)
SITE_WORDS = re.compile(r"\b(SITE\s*PLAN|MASTER\s*PLAN|PLOT\s*LAYOUT|LAYOUT|KEY\s*PLAN|PARKING\s*PLAN)\b", re.I)
FLOOR_WORDS = re.compile(
    r"\b(BASEMENT\s*\d*|STILT|GROUND|FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|TYPICAL|TERRACE|ROOF|MEZZANINE|"
    r"\d+(ST|ND|RD|TH))\s*(FLOOR|LEVEL)?(\s*PLAN)?", re.I)
SCALE_RX = re.compile(r"\b(1\s*:\s*\d+|N\.?\s*T\.?\s*S\.?)\b", re.I)
FLOOR_ORDER = ["BASEMENT", "STILT", "GROUND", "MEZZANINE", "FIRST", "SECOND", "THIRD", "FOURTH", "FIFTH",
               "SIXTH", "TYPICAL", "TERRACE", "ROOF"]


def parse_pages(spec, n):
    if not spec:
        return list(range(n))
    out = []
    for part in spec.split(","):
        a, _, b = part.partition("-")
        out += range(int(a) - 1, int(b or a))
    return [p for p in out if 0 <= p < n]


def text_blocks(page):
    """Text blocks in DISPLAY coordinates (rotation applied), as (x0,y0,x1,y1,text)."""
    m = page.rotation_matrix
    out = []
    for b in page.get_text("blocks"):
        r = pymupdf.Rect(b[:4]) * m
        r.normalize()
        t = " ".join(b[4].split())
        if t:
            out.append((r.x0, r.y0, r.x1, r.y1, t))
    return out


def is_title(t):
    """A plan title: short, mostly upper case, names a floor or a site/layout."""
    if len(t) > 70 or len(t) < 6 or sum(c.isupper() for c in t) < 0.6 * sum(c.isalpha() for c in t):
        return False
    return bool(FLOOR_WORDS.search(t) and re.search(r"FLOOR|LEVEL|PLAN|-", t, re.I)) or bool(SITE_WORDS.search(t)) \
        or bool(SKIP_WORDS.search(t) and len(t) < 40)


def classify(title):
    if not title:
        return "unknown"
    if re.search(r"KEY\s*PLAN", title, re.I):
        return "keyplan"
    if SKIP_WORDS.search(title):
        return "skip"
    if SITE_WORDS.search(title):
        return "site"
    if FLOOR_WORDS.search(title):
        return "floor"
    return "unknown"


def floor_of(title):
    m = FLOOR_WORDS.search(title or "")
    if not m:
        return None
    w = " ".join(m.group(1).upper().split())
    b = re.match(r"BASEMENT\s*(\d*)", w)
    if b:
        return f"B{b.group(1) or 1}"
    for k in FLOOR_ORDER:
        if w.startswith(k):
            return k
    d = re.match(r"(\d+)", w)
    return f"L{d.group(1)}" if d else w


def floor_rank(f):
    if f and f[0] == "B" and f[1:].isdigit():
        return -int(f[1:])
    return FLOOR_ORDER.index(f) if f in FLOOR_ORDER else 99


def building_of(title):
    """'GROUND FLOOR - VILLA 1' -> 'VILLA 1'; 'FIRST FLOOR PLAN (BLOCK A)' -> 'BLOCK A'."""
    t = title or ""
    m = re.search(r"[-–:(]\s*([A-Z0-9][A-Z0-9 .'&/]+?)\s*\)?\s*$", t, re.I)
    if m and not FLOOR_WORDS.fullmatch(m.group(1).strip()):
        return m.group(1).strip().upper()
    rest = FLOOR_WORDS.sub("", t)
    rest = re.sub(r"\b(FLOOR|PLAN|LEVEL)\b|[-–:()]", " ", rest, flags=re.I)
    rest = " ".join(rest.split())
    return rest.upper() or None


def slug(s):
    return re.sub(r"[^a-z0-9]+", "-", (s or "plan").lower()).strip("-")[:40] or "plan"


def find_regions(page, blocks):
    """Connected ink regions on a thumbnail, with the frame, title block and tiny bits removed."""
    pix = page.get_pixmap(dpi=LOW_DPI, colorspace=pymupdf.csGRAY)
    g = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    ink = g < 240  # thin plan lines are faint at thumbnail resolution
    H, W = ink.shape
    k = LOW_DPI / 72.0

    # Frame / border lines: rows or columns that are mostly ink.
    ink[ink.mean(1) > 0.35, :] = False
    ink[:, ink.mean(0) > 0.35] = False
    e = int(0.012 * max(W, H)); ink[:e, :] = ink[-e:, :] = False; ink[:, :e] = ink[:, -e:] = False

    # Title block: the bounding box of its keyword blocks, pushed out to the nearest page edge.
    tb = [b for b in blocks if TITLE_BLOCK_WORDS.search(b[4])]
    title_box = None
    if len(tb) >= 2:
        x0 = min(b[0] for b in tb) * k; y0 = min(b[1] for b in tb) * k
        x1 = max(b[2] for b in tb) * k; y1 = max(b[3] for b in tb) * k
        if (x1 - x0) < 0.45 * W and x1 > 0.8 * W:          # a strip down the right side
            title_box = (x0 - 4, 0, W, H)
        elif (y1 - y0) < 0.35 * H and y1 > 0.8 * H:        # a strip along the bottom
            title_box = (0, y0 - 4, W, H)
        if title_box:
            a, b_, c, d = (int(max(0, v)) for v in title_box)
            ink[b_:d, a:c] = False

    # Merge strokes into drawings: close gaps of ~1.5 % of the page, then label.
    r = max(5, int(0.03 * max(W, H)))  # rooms are closer than plans are to each other
    grown = ndimage.binary_dilation(ink, structure=np.ones((r, r), bool))
    lab, n = ndimage.label(grown)
    regions = []
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        if sl is None:
            continue
        ys, xs = sl
        area = (ys.stop - ys.start) * (xs.stop - xs.start)
        if area < 0.02 * W * H:
            continue
        # Page points, trimmed back by the dilation radius.
        box = [(xs.start + r / 2) / k, (ys.start + r / 2) / k, (xs.stop - r / 2) / k, (ys.stop - r / 2) / k]
        regions.append({"bboxPt": [round(v, 1) for v in box], "inkShare": round(float(ink[sl].mean()), 3)})
    return regions, (title_box and [round(v / k, 1) for v in title_box])


def nearest_title(box, titles):
    """The title text whose block sits inside the region or closest below/above it."""
    x0, y0, x1, y1 = box
    best, bestd = None, 1e9
    for t in titles:
        cx, cy = (t[0] + t[2]) / 2, (t[1] + t[3]) / 2
        inside_x = x0 - 20 <= cx <= x1 + 20
        if x0 <= cx <= x1 and y0 <= cy <= y1:
            d = 0 if not re.search(r"KEY\s*PLAN", t[4], re.I) else 1
        elif inside_x:
            d = min(abs(cy - y1), abs(cy - y0)) + 5
        else:
            d = 1e9
        if d < bestd:
            best, bestd = t, d
    return best[4] if best and bestd < 120 else None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf"); ap.add_argument("out")
    ap.add_argument("--project", default=None); ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--pages", default=None)
    a = ap.parse_args()

    doc = pymupdf.open(a.pdf)
    project = slug(a.project or Path(a.pdf).stem)
    out = Path(a.out); (out / "crops").mkdir(parents=True, exist_ok=True); (out / "contact").mkdir(exist_ok=True)
    pages, regions_all = [], []

    for pi in parse_pages(a.pages, len(doc)):
        page = doc[pi]
        blocks = text_blocks(page)
        titles = [b for b in blocks if is_title(b[4]) and not TITLE_BLOCK_WORDS.search(b[4])]
        page_title = None
        for b in blocks:                      # the value written just below a "DRAWING TITLE" label
            if re.fullmatch(r"DRAWING\s*TITLE:?", b[4], re.I):
                below = [c for c in blocks if c[1] >= b[3] - 2 and abs(c[0] - b[0]) < 40
                         and not TITLE_BLOCK_WORDS.search(c[4])]
                if below:
                    page_title = min(below, key=lambda c: c[1])[4]
        if not page_title:
            cand = [t[4] for t in titles if classify(t[4]) in ("floor", "site")]
            page_title = cand[0] if cand else None
        scale = next((m.group(1).upper().replace(" ", "") for b in blocks for m in [SCALE_RX.search(b[4])] if m), None)
        regions, title_box = find_regions(page, blocks)

        # One drawing title on the sheet = one drawing: faint outlines (a terrace roof edge, a site
        # boundary) break into pieces, so the crop is the union of every piece outside the title block.
        drawing_titles = {t[4] for t in titles if classify(t[4]) in ("floor", "site")
                          and not (title_box and t[0] >= title_box[0] and t[1] >= title_box[1])}
        if len(drawing_titles) <= 1 and len(regions) > 1:
            bb = [r["bboxPt"] for r in regions]
            regions = [{"bboxPt": [min(b[0] for b in bb), min(b[1] for b in bb), max(b[2] for b in bb),
                                   max(b[3] for b in bb)], "inkShare": None, "merged": len(bb)}]

        kept = []
        for r in regions:
            t = nearest_title(r["bboxPt"], titles) or (page_title if len(regions) == 1 else None)
            r["title"] = t
            r["kind"] = classify(t)
            kept.append(r)
        # One big region on a page whose only other regions are small = the page title belongs to it.
        if kept and page_title:
            big = max(kept, key=lambda r: (r["bboxPt"][2] - r["bboxPt"][0]) * (r["bboxPt"][3] - r["bboxPt"][1]))
            if big["kind"] not in ("floor", "site"):
                big["title"], big["kind"] = page_title, classify(page_title)
            for r in kept:
                if r is not big and r["kind"] == "unknown":
                    r["kind"] = "unknown-small"

        # Fragments that sit inside a labelled plan are part of it (a lift core, a faint stair).
        def inside(a, b):
            ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
            return ix * iy >= 0.8 * (a[2] - a[0]) * (a[3] - a[1])
        plans_here = [r for r in kept if r["kind"] in ("floor", "site")]
        kept = [r for r in kept if r in plans_here or not any(inside(r["bboxPt"], q["bboxPt"]) for q in plans_here)]

        for j, r in enumerate(kept, 1):
            r["page"] = pi + 1
            r["id"] = f"p{pi + 1:02d}-r{j}"
            r["floor"] = floor_of(r["title"]) if r["kind"] == "floor" else None
            r["building"] = building_of(r["title"]) if r["kind"] == "floor" else ("SITE" if r["kind"] == "site" else None)
            if r["kind"] == "site":
                r["floor"] = floor_of(r["title"])   # "FIRST FLOOR SITE PLAN" = the site at that level
            r["scaleNote"] = scale
            if r["kind"] in ("floor", "site", "unknown"):
                m = 12  # points of margin
                x0, y0, x1, y1 = r["bboxPt"]
                clip = pymupdf.Rect(x0 - m, y0 - m, x1 + m, y1 + m) & page.rect
                if clip.is_empty:   # clip is in display space, which is what get_pixmap expects
                    continue
                pix = page.get_pixmap(dpi=a.dpi, clip=clip)
                name = f"{project}-p{pi + 1:02d}-{slug(r['title'] or r['id'])}.png"
                if (out / "crops" / name).exists():
                    name = name[:-4] + f"-r{j}.png"
                pix.save(out / "crops" / name)
                r["crop"] = f"crops/{name}"
                r["cropPx"] = [pix.width, pix.height]
                r["dpi"] = a.dpi
            regions_all.append(r)

        # contact sheet
        cp = page.get_pixmap(dpi=LOW_DPI)
        im = Image.frombytes("RGB", (cp.width, cp.height), cp.samples)
        dr = ImageDraw.Draw(im); k = LOW_DPI / 72
        col = {"floor": (0, 160, 0), "site": (0, 90, 220), "keyplan": (160, 160, 160), "skip": (200, 0, 0)}
        for r in kept:
            c = col.get(r["kind"], (230, 140, 0))
            dr.rectangle([v * k for v in r["bboxPt"]], outline=c, width=2)
            dr.text((r["bboxPt"][0] * k + 3, r["bboxPt"][1] * k + 2), f'{r["id"]} {r["kind"]}', fill=c)
        if title_box:
            dr.rectangle([v * k for v in title_box], outline=(120, 0, 160), width=1)
        im.save(out / "contact" / f"p{pi + 1:02d}.png")
        pages.append({"page": pi + 1, "sizePt": [round(page.rect.width), round(page.rect.height)],
                      "rotation": page.rotation, "title": page_title, "scaleNote": scale,
                      "titleBlockPt": title_box, "regions": [r["id"] for r in kept]})

    plans = [r for r in regions_all if r["kind"] in ("floor", "site")]
    buildings = sorted({r["building"] for r in plans if r["kind"] == "floor" and r["building"]})
    has_site = any(r["kind"] == "site" for r in plans)
    floors_by_b = {b: sorted({r["floor"] for r in plans if r["building"] == b and r["floor"]},
                             key=floor_rank) for b in buildings}
    if has_site or len(buildings) > 1:
        kind = "masterplan"
    elif len(plans) > 1:
        kind = "multi-level"
    elif len(plans) == 1:
        kind = "single"
    else:
        kind = "none"

    manifest = {
        "schema": "pdf-intake/1", "source": Path(a.pdf).name, "project": project, "dpi": a.dpi,
        "documentKind": kind, "confirmed": False,
        "buildings": [{"name": b, "floors": floors_by_b[b],
                       "regions": [r["id"] for r in plans if r["building"] == b]} for b in buildings],
        "site": [r["id"] for r in plans if r["kind"] == "site"],
        "pages": pages, "regions": regions_all,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(f"{len(pages)} pages, {len(regions_all)} regions, {len(plans)} plans -> documentKind={kind}")
    for b in manifest["buildings"]:
        print(f"  {b['name']}: {', '.join(b['floors'])}  ({len(b['regions'])} crops)")
    if manifest["site"]:
        print(f"  site: {', '.join(manifest['site'])}")
    unk = [r["id"] for r in regions_all if r["kind"] in ("unknown",)]
    if unk:
        print(f"  UNLABELLED (look at contact/): {', '.join(unk)}")


if __name__ == "__main__":
    sys.exit(main())
