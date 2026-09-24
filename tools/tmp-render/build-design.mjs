/** THE DELIVERABLE — `floorplan_with_bedroom_improved.json`.
 *
 *  Everything the five earlier steps built, applied to the one plan that has actually been rendered,
 *  so the difference between the old output and the new one is attributable rather than asserted.
 *
 *  SIX THINGS CHANGE, in order of how much they move the picture:
 *
 *   1. MATERIALS ARE BOUND. Every attachment gains `materialPath` and, where it has more than one
 *      finish, `finishes`. Before this the plan said "light oak veneer, matte lacquer" in prose
 *      forty-nine times and not one row pointed at a material file, so the renderer assigned by
 *      category rules that knew nothing about this design.
 *   2. THERE IS A WORLD OUTSIDE THE GLASS. `exterior-context` puts ground and massing beyond the
 *      west window. That window is the white rectangle in view2, and no lighting work can touch it
 *      because the defect is that there was nothing out there.
 *   3. THE SCENE IS IN THE PLAN. `render-look` carries engine, samples, sun, bevel, glare and white
 *      balance, instead of the render script deciding all of it.
 *   4. THE ROOM IS FURNISHED. Bedding, cushions, clutter, real plants, switches, sockets, a cornice,
 *      a shadow gap, a grille, a pelmet.
 *   5. THE CAMERAS ARE CAMERAS. Lens shift, near clip, minimum clearance, depth of field and a shot
 *      list — including the clearance that would have caught the plant in view1's lens.
 *   6. THE PARAM NAMES ARE THE CURRENT ONES. The old plan says `ceilingHeight`, `tilt` and
 *      `coneAngle`; the library renamed all three. Left alone, every downlight in this room would
 *      quietly fall back to a 2.7 m ceiling and a zero gimbal.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { FINISHES } from "./patch-objects.mjs";

const SRC = "tools/tmp-render/live/Designs/floorplan_with_bedroom_render.json";
const OUT = "tools/tmp-render/out/Designs/floorplan_with_bedroom_improved.json";
mkdirSync("tools/tmp-render/out/Designs", { recursive: true });

const plan = JSON.parse(readFileSync(SRC, "utf8"));
const PPM = plan.settings.pixelsPerMeter;          // canvas units per metre
const stemOf = (a) => String(a.objectPath || "").split("/").pop().replace(/\.json$/, "");
const allAtt = () => [
  ...plan.nodes.flatMap((h) => (h.attachments || []).map((a) => [h, a])),
  ...plan.segments.flatMap((h) => (h.attachments || []).map((a) => [h, a])),
  ...(plan.spaces || []).flatMap((h) => (h.attachments || []).map((a) => [h, a])),
];

let nid = 60, aid = 900, mid = 900;
/** A node-hosted object needs a node AND a degenerate marker segment from that node to itself.
 *
 *  This is not decoration. `tools/bakeplan` re-derives every node position from the SEGMENT
 *  endpoints — a node's attachments are keyed by a stable key naming the segments meeting there — so
 *  a free-floating node has no key, and the baker drops it without a word. Twelve objects went
 *  missing from the first build of this plan exactly that way: the bake reported 63 attachments out
 *  of 75 and nothing said which twelve or why.
 *
 *  A node is an endpoint, not a point. The canvas already knows this and writes `obj-xxx` markers of
 *  its own for every fitting in the original plan; this just does the same thing. */
const newNode = (x, y, layer, objectPath, params) => {
  const id = `n${nid++}`;
  plan.nodes.push({
    id, x, y, layer,
    attachments: [{
      id: `att-${(aid++).toString(36)}`,
      objectId: objectPath.split("/").pop().replace(/\.json$/, "") + "-with-math",
      objectPath, params, t: 0, flip: false,
    }],
  });
  plan.segments.push({
    id: `obj-${(mid++).toString(36)}`,
    fromNodeId: id, toNodeId: id, layer,
    thickness: 0.5, color: "#334155", dashed: false, mode: "line", method: "center", segmentType: "wall",
  });
  return id;
};
/** A second object on an EXISTING node — bedding on the bed, clutter on a nightstand.
 *
 *  Not a new node at the same coordinates: the baker keys node positions by `${x},${y}` and two
 *  nodes on the same point collide, after which BOTH disappear. The bed and its bedding did exactly
 *  that. Sharing the node is also what the objects mean — bedding belongs to the bed. */
