"""Builds bed_python_textures.json = bed_python.json + a `materials` block of procedural shader graphs.

materials.graphs (format "matgraph/1"): { "<material key a mesh names>": { "nodes": [...], "links": [...] } }
  node : {"id", "type": <Blender bl_idname>, "props": {attr: value}, "inputs": {socket name | index: value}}
  link : [fromId, fromSocket, toId, toSocket]      (socket = name or integer index)
  value "$color" = the mesh's colour, so the object's colour params still drive the render.
Texture space = Object coordinates in metres (the generator emits no UVs), so scales are real-world: 120 = 120 per m.
Any loader that knows matgraph/1 (load_pyobject.py) renders it with no object-specific code."""
import json


def N(id, type, inputs=None, **props):
    return {"id": id, "type": type, "props": props, "inputs": inputs or {}}


def coords():
    return [N("tc", "ShaderNodeTexCoord"), N("map", "ShaderNodeMapping")], [["tc", "Object", "map", "Vector"]]


def tint(src, lo, hi):
    """Colour variation: $color with its value scaled into [lo, hi] by a texture factor."""
    return [N("rng", "ShaderNodeMapRange", {"To Min": lo, "To Max": hi}),
            N("hsv", "ShaderNodeHueSaturation", {"Color": "$color"})], \
           [[src[0], src[1], "rng", "Value"], ["rng", "Result", "hsv", "Value"]]


def out(bsdf_inputs):
    return [N("bsdf", "ShaderNodeBsdfPrincipled", bsdf_inputs), N("out", "ShaderNodeOutputMaterial")], \
           [["hsv", "Color", "bsdf", "Base Color"], ["bump", "Normal", "bsdf", "Normal"], ["bsdf", "BSDF", "out", "Surface"]]


def graph(*parts):
    n, l = [], []
    for a, b in parts:
        n += a
        l += b
    return {"nodes": n, "links": l}


def woven(scale, bump, rough, sheen, slub=0.0, lo=0.92, hi=1.03):
    """Plain weave: two perpendicular sine bands multiplied, plus a large soft noise for wash variation."""
    nodes = [N("warp", "ShaderNodeTexWave", {"Scale": scale, "Distortion": 0.6 + slub, "Detail": 2}, wave_type="BANDS", bands_direction="X", wave_profile="SIN"),
             N("weft", "ShaderNodeTexWave", {"Scale": scale, "Distortion": 0.6 + slub, "Detail": 2}, wave_type="BANDS", bands_direction="Y", wave_profile="SIN"),
             N("mul", "ShaderNodeMath", {}, operation="MULTIPLY"),
             N("big", "ShaderNodeTexNoise", {"Scale": 6.0, "Detail": 4, "Roughness": 0.6}),
             N("bump", "ShaderNodeBump", {"Strength": bump, "Distance": 0.0006})]
    links = [["map", "Vector", "warp", "Vector"], ["map", "Vector", "weft", "Vector"], ["warp", "Fac", "mul", 0], ["weft", "Fac", "mul", 1],
             ["mul", "Value", "bump", "Height"], ["tc", "Object", "big", "Vector"]]
    return graph(coords(), (nodes, links), tint(("big", "Fac"), lo, hi),
                 out({"Roughness": rough, "Sheen Weight": sheen, "Sheen Roughness": 0.45, "Specular IOR Level": 0.25}))


def boucle():
    """Looped yarn: inverted smooth voronoi cells as bumps + fine noise, strong bump, very matte."""
    nodes = [N("vor", "ShaderNodeTexVoronoi", {"Scale": 180.0, "Randomness": 1.0}, feature="SMOOTH_F1"),
             N("inv", "ShaderNodeMath", {0: 1.0}, operation="SUBTRACT"),
             N("fine", "ShaderNodeTexNoise", {"Scale": 500.0, "Detail": 3}),
             N("add", "ShaderNodeMath", {}, operation="ADD"),
             N("bump", "ShaderNodeBump", {"Strength": 1.0, "Distance": 0.003})]
    links = [["map", "Vector", "vor", "Vector"], ["vor", "Distance", "inv", 1], ["map", "Vector", "fine", "Vector"],
             ["inv", "Value", "add", 0], ["fine", "Fac", "add", 1], ["add", "Value", "bump", "Height"]]
    return graph(coords(), (nodes, links), tint(("vor", "Distance"), 1.04, 0.86),
                 out({"Roughness": 0.97, "Sheen Weight": 0.35, "Sheen Roughness": 0.6, "Specular IOR Level": 0.15}))


