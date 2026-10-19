"""Image decks: a single moodboard / plan image -> the same deck.json a .pptx gives, from Claude's panels.json.

    python tools/panels.py <deck_dir> [<panels.json>] [--board <id>]   (default <deck_dir>/panels.json)

--board keeps only the board the user chose in the Brief tab (its id from questions.json room_ids): only its plan,
items and views are cropped and filed under inputs/.

A slide deck has one slide per idea; a moodboard image packs everything into one picture. intake.py turns the
image into one 'board' page; Claude marks what is on it (panels.json, deck-panels/1 — see the skill's
read-an-image-deck.md); this script crops every marked box into images/ and writes deck.json with ONE SLIDE PER
PANEL, so questions.py, brief.py draft / finalize and the rest of the pipeline run unchanged:

    {"schema": "deck-panels/1", "project": "Bachelor Pad", "room": "Bachelor Pad",
     "plan":  {"box": [x0, y0, x1, y1], "printed": ["18'11\\"", "17'5\\""], "note": "…"},
     "items": [{"id": "sofa-leather", "box": [x0, y0, x1, y1], "category": "furniture", "label": "Cognac leather sofa",
                "kind": "object" | "swatch", "note": "…", "urls": []}],
     "views": [{"id": "render-1", "box": [...]}]}

An image that packs SEVERAL options (two plans, each with its own moodboard) lists them as boards instead:

    {"schema": "deck-panels/1", "project": "Bachelor Pad",
     "boards": [{"id": "bachelor-pad", "title": "Bachelor Pad", "room": "Bachelor Pad", "plan": {...}, "items": [...], "views": [...]},
                {"id": "blue-sofa", "title": "Blue sofa", "room": "Living room", "plan": {...}, "items": [...]}]}

Each board becomes one project in deck.json (the Brief tab asks which one to build).

Boxes are in the source image's pixels. A 'swatch' (paint chip, floor sample) also records its mean colour as a
swatch fill, the way a drawn colour chip on a slide does.

Every crop is ALSO filed as a project input next to the original (which stays in inputs/decks/), one folder per
source image, one per board, one per category — so the plan, each product photo and each swatch is its own input:

    <deck_dir>/inputs/images/<source>/<board>/plan/plan.png
    <deck_dir>/inputs/images/<source>/<board>/<category>/<id>.png   furniture, lighting, flooring, wall, rug, decor, ...
    <deck_dir>/inputs/images/<source>/<board>/views/<id>.png
    <deck_dir>/inputs/images/<source>/index.json                    deck-inputs/1: every crop, board, box, label, kind, colour

The S1_PANELS stage pushes <deck_dir>/inputs/ to Projects/<CODE>/inputs/.
"""
import json, re, shutil, sys
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from intake import norm  # noqa: E402
from progress import report  # noqa: E402


def mean_hex(im):
    small = im.convert("RGB").resize((1, 1), Image.BOX)
    r, g, b = small.getpixel((0, 0))
    return f"#{r:02X}{g:02X}{b:02X}"


def slug(s):
    """Folder / file name: the stem without an upload timestamp, lower-case, a-z 0-9 and '-'."""
    stem = re.sub(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}_", "", Path(str(s)).stem if "." in str(s) else str(s))
    return re.sub(r"[^a-z0-9]+", "-", stem.lower()).strip("-") or "item"


def boards_of(P):
    """The boards of a deck-panels/1: "boards": [...], or the one board the top-level plan / items / views make."""
    if P.get("boards"):
        return [dict(b, id=slug(b.get("id") or b.get("title") or f"board-{i}")) for i, b in enumerate(P["boards"], 1)]
    return [{"id": slug(P.get("room") or P.get("project") or "board"), "title": P.get("project"), "room": P.get("room"),
             "plan": P["plan"], "items": P.get("items", []), "views": P.get("views", [])}]


def file_inputs(deck_dir, deck, filed):
    """Copy every crop to inputs/images/<source>/<board>/<folder>/<id>.png and write the source's index.json."""
    src = slug(deck["source"])
    root = deck_dir / "inputs"
    if root.exists():
        shutil.rmtree(root)
    entries = []
    for e in filed:
        rel = f"images/{src}/{e['board']}/{e['folder']}/{slug(e['id'])}.png"
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(deck_dir / e.pop("crop"), root / rel)
        entries.append({"file": rel, **e})
    index = {"schema": "deck-inputs/1", "source": f"decks/{deck['source']}", "px": deck["board"]["px"],
             "boards": list(dict.fromkeys(e["board"] for e in entries)), "count": len(entries), "items": entries}
    (root / "images" / src / "index.json").write_text(json.dumps(index, indent=1, ensure_ascii=False), encoding="utf-8")
    return src, entries


