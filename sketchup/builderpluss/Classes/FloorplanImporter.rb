# Reads a BAKED BuilderPluss floorplan and builds it as a SketchUp component.
#
# The plan is a GRAPH of references: coordinates live once in `nodes`, segments and spaces name the nodes
# they use, and each parametric object is an ATTACHMENT — an object path plus that instance's params.
# Resolving one needs the definition, the host and an 8k-line evaluator. This file needs none of that,
# because the export already stamped the answer onto every attachment as `baked`.
#
# So the whole importer is: walk the attachments, read `baked.meshes`, place them at `baked.anchor`.
# It never learns what a wall, a door or a spine is — see BakedObjectImporter, whose geometry helpers this
# reuses rather than repeats.
#
# TWO LEVELS, and the difference is what keeps the model small. An attachment is an INSTANCE; its geometry
# is a VARIANT — the object at one parameter set, on one host. Seventeen walls are seventeen instances of
# fourteen variants; three windows on identical 1.2 m openings are three instances of ONE. Meshes arrive
# anchor-relative, so two attachments that look the same ARE byte-identical here: the variant key is the
# mesh JSON itself, and each distinct one becomes a single ComponentDefinition that SketchUp instances.
#
# FRAME: `settings.bakedFrame` states it — metres, x east, y SOUTH (down the plan page), z up, each
# attachment's meshes relative to its own `baked.anchor` in world metres. SketchUp is z-up with +y NORTH,
# so both the anchor and the vertices flip y. The vertex flip lives in BakedObjectImporter.ring_points.

require 'sketchup.rb'
require 'json'

