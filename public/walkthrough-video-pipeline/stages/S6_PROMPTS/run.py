"""S6 — validate prompts.json (the agent wrote it, see prompt.md) and write prompts.preview.md for the user."""
from core import shots as SH
from core.stage import result, F, status_from

def run(ctx):
    s, std, doc = ctx.scope, ctx.standards(), ctx.load("shots.json")
    if not ctx.has("prompts.json"):
        draft = {"schema": "walkthrough-prompts/1", "model": s.get("ai_model"), "resolution": s.get("ai_resolution"), "aspect_ratio": s.get("aspect_ratio"),
                 "seed": s.get("seed"), "style": {"prefix": std["style"]["prefix"], "suffix": std["style"]["suffix"]},
                 "shots": {x["id"]: {"body": ""} for x in doc["shots"]}}
        ctx.save("prompts.json", draft)
        return result("blocked", "Draft prompts.json written (model, seed, house style). Write a body per shot following stages/S6_PROMPTS/prompt.md, then rerun.", ["prompts.json"])
    p = ctx.load("prompts.json"); fnd = SH.check_prompts(p, doc, std)
    for k, sk in (("model", "ai_model"), ("resolution", "ai_resolution"), ("aspect_ratio", "aspect_ratio"), ("seed", "seed")):
        if s.get(sk) not in (None, "") and p.get(k) != s.get(sk): fnd.append(F("warn", "prompts", k, f"{p.get(k)!r} differs from scope {s.get(sk)!r}"))
    if status_from(fnd) == "done":
        md = [f"# {ctx.code} — AI prompts", "", f"Model `{p['model']}` · {p['resolution']} · {p['aspect_ratio']} · seed **{p['seed']}**", ""]
        for x in doc["shots"]:
            md += [f"## {x['id']} — {x.get('name', '')}", f"Reference: preview clip `{x['id']}.mp4` · Duration: {x['duration']:g} s", "", SH.full_prompt(p, x["id"]), ""]
        open(ctx.p("prompts.preview.md"), "w", encoding="utf-8").write("\n".join(md))
    return result(status_from(fnd), f"{len(p.get('shots', {}))} prompts, model {p.get('model')}, seed {p.get('seed')}", ["prompts.json", "prompts.preview.md"], fnd)
