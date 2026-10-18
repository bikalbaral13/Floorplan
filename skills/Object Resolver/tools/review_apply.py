"""S4 review: apply the user's Objects sign-off (review.json, written by the app's Objects tab) to the brief and resolve.

    python tools/review_apply.py <project_dir>

No review.json -> nothing to do (the run behaves as before). Per item, by decision:
  approve   nothing changes
  changed   library object / material the user picked -> the binding (object, params.materialPath);
            brief param edits -> roombrief.json item params, and listed in review.todo.json for Claude to carry
            into the binding's own params (they are object param ids, not brief keys)
  omit      binding status "omitted" (S5 leaves it out); the comment is kept on the binding
  question  FAIL — the build waits for the answer (Claude answers, the user signs off again)
Idempotent: the binding keeps what the pipeline had chosen in binding.pipeline (written the first time), so applying
the same review again changes nothing, and a later review is compared with the pipeline's choice, not the last one.
"""
import json, sys
from pathlib import Path


def main(project_dir):
    P = Path(project_dir)
    rv = P / "review.json"
    if not rv.exists():
        print("no review.json: nothing to apply")
        return
    review = json.loads(rv.read_text(encoding="utf-8"))
    brief = json.loads((P / "roombrief.json").read_text(encoding="utf-8"))
    res = json.loads((P / "resolve.json").read_text(encoding="utf-8"))
    items = {it["id"]: it for it in brief["items"]}
    binds = {b["item"]: b for b in res["bindings"]}
    todo, questions, log = [], [], []

    for iid, d in (review.get("items") or {}).items():
        b, it = binds.get(iid), items.get(iid)
        if not b or not it:
            log.append(f"{iid}: not in the brief/resolve any more, skipped")
            continue
        bp = b.setdefault("params", {})
        b.setdefault("pipeline", {"object": b.get("object"), "material": bp.get("materialPath"), "status": b.get("status")})
        pipe = b["pipeline"]
        dec = d.get("decision")
        b["review"] = {"decision": dec, "by": review.get("reviewer"), "at": review.get("exportedAt"), **({"comment": d["comment"]} if d.get("comment") else {})}
        if dec == "question":
            questions.append(f"{iid}: {d.get('comment', '(no comment)')}")
            continue
        if dec == "omit":
            b["status"] = "omitted"
            log.append(f"{iid}: omitted")
            continue
        b["status"] = pipe["status"]                                  # a re-review may bring an omitted item back
        lib = d.get("library") or {}
        obj = lib.get("object")
        if obj == "render-only":
            b["status"] = "render-only"
        elif obj == "new":
            todo.append({"item": iid, "what": "new object requested", "kind": (d.get("object") or {}).get("kind") or it["object"].get("kind"),
                         "hint": (d.get("object") or {}).get("hint"), "comment": d.get("comment")})
        elif obj and obj != b.get("object"):
            b["object"] = obj
            todo.append({"item": iid, "what": f"object changed {pipe['object']} -> {obj}: rebind its params to this object's ids"})
            log.append(f"{iid}: object -> {obj}")
        mat = lib.get("material")
        if mat and mat != bp.get("materialPath"):
            bp["materialPath"] = mat
            log.append(f"{iid}: material -> {mat}")
        edits = d.get("params") or {}
        if edits:
            deck = it.setdefault("params_deck", dict(it.get("params", {})))   # what the deck said, kept the first time
            it.setdefault("params", {}).update(edits)
            moved = {k: v for k, v in edits.items() if deck.get(k) != v}
            if moved:
                todo.append({"item": iid, "what": "brief params changed: carry them into the binding params", "from": {k: deck.get(k) for k in moved}, "to": moved})
                log.append(f"{iid}: brief params {moved}")
        for k in ("object", "productUrls"):
            if k == "object" and d.get("object"):
                it["object"] = {**it.get("object", {}), **d["object"]}
            elif k == "productUrls" and "productUrls" in d:
                it["productUrls"] = d["productUrls"]

    (P / "roombrief.json").write_text(json.dumps(brief, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (P / "resolve.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (P / "review.todo.json").write_text(json.dumps({"schema": "review-todo/1", "reviewer": review.get("reviewer"), "questions": questions, "todo": todo}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print("\n".join(log) or "review: every item approved as specified")
    if todo:
        print(f"{len(todo)} item(s) for Claude in review.todo.json: " + ", ".join(t["item"] for t in todo))
    if questions:
        print("\n".join("FAIL question " + q for q in questions))
        raise SystemExit("the review has open questions: answer them, then the user signs off again")


if __name__ == "__main__":
    main(sys.argv[1])
