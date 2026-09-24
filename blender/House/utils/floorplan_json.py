"""
floorplan_json.py — load a Builderpluss canvas plan JSON whose attachments carry BAKED 3D geometry,
and build it in Blender as real objects, real materials, real lamps and real cameras.

What the file holds (planFormat.ts / bakeAttachments.ts in the web app):
  nodes[] / segments[] / spaces[]   each with `attachments[]`
  attachment.baked = {
      anchor:  [x, y]     host position, WORLD metres, plan frame (x east, y SOUTH — down the page)
      meshes:  [{ id, name, color, layer, material?, tint?, emissive?, render?, faces: [...] }]
      metrics: [{ name, value }]   the object's Output Metrics — lumens, kelvin, lens shift, …
      prisms:  [...]      rules-DSL solids (bottom / top rings), rare
  }
  materials: { "Materials/Finishes/light-oak.json": { schema: "material/1", … }, … }
                      EMBEDDED, not linked — the r2.dev domain answers 403 to a bare urllib request,
                      and a silent fall back to grey is worse than a bigger file.

Frame: Blender is x east, y NORTH, z up → Blender = (ax + x, −(ay + y), z).

ONE OBJECT PER BAKED ROW, not one per attachment. A wardrobe arrives as carcass, doors, grooves, end
panels, mirror, rail and shelves rather than as one object with seven material slots. Seven objects
cost nothing in a path tracer, and they are what makes a material swap, a hide or a per-part UV scale
a one-liner instead of a polygon-index hunt. A plan with no materials still merges, as before, so an
older export imports exactly as it used to.
"""

import json
import os
import re

import bpy

_materials: dict = {}


# ─────────────────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────────────────

def _collection(name: str, parent: bpy.types.Collection) -> bpy.types.Collection:
    for c in parent.children:
        if c.name == name or c.name.startswith(name + "."):
            return c
    col = bpy.data.collections.new(name)
    parent.children.link(col)
    return col


def _hex_to_rgba(hex_str: str):
    s = (hex_str or "#94a3b8").lstrip("#")
    if len(s) == 3:
        s = "".join(ch * 2 for ch in s)
    try:
        r, g, b = int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16)
    except ValueError:
        r, g, b = 148, 163, 184
    lin = lambda c: (c / 255) / 12.92 if c / 255 <= 0.04045 else (((c / 255) + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b), 1.0)


def _flat_material(color_hex: str, alpha: float = 1.0) -> bpy.types.Material:
    """The fallback: a row with no library material keeps its baked colour, as it always has."""
    key = f"BP {color_hex.lower()}{'' if alpha >= 1 else f' a{alpha:.2f}'}"
    mat = _materials.get(key) or bpy.data.materials.get(key)
    if mat is None:
        mat = bpy.data.materials.new(key)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        rgba = _hex_to_rgba(color_hex)
        if bsdf:
            bsdf.inputs["Base Color"].default_value = rgba
            bsdf.inputs["Roughness"].default_value = 0.6
            if alpha < 1:
                bsdf.inputs["Alpha"].default_value = alpha
        mat.diffuse_color = (rgba[0], rgba[1], rgba[2], alpha)
        if alpha < 1:
            mat.blend_method = "BLEND"
    _materials[key] = mat
    return mat


_GLASS = re.compile(r"glaz|glass", re.I)


def _is_glazing(part: dict) -> bool:
    """A row is glazing if the plan bound it to a Glazing material or its name says so. Mirrors are
    Glazing too and must keep their shadow — they are opaque — so they are excluded by name."""
    path = str(part.get("material") or "")
    if "Materials/Glazing/mirror" in path:
        return False
    return "Materials/Glazing/" in path or bool(_GLASS.search(str(part.get("name") or "")))


