/** STEP 3 — put the lamp block on the ten objects that already exist.
 *
 *  WHAT IS ADDED. Photometry and bookkeeping: the numbers a renderer needs and a drawing cannot
 *  show, plus the schedule rows that fall out of them. `lamp` names a file in Library/Photometry
 *  that carries the rest — the fixture states only what it would override.
 *
 *  WHAT IS DELIBERATELY NOT ADDED. Geometry. No trim variants, no cove detail, no tape setback in
 *  its channel. Those change the face list of an object that is already published and in use, and
 *  they are the whole point of the new objects in step 4, where the body is written from scratch
 *  and can be checked against nothing. Keeping this pass non-geometric is what makes its test
 *  possible: EVERY pre-existing metric must come back bit-identical at the defaults, because
 *  nothing that was there before was touched.
 *
 *  THE ONE EXCEPTION is `led-strip`'s hard-coded 90 lm/W, which becomes a prop whose default is 90
 *  — parameterised, not changed, and the identity test proves it.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { validateFlow, propsOf, exprOf, slotsOf, nodeOf } from "./validate-flow.mjs";

export const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
export const sel = (id, name, value, options) => ({ id, name, type: "select", value, options });
export const chk = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
export const txt = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1,
                                    options: [], editable: true, showInCanvas: false, necessary: true });

/* ── the block every fixture gets ──────────────────────────────────────────────────────────── */

export const DIM = (id) => rng("dimLevel", "Dim level (%)", 100, 0, 100, 1);
export const RADIUS = (v) => rng("lampRadius", "Lamp radius (soft shadow)", v, 0.002, 0.5, 0.001);
export const CRI = () => rng("cri", "Colour rendering index", 90, 50, 100, 1);
export const EMITS = () => chk("emitsLight", "Export a lamp (off = geometry only)", true);
export const LUMENS = (v) => rng("lumens", "Output", v, 10, 50000, 10);
export const KELVIN = (v) => rng("kelvin", "Colour temperature", v, 1800, 8000, 50);
export const BLEND = (v) => rng("beamBlend", "Beam edge softness", v, 0, 1, 0.01);

/** The text props reach nothing — a path and a group name are writing information, and the geometry
 *  must not be able to read them. Same rule `material` and `semantics` already follow. */
export const LAMP_TEXT = (path, group) => [
  txt("lamp", "Lamp (Library/Photometry/…)", path),
  txt("lightGroup", "Light group", group),
];
export const SPOT_TEXT = () => [
  txt("iesProfile", "IES profile (Library/Photometry/ies/…)", ""),
  txt("lightLink", "Light linking (include / exclude)", ""),
];

/** Shared arithmetic. `lumensExpr` is whatever the fixture's own body already calls its output. */
export const LAMP_LINES = (lumensExpr, opts = {}) => [
  "# ── Lamp block ─────────────────────────────────────────────────────────────────────────────",
  "# The photometry a renderer needs and a drawing cannot show. Arithmetic on the inputs only:",
  "# nothing here lights anything, and `lamp` names the Photometry file that carries the rest.",
  "_lbDim = max(0, min(100, dimLevel)) / 100",
  `_lbLm = ${lumensExpr}`,
  "lampDimmed = _lbLm * _lbDim",
  "# 683 lm/W is the same constant material/1 uses for emission.luminance. Writing it in both",
  "# places is the point: a lit diffuser and the lamp behind it have to be reconcilable, and they",
  "# can only be reconciled through one number.",
  "lampWatts = lampDimmed / 683",
  "lampSoftSize = lampRadius",
  "lampEmits = emitsLight > 0 ? 1 : 0",
  ...(opts.cri === false ? [] : ["lampCri = cri"]),
  ...(opts.kelvin ? ["lampKelvin = kelvin"] : []),
];

export const LAMP_OUT = (opts = {}) => [
  { from: "lampDimmed", label: "Dimmed output (lm)" },
  { from: "lampWatts", label: "Blender watts (W)" },
  { from: "lampSoftSize", label: "Lamp radius (m)" },
  { from: "lampEmits", label: "Emits light" },
  ...(opts.cri === false ? [] : [{ from: "lampCri", label: "CRI" }]),
  ...(opts.kelvin ? [{ from: "lampKelvin", label: "Colour temperature (K)" }] : []),
];

/* ── per object ────────────────────────────────────────────────────────────────────────────── */

