/*
 * Bedroom viewer — a canvas-JSON reader with a parametric panel.
 *
 * THREE THINGS MEET HERE and they do not agree on their own, so the frames are stated once:
 *
 *   canvas plan   world PIXELS, x east, y SOUTH (down the page). `settings.pixelsPerMeter` converts.
 *   spine output  ANCHOR-RELATIVE METRES, [x, y, z], z up — what `resolveSpineObject` returns.
 *   three.js      Y-up, right-handed.
 *
 * so a vertex goes  world = (anchorX + mx, mz, anchorY + my)  — plan y lands on three z — and the whole
 * model is then translated so the plan's centre sits at the origin. Everything downstream is metres.
 *
 * WHAT IS EVALUATED AND WHAT IS NOT. Every attachment is resolved live from its definition; nothing is
 * baked into this file but the definitions themselves. The one exception is a WALL, whose own render row
 * ships switched off because the mitred band is a property of the whole wall graph rather than of one
 * segment — see `wallBand`, which mirrors bakeAttachments.ts for exactly the reasons stated there.
 */
(function () {
"use strict";

var T = window.THREE, E = window.PlanEngine, DATA = window.VIEWER_DATA;
var PLAN = DATA.plan, LIB = DATA.objects, MATLIB = DATA.materials, MOOD = DATA.moodboard;
var PPM = PLAN.settings.pixelsPerMeter || 1;

var $ = function (id) { return document.getElementById(id); };
var el = function (tag, cls, text) {
  var n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
var clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };

// ═════════════════════════════════════════════════════════════════════ plan walk

var nodeById = {};
PLAN.nodes.forEach(function (n) { nodeById[n.id] = n; });
var symbolOf = function (objectId) { var o = LIB[objectId]; return (o && o.object && o.object.symbol) || ""; };

/** Every wall segment as the mitre solver wants it. Mitring is a property of the whole GRAPH, so it is
 *  solved once over every wall rather than per attachment — the same call the canvas makes. */
var wallSegs = PLAN.segments.filter(function (s) {
  return (s.attachments || []).some(function (a) { return symbolOf(a.objectId) === "wall"; });
});
var MITRED = E.computeMiteredWallPolygons(wallSegs.map(function (s) {
  var a = nodeById[s.fromNodeId], b = nodeById[s.toNodeId];
  return { id: s.id, start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, thickness: s.thickness || 10 };
}));

/** One placed object: everything needed to re-evaluate it, and nothing that changes when it is. */
var INSTANCES = [];
var addInstance = function (att, anchorPx, host, hostKind, hostLabel, seg) {
  var def = LIB[att.objectId];
  if (!def) return;
  INSTANCES.push({
    id: att.id,
    objectId: att.objectId,
    name: (def.object && def.object.name) || def.title || att.objectId,
    def: def,
    defText: JSON.stringify(def),
    hostKind: hostKind,
    hostLabel: hostLabel,
    anchorPx: anchorPx,
    anchor: [anchorPx.x / PPM, anchorPx.y / PPM],
    host: host,
    base: att.params || {},
    seg: seg || null,
    symbol: symbolOf(att.objectId),
    layer: (seg && seg.layer) || att.layer || ""
  });
};

PLAN.segments.forEach(function (s) {
  if (!s.attachments || !s.attachments.length) return;
  var a = nodeById[s.fromNodeId], b = nodeById[s.toNodeId];
  if (!a || !b) return;
  var mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  var host = [a, b].map(function (p) { return { x: (p.x - mid.x) / PPM, y: (p.y - mid.y) / PPM }; });
  s.attachments.forEach(function (att) { addInstance(att, mid, host, "segment", "segment " + s.id, s); });
});
PLAN.nodes.forEach(function (n) {
  (n.attachments || []).forEach(function (att) {
    addInstance(att, { x: n.x, y: n.y }, [{ x: 0, y: 0 }], "node", "node " + n.id, null);
  });
});
PLAN.spaces.forEach(function (sp) {
  if (!sp.attachments || !sp.attachments.length) return;
  var ring = (sp.nodeIds || []).map(function (i) { return nodeById[i]; }).filter(Boolean);
  if (ring.length < 3) return;
  var c = E.polygonCentroid(ring);
  var host = ring.map(function (p) { return { x: (p.x - c.x) / PPM, y: (p.y - c.y) / PPM }; });
  sp.attachments.forEach(function (att) { addInstance(att, c, host, "space", sp.label || sp.id, null); });
});

var byId = {};
INSTANCES.forEach(function (i) { byId[i.id] = i; });

// ══════════════════════════════════════════════════════════════════════ the model

var STORE = "bedroom-viewer-v1";
var state = {
  overrides: {},          // attachment id → { paramKey: value }
  finishes: {},           // surface id → finish token
  selected: null,
  tier: { AMBIENT: 1, TASK: 1, ACCENT: 1, STATEMENT: 1 },
  daylight: 0.55,
  exposure: 1.0,
  shadows: true,
  ceiling: true,
  nearWalls: true,
  helpers: false,
  hiddenObjects: {}
};
MOOD.surfaces.forEach(function (s) { state.finishes[s.id] = s.finish; });

try {
  var raw = localStorage.getItem(STORE);
  if (raw) {
    var s = JSON.parse(raw);
    if (s && s.plan === PLAN.settings.keywords) {
      state.overrides = s.overrides || {};
      if (s.finishes) Object.keys(s.finishes).forEach(function (k) { state.finishes[k] = s.finishes[k]; });
      ["tier", "daylight", "exposure", "shadows", "ceiling", "nearWalls", "helpers", "hiddenObjects"].forEach(function (k) {
        if (s[k] != null) state[k] = s[k];
      });
    }
  }
} catch (e) { /* private window, blocked storage: start fresh */ }

var saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(function () {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        plan: PLAN.settings.keywords, overrides: state.overrides, finishes: state.finishes,
        tier: state.tier, daylight: state.daylight, exposure: state.exposure, shadows: state.shadows,
        ceiling: state.ceiling, nearWalls: state.nearWalls, helpers: state.helpers,
        hiddenObjects: state.hiddenObjects
      }));
    } catch (e) { /* ignore */ }
  }, 300);
}

var paramsOf = function (inst) {
  var out = {}, k;
  for (k in inst.base) out[k] = inst.base[k];
  var ov = state.overrides[inst.id];
  for (k in ov) out[k] = ov[k];
  return out;
};

// ═══════════════════════════════════════════════════════════════════ the wall band
//
// A wall object does not draw its own solid, and must not: corners join only if the footprint is the
// MITRED polygon, and a segment hosting a door or window has to carry band only above the head (and
// below the sill). Neither is knowable from inside one segment's own parameters.

function bandFaces(foot, z0, z1, anchor) {
  var ring = foot.map(function (p) { return [(p.x - anchor.x) / PPM, (p.y - anchor.y) / PPM]; });
  var at = function (i, z) { return [ring[i][0], ring[i][1], z]; };
  var faces = [];
  faces.push(ring.map(function (_, i) { return at(ring.length - 1 - i, z0); }));
  faces.push(ring.map(function (_, i) { return at(i, z1); }));
  for (var i = 0; i < ring.length; i++) {
    var j = (i + 1) % ring.length;
    faces.push([at(i, z0), at(j, z0), at(j, z1), at(i, z1)]);
  }
  return faces;
}

function num(p, key, fallback) {
  var v = p[key], n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return isFinite(n) ? n : fallback;
}