const addToNode = (nodeId, objectPath, params) => {
  const node = plan.nodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`no node ${nodeId}`);
  (node.attachments ||= []).push({
    id: `att-${(aid++).toString(36)}`,
    objectId: objectPath.split("/").pop().replace(/\.json$/, "") + "-with-math",
    objectPath, params, t: 0, flip: false,
  });
  return nodeId;
};
const addToSegment = (segId, objectPath, params) => {
  const seg = plan.segments.find((s) => s.id === segId);
  if (!seg) throw new Error(`no segment ${segId}`);
  (seg.attachments ||= []).push({
    id: `att-${(aid++).toString(36)}`,
    objectId: objectPath.split("/").pop().replace(/\.json$/, "") + "-with-math",
    objectPath, params, t: 0.5, flip: false,
  });
};
/** A segment's true length in METRES, from its own endpoints.
 *
 *  This exists because of a trap that costs an object its ELEVATION, not just its size. `fitMode:
 *  "Exact"` makes FIT compute `scale = available / natural` and then EVERY dimension in the body is
 *  multiplied by it — including `ceilingHeight`. A 3 m cornice fitted to a 0.45 m skirting run bakes
 *  at scale 0.15, so its ceiling lands at 0.47 m and the cornice sits at knee height, silently and
 *  in plan-correct position. Ten of them did exactly that in the first build of this file.
 *
 *  So: never fit a run whose body also carries a height. State the length and leave fitMode Off. */
const segLength = (segId) => {
  const seg = plan.segments.find((x) => x.id === segId);
  const a = plan.nodes.find((n) => n.id === seg.fromNodeId);
  const b = plan.nodes.find((n) => n.id === seg.toNodeId);
  return Math.hypot(b.x - a.x, b.y - a.y) / PPM;
};
const layer = (id, name, color, order) => {
  if (!plan.layers.some((l) => l.id === id)) plan.layers.push({ id, name, color, visible: true, locked: false, order });
};

const report = { bound: 0, renamed: 0, lamps: 0, cameras: 0, added: 0 };

/* ── 1. bind a material to every row ───────────────────────────────────────────────────────── */
for (const [, a] of allAtt()) {
  const [def, over] = FINISHES[stemOf(a)] ?? ["Finishes/plaster.json", ""];
  a.params.materialPath = def;
  if (over) a.params.finishes = over;
  report.bound++;
}

/* ── 2. the renames the library made, applied to this plan ─────────────────────────────────── */
const RENAME = {
  downlight: { ceilingHeight: "mountHeight", tilt: "aimTilt" },
  pendant: { ceilingHeight: "mountHeight" },
  chandelier: { ceilingHeight: "mountHeight" },
  light: { coneAngle: "beamAngle" },
  "led-strip": { intensity: "lumensPerMetre" },
};
for (const [, a] of allAtt()) {
  const map = RENAME[stemOf(a)];
  if (!map) continue;
  for (const [from, to] of Object.entries(map)) {
    if (a.params[from] === undefined) continue;
    a.params[to] = a.params[from];
    delete a.params[from];
    report.renamed++;
  }
}

/* ── 3. the lamp block, per fixture ────────────────────────────────────────────────────────── */
// A room whose every fitting runs at 100 % is a room with no contrast, which is what every render so
// far has been. The gains and the dim levels below are a LOOK, not defaults: the sun is the key, the
// downlights fill, the pendants and the cove are the warm layer that survives into the evening.
const LAMP = {
  downlight: { lamp: "Photometry/LED/cob-spot-3000k.json", lightGroup: "downlights", lightGroupGain: 1,
               dimLevel: 70, beamBlend: 0.3, lampRadius: 0.012, cri: 92, emitsLight: true,
               dimToKelvin: 2400, showEmissiveSurface: true, sceneMembership: "Bright, Photo", goboPath: "" },
  pendant: { lamp: "Photometry/LED/e27-globe-2700k.json", lightGroup: "pendants", lightGroupGain: 1.15,
             dimLevel: 85, lampRadius: 0.035, cri: 90, emitsLight: true, shadeTransmission: 0.18,
             dimToKelvin: 2200, showEmissiveSurface: true, sceneMembership: "Bright, Relax, Photo" },
  light: { lamp: "Photometry/Daylight/sun-clear-noon.json", lightGroup: "daylight", lightGroupGain: 1,
           dimLevel: 100, lampCount: 1, beamBlend: 0.1, lampRadius: 0.05, emitsLight: true,
           iesProfile: "", lightLink: "", sceneMembership: "Photo, Day" },
  "ceiling-fan": { materialPath: "Metal/powder-coat.json" },
};
for (const [, a] of allAtt()) {
  const pack = LAMP[stemOf(a)];
  if (!pack) continue;
  Object.assign(a.params, pack);
  report.lamps++;
}