def _material_for(part: dict, library: dict, kelvin=None, global_bevel=0.0) -> bpy.types.Material:
    """The row's LIBRARY material when the plan bound one, else its flat colour.

    This is the whole difference between the old importer and this one. A plan used to carry its
    finishes as prose — "light oak veneer, matte lacquer" — which no renderer can read, so every
    surface arrived as a flat hex. `materialPath` / `finishes` on the object bind a real
    `material/1` file per row, and `bake_plan.mjs` embeds the definitions in the payload."""
    path = part.get("material")
    definition = library.get(path) if path else None
    if definition is None:
        alpha = 0.35 if _GLASS.search(part.get("name", "")) else 1.0
        return _flat_material(part.get("color") or "#94a3b8", alpha)
    from . import bp_material as bpm
    tint = part.get("tint")
    k = kelvin if part.get("emissive") else None
    title = definition.get("title") or definition.get("id") or "material"
    label = f"{title}{' · ' + str(tint) if tint else ''}"
    try:
        return bpm.material_from_def(definition, part.get("color") or "#94a3b8", label,
                                     tint=tint, emissive_kelvin=k, global_bevel=global_bevel)
    except TypeError:
        # An older bp_material without the newer keywords — still better than a flat colour.
        return bpm.material_from_def(definition, part.get("color") or "#94a3b8", label)


def _kind_of(att: dict) -> str:
    path = att.get("objectPath") or att.get("objectId") or "object"
    stem = os.path.basename(str(path))
    stem = re.sub(r"\.json$", "", stem)
    stem = re.sub(r"-with-math$", "", stem)
    return stem


def _title(kind: str) -> str:
    return " ".join(w.capitalize() for w in re.split(r"[-_\s]+", kind) if w)


def _parts_of(baked: dict, stats: dict) -> list:
    parts = list(baked.get("meshes") or [])
    for pr in baked.get("prisms") or []:
        bottom, top = pr.get("bottom") or [], pr.get("top") or []
        if len(bottom) >= 3 and len(top) == len(bottom):
            side = [[bottom[i], bottom[(i + 1) % len(bottom)], top[(i + 1) % len(top)], top[i]]
                    for i in range(len(bottom))]
            parts.append({"name": pr.get("name", "Prism"), "color": pr.get("color", "#94a3b8"),
                          "faces": [list(reversed(bottom)), top, *side]})
        else:
            stats["skipped_prisms"] += 1
    return parts


def _mesh_from(parts, anchor, name):
    """One mesh from a list of parts, in the Blender frame. Returns (mesh, face_material_index)."""
    ax, ay = float(anchor[0]), float(anchor[1])
    verts, faces, face_part = [], [], []
    vindex: dict = {}

    def vid(p):
        key = (round(ax + p[0], 5), round(-(ay + p[1]), 5), round(p[2], 5))
        i = vindex.get(key)
        if i is None:
            i = len(verts)
            verts.append(key)
            vindex[key] = i
        return i

    for pi, part in enumerate(parts):
        for ring in part.get("faces") or []:
            if len(ring) < 3:
                continue
            idx = [vid(p) for p in ring]
            clean = [i for k, i in enumerate(idx) if k == 0 or i != idx[k - 1]]
            if clean and clean[0] == clean[-1]:
                clean = clean[:-1]
            if len(clean) >= 3 and len(set(clean)) == len(clean):
                faces.append(clean)
                face_part.append(pi)
    if not faces:
        return None, None
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate(verbose=False)
    mesh.update()
    return mesh, face_part


def _uv_metres(mesh, scale=1.0):
    """Planar UVs in metres, chosen per face by its dominant normal axis. An image map needs them and
    so does glTF; a procedural does not, because it reads world Position. A 1 m tile is then 1 m on
    the wall and 1 m on the floor, and the seam between them is where the normal flips."""
    uv = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        n = poly.normal
        axx, ayy, azz = abs(n.x), abs(n.y), abs(n.z)
        for li in poly.loop_indices:
            co = mesh.vertices[mesh.loops[li].vertex_index].co
            if azz >= axx and azz >= ayy:
                u, v = co.x, co.y
            elif axx >= ayy:
                u, v = co.y, co.z
            else:
                u, v = co.x, co.z
            uv.data[li].uv = (u / scale, v / scale)


# ─────────────────────────────────────────────────────────────────────────────
# entry point
# ─────────────────────────────────────────────────────────────────────────────

