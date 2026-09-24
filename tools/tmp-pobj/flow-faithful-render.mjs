/** Faithful_Space_Render.json — five nodes. The Plan JSON node is gone: the GEOMETRY node publishes the
 *  canvas payload itself, on `val-canvasJson`.
 *
 *  Asking the canvas what a room LOOKS like and what it IS used to take two nodes, and two nodes can hold
 *  two different ideas of which room they mean. The Geometry node now answers both: its geometry output is
 *  the region, and `val-canvasJson` is every wall, door, window and object on the plan with its real
 *  dimensions and its `semantics`. One node, one answer.
 *
 *    Geometry ──▶ ORCHESTRATOR ──▶ Filter by Space ──▶ Render
 *      id/points/json  ["Element",  │   points · json · margin      ▲
 *                       "Vertices", └──▶ Snapshot ─────────────────┘
 *                       "Margin",   │      points · margin
 *                       "Json"]     └──▶ Output Metrics ("Element")
 *
 *   • GEOMETRY is the region — the canvas selection, or a space pinned by id. Its three answers go to the
 *     orchestrator and nowhere else: `val-id` onto "Element" (the `space-…` id the canvas shows, which
 *     leaves again on the Output Metrics row so a finished run names its own subject), `val-points` onto
 *     "Vertices", and `val-canvasJson` onto "Json".
 *   • THERE IS NO GEOMETRY WIRE IN THIS FLOW. The region travels as a point LIST the whole way: Filter by
 *     Space and Snapshot each take it on their own `valin-points`. The graph used to carry that outline
 *     TWICE — once through the left/right geometry handles and once as the value shown on the panel — so
 *     one of the two could be rewired and the flow would keep looking correct while framing something the
 *     data did not describe. One representation now, and it is the one you can read.
 *   • THE PAYLOAD IS THE WHOLE CANVAS, never pre-scoped — that is deliberate, and it is what makes Filter
 *     by Space work: the region on one input, everything on the other, and one Margin deciding what falls
 *     between them.
 *   • THE ORCHESTRATOR forwards the region, unchanged, to every consumer on its right handle — Input
 *     Properties has done that for any Space since it existed, which is why no Vertices or Polygon node is
 *     needed to turn a coordinate list back into a shape.
 *   • MARGIN is the catchment, published once and wired to BOTH consumers, so the payload Filter by Space
 *     cuts and the frame Snapshot photographs can never drift apart. That was the real bug in the older
 *     shape: the framing was Plan JSON's `edgeTolerance` while the picture was a whole-canvas shot — two
 *     different regions arriving at one model.
 *
 *  Kept from the harness work (tools/tmp-pobj/harness), because both were measured, not assumed:
 *   • CATCHMENT 0.15 m — the Margin parameter's default. Swept against a known-good answer on a bedroom
 *     with a neighbour next door: 0 m loses the window; 0.15–0.5 m is exactly right; from 1 m the
 *     neighbour's sofa arrives.
 *   • THE AXIS SENTENCE. +y is DOWN. Without it a model assuming the maths convention mirrors the room
 *     and the door and window swap walls.
 */
const N = (id, tool, x, y, params = {}) => ({ id, position: { x, y }, data: { tool, params } });
const V = (id, s, t, o, i) => ({ id, source: s, target: t, sourceHandle: `val-${o}`, targetHandle: `valin-${i}` });

export const HANDLES = {
  // The Geometry node (Space kind): the region on its geometry output, its outline on `val-points`, and
  // the whole canvas as a payload on `val-canvasJson` — the Plan JSON node folded into it.
  source:             { geomOut: true, vout: ["id", "points", "canvasJson"], root: true },
  "input-props":      { geomIn: true, geomOut: true, dynamicVin: true, dynamicVout: true, root: true },
  "filter-by-space":  { geomIn: true, vin: ["points", "json", "margin"], vout: ["json", "margin", "spaceCount", "segmentCount", "nodeCount", "objectCount", "bytes"] },
  snapshot:           { geomIn: true, vin: ["points", "margin"], vout: ["image", "image-3d"], root: true },
  render:             { geomIn: true, vin: ["image", "image3d", "prompt", "systemPrompt"], aboveGate: true },
  output:             { dynamicVin: true, dynamicVout: true },
};

/** The test bedroom from the harness canvas — 4.76 x 3.76 m at the origin, in METRES. It is the FALLBACK
 *  the "Vertices" parameter shows before the Space node's outline arrives on the wire, and what the
 *  parameter reverts to if that wire is unplugged. */
const DEFAULT_REGION = "[[0,0],[4.76,0],[4.76,3.76],[0,3.76]]";

