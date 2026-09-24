# Reads a BAKED BuilderPluss object and builds it as a SketchUp component.
#
# This file knows NOTHING about parametric objects, spines, flows or the Math Engine. It reads
# `resolved.meshes` — plain face rings, already evaluated — and draws them. Every question about what the
# geometry MEANS was answered by `npm run bake` before the file got here, which is the whole point: the
# evaluator is 8k lines of TypeScript and there is exactly one of it.
#
# FRAME. `resolved.frame` states its own convention rather than leaving it to be inferred:
#
#     metres · x east · y SOUTH (down the plan page) · z up
#
# SketchUp is z-up with +y NORTH and works internally in inches. So the whole conversion is one line —
# `Geom::Point3d.new(x.m, -y.m, z.m)` — and it is in `ring_points` and nowhere else. If an import ever comes
# in mirrored or 39x too big, that method is the only place to look.
#
# The `Main.import_baked_object` shim at the bottom is what the toolbar calls, so Main.rb needs only a
# `require` and one `create_menu_item` line rather than carrying any of this.

require 'sketchup.rb'
require 'json'

# The dynamic (formula) importer is OPTIONAL: a syntax error in a new file must not take the working baked
# import down with it, because they share one button. If it fails to load, the button keeps doing what it
# always did and the reason goes to the Ruby Console.
begin
  require 'builderpluss/Classes/DynamicObjectImporter'
rescue StandardError, ScriptError => e
  puts "BuilderPluss: dynamic object importer unavailable - #{e.class}: #{e.message}"
end