def import_floorplan_json(filepath: str, context=None, *, build_lights=True, build_cameras=True,
                          apply_look=True, use_materials=True, lm_per_w=184.0, log=None) -> dict:
    """Build the plan. Returns a stats dict; raises ValueError on a file that is not a baked plan."""
    log = log or (lambda *a: print("[bp]", *a))
    with open(filepath, "r", encoding="utf-8") as f:
        plan = json.load(f)
    if not isinstance(plan, dict) or not isinstance(plan.get("segments"), list):
        raise ValueError("Not a canvas plan JSON (no `segments` array)")

    hosts = [("segment", s) for s in plan.get("segments", [])] + \
            [("node", n) for n in plan.get("nodes", [])] + \
            [("space", sp) for sp in plan.get("spaces", [])]
    if not any(a.get("baked") for _, h in hosts for a in (h.get("attachments") or [])):
        raise ValueError(
            "This plan carries no baked 3D geometry. Export it from the canvas with Export JSON, or "
            "bake it with the Json to Blender Render Ready skill: "
            "node bake_plan.mjs <plan>.json --out <plan>.baked.json")

    _materials.clear()
    try:
        from . import bp_material as bpm
        bpm.clear_cache()
    except Exception:                                    # noqa: BLE001
        pass
    from . import floorplan_scene as fps

    scene = context.scene if context else bpy.context.scene
    library = plan.get("materials") or {} if use_materials else {}
    look, look_params = fps.find_look(hosts)
    global_bevel = fps.looker(look)("Global bevel (m)", 0.0)

    base = os.path.splitext(os.path.basename(filepath))[0].replace(".baked", "")
    root = bpy.data.collections.new(base)
    scene.collection.children.link(root)
    cols = {k: _collection(k, root) for k in
            ("Walls", "Doors", "Windows", "Spaces", "Objects", "Helpers", "Lighting", "Cameras")}

    stats = {"objects": 0, "faces": 0, "empty": 0, "skipped_prisms": 0, "walls": 0, "doors": 0,
             "windows": 0, "spaces": 0, "furniture": 0, "no_baked": 0, "helpers": 0,
             "materials": 0, "lights": 0, "cameras": 0, "glazing": 0}
    label_of = lambda h: (h.get("label") or "").strip()

    if library:
        log(f"materials {len(library)} definitions embedded in the plan")
    if look:
        log(f"look      render-look found: {len(look)} settings, global bevel {global_bevel * 1000:.1f} mm")

    for host_kind, host in hosts:
        for att in host.get("attachments") or []:
            baked = att.get("baked")
            if not baked or not baked.get("anchor"):
                stats["no_baked"] += 1
                continue
            kind = _kind_of(att)
            label = label_of(host)
            # A fixture's own colour temperature travels to its emissive rows, so a 2700 K pendant
            # diffuser and a 3000 K downlight lens do not both glow at the library default.
            kelvin = (att.get("params") or {}).get("kelvin")
            props = {
                "bp_host": host_kind, "bp_host_id": host.get("id"), "bp_object_id": att.get("objectId"),
                "bp_object_path": att.get("objectPath"), "bp_params": att.get("params"),
                "bp_label": label or None,
            }
            target = (cols["Walls"] if kind == "wall" and host_kind == "segment" else
                      cols["Doors"] if kind == "door" and host_kind == "segment" else
                      cols["Windows"] if kind == "window" and host_kind == "segment" else
                      cols["Spaces"] if kind == "room" and host_kind == "space" else
                      _collection(_title(kind), cols["Objects"]))
            bucket = ("walls" if target is cols["Walls"] else "doors" if target is cols["Doors"] else
                      "windows" if target is cols["Windows"] else "spaces" if target is cols["Spaces"]
                      else "furniture")

            parts = _parts_of(baked, stats)
            if not parts:
                stats["empty"] += 1
                continue
            bound = any(p.get("material") for p in parts) and bool(library)
            if bound:
                groups = [[p] for p in parts]
            else:
                # Unbound (an older export): merge, as this importer always has — but NEVER merge a
                # helper row with a visible one. A camera's body, lens, tripod and view cone are all
                # `render: false`, and merging them with anything visible would either put a grey
                # camera body in the render or hide the thing it was merged with.
                vis = [p for p in parts if p.get("render") is not False]
                hid = [p for p in parts if p.get("render") is False]
                groups = [g for g in (vis, hid) if g]
            made = 0
            for group in groups:
                nm = (f"{_title(kind)} · {group[0].get('name') or group[0].get('id')} · {label}".strip(" ·")
                      if bound else f"{_title(kind)} {label or host.get('id')}".strip())
                mesh, face_part = _mesh_from(group, baked["anchor"], nm)
                if mesh is None:
                    stats["empty"] += 1
                    continue
                _uv_metres(mesh)
                for p in group:
                    mesh.materials.append(_material_for(p, library, kelvin, global_bevel))
                for poly, pi in zip(mesh.polygons, face_part):
                    poly.material_index = pi
                hidden = group[0].get("render") is False
                obj = bpy.data.objects.new(nm, mesh)
                (cols["Helpers"] if hidden else target).objects.link(obj)
                for k, v in props.items():
                    if v is None:
                        continue
                    obj[k] = v if isinstance(v, (int, float, str, bool)) else json.dumps(v)
                obj["bp_row"] = group[0].get("id") or ""
                obj["bp_material"] = group[0].get("material") or ""
                if hidden:
                    # Drawing aids: camera bodies, view cones, the light objects' aim tubes. They stay
                    # in the file so it still documents where each shot was framed from, and none of
                    # it reaches a render.
                    obj.hide_render = True
                    stats["helpers"] += 1
                elif _is_glazing(group[0]):
                    # GLASS MUST NOT CAST A SHADOW, and this one line is the difference between a
                    # sunlit room and a dark one.
                    #
                    # Cycles treats light that refracts through a transmissive surface onto a diffuse
                    # one as a CAUSTIC, and refractive caustics are off here because leaving them on
                    # costs an enormous number of samples for fireflies nobody asked for. The cost of
                    # having them off is that a window stops the sun dead: the room behind it is lit
                    # only by whatever bounces in, which is exactly why every render off this plan has
                    # been dim and flat with a bright rectangle where the daylight should be.
                    #
                    # Excusing the glazing from shadow rays lets the sun through unrefracted. That is
                    # a real approximation — no shift, no lensing — and it is the one every
                    # architectural renderer makes, because a 6 mm pane refracts by well under a
                    # millimetre and nobody has ever seen it in a photograph of a room.
                    obj.visible_shadow = False
                    stats["glazing"] += 1
                stats["objects"] += 1
                stats["faces"] += len(mesh.polygons)
                made += 1
            if made:
                stats[bucket] += 1

    # A parametric "cylinder" is a 24-sided prism and a drape is a swept polyline: flat-shaded they
    # read as origami. Auto-smooth by angle is the only correct answer — plain smooth shading would
    # round the corners of every box too. The polygon count is the discriminator.
    curved = [o for o in root.all_objects if o.type == "MESH" and len(o.data.polygons) >= 60]
    if curved:
        for o in bpy.data.objects:
            o.select_set(False)
        for o in curved:
            o.select_set(True)
        bpy.context.view_layer.objects.active = curved[0]
        try:
            bpy.ops.object.shade_auto_smooth(angle=0.610865)     # 35°
        except (AttributeError, RuntimeError, TypeError):
            pass
        for o in curved:
            o.select_set(False)
    stats["smoothed"] = len(curved)
    stats["materials"] = len(bpy.data.materials)
    log(f"geometry  {stats['objects']} objects, {stats['faces']} faces, {stats['helpers']} helpers hidden, "
        f"{stats['smoothed']} smoothed, {stats['glazing']} glazing excused from shadow rays")

    if build_lights:
        counts = fps.build_lights(hosts, cols["Lighting"], look, look_params, lm_per_w=lm_per_w, log=log)
        stats["lights"] = counts["sun"] + counts["spot"] + counts["point"] + counts["area"]
        stats["light_counts"] = {k: counts[k] for k in ("sun", "spot", "point", "area")}
        log(f"lights    {counts['sun']} sun, {counts['spot']} spot, {counts['point']} point, "
            f"{counts['area']} area  (lm/W {lm_per_w:.0f})")
        if counts["groups"]:
            log("groups    " + ", ".join(f"{g}×{n}" for g, n in sorted(counts["groups"].items())))
        sun_dir = counts["sun_dir"]
    else:
        sun_dir = None

    if build_cameras:
        cams = fps.build_cameras(hosts, cols["Cameras"], scene, log=log)
        stats["cameras"] = len(cams)
        if cams:
            log("cameras   " + ", ".join(str(c.get("bp_shot") or c.name) for c in cams))

    if apply_look and look:
        fps.apply_look(scene, look, look_params, sun_dir=sun_dir, log=log)

    settings = plan.get("settings") or {}
    root["bp_source"] = os.path.basename(filepath)
    root["bp_pixels_per_meter"] = float(settings.get("pixelsPerMeter") or 0)
    root["bp_library_path"] = str(settings.get("library_path") or "")
    root["bp_has_look"] = bool(look)
    stats["collection"] = root.name
    return stats