function wallBand(inst) {
  var seg = inst.seg, p = paramsOf(inst);
  var a = nodeById[seg.fromNodeId], b = nodeById[seg.toNodeId];
  var dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
  if (L < 1e-6) return [];

  // The mitre polygon carries collinear midpoints and can be concave at a T or X junction, while the caps
  // are fan-triangulated. Hulling keeps the corner shape and guarantees a convex cap.
  var mitre = MITRED.get ? MITRED.get(seg.id) : MITRED[seg.id];
  var hull = mitre && mitre.length >= 3 ? E.computeConvexHull(mitre) : [];
  var half = Math.max(1, (seg.thickness || 10) / 2);
  var nx = -dy / L, ny = dx / L;
  var foot = hull.length >= 3 ? hull : [
    { x: a.x + nx * half, y: a.y + ny * half },
    { x: b.x + nx * half, y: b.y + ny * half },
    { x: b.x - nx * half, y: b.y - ny * half },
    { x: a.x - nx * half, y: a.y - ny * half }
  ];

  var base = num(p, "base", 0);
  var top = base + Math.max(0.05, num(p, "height", 2.7));
  var color = inst.def.__wallColor || "#E9E3D9";

  // The opening that carves this segment, if any, read from its sibling attachment on the same segment.
  var open = null, openSym = "";
  (seg.attachments || []).forEach(function (o) {
    var sym = symbolOf(o.objectId);
    if (sym === "door" || sym === "window") { open = byId[o.id]; openSym = sym; }
  });

  var piece = function (id, name, z0, z1) {
    return { id: id, name: name, color: color, faces: bandFaces(foot, z0, z1, inst.anchorPx) };
  };
  if (!open) return [piece("wall-band", "Wall", base, top)];

  var op = paramsOf(open), isWin = openSym === "window";
  // A spine door names its head `lintelHeight`; read `height` too or the spandrel is cut at the fallback.
  var lintel = base + (isWin ? num(op, "lintelHeight", 2.1) : num(op, "lintelHeight", num(op, "height", 2.1)));
  var sillTop = base + (isWin ? num(op, "sillHeight", 0.9) : 0);

  var out = [];
  if (sillTop > base + 0.01) out.push(piece("wall-sill", "Wall — under sill", base, Math.min(sillTop, top)));
  if (lintel < top - 0.01) out.push(piece("wall-head", "Wall — over head", Math.max(lintel, base), top));
  return out;
}

// ═══════════════════════════════════════════════════════════════════════ evaluate

/** Some objects ship their Render 3D rows switched OFF because the canvas draws that solid another way.
 *  Forcing them on is a FALLBACK, taken only when the object produced nothing at all. */
function forceRows(def) {
  var c = JSON.parse(JSON.stringify(def));
  (c.nodes || []).forEach(function (n) {
    if (!n.data || n.data.tool !== "render-3d") return;
    ((n.data.params && n.data.params.prims) || []).forEach(function (r) { r.show = true; });
  });
  return JSON.stringify(c);
}

function evaluate(inst) {
  if (inst.symbol === "wall") return { meshes: wallBand(inst), metrics: [], wallBand: true };
  var p = paramsOf(inst), r = null;
  try { r = E.resolveSpineObject(inst.defText, inst.anchorPx, PPM, p, inst.host); } catch (e) { r = null; }
  if (!r || !r.meshes.length) {
    try {
      if (!inst.forcedText) inst.forcedText = forceRows(inst.def);
      var retry = E.resolveSpineObject(inst.forcedText, inst.anchorPx, PPM, p, inst.host);
      if (retry && retry.meshes.length) r = retry;
    } catch (e) { /* a broken definition costs its own object and nothing else */ }
  }
  if (!r) return { meshes: [], metrics: [] };
  var m = r.outputs || {};
  return { meshes: r.meshes, metrics: (m.declared || []).concat(m.derived || []) };
}

// ═════════════════════════════════════════════════════════════════════ appearance

/** A mesh name that means "this thing emits". Kept as one list because four different objects spell the
 *  same idea differently — a downlight has a Lens, a headboard a Halo LED, a nightstand an Under-unit LED. */
var EMISSIVE = /\b(led|lens|emitter|globe|glow|halo|bias|diffuser)\b/i;
var HELPER = /\b(view cone|beam|aim|tripod|frustum)\b/i;
/** A camera is a view marker, not furniture: every part of it is a helper, which also keeps its `Lens`
 *  out of the emissive list, where it would otherwise glow like a downlight. */
var isHelperObject = function (objectId) { return objectId.indexOf("camera") === 0; };

function matchSurface(objectId, meshName) {
  for (var i = 0; i < MOOD.surfaces.length; i++) {
    var s = MOOD.surfaces[i];
    for (var j = 0; j < s.match.length; j++) {
      var m = s.match[j];
      if (m.object !== objectId) continue;
      if (!m.mesh) return s;
      if (m.mesh.charAt(0) === "!") { if (meshName.toLowerCase().indexOf(m.mesh.slice(1).toLowerCase()) < 0) return s; }
      else if (meshName.toLowerCase().indexOf(m.mesh.toLowerCase()) >= 0) return s;
    }
  }
  return null;
}
var finishOf = function (token) {
  for (var i = 0; i < MOOD.finishes.length; i++) if (MOOD.finishes[i].token === token) return MOOD.finishes[i];
  return null;
};

/** Kelvin → an sRGB hex, so the colour goes through `setStyle` and the renderer's own colour management
 *  rather than being pushed into the working space by hand. */
function kelvinHex(k) {
  var t = k / 100;
  var r = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  var g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  var b = t >= 66 ? 255 : (t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307);
  return "#" + [r, g, b].map(function (v) {
    var h = Math.round(clamp(v, 0, 255)).toString(16);
    return h.length < 2 ? "0" + h : h;
  }).join("");
}