export const PATCHES = {
  // The generic carrier, and the only one that can stand for several lamps at once.
  light: {
    props: [rng("lampCount", "Lamps in this fitting", 1, 1, 60, 1), DIM(), BLEND(0.25), RADIUS(0.012), EMITS()],
    text: [...LAMP_TEXT("Photometry/LED/cob-spot-3000k.json", "key"), ...SPOT_TEXT()],
    lines: [
      "lampsUsed = max(1, round(lampCount))",
      "lampFeather = max(0, min(1, beamBlend))",
      ...LAMP_LINES("lumens * lampsUsed", { cri: false }),
    ],
    outputs: [{ from: "lampsUsed", label: "Lamps" }, { from: "lampFeather", label: "Beam blend" }, ...LAMP_OUT({ cri: false })],
  },

  // A run, not a fitting: output is per metre and the body already multiplies it by the run.
  "led-strip": {
    props: [CRI(), DIM(), BLEND(1), RADIUS(0.006),
            rng("efficacyLmW", "Efficacy", 90, 40, 220, 1),
            rng("diffuserTransmission", "Diffuser transmission", 0.7, 0.05, 1, 0.01),
            sel("voltage", "Supply", "24 V DC", ["12 V DC", "24 V DC", "48 V DC", "230 V AC"]),
            EMITS()],
    text: LAMP_TEXT("Photometry/LED/tape-warm-2700k.json", "cove"),
    replace: [["loadWatts = lumensPerMetre * _Ln / 90", "loadWatts = lumensPerMetre * _Ln / efficacyLmW"]],
    lines: [
      "lampFeather = max(0, min(1, beamBlend))",
      "lampVolts = voltage == '12 V DC' ? 12 : (voltage == '24 V DC' ? 24 : (voltage == '48 V DC' ? 48 : 230))",
      ...LAMP_LINES("lumens"),
      "# What actually leaves the channel. The tape is behind a diffuser and the diffuser eats some",
      "# of it — which is why a 900 lm/m tape behind opal does not read as 900 lm/m in the room.",
      "lampThroughDiffuser = lampDimmed * max(0.05, min(1, diffuserTransmission))",
    ],
    outputs: [{ from: "lampFeather", label: "Beam blend" }, { from: "lampVolts", label: "Supply (V)" },
              ...LAMP_OUT(), { from: "lampThroughDiffuser", label: "Through the diffuser (lm)" }],
  },

  downlight: {
    props: [CRI(), DIM(), BLEND(0.25), RADIUS(0.012), EMITS()],
    text: [...LAMP_TEXT("Photometry/LED/cob-spot-3000k.json", "downlights"), ...SPOT_TEXT()],
    lines: ["lampFeather = max(0, min(1, beamBlend))", ...LAMP_LINES("lumens")],
    outputs: [{ from: "lampFeather", label: "Beam blend" }, ...LAMP_OUT()],
  },

  pendant: {
    props: [CRI(), DIM(), RADIUS(0.03),
            rng("shadeTransmission", "Shade transmission", 0.12, 0, 1, 0.01), EMITS()],
    text: [...LAMP_TEXT("Photometry/LED/e27-globe-2700k.json", "pendants"),
           txt("material", "Material", "opal glass shade, brushed brass canopy, fabric flex"),
           txt("semantics", "Semantics", "warm pendant over a table, low hung, soft pool of light")],
    lines: [
      ...LAMP_LINES("lumens"),
      "# A shade is not opaque. What passes through it is the difference between a pendant that",
      "# reads as a lamp and one that reads as a hole in the ceiling, and it decides whether the",
      "# renderer wants a point inside the shade or an area light at its open bottom.",
      "lampThroughShade = lampDimmed * max(0, min(1, shadeTransmission))",
    ],
    outputs: [...LAMP_OUT(), { from: "lampThroughShade", label: "Through the shade (lm)" }],
  },

  // Its body already counts its own lamps, so `lumens` here is PER LAMP.
  chandelier: {
    props: [LUMENS(320), KELVIN(2700), CRI(), DIM(), RADIUS(0.03), EMITS()],
    text: LAMP_TEXT("Photometry/LED/e27-globe-2700k.json", "decorative"),
    lines: [
      "# `lampCount` is the body's own — arms times tiers — so the prop above is output PER LAMP and",
      "# the fitting's total is the product. A twelve-arm chandelier of 320 lm candles is 3840 lm.",
      ...LAMP_LINES("lumens * lampCount", { kelvin: true }),
      "lampPerLamp = lumens * _lbDim",
    ],
    outputs: [...LAMP_OUT({ kelvin: true }), { from: "lampPerLamp", label: "Per lamp (lm)" }],
  },

  "light-bulb": {
    props: [LUMENS(806), CRI(), DIM(), RADIUS(0.03), EMITS()],
    text: LAMP_TEXT("Photometry/LED/e27-globe-2700k.json", "decorative"),
    lines: LAMP_LINES("lumens"),
    outputs: LAMP_OUT(),
  },

  "floor-lamp": {
    props: [LUMENS(806), KELVIN(2700), CRI(), DIM(), RADIUS(0.06), EMITS()],
    text: [...LAMP_TEXT("Photometry/LED/e27-globe-2700k.json", "fill"),
           txt("material", "Material", "powder-coated steel stem, linen shade, weighted base")],
    lines: LAMP_LINES("lumens", { kelvin: true }),
    outputs: LAMP_OUT({ kelvin: true }),
  },

  "outdoor-light": {
    props: [LUMENS(1200), KELVIN(3000), CRI(), DIM(), RADIUS(0.04),
            rng("ulor", "Upward light output ratio", 0, 0, 1, 0.01),
            sel("ipRating", "Ingress protection", "IP65", ["IP20", "IP44", "IP65", "IP67"]),
            EMITS()],
    text: [...LAMP_TEXT("Photometry/LED/cob-spot-3000k.json", "exterior"),
           txt("material", "Material", "marine-grade anodised aluminium, tempered glass, gasketed")],
    lines: [
      ...LAMP_LINES("lumens", { kelvin: true }),
      "lampIp = ipRating == 'IP20' ? 20 : (ipRating == 'IP44' ? 44 : (ipRating == 'IP65' ? 65 : 67))",
      "# The share thrown at the sky. A dark-sky ordinance is written against exactly this number,",
      "# and it is the one photometric figure an exterior fitting is legally judged on.",
      "lampUpward = lampDimmed * max(0, min(1, ulor))",
    ],
    outputs: [...LAMP_OUT({ kelvin: true }), { from: "lampIp", label: "IP rating" },
              { from: "lampUpward", label: "Upward output (lm)" }],
  },

  // Not a fitting — a mirror that happens to be backlit. The HTML's two rect lights, as numbers.
  mirror: {
    props: [chk("backlit", "Backlit halo", true),
            rng("lumensPerMetre", "Halo output per metre", 700, 100, 3000, 10),
            KELVIN(4000), CRI(), DIM(), RADIUS(0.006),
            rng("haloGap", "Halo gap behind the glass", 0.02, 0.004, 0.1, 0.002),
            rng("frontFill", "Front fill", 0.12, 0, 1, 0.01),
            EMITS()],
    text: LAMP_TEXT("Photometry/LED/tape-neutral-4000k.json", "mirror"),
    lines: [
      "# The halo is tape behind the glass, so its run is the glass PERIMETER — a circle for a round",
      "# mirror, four sides for a rectangle. `_isRound` and `_rU` are the body's own, read after it",
      "# has set them.",
      "lampHaloRun = backlit > 0 ? (_isRound > 0 ? (2 * PI * _rU) : (2 * (overallLength + overallHeight))) : 0",
      ...LAMP_LINES("lumensPerMetre * lampHaloRun", { kelvin: true }),
      "# Two sources, not one, and the second is faint. A backlit mirror washes the wall behind it;",
      "# the small forward component is what stops the face in the mirror going flat, and running it",
      "# at full strength is what makes a vanity look like an interrogation.",
      "lampWallWash = lampDimmed",
      "lampFaceFill = lampDimmed * max(0, min(1, frontFill))",
      "lampHaloGap = haloGap",
    ],
    outputs: [{ from: "lampHaloRun", label: "Halo run (m)" }, ...LAMP_OUT({ kelvin: true }),
              { from: "lampWallWash", label: "Wall wash (lm)" }, { from: "lampFaceFill", label: "Face fill (lm)" },
              { from: "lampHaloGap", label: "Halo gap (m)" }],
  },

  // Its cove already knows how long it is; this says what is in the cove.
  "false-ceiling": {
    props: [rng("lumensPerMetre", "Cove output per metre", 900, 100, 3000, 10),
            KELVIN(2700), CRI(), DIM(), RADIUS(0.006), EMITS()],
    text: LAMP_TEXT("Photometry/LED/tape-warm-2700k.json", "cove"),
    lines: [
      "# `ledRun` is the body's own cove length, so the total is a real number rather than a wish:",
      "# turn the cove off and it goes to zero on its own.",
      ...LAMP_LINES("lumensPerMetre * ledRun", { kelvin: true }),
    ],
    outputs: LAMP_OUT({ kelvin: true }),
  },
};

