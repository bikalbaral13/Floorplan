"""
ops_parametric.py — Operators for Parametric Tools
====================================================
Registers:
  BUILDERPLUS_OT_test_site_plan
  BUILDERPLUS_OT_parametric_table
  BUILDERPLUS_OT_parametric_sofa
  BUILDERPLUS_OT_parametric_site_plan
  BUILDERPLUS_OT_parametric_floor_plan   (file dialog → build a baked canvas plan JSON as objects)
"""

import bpy
import os
from bpy.props import BoolProperty, FloatProperty, StringProperty
from bpy_extras.io_utils import ImportHelper
from ..utils.parametric import create_parametric_site_plan, DEFAULT_PARAMS


# ─────────────────────────────────────────────────────────────────────────────
# Utility: run a .py file from parametric_objects/ inside Blender's context
# ─────────────────────────────────────────────────────────────────────────────

def _run_parametric_script(filename: str) -> str | None:
    """
    Locate and exec() a script from utils/parametric_objects/.
    Returns an error string on failure, or None on success.
    """
    addon_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    script_path = os.path.join(addon_dir, "utils", "parametric_objects", filename)

    if not os.path.isfile(script_path):
        return f"Script not found: {script_path}"

    with open(script_path, "r", encoding="utf-8") as f:
        source = f.read()

    try:
        # Create a globals dictionary with __name__ set to "__main__"
        # so that scripts using the 'if __name__ == "__main__":' entry point will run.
        script_globals = {
            "__file__": script_path,
            "__name__": "__main__",
        }
        exec(compile(source, script_path, "exec"), script_globals)
    except Exception as exc:
        return str(exc)

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Site Plan operator (GN-based, driven by panel properties)
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_test_site_plan(bpy.types.Operator):
    """Create a Geometry Nodes-driven Parametric Site Plan in the viewport"""
    bl_idname  = "builderplus.test_site_plan"
    bl_label   = "Test Site Plan"
    bl_options = {"REGISTER", "UNDO"}

    plot_width: FloatProperty(
        name="Plot Width (m)", default=DEFAULT_PARAMS["plot_width"],
        min=1.0, max=500.0, description="Total plot boundary width",
    )
    plot_depth: FloatProperty(
        name="Plot Depth (m)", default=DEFAULT_PARAMS["plot_depth"],
        min=1.0, max=500.0, description="Total plot boundary depth",
    )
    row_width: FloatProperty(
        name="ROW Width (m)", default=DEFAULT_PARAMS["row_width"],
        min=0.0, max=50.0, description="Right-of-Way corridor width on each side",
    )
    front_setback: FloatProperty(
        name="Front Setback (m)", default=DEFAULT_PARAMS["front_setback"],
        min=0.0, max=50.0, description="Minimum distance from the ROW line to the building front",
    )
    rear_setback: FloatProperty(
        name="Rear Setback (m)", default=DEFAULT_PARAMS["rear_setback"],
        min=0.0, max=50.0, description="Minimum distance from the rear boundary to the building",
    )
    side_setback_left: FloatProperty(
        name="Left Setback (m)", default=DEFAULT_PARAMS["side_setback_left"],
        min=0.0, max=50.0, description="Left side setback",
    )
    side_setback_right: FloatProperty(
        name="Right Setback (m)", default=DEFAULT_PARAMS["side_setback_right"],
        min=0.0, max=50.0, description="Right side setback",
    )
    house_width: FloatProperty(
        name="House Width (m)", default=DEFAULT_PARAMS["house_width"],
        min=1.0, max=200.0, description="Building footprint width",
    )
    house_depth: FloatProperty(
        name="House Depth (m)", default=DEFAULT_PARAMS["house_depth"],
        min=1.0, max=200.0, description="Building footprint depth",
    )
    house_height: FloatProperty(
        name="House Height (m)", default=DEFAULT_PARAMS["house_height"],
        min=1.0, max=100.0, description="Building massing height",
    )

    def execute(self, context):
        params = {
            "plot_width":          self.plot_width,
            "plot_depth":          self.plot_depth,
            "row_width":           self.row_width,
            "front_setback":       self.front_setback,
            "rear_setback":        self.rear_setback,
            "side_setback_left":   self.side_setback_left,
            "side_setback_right":  self.side_setback_right,
            "house_width":         self.house_width,
            "house_depth":         self.house_depth,
            "house_height":        self.house_height,
        }
        try:
            create_parametric_site_plan(params)
        except Exception as exc:
            self.report({"ERROR"}, f"Site plan creation failed: {exc}")
            return {"CANCELLED"}

        from ..utils.parametric import get_buildable_area
        info = get_buildable_area(params)
        if not info["house_fits"]:
            self.report(
                {"WARNING"},
                f"House ({self.house_width}m × {self.house_depth}m) exceeds "
                f"buildable zone ({info['buildable_width']}m × {info['buildable_depth']}m)."
            )
        else:
            self.report(
                {"INFO"},
                f"Site Plan created. Buildable zone: "
                f"{info['buildable_width']}m × {info['buildable_depth']}m "
                f"({info['buildable_area_m2']} m²)"
            )
        return {"FINISHED"}

    def invoke(self, context, event):
        scene = context.scene
        prop_map = {
            "plot_width":          "builderplus_siteplan_plot_width",
            "plot_depth":          "builderplus_siteplan_plot_depth",
            "row_width":           "builderplus_siteplan_row_width",
            "front_setback":       "builderplus_siteplan_front_setback",
            "rear_setback":        "builderplus_siteplan_rear_setback",
            "side_setback_left":   "builderplus_siteplan_side_setback_left",
            "side_setback_right":  "builderplus_siteplan_side_setback_right",
            "house_width":         "builderplus_siteplan_house_width",
            "house_depth":         "builderplus_siteplan_house_depth",
            "house_height":        "builderplus_siteplan_house_height",
        }
        for op_attr, scene_attr in prop_map.items():
            if hasattr(scene, scene_attr):
                setattr(self, op_attr, getattr(scene, scene_attr))
        return self.execute(context)


