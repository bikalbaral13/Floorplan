"""Headless end-to-end test of the Blender parametric-object import.

    blender -b --python blender/test_parametric_object.py -- <bed.blir.json> <expected.json>

Enables the real addon and calls the real operator, so this covers registration, the panel's operator ids,
the importer and the live-rebuild path — not just the maths. The geometry is compared against `expected.json`,
which comes from the Math Engine itself, so a pass means Blender agrees with the web app rather than with a
second copy of the same assumptions.
"""

import json
import sys

import bpy

TOL = 1e-6
ADDON = "House"


def argv():
    a = sys.argv
    return a[a.index("--") + 1:] if "--" in a else []


def fresh_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def touch(obj):
    """Make Blender notice a custom property changed.

    Dragging the slider in the UI tags the object itself, which is what raises `depsgraph_update_post` and
    so what runs the rebuild. Assigning `obj["Length"] = 2.4` from Python does NOT tag anything, so a test
    that only assigns would exercise nothing and pass for the wrong reason. `update_tag()` is the same
    signal the UI sends."""
    obj.update_tag()
    bpy.context.view_layer.update()


def world_box(obj):
    """The object's world-space bounds as (x0, x1, y0, y1, z0, z1)."""
    mw = obj.matrix_world
    pts = [mw @ v.co for v in obj.data.vertices]
    xs = [p.x for p in pts]
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    return min(xs), max(xs), min(ys), max(ys), min(zs), max(zs)


def group_boxes(empty, ir):
    """Union the visible children per IR group, back in the object's own frame (+v south)."""
    part_group = {p["id"]: p["group"] for p in ir["parts"]}
    out = {}
    for child in empty.children:
        pid = child.get("bp_part")
        if pid is None or child.hide_viewport:
            continue
        g = part_group[pid]
        x0, x1, y0, y1, z0, z1 = world_box(child)
        # Blender +y is north; the object frame's +v is SOUTH. Undo the flip the transpiler applied.
        box = [x0, x1, -y1, -y0, z0, z1]
        if g not in out:
            out[g] = box
        else:
            b = out[g]
            for i in (0, 2, 4):
                b[i] = min(b[i], box[i])
            for i in (1, 3, 5):
                b[i] = max(b[i], box[i])
    return out


def compare(label, mine, theirs, failures):
    keys = set(mine) | set(int(k) for k in theirs)
    bad = []
    for g in sorted(keys):
        a = mine.get(g)
        b = theirs.get(str(g))
        if a is None and b is None:
            continue
        if a is None or b is None:
            bad.append("group %s: %s" % (g, "blender draws it, bake does not" if b is None else "bake draws it, blender does not"))
            continue
        for i, name in enumerate(["u0", "u1", "v0", "v1", "z0", "z1"]):
            if abs(a[i] - b[i]) > TOL:
                bad.append("group %s %s: blender %.6f vs bake %.6f" % (g, name, a[i], b[i]))
    if bad:
        failures.append(label)
        print("FAIL  %s" % label)
        for x in bad[:6]:
            print("        %s" % x)
    else:
        print("ok    %-22s %d groups match" % (label, len(keys)))