def main(deck_dir, panels_path=None, board=None):
    deck_dir = Path(deck_dir)
    deck = json.loads((deck_dir / "deck.json").read_text(encoding="utf-8"))
    P = json.loads(Path(panels_path or deck_dir / "panels.json").read_text(encoding="utf-8"))
    if P.get("schema") != "deck-panels/1":
        sys.exit("panels.json must be deck-panels/1")
    src = Image.open(deck_dir / deck["board"]["file"]).convert("RGB")
    W, H = src.size
    img_dir = deck_dir / "images"
    if img_dir.exists():
        shutil.rmtree(img_dir)
    img_dir.mkdir(parents=True)
    boards = boards_of(P)
    if board:
        keep = [b for b in boards if b["id"] == slug(board) or slug(b.get("title") or "") == slug(board)]
        if not keep:
            sys.exit(f"--board {board}: panels.json has boards {[b['id'] for b in boards]}")
        boards = keep
    multi = len(boards) > 1

    def crop(bid, pid, box):
        x0, y0, x1, y1 = [int(round(v)) for v in box]
        if not (0 <= x0 < x1 <= W and 0 <= y0 < y1 <= H):
            sys.exit(f"{bid}/{pid}: box {box} is outside the {W}x{H} image")
        im = src.crop((x0, y0, x1, y1))
        rel = f"images/{bid + '-' if multi else ''}{slug(pid)}.png"
        im.save(deck_dir / rel)
        return rel, im

    slides, projects, filed, n = [], [], [], 0
    total = sum(1 + len(b.get("items", [])) + len(b.get("views", [])) for b in boards)
    for b in boards:
        bid, first = b["id"], n + 1
        # the board's first slide: its plan, with its printed sizes (dims) — finalize wants it covered by a check or a zone
        pl = b["plan"]
        rel, im = crop(bid, "plan", pl["box"])
        n += 1
        plan = {"md5": "", "file": rel, "px": list(im.size), "slides": total, "source_box": pl["box"]}
        slides.append({"slide": n, "kind": "dims", "category": "plan", "panel": "plan", "board": bid,
                       "texts": [{"text": t, "box": [0, 0, 0, 0]} for t in pl.get("printed", [])] + ([{"text": pl["note"], "box": [0, 0, 0, 0]}] if pl.get("note") else []),
                       "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0], "is_plan": True,
                                     "plan_rect_px": [0, 0, im.size[0], im.size[1]]}],
                       "shapes": [], "tables": [], "urls": [], "dims_mm": [], "levels_mm": []})
        filed.append({"id": "plan", "board": bid, "folder": "plan", "kind": "plan", "crop": rel, "px": list(im.size), "box": pl["box"],
                      **{k: pl[k] for k in ("printed", "note") if pl.get(k)}})
        report(100 * n / total, f"{bid}: plan cropped")
        items = b.get("items", [])
        for i, it in enumerate(items, 1):
            rel, im = crop(bid, it["id"], it["box"])
            n += 1
            sw = mean_hex(im) if it.get("kind") == "swatch" else None
            slides.append({"slide": n, "kind": "spec", "category": it.get("category"), "panel": it["id"], "board": bid,
                           "texts": [{"text": it.get("label", it["id"]), "box": [0, 0, 0, 0]}] + ([{"text": it["note"], "box": [0, 0, 0, 0]}] if it.get("note") else []),
                           "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0], "source_box": it["box"]}],
                           "shapes": [{"kind": "SWATCH", "fill": sw, "box": [0, 0, 1, 1]}] if sw else [],
                           "tables": [], "urls": it.get("urls", []), "dims_mm": it.get("dims_mm", []), "levels_mm": []})
            filed.append({"id": it["id"], "board": bid, "folder": slug(it.get("category") or "other"), "kind": it.get("kind", "object"),
                          "crop": rel, "px": list(im.size), "box": it["box"], **({"colour": sw} if sw else {}),
                          **{k: it[k] for k in ("category", "label", "note", "urls") if it.get(k)}})
            report(100 * n / total, f"{bid}: cropped {it['id']} ({i} of {len(items)})")
        for v in b.get("views", []):
            rel, im = crop(bid, v["id"], v["box"])
            n += 1
            slides.append({"slide": n, "kind": "view", "panel": v["id"], "board": bid, "texts": [], "shapes": [], "tables": [], "urls": [], "dims_mm": [], "levels_mm": [],
                           "pictures": [{"md5": "", "file": rel, "px": list(im.size), "box": [0, 0, 1, 1], "crop": [0, 0, 0, 0]}]})
            filed.append({"id": v["id"], "board": bid, "folder": "views", "kind": "view", "crop": rel, "px": list(im.size), "box": v["box"]})
        title = b.get("title") or P.get("project") or deck["source"]
        room = b.get("room") or title
        projects.append({"title": title, "board": bid, "cover_slide": first, "room_list": [room], "from_panels": True, "plan": plan,
                         "rooms": [{"name": room, "id": norm(room) or "room", "slides": list(range(first, n + 1))}]})
        print(f"{title} / {room}: plan {plan['px']} + {len(items)} items + {len(b.get('views', []))} views (slides {first}-{n})")
    deck.update({"slide_count": n, "slides": slides, "panels": P, "projects": projects})
    src_name, entries = file_inputs(deck_dir, deck, filed)
    deck["inputs"] = {"dir": f"inputs/images/{src_name}/", "index": f"inputs/images/{src_name}/index.json", "count": len(entries)}
    (deck_dir / "deck.json").write_text(json.dumps(deck, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"filed {len(entries)} crops -> inputs/images/{src_name}/ ({len(boards)} board(s))")
    report(100, f"{n} panels -> deck.json")


if __name__ == "__main__":
    a = sys.argv[1:]
    b = None
    if "--board" in a:
        i = a.index("--board"); b = a[i + 1] if i + 1 < len(a) else None; a = a[:i] + a[i + 2:]
    main(*a[:2], board=b or None)
