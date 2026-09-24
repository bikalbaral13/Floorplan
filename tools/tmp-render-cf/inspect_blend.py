"""inspect_blend.py — read a scene before touching it.

    blender -b <file>.blend -P inspect_blend.py -- [--room "M. BEDROOM"] [--limit 40]

WHY WORLD-SPACE BOUNDING BOXES AND NOT `obj.location`. Geometry that came out of a plan tool has
its coordinates BAKED INTO THE MESH, so almost every object sits at location (0, 0, 0) and the
transform tells you nothing at all. Ask the corners where they are instead. Every number this
prints is world space, in metres.

It changes nothing and saves nothing. Run it first, every time.
"""
import bpy, sys, mathutils
from collections import defaultdict

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def flag(name, default=None):
    if f"--{name}" in argv:
        i = argv.index(f"--{name}")
        if i + 1 < len(argv) and not argv[i + 1].startswith("--"):
            return argv[i + 1]
    return default


ROOM = flag("room")
LIMIT = int(flag("limit", "40"))


def bb(o):
    """World-space [x0, y0, z0, x1, y1, z1], rounded. The whole point of this file."""
    pts = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    return [round(min(p[i] for p in pts), 2) for i in range(3)] + \
           [round(max(p[i] for p in pts), 2) for i in range(3)]


def inside(box, room, pad=0.05):
    """Is a bbox centre within the room's floor plate?"""
    cx, cy = (box[0] + box[3]) / 2, (box[1] + box[4]) / 2
    return room[0] - pad <= cx <= room[3] + pad and room[1] - pad <= cy <= room[4] + pad


meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.data.vertices]
print(f"\n=== {bpy.data.filepath or '(unsaved)'}")
print(f"    {len(bpy.data.objects)} objects, {len(meshes)} meshes, "
      f"{sum(len(o.data.polygons) for o in meshes)} faces, {len(bpy.data.materials)} materials")

# ── collections ───────────────────────────────────────────────────────────────────────────────
print("\n--- collections")
for c in sorted(bpy.data.collections, key=lambda c: -len(c.all_objects)):
    n = len(c.all_objects)
    if n:
        print(f"    {n:5d}  {c.name}")

# ── north, from the north-arrow object ────────────────────────────────────────────────────────
# The arrow's HEAD is the long end of its bbox. Which axis it points along is what "north" means
# for every sun angle and every room name after this, so read it rather than assuming +Y.
north = None
for o in meshes:
    if "north" in o.name.lower():
        b = bb(o)
        dx, dy = b[3] - b[0], b[4] - b[1]
        north = "+Y" if dy >= dx else "+X"
        print(f"\n--- north arrow  {o.name}  bbox {b}  → long axis {north}")
        break
if north is None:
    print("\n--- north arrow  none found — north is an assumption from here on, say so in the report")

# ── rooms, from the floor plates ──────────────────────────────────────────────────────────────
print("\n--- rooms (floor plates)")
rooms = {}
for o in meshes:
    col = o.users_collection[0].name if o.users_collection else ""
    if "space" in col.lower() or "room" in (o.get("bp_object") or "").lower():
        b = bb(o)
        # render_plan.py writes bp_host (the host KIND, "space") and bp_host_id (the id). It does
        # NOT carry the room's label, so a bare bp_host makes every room read "space" and --room
        # can never match. The object NAME is where the label survives, so prefer it.
        label = o.get("bp_host_label") or o.name.split("·")[-1].strip() or o.get("bp_host_id") or o.name
        rooms[label] = b
        print(f"    {label:22s} x {b[0]:7.2f}…{b[3]:6.2f}   y {b[1]:7.2f}…{b[4]:6.2f}   "
              f"{(b[3]-b[0]):.2f} × {(b[4]-b[1]):.2f} m")
if not rooms:
    print("    none — no Spaces collection; fall back to the wall extents")

# ── what is in the room ───────────────────────────────────────────────────────────────────────
if ROOM:
    key = next((k for k in rooms if k.strip().lower() == ROOM.strip().lower()), None) \
        or next((k for k in rooms if ROOM.strip().lower() in k.lower()), None)
    if not key:
        print(f"\n!!! no room matches {ROOM!r}. Have: {', '.join(rooms) or '(none)'}")
    else:
        r = rooms[key]
        print(f"\n--- inside {key}   (ceiling candidates are the z maxima below)")
        hits = [(o, bb(o)) for o in meshes if inside(bb(o), r)]
        hits.sort(key=lambda t: -(t[1][3] - t[1][0]) * (t[1][4] - t[1][1]))
        for o, b in hits[:LIMIT]:
            mat = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else "—"
            print(f"    {o.name[:34]:34s} z {b[2]:6.2f}…{b[5]:5.2f}  "
                  f"{(b[3]-b[0]):5.2f} × {(b[4]-b[1]):5.2f} m  hide_render={int(o.hide_render)}  {mat[:24]}")
        if len(hits) > LIMIT:
            print(f"    … {len(hits) - LIMIT} more (raise --limit)")

