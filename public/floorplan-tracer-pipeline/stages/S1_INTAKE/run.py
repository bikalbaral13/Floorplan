"""S1 — intake. Images are copied as pages; PDFs go through tools/pdf_intake.py (region finding, titles,
document kind). The user confirms the manifest (the gate) — nothing downstream runs on an unconfirmed set."""
import os, shutil, subprocess, sys
from PIL import Image
from core import paths
from core.stage import result
from core.model import F

def run(ctx):
    s = ctx.scope; mf = ctx.w("manifest.json")
    if os.path.exists(mf) and paths.load_json(mf).get("pages"):
        m = paths.load_json(mf)
        if not m.get("confirmed") and not ctx.approved:
            return result("blocked", "manifest not confirmed yet — show work/contact.png + the manifest to the user, rerun with --approved \"<their words>\"", [ctx.wrel(mf)])
        if not m.get("confirmed"):
            m.update(confirmed=True, confirmed_by=ctx.approved); paths.save_json(mf, m)
        return result("done", f"manifest confirmed: {len(m['pages'])} page(s), document kind {m['document_kind']}", [ctx.wrel(mf)], decisions=[f"manifest confirmed: {ctx.approved}"])
    pages, fnd, pdf_kind = [], [], None
    for f in s.get("sources", []):
        src = ctx.p("inputs", f)
        if not os.path.exists(src): fnd.append(F("fail", "intake", f, "missing")); continue
        if f.lower().endswith((".md", ".txt")):                # a written description of the source (no image)
            dst = ctx.w("pages", os.path.basename(f)); shutil.copy(src, dst)
            pages.append({"id": f"P{len(pages)+1:02d}", "file": ctx.wrel(dst), "size": None, "kind": "text", "title": os.path.splitext(f)[0]}); continue
        if f.lower().endswith(".pdf"):
            out = ctx.w("pdf"); r = subprocess.run([sys.executable, os.path.join(paths.ROOT, "tools", "pdf_intake.py"), src, out, "--project", ctx.code], capture_output=True, text=True)
            if r.returncode: fnd.append(F("fail", "intake", f, r.stderr[-400:])); continue
            pm = paths.load_json(os.path.join(out, "manifest.json")); pdf_kind = pm.get("documentKind")
            for reg in pm.get("regions", []):
                if not reg.get("crop"): continue                     # regions the intake did not crop (elevations, schedules, small unknowns)
                fp = os.path.join(out, reg["crop"])
                if os.path.exists(fp):
                    im = Image.open(fp); pages.append({"id": f"P{len(pages)+1:02d}", "file": ctx.wrel(fp), "size": list(im.size), "kind": reg.get("kind", "plan"), "title": reg.get("title", "")})
        else:
            dst = ctx.w("pages", os.path.basename(f)); shutil.copy(src, dst); im = Image.open(dst)
            pages.append({"id": f"P{len(pages)+1:02d}", "file": ctx.wrel(dst), "size": list(im.size), "kind": "sketch" if s.get("source_kind") == "sketch" else "plan", "title": os.path.splitext(f)[0]})
    if not pages: return result("failed", "no pages", findings=fnd)
    thumbs = [Image.open(ctx.p(p["file"])) for p in pages if p["kind"] != "text"] or [Image.new("RGB", (400, 120), "white")]
    W = sum(min(600, t.width) for t in thumbs) + 10 * len(thumbs); H = max(int(t.height * min(600, t.width) / t.width) for t in thumbs)
    sheet = Image.new("RGB", (W, H), "white"); x = 0
    for t in thumbs:
        k = min(600, t.width) / t.width; tt = t.convert("RGB").resize((int(t.width * k), int(t.height * k))); sheet.paste(tt, (x, 0)); x += tt.width + 10
    sheet.save(ctx.w("contact.png"))
    kind = pdf_kind or ("multi-level" if s.get("levels") == "multi" else ("sketch" if s.get("source_kind") == "sketch" else "single"))
    paths.save_json(mf, {"pages": pages, "document_kind": kind, "confirmed": False})
    return result("blocked", f"{len(pages)} page(s) → manifest ({kind}). Show work/contact.png and the manifest to the user; rerun with their confirmation.",
                  [ctx.wrel(mf), ctx.wrel(ctx.w("contact.png"))], fnd)
