"""Import a BuilderPluss parametric object into Blender and keep it parametric.

WHAT MAKES IT PARAMETRIC HERE. The object arrives as a Blender IR (`*.blir.json`): a parameter list and a
list of PARTS, each part an axis-aligned box whose position and size are PYTHON EXPRESSIONS over those
parameters. So the import builds an Empty carrying the parameters as custom properties, and one unit-cube
child per part whose `location` and `scale` are evaluated from the expressions. Change a parameter in the
sidebar and the children move — no bake, no round trip to the web app, no Math Engine in Blender.

WHY UNIT CUBES AND NOT REBUILT MESHES. A part is a box, and a box is a unit cube with a location and a
scale. Rebuilding meshes on every slider drag would be slower and would throw away the materials; setting
two vectors does not. Mesh data is only touched when the number of parts changes, which happens only when a
count parameter (pillows, drawers) changes.

EVAL, AND WHY IT IS NOT A HOLE. The expressions are evaluated with `eval`, on a file the user chose from
disk. Every expression is therefore parsed to an AST and checked against a whitelist FIRST — arithmetic,
comparisons, conditionals, a fixed set of maths functions, and subscripting the params dict. An expression
containing anything else is refused and the import fails loudly. Whitelisting the tree is the check that
actually holds; stripping `__builtins__` on its own is not.

FRAME. The IR is already in Blender's frame — metres, +x east, +y north (the object frame's +y south was
flipped by the transpiler), +z up. So there is no axis handling in this file at all.
"""

import ast
import json
import math

import bpy

SCHEMA = "builderpluss.blender-ir/1"
IR_KEY = "bp_ir"          # the whole IR, on the parent empty, so a rebuild needs no external file
PART_KEY = "bp_part"      # part id, on each child
COPY_KEY = "bp_copy"      # copy index, on each child
SIG_KEY = "bp_sig"        # parameter signature at the last rebuild

# The only names an expression may call. `P` (the params dict) and `COPY` (the copy index) are the only
# other names it may read.
SAFE_FUNCS = {
    "min": min, "max": max, "abs": abs, "round": round,
    "floor": math.floor, "ceil": math.ceil, "sqrt": math.sqrt,
    "sin": math.sin, "cos": math.cos, "atan2": math.atan2,
}
SAFE_NODES = (
    ast.Expression, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Call,
    ast.Name, ast.Load, ast.Constant, ast.Subscript,
    ast.Add, ast.Sub, ast.Mult, ast.Div, ast.USub, ast.UAdd, ast.Not,
    ast.And, ast.Or, ast.Eq, ast.NotEq, ast.Lt, ast.LtE, ast.Gt, ast.GtE,
)


class IRError(ValueError):
    """The file is not a usable Blender IR."""


# ── expression safety + evaluation ────────────────────────────────────────────────────────────────

def _check(expr):
    """Parse `expr` and refuse anything outside the whitelist. Returns the compiled code object."""
    try:
        tree = ast.parse(expr, mode="eval")
    except SyntaxError as exc:
        raise IRError("formula %r does not parse: %s" % (expr[:60], exc))
    for node in ast.walk(tree):
        if not isinstance(node, SAFE_NODES):
            raise IRError("formula %r uses %s, which is not allowed" % (expr[:60], type(node).__name__))
        if isinstance(node, ast.Name) and node.id not in SAFE_FUNCS and node.id not in ("P", "COPY"):
            raise IRError("formula %r reads %r, which is not allowed" % (expr[:60], node.id))
        if isinstance(node, ast.Call) and not (isinstance(node.func, ast.Name) and node.func.id in SAFE_FUNCS):
            raise IRError("formula %r calls something that is not a whitelisted function" % expr[:60])
    return compile(tree, "<bp-formula>", "eval")


def _compile_ir(ir):
    """Compile every formula up front, so a bad file fails at import rather than mid-drag."""
    code = {}
    for part in ir["parts"]:
        for key in ("lenx", "leny", "lenz", "x", "y", "z", "hidden", "copies"):
            formula = part.get(key)
            if formula is None:
                continue
            code[(part["id"], key)] = _check(formula)
    return code


def _ev(code, key, params, copy_index=0, default=0.0):
    fn = code.get(key)
    if fn is None:
        return default
    scope = dict(SAFE_FUNCS)
    scope["P"] = params
    scope["COPY"] = copy_index
    return eval(fn, {"__builtins__": {}}, scope)  # noqa: S307 — the AST was whitelisted in _check


# ── parameters ────────────────────────────────────────────────────────────────────────────────────

def params_of(empty):
    """The parameter dict an expression sees: every declared parameter, read off the empty."""
    ir = ir_of(empty)
    out = {}
    for p in ir["parameters"]:
        value = empty.get(p["dc"], p["value"])
        if isinstance(value, bool):
            value = 1 if value else 0
        out[p["dc"]] = value
    return out


def ir_of(empty):
    raw = empty.get(IR_KEY)
    if not raw:
        raise IRError("%s carries no %s" % (empty.name, IR_KEY))
    return json.loads(raw)