module BakedObjectImporter

  # Bumped when the bake's `resolved` shape changes in a way this reader must notice. A file written by a
  # newer bake is REFUSED rather than half-read: silently importing an object whose fields have moved is
  # worse than not importing it.
  SUPPORTED_SCHEMA = 1

  # Fallback when a mesh carries no colour, matching the resolver's own default.
  DEFAULT_COLOR = '#94a3b8'.freeze

  # Points closer than this (inches) are the same point. Only used to drop duplicates a ring may carry;
  # far below anything the geometry itself distinguishes.
  WELD = 1e-6

  # Index matches `bounds_m`: SketchUp's BoundingBox reports width as x, height as y, depth as z.
  AXES = [['Length', 0], ['Width', 1], ['Height', 2]].freeze
  TOLERANCE = 1e-3

  Report = Struct.new(
    :name, :source_hash, :baked_at, :mesh_count, :face_count, :failed,
    :metrics, :bounds_m, :params, :instance,
    keyword_init: true,
  )

  module_function

  # ── entry point ─────────────────────────────────────────────────────────────────────────────────

  def prompt_and_import
    path = UI.openpanel('Select a BuilderPluss object (baked or dynamic)', '', 'JSON Files|*.json||')
    return if path.nil? # cancelled

    # ONE BUTTON, TWO KINDS OF FILE. A `.skpir.json` carries TRANSLATED FORMULAS rather than baked meshes,
    # and builds a Dynamic Component whose parameters stay live. The file says which it is, so the dispatch
    # is a peek at one key rather than a second toolbar button whose difference nobody remembers.
    if dynamic_ir?(path)
      unless defined?(DynamicObjectImporter)
        raise 'This is a dynamic object file, but DynamicObjectImporter.rb did not load. See the Ruby Console.'
      end
      report = DynamicObjectImporter.import(path)
      UI.messagebox(DynamicObjectImporter.report_text(report))
    else
      report = import(path)
      UI.messagebox(report_text(report))
    end
  rescue StandardError => e
    UI.messagebox("Import failed.\n\n#{e.message}")
  end

  # True when the file is a SketchUp IR (formulas) rather than a bake (meshes). Reads only the head: a bake
  # with its meshes inline runs to megabytes and there is no reason to parse one twice to find out.
  def dynamic_ir?(path)
    File.read(path, 2048).to_s.include?('builderpluss.sketchup-ir/')
  rescue StandardError
    false
  end

  def import(path)
    doc = JSON.parse(File.read(path, encoding: 'UTF-8'))
    resolved = validate(doc, path)

    model = Sketchup.active_model
    # `true` disables UI refresh while building — the single biggest speed lever, and it makes the whole
    # import one undo step rather than one per face.
    model.start_operation('Import Baked Object', true)
    begin
      report = build(model, resolved)
      model.commit_operation
      report
    rescue StandardError
      model.abort_operation
      raise
    end
  end

  # ── validation ──────────────────────────────────────────────────────────────────────────────────

  # Every failure here names what to do about it. A user who picked the wrong file should not have to read
  # the bake script to find out that is what happened.
  def validate(doc, path)
    unless doc.is_a?(Hash)
      raise "#{File.basename(path)} is not a JSON object."
    end

    resolved = doc['resolved']
    if resolved.nil?
      raise "#{File.basename(path)} has no `resolved` block, so it has not been baked.\n\n" \
            "Bake it first:\n    npm run bake -- <object.json>"
    end

    schema = resolved['schema']
    unless schema == SUPPORTED_SCHEMA
      raise "This file was written by bake schema #{schema.inspect}, and this plugin reads " \
            "#{SUPPORTED_SCHEMA}.\n\nUpdate one side to match the other."
    end

    units = resolved['frame'] && resolved['frame']['units']
    unless units == 'm'
      raise "The file's frame is in #{units.inspect}; this plugin expects metres."
    end

    meshes = resolved['meshes']
    unless meshes.is_a?(Array) && !meshes.empty?
      raise "No 3D meshes in `resolved`.\n\nCheck the object's 3D Render rows are wired and not hidden."
    end

    resolved
  end

  # ── build ───────────────────────────────────────────────────────────────────────────────────────

  def build(model, resolved)
    object = resolved['object'] || {}
    name = (object['name'] || 'Object').to_s
    definition = model.definitions.add(unique_definition_name(model, name))

    materials = {}
    face_count = 0
    failed = 0

    # ONE GROUP PER MESH, always — not a tidiness choice. SketchUp merges coplanar faces that share an
    # entities collection, so a mattress sitting flush on a divan would lose the edge between them and come
    # out as one welded lump. Separate groups keep the members separable.
    resolved['meshes'].each do |mesh|
      group = definition.entities.add_group
      group.name = (mesh['name'] || mesh['id'] || 'Mesh').to_s

      material = material_for(model, mesh['color'], materials)
      layer = layer_for(model, mesh['layer'])
      group.layer = layer if layer

      Array(mesh['faces']).each do |ring|
        points = ring_points(ring)
        if points.length < 3
          failed += 1
          next
        end

        begin
          face = group.entities.add_face(points)
          if face
            face.material = material
            # Winding is not guaranteed yet, so a face may arrive back-side-out and would otherwise render
            # as SketchUp's default blue. Painting both sides makes the pilot look right; the real fix is
            # orienting faces against the group centroid.
            face.back_material = material
            face_count += 1
          else
            failed += 1
          end
        rescue ArgumentError, TypeError
          # Degenerate or non-planar ring. Counted and reported rather than aborting the import — one bad
          # face should not cost the user the other fifty-three.
          failed += 1
        end
      end
    end

    instance = model.active_entities.add_instance(definition, Geom::Transformation.new)
    instance.name = name
    stamp(instance, definition, resolved)
    model.active_view.zoom(instance)

    bounds = instance.bounds
    Report.new(
      name: name,
      source_hash: resolved['sourceHash'].to_s,
      baked_at: resolved['bakedAt'].to_s,
      mesh_count: resolved['meshes'].length,
      face_count: face_count,
      failed: failed,
      metrics: Array(resolved['metrics']),
      bounds_m: [bounds.width.to_m, bounds.height.to_m, bounds.depth.to_m],
      params: resolved['params'] || {},
      instance: instance,
    )
  end

  # ── geometry ────────────────────────────────────────────────────────────────────────────────────

  # Baked metres in the plan frame -> SketchUp inches. The `-y` is the plan's south-positive axis meeting
  # SketchUp's north-positive one; `.m` is metres -> inches. THE ONLY PLACE either happens.
  def ring_points(ring)
    return [] unless ring.is_a?(Array)

    points = []
    ring.each do |p|
      next unless p.is_a?(Array) && p.length >= 3
      point = Geom::Point3d.new(p[0].to_f.m, -p[1].to_f.m, p[2].to_f.m)
      # Consecutive duplicates make `add_face` raise; drop them rather than let one malformed ring take out
      # the mesh it belongs to.
      points << point unless points.last && points.last.distance(point) < WELD
    end
    points.pop if points.length > 1 && points.first.distance(points.last) < WELD
    points
  end

  # ── model resources ─────────────────────────────────────────────────────────────────────────────

  def material_for(model, hex, cache)
    hex = DEFAULT_COLOR unless hex.is_a?(String) && hex =~ /\A#[0-9a-fA-F]{6}\z/
    return cache[hex] if cache.key?(hex)

    material = model.materials[hex] || model.materials.add(hex)
    material.color = Sketchup::Color.new(
      hex[1, 2].to_i(16), hex[3, 2].to_i(16), hex[5, 2].to_i(16)
    )
    cache[hex] = material
  end

  # The mesh's canvas layer becomes a SketchUp tag of the same name, reused when it already exists so a
  # second import does not litter the model with "Bed", "Bed#1", "Bed#2".
  def layer_for(model, name)
    return nil unless name.is_a?(String) && !name.empty?
    model.layers[name] || model.layers.add(name)
  end

  def unique_definition_name(model, base)
    return base unless model.definitions[base]
    n = 2
    n += 1 while model.definitions["#{base} #{n}"]
    "#{base} #{n}"
  end

  # Provenance for a round trip that does not exist yet: which definition this came from, when, and the
  # parameters it was frozen at. Nothing reads these today — they are what makes a "re-bake this instance"
  # command possible later without the user having to remember any of it.
  def stamp(instance, definition, resolved)
    instance.set_attribute('builderpluss', 'sourceHash', resolved['sourceHash'].to_s)
    instance.set_attribute('builderpluss', 'bakedAt', resolved['bakedAt'].to_s)
    instance.set_attribute('builderpluss', 'bakedFrom', resolved['bakedFrom'].to_s)
    instance.set_attribute('builderpluss', 'params', JSON.generate(resolved['params'] || {}))
    definition.set_attribute('builderpluss', 'sourceHash', resolved['sourceHash'].to_s)
  end

  # ── report ──────────────────────────────────────────────────────────────────────────────────────

  # THE SELF-TEST. The baked file carries Overall length / width / height as metrics, so a correct import
  # can prove itself: measure the instance's bounding box and compare. A match means the metre conversion
  # and the axis flip are both right. A mismatch localises the bug before anyone squints at the model —
  # everything 39.37x too large is a double conversion, a swapped Length and Width is the axis mapping.
  def expected_bounds(metrics)
    want = [nil, nil, nil]
    metrics.each do |m|
      label = m['name'].to_s.downcase
      AXES.each do |axis, i|
        want[i] = m['value'].to_f if label.include?("overall #{axis.downcase}")
      end
    end
    want
  end

  def report_text(report)
    lines = []
    lines << report.name
    lines << "  hash      #{report.source_hash}"
    lines << "  baked     #{report.baked_at}"
    lines << "  meshes    #{report.mesh_count}"
    lines << "  faces     #{report.face_count}#{report.failed > 0 ? "   (#{report.failed} skipped)" : ''}"
    lines << ''

    want = expected_bounds(report.metrics)
    if want.compact.empty?
      lines << 'Bounding box (m):'
      AXES.each do |axis, i|
        lines << format('  %-8s %.4f', axis, report.bounds_m[i])
      end
    else
      lines << 'Bounding box vs baked metrics (m):'
      ok = true
      AXES.each do |axis, i|
        got = report.bounds_m[i]
        exp = want[i]
        if exp.nil?
          lines << format('  %-8s %8.4f   (no metric)', axis, got)
        else
          match = (got - exp).abs <= TOLERANCE
          ok &&= match
          lines << format('  %-8s %8.4f   expected %8.4f   %s', axis, got, exp, match ? 'OK' : 'MISMATCH')
        end
      end
      lines << ''
      lines << (ok ? 'Geometry matches the baked metrics.' : 'MISMATCH - check the unit and axis mapping.')
    end

    if report.failed > 0
      lines << ''
      lines << "#{report.failed} face(s) were skipped (degenerate or non-planar rings)."
    end

    lines.join("\n")
  end
end

# The toolbar command. `create_menu_item` builds `UI::Command.new(name) { self.send(name) }` against Main,
# so the button needs a method of exactly this name here; keeping it in this file rather than in Main.rb
# holds that file's diff to a require and one menu line.
module Main
  def self.import_baked_object
    BakedObjectImporter.prompt_and_import
  end
end