/** Everything that does not change from run to run. The per-run "prompt" is the scoped canvas JSON. */
const SYSTEM = [
  "You are an architectural visualiser. You are given a 2D floor plan image, a top-down 3D view of the same subject, and — as your prompt — the exact model data behind them as JSON. Render the highlighted space photorealistically. Your job is materials, light and interpretation. NOTHING ELSE.",
  "",
  "READING THE DATA. `space.boundary` is the room's outline as [x, y] points in METRES and it is also your FRAME — take the room's extent from its smallest and largest x and y. `segments` are the walls, doors and windows, each running `from` to `to`. `nodes` are the objects, each at its centre point `at`. Every entry carries its real dimensions, and most carry `params.semantics`.",
  "",
  "COORDINATE FRAME, and read this before placing anything: +x is RIGHT in the image and +y is DOWN - the screen convention, NOT the maths convention. An object at a LARGER y is LOWER in the picture. Getting this backwards mirrors the room vertically and puts every door and window on the wrong wall.",
  "",
  "THREE RULES. They are not preferences, and nothing in the data relaxes them.",
  "",
  "1. THE ORIENTATION OF THE SPACE DOES NOT CHANGE. Render the room at the orientation it is drawn. Do not rotate the plan, do not mirror or flip it on either axis, do not straighten an angled wall, do not re-square a room that is not square, do not swap which wall is which. The outline in `space.boundary` is the room's true shape and the order of its points is its true orientation. If your instinct says the room would compose better turned, ignore it.",
  "",
  "2. THE PLACEMENT OF EVERY OBJECT, DOOR AND WINDOW DOES NOT CHANGE. Each object sits at its `at` point, which is its CENTRE, turned to its `rotation` in degrees. Each door and window occupies exactly the wall segment from its `from` to its `to`, at its stated width - on THAT wall, at THAT position along it, not centred on the wall and not slid to a tidier spot. Never move, rotate, resize, add, remove, duplicate or substitute anything. Never add furniture that is not in the data, however empty a corner looks. Never omit an object because it seems crowded. The count in the data is the count in the render.",
  "",
  "3. EVERY OBJECT IS BUILT STRICTLY FROM ITS OWN `semantics`. That line is the specification for how that piece looks - its material, finish, era and character - and it is binding. A bed whose semantics read 'modern king bed, upholstered headboard, oak legs, crisp linen' is that bed and not a generic one; a door reading 'oak veneer, matte finish, brushed steel handle' has an oak veneer leaf and a brushed steel handle. Read each object's semantics separately and give each what its OWN line says. Do not average them into one house style, do not carry one object's material onto another, and do not substitute your own taste for any object that has a semantics line. Only where an object has none may you infer something plain and consistent with its neighbours.",
  "",
  "THE TWO IMAGES SHOW THE SAME REGION, framed identically: the plan as drawn, and the model seen from straight above. Read the plan for what the geometry IS and the top view for how it stands. Where they appear to disagree with each other, or with the data, the DATA is right — both pictures are schematic drawings of it.",
  "",
  "STYLE, unless the data says otherwise: warm natural daylight through the windows, gentle contact shadows, no harsh sun. Restrained contemporary palette, lived-in but tidy. Neutral white balance, no people, no text, no dimension lines, no watermark. Calm architectural-photography realism.",
].join("\n");

