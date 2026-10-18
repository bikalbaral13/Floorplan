"""NE bedroom (BEDROOM 3) professional pass — scene, materials, lighting, modelling, cameras, render.

    blender -b out/plan.v2.blend -P ne_bedroom_pass.py -- <out.blend> <materials all.json>

Frame (Blender, right-handed, metres): the architect's north arrow points RIGHT on the sheet, so
north = +X, east = -Y, south = -X, west = +Y. BEDROOM 3 is the north-east bedroom.
Room interior (main rectangle): x -0.37 .. 3.19, y -5.19 .. -1.54. East wall (window + balcony
door) at y = -5.19; bed headboard on the south wall x = -0.37; wardrobe on the north wall x = 3.19.
"""
import bpy, bmesh, sys, os, json, math, random
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND = os.path.abspath(argv[0])
MATS = json.load(open(argv[1], encoding="utf8"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp_materials as bpm

random.seed(7)
sc = bpy.context.scene
LOG = lambda *a: print("[ne]", *a)

ROOM = (-0.37, 3.19, -5.19, -1.54)      # x0 x1 y0 y1 interior faces
BED_SHIFT = 0.04                        # room for the fluted panel behind the headboard


def bb(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [min(p[i] for p in pts) for i in range(3)] + [max(p[i] for p in pts) for i in range(3)]


def objs(*needles, meshes_only=True):
    out = []
    for o in bpy.data.objects:
        if meshes_only and o.type != "MESH":
            continue
        if all(n in o.name for n in needles):
            out.append(o)
    return out


def in_box(o, x0, x1, y0, y1, pad=0.0):
    b = bb(o)
    return b[3] > x0 - pad and b[0] < x1 + pad and b[4] > y0 - pad and b[1] < y1 + pad


def col(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        sc.collection.children.link(c)
    return c


PRO = col("NE Bedroom · Pro")


def lib(path, tint=None, name=None):
    d = MATS[path]
    return bpm.material_from_def(d, d.get("pbr", {}).get("baseColor", "#999999"), name or d.get("title"), tint=tint)


def set_mat(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def principled(name, color, rough=0.5, metal=0.0, coat=0.0, sheen=0.0, sss=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    c = [pow(int(color[i:i + 2], 16) / 255, 2.2) for i in (1, 3, 5)]
    b.inputs["Base Color"].default_value = (*c, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    b.inputs["Coat Weight"].default_value = coat
    b.inputs["Sheen Weight"].default_value = sheen
    b.inputs["Subsurface Weight"].default_value = sss
    return m


def add_bevel(o, width=0.006, segs=2, angle=35, harden=True):
    if o.type != "MESH" or any(m.type == "BEVEL" for m in o.modifiers):
        return
    m = o.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method = width, segs, "ANGLE"
    m.angle_limit = math.radians(angle)
    m.use_clamp_overlap = True
    m.harden_normals = harden
    if harden:
        for p in o.data.polygons:
            p.use_smooth = True


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.006, segs=2, coll=PRO):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0)
        v.co.y = y0 + (v.co.y + 0.5) * (y1 - y0)
        v.co.z = z0 + (v.co.z + 0.5) * (z1 - z0)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o.data.materials.append(mat)
    if bevel:
        add_bevel(o, bevel, segs)
    return o


def cyl(name, cx, cy, z0, z1, r, mat, verts=48, bevel=0.003, coll=PRO, r_top=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r_top is None else r_top, depth=z1 - z0)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(cx, cy, (z0 + z1) / 2))
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    coll.objects.link(o)
    o.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    if bevel:
        add_bevel(o, bevel, 2, 40)
    return o


def xform(o, M):
    o.matrix_world = M @ o.matrix_world


def hide(o):
    o.hide_render = True
    o.hide_viewport = True


# ─────────────────────────────────────────────────────────────────────────────── 1. SCENE PASS
# Columns: structure is plastered in a finished room — no diagram grey, no rebar.
wall_mat = lib("Materials/Finishes/paint-eggshell.json", tint="#e2d9cc", name="Wall — warm greige eggshell")
ceil_mat = lib("Materials/Finishes/plaster.json", tint="#f4f1ea", name="Ceiling — warm white plaster")
for o in objs("Column ·"):
    if "Main bars" in o.name or "Stirrups" in o.name:
        hide(o)
    else:
        set_mat(o, wall_mat)

# Walls touching the bedroom → warm greige (the plan's cool plaster white reads as unfinished).
for o in bpy.data.objects:
    if o.type == "MESH" and o.name.startswith("Wall ·") and in_box(o, *ROOM, pad=0.3):
        set_mat(o, wall_mat)
for o in objs("False Ceiling", "BEDROOM 3"):
    if "LED" not in o.name:
        set_mat(o, ceil_mat)

# The duplicate bedding set (Bedding n122) interpenetrates the bed's own duvet — keep the bed's.
for o in objs("n122"):
    if any(k in o.name for k in ("Duvet", "Turn-back", "Throw")):
        hide(o)

# Bed + remaining bedding forward by the panel depth.
for o in objs("n72") + objs("n122"):
    xform(o, Matrix.Translation((BED_SHIFT, 0, 0)))

# Chair tucked under the desk, clear of the pedestal (it stood in front of the hero lens).
for o in objs("Chair", "n129"):
    xform(o, Matrix.Translation((0.20, 0.35, 0)))

# Curtains: blackout off, drape gathered into two stacks at the window edges (17 %).
for o in objs("Curtain", "n130"):
    if "Blackout" in o.name:
        hide(o)
drape = objs("Curtain · Drape", "n130")[0]
b = bb(drape)
sheer = lib("Materials/Fabric/linen.json", tint="#efe8dc", name="Curtain — ivory linen")
set_mat(drape, sheer)
twin = drape.copy(); twin.data = drape.data.copy(); drape.users_collection[0].objects.link(twin)
xform(drape, Matrix.Translation((b[0], 0, 0)) @ Matrix.Diagonal((0.17, 1, 1, 1)) @ Matrix.Translation((-b[0], 0, 0)))
xform(twin, Matrix.Translation((b[3], 0, 0)) @ Matrix.Diagonal((0.17, 1, 1, 1)) @ Matrix.Translation((-b[3], 0, 0)))
twin.name = "Curtain · Drape (right stack) · n130"

# Architectural glass: camera sees a reflective pane, every other ray passes straight through.
def arch_glass():
    m = bpy.data.materials.new("Glass — architectural")
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    lp = nt.nodes.new("ShaderNodeLightPath")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr2 = nt.nodes.new("ShaderNodeBsdfTransparent")
    tr2.inputs[0].default_value = (0.92, 0.95, 0.94, 1)
    gl = nt.nodes.new("ShaderNodeBsdfGlossy"); gl.inputs["Roughness"].default_value = 0.02
    fr = nt.nodes.new("ShaderNodeFresnel"); fr.inputs["IOR"].default_value = 1.52
    inner = nt.nodes.new("ShaderNodeMixShader")
    outer = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(fr.outputs[0], inner.inputs[0]); nt.links.new(tr2.outputs[0], inner.inputs[1]); nt.links.new(gl.outputs[0], inner.inputs[2])
    nt.links.new(lp.outputs["Is Camera Ray"], outer.inputs[0])
    nt.links.new(tr.outputs[0], outer.inputs[1]); nt.links.new(inner.outputs[0], outer.inputs[2])
    nt.links.new(outer.outputs[0], o.inputs[0])
    return m
AG = arch_glass()
for o in bpy.data.objects:
    if o.type == "MESH" and "Glazing" in o.name:
        set_mat(o, AG)
        o.visible_shadow = False

# Window frames: dark bronze anodised aluminium, never marble.
bronze = lib("Materials/Metal/aluminium-anodised.json", tint="#3b332b", name="Frame — dark bronze anodised")
for o in bpy.data.objects:
    if o.type == "MESH" and o.name.startswith("Window · Frame"):
        set_mat(o, bronze)
sill_mat = lib("Materials/Finishes/quartz.json", tint="#ede7dc", name="Sill — ivory quartz")
for o in objs("Window · Sill"):
    set_mat(o, sill_mat)

# Sanitaryware that fell through to diagram greys → glazed ceramic.
ceramic = lib("Materials/Finishes/ceramic.json", tint="#f6f5f1", name="Sanitary — white vitreous china")
for o in bpy.data.objects:
    if o.type == "MESH" and (o.name.startswith("Toilet ·") or o.name.startswith("Washbasin ·")) and o.active_material and o.active_material.name.startswith("BP #"):
        set_mat(o, ceramic)

# Exterior context seen through the glass.
for o in objs("Exterior Context"):
    set_mat(o, lib("Materials/Site/grass.json") if "Ground" in o.name else lib("Materials/Masonry/concrete.json", tint="#d8d2c6"))

# Wall art: 2.0 m on a 1.71 m wall ran into the north wall; 1.2 m centred over the desk, with a print.
art = objs("Wall Art", "seg-026")
cx = (1.48 + 3.19) / 2 + 0.05
for o in art:
    xform(o, Matrix.Translation((cx, 0, 0)) @ Matrix.Diagonal((0.62, 1, 1, 1)) @ Matrix.Translation((-(1.4 + 3.4) / 2, 0, 0)))
def print_mat():
    m = bpy.data.materials.new("Art — abstract print on cotton rag")
    m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.4, 1.4, 1.4)
    wv = nt.nodes.new("ShaderNodeTexWave"); wv.wave_type = "RINGS"; wv.inputs["Scale"].default_value = 0.9
    wv.inputs["Distortion"].default_value = 5.5; wv.inputs["Detail"].default_value = 1.5
    cr = nt.nodes.new("ShaderNodeValToRGB")
    e = cr.color_ramp.elements
    e[0].position, e[0].color = 0.25, (0.62, 0.30, 0.16, 1)
    e[1].position, e[1].color = 0.75, (0.93, 0.88, 0.80, 1)
    mid = e.new(0.5); mid.color = (0.78, 0.66, 0.50, 1)
    nt.links.new(tc.outputs["Object"], mp.inputs[0]); nt.links.new(mp.outputs[0], wv.inputs[0])
    nt.links.new(wv.outputs["Fac"], cr.inputs[0]); nt.links.new(cr.outputs[0], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.85
    return m
for o in art:
    if "· Art ·" in o.name:
        set_mat(o, print_mat())
    elif "Mats" in o.name:
        set_mat(o, lib("Materials/Finishes/paper.json", tint="#f3efe6"))

# Rug: fringe off; turned 90° and enlarged to sit under the lower two-thirds of the bed.
rug = objs("Rug", "n132")
rb = bb([o for o in rug if "Border" in o.name][0])
oc = Vector(((rb[0] + rb[3]) / 2, (rb[1] + rb[4]) / 2, 0))
new_c = Vector((1.42 + BED_SHIFT, -3.415, 0))
M = Matrix.Translation(new_c) @ Matrix.Rotation(math.radians(90), 4, "Z") @ Matrix.Diagonal((1.2, 1.42, 1, 1)) @ Matrix.Translation(-oc)
pile = lib("Materials/Fabric/rug-pile.json", tint="#d8ccb8", name="Rug — oatmeal wool pile")
edge = lib("Materials/Fabric/rug-pile.json", tint="#4a3a2e", name="Rug — espresso border")
for o in rug:
    if "Fringe" in o.name:
        hide(o); continue
    xform(o, M)
    set_mat(o, edge if "Border" in o.name else pile)
    o.location.z += 0.002

# Skirtings: the plan put them on the wall CENTRELINE (buried in the wall). Hide those and
# run real 18 × 90 mm painted skirtings on the bedroom's interior faces.
for o in objs("Skirting ·"):
    if in_box(o, *ROOM, pad=0.15):
        hide(o)
sk = lib("Materials/Finishes/paint-eggshell.json", tint="#efe9df", name="Skirting — ivory eggshell")
T, H = 0.018, 0.09
x0, x1, y0, y1 = ROOM
for a, b_ in ((y0, -4.99), (-1.83, -1.14)):             # south wall either side of the fluted panel
    box("Skirting · S", x0, x0 + T, a, b_, 0, H, sk, 0.002)
for a, b_ in ((x0, 2.11), (3.05, x1)):                  # east wall, balcony door gap
    box("Skirting · E", a, b_, y0, y0 + T, 0, H, sk, 0.002)
for a, b_ in ((y0, -3.9), (-1.7, y1)):                  # north wall, wardrobe gap
    box("Skirting · N", x1 - T, x1, a, b_, 0, H, sk, 0.002)
box("Skirting · W", 1.5, x1, y1 - T, y1, 0, H, sk, 0.002)

# ─────────────────────────────────────────────────────────────────────────────── 2. MODELLING
# 2a Fluted walnut feature wall behind the bed, brass-trimmed, floor to cove.
walnut = lib("Materials/Finishes/walnut.json", name="Walnut — fluted, vertical grain")
# vertical grain: stretch the texture coordinate along Z (the stock object-space walnut reads as marble)
for n in walnut.node_tree.nodes:
    if n.type == "MAPPING":
        n.inputs["Scale"].default_value = (28, 28, 0.9)
backer = principled("Walnut — backer shadow", "#2a1c14", 0.6)
brass = lib("Materials/Metal/brass-polished.json", name="Brass — polished trim")
PY0, PY1, PZ1 = -4.99, -1.83, 2.60
box("Feature · backer", x0, x0 + 0.012, PY0, PY1, 0, PZ1, backer, 0)
pitch, w = 0.053, 0.045
n = int((PY1 - PY0 - 0.02) // pitch)
start = (PY0 + PY1) / 2 - (n - 1) * pitch / 2
for i in range(n):
    yc = start + i * pitch
    box(f"Feature · flute {i:02d}", x0 + 0.012, x0 + 0.036, yc - w / 2, yc + w / 2, 0.0, PZ1, walnut, 0.009, 3)
for yb in (PY0 - 0.006, PY1 + 0.006):
    box("Feature · brass trim", x0, x0 + 0.04, yb - 0.005, yb + 0.005, 0, PZ1, brass, 0.001)
LOG(f"fluted wall: {n} flutes")

# 2b Nightstands under the two bedside pendants (the plan hangs pendants over nothing).
oak = lib("Materials/Finishes/light-oak.json", name="Oak — nightstand")
ivory = lib("Materials/Finishes/lacquer.json", tint="#eee7da", name="Lacquer — ivory drawer")
stone = lib("Materials/Finishes/marble.json", tint="#e9e3da", name="Stone — nightstand top")
bedx = -0.28 + BED_SHIFT + 0.005               # just in front of the (shifted) headboard
for tag, yc in (("L", -2.26), ("R", -4.57)):
    W, D, Hh = 0.46, 0.40, 0.52
    ya, yb = yc - W / 2, yc + W / 2
    xa, xb = bedx, bedx + D
    box(f"Nightstand {tag} · plinth", xa + 0.03, xb - 0.03, ya + 0.03, yb - 0.03, 0, 0.07, backer, 0.002)
    box(f"Nightstand {tag} · carcass", xa, xb, ya, yb, 0.07, Hh - 0.02, oak, 0.005, 3)
    box(f"Nightstand {tag} · top", xa - 0.005, xb + 0.005, ya - 0.005, yb + 0.005, Hh - 0.02, Hh, stone, 0.004, 3)
    box(f"Nightstand {tag} · drawer", xb, xb + 0.018, ya + 0.02, yb - 0.02, 0.26, Hh - 0.05, ivory, 0.003, 2)
    box(f"Nightstand {tag} · drawer low", xb, xb + 0.018, ya + 0.02, yb - 0.02, 0.09, 0.25, ivory, 0.003, 2)
    for zc in (0.36, 0.17):
        box(f"Nightstand {tag} · pull", xb + 0.018, xb + 0.03, yc - 0.06, yc + 0.06, zc - 0.006, zc + 0.006, brass, 0.002)
    # styling: two books and a stoneware bud vase
    book1 = principled(f"Book cloth {tag}1", "#7b5a43" if tag == "L" else "#5f6b5a", 0.7)
    book2 = principled(f"Book cloth {tag}2", "#d9cdb8", 0.75)
    bx = xa + 0.08
    box(f"Nightstand {tag} · book 1", bx, bx + 0.17, yc - 0.12, yc + 0.11, Hh, Hh + 0.028, book1, 0.003)
    box(f"Nightstand {tag} · book 2", bx + 0.01, bx + 0.155, yc - 0.10, yc + 0.08, Hh + 0.028, Hh + 0.05, book2, 0.003)
    vase = lib("Materials/Finishes/ceramic.json", tint="#b8a58c", name="Stoneware — sand glaze")
    vx, vy = xa + 0.27, yc + (0.12 if tag == "L" else -0.12)
    cyl(f"Nightstand {tag} · vase", vx, vy, Hh, Hh + 0.16, 0.045, vase, 40, 0.004, r_top=0.03)

# 2c A real plant in the pier between window and balcony door (the plan's plant is 108 faces).
for o in objs("Plant Potted", "n133"):
    hide(o)
leafmat = lib("Materials/Organic/foliage.json", tint="#3f5f33", name="Leaf — ficus")
stemmat = lib("Materials/Organic/bark.json", name="Stem — bark")
potmat = lib("Materials/Finishes/terrazzo.json", tint="#d9d2c6", name="Planter — terrazzo")
PX, PY = 1.86, -4.93
cyl("Plant · planter", PX, PY, 0, 0.42, 0.17, potmat, 64, 0.01, r_top=0.19)
cyl("Plant · soil", PX, PY, 0.39, 0.40, 0.175, lib("Materials/Masonry/concrete.json", tint="#3a2e25", name="Soil"), 48, 0)


def leaf_mesh(name, length, width, bend):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    nu, nv = 8, 4
    grid = []
    for i in range(nu + 1):
        t = i / nu
        half = width * 0.5 * math.sin(math.pi * min(1.0, t * 1.08)) ** 0.8
        row = []
        for j in range(nv + 1):
            s = -1 + 2 * j / nv
            x = t * length
            y = s * half
            z = -bend * t * t * length + abs(s) * 0.12 * half   # arch + a cupped midrib
            row.append(bm.verts.new((x, y, z)))
        grid.append(row)
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]))
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


plant_parts = []
golden = math.radians(137.5)
stems = [(PX + 0.02, PY + 0.01, 1.55), (PX - 0.05, PY + 0.04, 1.25), (PX + 0.05, PY - 0.04, 1.05)]
k = 0
for sx, sy, top in stems:
    cyl(f"Plant · stem {k}", sx, sy, 0.40, top, 0.012, stemmat, 10, 0)
    nleaf = int((top - 0.75) / 0.045)
    for i in range(nleaf):
        z = 0.75 + i * (top - 0.75) / nleaf
        L = 0.20 + 0.10 * math.sin(math.pi * i / nleaf) + random.uniform(-0.02, 0.02)
        me = leaf_mesh(f"leaf{k}_{i}", L, L * 0.62, random.uniform(0.15, 0.35))
        o = bpy.data.objects.new(f"Plant · leaf {k}.{i}", me)
        PRO.objects.link(o)
        o.data.materials.append(leafmat)
        yaw = i * golden + k
        pitch = math.radians(random.uniform(-35, -10))
        o.matrix_world = Matrix.Translation((sx, sy, z)) @ Euler((random.uniform(-0.2, 0.2), pitch, yaw), "ZYX").to_matrix().to_4x4()
        s = o.modifiers.new("Solidify", "SOLIDIFY"); s.thickness = 0.0015
    k += 1

# 2d Bevel every hard edge in the room (library objects that are still razor-sharp boxes).
HARD = ("Wardrobe ·", "Desk ·", "Door · Leaf", "Door · Lining", "Window · Sill", "Window · Frame", "Chair ·", "Tv Unit")
for o in bpy.data.objects:
    if o.type == "MESH" and o.name.startswith(HARD) and in_box(o, *ROOM, pad=0.2) and len(o.data.polygons) < 800:
        add_bevel(o, 0.004, 2, 35)

# 2e Soft goods: subdivide the bedding surfaces so the silhouettes are smooth, not faceted.
for o in objs("n72") + objs("n122"):
    if o.hide_render:
        continue
    if any(k in o.name for k in ("Duvet", "Mattress", "Cushions", "Pillows", "Turn-back", "Runner")):
        for p in o.data.polygons:
            p.use_smooth = True
        if len(o.data.polygons) < 3000:
            sd = o.modifiers.new("Subsurf", "SUBSURF"); sd.levels = 1; sd.render_levels = 1
            sd.boundary_smooth = "PRESERVE_CORNERS"

# ─────────────────────────────────────────────────────────────────────────────── 3. LIGHTING
# Daylight: a low MORNING sun through the EAST window, from east-south-east.
az = math.radians(15)                  # travel direction swung 15° toward north (+X)
el = math.radians(20)
travel = Vector((math.sin(az) * math.cos(el), math.cos(az) * math.cos(el), -math.sin(el)))
sun = next(o for o in bpy.data.objects if o.type == "LIGHT" and o.data.type == "SUN")
sun.rotation_mode = "QUATERNION"
sun.rotation_quaternion = travel.to_track_quat("-Z", "Y")
sun.data.energy = 4.5
sun.data.color = (1.0, 0.87, 0.74)
sun.data.angle = math.radians(1.2)
sun.location = (1.0, -12.0, 4.5)

world = sc.world
for n in world.node_tree.nodes:
    if n.type == "TEX_SKY":
        n.sun_disc = False
        n.sun_elevation = el
        src = -travel
        n.sun_rotation = math.atan2(src.x, src.y) % (2 * math.pi)
    if n.type == "BACKGROUND":
        n.inputs["Strength"].default_value = 0.6

# Light portals filling the window and the open balcony door.
def portal(name, xa, xb, za, zb, y):
    ld = bpy.data.lights.new(name, "AREA"); ld.shape = "RECTANGLE"
    ld.size, ld.size_y = xb - xa, zb - za
    ld.cycles.is_portal = True
    o = bpy.data.objects.new(name, ld); PRO.objects.link(o)
    o.location = ((xa + xb) / 2, y, (za + zb) / 2)
    o.rotation_euler = (math.radians(-90), 0, 0)          # -Z → +Y, into the room
    return o
portal("Portal · east window", 0.16, 1.55, 0.95, 2.05, -5.30)
portal("Portal · balcony door", 2.11, 3.01, 0.0, 2.10, -5.32)

# Artificial: warm 3000 K accents; fan point light off (downlights + cove carry the room).
for o in bpy.data.objects:
    if o.type != "LIGHT":
        continue
    if o.name.startswith("Fan light"):
        o.data.energy = 0.0
        o.hide_render = True

# ─────────────────────────────────────────────────────────────────────────────── 4. CAMERAS
def camera(name, loc, yaw, lens, shift_y=0.0):
    cd = bpy.data.cameras.new(name)
    cd.lens, cd.sensor_width, cd.clip_start, cd.shift_y = lens, 36, 0.05, shift_y
    o = bpy.data.objects.new(name, cd)
    col("Cameras").objects.link(o) if bpy.data.collections.get("Cameras") else PRO.objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, math.radians(yaw))     # X = 90° exactly → two-point
    return o

hero = camera("NE Bedroom · Hero", (2.42, -2.28, 1.20), 136, 16, -0.04)
camera("NE Bedroom · Bed", (2.30, -4.90, 1.15), 60, 20, -0.03)
camera("NE Bedroom · Window", (0.05, -1.75, 1.25), 188, 22, -0.02)
sc.camera = hero

# ─────────────────────────────────────────────────────────────────────────────── 5. RENDER
r = sc.render
r.engine = "CYCLES"
cy = sc.cycles
cy.device = "CPU"
cy.samples, cy.time_limit = 256, 200
cy.use_adaptive_sampling, cy.adaptive_threshold, cy.adaptive_min_samples = True, 0.04, 8
cy.use_denoising, cy.denoiser = True, "OPENIMAGEDENOISE"
cy.denoising_input_passes, cy.denoising_prefilter = "RGB_ALBEDO_NORMAL", "ACCURATE"
cy.use_light_tree = True
cy.max_bounces, cy.diffuse_bounces, cy.glossy_bounces = 6, 3, 2
cy.transmission_bounces, cy.transparent_max_bounces, cy.volume_bounces = 4, 8, 0
cy.caustics_reflective = cy.caustics_refractive = False
cy.blur_glossy, cy.sample_clamp_indirect = 1.0, 6
r.resolution_x, r.resolution_y, r.resolution_percentage = 1600, 1000, 100
sc.view_settings.view_transform = "AgX"
sc.view_settings.look = "AgX - Medium High Contrast"
sc.view_settings.exposure = 0.35

bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
LOG("saved", OUT_BLEND)