# ─────────────────────────────────────────────────────────────────────────────
# Parametric Table operator
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_parametric_table(bpy.types.Operator):
    """Generate a parametric table driven by Geometry Nodes (table.py)"""
    bl_idname  = "builderplus.parametric_table"
    bl_label   = "Parametric Table"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        err = _run_parametric_script("table.py")
        if err:
            self.report({"ERROR"}, f"Table script failed: {err}")
            return {"CANCELLED"}
        self.report({"INFO"}, "Parametric Table created — select it and open the modifier properties to adjust sliders.")
        return {"FINISHED"}


# ─────────────────────────────────────────────────────────────────────────────
# Parametric Sofa operator
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_parametric_sofa(bpy.types.Operator):
    """Generate a parametric sofa driven by Geometry Nodes (sofa.py)"""
    bl_idname  = "builderplus.parametric_sofa"
    bl_label   = "Parametric Sofa"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        err = _run_parametric_script("sofa.py")
        if err:
            self.report({"ERROR"}, f"Sofa script failed: {err}")
            return {"CANCELLED"}
        self.report({"INFO"}, "Parametric Sofa created — select it and open the modifier properties to adjust sliders.")
        return {"FINISHED"}


# ─────────────────────────────────────────────────────────────────────────────
# Parametric Site Plan object operator (runs site_plan.py)
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_parametric_site_plan(bpy.types.Operator):
    """Generate a parametric site plan object driven by Geometry Nodes (site_plan.py)"""
    bl_idname  = "builderplus.parametric_site_plan"
    bl_label   = "Parametric Site Plan"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        err = _run_parametric_script("site_plan.py")
        if err:
            self.report({"ERROR"}, f"Site Plan script failed: {err}")
            return {"CANCELLED"}
        self.report({"INFO"}, "Parametric Site Plan created — select it and open the modifier properties to adjust sliders.")
        return {"FINISHED"}