const nodes = [
  // ── The one root ──────────────────────────────────────────────────────────────────────────────────
  // Geometry (Space kind). It answers both halves: the selected room as GEOMETRY and on `val-points`, and
  // the whole plan as a payload on `val-canvasJson`. No Plan JSON node beside it, and nothing that can
  // disagree with it about which room is meant.
  N("geom", "source", -960, 60, { grabFromSelection: true, id: "", nodeLabel: "Geometry (region + canvas)" }),

  // ── THE ORCHESTRATOR ──────────────────────────────────────────────────────────────────────────────
  // Titled for the job it does rather than as decoration: every per-run input arrives here and every
  // consumer is driven from here. THE GEOMETRY GOES THROUGH IT TOO — Input Properties forwards the region
  // on its left handle out of its right one unchanged — so the region, the payload and the catchment all
  // leave from one place.
  N("props", "input-props", -600, 60, { nodeLabel: "Orchestrator", props: [
    // WHICH element this run is about — "space-…", the id the canvas shows and the export writes. Read-only
    // in practice: the Geometry node drives it, and it is the one thing on this panel that identifies the
    // subject rather than describing it. It leaves again on the Output Metrics row, so a finished run says
    // what it rendered instead of leaving you to match coordinates by eye.
    { id: "element", name: "Element", type: "text", value: "", options: [],
      editable: false, necessary: true },
    // Driven by the Geometry node's `val-points`, so the panel shows the outline the run is actually using.
    // Left as a TEXT parameter rather than a hidden readout because unplugging it makes the region typeable.
    { id: "vertices", name: "Vertices", type: "text", value: DEFAULT_REGION, options: [],
      editable: true, necessary: true },
    { id: "margin", name: "Margin", type: "range", value: 0.15, min: 0, max: 2, step: 0.05,
      editable: true, necessary: true },
    { id: "json", name: "Json", type: "text", value: "", options: [],
      // Driven by the Geometry node's `val-canvasJson` on every run, so the control is a read-only readout.
      editable: false, necessary: true },
  ] }),

  // ── Scope, then photograph, then render ──────────────────────────────────────────────────────────
  // Cuts the whole-canvas payload down to the region + Margin. `objectsOnly` stays OFF: the plain walls
  // are what give the model the room's shape.
  N("filter", "filter-by-space", -240, 220, { margin: 0.15, objectsOnly: false, includeNodes: true, decimals: 3 }),
  // Scope "selected" is what makes the geometry input and the Margin mean anything — "whole" ignores both
  // and photographs the entire canvas, which is the region mismatch this flow exists to remove.
  N("snap", "snapshot", -240, -40, { scope: "selected", margin: 0.15 }),

  N("render", "render", 140, 60, {
    api_key: "", model: "gemini-3.1-flash-image-preview", padding: 1.5,
    systemPrompt: SYSTEM, prompt: "",
  }),

  N("out", "output", 140, 360, { slots: [
    { id: "s0", label: "Element" },
    { id: "s1", label: "Margin (m)" },
    { id: "s2", label: "Spaces in scope" },
    { id: "s3", label: "Segments in scope" },
    { id: "s4", label: "Attached objects" },
    { id: "s5", label: "Scoped JSON size (B)" },
  ] }),
];

const edges = [
  // NOT ONE GEOMETRY WIRE. The region is a LIST here, start to finish: the Geometry node publishes the
  // outline as `val-points`, the orchestrator holds it on "Vertices", and both consumers take it on their
  // own `valin-points`. The graph used to carry the same outline twice — once through the left/right
  // geometry handles and once as the value on the panel — which is two things to keep in step and a wire
  // that crossed the whole canvas to say what the value already said.
  //
  // 1. WHICH element, WHAT shape, and WHAT is on the plan — three values, one node, one place to read them.
  V("e_geom_props_id", "geom", "props", "id", "element"),
  V("e_geom_props_verts", "geom", "props", "points", "vertices"),
  V("e_geom_props_json", "geom", "props", "canvasJson", "json"),

  // 2. Filter by Space: the region as a list, the payload, and the catchment — all off the orchestrator.
  V("e_props_filter_points", "props", "filter", "vertices", "points"),
  V("e_props_filter_json", "props", "filter", "json", "json"),
  V("e_props_filter_margin", "props", "filter", "margin", "margin"),

  // 3. Snapshot frames the SAME list grown by the SAME margin, so the picture and the payload agree.
  V("e_props_snap_points", "props", "snap", "vertices", "points"),
  V("e_props_snap_margin", "props", "snap", "margin", "margin"),

  // 4. Render gets both pictures and the scoped data as its prompt. NO region wire: `padding` and the
  //    geometry input only frame the node's OWN 3D capture, which never runs here — both images are wired,
  //    and wired images win. A region wire would have been decoration.
  V("e_snap_render_img", "snap", "render", "image", "image"),
  V("e_snap_render_3d", "snap", "render", "image-3d", "image3d"),
  V("e_filter_render_prompt", "filter", "render", "json", "prompt"),

  // 5. The diagnostics: what the run was about, then whether the scope caught what you meant. Both read
  //    back off the node that USED the value, not off the control that set it.
  V("e_props_out_s0", "props", "out", "element", "s0"),
  V("e_filter_out_s1", "filter", "out", "margin", "s1"),
  V("e_filter_out_s2", "filter", "out", "spaceCount", "s2"),
  V("e_filter_out_s3", "filter", "out", "segmentCount", "s3"),
  V("e_filter_out_s4", "filter", "out", "objectCount", "s4"),
  V("e_filter_out_s5", "filter", "out", "bytes", "s5"),
];

