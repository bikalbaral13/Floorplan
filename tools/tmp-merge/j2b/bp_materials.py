"""bp_materials.py — a Blender shader from a Builderpluss `material/1` definition.

A superset of the House addon's `utils/bp_material.py`. Same four blocks, same flat-recipe discipline,
plus the three things an interior render needs and a parametric object did not:

    emission   kelvin + cd/m²      -> the Principled's own Emission inputs, NOT a separate shader, so the
                                      glTF exporter carries it out as KHR_materials_emissive_strength
    tint       one hex             -> overrides the file's base colour at the point of use, so a single
                                      lacquer recipe serves a cream shutter, a charcoal shadow gap and a
                                      navy TV body without three near-identical files in the library
    maps       image paths         -> optional; when a material ships bitmaps they win over the procedural,
                                      because they are also the only thing a GLB can carry

WORLD-SPACE COORDINATES, still. Textures are fed Geometry ▸ Position, so `brickWidth 0.23` is 230 mm on
every surface and two parts that meet share a continuous pattern. The UVs `render_plan.py` writes are a
metre-scaled planar projection of the same space, which is what keeps an image map and its procedural
sibling agreeing between the Cycles render and the GLB.
"""

import math
import os

import bpy

# Blender 4.1 removed Musgrave and folded it into Noise, so it is deliberately absent.
_TEX_NODE = {
    "brick": "ShaderNodeTexBrick",
    "checker": "ShaderNodeTexChecker",
    "noise": "ShaderNodeTexNoise",
    "voronoi": "ShaderNodeTexVoronoi",
    "wave": "ShaderNodeTexWave",
    "gradient": "ShaderNodeTexGradient",
    "magic": "ShaderNodeTexMagic",
    "white-noise": "ShaderNodeTexWhiteNoise",
}

_cache = {}


def clear_cache():
    _cache.clear()


