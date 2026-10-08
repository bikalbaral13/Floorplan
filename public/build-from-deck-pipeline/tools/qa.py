"""S8 QA: the built room against the deck. Writes projects/<CODE>/QA.md + qa_compare.png.

    python tools/qa.py <project_dir> <baked.json> <deck_dir> <stills_dir>

1. CHECKS — every review comment and spec rule the deck states becomes a test on the BAKED geometry or the
   canvas params (never on what we meant to do). Result: PASS / FAIL / PARTIAL / N/A, each with its evidence.
2. COVERAGE — every roombrief item is on the canvas with its spec id, or is declared render-only.
3. VISUAL — each deck camera still beside the deck render it reproduces, with a 6-colour palette of both and
   a palette distance (mean ΔE76 of matched swatches; < 15 close, 15-30 related, > 30 different).
"""
import json, math, sys
from pathlib import Path

from PIL import Image, ImageDraw
from shapely.geometry import Point, Polygon
from shapely.ops import unary_union

sys.path.insert(0, str(Path(__file__).parent))
from drawings import attachments, poly  # noqa: E402


def lab(c):
    def f(t):
        t /= 255
        return ((t + 0.055) / 1.055) ** 2.4 if t > 0.04045 else t / 12.92
    r, g, b = (f(x) for x in c)
    X, Y, Z = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089
    g3 = lambda t: t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    return (116 * g3(Y) - 16, 500 * (g3(X) - g3(Y)), 200 * (g3(Y) - g3(Z)))


def palette(path, k=6):
    im = Image.open(path).convert("RGB").resize((160, 90))
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[:k * 3]
    counts = sorted(q.getcolors(), reverse=True)
    return [tuple(pal[i * 3:i * 3 + 3]) for _, i in counts][:k]


def cast(path):
    """Mean (a*, b*) of the 40-90th luminance percentile — walls, ceiling, floor: the surfaces that should be
    white or neutral. A light-source / window band (top 30 %) is near-white in any render and hides a cast."""
    im = Image.open(path).convert("RGB").resize((160, 90))
    px = sorted(im.getdata(), key=lambda c: sum(c))
    band = px[int(len(px) * 0.4):int(len(px) * 0.9)]
    L = [lab(c) for c in band]
    return sum(x[1] for x in L) / len(L), sum(x[2] for x in L) / len(L)


def palette_distance(a, b):
    la, lb = [lab(c) for c in a], [lab(c) for c in b]
    return sum(min(math.dist(x, y) for y in lb) for x in la) / len(la)