/* ── 4. the cameras ────────────────────────────────────────────────────────────────────────── */
// A 24 mm lens held level crops the ceiling off a 3.35 m room; the shift puts it back without
// leaning the walls, which is the entire reason a tilt-shift lens exists. f/5.6 with the focus on
// the subject keeps an interior sharp front to back while still separating the foreground.
const SHOTS = {
  n50: { shotName: "01 Entry to bed", shotOrder: 1, shiftY: 0.10, focusDistance: 3.425 },
  n51: { shotName: "02 Bed to TV wall", shotOrder: 2, shiftY: 0.08, focusDistance: 3.044 },
  n52: { shotName: "03 Window seat", shotOrder: 3, shiftY: 0.09, focusDistance: 4.284 },
  n53: { shotName: "04 Wardrobe wall", shotOrder: 4, shiftY: 0.12, focusDistance: 3.81 },
};
for (const h of plan.nodes) {
  for (const a of h.attachments || []) {
    if (stemOf(a) !== "camera") continue;
    const shot = SHOTS[h.id] ?? {};
    Object.assign(a.params, {
      shiftX: 0, shiftY: shot.shiftY ?? 0.08,
      // 50 mm, because 20 mm was hiding a foreground object rather than avoiding one.
      clipStart: 0.05,
      // The plant in view1 was 300 mm from the lens and nothing said so. This does not move it — it
      // reports it, which is the part that was missing.
      minClearance: 0.9,
      fStop: 5.6, focusDistance: shot.focusDistance ?? 0, blades: 9, roll: 0,
      exposureEV: 0, resolutionX: 2560, resolutionY: 1440,
      panoramaType: "Equirectangular",
      shotOrder: shot.shotOrder ?? 9, shotActive: true, shotName: shot.shotName ?? "",
      materialPath: "Metal/powder-coat.json",
    });
    report.cameras++;
  }
}

/* ── 5. the scene ──────────────────────────────────────────────────────────────────────────── */
layer("render", "Render Look", "#0ea5e9", 30);
layer("context", "Exterior Context", "#84cc16", 31);
layer("decor2", "Styling", "#a16207", 32);
layer("electrical", "Electrical", "#f59e0b", 33);
layer("mep", "MEP", "#0891b2", 34);
layer("trim", "Cornice & Shadow Gap", "#64748b", 35);