var weaveTex = null;
function weave() {
  if (weaveTex) return weaveTex;
  var S = 256, threads = 16, c = document.createElement("canvas");
  c.width = c.height = S;
  var ctx = c.getContext("2d"), img = ctx.createImageData(S, S), h = new Float32Array(S * S), seed = 7;
  var rand = function () { return (seed = (seed * 16807) % 2147483647) / 2147483647; };
  for (var y = 0; y < S; y++) for (var x = 0; x < S; x++) {
    var X = x / S * Math.PI * 2 * threads, Y = y / S * Math.PI * 2 * threads;
    var warp = Math.abs(Math.sin(X / 2)) * (Math.sin(Y / 2) >= 0 ? 1 : 0);
    var weft = Math.abs(Math.sin(Y / 2)) * (Math.sin(X / 2 + Math.PI / 2) >= 0 ? 1 : 0);
    h[y * S + x] = Math.max(warp, weft) + (rand() - 0.5) * 0.1;
  }
  var k = 2 * threads / S * 1.6;
  for (var y2 = 0; y2 < S; y2++) for (var x2 = 0; x2 < S; x2++) {
    var dx = (h[y2 * S + (x2 + 1) % S] - h[y2 * S + (x2 + S - 1) % S]) * k;
    var dy = (h[((y2 + 1) % S) * S + x2] - h[((y2 + S - 1) % S) * S + x2]) * k;
    var l = Math.hypot(dx, dy, 1), i = (y2 * S + x2) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  weaveTex = new T.CanvasTexture(c);
  weaveTex.wrapS = weaveTex.wrapT = T.RepeatWrapping;
  weaveTex.repeat.set(8, 8);
  weaveTex.anisotropy = 8;
  return weaveTex;
}

var matCache = {};
function materialFor(inst, mesh) {
  var emis = EMISSIVE.test(mesh.name) && !isHelperObject(inst.objectId);
  var surf = emis ? null : matchSurface(inst.objectId, mesh.name);
  var fin = surf ? finishOf(state.finishes[surf.id]) : null;
  // A library material file wins over the finish's own fallback: a material is one file read by four
  // renderers, and the viewer is only one of them.
  var libMat = fin && fin.material ? MATLIB[fin.material] : null;
  var pbr = (libMat && libMat.pbr) || (fin && fin.pbr) || null;
  var key = emis ? "e|" + (inst.kelvin || 2800)
    : pbr ? "p|" + (surf ? surf.id : "") + "|" + (fin ? fin.token : "") + "|" + mesh.color
    : "c|" + mesh.color;
  if (matCache[key]) return matCache[key];

  var m;
  if (emis) {
    m = new T.MeshStandardMaterial({ color: 0x111111, roughness: 1, metalness: 0 });
    m.emissive = new T.Color().setStyle(kelvinHex(inst.kelvin || 2800));
    m.emissiveIntensity = 2600;   // cd/m² — an LED strip, in the same scale as the lights
    m.toneMapped = true;
  } else if (pbr) {
    m = new T.MeshStandardMaterial({
      roughness: clamp(pbr.roughness != null ? pbr.roughness : 0.7, 0.03, 1),
      metalness: pbr.metallic != null ? pbr.metallic : 0
    });
    m.color.setStyle(pbr.baseColor || mesh.color);
    if (fin && fin.weave) { m.normalMap = weave(); m.normalScale = new T.Vector2(0.3, 0.3); }
    m.envMapIntensity = pbr.metallic ? 1.15 : 0.7;
  } else {
    m = new T.MeshStandardMaterial({ roughness: 0.72, metalness: 0 });
    m.color.setStyle(mesh.color || "#999999");
    m.envMapIntensity = 0.6;
  }
  m.side = T.DoubleSide;
  matCache[key] = m;
  return m;
}
var dropMaterials = function () {
  Object.keys(matCache).forEach(function (k) { if (k.charAt(0) !== "e") { matCache[k].dispose(); delete matCache[k]; } });
};

/** Re-resolve every mesh's material in place. A finish is not geometry: rebuilding all fifty objects to
 *  change the colour of the wardrobe doors costs the better part of a second and computes nothing new. */
function retint() {
  dropMaterials();
  content.traverse(function (o) {
    if (!o.isMesh) return;
    var inst = byId[o.userData.instance];
    if (inst) o.material = materialFor(inst, { name: o.name, color: o.userData.color });
  });
  needs = true;
}

// ═══════════════════════════════════════════════════════════════════════════ 3D

var stage = $("stage"), renderer, scene, camera, content, raycaster, needs = true, frames = 0, fps = 0;
var lightRig = { sun: null, hemi: null, tiers: { AMBIENT: [], TASK: [], ACCENT: [], STATEMENT: [] } };
var groups = {};     // instance id → THREE.Group
var pickables = [];
var centre = { x: 0, z: 0 };
var view = { target: new T.Vector3(), theta: 2.3, phi: 1.15, radius: 9, fov: 45 };

if (!T || !E) {
  $("boot").textContent = "The viewer could not start: " + (!T ? "three.js" : "the parametric engine") + " failed to load.";
  return;
}

/** A synthetic studio used only for reflections. Built in code rather than loaded, because a page opened
 *  from file:// cannot read an image into a canvas without tainting it, and a tainted canvas cannot be
 *  pre-filtered into an environment map. */
function environment() {
  // Every surface is self-lit: an environment scene has no lights of its own, so a standard material
  // would pre-filter to black. The values are luminances in the same scale as everything else here —
  // a surround of roughly 60 cd/m² with three brighter panels — so a mirror reflects something real.
  var env = new T.Scene();
  var lum = function (r, g, b, s) { return new T.MeshBasicMaterial({ color: new T.Color(r * s, g * s, b * s), side: T.DoubleSide }); };
  var box = new T.Mesh(new T.BoxGeometry(14, 6, 14), lum(0.80, 0.77, 0.72, 60));
  box.position.y = 3; env.add(box);
  var panel = function (x, y, z, w, h, s, rx, ry) {
    var m = new T.Mesh(new T.PlaneGeometry(w, h), lum(1, 0.96, 0.9, s));
    m.position.set(x, y, z); m.rotation.set(rx || 0, ry || 0, 0); env.add(m);
  };
  panel(0, 5.95, 0, 7, 4, 900, Math.PI / 2);
  panel(-6.95, 3, 0, 4, 2.4, 260, 0, Math.PI / 2);
  panel(0, 3, 6.95, 5, 2.6, 300, 0, Math.PI);
  var pm = new T.PMREMGenerator(renderer);
  var rt = pm.fromScene(env, 0.04);
  pm.dispose();
  return rt.texture;
}

function geometryFor(mesh) {
  // Faces are independent rings: fan-triangulate each, keep the vertices unshared, and the normals come
  // out flat — which is what a machined panel or a mitred band should look like.
  var pos = [], f, i, k;
  for (i = 0; i < mesh.faces.length; i++) {
    f = mesh.faces[i];
    if (f.length < 3) continue;
    for (k = 1; k + 1 < f.length; k++) {
      pos.push(f[0][0], f[0][2], f[0][1]);
      pos.push(f[k][0], f[k][2], f[k][1]);
      pos.push(f[k + 1][0], f[k + 1][2], f[k + 1][1]);
    }
  }
  var g = new T.BufferGeometry();
  g.setAttribute("position", new T.BufferAttribute(new Float32Array(pos), 3));
  g.computeVertexNormals();
  return g;
}

function disposeGroup(g) {
  g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
  if (g.parent) g.parent.remove(g);
}

function buildInstance(inst) {
  var res = evaluate(inst);
  inst.metrics = res.metrics;
  inst.meshNames = res.meshes.map(function (m) { return m.name; });
  var p = paramsOf(inst);
  inst.kelvin = num(p, "kelvin", 2800);

  var g = new T.Group();
  g.name = inst.id;
  g.position.set(inst.anchor[0] - centre.x, 0, inst.anchor[1] - centre.z);
  res.meshes.forEach(function (m) {
    var helper = HELPER.test(m.name) || isHelperObject(inst.objectId);
    var mesh = new T.Mesh(geometryFor(m), materialFor(inst, m));
    mesh.name = m.name;
    mesh.userData = { instance: inst.id, mesh: m.name, helper: helper, color: m.color };
    mesh.castShadow = !helper && !EMISSIVE.test(m.name);
    mesh.receiveShadow = !helper;
    mesh.visible = helper ? state.helpers : true;
    g.add(mesh);
  });
  return g;
}

function rebuild(inst) {
  if (groups[inst.id]) disposeGroup(groups[inst.id]);
  var g = buildInstance(inst);
  groups[inst.id] = g;
  g.visible = !state.hiddenObjects[inst.objectId];
  content.add(g);
  refreshPickables();
  needs = true;
}

function refreshPickables() {
  pickables.length = 0;
  content.traverse(function (o) { if (o.isMesh && !o.userData.helper) pickables.push(o); });
}

// ───────────────────────────────────────────────────────────────────── lighting
//
// The objects carry photometry — lumens, kelvin, beam angle — as numbers, and draw a yellow lens. Nothing
// in a plan emits light on its own, so the rig is derived here: one real light per luminaire, in candela,
// which is what `physicallyCorrectLights` expects.

var lumensToCandela = function (lm, halfAngleRad) {
  var sr = halfAngleRad ? 2 * Math.PI * (1 - Math.cos(halfAngleRad)) : 4 * Math.PI;
  return lm / Math.max(sr, 0.02);
};

/** Interior illuminance runs to hundreds of lux, and a luminaire to thousands of candela. Those are the
 *  numbers the objects state, so they are the numbers used — and the exposure then has to sit where a
 *  camera's would. A 300 lux wall at 0.8 albedo is ~76 cd/m²; mapping that near ACES mid-grey (0.18)
 *  puts the base here. The Exposure slider is a multiplier on top, so it still reads as stops. */
var EXPOSURE_BASE = 0.0024;

/** What the viewer assumes when an object states no photometry of its own. A cove strip is about
 *  200 lm per metre and a decorative halo far less; neither the false-ceiling nor the panel objects
 *  carry a lumens parameter, so these are the viewer's numbers, not the plan's. */
var COVE_LUMENS_PER_POINT = 350;
var ACCENT_LUMENS_PER_POINT = 110;

/** Point the sun from the plan's own sun proxy: an object of `type` Directional. Its aim is read off the
 *  "Beam / aim" geometry, the same trick the camera shots use, and its irradiance from the lumens it
 *  states over the aperture it states — 18000 lm through a 1.52 × 2.13 m opening is 5535 lux. */
function aimSun() {
  var sun = lightRig.sun;
  var inst = null;
  INSTANCES.forEach(function (i) {
    if (i.objectId.indexOf("light-with-math") === 0 && String(paramsOf(i).type) === "Directional") inst = i;
  });
  if (!inst) {
    sun.position.set(6, 7, -5);
    sun.target.position.set(0, 0, 0);
    lightRig.sunLux = 6000;
    return;
  }
  var p = paramsOf(inst);
  // Bearing runs `rotation + 90°` measured as atan2(x, −y) — the convention the camera objects' own view
  // cones confirm, checked against all four of them. `aimTilt` is the droop below horizontal.
  var bearing = (num(p, "rotation", 0) + 90) * Math.PI / 180;
  var tilt = num(p, "aimTilt", -25) * Math.PI / 180;
  var horiz = Math.cos(tilt);
  var dir = [Math.sin(bearing) * horiz, Math.sin(tilt), -Math.cos(bearing) * horiz];  // three (x, y up, z)
  var reach = Math.max(num(p, "reach", 5), 3);
  var ox = inst.anchor[0] - centre.x, oz = inst.anchor[1] - centre.z, oy = num(p, "mountHeight", 1.8);
  sun.target.position.set(ox + dir[0] * reach, oy + dir[1] * reach, oz + dir[2] * reach);
  // Stand the sun well back along its own ray so the shadow camera covers the whole room.
  sun.position.set(ox - dir[0] * 6, oy - dir[1] * 6, oz - dir[2] * 6);
  sun.color.setStyle(kelvinHex(num(p, "kelvin", 5200)));
  var area = Math.max(num(p, "sizeLength", 1.5) * num(p, "sizeWidth", 2.1), 0.2);
  lightRig.sunLux = num(p, "lumens", 12000) / area;
  lightRig.sunNote = String(p.semantics || "");
}

/** Up to `n` points spread along an emissive mesh, used to seed a strip's lights. A cove is a band and a
 *  single point at its centroid would light the room from thin air. */
function samplePoints(mesh, n) {
  var cs = mesh.faces.map(function (f) {
    var c = [0, 0, 0];
    f.forEach(function (p) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; });
    return [c[0] / f.length, c[1] / f.length, c[2] / f.length];
  });
  if (!cs.length) return [];
  var step = Math.max(1, Math.floor(cs.length / n)), out = [];
  for (var i = 0; i < cs.length && out.length < n; i += step) out.push(cs[i]);
  return out;
}