# ── lights ────────────────────────────────────────────────────────────────────────────────────
print("\n--- lights")
by_kind = defaultdict(list)
for o in bpy.data.objects:
    if o.type == "LIGHT":
        by_kind[o.data.type].append(o)
for kind, objs in sorted(by_kind.items()):
    tot = sum(o.data.energy for o in objs)
    print(f"    {kind:6s} ×{len(objs):3d}   total {tot:9.1f} W   "
          f"range {min(o.data.energy for o in objs):.2f}…{max(o.data.energy for o in objs):.2f}")
    for o in objs[:4]:
        c = tuple(round(v, 2) for v in o.data.color)
        print(f"           {o.name[:40]:40s} {o.data.energy:8.2f} W  rgb {c}  at "
              f"{tuple(round(v,2) for v in o.matrix_world.translation)}")
    if len(objs) > 4:
        print(f"           … {len(objs) - 4} more")
if not by_kind:
    print("    NONE — the render will be black and will still exit 0")

# ── world ─────────────────────────────────────────────────────────────────────────────────────
w = bpy.context.scene.world
print("\n--- world")
if w and w.use_nodes:
    for n in w.node_tree.nodes:
        if n.type in ("TEX_SKY", "BACKGROUND"):
            extra = ""
            if n.type == "TEX_SKY":
                extra = f" sky_type={n.sky_type} sun_disc={getattr(n, 'sun_disc', '?')} " \
                        f"elev={round(getattr(n, 'sun_elevation', 0) * 57.2958, 1)}°"
            st = n.inputs.get("Strength")
            print(f"    {n.type:12s}{extra}{'  strength=' + str(round(st.default_value, 3)) if st else ''}")
else:
    print("    no world nodes — no ambient, interiors will be very dark")

# ── cameras ───────────────────────────────────────────────────────────────────────────────────
print("\n--- cameras")
for o in bpy.data.objects:
    if o.type == "CAMERA":
        rot = tuple(round(a * 57.2958, 1) for a in o.rotation_euler)
        lens = f"ORTHO scale {o.data.ortho_scale:.2f}" if o.data.type == "ORTHO" else f"{o.data.lens:.0f} mm"
        print(f"    {o.name[:40]:40s} {lens:18s} at {tuple(round(v,2) for v in o.matrix_world.translation)} "
              f"rot {rot}  shift_y {o.data.shift_y:+.3f}")
print(f"    scene.camera = {bpy.context.scene.camera.name if bpy.context.scene.camera else 'NONE'}")

# ── materials worth a second look ─────────────────────────────────────────────────────────────
# A plan export gets these wrong in the same way every time: a screen wearing timber, a frame
# wearing stone, leaves wearing bark. Print what each material actually IS so the mismatches show.
print("\n--- materials (surface + first texture)")
for m in sorted(bpy.data.materials, key=lambda m: m.name)[:LIMIT]:
    users = sum(1 for o in meshes for s in o.material_slots if s.material is m)
    if not users:
        continue
    surf, tex = "—", "—"
    if m.use_nodes:
        out = next((n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if out and out.inputs["Surface"].is_linked:
            surf = out.inputs["Surface"].links[0].from_node.type
        t = [n.type for n in m.node_tree.nodes if n.type.startswith("TEX_")]
        tex = ",".join(sorted(set(t))) or "—"
    print(f"    {m.name[:38]:38s} ×{users:3d}  {surf:16s} {tex}")

print("\n--- render")
s = bpy.context.scene
print(f"    engine {s.render.engine}  device {getattr(s.cycles, 'device', '?')}  "
      f"{s.render.resolution_x}×{s.render.resolution_y} @{s.render.resolution_percentage}%")
if hasattr(s, "cycles"):
    print(f"    samples {s.cycles.samples}  time_limit {s.cycles.time_limit}  "
          f"denoise {s.cycles.use_denoising}  adaptive {s.cycles.use_adaptive_sampling}")
print(f"    view transform {s.view_settings.view_transform}  look {s.view_settings.look}  "
      f"exposure {s.view_settings.exposure:+.2f}")
print()