def velvet():
    """Pile fabric: no weave, strong sheen, crushed-pile noise shading the colour."""
    nodes = [N("big", "ShaderNodeTexNoise", {"Scale": 14.0, "Detail": 6, "Roughness": 0.65, "Distortion": 0.8}),
             N("fine", "ShaderNodeTexNoise", {"Scale": 1500.0, "Detail": 1}),
             N("bump", "ShaderNodeBump", {"Strength": 0.12, "Distance": 0.0003})]
    links = [["tc", "Object", "big", "Vector"], ["map", "Vector", "fine", "Vector"], ["fine", "Fac", "bump", "Height"]]
    return graph(coords(), (nodes, links), tint(("big", "Fac"), 0.78, 1.12),
                 out({"Roughness": 0.7, "Sheen Weight": 1.0, "Sheen Roughness": 0.3, "Sheen Tint": [1, 0.9, 0.82, 1], "Specular IOR Level": 0.2}))


def wool_knit():
    """Chunky rib knit: ribs along the runner times stretched voronoi stitches, fuzz on top."""
    nodes = [N("rib", "ShaderNodeTexWave", {"Scale": 55.0, "Distortion": 1.2, "Detail": 3}, wave_type="BANDS", bands_direction="X", wave_profile="SIN"),
             N("mapV", "ShaderNodeMapping", {"Scale": [0.5, 1.6, 1.6]}),
             N("vor", "ShaderNodeTexVoronoi", {"Scale": 110.0}, feature="SMOOTH_F1"),
             N("mix", "ShaderNodeMath", {}, operation="MULTIPLY"),
             N("fuzz", "ShaderNodeTexNoise", {"Scale": 700.0, "Detail": 2}),
             N("add", "ShaderNodeMath", {1: 0.25}, operation="MULTIPLY_ADD"),
             N("bump", "ShaderNodeBump", {"Strength": 0.9, "Distance": 0.003})]
    links = [["tc", "Object", "rib", "Vector"], ["tc", "Object", "mapV", "Vector"], ["mapV", "Vector", "vor", "Vector"],
             ["rib", "Fac", "mix", 0], ["vor", "Distance", "mix", 1], ["tc", "Object", "fuzz", "Vector"],
             ["fuzz", "Fac", "add", 0], ["mix", "Value", "add", 2], ["add", "Value", "bump", "Height"]]
    return graph(coords(), (nodes, links), tint(("mix", "Value"), 0.6, 1.0),
                 out({"Roughness": 0.95, "Sheen Weight": 0.5, "Sheen Roughness": 0.5, "Specular IOR Level": 0.1}))


def oak():
    """Light oak: noise-distorted rings stretched along X for grain, fine pores in the bump, satin coat."""
    nodes = [N("mapG", "ShaderNodeMapping", {"Scale": [1.5, 30.0, 30.0]}),
             N("grain", "ShaderNodeTexWave", {"Scale": 1.4, "Distortion": 6.0, "Detail": 4, "Detail Scale": 1.5}, wave_type="RINGS", rings_direction="X", wave_profile="SAW"),
             N("mapP", "ShaderNodeMapping", {"Scale": [0.08, 1, 1]}),
             N("pore", "ShaderNodeTexNoise", {"Scale": 1200.0, "Detail": 1}),
             N("add", "ShaderNodeMath", {1: 0.15}, operation="MULTIPLY_ADD"),
             N("bump", "ShaderNodeBump", {"Strength": 0.18, "Distance": 0.0004})]
    links = [["tc", "Object", "mapG", "Vector"], ["mapG", "Vector", "grain", "Vector"], ["tc", "Object", "mapP", "Vector"],
             ["mapP", "Vector", "pore", "Vector"], ["pore", "Fac", "add", 0], ["grain", "Fac", "add", 2], ["add", "Value", "bump", "Height"]]
    return graph(([N("tc", "ShaderNodeTexCoord")], []), (nodes, links), tint(("grain", "Fac"), 1.08, 0.8),
                 out({"Roughness": 0.42, "Coat Weight": 0.15, "Coat Roughness": 0.25}))


MATERIALS = {
    "Fabric/boucle.json": boucle(),
    "Finishes/light-oak.json": oak(),
    "Fabric/cotton-sateen.json": woven(450.0, 0.25, 0.62, 0.3, lo=0.94, hi=1.0),
    "Fabric/cotton.json": woven(320.0, 0.4, 0.8, 0.45, lo=0.88, hi=1.02),
    "Fabric/linen.json": woven(260.0, 0.35, 0.86, 0.3, slub=1.2, lo=0.93, hi=1.02),
    "Fabric/velvet.json": velvet(),
    "Fabric/wool.json": wool_knit(),
}

if __name__ == "__main__":
    d = json.load(open("bed_python.json"))
    d["meta"] = {**d.get("meta", {}), "name": "Bed (Python + textures)"}
    d["description"] = (d.get("description", "") + " Carries procedural shader graphs (materials, matgraph/1) that Blender "
                        "builds on load; the editor ignores them and shows the per-mesh colours.").strip()
    d["materials"] = {"format": "matgraph/1", "space": "object-metres", "graphs": MATERIALS}
    json.dump(d, open("bed_python_textures.json", "w"), indent=1)
    print("written", len(json.dumps(d)))