def _srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _rgba(hex_color, alpha=1.0):
    """`#rrggbb` -> linear RGBA. Principled wants linear; sRGB reads several stops bright."""
    h = (hex_color or "#94a3b8").lstrip("#")
    if len(h) != 6:
        h = "94a3b8"
    try:
        srgb = [int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    except ValueError:
        srgb = [0.58, 0.64, 0.72]
    return tuple([_srgb_to_linear(c) for c in srgb] + [alpha])


def kelvin_rgb(kelvin):
    """Colour temperature -> linear RGB. Tanner Helland's approximation, which is what every real-time
    viewer in this stack uses; Blender's own Blackbody node would be more correct and would also make the
    value impossible to read back out for the glTF exporter, which wants a flat colour."""
    t = max(1000.0, min(12000.0, float(kelvin))) / 100.0
    if t <= 66:
        r = 255.0
        g = 99.4708025861 * math.log(t) - 161.1195681661
        b = 0.0 if t <= 19 else 138.5177312231 * math.log(t - 10) - 305.0447927307
    else:
        r = 329.698727446 * ((t - 60) ** -0.1332047592)
        g = 288.1221695283 * ((t - 60) ** -0.0755148492)
        b = 255.0
    clamp = lambda v: max(0.0, min(255.0, v)) / 255.0
    return tuple(_srgb_to_linear(clamp(v)) for v in (r, g, b))


def _set(node, key, value):
    """Set an input by name, ignoring a name this build does not have — one definition survives a node
    gaining or losing a socket between versions instead of failing the whole import."""
    sock = node.inputs.get(key)
    if sock is None:
        return False
    try:
        if isinstance(sock.default_value, (float, int)):
            sock.default_value = float(value)
        else:
            sock.default_value = _rgba(value) if isinstance(value, str) else tuple(value)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _prop(node, key, value):
    if not hasattr(node, key):
        return False
    try:
        setattr(node, key, value)
        return True
    except (TypeError, ValueError, AttributeError):
        return False


def _coords(tree, x=-1000, y=-100):
    n = tree.nodes.new("ShaderNodeNewGeometry")
    n.location = (x, y)
    return n


def _build_texture(tree, definition):
    """The texture node for this definition, already fed world-space coordinates. None for a pbr-only
    material (`type: none` — clear glass, a mirror: no colour pattern, only surface response)."""
    proc = definition.get("procedural") or {}
    kind = proc.get("type") or "none"
    bl_idname = _TEX_NODE.get(kind)
    if not bl_idname:
        return None
    p = proc.get("params") or {}

    coord = _coords(tree, -900, -100)
    tex = tree.nodes.new(bl_idname)
    tex.location = (-620, 0)
    if "Vector" in tex.inputs:
        tree.links.new(coord.outputs["Position"], tex.inputs["Vector"])

    if kind == "brick":
        _set(tex, "Color1", p.get("color1", "#9c4a2f"))
        _set(tex, "Color2", p.get("color2", "#8a3f28"))
        _set(tex, "Mortar", p.get("mortar", "#cfc9bd"))
        _set(tex, "Scale", p.get("scale", 1))
        _set(tex, "Mortar Size", p.get("mortarSize", 0.01))
        _set(tex, "Mortar Smooth", p.get("mortarSmooth", 0.1))
        _set(tex, "Bias", p.get("bias", 0))
        _set(tex, "Brick Width", p.get("brickWidth", 0.23))
        _set(tex, "Row Height", p.get("rowHeight", 0.0755))
        _prop(tex, "offset", float(p.get("offset", 0.5)))
        _prop(tex, "offset_frequency", int(p.get("offsetFrequency", 2)))
        _prop(tex, "squash", float(p.get("squash", 1.0)))
        _prop(tex, "squash_frequency", int(p.get("squashFrequency", 2)))
        return tex.outputs["Color"]

    if kind == "checker":
        _set(tex, "Color1", p.get("color1", "#dedad2"))
        _set(tex, "Color2", p.get("color2", "#cbc6bc"))
        size = p.get("tileSize")
        _set(tex, "Scale", p.get("scale", (1.0 / size) if size else 1.0))
        return tex.outputs["Color"]

    # noise / voronoi / wave / gradient / magic emit a FACTOR, not a colour. A ColorRamp maps it onto the
    # two colours the file names — without it every one of them renders as grey static.
    if kind == "noise":
        _set(tex, "Scale", p.get("scale", 20))
        _set(tex, "Detail", p.get("detail", 4))
        _set(tex, "Roughness", p.get("roughness", 0.5))
        _set(tex, "Lacunarity", p.get("lacunarity", 2))
        _set(tex, "Distortion", p.get("distortion", 0))
        _prop(tex, "noise_dimensions", str(p.get("noiseDimensions", "3D")))
    elif kind == "voronoi":
        _set(tex, "Scale", p.get("scale", 10))
        _set(tex, "Detail", p.get("detail", 0))
        _set(tex, "Roughness", p.get("roughness", 0.5))
        _set(tex, "Lacunarity", p.get("lacunarity", 2))
        _set(tex, "Randomness", p.get("randomness", 1))
        _prop(tex, "voronoi_dimensions", str(p.get("voronoiDimensions", "3D")))
        _prop(tex, "feature", str(p.get("feature", "F1")))
        _prop(tex, "distance", str(p.get("distance", "EUCLIDEAN")))
    elif kind == "wave":
        _set(tex, "Scale", p.get("scale", 5))
        _set(tex, "Distortion", p.get("distortion", 0))
        _set(tex, "Detail", p.get("detail", 2))
        _set(tex, "Detail Scale", p.get("detailScale", 1))
        _set(tex, "Detail Roughness", p.get("detailRoughness", 0.5))
        _set(tex, "Phase Offset", p.get("phaseOffset", 0))
        _prop(tex, "wave_type", str(p.get("waveType", "BANDS")))
        _prop(tex, "bands_direction", str(p.get("bandsDirection", "X")))
        _prop(tex, "wave_profile", str(p.get("waveProfile", "SIN")))

    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-380, 0)
    ramp.color_ramp.elements[0].color = _rgba(p.get("colorA", "#b6b4ae"))
    ramp.color_ramp.elements[1].color = _rgba(p.get("colorB", "#9a978f"))
    out = tex.outputs.get("Fac") or tex.outputs.get("Color") or tex.outputs[0]
    tree.links.new(out, ramp.inputs["Fac"])
    return ramp.outputs["Color"]