function buildLights() {
  Object.keys(lightRig.tiers).forEach(function (t) {
    lightRig.tiers[t].forEach(function (l) { if (l.parent) l.parent.remove(l); if (l.dispose) l.dispose(); });
    lightRig.tiers[t] = [];
  });
  var add = function (tier, light, base) {
    light.userData.baseIntensity = base;
    lightRig.tiers[tier].push(light);
    scene.add(light);
    if (light.target) scene.add(light.target);
  };

  INSTANCES.forEach(function (inst) {
    var p = paramsOf(inst), o = inst.objectId;
    var x = inst.anchor[0] - centre.x, z = inst.anchor[1] - centre.z;
    var col = new T.Color().setStyle(kelvinHex(num(p, "kelvin", 2800)));

    if (o.indexOf("downlight") === 0) {
      var beam = num(p, "beamAngle", 60) * Math.PI / 180 / 2;
      var h = num(p, "ceilingHeight", 2.9);
      var sp = new T.SpotLight(col, 1, 0, clamp(beam, 0.12, 1.3), 0.45, 2);
      sp.position.set(x, h - 0.02, z);
      sp.target.position.set(x, 0, z);
      add("TASK", sp, lumensToCandela(num(p, "lumens", 800), beam));
      return;
    }
    if (o.indexOf("pendant") === 0) {
      var pl = new T.PointLight(col, 1, 0, 2);
      pl.position.set(x, num(p, "bottomHeight", 1.5) - 0.05, z);
      add("TASK", pl, lumensToCandela(num(p, "lumens", 450)));
      return;
    }
    if (o.indexOf("light-with-math") === 0) {
      // A light whose own `type` is Directional is the SUN, not a lamp in the room — this plan's is
      // "V-Ray Sun through the west window at about 3:30 pm". Rendering it where it stands would put a
      // 12,000 cd point source a metre outside the wall. It is handled by `aimSun` instead.
      if (String(p.type) === "Directional") return;
      var cone = num(p, "coneAngle", 0);
      var lm = num(p, "lumens", 1200), mh = num(p, "mountHeight", 2.4);
      if (cone > 1) {
        var half = cone * Math.PI / 180 / 2;
        var s2 = new T.SpotLight(col, 1, 0, clamp(half, 0.12, 1.3), 0.5, 2);
        s2.position.set(x, mh, z); s2.target.position.set(x, 0, z);
        add("STATEMENT", s2, lumensToCandela(lm, half));
      } else {
        var p2 = new T.PointLight(col, 1, 0, 2);
        p2.position.set(x, mh, z);
        add("STATEMENT", p2, lumensToCandela(lm));
      }
      return;
    }
    if (o.indexOf("ceiling-fan") === 0 && (p.lightKit || p.ringLight)) {
      var p3 = new T.PointLight(col, 1, 0, 2);
      p3.position.set(x, num(p, "hubHeight", 2.5) - 0.12, z);
      add("STATEMENT", p3, lumensToCandela(900));
      return;
    }

    // Everything else that glows: the cove, the headboard halo, the under-unit strips. The geometry says
    // where the light is, so it is sampled rather than guessed. A helper object is skipped whatever its
    // parts are called — a camera has a `Lens` and it is not a luminaire.
    if (isHelperObject(o)) return;
    var g = groups[inst.id];
    if (!g) return;
    var isCove = o.indexOf("false-ceiling") === 0;
    var res = inst.__emissive;
    if (!res) {
      res = [];
      var ev = evaluate(inst);
      ev.meshes.forEach(function (m) { if (EMISSIVE.test(m.name)) res.push(m); });
      inst.__emissive = res;
    }
    res.forEach(function (m) {
      samplePoints(m, isCove ? 8 : 3).forEach(function (c) {
        var l = new T.PointLight(col, 1, isCove ? 6 : 3, 2);
        l.position.set(x + c[0], c[2] + (isCove ? -0.05 : 0.02), z + c[1]);
        add(isCove ? "AMBIENT" : "ACCENT",
            l,
            lumensToCandela(isCove ? COVE_LUMENS_PER_POINT : ACCENT_LUMENS_PER_POINT));
      });
    });
  });

  aimSun();
  applyLighting();
}

function applyLighting() {
  Object.keys(lightRig.tiers).forEach(function (t) {
    var k = state.tier[t];
    lightRig.tiers[t].forEach(function (l) {
      l.intensity = l.userData.baseIntensity * k;
      l.visible = k > 0.001;
      l.castShadow = state.shadows && k > 0.001 && l.isSpotLight;
      if (l.castShadow && !l.shadow.mapSize.__set) {
        l.shadow.mapSize.set(1024, 1024);
        l.shadow.bias = -0.0008;
        l.shadow.normalBias = 0.02;
        l.shadow.camera.near = 0.15;
        l.shadow.camera.far = 12;
        l.shadow.mapSize.__set = true;
      }
    });
  });
  // Daylight scales the sun's own irradiance rather than replacing it, so 100% is the hour the plan
  // states and anything below it is the same sun through more curtain.
  var d = state.daylight;
  lightRig.sun.intensity = (lightRig.sunLux || 6000) * d;
  lightRig.sun.visible = d > 0.001;
  lightRig.sun.castShadow = state.shadows && d > 0.001;
  lightRig.hemi.intensity = 25 + 320 * d;
  renderer.toneMappingExposure = EXPOSURE_BASE * state.exposure;
  renderer.shadowMap.enabled = state.shadows;
  needs = true;
}

// ──────────────────────────────────────────────────────────────────────── boot