module FloorplanImporter

  SUPPORTED_SCHEMA = 1

  Report = Struct.new(
    :name, :attachments, :placed, :definitions, :face_count, :failed, :skipped,
    :by_object, :tags, :bounds_m, :group,
    keyword_init: true,
  )

  module_function

  # ── entry point ─────────────────────────────────────────────────────────────────────────────────

  def prompt_and_import
    path = UI.openpanel('Select a baked BuilderPluss floorplan', '', 'JSON Files|*.json||')
    return if path.nil? # cancelled

    report = import(path)
    UI.messagebox(report_text(report))
  rescue StandardError => e
    UI.messagebox("Floorplan import failed.\n\n#{e.message}")
  end

  def import(path)
    plan = validate(JSON.parse(File.read(path, encoding: 'UTF-8')), path)

    model = Sketchup.active_model
    model.start_operation('Import Floorplan', true)
    begin
      report = build(model, plan, File.basename(path, '.json'))
      model.commit_operation
      report
    rescue StandardError
      model.abort_operation
      raise
    end
  end

  # ── validation ──────────────────────────────────────────────────────────────────────────────────

  def validate(plan, path)
    raise "#{File.basename(path)} is not a JSON object." unless plan.is_a?(Hash)

    schema = plan['schemaVersion']
    unless schema == SUPPORTED_SCHEMA
      raise "This plan is schema #{schema.inspect}; this plugin reads #{SUPPORTED_SCHEMA}."
    end

    units = plan['settings'] && plan['settings']['units']
    raise "The plan is in #{units.inspect}; this plugin expects metres." unless units == 'm'

    unless plan['segments'].is_a?(Array) || plan['nodes'].is_a?(Array)
      raise 'No nodes or segments in this file — it does not look like a floorplan.'
    end

    # The plan is readable but carries no baked geometry: an export from before the bake existed, or one
    # whose objects all failed to resolve. Naming it is the difference between "nothing appeared" and a
    # user knowing to re-export.
    if attachments_of(plan).empty?
      raise "This plan has no attached objects.\n\nA floorplan's geometry lives on its attachments; " \
            'a plan of bare walls with no objects has nothing to import.'
    end
    if attachments_of(plan).none? { |a| a[:baked] }
      raise "None of this plan's #{attachments_of(plan).length} attachments carry a `baked` block.\n\n" \
            'Re-export it from the canvas — Export JSON now bakes the geometry in.'
    end

    plan
  end

  # ── reading ─────────────────────────────────────────────────────────────────────────────────────

  # Every attachment in the plan, flattened out of its host. Hosts differ (a node, a segment, a space) but
  # an attachment does not: `baked.anchor` already carries the host's position, so nothing downstream has
  # to care which kind it came from.
  def attachments_of(plan)
    out = []
    %w[nodes segments spaces].each do |kind|
      next unless plan[kind].is_a?(Array)
      plan[kind].each do |host|
        next unless host.is_a?(Hash)
        Array(host['attachments']).each do |att|
          next unless att.is_a?(Hash)
          out << {
            kind: kind,
            host_id: host['id'],
            path: att['objectPath'].to_s,
            object_id: att['objectId'].to_s,
            params: att['params'],
            baked: att['baked'],
          }
        end
      end
    end
    out
  end

  # "Objects/Architectural/wall.json" -> "Wall". The file name is the only name an attachment carries —
  # `baked` holds the geometry, not the definition's title.
  def object_name(path)
    base = File.basename(path.to_s, '.json')
    return 'Object' if base.empty?
    base.split(/[-_ ]/).map { |w| w.empty? ? w : w[0].upcase + w[1..-1].to_s }.join(' ')
  end

  # ── build ───────────────────────────────────────────────────────────────────────────────────────

  def build(model, plan, file_name)
    # Tags first, from the plan's own layer table, so names and visibility match the canvas even for
    # layers no mesh happens to reference.
    tags = 0
    Array(plan['layers']).each do |layer|
      next unless layer.is_a?(Hash)
      name = layer['name'].to_s
      next if name.empty?
      tag = model.layers[name] || model.layers.add(name)
      tag.visible = layer['visible'] != false
      tags += 1
    end

    # One group for the whole plan: it makes the import a single movable thing, and a second import of the
    # same file lands beside the first instead of merging into it.
    container = model.active_entities.add_group
    container.name = file_name

    variants = {}   # variant key (the mesh JSON) -> ComponentDefinition
    materials = {}
    placed = 0
    face_count = 0
    failed = 0
    skipped = 0
    by_object = Hash.new { |h, k| h[k] = { instances: 0, faces: 0 } }

    attachments_of(plan).each do |att|
      baked = att[:baked]
      meshes = baked.is_a?(Hash) ? Array(baked['meshes']) : []
      if meshes.empty?
        skipped += 1
        next
      end

      name = object_name(att[:path])
      key = JSON.generate(meshes)
      definition = variants[key]

      if definition.nil?
        definition = model.definitions.add(BakedObjectImporter.unique_definition_name(model, name))
        built = build_meshes(model, definition, meshes, materials)
        face_count += built[:faces]
        failed += built[:failed]
        definition.set_attribute('builderpluss', 'objectPath', att[:path])
        variants[key] = definition
      end

      anchor = Array(baked['anchor'])
      ax = anchor[0].to_f
      ay = anchor[1].to_f
      # Plan y runs SOUTH; SketchUp's +y is north. Same flip the vertices get.
      origin = Geom::Point3d.new(ax.m, -ay.m, 0)
      instance = container.entities.add_instance(definition, Geom::Transformation.new(origin))
      instance.name = name
      stamp(instance, att)

      placed += 1
      by_object[name][:instances] += 1
      by_object[name][:faces] += meshes.reduce(0) { |n, m| n + Array(m['faces']).length }
    end

    model.active_view.zoom(container)
    bounds = container.bounds

    Report.new(
      name: file_name,
      attachments: attachments_of(plan).length,
      placed: placed,
      definitions: variants.length,
      face_count: face_count,
      failed: failed,
      skipped: skipped,
      by_object: by_object,
      tags: tags,
      bounds_m: [bounds.width.to_m, bounds.height.to_m, bounds.depth.to_m],
      group: container,
    )
  end

  # Builds one variant's geometry inside `definition`. One group per mesh for the same reason the object
  # importer does it: SketchUp merges coplanar faces sharing an entities collection, and a window's glass
  # sitting flush in its frame would otherwise weld into it.
  def build_meshes(model, definition, meshes, materials)
    faces = 0
    failed = 0

    meshes.each do |mesh|
      next unless mesh.is_a?(Hash)
      group = definition.entities.add_group
      group.name = (mesh['name'] || mesh['id'] || 'Mesh').to_s

      material = BakedObjectImporter.material_for(model, mesh['color'], materials)
      tag = BakedObjectImporter.layer_for(model, mesh['layer'])
      group.layer = tag if tag

      Array(mesh['faces']).each do |ring|
        points = BakedObjectImporter.ring_points(ring)
        if points.length < 3
          failed += 1
          next
        end
        begin
          face = group.entities.add_face(points)
          if face
            face.material = material
            face.back_material = material
            faces += 1
          else
            failed += 1
          end
        rescue ArgumentError, TypeError
          failed += 1
        end
      end
    end

    { faces: faces, failed: failed }
  end

  # Which attachment this instance came from. Nothing reads it yet; it is what a later "re-bake this
  # instance" or a plan/model diff would need, and it costs nothing to write now.
  def stamp(instance, att)
    instance.set_attribute('builderpluss', 'objectPath', att[:path])
    instance.set_attribute('builderpluss', 'objectId', att[:object_id])
    instance.set_attribute('builderpluss', 'hostKind', att[:kind])
    instance.set_attribute('builderpluss', 'hostId', att[:host_id].to_s)
    instance.set_attribute('builderpluss', 'params', JSON.generate(att[:params] || {}))
  end

  # ── report ──────────────────────────────────────────────────────────────────────────────────────

  def report_text(report)
    lines = []
    lines << report.name
    lines << "  attachments   #{report.attachments}"
    lines << "  placed        #{report.placed} instances of #{report.definitions} definitions"
    lines << "  faces         #{report.face_count}#{report.failed > 0 ? "   (#{report.failed} skipped)" : ''}"
    lines << "  tags          #{report.tags}"
    lines << ''

    unless report.by_object.empty?
      lines << 'Objects:'
      report.by_object.sort_by { |_, v| -v[:instances] }.each do |name, v|
        lines << format('  %-14s %3d x   %5d faces', name, v[:instances], v[:faces])
      end
      lines << ''
    end

    lines << format('Extent (m):  %.3f x %.3f x %.3f',
                    report.bounds_m[0], report.bounds_m[1], report.bounds_m[2])

    if report.skipped > 0
      lines << ''
      lines << "#{report.skipped} attachment(s) carried no 3D geometry and were skipped."
    end
    if report.failed > 0
      lines << "#{report.failed} face(s) were skipped (degenerate or non-planar rings)."
    end

    lines.join("\n")
  end
end

# The toolbar command. `create_menu_item` builds `UI::Command.new(name) { self.send(name) }` against Main,
# so the button needs a method of exactly this name — see BakedObjectImporter for the same pattern.
module Main
  def self.import_floorplan
    FloorplanImporter.prompt_and_import
  end
end