// The plan is traced from a Kathmandu survey; the date and place make the sun real rather than typed.
newNode(-40, -260, "render", "Objects/Architectural/render-look.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  engine: "Cycles", device: "CPU", samples: 256, denoise: true,
  maxBounces: 12, diffuseBounces: 4, glossyBounces: 4, transmissionBounces: 12, clampIndirect: 10,
  resolutionX: 2560, resolutionY: 1440,
  // Zero, and the window is MEANT to blow out. 6 x 650 lm in a 14.8 m2 room is about 264 lx; the
  // sun through the glass is 100 000. That ratio is not a mistake to be graded away — it is what a
  // photograph of a room with a window in it looks like, and `glareThreshold` is what makes the
  // blown rectangle read as light rather than as a hole. Exposing for the sun instead (-2.5, -4.5)
  // puts the room itself in the dark, which is the one thing the shot is of.
  exposureEV: 0,
  viewTransform: "AgX", blenderLook: "AgX - Base Contrast",
  worldType: "Sky", hdriStrength: 1, hdriRotation: 0, hdriPath: "",
  timeOfDay: "Golden hour",
  // 3:30 pm in Kathmandu on the summer solstice, which is what the sun proxy was standing in for.
  sunFromDateTime: true, latitude: 27.7172, longitude: 85.324, timezoneHours: 5.75,
  dayOfYear: 172, hourOfDay: 15.5,
  sunAltitude: 45, sunAzimuth: 265, sunAngularDiameter: 0.526, sunIlluminance: 100000,
  sunDisc: true, sunDiscScale: 1, skyTurbidity: 2.6,
  exteriorMode: "Ground", backplateDistance: 12, backplateHeight: 8, backplatePath: "",
  groundAlbedo: 0.22, horizonHeight: 0, filmTransparent: false, shadowCatcher: false,
  volumetricDensity: 0.004, hazeStrength: 0.15,
  causticsReflective: false, causticsRefractive: false,
  // 1.5 mm on everything that does not state its own. The largest single step in the whole list.
  bevelWidth: 0.0015, bevelSamples: 4,
  aoStrength: 0.25, aoDistance: 0.35,
  previewSamples: 32, adaptiveThreshold: 0.008, resolutionScale: 100,
  // The cove clipped to white in view1: that is glare, not exposure.
  glareThreshold: 1.1, glareSize: 7,
  // A 2700 K room with no white balance renders as orange juice. 3200 K splits the warm fittings
  // and the 5200 K afternoon sun, which is where the eye actually sits in a room like this.
  // 5000 K, not 3200. This room is daylight-dominated at 3:30 pm; balancing it to the fittings
  // would take the 5200 K sun and turn the whole thing blue, which is what 3200 K did.
  whiteBalanceK: 5000, vignette: 0.12, sharpen: 0.25, grain: 0.012,
  rigEfficiency: 0.27,
  lightGroups: "daylight, downlights, pendants, cove, accent",
  renderSet: "",
  bakeDensity: 320, cardLength: 0.9, cardWidth: 0.6,
  materialPath: "Finishes/plaster.json",
  material: "not a material — this object is the scene, not a thing in it",
  semantics: "late afternoon, warm key through the west window, filmic",
});
report.added++;

// West of the window, which is the direction the sun and the view both come from.
newNode(-733 - 6 * PPM, -560, "context", "Objects/Architectural/exterior-context.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  groundSize: 160, groundLevel: -0.05, blocks: 8, ringRadius: 38, ringSpread: 18,
  blockFootprint: 10, blockMinHeight: 5, blockMaxHeight: 14, seed: 11, showGround: true,
  materialPath: "Site/grass.json", finishes: "Massing=Masonry/concrete.json",
  material: "grass and planting, neutral concrete massing beyond",
  semantics: "middle-distance Kathmandu context beyond the glass, hazy",
});
report.added++;

/* ── 6. furnish the room ───────────────────────────────────────────────────────────────────── */
// Bedding, on the bed's own node, with the bed's own dimensions.
addToNode("n33", "Objects/Architectural/bedding.json", {
  rotation: 90, anchorDir: "Center", fitMode: "Off", margin: 0,
  bedLength: 1.9812, bedWidth: 1.8288, mattressTop: 0.6096, duvetThk: 0.13, duvetDrop: 0.24,
  duvetInset: 0.03, foldBack: 0.45, sheetThk: 0.03,
  pillowCount: 4, pillowWidth: 0.6, pillowDepth: 0.4, pillowHeight: 0.15,
  throwWidth: 0.7, throwDrop: 0.32, throwFromFoot: 0.14, showThrow: true,
  materialPath: "Fabric/cotton.json",
  finishes: "Turn-back=Fabric/linen.json; Pillows=Fabric/linen.json; Throw=Fabric/wool.json; Duvet drop=Fabric/cotton.json",
  material: "crisp white cotton duvet, linen turn-back, grey wool throw",
  semantics: "made bed, hotel-crisp, soft warm whites",
});
// Cushions against the upholstered headboard.
newNode(-330.49, -790, "decor2", "Objects/Architectural/cushion.json", {
  rotation: 90, anchorDir: "Center", fitMode: "Off", margin: 0,
  count: 3, cushionWidth: 0.42, cushionDepth: 0.16, cushionHeight: 0.4, spacing: 0.07,
  seatHeight: 0.75, stagger: 0.05, seed: 3,
  materialPath: "Fabric/boucle.json",
  material: "ivory bouclé, linen backs", semantics: "soft ivory cushions against the headboard",
});
// A little clutter on each nightstand, and on the media console.
addToNode("n34", "Objects/Architectural/decor-cluster.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  style: "Stack and bowl", pieces: 3, spreadU: 0.3, spreadV: 0.2, baseHeight: 0.5588,
  pieceSize: 0.13, heightVary: 0.7, seed: 7,
  materialPath: "Finishes/paper.json", material: "linen-bound books, a small ceramic bowl",
  semantics: "lived-in styling on the left nightstand",
});
addToNode("n35", "Objects/Architectural/decor-cluster.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  style: "Vase and stems", pieces: 2, spreadU: 0.22, spreadV: 0.18, baseHeight: 0.5588,
  pieceSize: 0.14, heightVary: 0.8, seed: 19,
  materialPath: "Finishes/ceramic.json", material: "a ceramic vase with dry stems",
  semantics: "lived-in styling on the right nightstand",
});
addToNode("n36", "Objects/Architectural/decor-cluster.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  style: "Books", pieces: 5, spreadU: 0.55, spreadV: 0.22, baseHeight: 0.66,
  pieceSize: 0.17, heightVary: 0.5, seed: 31,
  materialPath: "Finishes/paper.json", material: "stacked art books, a brass tray",
  semantics: "styling along the media console",
});
report.added += 4;

