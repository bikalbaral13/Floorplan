# mc_build.py — build a Blender material from a material/1 JSON that carries a `blenderGraph` block.
#
# Import it from another Blender script:   import mc_build; mat = mc_build.build(definition, name)
# Pure bpy, Blender 4.5. No dependency on any app code.
#
# THE blenderGraph FORMAT (additive block inside a normal material/1 file)
#
#   "blenderGraph": {
#     "version": 1,
#     "nodes": {
#       "<id>": { "type": "ShaderNodeTexBrick",            # any Blender shader node bl_idname
#                 "props": { "offset": 0.37 },               # node PROPERTIES (enums, options)
#                 "in":    { "Scale": 1, "Vector": "@pos", "Color1": "#000000", "Mortar": "j:Fac" },
#                 "ramp":  [[0.0, "#7a4a22"], [1.0, "#d6a066"]] }   # only for ShaderNodeValToRGB
#     },
#     "out": { "Base Color": "<id>:Color", "Roughness": 0.45, "Normal": "<id>:Normal",
#              "Coat Weight": 0.1, "Displacement": "<id>:Displacement" }
#   }
#
# Input values: a number, a list (vector / RGBA), a "#rrggbb" colour, or a LINK written "<id>:<Output>"
# ("<id>" alone = that node's first output). "@pos" is world-space position in METRES (Geometry ▸
# Position), which is the library's convention: a 0.19 m plank is 0.19 m on any mesh, at any scale.
# "@uv" is the UV map, "@obj" object coordinates. `out` keys are Principled BSDF input names, plus
# "Displacement" (wired to the Material Output).

import bpy

_SPECIAL = {"@pos": ("ShaderNodeNewGeometry", "Position"), "@uv": ("ShaderNodeTexCoord", "UV"),
            "@obj": ("ShaderNodeTexCoord", "Object"), "@gen": ("ShaderNodeTexCoord", "Generated")}


def _hex(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [(x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


def _value(sock, v):
    """Set a socket default from a JSON value, adapting length to the socket (RGBA vs XYZ vs float)."""
    if isinstance(v, str) and v.startswith("#"):
        v = _hex(v)
    dv = sock.default_value
    try:
        n = len(dv)
    except TypeError:
        n = 0
    if n == 0:
        sock.default_value = float(v[0] if isinstance(v, (list, tuple)) else v)
    else:
        vals = list(v) if isinstance(v, (list, tuple)) else [float(v)] * n
        if len(vals) < n:
            vals = vals + [1.0] * (n - len(vals))
        sock.default_value = vals[:n]


def _sock(coll, name):
    """Find a socket by name, then by identifier, then case-insensitively — enabled sockets first.
    "Value#1" is the SECOND enabled socket called Value: Math and Vector Math repeat their input names."""
    if "#" in name:
        base, _, idx = name.partition("#")
        same = [s for s in coll if s.name == base and s.enabled]
        return same[int(idx)]
    for s in coll:
        if s.name == name and s.enabled:
            return s
    for s in coll:
        if s.name == name or s.identifier == name:
            return s
    low = name.lower()
    for s in coll:
        if s.name.lower() == low:
            return s
    raise KeyError(f"no socket '{name}' (have: {[s.name for s in coll]})")


def build(definition, name=None):
    g = definition.get("blenderGraph")
    if not g:
        raise ValueError("definition has no blenderGraph block")
    mat = bpy.data.materials.new(name or definition.get("id") or "material")
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial"); out.location = (900, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled"); bsdf.location = (600, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    made, specials = {}, {}
    order = list(g.get("nodes", {}).items())
    for i, (nid, spec) in enumerate(order):
        n = nt.nodes.new(spec["type"])
        n.name = n.label = nid
        n.location = (-1400 + 260 * (i % 6), 400 - 260 * (i // 6))
        for k, v in (spec.get("props") or {}).items():
            setattr(n, k, v)
        if spec["type"] == "ShaderNodeValToRGB" and spec.get("ramp"):
            els = n.color_ramp.elements
            stops = spec["ramp"]
            while len(els) < len(stops):
                els.new(0.5)
            for el, (pos, col) in zip(els, stops):
                el.position = float(pos)
                el.color = _hex(col) if isinstance(col, str) else tuple(col)
            if spec.get("interpolation"):
                n.color_ramp.interpolation = spec["interpolation"]
        made[nid] = n

    def output_of(ref):
        if ref in _SPECIAL:
            if ref not in specials:
                t, _ = _SPECIAL[ref]
                specials[ref] = nt.nodes.new(t)
                specials[ref].location = (-1700, 0)
            return specials[ref].outputs[_SPECIAL[ref][1]]
        nid, _, sock = ref.partition(":")
        if nid not in made:
            raise KeyError(f"link to unknown node '{nid}'")
        n = made[nid]
        return _sock(n.outputs, sock) if sock else next(s for s in n.outputs if s.enabled)

    def is_link(v):
        return isinstance(v, str) and not v.startswith("#") and (v in _SPECIAL or v.split(":")[0] in made)

    for nid, spec in order:
        n = made[nid]
        for k, v in (spec.get("in") or {}).items():
            s = _sock(n.inputs, k)
            if is_link(v):
                nt.links.new(output_of(v), s)
            else:
                _value(s, v)

    for k, v in (g.get("out") or {}).items():
        if k == "Displacement":
            nt.links.new(output_of(v), out.inputs["Displacement"])
            mat.displacement_method = "BUMP"
            continue
        s = _sock(bsdf.inputs, k)
        if is_link(v):
            nt.links.new(output_of(v), s)
        else:
            _value(s, v)
    return mat