def _write_params(empty, parameters):
    """Custom properties, with their UI range set from the object's own slider definition — so the panel
    gets real limits rather than Blender's default -inf..inf on every number."""
    for p in parameters:
        name = p["dc"]
        value = p["value"]
        if p["kind"] == "checkbox":
            empty[name] = bool(value)
        elif p["kind"] in ("select", "text"):
            empty[name] = str(value)
        else:
            empty[name] = float(value)
        try:
            ui = empty.id_properties_ui(name)
            meta = {"description": p.get("label") or name}
            if p["kind"] == "range":
                meta.update(min=float(p.get("min", 0.0)), max=float(p.get("max", 10.0)),
                            soft_min=float(p.get("min", 0.0)), soft_max=float(p.get("max", 10.0)),
                            step=float(p.get("step", 0.01)) * 100.0, precision=4)
            ui.update(**meta)
        except (AttributeError, TypeError):
            pass  # older Blender, or a type with no UI metadata — the property still works


def _signature(empty):
    """A cheap string that changes when any parameter does. Comparing this is what lets the depsgraph
    handler decide, per update, whether there is anything to do."""
    try:
        params = params_of(empty)
    except (IRError, ValueError):
        return ""
    return "|".join("%s=%s" % (k, params[k]) for k in sorted(params))


# ── finding the object the panel should show ──────────────────────────────────────────────────────

def is_parametric(obj):
    return obj is not None and IR_KEY in obj


def resolve(obj):
    """The parametric empty for whatever is selected.

    Clicking the mattress in the viewport selects a CHILD, and a panel that only looked at the active
    object would go blank — which reads exactly like the feature not being there. So a child resolves to
    its parent, and anything else to None."""
    if is_parametric(obj):
        return obj
    if obj is not None and is_parametric(obj.parent):
        return obj.parent
    return None


def scene_objects(scene):
    """Every parametric object in the scene, so the panel has something to show even with nothing selected."""
    return [o for o in scene.objects if is_parametric(o)]


def panel_target(context):
    """What the panel draws: the selection if it resolves, otherwise the only one in the scene."""
    found = resolve(context.active_object)
    if found is not None:
        return found
    all_of_them = scene_objects(context.scene)
    return all_of_them[0] if len(all_of_them) == 1 else None


def parameters_of(empty):
    """The parameter schema, straight off the object — the panel needs kinds and options, not just values."""
    try:
        return ir_of(empty)["parameters"]
    except (IRError, ValueError, KeyError):
        return []


def set_param(empty, name, value):
    """Set one parameter and rebuild. Used by the option buttons, which cannot go through `layout.prop`
    because an ID custom property of string type has no dropdown UI."""
    empty[name] = value
    rebuild(empty)


# ── build ─────────────────────────────────────────────────────────────────────────────────────────

def _unit_cube(name):
    """A 1x1x1 cube with its origin at the MIN corner, so `location` is the corner the formulas give and
    `scale` is the size they give. A centred cube would need every formula shifted by half a part."""
    mesh = bpy.data.meshes.new(name)
    verts = [(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0), (0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)]
    faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    return mesh


def _material_for(part, ir):
    """The material for one part. A part that NAMES a material (its 3D Render row was wired to a Material
    node in the web app) gets the real shader built from the definition the IR carries; everything else
    keeps the flat hex colour it always had. The fallback is not a degradation path bolted on afterwards --
    it is what every object authored before materials existed still takes, unchanged."""
    path = part.get("material")
    definition = (ir.get("materials") or {}).get(path) if path else None
    if definition:
        try:
            from .bp_material import material_from_def
            return material_from_def(definition, part.get("color") or "#94a3b8", name=path)
        except Exception as exc:          # a malformed definition must not lose the geometry
            print("[BuilderPluss] material %r failed (%s) -- falling back to colour" % (path, exc))
    return _material(part.get("color"))


def _material(hex_color):
    if not hex_color:
        return None
    name = "BP" + hex_color.lstrip("#")
    mat = bpy.data.materials.get(name)
    if mat is None:
        mat = bpy.data.materials.new(name)
        mat.use_nodes = True
        h = hex_color.lstrip("#")
        rgb = tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
        # sRGB -> linear, or every imported object reads several stops too bright in the viewport
        lin = tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb)
        mat.diffuse_color = (*lin, 1.0)
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*lin, 1.0)
            if "Roughness" in bsdf.inputs:
                bsdf.inputs["Roughness"].default_value = 0.6
    return mat