// Switches by each door, sockets at skirting level.
const PLATE = (x, y, rot, gangs, name) => newNode(x, y, "electrical", "Objects/Architectural/switch-plate.json", {
  rotation: rot, anchorDir: "Center", fitMode: "Off", margin: 0,
  gangs, plateHeight: 0.086, gangWidth: 0.086, plateDepth: 0.008,
  rockerWidth: 0.03, rockerHeight: 0.05, rockerProud: 0.004, mountHeight: 1.15, finish: "Matt white",
  materialPath: "Finishes/paint-eggshell.json", finishes: "Rockers=Finishes/paint-eggshell.json",
  material: "matt white moulded plate", semantics: name,
});
PLATE(-120, -300, 0, 2, "switch bank by Door B");
PLATE(-700, -300, 0, 3, "switch bank by Door A");
const SOCKET = (x, y, rot, name) => newNode(x, y, "electrical", "Objects/Architectural/socket-outlet.json", {
  rotation: rot, anchorDir: "Center", fitMode: "Off", margin: 0,
  outlets: 2, plateHeight: 0.086, outletWidth: 0.073, plateDepth: 0.01, apertureDia: 0.026,
  mountHeight: 0.3, switched: true, usb: false, finish: "Matt white",
  materialPath: "Finishes/paint-eggshell.json", finishes: "Apertures=Metal/powder-coat.json",
  material: "matt white moulded plate", semantics: name,
});
SOCKET(-455, -852, 0, "twin socket behind the left nightstand");
SOCKET(-205, -852, 0, "twin socket behind the right nightstand");
report.added += 4;

// A linear slot over the bed, which every real room has and no render so far has had.
newNode(-330, -470, "mep", "Objects/Architectural/ac-grille.json", {
  rotation: 90, anchorDir: "Center", fitMode: "Off", margin: 0,
  grilleType: "Linear slot", grilleLength: 1.2, grilleWidth: 0.12, frameWidth: 0.018,
  frameDepth: 0.02, blades: 12, bladeThk: 0.004, ceilingHeight: 3.1242,
  materialPath: "Metal/aluminium-anodised.json", finishes: "Blades=Metal/powder-coat.json",
  material: "anodised aluminium frame, powder-coated blades",
  semantics: "discreet linear supply slot matched to the ceiling",
});
report.added++;

// Plants: the faceted dome becomes leaves, and the one that was in view1's lens moves to the SW
// corner with its pair. Cameras are where the plan put them; a plant 300 mm from one is the plan's
// problem, and this is the plan being fixed rather than the renderer being asked to dodge.
const POT = (params) => ({
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  potDia: 0.34, potHeight: 0.32, soilDrop: 0.045, trunkHeight: 0.5, trunkRadius: 0.024,
  leaves: 22, tiers: 3, leafLength: 0.38, leafWidth: 0.14, leafThk: 0.004,
  canopyRise: 0.6, droop: 0.4, seed: 5,
  materialPath: "Organic/foliage.json",
  finishes: "Pot=Finishes/ceramic.json; Soil=Masonry/concrete.json; Trunk=Organic/bark.json",
  material: "healthy green foliage, ivory ceramic pot, dark soil",
  ...params,
});
for (const h of plan.nodes) {
  for (const a of h.attachments || []) {
    if (stemOf(a) !== "plant") continue;
    a.objectPath = "Objects/Architectural/plant-potted.json";
    a.objectId = "plant-potted-with-math";
    a.params = POT({ seed: h.id === "n39" ? 23 : 5, semantics: "large-leaved indoor plant in an ivory pot" });
    if (h.id === "n39") { h.x = -733 + 0.3 * PPM; h.y = -330; }   // out of camera 01's cone
  }
}

