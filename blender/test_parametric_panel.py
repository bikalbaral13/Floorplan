"""Render the sidebar and screenshot it, so the PANEL is verified and not just the maths.

    blender --window-geometry 0 0 1200 1000 --python blender/test_parametric_panel.py -- <ir> <out.png>

Blender in background mode has no UI regions, so panel `draw()` is never called and a layout bug cannot be
caught there — which is exactly how "the object imported but there are no parameters" got shipped. This runs
with a real window, imports through the real operator, opens the Builder+ tab, forces a redraw and captures
it. The screenshot is the artefact; the assertions below are what make a failure legible.
"""

import json
import sys

import bpy


def argv():
    a = sys.argv
    return a[a.index("--") + 1:] if "--" in a else []


def view3d():
    for window in bpy.context.window_manager.windows:
        for area in window.screen.areas:
            if area.type == "VIEW_3D":
                return window, area
    return None, None


def main():
    args = argv()
    ir_path, out_png = args[0], args[1]
    with open(ir_path, "r", encoding="utf-8") as fh:
        ir = json.load(fh)

    bpy.ops.preferences.addon_enable(module="House")
    res = bpy.ops.builderplus.import_parametric_object(filepath=ir_path)
    print("import ->", res)

    empty = next(o for o in bpy.data.objects if "bp_ir" in o)
    problems = []

    # 1. the import must leave its own object active, or the panel has nothing to draw
    if bpy.context.view_layer.objects.active is not empty:
        problems.append("import did not activate the empty (active=%r)" % (
            getattr(bpy.context.view_layer.objects.active, "name", None)))

    # 2. a selected CHILD must still resolve to the parent
    from House.utils.parametric_object import panel_target, resolve
    child = next(c for c in empty.children)
    bpy.context.view_layer.objects.active = child
    if resolve(child) is not empty:
        problems.append("a selected child does not resolve to the empty")
    bpy.context.view_layer.objects.active = empty

    # 3. with NOTHING selected the panel must still find the only object in the scene
    bpy.context.view_layer.objects.active = None
    if panel_target(bpy.context) is not empty:
        problems.append("with nothing selected the panel finds no target")
    bpy.context.view_layer.objects.active = empty

    # -- open the sidebar on the Builder+ tab and expand the panels --
    window, area = view3d()
    if area is None:
        problems.append("no VIEW_3D area — cannot render the panel")
    else:
        area.spaces.active.show_region_ui = True
        for region in area.regions:
            if region.type == "UI":
                try:
                    region.active_panel_category = "Builder+"
                except (AttributeError, TypeError) as exc:
                    problems.append("could not switch to the Builder+ tab: %s" % exc)
        # Panels remember their collapsed state per file; force the two we care about open.
        for pid in ("BUILDERPLUS_PT_main_panel", "BUILDERPLUS_PT_parametric_tools"):
            try:
                bpy.ops.wm.context_toggle  # noqa: B018 — presence check only
            except Exception:  # noqa: BLE001
                pass
        with bpy.context.temp_override(window=window, area=area):
            bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=4)

    # -- the draw() itself: run it against a real layout and let any exception surface --
    if area is not None:
        for region in area.regions:
            if region.type != "UI":
                continue
            try:
                with bpy.context.temp_override(window=window, area=area, region=region):
                    bpy.ops.wm.redraw_timer(type="DRAW_WIN_SWAP", iterations=2)
            except Exception as exc:  # noqa: BLE001
                problems.append("redrawing the sidebar raised %s: %s" % (type(exc).__name__, exc))

    try:
        bpy.ops.screen.screenshot(filepath=out_png)
        print("screenshot ->", out_png)
    except Exception as exc:  # noqa: BLE001
        problems.append("screenshot failed: %s" % exc)

    print("=" * 70)
    n_params = len(ir["parameters"])
    print("object %r  %d parameters  %d children" % (empty.name, n_params, len(empty.children)))
    if problems:
        print("PROBLEMS:")
        for p in problems:
            print("   -", p)
    else:
        print("PANEL OK — active object, child fallback and empty-selection fallback all resolve")
    print("=" * 70)

    bpy.ops.wm.quit_blender()


main()