def import_parametric_object(filepath, context, collection_name=None):
    """Build the object. Returns a stats dict for the operator's report.

    `filepath` may be the translated IR or the .pobj SOURCE it came from - the two are both `.json` in
    the same folder of the same bucket and nothing on the outside tells them apart, so refusing the
    source with a schema error just moved the problem onto the user. See utils/bp_pobj."""
    from .bp_pobj import resolve_ir_path
    filepath, translation_note = resolve_ir_path(filepath)

    with open(filepath, "r", encoding="utf-8") as fh:
        ir = json.load(fh)
    if ir.get("schema") != SCHEMA:
        raise IRError("this file says schema %r; this importer reads %r" % (ir.get("schema"), SCHEMA))
    code = _compile_ir(ir)  # fail here, not mid-drag

    name = ir.get("name") or "Parametric Object"
    coll = bpy.data.collections.new(collection_name or name)
    context.scene.collection.children.link(coll)

    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 0.25
    empty[IR_KEY] = json.dumps(ir, separators=(",", ":"))
    empty["bp_source"] = ir.get("source", {}).get("id", "")
    _write_params(empty, ir["parameters"])
    coll.objects.link(empty)

    stats = _sync(empty, ir, code, coll)
    empty[SIG_KEY] = _signature(empty)

    # Select and activate it. Without this the import finishes with NOTHING selected, the parameter panel
    # has no object to draw, and the object looks like it arrived without any parameters at all.
    try:
        for o in context.selected_objects:
            o.select_set(False)
        empty.select_set(True)
        context.view_layer.objects.active = empty
    except (AttributeError, RuntimeError):
        pass  # no view layer to speak of (background, or an unusual context) — the geometry is still built

    stats["collection"] = coll.name
    stats["name"] = empty.name
    if translation_note:
        stats["translated"] = translation_note
    stats["object"] = empty
    stats["parameters"] = len(ir["parameters"])
    return stats


def _sync(empty, ir, code, coll):
    """Make the children match the parameters. Creates and removes only when a copy count changed;
    otherwise it just moves and scales what is already there."""
    params = params_of(empty)
    existing = {}
    for child in list(empty.children):
        key = (child.get(PART_KEY), child.get(COPY_KEY))
        if key[0] is None:
            continue
        existing[key] = child

    wanted = set()
    created = hidden = 0
    for part in ir["parts"]:
        pid = part["id"]
        copies = int(round(_ev(code, (pid, "copies"), params, 0, 0.0)))
        for c in range(max(0, copies) + 1):
            wanted.add((pid, c))
            obj = existing.get((pid, c))
            if obj is None:
                mesh = _unit_cube("%s_%s_%d" % (ir["name"], pid, c))
                obj = bpy.data.objects.new("%s%s" % (part["name"], "" if c == 0 else " %d" % (c + 1)), mesh)
                mat = _material_for(part, ir)
                if mat:
                    obj.data.materials.append(mat)
                coll.objects.link(obj)
                obj.parent = empty
                obj[PART_KEY] = pid
                obj[COPY_KEY] = c
                created += 1
            is_hidden = bool(_ev(code, (pid, "hidden"), params, c, 0.0))
            obj.hide_viewport = is_hidden
            obj.hide_render = is_hidden
            if is_hidden:
                hidden += 1
                continue
            obj.location = (
                _ev(code, (pid, "x"), params, c), _ev(code, (pid, "y"), params, c), _ev(code, (pid, "z"), params, c),
            )
            obj.scale = (
                _ev(code, (pid, "lenx"), params, c), _ev(code, (pid, "leny"), params, c), _ev(code, (pid, "lenz"), params, c),
            )

    removed = 0
    for key, obj in existing.items():
        if key not in wanted:
            bpy.data.objects.remove(obj, do_unlink=True)
            removed += 1
    return {"parts": len(ir["parts"]), "objects": len(wanted), "created": created,
            "removed": removed, "hidden": hidden}


def rebuild(empty):
    """Re-evaluate one imported object against its current parameters."""
    ir = ir_of(empty)
    code = _compile_ir(ir)
    coll = empty.users_collection[0] if empty.users_collection else bpy.context.scene.collection
    stats = _sync(empty, ir, code, coll)
    empty[SIG_KEY] = _signature(empty)
    return stats


# ── live updates ──────────────────────────────────────────────────────────────────────────────────

_busy = False


def _on_depsgraph(scene, depsgraph=None):
    """Rebuild any imported object whose parameters changed since the last pass.

    Writing to objects from inside `depsgraph_update_post` re-triggers it, so the guard is not optional —
    without it the first slider drag recurses until Blender stops responding."""
    global _busy
    if _busy:
        return
    _busy = True
    try:
        for obj in scene.objects:
            if obj.type != "EMPTY" or IR_KEY not in obj:
                continue
            sig = _signature(obj)
            if sig and sig != obj.get(SIG_KEY, ""):
                try:
                    rebuild(obj)
                except (IRError, ValueError, KeyError) as exc:
                    print("BuilderPluss: rebuild of %s failed - %s" % (obj.name, exc))
                    obj[SIG_KEY] = sig  # do not retry every frame on a broken file
    finally:
        _busy = False


def register_handler():
    if _on_depsgraph not in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.append(_on_depsgraph)


def unregister_handler():
    if _on_depsgraph in bpy.app.handlers.depsgraph_update_post:
        bpy.app.handlers.depsgraph_update_post.remove(_on_depsgraph)
