"""NE bedroom — soft goods pass: cloth-simulated duvet, knit throw, pressure-inflated pillows and
cushions, then the final cameras.   blender -b ne_bedroom.blend -P ne_soft_goods.py -- <out.blend> <all.json>

Collider rule (model-soft-goods-and-edges): the exported loft mattress is not a closed shell, so the
duvet drapes over a hidden PROXY box, and every sim is bbox-checked after freezing."""
import bpy, bmesh, sys, os, json, math, random
from mathutils import Vector, Matrix, Euler

argv = sys.argv[sys.argv.index("--") + 1:]
OUT_BLEND = os.path.abspath(argv[0])
MATS = json.load(open(argv[1], encoding="utf8"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bp_materials as bpm

random.seed(11)
sc = bpy.context.scene
LOG = lambda *a: print("[soft]", *a)
PRO = bpy.data.collections["NE Bedroom · Pro"]
SH = 0.04                                    # bed shift from the scene pass


def lib(path, tint=None, name=None):
    d = MATS[path]
    return bpm.material_from_def(d, d.get("pbr", {}).get("baseColor", "#999999"), name or d.get("title"), tint=tint)


def bb(o):
    pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return [round(min(p[i] for p in pts), 3) for i in range(3)] + [round(max(p[i] for p in pts), 3) for i in range(3)]


def link(o):
    PRO.objects.link(o)
    return o


def grid(name, x0, x1, y0, y1, z, nx, ny):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    vs = [[bm.verts.new((x0 + (x1 - x0) * i / nx, y0 + (y1 - y0) * j / ny, z)) for j in range(ny + 1)] for i in range(nx + 1)]
    for i in range(nx):
        for j in range(ny):
            bm.faces.new((vs[i][j], vs[i + 1][j], vs[i + 1][j + 1], vs[i][j + 1]))
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    for p in me.polygons:
        p.use_smooth = True
    return o


def proxy(name, x0, x1, y0, y1, z0, z1):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((x0 + (v.co.x + .5) * (x1 - x0), y0 + (v.co.y + .5) * (y1 - y0), z0 + (v.co.z + .5) * (z1 - z0)))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=0.05, segments=4, affect="EDGES")
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    c = o.modifiers.new("Collision", "COLLISION")
    o.collision.thickness_outer = 0.004
    o.collision.cloth_friction = 8
    o.hide_render = True
    return o


def run_sim(frames):
    sc.frame_start, sc.frame_end = 1, frames
    for f in range(1, frames + 1):
        sc.frame_set(f)


def freeze(o):
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data
    o.modifiers.clear()
    o.data = me
    bpy.data.meshes.remove(old)
    for p in me.polygons:
        p.use_smooth = True


def cloth(o, mass, tension, shear, bend, air, quality=6, dist=0.012, pin=None):
    m = o.modifiers.new("Cloth", "CLOTH")
    s = m.settings
    s.quality, s.mass, s.air_damping = quality, mass, air
    s.tension_stiffness = s.compression_stiffness = tension
    s.shear_stiffness, s.bending_stiffness = shear, bend
    if pin:
        s.vertex_group_mass = pin
        s.pin_stiffness = 1.0
    cs = m.collision_settings
    cs.collision_quality, cs.distance_min, cs.use_self_collision = 4, dist, False
    m.point_cache.frame_start, m.point_cache.frame_end = 1, 250
    return m


def finish(o, thick, subdiv=1):
    s = o.modifiers.new("Solidify", "SOLIDIFY"); s.thickness, s.offset = thick, 1
    d = o.modifiers.new("Subsurf", "SUBSURF"); d.levels = d.render_levels = subdiv


# ─────────────────────────────────────── hide the parametric soft goods this pass replaces
for o in bpy.data.objects:
    if o.type == "MESH" and ("n72" in o.name or "n122" in o.name):
        if any(k in o.name for k in ("Duvet", "Turn-back", "Sheet corners", "Runner", "Cushions", "Pillows", "Throw")):
            o.hide_render = o.hide_viewport = True

# Bed frame after the shift: platform x -0.33..1.67, y -4.32..-2.51; mattress top z 0.50.
BX0, BX1, BY0, BY1, BZ = -0.24 + SH, 1.63 + SH, -4.30, -2.53, 0.50
BYC = (BY0 + BY1) / 2

# ─────────────────────────────────────── duvet
col_bed = proxy("Proxy · mattress", BX0, BX1, BY0, BY1, 0.0, BZ)
col_floor = proxy("Proxy · floor", -1, 4, -6, -1, -0.2, 0.0)
HEAD = BX0 + 0.60                                  # duvet folded back below the pillows
duvet = grid("Bedding · Duvet (cloth)", HEAD, BX1 + 0.34, BY0 - 0.34, BY1 + 0.34, BZ + 0.04, 60, 84)
vg = duvet.vertex_groups.new(name="pin")
vg.add([v.index for v in duvet.data.vertices if v.co.x < HEAD + 0.02 and BY0 + 0.05 < v.co.y < BY1 - 0.05], 1.0, "REPLACE")
cloth(duvet, 0.5, 20, 8, 2.5, 1.5, pin="pin")
run_sim(45)
freeze(duvet)
LOG("duvet bbox", bb(duvet))
# thickness BEFORE anything is dropped on it, and the collider reads the thickened surface
s_ = duvet.modifiers.new("Solidify", "SOLIDIFY"); s_.thickness, s_.offset = 0.035, 1
duvet.modifiers.new("Collision", "COLLISION"); duvet.collision.thickness_outer = 0.006

# the fold-back at the head: a separate turned-down band lying on the mattress
cuff = grid("Bedding · Turn-down (cloth)", HEAD - 0.30, HEAD + 0.02, BY0 - 0.34, BY1 + 0.34, BZ + 0.075, 12, 84)
cloth(cuff, 0.4, 20, 8, 2.0, 1.5)
run_sim(35)
freeze(cuff)
LOG("turn-down bbox", bb(cuff))

# ─────────────────────────────────────── knit throw across the foot, dropped on the frozen duvet
throw = grid("Bedding · Knit throw (cloth)", BX1 - 0.62, BX1 - 0.04, BY0 - 0.42, BY1 + 0.42, BZ + 0.16, 20, 90)
throw.matrix_world = Matrix.Translation((BX1 - 0.33, BYC, 0)) @ Matrix.Rotation(math.radians(-3), 4, "Z") @ Matrix.Translation((-(BX1 - 0.33), -BYC, 0))
cloth(throw, 0.3, 15, 5, 0.6, 1.0, dist=0.008)
run_sim(40)
freeze(throw)
LOG("throw bbox", bb(throw))
duvet.modifiers.remove(duvet.modifiers["Collision"])
d_ = duvet.modifiers.new("Subsurf", "SUBSURF"); d_.levels = d_.render_levels = 1
for o in (col_bed, col_floor):
    o.modifiers.clear(); o.hide_viewport = True

finish(cuff, 0.03); finish(throw, 0.012)

cotton = lib("Materials/Fabric/cotton.json", tint="#f5f1ea", name="Duvet — ivory cotton sateen")
duvet.data.materials.append(cotton); cuff.data.materials.append(cotton)
knit = lib("Materials/Fabric/wool.json", tint="#34302d", name="Throw — charcoal chunky knit")
# knit ribs: a wave bump across the throw
nt = knit.node_tree
bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
wv = nt.nodes.new("ShaderNodeTexWave"); wv.inputs["Scale"].default_value = 110; wv.bands_direction = "Y"
bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.45
tc = nt.nodes.new("ShaderNodeTexCoord")
nt.links.new(tc.outputs["Object"], wv.inputs["Vector"]); nt.links.new(wv.outputs["Fac"], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
throw.data.materials.append(knit)

# ─────────────────────────────────────── pillows and cushions: pressure cloth, inflated at origin
def pillow(name, sx, sy, sz, mat, pressure=8, frames=22):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=12, use_grid_fill=True)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    m = cloth(o, 0.3, 15, 5, 0.1, 1.0, quality=5)
    m.settings.use_pressure, m.settings.uniform_pressure_force = True, pressure
    m.settings.effector_weights.gravity = 0.0
    run_sim(frames)
    freeze(o)
    o.data.materials.append(mat)
    d = o.modifiers.new("Subsurf", "SUBSURF"); d.levels = d.render_levels = 1
    return o


def place(o, loc, tilt_deg, yaw_deg):
    """Cushion's local Z is its thickness: tilt it back toward the headboard (−X) about Y."""
    o.matrix_world = Matrix.Translation(loc) @ Matrix.Rotation(math.radians(yaw_deg), 4, "Z") @ Matrix.Rotation(math.radians(-tilt_deg), 4, "Y") @ o.matrix_world


linen = lib("Materials/Fabric/linen.json", tint="#f3eee6", name="Pillow — white linen")
oat = lib("Materials/Fabric/linen.json", tint="#cfc3b0", name="Sham — oatmeal linen")
rust = lib("Materials/Fabric/velvet.json", tint="#9a4a2a", name="Cushion — rust velvet")
boucle = lib("Materials/Fabric/boucle.json", tint="#e6ddcf", name="Cushion — ivory boucle")

HB = -0.24 + SH                    # headboard front face
for i, dy in enumerate((-0.44, 0.44)):
    p = pillow(f"Bedding · Euro sham {i}", 0.64, 0.64, 0.16, oat)
    place(p, (HB + 0.18, BYC + dy, BZ + 0.35), 72, random.uniform(-3, 3))
for i, dy in enumerate((-0.42, 0.42)):
    p = pillow(f"Bedding · Sleeping pillow {i}", 0.50, 0.72, 0.13, linen, pressure=6)
    place(p, (HB + 0.38, BYC + dy, BZ + 0.24), 38, random.uniform(-4, 4))
for i, (dy, yaw) in enumerate(((-0.30, 6), (0.30, -5))):
    p = pillow(f"Bedding · Accent cushion {i}", 0.45, 0.45, 0.13, rust, pressure=9)
    place(p, (HB + 0.56, BYC + dy, BZ + 0.29), 64, yaw)
p = pillow("Bedding · Lumbar cushion", 0.30, 0.55, 0.12, boucle, pressure=8)
place(p, (HB + 0.72, BYC, BZ + 0.22), 58, 2)
for o in PRO.objects:
    if o.name.startswith("Bedding ·"):
        b = bb(o)
        if b[2] < -0.01 or b[5] > 1.4:
            LOG("!! out of range", o.name, b)

# ─────────────────────────────────────── final cameras (two-point: rotation X exactly 90°)
for n in ("NE Bedroom · Hero", "NE Bedroom · Bed", "NE Bedroom · Window", "NE Bedroom · Reverse"):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o)


def camera(name, loc, yaw, lens, shift_y=0.0, shift_x=0.0):
    cd = bpy.data.cameras.new(name)
    cd.lens, cd.sensor_width, cd.clip_start, cd.shift_y, cd.shift_x = lens, 36, 0.05, shift_y, shift_x
    o = bpy.data.objects.new(name, cd)
    bpy.data.collections["Cameras"].objects.link(o)
    o.location = loc
    o.rotation_euler = (math.radians(90), 0, math.radians(yaw))
    return o


hero = camera("NE Bedroom · Hero", (2.34, -2.26, 1.20), 135, 16, -0.05)
camera("NE Bedroom · Bed", (2.46, BYC, 1.10), 90, 24, -0.06)
camera("NE Bedroom · Reverse", (0.32, -5.00, 1.20), 318, 18, -0.04)   # from the window corner back to wardrobe, desk and art
sc.camera = hero
sc.view_settings.exposure = 0.25
sc.frame_set(1)
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND, compress=True)
LOG("saved", OUT_BLEND)