/* ── the patcher ───────────────────────────────────────────────────────────────────────────── */

const PLACEMENT = new Set(["rotation", "anchorDir", "fitMode", "margin", "flipSide"]);

export function patchFlow(flow, patch) {
  const props = propsOf(flow);
  const propsId = nodeOf(flow, "input-props").id;
  const exprId = nodeOf(flow, "expr").id;
  const outId = nodeOf(flow, "output").id;
  const slots = slotsOf(flow);
  const have = new Set(props.map((p) => p.id));

  // Wired props go where the folder puts its own — after the object's, before placement.
  let at = props.findIndex((p) => PLACEMENT.has(p.id));
  if (at < 0) at = props.length;
  for (const p of patch.props ?? []) {
    if (have.has(p.id)) throw new Error(`prop "${p.id}" already exists`);
    props.splice(at++, 0, p);
    have.add(p.id);
    flow.edges.push({ id: `e_props_math_${p.id}`, source: propsId, target: exprId,
                      sourceHandle: `val-${p.id}`, targetHandle: `valin-${p.id}` });
  }
  for (const p of patch.text ?? []) {
    if (have.has(p.id)) throw new Error(`text prop "${p.id}" already exists`);
    props.push(p);
    have.add(p.id);
  }

  let body = exprOf(flow);
  for (const [from, to] of patch.replace ?? []) {
    if (!body.includes(from)) throw new Error(`replace target not found: ${from}`);
    body = body.replace(from, to);
  }
  const defined = new Set(body.split("\n").map((l) => (l.match(/^([A-Za-z_]\w*)\s*=(?!=)/) || [])[1]).filter(Boolean));
  for (const line of patch.lines ?? []) {
    const m = line.match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m && defined.has(m[1])) throw new Error(`the body already assigns "${m[1]}"`);
    if (m) defined.add(m[1]);
  }
  nodeOf(flow, "expr").data.params.expr = body + "\n" + (patch.lines ?? []).join("\n");

  let n = Math.max(...slots.map((s) => Number(String(s.id).replace(/\D/g, "")) || 0));
  for (const o of patch.outputs ?? []) {
    const id = `s${++n}`;
    slots.push({ id, label: o.label });
    flow.edges.push({ id: `e_math_out_${id}`, source: exprId, target: outId,
                      sourceHandle: `val-${o.from}`, targetHandle: `valin-${id}` });
  }
  return flow;
}