// Cornice and a shadow gap follow the skirting runs; a pelmet hides the curtain track.
const SKIRT = plan.segments.filter((s) => (s.attachments || []).some((a) => stemOf(a) === "skirting"));
for (const s of SKIRT) {
  const run = Math.max(0.1, segLength(s.id));
  addToSegment(s.id, "Objects/Architectural/cornice.json", {
    rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
    length: run, profile: "Stepped", projection: 0.055, drop: 0.075, steps: 2, ceilingHeight: 3.1242,
    materialPath: "Finishes/plaster.json", material: "plaster cornice, painted to match the ceiling",
    semantics: "crisp modern stepped cornice, shallow, painted white",
  });
  addToSegment(s.id, "Objects/Architectural/shadow-gap.json", {
    rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
    length: run, gapHeight: 0.012, gapDepth: 0.018, position: "Wall base", level: 0, ceilingHeight: 3.1242,
    materialPath: "Finishes/paint-eggshell.json", material: "painted reveal, matt black inside",
    semantics: "crisp recessed shadow line where the wall meets the floor",
  });
}
addToSegment("seg-015", "Objects/Architectural/curtain-pelmet.json", {
  rotation: 0, anchorDir: "Center", fitMode: "Off", margin: 0,
  length: Math.max(0.3, segLength("seg-015")), faceDrop: 0.2, pelmetDepth: 0.16, boardThk: 0.018, ceilingHeight: 3.1242,
  headClearance: 0, returnEnds: true, closedTop: false, ledLip: true,
  materialPath: "Finishes/paint-eggshell.json", finishes: "Concealed strip=Emissive/led-warm.json",
  material: "painted MDF pelmet, anodised channel behind the face",
  semantics: "concealed curtain track with a warm wash down the fabric",
});
report.added += SKIRT.length * 2 + 1;

/* ── 7. the cove already in the false ceiling, now with a lamp ─────────────────────────────── */
for (const [, a] of allAtt()) {
  if (stemOf(a) !== "false-ceiling") continue;
  Object.assign(a.params, {
    lamp: "Photometry/LED/tape-warm-2700k.json", lightGroup: "cove", lightGroupGain: 1.3,
    lumensPerMetre: 900, kelvin: 2700, cri: 90, dimLevel: 90, lampRadius: 0.006,
    emitsLight: true, dimToKelvin: 2200, showEmissiveSurface: true, sceneMembership: "Relax, Night, Photo",
    materialPath: "Finishes/plaster.json", finishes: "Cove LED=Emissive/led-warm.json",
  });
  report.lamps++;
}

/* ── 8. sign it ────────────────────────────────────────────────────────────────────────────── */
plan.settings.keywords = "M. Bedroom fit-out, render-ready: materials bound, exterior context, " +
  "render-look, bedding and styling, cornice and shadow gap, cameras with lens shift and clearance";
plan.settings.renderNote =
  "Improved from floorplan_with_bedroom_render.json. Bake with bake_plan.mjs (which now honours " +
  "materialPath / finishes) and render with render_plan.py (which now reads render-look and the " +
  "Output Metrics rather than the params). The old plan's ceilingHeight / tilt / coneAngle have " +
  "been renamed to mountHeight / aimTilt / beamAngle to match the object library.";

const json = JSON.stringify(plan, null, 2) + "\n";
JSON.parse(json);
writeFileSync(OUT, json, "utf8");

const counts = {};
for (const [, a] of allAtt()) counts[stemOf(a)] = (counts[stemOf(a)] || 0) + 1;
console.log(`materials bound   ${report.bound} attachments`);
console.log(`params renamed    ${report.renamed}`);
console.log(`lamp blocks       ${report.lamps}`);
console.log(`cameras upgraded  ${report.cameras}`);
console.log(`objects added     ${report.added}`);
console.log(`\n${Object.keys(counts).length} object types, ${Object.values(counts).reduce((a, b) => a + b, 0)} attachments:`);
console.log("  " + Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("  "));
console.log(`\nwrote ${OUT}  (${(json.length / 1024).toFixed(0)} KB)`);