function initScene() {
  T.ColorManagement.legacyMode = false;
  renderer = new T.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setClearColor(0xCFC8BD, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFSoftShadowMap;
  stage.insertBefore(renderer.domElement, stage.firstChild);

  scene = new T.Scene();
  scene.environment = environment();
  camera = new T.PerspectiveCamera(view.fov, 1, 0.05, 120);
  raycaster = new T.Raycaster();

  content = new T.Group();
  content.name = "model-content";
  scene.add(content);

  lightRig.hemi = new T.HemisphereLight(0xdfe8f2, 0x8a7f70, 0.4);
  scene.add(lightRig.hemi);
  lightRig.sun = new T.DirectionalLight(0xfff0d8, 1);
  lightRig.sun.position.set(6, 7, -5);
  scene.add(lightRig.sun.target);
  lightRig.sun.shadow.mapSize.set(2048, 2048);
  lightRig.sun.shadow.camera.left = -9; lightRig.sun.shadow.camera.right = 9;
  lightRig.sun.shadow.camera.top = 9; lightRig.sun.shadow.camera.bottom = -9;
  lightRig.sun.shadow.camera.near = 0.5; lightRig.sun.shadow.camera.far = 40;
  lightRig.sun.shadow.bias = -0.0005; lightRig.sun.shadow.normalBias = 0.02;
  scene.add(lightRig.sun);

  // Centre the plan on the origin, from the room outline rather than the geometry: a camera tripod or a
  // beam cone standing outside the room would otherwise drag the centre with it.
  var room = PLAN.spaces[0];
  if (room) {
    var ring = room.nodeIds.map(function (i) { return nodeById[i]; }).filter(Boolean);
    var c = E.polygonCentroid(ring);
    centre.x = c.x / PPM; centre.z = c.y / PPM;
  }

  INSTANCES.forEach(function (inst) {
    var g = buildInstance(inst);
    groups[inst.id] = g;
    content.add(g);
  });
  refreshPickables();
  applyVisibility();
  buildLights();

  buildShots();
  bindInput();
  new ResizeObserver(resize).observe(stage);
  resize();
  // The overview first: the plan's own shot 1 starts a hand's width from a plant, which is a fine
  // photograph and a poor first impression.
  setOverview();
  var boot = $("boot");
  if (boot) boot.remove();
  tick();

  // A handle for the console. Nothing in the viewer reads it; it exists so the scene can be inspected
  // without unpicking the closure.
  window.__viewer = {
    scene: scene, camera: camera, renderer: renderer, content: content,
    instances: INSTANCES, byId: byId, groups: groups, lights: lightRig,
    state: state, shots: SHOTS, evaluate: evaluate, rebuild: rebuild,
    setShot: setShot, overview: setOverview, select: select
  };
}

function applyVisibility() {
  INSTANCES.forEach(function (inst) {
    var g = groups[inst.id];
    if (!g) return;
    g.visible = !state.hiddenObjects[inst.objectId];
    g.traverse(function (o) { if (o.isMesh && o.userData.helper) o.visible = state.helpers; });
  });
  needs = true;
}

function resize() {
  var w = stage.clientWidth || 1, h = stage.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  needs = true;
}

// ─────────────────────────────────────────────────────────────── camera + input

/** The shots the plan already carries. A camera object draws a view cone, so its DIRECTION is read off
 *  that geometry rather than from its rotation parameter — no convention to get wrong, and it can never
 *  disagree with what the object draws.
 *
 *  Built in `initScene`, NOT at module scope: an eye point is stated relative to the plan's centre, and
 *  the centre is not known until the room outline has been read. Computing these early put every shot a
 *  room's width away from where it belongs. */
var SHOTS = [];
function buildShots() {
  SHOTS = INSTANCES.filter(function (i) { return i.objectId.indexOf("camera") === 0; }).map(function (inst) {
    var p = paramsOf(inst), ev = evaluate(inst);
    var cone = ev.meshes.filter(function (m) { return /cone/i.test(m.name); })[0];
    var dir = [0, 1];
    if (cone) {
      var pts = cone.faces.reduce(function (a, f) { return a.concat(f); }, []);
      var c = pts.reduce(function (a, q) { return [a[0] + q[0], a[1] + q[1]]; }, [0, 0]);
      var l = Math.hypot(c[0], c[1]) || 1;
      dir = [c[0] / l, c[1] / l];
    }
    var label = String(p.semantics || inst.name);
    var m = label.match(/^\s*(\d+)\s*[-–—]?\s*(.+?)(?:\s*[-–—]\s|$)/);
    return {
      label: m ? m[2] : label.slice(0, 28),
      eye: [inst.anchor[0] - centre.x, num(p, "eyeHeight", 1.5), inst.anchor[1] - centre.z],
      dir: dir,
      dist: num(p, "targetDistance", 3.5),
      fov: 2 * Math.atan(num(p, "sensorWidth", 36) / 2 / num(p, "focalLength", 24)) * 180 / Math.PI,
      note: label
    };
  }).sort(function (a, b) { return a.note.localeCompare(b.note); });

  var bar = $("shots");
  bar.innerHTML = "";
  SHOTS.forEach(function (s, i) {
    var b = el("button", "tool", s.label);
    b.dataset.shot = String(i);
    b.title = s.note;
    b.addEventListener("click", function () { setShot(i); });
    bar.appendChild(b);
  });
  var ov = el("button", "tool", "Overview");
  ov.addEventListener("click", setOverview);
  bar.appendChild(ov);
}

var freeOrbit = true;
function setShot(i) {
  var s = SHOTS[i];
  if (!s) return;
  freeOrbit = false;
  view.target.set(s.eye[0] + s.dir[0] * s.dist, s.eye[1] * 0.85, s.eye[2] + s.dir[1] * s.dist);
  var d = new T.Vector3(s.eye[0], s.eye[1], s.eye[2]).sub(view.target);
  view.radius = d.length();
  view.theta = Math.atan2(d.x, d.z);
  view.phi = Math.acos(clamp(d.y / view.radius, -1, 1));
  view.fov = clamp(s.fov, 20, 95);
  Array.prototype.forEach.call(document.querySelectorAll("[data-shot]"), function (b) {
    b.setAttribute("aria-pressed", String(Number(b.dataset.shot) === i));
  });
  $("readoutSub").textContent = s.note;
  needs = true;
}
function setOverview() {
  freeOrbit = true;
  view.target.set(0, 1.2, 0);
  view.theta = 2.3; view.phi = 1.12; view.radius = 9.5; view.fov = 42;
  Array.prototype.forEach.call(document.querySelectorAll("[data-shot]"), function (b) { b.setAttribute("aria-pressed", "false"); });
  $("readoutSub").textContent = "Overview — drag to orbit, scroll to zoom, shift-drag to pan";
  needs = true;
}

function updateCamera() {
  var sp = Math.sin(view.phi), r = view.radius;
  camera.position.set(
    view.target.x + r * sp * Math.sin(view.theta),
    view.target.y + r * Math.cos(view.phi),
    view.target.z + r * sp * Math.cos(view.theta)
  );
  camera.lookAt(view.target);
  if (Math.abs(camera.fov - view.fov) > 0.01) { camera.fov = view.fov; camera.updateProjectionMatrix(); }
}

function bindInput() {
  var dom = renderer.domElement, drag = null;
  dom.addEventListener("pointerdown", function (e) {
    // A pointer id the element never saw — a synthetic event, or a stylus that reported late — throws
    // here, and an uncaught throw would leave the drag unarmed and the canvas dead to the next click.
    try { dom.setPointerCapture(e.pointerId); } catch (err) { /* capture is an optimisation, not a need */ }
    drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 1, moved: 0 };
  });
  dom.addEventListener("pointermove", function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.x = e.clientX; drag.y = e.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
    if (drag.pan) {
      var s = view.radius * 0.0016;
      var right = new T.Vector3().setFromMatrixColumn(camera.matrix, 0);
      var up = new T.Vector3().setFromMatrixColumn(camera.matrix, 1);
      view.target.addScaledVector(right, -dx * s).addScaledVector(up, dy * s);
    } else {
      view.theta -= dx * 0.005;
      view.phi = clamp(view.phi - dy * 0.005, 0.08, Math.PI - 0.08);
    }
    needs = true;
  });
  dom.addEventListener("pointerup", function (e) {
    if (drag && drag.moved < 5) pick(e);
    drag = null;
  });
  dom.addEventListener("wheel", function (e) {
    e.preventDefault();
    view.radius = clamp(view.radius * (e.deltaY > 0 ? 1.1 : 0.909), 0.4, 40);
    needs = true;
  }, { passive: false });
}

function pick(e) {
  var r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new T.Vector2(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -((e.clientY - r.top) / r.height) * 2 + 1
  ), camera);
  var hit = raycaster.intersectObjects(pickables, false)[0];
  if (hit) select(hit.object.userData.instance, hit.object.userData.mesh);
}

function tick() {
  requestAnimationFrame(tick);
  frames++;
  updateOcclusion();
  if (!needs) return;
  needs = false;
  updateCamera();
  renderer.render(scene, camera);
}
setInterval(function () { fps = frames; frames = 0; updateStats(); }, 1000);

/** Hide whatever the camera is standing OUTSIDE of, which is the same rule for a wall and for a ceiling:
 *  from inside the room nothing is removed and the shot is properly enclosed; from the overview the near
 *  walls and the ceiling come away on their own. No mode to remember, and no shot that looks at sky.
 *
 *  A wall's outward direction is its segment normal, oriented away from the room centre — which is the
 *  origin, because the model is translated there. */