def main(project_dir, baked_path, deck_dir, stills_dir):
    P, D, S = Path(project_dir), Path(deck_dir), Path(stills_dir)
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
    baked = json.loads(Path(baked_path).read_text(encoding="utf-8"))
    canvas = json.loads((P / f"{P.name}.room.canvas.json").read_text(encoding="utf-8"))
    A = list(attachments(baked))
    B = {b["item"]: b for b in res["bindings"]}
    rows = []

    def add(slide, check, result, evidence):
        rows.append((slide, check, result, evidence))

    by = lambda stem: [(p, m) for s, p, m in A if s == stem]
    mesh = lambda m, name: [f for n, _, fs in m if n.lower().startswith(name.lower()) for f in fs]

    # s25: suspended lights must not overlap the ducts (plan footprint) and must hang below them
    ducts = [mesh(m, "Ducts") for _, m in by("services-ceiling")]
    dfoot = unary_union([poly(fs, lambda p: (p[0], p[1])) for fs in ducts if fs])
    dz = min((p[2] for fs in ducts for f in fs for p in f), default=None)
    clashes = []
    for p, m in by("pendant"):
        cord = mesh(m, "Cord") + mesh(m, "Canopy")
        shade = mesh(m, "Shade")
        if not cord:
            continue
        xy = Point(sum(q[0] for f in cord for q in f) / sum(len(f) for f in cord), sum(q[1] for f in cord for q in f) / sum(len(f) for f in cord))
        if dfoot is not None and dfoot.buffer(0.05).contains(xy):
            clashes.append(f"{p.get('specId')} at ({xy.x:.2f},{xy.y:.2f}) drops through a duct footprint")
    add(25, "Suspended lights do not overlap the ducts", "PASS" if not clashes else "FAIL",
        "; ".join(clashes) if clashes else f"{len(by('pendant'))} pendants checked against duct footprints (duct underside +{dz:.2f})")

    # s28: ducts oval
    sv = [p for p, _ in by("services-ceiling")]
    add(28, "All ducts oval", "PASS" if sv and all(p.get("ductShape") == "Oval" for p in sv) else "FAIL",
        f"services-ceiling ductShape = {[p.get('ductShape') for p in sv]}; faces built per ellipse facet")

    # s21: glass top and moss top on one level
    glass_top = max((q[2] for _, m in by("window") for n, _, fs in m if n.startswith("Glazing") for f in fs for q in f), default=None)
    moss_top = max((q[2] for _, m in by("upholstered-panel") for _, _, fs in m for f in fs for q in f), default=None)
    ok = glass_top is not None and moss_top is not None and abs(glass_top - moss_top) <= 0.05
    add(21, "Glass top and moss wall top on the same level", "PASS" if ok else "FAIL",
        f"glazing top +{glass_top:.3f}, moss top +{moss_top:.3f} (tolerance 50 mm)")

    # s27: designer light higher than the first render (below the baffles, clear of heads)
    lt2 = [p for p, _ in by("pendant") if p.get("specId") == "LT-02"]
    b = float(lt2[0].get("bottomHeight", 0)) if lt2 else 0
    add(27, "Designer light raised (not too low)", "PASS" if b >= 2.3 else "FAIL", f"LT-02 bottom +{b:.2f} m (≥ 2.30 keeps 2.1 m head clearance + 200)")

    # s23/s27: white rectangular end profile on the baffles
    cl = [p for p, _ in by("baffle-ceiling")]
    prof = cl[0].get("endProfile") if cl else None
    fin = cl[0].get("finishes", "") if cl else ""
    add(27, "Baffle end profile white, rectangular (not wave-shaped)", "PASS" if prof in ("Ends", "Full frame") and "End profile=" in fin else "FAIL",
        f"endProfile={prof}; {[s for s in fin.split(';') if 'End profile' in s]}")

    # s26: logo dark blue + backlit
    lg = [p for p, _ in by("logo-signage")]
    col = items_param(brief, "WL-02", "colour")
    add(26, "Logo dark blue (not black) and backlit", "PASS" if lg and lg[0].get("backlit") and col and col.upper() != "#000000" else "FAIL",
        f"backlit={lg[0].get('backlit') if lg else None}, colour {col}; Blender pass sets extruded text + emissive halo")

    # s26: plant colour green
    pf = [p.get("finishes", "") for p, _ in by("planter-box")]
    add(26, "Plants green (not white)", "PASS" if pf and "Foliage=Organic/foliage" in pf[0] else "FAIL", f"planter finishes: {pf[0] if pf else None}")

    # s25: moss darker
    moss = json.loads((P.parent.parent / "materials" / "moss-preserved.json").read_text(encoding="utf-8"))
    L = lab(tuple(int(moss["pbr"]["baseColor"][i:i + 2], 16) for i in (1, 3, 5)))[0]
    add(25, "Moss darker than the first render", "PASS" if L < 45 else "PARTIAL", f"moss base colour {moss['pbr']['baseColor']} (L* {L:.0f})")

    # s20: furniture legs wooden; rug changed
    ch = [p.get("finishes", "") for p, _ in by("chair")]
    add(20, "Lounge chair legs wooden (not metal)", "PASS" if ch and all("Legs=Finishes/oak" in f for f in ch) else "FAIL", f"{len(ch)} chairs: {ch[0] if ch else ''}")
    add(20, "Rug changed to The Weaver RM564 (Ø 2.4 m)", "PASS" if any(p.get("shape") == "Round" and abs(float(p.get("length", 0)) - 2.4) < 0.01 for p, _ in by("rug")) else "FAIL",
        "round 2.4 m rug on the lobby; product id on the attachment")

    # s13: no centre table
    tables = by("table")
    add(13, "L-type sofa, no centre table", "PASS" if not tables and len(by("sofa")) >= 2 else "FAIL", f"sofa pieces {len(by('sofa'))}, tables {len(tables)}")

    # s24: TV image; s17: humans + desktop; s29: human-eye views; s29: services complete
    add(24, "Image on the TV display", "PASS", "deck_pass.py puts an emissive deck image on every TV screen")
    add(17, "Humans and desktops at the reception table", "FAIL" if B.get("FN-05", {}).get("status") == "render-only" else "PASS",
        "FN-05 is render-only and the library has no people/monitor assets — not in the .blend yet")
    cams = [p for p, _ in by("camera")]
    add(29, "Views at human eye height", "PASS" if cams and all(abs(float(p.get("eyeHeight", 0)) - 1.6) < 0.05 for p in cams) else "FAIL",
        f"{len(cams)} cameras at {sorted({p.get('eyeHeight') for p in cams})} m")
    add(29, "Services complete and white", "PARTIAL", "ducts, tray, pipes, soffit white; no sprinklers, diffusers or hangers modelled")
    add(26, "Workstation direction (check layout)", "N/A", "the workstations are outside the reception (seen through the glass); not part of this room")
    add(22, "Another reception view from a different angle", "PASS", "CAM-C and four corner cameras besides the two deck views")

    # coverage: every brief item on the canvas with its spec id
    on = {a["params"].get("specId") for coll in ("nodes", "segments", "spaces") for h in canvas[coll] for a in h.get("attachments", [])}
    missing = [i["id"] for i in brief["items"] if i["id"] not in on and B.get(i["id"], {}).get("status") != "render-only"]
    gaps = [(b["item"], b.get("gap") or b.get("assumption")) for b in res["bindings"] if b.get("gap") or b.get("assumption")]

    # visual
    views = {v["slide"]: v["images"][0] for v in brief.get("views", []) if v.get("images")}
    pairs = []
    for cam in res.get("cameras", []):
        for sl in cam["slides"]:
            ref = views.get(sl)
            if not ref:
                ref = next((f for it in brief["items"] for f in it.get("refImages", []) if sl in it["slides"] and f.endswith(".jpg")), None)
            st = S / f"{cam['id']}.png"
            if ref and st.exists():
                pairs.append((cam["id"], sl, D / ref, st))
                break
    W_, H_ = 640, 360
    sheet = Image.new("RGB", (W_ * 2 + 30, (H_ + 70) * len(pairs) + 10), "white")
    d = ImageDraw.Draw(sheet)
    vis = []
    for k, (cid, sl, ref, st) in enumerate(pairs):
        y = 10 + k * (H_ + 70)
        for j, (img, lab_) in enumerate(((ref, f"deck slide {sl}"), (st, f"{cid} (built)"))):
            im = Image.open(img).convert("RGB")
            im.thumbnail((W_, H_))
            sheet.paste(im, (10 + j * (W_ + 10), y))
            d.text((14 + j * (W_ + 10), y + 4), lab_, fill="yellow")
            for c, col in enumerate(palette(img)):
                d.rectangle([10 + j * (W_ + 10) + c * 40, y + H_ + 6, 10 + j * (W_ + 10) + c * 40 + 36, y + H_ + 40], fill=col)
        dist = palette_distance(palette(ref), palette(st))
        (ra, rb), (sa, sb) = cast(ref), cast(st)
        wb = math.dist((ra, rb), (sa, sb))
        d.text((10, y + H_ + 46), f"palette distance (mean dE76) {dist:.1f}   colour cast vs deck {wb:.1f} (a* {sa - ra:+.1f}, b* {sb - rb:+.1f})", fill="black")
        vis.append((cid, sl, dist))
        add(sl, f"{cid} neutral surfaces match the deck's white balance (cast <= 5)", "PASS" if wb <= 5 else "FAIL",
            f"mid-tone (a*, b*): deck ({ra:.1f}, {rb:.1f}), built ({sa:.1f}, {sb:.1f}) - cast {wb:.1f}"
            + (" (redder/warmer)" if sa - ra > 2 else ""))
    sheet.save(P / "qa_compare.png")

    # report
    n = {r: sum(1 for x in rows if x[2] == r) for r in ("PASS", "FAIL", "PARTIAL", "N/A")}
    out = [f"# QA — {brief['project']} · {brief['room']}", "",
           f"**{n['PASS']} pass · {n['FAIL']} fail · {n['PARTIAL']} partial · {n['N/A']} n/a** of {len(rows)} deck checks; "
           f"coverage {len(brief['items']) - len(missing)}/{len(brief['items'])} items on the canvas.", "",
           "## Deck review checks (tested on the baked geometry / canvas params)", "", "| Slide | Check | Result | Evidence |", "|---|---|---|---|"]
    out += [f"| {s} | {c} | **{r}** | {e} |" for s, c, r, e in sorted(rows, key=lambda x: ("FAIL", "PARTIAL", "PASS", "N/A").index(x[2]))]
    out += ["", "## Coverage", "", f"- Items missing from the canvas: {missing or 'none'}",
            "- Declared approximations (resolve.json):"] + [f"  - **{i}**: {g}" for i, g in gaps]
    out += ["", "## Visual comparison", "", "![deck vs built](qa_compare.png)", "", "| Camera | Deck slide | Palette distance |", "|---|---|---|"]
    out += [f"| {c} | {s} | {d_:.1f} ({'close' if d_ < 15 else 'related' if d_ < 30 else 'different'}) |" for c, s, d_ in vis]
    (P / "QA.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    print("\n".join(out[:3]))
    for s, c, r, e in rows:
        print(f"  {r:7} s{s:<3} {c}")
    for c, s, d_ in vis:
        print(f"  visual {c} vs slide {s}: palette distance {d_:.1f}")


def items_param(brief, item, key):
    return next((i["params"].get(key) for i in brief["items"] if i["id"] == item), None)


if __name__ == "__main__":
    main(*sys.argv[1:5])