def _tint_toward(tree, color_out, tint_hex):
    """Keep the procedural's VARIATION but move its colour to the tint. Overwriting the base colour would
    throw the grain away, which is the whole reason the recipe exists, and a Hue/Saturation node cannot
    reach an arbitrary hex. A `COLOR` mix takes hue and saturation from the tint and VALUE from the
    texture, so the pattern survives as luminance and the surface lands on the colour asked for."""
    mix = tree.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "COLOR"
    mix.location = (-200, 0)
    mix.inputs["Fac"].default_value = 1.0
    tree.links.new(color_out, mix.inputs["Color1"])
    mix.inputs["Color2"].default_value = _rgba(tint_hex)
    return mix.outputs["Color"]


def _image_maps(tree, definition, bsdf, base_dir):
    """Wire a material's bitmaps, when it ships any. Returns True if it did.

    Image maps are the one thing a procedural cannot be: a GLB can carry them, and a viewer with no shader
    graph can read them. They go through the UV layer rather than world Position — `render_plan.py` writes a
    metre-scaled planar UV for exactly this — with a Mapping scale of 1/`scale`, so `scale: 2` means the
    bitmap covers two metres. `base_dir` is where the files were prefetched to; without it a material with
    maps quietly falls back to its procedural, because a missing image renders as flat magenta."""
    maps = definition.get("maps") or {}
    if not maps or not base_dir:
        return False
    resolved = {k: os.path.join(base_dir, v) for k, v in maps.items()
                if isinstance(v, str) and os.path.isfile(os.path.join(base_dir, v))}
    if not resolved:
        return False

    scale = float(maps.get("scale", 1.0)) or 1.0
    uvmap = tree.nodes.new("ShaderNodeUVMap")
    uvmap.uv_map = "UVMap"
    uvmap.location = (-1200, -200)
    mapping = tree.nodes.new("ShaderNodeMapping")
    mapping.location = (-1000, -200)
    mapping.inputs["Scale"].default_value = (1.0 / scale, 1.0 / scale, 1.0)
    tree.links.new(uvmap.outputs["UV"], mapping.inputs["Vector"])

    def image(path, colorspace, y):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(path, check_existing=True)
        node.image.colorspace_settings.name = colorspace
        node.location = (-760, y)
        tree.links.new(mapping.outputs["Vector"], node.inputs["Vector"])
        return node

    if "baseColor" in resolved:
        tree.links.new(image(resolved["baseColor"], "sRGB", 200).outputs["Color"], bsdf.inputs["Base Color"])
    if "roughness" in resolved:
        tree.links.new(image(resolved["roughness"], "Non-Color", -40).outputs["Color"], bsdf.inputs["Roughness"])
    if "metallic" in resolved:
        tree.links.new(image(resolved["metallic"], "Non-Color", -280).outputs["Color"], bsdf.inputs["Metallic"])
    if "normal" in resolved:
        nmap = tree.nodes.new("ShaderNodeNormalMap")
        nmap.location = (-480, -520)
        nmap.inputs["Strength"].default_value = float(maps.get("normalStrength", 1.0))
        tree.links.new(image(resolved["normal"], "Non-Color", -520).outputs["Color"], nmap.inputs["Color"])
        tree.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return True


