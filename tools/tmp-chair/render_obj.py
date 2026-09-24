# blender -b --python render_obj.py -- <in.obj> <out.png> [camera: front|side|back|top] [samples]
# A look-dev check of the chair mesh only: Cycles CPU (EEVEE Next renders magenta headless), smooth by
# angle so the rings read as surfaces, cream faux leather + light oak roughly as the library defines them.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
src, out = argv[0], argv[1]
view = argv[2] if len(argv) > 2 else "front"
samples = int(argv[3]) if len(argv) > 3 else 64

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src, forward_axis="Y", up_axis="Z")

def mat_leather():
    m = bpy.data.materials.new("leather-cream"); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.80, 0.73, 0.62, 1)
    b.inputs["Roughness"].default_value = 0.48
    b.inputs["Coat Weight"].default_value = 0.2
    b.inputs["Coat Roughness"].default_value = 0.3
    b.inputs["Subsurface Weight"].default_value = 0.08
    vor = nt.nodes.new("ShaderNodeTexVoronoi"); vor.inputs["Scale"].default_value = 420
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m

def mat_oak():
    m = bpy.data.materials.new("light-oak"); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    wave = nt.nodes.new("ShaderNodeTexWave"); wave.wave_type = "BANDS"; wave.bands_direction = "Z"
    wave.inputs["Scale"].default_value = 9; wave.inputs["Distortion"].default_value = 11; wave.inputs["Detail"].default_value = 3
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.58, 0.40, 0.22, 1)
    ramp.color_ramp.elements[1].color = (0.74, 0.55, 0.33, 1)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.42
    b.inputs["Coat Weight"].default_value = 0.2
    return m

L, O = mat_leather(), mat_oak()
for ob in list(bpy.context.scene.objects):
    if ob.type != "MESH": continue
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.remove_doubles(threshold=0.00005)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(50))
    ob.select_set(False)
    ob.data.materials.clear()
    ob.data.materials.append(O if ob.name.startswith("Legs") else L)

# floor + back wall, warm neutral
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
fl = bpy.context.object; fm = bpy.data.materials.new("floor"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.62, 0.52, 0.42, 1)
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
fl.data.materials.append(fm)
bpy.ops.mesh.primitive_plane_add(size=12, location=(-1.4, 0, 3), rotation=(0, math.radians(90), 0))
wl = bpy.context.object; wm = bpy.data.materials.new("wall"); wm.use_nodes = True
wm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.86, 0.82, 0.76, 1)
wl.data.materials.append(wm)

world = bpy.data.worlds.new("w"); bpy.context.scene.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.9, 0.88, 0.85, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
bpy.ops.object.light_add(type="AREA", location=(1.6, -1.8, 2.2))
k = bpy.context.object; k.data.energy = 260; k.data.size = 1.6
k.rotation_euler = (Vector((0, 0, 0.5)) - k.location).to_track_quat("-Z", "Y").to_euler()
bpy.ops.object.light_add(type="AREA", location=(1.8, 1.6, 1.4))
f = bpy.context.object; f.data.energy = 90; f.data.size = 2.0
f.rotation_euler = (Vector((0, 0, 0.5)) - f.location).to_track_quat("-Z", "Y").to_euler()

cams = {
    "front": ((1.55, -0.75, 1.05), (0.0, 0.0, 0.47), 40),
    "side": ((0.0, -1.9, 0.75), (0.0, 0.0, 0.45), 40),
    "back": ((-1.3, -1.0, 1.25), (0.0, 0.0, 0.5), 40),
    "top": ((0.9, -0.4, 1.9), (0.0, 0.0, 0.5), 40),
}
loc, tgt, lens = cams[view]
bpy.ops.object.camera_add(location=loc)
cam = bpy.context.object; cam.data.lens = lens
cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
sc = bpy.context.scene; sc.camera = cam
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = samples
sc.cycles.use_denoising = True
sc.render.resolution_x = 760; sc.render.resolution_y = 960
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Base Contrast"
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDERED", out)
