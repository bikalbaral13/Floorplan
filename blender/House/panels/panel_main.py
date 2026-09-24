import bpy

_PANEL_COMMON = {
    "bl_space_type": "VIEW_3D",
    "bl_region_type": "UI",
    "bl_category": "Builder+",
}


class BUILDERPLUS_PT_main_panel(bpy.types.Panel):
    bl_label = "Builder+ House Tools"
    bl_idname = "BUILDERPLUS_PT_main_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"

    def draw(self, context):
        pass  # sub-panels own their own content


class BUILDERPLUS_PT_image_tools(bpy.types.Panel):
    bl_label = "Image Tools"
    bl_idname = "BUILDERPLUS_PT_image_tools"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        layout.operator("builderplus.import_image", icon="IMAGE_DATA")
        layout.prop(scene, "builderplus_image_opacity", slider=True)

        if scene.builderplus_image_path:
            layout.separator()
            layout.label(text="Set Scale from Two Points")
            props = scene.builderplus_scale_props
            layout.prop(props, "real_length")
            layout.prop(props, "unit")
            layout.prop(props, "scale_value", text="Scale Factor")
            row = layout.row(align=True)
            row.operator("builderplus.get_scale", icon="DRIVER_DISTANCE")
            row.operator("builderplus.apply_scale", icon="FULLSCREEN_ENTER")

class BUILDERPLUS_PT_tracing_tools(bpy.types.Panel):
    bl_label = "Tracing Tools"
    bl_idname = "BUILDERPLUS_PT_tracing_tools"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        layout.operator("builderplus.draw_line",    icon="MESH_DATA")
        layout.operator("builderplus.draw_bezier",  icon="CURVE_DATA")
        layout.operator("builderplus.draw_polygon", icon="MESH_GRID")
        layout.separator()
        layout.operator("builderplus.add_metadata", text="Add Metadata", icon="PROPERTIES")
        layout.operator("builderplus.extrude_objects", text="Extrude Selected", icon="MOD_SOLIDIFY")
        layout.separator()
        layout.operator("builderplus.json_to_trace", icon="IMPORT")
        layout.separator()
        layout.operator("builderplus.trace_to_3d",  icon="MOD_BUILD")

class BUILDERPLUS_PT_3d_generation(bpy.types.Panel):
    bl_label = "3D Generation"
    bl_idname = "BUILDERPLUS_PT_3d_generation"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        layout.operator("builderplus.export_building_json", icon="EXPORT")
        layout.operator("builderplus.json_to_3d", icon="FILE_FOLDER")
        layout.operator("builderplus.export_glb", icon="EXPORT")

class BUILDERPLUS_PT_render(bpy.types.Panel):
    bl_label = "Render"
    bl_idname = "BUILDERPLUS_PT_render"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        scene = context.scene

        # --- Area Lights from Trace ---
        box = layout.box()
        box.label(text="Area Lights from Trace", icon="LIGHT_AREA")
        col = box.column(align=True)
        col.prop(scene, "builderplus_area_light_target", text="Target")
        col.prop(scene, "builderplus_area_light_energy",  text="Energy (W)")
        col.operator("builderplus.add_area_lights", text="Add Area Lights", icon="LIGHT_AREA")

        layout.separator()
        layout.operator("builderplus.render_image", text="Render", icon="RENDER_STILL")

        # --- Image Editing ---
        layout.separator()
        box = layout.box()
        box.label(text="Image Editing — Gemini", icon="IMAGE_DATA")
        col = box.column(align=True)
        col.prop(scene, "builderplus_gemini_api_key", text="API Key", icon="LOCKED")
        col.prop(scene, "builderplus_edit_image_model", text="Model")
        col.prop(scene, "builderplus_edit_image_prompt", text="Prompt")
        col.prop(scene, "builderplus_edit_image_input_path", text="Image Path")
        col.operator("builderplus.edit_image", text="Edit Image", icon="IMAGE_ZDEPTH")
        col.prop(scene, "builderplus_edit_image_output_path", text="Output Path")