function updateOcclusion() {
  var moved = false;

  INSTANCES.forEach(function (inst) {
    if (inst.objectId.indexOf("false-ceiling") !== 0 || !groups[inst.id]) return;
    var p = paramsOf(inst);
    var soffit = Math.max(num(p, "bandSoffit", 2.9), num(p, "panelSoffit", 3.1));
    var vis = state.ceiling && camera.position.y < soffit + 0.25;
    if (groups[inst.id].visible !== vis) { groups[inst.id].visible = vis; moved = true; }
  });

  if (!state.nearWalls) { if (moved) needs = true; return; }
  INSTANCES.forEach(function (inst) {
    if (inst.symbol !== "wall" || !groups[inst.id]) return;
    var a = nodeById[inst.seg.fromNodeId], b = nodeById[inst.seg.toNodeId];
    var mx = inst.anchor[0] - centre.x, mz = inst.anchor[1] - centre.z;
    var dx = (b.x - a.x) / PPM, dz = (b.y - a.y) / PPM, L = Math.hypot(dx, dz) || 1;
    var nx = -dz / L, nz = dx / L;
    var toCam = [camera.position.x - mx, camera.position.z - mz];
    var toMid = [-mx, -mz];  // room centre is the origin
    var outward = (nx * toMid[0] + nz * toMid[1]) < 0 ? 1 : -1;
    var vis = !((nx * outward * toCam[0] + nz * outward * toCam[1]) > 0);
    if (groups[inst.id].visible !== vis) { groups[inst.id].visible = vis; moved = true; }
  });
  if (moved) needs = true;
}

function updateStats() {
  var tris = 0;
  content.traverse(function (o) {
    if (o.isMesh && o.visible && o.parent.visible) tris += o.geometry.attributes.position.count / 3;
  });
  var nl = 0;
  Object.keys(lightRig.tiers).forEach(function (t) {
    lightRig.tiers[t].forEach(function (l) { if (l.visible) nl++; });
  });
  $("stats").textContent = INSTANCES.length + " objects · " + Math.round(tris).toLocaleString() + " triangles · "
    + nl + " lights · " + fps + " fps";
}

// ══════════════════════════════════════════════════════════════════════════ UI

// ---------------------------------------------------------------- moodboard tab
(function moodboard() {
  $("mbEyebrow").textContent = MOOD.eyebrow;
  $("mbTitle").textContent = MOOD.title;
  $("mbIntro").textContent = MOOD.intro;
  $("mbSource").textContent = MOOD.source;
  $("readoutMain").textContent = MOOD.title;

  var pal = $("mbPalette");
  MOOD.palette.forEach(function (c) {
    var b = el("button");
    b.title = "Copy " + c.hex;
    var sw = el("span", "sw"); sw.style.background = c.hex;
    var nm = el("span", "nm");
    nm.appendChild(el("b", null, c.name));
    nm.appendChild(document.createTextNode(c.use + " · " + c.hex));
    b.appendChild(sw); b.appendChild(nm);
    b.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(c.hex);
      b.title = "Copied";
    });
    pal.appendChild(b);
  });

  var fin = $("mbFinishes");
  MOOD.finishes.forEach(function (f) {
    var card = el("div", "card");
    var sw = el("span", "sw");
    sw.style.background = f.pbr.baseColor;
    if (f.emissive) sw.style.boxShadow = "inset 0 0 22px " + f.pbr.baseColor;
    var nm = el("span", "nm");
    nm.appendChild(el("b", null, f.name));
    nm.appendChild(document.createTextNode(f.use));
    card.appendChild(sw); card.appendChild(nm);
    card.title = f.material ? "Library material: " + f.material : "Viewer-local finish";
    fin.appendChild(card);
  });

  var zones = $("mbZones");
  MOOD.zones.forEach(function (z) {
    var d = el("div", "zone");
    d.appendChild(el("h4", null, z.title));
    var bar = el("div", "bar"); bar.style.background = z.accent;
    d.appendChild(bar);
    var ul = el("ul");
    z.items.forEach(function (i) { ul.appendChild(el("li", null, i)); });
    d.appendChild(ul);
    zones.appendChild(d);
  });

  var lit = $("mbLighting");
  MOOD.lighting.forEach(function (l) {
    var row = el("div", "row");
    row.appendChild(el("div", "tier", l.tier));
    var sw = el("label", "switch");
    var inp = document.createElement("input");
    inp.type = "checkbox"; inp.checked = state.tier[l.tier] > 0;
    inp.addEventListener("change", function () {
      state.tier[l.tier] = inp.checked ? 1 : 0;
      applyLighting(); save();
      var s = $("tierSlider-" + l.tier);
      if (s) { s.value = String(state.tier[l.tier]); s.nextSibling.textContent = Math.round(state.tier[l.tier] * 100) + "%"; }
    });
    sw.appendChild(inp); sw.appendChild(el("span"));
    row.appendChild(sw);
    row.appendChild(el("div", "nm", l.name));
    row.appendChild(el("div", "note", l.note));
    lit.appendChild(row);
  });
})();

// ------------------------------------------------------------------- object tab

/** The objects carry a flat parameter list, so the panel buckets them. Cheap keyword grouping beats one
 *  scroll of forty sliders, and it is the only place this file guesses at anything. */
var GROUPS = [
  { id: "size", label: "Size", re: /width|length|height|depth|diameter|radius|thk|thickness|size|drop|reach/i },
  { id: "detail", label: "Detail", re: /count|pitch|gap|groove|flute|panel|pad|channel|shelf|shelves|drawer|door|leaf|pane|bay|blade|pillow|bolster|wave|subdiv|taper|profile|style|trim|edge|lip|inset|reveal|filler|plinth|rail|handle|pull|mirror|cushion|lid|back|arrangement|shape|pattern|border|fringe|hatch|mode/i },
  { id: "light", label: "Light", re: /led|lumen|kelvin|beam|cone|cri|power|aperture|lux|glow|halo|kit|tilt|aim/i },
  { id: "place", label: "Placement", re: /rotation|anchor|fit|margin|flip|offset|mount|base|side|stack|opening|swing|hinge|operation|sill|lintel/i },
  { id: "notes", label: "Material & notes", re: /material|semantics|color|colour|identif/i }
];
var groupOf = function (key) {
  for (var i = 0; i < GROUPS.length; i++) if (GROUPS[i].re.test(key)) return GROUPS[i];
  return GROUPS[1];
};

var objBody = $("objBody"), objHead = $("objHead");

function select(id, meshName) {
  state.selected = id;
  renderObject(meshName);
  showTab("obj");
  var inst = byId[id];
  if (inst) $("readoutSub").textContent = inst.name + (meshName ? " · " + meshName : "");
}