export const flow = {
  version: 1,
  id: "Faithful_Space_Render",
  title: "Faithful Space Render — one Geometry node, one Orchestrator, three consumers",
  category: "Architectural",
  description: `Six nodes. Type or wire the region's vertices, set one Margin, press Generate.

  WHAT THE MODEL RECEIVES. The PLAN as drawn and the same region from straight ABOVE (both from the Snapshot node), plus the exact model data behind them as JSON — every wall, door, window and object in the region with its real position, dimensions and \`semantics\`. The standing rules live in the Render node's system prompt, which is sent as \`systemInstruction\` rather than folded into the prompt, so they cannot be diluted by the data.

  THE ORCHESTRATOR IS THE MIDDLE NODE, and it is the one to look at first. It is an Input Properties node named for its job: the two roots hand it everything a run needs (the region's vertices, the whole-canvas Plan JSON) and everything downstream — Polygon, Filter by Space, Snapshot, and through them Render — is driven from it. No consumer reads a source directly, so there is exactly one place to see what a run was given and one place to change it. Attach this flow to a Space and that same node becomes the Space's Properties tab, which is why it holds the parameters rather than the nodes that use them.

  THE SCOPING IS THE FLOW'S. The Canvas node emits the whole payload and Filter by Space cuts it down to the region — the selection, forwarded by the orchestrator — grown by the Margin. Select a different room and the payload, the photograph and the camera all follow it together, because all three read the same forwarded geometry.

  ONE MARGIN, TWO CONSUMERS, AND THAT IS THE POINT. The same published number scopes the payload (Filter by Space) and frames the photographs (Snapshot). In the previous version those were two different settings on two different nodes — the JSON was cut with Plan JSON's catchment while the picture was a whole-canvas shot — so the model was handed data for one region and an image of another. It cannot drift now: there is one value and one wire to each.

  ONE NODE ASKS THE CANVAS EVERYTHING. The Geometry node publishes the element's ID on \`val-id\`, the region on its geometry output, the region's outline on \`val-points\`, and the WHOLE plan — every wall, door, window and object with its real dimensions and its own \`semantics\` — on \`val-canvasJson\`. That last output is the Plan JSON node folded in. Two nodes used to answer those questions and they could disagree about which room they meant; there is one answer now, and it is why this flow has no Plan JSON node, no Vertices node and no Polygon node.

  THE PAYLOAD IS NEVER PRE-SCOPED. \`val-canvasJson\` is always the whole canvas, on purpose: the Geometry node says what the region IS, and narrowing the payload to it is Filter by Space's job. That separation is what lets one Margin decide the catchment for both the data and the picture, instead of a tolerance buried on one node quietly deciding the data while a whole-canvas snapshot decided the picture.

  MARGIN 0.15 m IS MEASURED, NOT GUESSED. Swept against a known-good answer on a bedroom with a neighbour sharing a wall: at 0 m the WINDOW is lost, because a boundary segment's midpoint lies exactly ON the outline and a point on the edge is undefined under even-odd ray casting. From 0.15 to 0.5 m the payload is exactly right — every object in the room and nothing else. At 1 m the neighbour's sofa appears; by 3 m their far wall too. A bigger buffer does not add context, it adds rooms the render should not contain. Raise it to 0.3 if a wall is genuinely missing; past 0.5, check what came with it. Note it also grows the PICTURE now, which is the honest behaviour: you see the region you are actually sending.

  THE AXIS SENTENCE EARNS ITS PLACE. Coordinates are metres with +y DOWN. A model assuming the maths convention (+y up) mirrors the room vertically — in the test bedroom the door at y=0 and the window at y=3.76 swap walls, which is exactly the failure this flow exists to prevent. If you edit the system prompt, keep that paragraph.

  THE RUN NAMES ITS SUBJECT. \`val-id\` is the element's own id — \`space-a7a0…\`, the same string the Properties panel shows and the export carries — and it is wired to the orchestrator's "Element" parameter, not straight to a readout. That keeps the rule the rest of the flow follows (every per-run input arrives at one node) and it is what makes the Output Metrics row worth reading: Element, Margin, then the four counts that say whether the scope caught what you meant. Rendering the wrong room used to look exactly like rendering the right one.

  ORDER OF OPERATIONS. Set the vertices → set the Margin → read the Output Metrics (margin, spaces, segments, attached objects, JSON size) to confirm the scope caught what you meant → press Generate. The Snapshot re-photographs itself whenever the canvas, the region or the Margin changes, so there is nothing to press for it. Open the 3D view first if you want the top-down image sent too; without it the plan goes alone.

  WHAT IS NOT VERIFIED. The payload, the scoping and the prompt are tested against a harness; the RENDERED IMAGE is not. If things do move, the failure shape says where to look: mirrored vertically means the axis paragraph was lost, missing objects means the Margin, wrong materials means rule 3.`,
  nodes,
  edges,
};