class BUILDERPLUS_PT_render_room_cameras(bpy.types.Panel):
    """Place cameras inside traced floor rooms."""
    bl_label      = "Room Cameras"
    bl_idname     = "BUILDERPLUS_PT_render_room_cameras"
    bl_space_type = "VIEW_3D"
    bl_region_type= "UI"
    bl_category   = "Builder+"
    bl_parent_id  = "BUILDERPLUS_PT_render"
    bl_options    = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout
        scene  = context.scene

        col = layout.column(align=True)
        col.label(text="Camera Placement:")
        col.prop(scene, "builderplus_room_cam_placement", text="")

        layout.separator()
        layout.prop(scene, "builderplus_room_cam_look_at_centre")

        layout.separator()
        layout.operator(
            "builderplus.add_room_cameras",
            text="Add Cameras in Rooms",
            icon="CAMERA_DATA",
        )

class BUILDERPLUS_PT_adjustment_tools(bpy.types.Panel):
    bl_label = "Adjustment Tools"
    bl_idname = "BUILDERPLUS_PT_adjustment_tools"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        obj = context.active_object

        col = layout.column(align=True)
        col.label(text="Transform:")
        row = col.row(align=True)
        row.enabled = obj is not None
        row.operator("builderplus.rotate_object_z90", text="Rotate 90°", icon="LOOP_FORWARDS")

        layout.separator()
        col = layout.column(align=True)
        col.label(text="Asset:")

        if obj is not None:
            from ..operators.ops_settings import _get_object_source_path, _sibling_assets
            current = _get_object_source_path(obj)
            if current:
                siblings = _sibling_assets(current)
                import os
                try:
                    idx = [os.path.normcase(s) for s in siblings].index(os.path.normcase(current))
                    hint = f"{os.path.basename(current)}  ({idx + 1} / {len(siblings)})"
                except ValueError:
                    hint = os.path.basename(current)
                box = col.box()
                box.scale_y = 0.6
                box.label(text=hint, icon="FILE_3D")
            else:
                col.label(text="No asset path found", icon="INFO")

        row = col.row(align=True)
        row.enabled = obj is not None
        row.operator("builderplus.swap_object", text="Swap Object", icon="FILE_REFRESH")

        layout.separator()
        col = layout.column(align=True)
        col.label(text="Texture:")

        if obj is not None:
            from ..operators.ops_settings import _get_texture_source_path, _sibling_textures
            current_tex = _get_texture_source_path(obj, context)
            if current_tex:
                siblings = _sibling_textures(current_tex)
                import os
                try:
                    idx = [os.path.normcase(s) for s in siblings].index(os.path.normcase(current_tex))
                    hint = f"{os.path.basename(current_tex)}  ({idx + 1} / {len(siblings)})"
                except ValueError:
                    hint = os.path.basename(current_tex)
                box = col.box()
                box.scale_y = 0.6
                box.label(text=hint, icon="NODE_MATERIAL")
            else:
                col.label(text="No texture set", icon="INFO")

        row = col.row(align=True)
        row.enabled = obj is not None
        row.operator("builderplus.apply_texture", text="Apply Texture", icon="CHECKMARK")
        row.operator("builderplus.swap_texture", text="Swap Texture", icon="FILE_REFRESH")

        col = layout.column(align=True)
        if obj is not None and "tile_size" in obj:
            col.prop(obj, '["tile_size"]', text="Tile Size")




class BUILDERPLUS_PT_ai_generation(bpy.types.Panel):
    """Adds Gemini AI tools to the 3D Viewport sidebar"""
    bl_label = "AI Generation"
    bl_idname = "BUILDERPLUS_PT_ai_generation"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    def draw(self, context):
        layout = self.layout
        scene = context.scene
        obj = context.active_object

        box = layout.box()
        box.label(text="Gemini Settings", icon="LOCKED")
        col = box.column(align=True)
        col.prop(scene, "builderplus_gemini_api_key", text="API Key")
        if hasattr(scene, "builderplus_ai_model"):
            col.prop(scene, "builderplus_ai_model", text="Model")

        layout.separator()
        box = layout.box()
        if obj:
            box.label(text=f"Target: {obj.name}", icon="OBJECT_DATA")
        else:
            box.label(text="Prompts (Scene)", icon="TEXT")

        col = box.column(align=True)
        if hasattr(scene, "builderplus_ai_prompt"):
            col.prop(scene, "builderplus_ai_prompt", text="")

        row = layout.row(align=True)
        row.scale_y = 1.3
        row.operator("builderplus.generate_ai_code", text="Generate and Run (Selection)", icon="CONSOLE")

        if hasattr(scene, "builderplus_ai_script") and scene.builderplus_ai_script:
            layout.separator()
            box = layout.box()
            box.label(text="Last Generated Code:", icon="SCRIPT")
            col = box.column(align=True)
            script_lines = scene.builderplus_ai_script.splitlines()
            for line in script_lines[:3]:
                col.label(text=line)
            if len(script_lines) > 3:
                col.label(text="...")