function renderObject(meshName) {
  objBody.innerHTML = "";
  var inst = byId[state.selected];
  if (!inst) {
    objHead.innerHTML = "";
    objHead.appendChild(el("h2", null, "Nothing selected"));
    objHead.appendChild(el("p", null, "Click any surface in the view, or pick an object below."));
    var list = el("ul", "list");
    var counts = {};
    INSTANCES.forEach(function (i) { (counts[i.objectId] = counts[i.objectId] || []).push(i); });
    Object.keys(counts).sort().forEach(function (o) {
      var li = el("li");
      var sw = el("span", "sw2");
      sw.style.background = state.hiddenObjects[o] ? "transparent" : "#8C6440";
      var b = el("button", "pick", counts[o][0].name);
      b.addEventListener("click", function () { select(counts[o][0].id); });
      li.appendChild(sw); li.appendChild(b);
      li.appendChild(el("span", "cnt", "×" + counts[o].length));
      list.appendChild(li);
    });
    var sec = el("div", "section");
    sec.appendChild(el("h3", null, "Objects in this plan"));
    sec.appendChild(list);
    objBody.appendChild(sec);
    return;
  }

  objHead.innerHTML = "";
  objHead.appendChild(el("div", "eyebrow", inst.hostKind + " · " + inst.hostLabel + (inst.layer ? " · " + inst.layer : "")));
  objHead.appendChild(el("h2", null, inst.name));
  var sub = el("p", null, inst.def.id + (meshName ? "  —  " + meshName : ""));
  objHead.appendChild(sub);

  var back = el("div", "section");
  var row = el("div", "row");
  var bAll = el("button", "btn", "← All objects");
  bAll.addEventListener("click", function () { state.selected = null; renderObject(); });
  var bReset = el("button", "btn", "Reset this object");
  bReset.disabled = !state.overrides[inst.id];
  bReset.addEventListener("click", function () {
    delete state.overrides[inst.id];
    inst.__emissive = null;
    rebuild(inst); buildLights(); renderObject(); save();
  });
  var others = INSTANCES.filter(function (i) { return i.objectId === inst.objectId; });
  row.appendChild(bAll); row.appendChild(bReset);
  if (others.length > 1) {
    var bAll2 = el("button", "btn", "Apply to all " + others.length);
    bAll2.disabled = !state.overrides[inst.id];
    bAll2.addEventListener("click", function () {
      var ov = state.overrides[inst.id];
      others.forEach(function (o) {
        if (o.id === inst.id) return;
        state.overrides[o.id] = state.overrides[o.id] || {};
        Object.keys(ov).forEach(function (k) { state.overrides[o.id][k] = ov[k]; });
        o.__emissive = null;
        rebuild(o);
      });
      buildLights(); save();
    });
    row.appendChild(bAll2);
  }
  back.appendChild(row);
  objBody.appendChild(back);

  var params = E.spineParams(E.parseSpineObject(inst.defText)) || [];
  var live = paramsOf(inst);
  var buckets = {};
  params.forEach(function (p) {
    var g = groupOf(p.key);
    (buckets[g.id] = buckets[g.id] || { g: g, list: [] }).list.push(p);
  });

  GROUPS.forEach(function (g, gi) {
    var b = buckets[g.id];
    if (!b || !b.list.length) return;
    var det = el("details", "group");
    if (gi < 2) det.open = true;
    det.appendChild(el("summary", null, g.label));
    var fields = el("div", "fields");
    b.list.forEach(function (p) { fields.appendChild(control(inst, p, live)); });
    det.appendChild(fields);
    objBody.appendChild(det);
  });

  if (inst.metrics && inst.metrics.length) {
    var ms = el("div", "section");
    ms.appendChild(el("h3", null, "Computed"));
    var ul = el("ul", "metrics");
    inst.metrics.slice(0, 14).forEach(function (m) {
      var li = el("li");
      li.appendChild(el("span", null, m.name));
      li.appendChild(el("b", null, String(m.value) + (m.unit ? " " + m.unit : "")));
      ul.appendChild(li);
    });
    ms.appendChild(ul);
    objBody.appendChild(ms);
  }

  if (inst.meshNames && inst.meshNames.length) {
    var pm = el("div", "section");
    pm.appendChild(el("h3", null, "Parts"));
    var ul2 = el("ul", "list");
    inst.meshNames.forEach(function (n) {
      var li = el("li");
      var surf = matchSurface(inst.objectId, n);
      var fin = surf ? finishOf(state.finishes[surf.id]) : null;
      var sw = el("span", "sw2");
      sw.style.background = EMISSIVE.test(n) ? kelvinHex(inst.kelvin || 2800) : (fin ? fin.pbr.baseColor : "#bbb");
      li.appendChild(sw);
      li.appendChild(el("span", null, n));
      li.appendChild(el("span", "cnt", EMISSIVE.test(n) ? "emits" : surf ? surf.label : "own colour"));
      ul2.appendChild(li);
    });
    pm.appendChild(ul2);
    objBody.appendChild(pm);
  }
}

function control(inst, p, live) {
  var f = el("div", "field"), v = live[p.key];
  // An attachment only stores the parameters it overrode, so anything it stayed quiet about has to come
  // from the object's own default — otherwise the field renders blank and reads as "zero".
  if (v === undefined || v === null || (p.kind !== "text" && v === "")) v = p.default;
  var ov = state.overrides[inst.id];
  if (ov && Object.prototype.hasOwnProperty.call(ov, p.key)) f.classList.add("changed");
  var id = "f-" + inst.id + "-" + p.key;
  var lab = el("label", null, p.label);
  lab.htmlFor = id;
  f.appendChild(lab);

  var commit = function (value) {
    state.overrides[inst.id] = state.overrides[inst.id] || {};
    state.overrides[inst.id][p.key] = value;
    f.classList.add("changed");
    inst.__emissive = null;
    rebuild(inst);
    if (/kelvin|lumen|beam|cone|led|light|power|height/i.test(p.key)) buildLights();
    save();
  };

  if (p.kind === "checkbox") {
    var sw = el("label", "switch");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.id = id; cb.checked = !!v;
    cb.addEventListener("change", function () { commit(cb.checked); });
    sw.appendChild(cb); sw.appendChild(el("span"));
    f.appendChild(sw);
    return f;
  }
  if (p.kind === "select") {
    var sel = document.createElement("select");
    sel.id = id;
    (p.options || []).forEach(function (o) {
      var op = document.createElement("option");
      op.value = o.value; op.textContent = o.label;
      sel.appendChild(op);
    });
    sel.value = String(v);
    // A value the object no longer offers (a renamed option, or a plan written against an older
    // definition) would leave the select blank and silently rewrite the parameter on the next change.
    if (sel.selectedIndex < 0) {
      var keep = document.createElement("option");
      keep.value = String(v);
      keep.textContent = String(v) + " (not in this object)";
      sel.insertBefore(keep, sel.firstChild);
      sel.value = String(v);
      f.classList.add("changed");
    }
    sel.addEventListener("change", function () { commit(sel.value); });
    f.appendChild(sel);
    return f;
  }
  if (p.kind === "text") {
    var ta = document.createElement("textarea");
    ta.id = id; ta.value = String(v == null ? "" : v);
    ta.addEventListener("change", function () { commit(ta.value); });
    f.appendChild(el("span"));
    f.appendChild(ta);
    return f;
  }

  // number: a box that always shows the exact value, and a slider when the object declared a range
  var wrap = el("div", "num");
  var box = document.createElement("input");
  box.type = "number"; box.id = id;
  box.value = isFinite(Number(v)) ? String(Number(v)) : String(p.default);
  if (p.step != null) box.step = String(p.step);
  if (p.min != null) box.min = String(p.min);
  if (p.max != null) box.max = String(p.max);
  wrap.appendChild(box);
  wrap.appendChild(el("span", null, p.unit || (p.max != null && p.max <= 10 ? "m" : "")));
  f.appendChild(wrap);

  var rng = null;
  if (p.min != null && p.max != null) {
    rng = document.createElement("input");
    rng.type = "range";
    rng.min = String(p.min); rng.max = String(p.max);
    rng.step = String(p.step || (p.max - p.min) / 100);
    rng.value = box.value;
    rng.setAttribute("aria-label", p.label);
    var pending = 0;
    rng.addEventListener("input", function () {
      box.value = rng.value;
      // Coalesce to one evaluation per frame: a drag fires far faster than a rebuild can finish.
      if (pending) return;
      pending = requestAnimationFrame(function () { pending = 0; commit(Number(rng.value)); });
    });
    f.appendChild(rng);
  }
  box.addEventListener("change", function () {
    var n = Number(box.value);
    if (!isFinite(n)) { box.value = String(v); return; }
    if (p.min != null) n = Math.max(p.min, n);
    if (p.max != null) n = Math.min(p.max, n);
    box.value = String(n);
    if (rng) rng.value = String(n);
    commit(n);
  });
  return f;
}