# ─────────────────────────────────────────────────────────────────────────────
# Floor Plan — import a Builderpluss canvas plan JSON with baked 3D geometry
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_parametric_floor_plan(bpy.types.Operator, ImportHelper):
    """Load a canvas plan JSON (exported from the Builderpluss web app with baked attachments) and build
    it as objects: every wall, door, window, room floor plate and parametric object becomes its own
    object, sorted into Walls / Doors / Windows / Spaces / Objects collections"""
    bl_idname  = "builderplus.parametric_floor_plan"
    bl_label   = "Import Floor Plan JSON"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".json"
    filter_glob: StringProperty(default="*.json", options={"HIDDEN"})

    use_materials: BoolProperty(
        name="Library materials",
        description="Build the real material/1 definitions the plan embeds — grain, bevel, sheen, "
                    "subsurface, coat. Off falls back to the flat baked colours",
        default=True)
    build_lights: BoolProperty(
        name="Lights",
        description="One Blender lamp per emitting fitting, from its own lumens, colour temperature "
                    "and beam. Fittings with `emitsLight` off are skipped, so a lit diffuser is not "
                    "counted twice",
        default=True)
    build_cameras: BoolProperty(
        name="Cameras",
        description="One camera per shot, in shot order, with its lens shift, near clip and depth of "
                    "field. The first becomes the scene camera",
        default=True)
    apply_look: BoolProperty(
        name="Scene look",
        description="Engine, sampling, world sky and sun, view transform and the glare / white "
                    "balance / vignette compositor — from the plan's own render-look object",
        default=True)
    lm_per_w: FloatProperty(
        name="lm / W",
        description="Luminous efficiency of the whole rig: 683 lm/W at peak times about 0.27 for a "
                    "broadband white source. Tune it once here, never per fixture",
        default=184.0, min=20.0, max=683.0)

    def draw(self, context):
        col = self.layout.column(align=True)
        col.prop(self, "use_materials")
        col.prop(self, "build_lights")
        col.prop(self, "build_cameras")
        col.prop(self, "apply_look")
        col.separator()
        col.prop(self, "lm_per_w")

    def execute(self, context):
        from ..utils.floorplan_json import import_floorplan_json
        try:
            stats = import_floorplan_json(
                self.filepath, context,
                use_materials=self.use_materials, build_lights=self.build_lights,
                build_cameras=self.build_cameras, apply_look=self.apply_look,
                lm_per_w=self.lm_per_w)
        except ValueError as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        except Exception as exc:  # noqa: BLE001 — surface anything else in the UI rather than the console only
            import traceback
            traceback.print_exc()
            self.report({"ERROR"}, f"Floor plan import failed: {exc}")
            return {"CANCELLED"}
        extra = []
        if stats.get("lights"):
            extra.append(f"{stats['lights']} lamps")
        if stats.get("cameras"):
            extra.append(f"{stats['cameras']} cameras")
        if stats.get("materials"):
            extra.append(f"{stats['materials']} materials")
        if stats["no_baked"]:
            extra.append(f"{stats['no_baked']} attachments had no baked geometry")
        if stats["empty"]:
            extra.append(f"{stats['empty']} empty")
        if stats["skipped_prisms"]:
            extra.append(f"{stats['skipped_prisms']} prisms skipped")
        self.report(
            {"INFO"},
            f"Floor plan '{stats['collection']}': {stats['walls']} walls, {stats['doors']} doors, {stats['windows']} windows, "
            f"{stats['spaces']} rooms, {stats['furniture']} objects ({stats['objects']} objects, {stats['faces']} faces)"
            + (" — " + ", ".join(extra) if extra else ""),
        )
        return {"FINISHED"}


# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# Parametric Object — import a translated BuilderPluss object (.blir.json) and keep it PARAMETRIC
# ─────────────────────────────────────────────────────────────────────────────