# ─────────────────────────────────────────────────────────────────────────────
# Parametric Tools panel
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_PT_parametric_tools(bpy.types.Panel):
    """Parametric design tools — site plan, furniture objects"""
    bl_label      = "Parametric Tools"
    bl_idname     = "BUILDERPLUS_PT_parametric_tools"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category   = "Builder+"
    bl_parent_id  = "BUILDERPLUS_PT_main_panel"
    bl_options    = {"DEFAULT_CLOSED"}

    def draw(self, context):
        layout = self.layout

        # ── Parametric Objects ────────────────────────────────────────────────
        box_obj = layout.box()
        box_obj.label(text="Parametric Objects", icon="OBJECT_DATAMODE")

        # Row 1: Table + Sofa
        row1 = box_obj.row(align=True)
        row1.scale_y = 1.3
        row1.operator(
            "builderplus.parametric_table",
            text="Table",
            icon="MESH_CUBE",
        )
        row1.operator(
            "builderplus.parametric_sofa",
            text="Sofa",
            icon="MESH_UVSPHERE",
        )

        # Row 2: Site Plan + Floor Plan
        row2 = box_obj.row(align=True)
        row2.scale_y = 1.3
        row2.operator(
            "builderplus.parametric_site_plan",
            text="Site Plan",
            icon="MESH_GRID",
        )
        row2.operator(
            "builderplus.parametric_floor_plan",
            text="Floor Plan",
            icon="IMPORT",
        )

        # Row 3: import a translated parametric object
        row3 = box_obj.row(align=True)
        row3.scale_y = 1.3
        row3.operator(
            "builderplus.import_parametric_object",
            text="Import Parametric Object",
            icon="MODIFIER",
        )

        # ── the imported object's parameters, right here under the button ─────────────────────────
        # Drawn from whatever resolves: the selection, a selected CHILD's parent, or — with nothing
        # selected at all — the only parametric object in the scene. Going blank because the user
        # clicked the mattress instead of the empty is indistinguishable from the feature missing.
        try:
            from ..utils.parametric_object import panel_target, parameters_of, scene_objects
        except Exception:  # noqa: BLE001 — never let a broken import blank the whole panel
            return

        target = panel_target(context)
        others = scene_objects(context.scene)

        if target is None:
            if others:
                col = box_obj.column(align=True)
                col.label(text="Pick an object to edit:", icon="INFO")
                for o in others:
                    col.operator("builderplus.pick_parametric_object", text=o.name,
                                 icon="EMPTY_AXIS").object_name = o.name
            return

        box_par = layout.box()
        head = box_par.row(align=True)
        head.label(text=target.name, icon="SETTINGS")
        head.operator("builderplus.rebuild_parametric_object", text="", icon="FILE_REFRESH")

        if len(others) > 1:
            pick = box_par.row(align=True)
            for o in others:
                pick.operator("builderplus.pick_parametric_object", text=o.name,
                              depress=(o == target)).object_name = o.name

        params = parameters_of(target)
        col = box_par.column(align=True)
        notes = []
        for p in params:
            name = p["dc"]
            if name not in target:
                continue
            if p["kind"] == "text":
                notes.append(name)
                continue
            if p["kind"] == "select":
                # An ID custom property of string type has no dropdown UI, so the options are drawn as a
                # row of buttons with the current one depressed. Typing "plinth" for "Plinth" would match
                # no branch and silently hide every part that depends on it.
                col.label(text=p.get("label") or name)
                row = col.row(align=True)
                current = target.get(name)
                for opt in p.get("options", []):
                    op = row.operator("builderplus.set_parametric_option", text=opt,
                                      depress=(opt == current))
                    op.object_name = target.name
                    op.param = name
                    op.value = opt
                col.separator()
                continue
            col.prop(target, f'["{name}"]', text=p.get("label") or name)

        if notes:
            box_par.separator()
            ncol = box_par.column(align=True)
            ncol.label(text="Material / semantics", icon="TEXT")
            for name in notes:
                ncol.prop(target, f'["{name}"]', text="")


