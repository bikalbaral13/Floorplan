# Reads a BuilderPluss SketchUp IR (`*.skpir.json`) and builds it as a real DYNAMIC COMPONENT.
#
# HOW THIS DIFFERS FROM BakedObjectImporter. That one reads `resolved.meshes` — geometry the Math Engine
# already evaluated — and draws it. What lands is correct and completely inert: change a parameter and
# nothing happens, because the parameters were consumed before the file was written. This one reads the
# TRANSLATED formulas instead. Every part is a box whose `lenx/leny/lenz/x/y/z` are SketchUp formulas over
# the object's own parameters, so SketchUp's Dynamic Components engine recomputes the geometry itself and
# Component Options edits it. The Math Engine is not needed at run time and is not shipped.
#
# WHAT A DYNAMIC COMPONENT ACTUALLY IS. There is no DC class. A DC is an ordinary ComponentDefinition
# carrying a `dynamic_attributes` dictionary, in which:
#
#     "length"            the current value
#     "_length_formula"   the formula, WITHOUT its leading "=" (this is the bit that makes it dynamic)
#     "_length_label"     what Component Options calls it
#     "_length_units"     FLOAT | STRING | INCHES | CENTIMETERS …
#     "_length_access"    TEXTBOX | LIST | VIEW | NONE
#     "_length_options"   "A=A&B=B" — only read when access is LIST
#
# A CHILD'S FORMULA THAT NAMES A BARE ATTRIBUTE LOOKS IT UP ON THE CHILD. Parameters live on the parent,
# so part formulas reference `Parent!Length`. The transpiler emits them already qualified; if a part ever
# comes out the right shape but ignoring a slider, that qualification is the first thing to check.
#
# UNITS. Every number in the Math Engine body is metres; every DC geometry attribute is model INCHES. The
# conversion is baked into the emitted formulas (each ends `*39.37…`), so nothing here converts anything —
# which is deliberate, because a second conversion is the classic way to get a 39x bed.
#
# FRAME. The IR's part formulas are already in SketchUp's frame (+y north, z up); the object frame's +y
# south was flipped by the transpiler. So this file has no axis handling at all, unlike its baked sibling.

require 'sketchup.rb'
require 'json'
require 'time'