def main():
    args = argv()
    if len(args) < 2:
        print("usage: ... -- <ir.blir.json> <expected.json>")
        sys.exit(2)
    ir_path, exp_path = args[0], args[1]
    with open(exp_path, "r", encoding="utf-8") as fh:
        expected = json.load(fh)
    with open(ir_path, "r", encoding="utf-8") as fh:
        ir = json.load(fh)

    print("=" * 74)
    print("enabling addon %r" % ADDON)
    bpy.ops.preferences.addon_enable(module=ADDON)

    failures = []
    key_by_param = {p["key"]: p["dc"] for p in ir["parameters"]}

    for case in expected["cases"]:
        fresh_scene()
        bpy.ops.preferences.addon_enable(module=ADDON)
        res = bpy.ops.builderplus.import_parametric_object(filepath=ir_path)
        if res != {"FINISHED"}:
            failures.append(case["label"])
            print("FAIL  %s: operator returned %s" % (case["label"], res))
            continue
        empty = next(o for o in bpy.data.objects if "bp_ir" in o)

        # Drive the parameters exactly as a user would, then let the live-rebuild handler do the work.
        for key, value in case["overrides"].items():
            dc = key_by_param[key]
            empty[dc] = (1 if value else 0) if isinstance(value, bool) else value
        if case["overrides"]:
            touch(empty)

        compare(case["label"], group_boxes(empty, ir), case["groups"], failures)

    # -- the things only the Blender side can get wrong --
    print("-" * 74)
    fresh_scene()
    bpy.ops.preferences.addon_enable(module=ADDON)
    bpy.ops.builderplus.import_parametric_object(filepath=ir_path)
    empty = next(o for o in bpy.data.objects if "bp_ir" in o)

    checks = []
    checks.append(("operator is registered", hasattr(bpy.ops.builderplus, "import_parametric_object")))
    checks.append(("rebuild operator is registered", hasattr(bpy.ops.builderplus, "rebuild_parametric_object")))
    checks.append(("all %d parameters landed" % len(ir["parameters"]),
                   all(p["dc"] in empty for p in ir["parameters"])))
    checks.append(("parameters have UI ranges",
                   any(empty.id_properties_ui(p["dc"]).as_dict().get("max") is not None
                       for p in ir["parameters"] if p["kind"] == "range")))
    n0 = len([c for c in empty.children if not c.hide_viewport])
    empty["Pillows"] = 4
    touch(empty)
    pillows = [c for c in empty.children if c.get("bp_part", "").startswith("pillows") and not c.hide_viewport]
    checks.append(("Pillows=4 gives 4 pillow objects (was %d visible parts)" % n0, len(pillows) == 4))
    empty["BaseStyle"] = "Plinth"
    touch(empty)
    legs = [c for c in empty.children if c.get("bp_part", "").startswith("legs") and not c.hide_viewport]
    plinth = [c for c in empty.children if c.get("bp_part", "").startswith("plinth") and not c.hide_viewport]
    checks.append(("BaseStyle=Plinth hides the legs", len(legs) == 0))
    checks.append(("BaseStyle=Plinth shows the plinth", len(plinth) == 1))
    empty["HeadboardStyle"] = "None"
    touch(empty)
    boards = [c for c in empty.children if c.get("bp_part", "").startswith("head") and not c.hide_viewport]
    checks.append(("HeadboardStyle=None hides the headboard", len(boards) == 0))
    empty["Length"] = 2.4
    touch(empty)
    mattress = next(c for c in empty.children if c.get("bp_part", "").startswith("mattress"))
    # The mattress runs from the headboard's inner face to the foot of the bed, so it loses ONE board
    # thickness, not two — the footboard is off, and `_mu1` only subtracts a board when it is on.
    checks.append(("Length=2.4 re-proportions the mattress", abs(mattress.scale.x - (2.4 - 0.06)) < 1e-6))

    # -- the panel-resolution fixes: these are what decides whether the parameters are VISIBLE --
    # `draw()` itself cannot run in background mode (there are no UI regions), so what is checked here is
    # everything the panel asks before drawing. A regression in these is exactly the "imported it, but
    # there are no parameters" failure.
    from House.utils.parametric_object import panel_target, resolve

    fresh_scene()
    bpy.ops.preferences.addon_enable(module=ADDON)
    bpy.ops.builderplus.import_parametric_object(filepath=ir_path)
    empty2 = next(o for o in bpy.data.objects if "bp_ir" in o)
    checks.append(("import leaves its own object active",
                   bpy.context.view_layer.objects.active is empty2))

    child = next(iter(empty2.children))
    bpy.context.view_layer.objects.active = child
    checks.append(("a selected child resolves to the empty", resolve(child) is empty2))
    checks.append(("panel finds the object from a selected child", panel_target(bpy.context) is empty2))

    bpy.context.view_layer.objects.active = None
    checks.append(("panel finds the only object with nothing selected", panel_target(bpy.context) is empty2))

    bpy.context.view_layer.objects.active = empty2
    r = bpy.ops.builderplus.set_parametric_option(object_name=empty2.name, param="BaseStyle", value="Plinth")
    legs2 = [c for c in empty2.children if c.get("bp_part", "").startswith("legs") and not c.hide_viewport]
    checks.append(("the option button sets BaseStyle and rebuilds", r == {"FINISHED"} and len(legs2) == 0))

    bpy.context.view_layer.objects.active = None
    r = bpy.ops.builderplus.pick_parametric_object(object_name=empty2.name)
    checks.append(("the pick button activates the object",
                   r == {"FINISHED"} and bpy.context.view_layer.objects.active is empty2))

    for label, ok in checks:
        print("%s  %s" % ("ok   " if ok else "FAIL ", label))
        if not ok:
            failures.append(label)

    print("=" * 74)
    if failures:
        print("FAILED: %d" % len(failures))
        for f in failures:
            print("   - %s" % f)
        sys.exit(1)
    print("ALL PASS — %d geometry cases + %d behaviour checks" % (len(expected["cases"]), len(checks)))


main()