if (String(process.argv[1]).endsWith("patch.mjs")) {
  mkdirSync("tools/tmp-light/out", { recursive: true });
  let bad = 0;
  for (const [name, patch] of Object.entries(PATCHES)) {
    // Always start from step 1's output, never from this pass's own — so the chain re-runs.
    const src = existsSync(`tools/tmp-light/out-renamed/${name}.json`)
      ? readFileSync(`tools/tmp-light/out-renamed/${name}.json`, "utf8")
      : readFileSync(`tools/tmp-light/live/${name}.json`, "utf8");
    const before = validateFlow(JSON.parse(src));
    let flow, after, problems = [];
    try {
      flow = patchFlow(JSON.parse(src), patch);
      after = validateFlow(flow);
      problems = after.problems.filter((p) => !before.problems.includes(p));
      const drift = Object.keys(before.metrics).filter((k) => !Object.is(before.metrics[k], after.metrics[k]));
      if (drift.length) problems.push(`metrics MOVED: ${drift.map((k) => `${k} ${before.metrics[k]} -> ${after.metrics[k]}`).join(", ")}`);
    } catch (err) {
      problems = [err.message];
    }
    if (problems.length) { bad++; console.log(`FAIL ${name}`); problems.slice(0, 8).forEach((p) => console.log("      - " + p)); continue; }

    writeFileSync(`tools/tmp-light/out/${name}.json`, JSON.stringify(flow, null, 2) + "\n", "utf8");
    const m = after.metrics;
    console.log(`ok   ${name.padEnd(14)} +${String((patch.props ?? []).length).padStart(2)}p +${String((patch.text ?? []).length)}t +${String((patch.outputs ?? []).length).padStart(2)}s   ` +
                `${String(Object.keys(before.metrics).length).padStart(2)} metrics held   ` +
                `${(m["Dimmed output (lm)"] ?? 0).toFixed(0).padStart(6)} lm  ${(m["Blender watts (W)"] ?? 0).toFixed(3).padStart(8)} W`);
  }
  console.log(`\n${Object.keys(PATCHES).length} patched, ${bad} with problems`);
  process.exit(bad ? 1 : 0);
}