module DynamicObjectImporter

  SUPPORTED_SCHEMA = 'builderpluss.sketchup-ir/1'.freeze
  DICT = 'dynamic_attributes'.freeze

  # The base box every part is made from. Its size is irrelevant to the result — `lenx` overrides it — but
  # it must not be tiny: SketchUp discards edges under about 0.001", and a part built from a collapsed box
  # scales up to nothing. One metre is comfortably clear of that.
  BASE = 1.m

  Report = Struct.new(:name, :source_id, :parts, :hidden, :params, :instance, :dc_engine, keyword_init: true)

  module_function

  # ── entry point ─────────────────────────────────────────────────────────────────────────────────

  def prompt_and_import
    path = UI.openpanel('Select a BuilderPluss dynamic object', '', 'SketchUp IR|*.skpir.json;*.json||')
    return if path.nil?

    report = import(path)
    UI.messagebox(report_text(report))
  rescue StandardError => e
    UI.messagebox("Dynamic import failed.\n\n#{e.message}")
  end

  def import(path)
    ir = JSON.parse(File.read(path))
    schema = ir['schema']
    unless schema == SUPPORTED_SCHEMA
      raise "This file says schema #{schema.inspect}; this importer reads #{SUPPORTED_SCHEMA.inspect}."
    end

    model = Sketchup.active_model
    model.start_operation('Import BuilderPluss dynamic object', true)
    begin
      defn = model.definitions.add(unique_name(model, ir['name'].to_s))
      defn.description = "#{ir.dig('source', 'title')} — BuilderPluss parametric object as a dynamic component"

      write_parameters(defn, ir['parameters'])
      defn.set_attribute(DICT, '_name', ir['name'])
      defn.set_attribute(DICT, '_lengthunits', 'CENTIMETERS')
      defn.set_attribute('builderpluss', 'sourceId', ir.dig('source', 'id'))
      defn.set_attribute('builderpluss', 'irSchema', schema)
      defn.set_attribute('builderpluss', 'importedAt', Time.now.utc.iso8601)

      ir['parts'].each_with_index { |part, i| add_part(model, defn, part, i) }

      inst = model.active_entities.add_instance(defn, Geom::Transformation.new)
      inst.name = ir['name'].to_s
      model.commit_operation
    rescue StandardError
      model.abort_operation
      raise
    end

    # `redraw_with_undo` opens its OWN model operation, and SketchUp does not nest them — running it inside
    # ours would abort the import halfway through. So the component is committed first, then evaluated.
    engine = redraw(inst)

    Report.new(
      name: ir['name'], source_id: ir.dig('source', 'id'),
      parts: ir['parts'].length,
      hidden: ir['parts'].count { |p| p.dig('defaults', 'hidden').to_i != 0 },
      params: ir['parameters'].length, instance: inst, dc_engine: engine,
    )
  end

  # ── the parent: parameters ──────────────────────────────────────────────────────────────────────

  # One user-facing parameter. `access` decides what Component Options shows: TEXTBOX for a number the user
  # types, LIST for a select — and LIST needs `_options` as "Label=Value&Label=Value" or the dropdown is
  # built but empty, which reads exactly like the parameter being ignored.
  def write_parameters(defn, params)
    params.each_with_index do |p, i|
      key = p['dc'].to_s.downcase
      value = p['value']
      value = (value ? 1 : 0) if value == true || value == false

      defn.set_attribute(DICT, key, value)
      defn.set_attribute(DICT, "_#{key}_label", p['dc'])
      defn.set_attribute(DICT, "_#{key}_formlabel", p['label'] || p['dc'])
      defn.set_attribute(DICT, "_#{key}_units", p['dcUnits'] || 'FLOAT')
      defn.set_attribute(DICT, "_#{key}_formulaunits", p['dcUnits'] || 'FLOAT')
      defn.set_attribute(DICT, "_#{key}_access", p['access'] || 'TEXTBOX')
      defn.set_attribute(DICT, "_#{key}_hasLabel", 1)
      defn.set_attribute(DICT, "_#{key}_sortorder", (i + 1) * 10)
      defn.set_attribute(DICT, "_#{key}_nvalue", value) if value.is_a?(Numeric)
      if p['access'] == 'LIST' && p['options'].is_a?(Array)
        defn.set_attribute(DICT, "_#{key}_options", p['options'].map { |o| "#{o}=#{o}" }.join('&'))
      end
    end
  end

  # ── the children: one box per part ──────────────────────────────────────────────────────────────

  def add_part(model, parent, part, index)
    box = model.definitions.add(unique_name(model, "#{parent.name}_#{part['id']}"))
    build_box(box.entities, BASE, BASE, BASE, part['color'])

    inst = parent.entities.add_instance(box, Geom::Transformation.new)
    inst.name = part['name'].to_s

    # The formulas go on the INSTANCE: two instances of the same box part are two different parts of the
    # object, and definition-level formulas would make them the same one.
    %w[lenx leny lenz x y z hidden copies].each do |attr|
      formula = part[attr]
      next if formula.nil?
      inst.set_attribute(DICT, attr, part.dig('defaults', attr) || 0)
      inst.set_attribute(DICT, "_#{attr}_formula", formula.sub(/\A=/, ''))
    end
    inst.set_attribute(DICT, '_name', part['name'])
    inst.set_attribute(DICT, '_sortorder', (index + 1) * 10)
    inst
  end

  def build_box(ents, dx, dy, dz, hex)
    face = ents.add_face(
      Geom::Point3d.new(0, 0, 0), Geom::Point3d.new(dx, 0, 0),
      Geom::Point3d.new(dx, dy, 0), Geom::Point3d.new(0, dy, 0)
    )
    # add_face orients by its own rule, and pushpull follows the NORMAL — so make the normal point up
    # before extruding, or the box is built from z=0 downwards and every part sits a storey too low.
    face.reverse! if face.normal.z < 0
    face.pushpull(dz)
    mat = material_for(hex)
    ents.grep(Sketchup::Face).each { |f| f.material = mat; f.back_material = mat } if mat
  end

  def material_for(hex)
    return nil if hex.nil? || hex.empty?
    model = Sketchup.active_model
    name = "BP#{hex.delete('#')}"
    mat = model.materials[name] || model.materials.add(name)
    mat.color = Sketchup::Color.new(hex)
    mat
  rescue StandardError
    nil
  end

  # ── make the DC engine evaluate it ──────────────────────────────────────────────────────────────

  # `$dc_observers` is the Dynamic Components extension. It ships with SketchUp but can be switched off in
  # Extension Manager, and then the component lands with correct formulas that nothing evaluates. Say so
  # rather than leaving the user with a pile of unit cubes and no explanation.
  def redraw(instance)
    return 'not found — enable Dynamic Components in Extension Manager' unless defined?($dc_observers) && $dc_observers
    $dc_observers.get_latest_class.redraw_with_undo(instance)
    'redrawn'
  rescue StandardError => e
    "redraw failed: #{e.message}"
  end

  # ── reporting ───────────────────────────────────────────────────────────────────────────────────

  def unique_name(model, base)
    name = base
    n = 1
    name = "#{base}_#{n += 1}" while model.definitions[name]
    name
  end

  def report_text(r)
    bb = r.instance.bounds
    <<~TEXT
      #{r.name}   (#{r.source_id})

        parts        #{r.parts}  (#{r.hidden} hidden at the defaults)
        parameters   #{r.params}
        DC engine    #{r.dc_engine}

      Bounding box (m):
        Length  #{fmt(bb.width)}
        Width   #{fmt(bb.height)}
        Height  #{fmt(bb.depth)}

      Open Component Options and change a parameter — the geometry should rebuild.
    TEXT
  end

  def fmt(len)
    format('%.4f', len.to_f / 39.37007874015748)
  end
end

module Main
  def self.import_dynamic_object
    DynamicObjectImporter.prompt_and_import
  end
end