class BUILDERPLUS_PT_object_props(bpy.types.Panel):
    bl_label = "Object Properties"
    bl_idname = "BUILDERPLUS_PT_object_props"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Builder+"
    bl_parent_id = "BUILDERPLUS_PT_main_panel"

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        return obj and ("id" in obj or "label" in obj)

    def draw(self, context):
        layout = self.layout
        obj = context.active_object

        if "id" in obj:
            layout.label(text="Polygon Properties")

            if "id" in obj:
                layout.prop(obj, '["id"]', text="id")

            layout.separator()
            layout.label(text="Type:")
            row = layout.row(align=True)
            for option in ["wall", "floor", "door", "window", "object"]:
                is_active = (obj.get("name", "") == option)
                op = row.operator(
                    "wm.context_set_string",
                    text=option.capitalize(),
                    depress=is_active
                )
                op.data_path = 'active_object["name"]'
                op.value = option
            layout.separator()

            current_type = obj.get("name", "")

            if current_type == "wall":
                if "height" in obj:
                    layout.prop(obj, '["height"]', text="height")

            elif current_type == "floor":
                if "height" in obj:
                    layout.prop(obj, '["height"]', text="Thickness")
                else:
                    obj["height"] = 0.1
                    layout.prop(obj, '["height"]', text="Thickness")

            elif current_type == "door":
                if "lintel_height" in obj:
                    layout.prop(obj, '["lintel_height"]', text="lintel_height")
                if "show_object" in obj:
                    layout.prop(obj, '["show_object"]', text="Show Object")
                if obj.get("show_object", False):
                    if "path" in obj:
                        layout.prop(obj, '["path"]', text="path")

            elif current_type == "window":
                if "sill_height" in obj:
                    layout.prop(obj, '["sill_height"]', text="sill_height")
                if "lintel_height" in obj:
                    layout.prop(obj, '["lintel_height"]', text="lintel_height")
                if "show_object" in obj:
                    layout.prop(obj, '["show_object"]', text="Show Object")
                if obj.get("show_object", False):
                    if "path" in obj:
                        layout.prop(obj, '["path"]', text="path")

            else:  # "object"
                if "placement" in obj:
                    layout.label(text="Placement:")
                    row = layout.row(align=True)
                    for option in ["floor", "ceiling"]:
                        is_active = (obj.get("placement", "floor") == option)
                        op = row.operator(
                            "wm.context_set_string",
                            text=option.capitalize(),
                            depress=is_active
                        )
                        op.data_path = 'active_object["placement"]'
                        op.value = option
                for key in ["direction", "clearance", "height"]:
                    if key in obj:
                        layout.prop(obj, f'["{key}"]', text=key)
                if "show_object" in obj:
                    layout.prop(obj, '["show_object"]', text="Show Object")
                if obj.get("show_object", False):
                    if "path" in obj:
                        layout.prop(obj, '["path"]', text="path")

            layout.separator()
            if "texture" in obj:
                layout.prop(obj, '["texture"]', text="Texture")
            if "apply_texture" in obj:
                layout.prop(obj, '["apply_texture"]', text="Apply Texture")
            if "tile_size" in obj:
                layout.prop(obj, '["tile_size"]', text="Tile Size")


classes = (
    BUILDERPLUS_PT_main_panel,
    BUILDERPLUS_PT_image_tools,
    BUILDERPLUS_PT_tracing_tools,
    BUILDERPLUS_PT_3d_generation,
    BUILDERPLUS_PT_render,
    BUILDERPLUS_PT_render_room_cameras,
    BUILDERPLUS_PT_adjustment_tools,
    BUILDERPLUS_PT_object_props,
    BUILDERPLUS_PT_ai_generation,
    BUILDERPLUS_PT_parametric_tools,
)