def material_from_def(definition, fallback_hex="#94a3b8", name=None, tint=None, emissive_kelvin=None, base_dir=None):
    """A Blender material for one `material/1` definition. Cached by (id, tint, kelvin) so five parts
    naming the same linen share one material with five users rather than five copies."""
    definition = definition or {}
    key = (definition.get("id") or name or fallback_hex, tint or "", str(emissive_kelvin or ""))
    hit = _cache.get(key)
    if hit and hit.name in bpy.data.materials:
        return hit

    mat = bpy.data.materials.new(name or definition.get("title") or definition.get("id") or "BP material")
    mat.use_nodes = True
    tree = mat.node_tree
    bsdf = tree.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = tree.nodes.get("Material Output") or tree.nodes.new("ShaderNodeOutputMaterial")
        tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    pbr = definition.get("pbr") or {}
    base_hex = tint or pbr.get("baseColor") or fallback_hex

    # Bitmaps win over the recipe when a material ships them — they are strictly more information, and the
    # only form a GLB or a graph-less viewer can read.
    # A mapped material ignores `tint`: tinting exists to make one recipe serve several colours, and a
    # bitmap already IS the colour.
    color_out = None if _image_maps(tree, definition, bsdf, base_dir) else _build_texture(tree, definition)
    if color_out is not None and tint:
        color_out = _tint_toward(tree, color_out, tint)
    if color_out is not None:
        tree.links.new(color_out, bsdf.inputs["Base Color"])
    elif not bsdf.inputs["Base Color"].is_linked:
        _set(bsdf, "Base Color", base_hex)

    _set(bsdf, "Roughness", pbr.get("roughness", 0.6))
    _set(bsdf, "Metallic", pbr.get("metallic", 0))
    if "ior" in pbr:
        _set(bsdf, "IOR", pbr["ior"])
    if "transmission" in pbr:
        if not _set(bsdf, "Transmission Weight", pbr["transmission"]):
            _set(bsdf, "Transmission", pbr["transmission"])
    if "sheen" in pbr:
        if _set(bsdf, "Sheen Weight", pbr["sheen"]) and "sheenTint" in pbr:
            _set(bsdf, "Sheen Tint", pbr["sheenTint"])

    emission = definition.get("emission")
    if emission:
        kelvin = emissive_kelvin or emission.get("kelvin", 2800)
        # cd/m² -> W/(m²·sr). 683 lm/W is the photometric constant; the Principled's Emission Strength is
        # a radiance multiplier on the colour, so this is the honest conversion rather than a magic number.
        strength = float(emission.get("luminance", 1500)) / 683.0
        rgb = kelvin_rgb(kelvin)
        if not _set(bsdf, "Emission Color", list(rgb) + [1.0]):
            _set(bsdf, "Emission", list(rgb) + [1.0])
        _set(bsdf, "Emission Strength", strength)
        mat["bp_emissive_kelvin"] = float(kelvin)

    if pbr.get("transmission"):
        mat.blend_method = "BLEND" if hasattr(mat, "blend_method") else mat.blend_method
    mat.diffuse_color = _rgba(base_hex)          # the solid-shading fallback, and what a viewport preview uses
    mat["bp_material"] = definition.get("id") or ""
    _cache[key] = mat
    return mat


def flat_material(color_hex, alpha=1.0, name=None):
    """The no-recipe fallback: a row whose material could not be resolved keeps its own baked colour."""
    key = ("flat", color_hex, str(alpha))
    hit = _cache.get(key)
    if hit and hit.name in bpy.data.materials:
        return hit
    mat = bpy.data.materials.new(name or f"BP {color_hex}")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        _set(bsdf, "Base Color", color_hex)
        _set(bsdf, "Roughness", 0.65)
        if alpha < 1:
            _set(bsdf, "Alpha", alpha)
    mat.diffuse_color = _rgba(color_hex, alpha)
    _cache[key] = mat
    return mat
