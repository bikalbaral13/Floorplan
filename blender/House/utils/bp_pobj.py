"""
bp_pobj.py - accept a raw parametric object (.pobj flow) where the importer expects the translated IR.

THE PROBLEM THIS SOLVES. `library/Objects/**.json` holds the SOURCE of an object: a flow graph of six
nodes whose geometry lives in a Math Engine body. The Blender importer reads a translated artifact
(`builderpluss.blender-ir/1`): a flat list of boxes with formulas. Handing the importer the source got
`this file says schema None`, which is accurate and completely unhelpful - the two files have the same
extension, sit in the same bucket, and a human has no way to tell which is which.

WHY NOT JUST TRANSLATE IN PYTHON. The translation is not a format conversion, it is a symbolic evaluation
of the Math Engine body: parse it, walk it with the parameters left as free variables, stop at the quad
table `Q`, and prove each row is an axis-aligned box before printing it as a formula. That evaluator is
~700 lines of JavaScript in tools/skpir and it is the ONLY implementation. A second one in Python would
not be a port, it would be a fork - two symbolic evaluators that agree until the day they quietly do not,
on an object nobody re-checks. So this module SHELLS OUT to the real one.

THE CHAIN, cheapest first:
  1. already the IR                        -> use it
  2. a sibling <name>.blir.json, no older   -> use that (someone already translated it)
  3. node + tools/skpir on this machine     -> translate to a temp file, use that
  4. none of the above                      -> an error naming the exact command to run

Only step 3 needs the repo. Point BP_REPO at it (or BP_SKPIR_RUN straight at run.mjs) when it is not in
one of the usual places; without it steps 1, 2 and 4 still behave sensibly.
"""

import json
import os
import shutil
import subprocess
import tempfile

SCHEMA = "builderpluss.blender-ir/1"

#: Checked in order, after $BP_SKPIR_RUN and $BP_REPO. Convenience only - an unknown machine falls through
#: to the step-4 message rather than failing in some confusing way.
_REPO_CANDIDATES = (
    "D:/MAIN/monica_recent",
    "C:/MAIN/monica_recent",
    os.path.expanduser("~/monica_recent"),
)


def looks_like_pobj(doc):
    """A .pobj flow: a node/edge graph carrying an `object` block. Deliberately structural rather than a
    version check - these files predate having a schema field, which is why the error said `None`."""
    return (
        isinstance(doc, dict)
        and isinstance(doc.get("nodes"), list)
        and isinstance(doc.get("edges"), list)
        and isinstance(doc.get("object"), dict)
    )


def _find_transpiler():
    """Absolute path of tools/skpir/run.mjs, or None."""
    direct = os.environ.get("BP_SKPIR_RUN")
    if direct and os.path.isfile(direct):
        return direct
    roots = []
    if os.environ.get("BP_REPO"):
        roots.append(os.environ["BP_REPO"])
    roots.extend(_REPO_CANDIDATES)
    for root in roots:
        cand = os.path.join(root, "tools", "skpir", "run.mjs")
        if os.path.isfile(cand):
            return cand
    return None


def _sibling_ir(pobj_path):
    """`bed-materials.json` -> `bed-materials.blir.json` beside it, when it exists and is not STALER than
    the source. The staleness test matters: silently importing an IR translated before the object's last
    edit would show geometry that no longer matches the file the user picked."""
    stem = os.path.splitext(pobj_path)[0]
    cand = stem + ".blir.json"
    if not os.path.isfile(cand):
        return None
    try:
        if os.path.getmtime(cand) < os.path.getmtime(pobj_path):
            return None
    except OSError:
        return None
    return cand


def _transpile(pobj_path, run_mjs):
    """Run the real translator. Returns the temp IR path, or raises with the tool's own stderr attached -
    an unsupported object (a lathe, a non-axis-aligned quad) has a specific reason and it belongs in the
    message rather than being flattened to 'translation failed'."""
    node = shutil.which("node")
    if not node:
        raise ValueError("node is not on PATH, so the .pobj could not be translated")
    out = os.path.join(tempfile.mkdtemp(prefix="bp_skpir_"),
                       os.path.splitext(os.path.basename(pobj_path))[0] + ".blir.json")
    proc = subprocess.run(
        [node, run_mjs, pobj_path, out, "--target", "blender"],
        cwd=os.path.dirname(os.path.dirname(os.path.dirname(run_mjs))),
        capture_output=True, text=True, timeout=180,
    )
    if proc.returncode != 0 or not os.path.isfile(out):
        detail = (proc.stderr or proc.stdout or "").strip().splitlines()
        raise ValueError("translating the .pobj failed: %s" % (detail[-1] if detail else "no output"))
    return out


def resolve_ir_path(filepath):
    """The path the importer should actually read, and a note about how it got there.

    Returns (path, note). `note` is None when the file was already the IR, so the operator can stay quiet
    in the ordinary case and say what it did in the interesting one."""
    try:
        with open(filepath, "r", encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError) as exc:
        raise ValueError("could not read %s: %s" % (os.path.basename(filepath), exc))

    if isinstance(doc, dict) and doc.get("schema") == SCHEMA:
        return filepath, None

    if not looks_like_pobj(doc):
        raise ValueError("this file says schema %r; this importer reads %r"
                         % (doc.get("schema") if isinstance(doc, dict) else None, SCHEMA))

    name = doc.get("title") or doc.get("id") or os.path.basename(filepath)

    sibling = _sibling_ir(filepath)
    if sibling:
        return sibling, "used %s beside it" % os.path.basename(sibling)

    run_mjs = _find_transpiler()
    if run_mjs:
        return _transpile(filepath, run_mjs), "translated %s on the fly" % name

    raise ValueError(
        "%s is a parametric object SOURCE (.pobj flow), not the translated IR this importer reads, and "
        "the translator was not found on this machine. Either run:  node tools/skpir/run.mjs \"%s\" "
        "out.blir.json --target blender  and import out.blir.json, or set BP_REPO to the monica_recent "
        "checkout so this happens automatically."
        % (os.path.basename(filepath), os.path.basename(filepath))
    )