class BUILDERPLUS_OT_import_parametric_object(bpy.types.Operator, ImportHelper):
    """Load a BuilderPluss parametric object (.blir.json) and build it as a live parametric object:
    the parameters land on the imported empty and the geometry rebuilds whenever one of them changes"""
    bl_idname  = "builderplus.import_parametric_object"
    bl_label   = "Import Parametric Object"
    bl_options = {"REGISTER", "UNDO"}

    filename_ext = ".json"
    filter_glob: StringProperty(default="*.blir.json;*.json", options={"HIDDEN"})

    def execute(self, context):
        from ..utils.parametric_object import import_parametric_object, register_handler, IRError
        try:
            stats = import_parametric_object(self.filepath, context)
        except ValueError as exc:            # IRError included — it subclasses ValueError
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        except Exception as exc:  # noqa: BLE001 — surface it in the UI, not only on the console
            self.report({"ERROR"}, f"Parametric import failed: {exc}")
            return {"CANCELLED"}
        # Only arm the live rebuild once something has actually been imported, so a user who never uses
        # this button never pays for a depsgraph handler.
        register_handler()
        self.report(
            {"INFO"},
            (f"{stats['translated']} — " if stats.get("translated") else "")
            + f"{stats['name']}: {stats['parameters']} parameters, {stats['parts']} parts, "
            f"{stats['objects']} objects ({stats['hidden']} hidden) — edit the parameters in Builder+ > "
            f"Parametric Tools with the object selected",
        )
        return {"FINISHED"}


class BUILDERPLUS_OT_rebuild_parametric_object(bpy.types.Operator):
    """Re-evaluate the selected parametric object against its current parameters"""
    bl_idname  = "builderplus.rebuild_parametric_object"
    bl_label   = "Rebuild"
    bl_options = {"REGISTER", "UNDO"}

    @classmethod
    def poll(cls, context):
        obj = context.active_object
        return obj is not None and "bp_ir" in obj

    def execute(self, context):
        from ..utils.parametric_object import rebuild, register_handler
        try:
            stats = rebuild(context.active_object)
        except Exception as exc:  # noqa: BLE001
            self.report({"ERROR"}, f"Rebuild failed: {exc}")
            return {"CANCELLED"}
        register_handler()
        self.report({"INFO"}, f"Rebuilt: {stats['objects']} objects, {stats['hidden']} hidden")
        return {"FINISHED"}



class BUILDERPLUS_OT_set_parametric_option(bpy.types.Operator):
    """Set one option on a parametric object and rebuild it"""
    bl_idname  = "builderplus.set_parametric_option"
    bl_label   = "Set Option"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: StringProperty()
    param: StringProperty()
    value: StringProperty()

    def execute(self, context):
        from ..utils.parametric_object import set_param
        obj = bpy.data.objects.get(self.object_name)
        if obj is None:
            self.report({"ERROR"}, f"{self.object_name} is gone")
            return {"CANCELLED"}
        try:
            set_param(obj, self.param, self.value)
        except Exception as exc:  # noqa: BLE001
            self.report({"ERROR"}, f"{self.param} = {self.value!r} failed: {exc}")
            return {"CANCELLED"}
        return {"FINISHED"}


class BUILDERPLUS_OT_pick_parametric_object(bpy.types.Operator):
    """Make this parametric object the one the panel edits"""
    bl_idname  = "builderplus.pick_parametric_object"
    bl_label   = "Pick Parametric Object"
    bl_options = {"REGISTER", "UNDO", "INTERNAL"}

    object_name: StringProperty()

    def execute(self, context):
        obj = bpy.data.objects.get(self.object_name)
        if obj is None:
            return {"CANCELLED"}
        for o in context.selected_objects:
            o.select_set(False)
        obj.select_set(True)
        context.view_layer.objects.active = obj
        return {"FINISHED"}


classes = (
    BUILDERPLUS_OT_test_site_plan,
    BUILDERPLUS_OT_parametric_table,
    BUILDERPLUS_OT_parametric_sofa,
    BUILDERPLUS_OT_parametric_site_plan,
    BUILDERPLUS_OT_parametric_floor_plan,
    BUILDERPLUS_OT_import_parametric_object,
    BUILDERPLUS_OT_rebuild_parametric_object,
    BUILDERPLUS_OT_set_parametric_option,
    BUILDERPLUS_OT_pick_parametric_object,
)