// -------------------------------------------------------------------- scene tab
(function sceneTab() {
  var tiers = $("scTiers");
  ["AMBIENT", "TASK", "ACCENT", "STATEMENT"].forEach(function (t) {
    var lit = null;
    MOOD.lighting.forEach(function (l) { if (l.tier === t) lit = l; });
    var f = el("div", "field");
    f.appendChild(el("label", null, (lit ? lit.name : t)));
    var out = el("span", null, Math.round(state.tier[t] * 100) + "%");
    out.style.fontSize = "12px"; out.style.color = "var(--ink-3)"; out.style.justifySelf = "end";
    f.appendChild(out);
    var r = document.createElement("input");
    r.type = "range"; r.min = "0"; r.max = "1.6"; r.step = "0.05"; r.value = String(state.tier[t]);
    r.id = "tierSlider-" + t;
    r.setAttribute("aria-label", t.toLowerCase() + " level");
    r.addEventListener("input", function () {
      state.tier[t] = Number(r.value);
      out.textContent = Math.round(state.tier[t] * 100) + "%";
      applyLighting(); save();
    });
    f.appendChild(r);
    f.insertBefore(out, r);
    tiers.appendChild(f);
  });

  var slider = function (parent, label, min, max, step, get, set, fmt) {
    var f = el("div", "field");
    f.appendChild(el("label", null, label));
    var out = el("span", null, fmt(get()));
    out.style.fontSize = "12px"; out.style.color = "var(--ink-3)"; out.style.justifySelf = "end";
    f.appendChild(out);
    var r = document.createElement("input");
    r.type = "range"; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(get());
    r.setAttribute("aria-label", label);
    r.addEventListener("input", function () { set(Number(r.value)); out.textContent = fmt(get()); applyLighting(); save(); });
    f.appendChild(r);
    parent.appendChild(f);
  };
  var pc = function (v) { return Math.round(v * 100) + "%"; };
  slider($("scDay"), "Daylight", 0, 1.4, 0.05, function () { return state.daylight; }, function (v) { state.daylight = v; }, pc);
  slider($("scDay"), "Exposure", 0.3, 2.4, 0.05, function () { return state.exposure; }, function (v) { state.exposure = v; }, function (v) { return v.toFixed(2) + "×"; });

  var toggle = function (parent, label, key, after) {
    var f = el("div", "field");
    f.appendChild(el("label", null, label));
    var sw = el("label", "switch");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !!state[key];
    cb.setAttribute("aria-label", label);
    cb.addEventListener("change", function () { state[key] = cb.checked; after(); save(); });
    sw.appendChild(cb); sw.appendChild(el("span"));
    f.appendChild(sw);
    parent.appendChild(f);
  };
  toggle($("scView"), "Shadows", "shadows", applyLighting);
  toggle($("scView"), "False ceiling", "ceiling", function () { needs = true; });
  toggle($("scView"), "Cut away walls from outside", "nearWalls", function () {
    if (!state.nearWalls) applyVisibility();
    needs = true;
  });
  toggle($("scView"), "Show camera cones & beams", "helpers", applyVisibility);

  var fins = $("scFinishes");
  MOOD.surfaces.forEach(function (s) {
    var f = el("div", "field");
    f.appendChild(el("label", null, s.label));
    var sel = document.createElement("select");
    sel.setAttribute("aria-label", s.label + " finish");
    MOOD.finishes.forEach(function (fin) {
      var o = document.createElement("option");
      o.value = fin.token; o.textContent = fin.name;
      sel.appendChild(o);
    });
    sel.value = state.finishes[s.id];
    sel.addEventListener("change", function () {
      state.finishes[s.id] = sel.value;
      retint();
      if (state.selected) renderObject();
      save();
    });
    f.appendChild(sel);
    fins.appendChild(f);
  });

  var vis = $("scLayers");
  var seen = {};
  INSTANCES.forEach(function (i) { (seen[i.objectId] = seen[i.objectId] || []).push(i); });
  Object.keys(seen).sort().forEach(function (o) {
    var f = el("div", "field");
    f.appendChild(el("label", null, seen[o][0].name + "  ×" + seen[o].length));
    var sw = el("label", "switch");
    var cb = document.createElement("input");
    cb.type = "checkbox"; cb.checked = !state.hiddenObjects[o];
    cb.setAttribute("aria-label", "show " + seen[o][0].name);
    cb.addEventListener("change", function () {
      if (cb.checked) delete state.hiddenObjects[o]; else state.hiddenObjects[o] = true;
      applyVisibility(); save();
    });
    sw.appendChild(cb); sw.appendChild(el("span"));
    f.appendChild(sw);
    vis.appendChild(f);
  });
})();

// ------------------------------------------------------------------- export tab

/** The plan, with every override folded back into the attachment it belongs to. This round-trips: the
 *  file that comes out is the same shape as the file that went in, so the canvas editor can open it. */
function exportPlan() {
  var out = JSON.parse(JSON.stringify(PLAN));
  var apply = function (atts) {
    (atts || []).forEach(function (a) {
      var ov = state.overrides[a.id];
      if (!ov) return;
      a.params = a.params || {};
      Object.keys(ov).forEach(function (k) { a.params[k] = ov[k]; });
    });
  };
  out.segments.forEach(function (s) { apply(s.attachments); });
  out.nodes.forEach(function (n) { apply(n.attachments); });
  out.spaces.forEach(function (s) { apply(s.attachments); });
  out.settings = out.settings || {};
  out.settings.viewer = {
    editedAt: new Date().toISOString(),
    finishes: state.finishes,
    lighting: state.tier,
    daylight: state.daylight,
    exposure: state.exposure
  };
  return out;
}

/** The evaluated answer for every attachment, in the frame `bakeAttachments` documents: anchor in world
 *  metres, faces anchor-relative, z up. A consumer that owns no evaluator reads this and draws. */
function exportBaked() {
  return {
    schema: "baked-plan/1",
    bakedAt: new Date().toISOString(),
    frame: { units: "m", axes: "x east, y south (plan down-page), z up" },
    source: PLAN.settings.source || null,
    attachments: INSTANCES.map(function (inst) {
      var r = evaluate(inst);
      return {
        id: inst.id,
        objectId: inst.objectId,
        host: inst.hostKind,
        anchor: [Math.round(inst.anchor[0] * 1e4) / 1e4, Math.round(inst.anchor[1] * 1e4) / 1e4],
        params: paramsOf(inst),
        wallBand: !!r.wallBand,
        metrics: r.metrics.map(function (m) { return { name: m.name, value: m.value, key: m.key }; }),
        meshes: r.meshes.map(function (m) {
          return {
            id: m.id, name: m.name, color: m.color,
            faces: m.faces.map(function (f) {
              return f.map(function (p) { return p.map(function (v) { return Math.round(v * 1e4) / 1e4; }); });
            })
          };
        })
      };
    })
  };
}

(function exportTab() {
  var status = $("expStatus");
  var download = function (name, text) {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  $("expPlan").addEventListener("click", function () {
    download("floorplan_with_bedroom.edited.json", JSON.stringify(exportPlan(), null, 2));
    status.textContent = "Plan downloaded. It opens in the canvas editor unchanged.";
  });
  $("expBaked").addEventListener("click", function () {
    status.textContent = "Evaluating every attachment…";
    setTimeout(function () {
      var b = exportBaked();
      download("bedroom.baked.json", JSON.stringify(b));
      status.textContent = "Baked " + b.attachments.length + " attachments.";
    }, 20);
  });
  $("expCopy").addEventListener("click", function () {
    var t = JSON.stringify(exportPlan(), null, 2);
    $("expJson").value = t;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(t).then(
        function () { status.textContent = "Plan JSON copied."; },
        function () { $("expJson").select(); status.textContent = "Copying is blocked here — the JSON is selected below."; }
      );
    } else { $("expJson").select(); status.textContent = "The JSON is selected below; copy it with Ctrl+C."; }
  });
  $("expReset").addEventListener("click", function () {
    state.overrides = {};
    MOOD.surfaces.forEach(function (s) { state.finishes[s.id] = s.finish; });
    dropMaterials();
    INSTANCES.forEach(function (i) { i.__emissive = null; });
    INSTANCES.forEach(rebuild);
    refreshPickables();
    buildLights();
    renderObject();
    save();
    status.textContent = "Every parameter is back to the plan as it was loaded.";
  });

  var n = 0;
  INSTANCES.forEach(function (i) { n += Object.keys(i.base).length; });
  $("expCount").textContent = INSTANCES.length + " attachments · "
    + Object.keys(LIB).length + " object definitions · " + n + " parameters in the plan";
})();

// -------------------------------------------------------------------- tab bar
function showTab(id) {
  ["mood", "obj", "scene", "exp"].forEach(function (t) {
    $("tab-" + t).hidden = t !== id;
    $("btn-" + t).setAttribute("aria-selected", String(t === id));
  });
}
["mood", "obj", "scene", "exp"].forEach(function (t) {
  $("btn-" + t).addEventListener("click", function () { showTab(t); });
});
showTab("mood");
renderObject();

// ═══════════════════════════════════════════════════════════════════════ start
// Deferred a frame so the first paint is the panel, not a blank canvas — the scene build walks 50
// attachments and is the one genuinely slow moment in the file.
setTimeout(function () {
  try { initScene(); }
  catch (err) {
    var b = $("boot");
    if (b) b.textContent = "The 3D view failed to start: " + err.message;
    console.error(err);
  }
}, 30);

})();
