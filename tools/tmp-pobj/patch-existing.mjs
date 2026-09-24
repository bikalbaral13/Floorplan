/** Add parameters to the LIVE Architectural objects, patching the published JSON rather than the
 *  spec modules — only 12 of the 81 objects in R2 still have a spec module, and the published file
 *  is the source of truth for all of them.
 *
 *  Every patch is ADDITIVE where it can be: new parts go into new groups appended to `Q`, so the
 *  geometry that already works is not rewritten. Where a line must change it is matched EXACTLY and
 *  replaced, and the run fails loudly if the anchor is not found.
 *
 *  `material` is a text prop wired to NOTHING, exactly like `semantics` (see add-semantics.mjs):
 *  writing information the geometry must not be able to read.
 *
 *  Metric defaults, converted at authoring time from bedroom_modelling_plan.md.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { exprInputs, runExprBody, liftScopeValue } from "@builderpluss/engine/node";

const rng = (id, name, value, min, max, step) => ({ id, name, type: "range", value, min, max, step, options: [] });
const sel = (id, name, value, options) => ({ id, name, type: "select", value, options });
const chk = (id, name, value) => ({ id, name, type: "checkbox", value, options: [] });
const txt = (id, name, value) => ({ id, name, type: "text", value, min: 0, max: 10, step: 1,
  options: [], editable: true, showInCanvas: false, necessary: true });

const solid = (name, g) => `${name} = sub(compress(_W, eq(col(_W,4), ${g})), 0, 0, _nw, 4)`;
const planOf = (name, g) => `${name} = sub(compress(_WP, eq(col(_WP,3), ${g})), 0, 0, _nwp, 3)`;
const L = (...lines) => lines.join("\n");

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   THE PATCHES
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const PATCHES = {};

/* ── NIGHTSTAND ─────────────────────────────────────────────────────────────────────────────── */
PATCHES["nightstand"] = {
  material: "light oak veneer, matte lacquer, ivory stone top",
  props: [{ after: "doorGap", add: [
    rng("mountHeight", "Wall-hung top height", 0.558, 0, 2.5, 0.005),
    chk("underLed", "LED under the unit", false),
    sel("pullType", "Pull", "Handle", ["Handle", "Groove", "Push"]),
  ] }],
  expr: [
    { after: "_gap = doorGap * _s", text: L(
      "# A wall-hung unit is dimensioned by the height of its TOP, not by a base that is not there.",
      "_mz = base == 'Wall-hung' ? max(0, mountHeight * _s - _Ht) : 0",
      "_pullH = pullType == 'Handle' ? 1 : 0",
      "_pullG = pullType == 'Groove' ? 1 : 0") },
    { replace: "Q = vcat(vcat(_TOP, _CAR), vcat(_BASE, _DRW))", with: L(
      "_pfV = _v0 - 0.012 * _s",
      "_pwT = 0.018 * _s",
      "_pHalf = min(0.07 * _s, _Ln * 0.3)",
      "_pzH = _carZ1 - 0.07 * _s",
      "_HDLq = hcat(0 - _pHalf, _pfV - _pwT, _pHalf, _pfV - _pwT, _pHalf, _pfV, 0 - _pHalf, _pfV, _pzH, _pzH + _pwT, 6)",
      "_HDL = (_pullH > 0 && _nD > 0) ? _HDLq : zeros(0, 11)",
      "_GRVq = hcat(_u0 + _gap, _pfV - 0.006 * _s, _u1 - _gap, _pfV - 0.006 * _s, _u1 - _gap, _pfV, _u0 + _gap, _pfV, _carZ1 - 0.03 * _s, _carZ1 - 0.012 * _s, 6)",
      "_GRV = (_pullG > 0 && _nD > 0) ? _GRVq : zeros(0, 11)",
      "_LEDq = hcat(_u0 + 0.03 * _s, _v0 + 0.03 * _s, _u1 - 0.03 * _s, _v0 + 0.03 * _s, _u1 - 0.03 * _s, _v1 - 0.02 * _s, _u0 + 0.03 * _s, _v1 - 0.02 * _s, _carZ0 - 0.012 * _s, _carZ0 - 0.003 * _s, 7)",
      "_LEDU = underLed > 0 ? _LEDq : zeros(0, 11)",
      "Q = vcat(vcat(vcat(_TOP, _CAR), vcat(_BASE, _DRW)), vcat(vcat(_HDL, _GRV), _LEDU))",
      "# Lift the FINISHED table once so mountHeight means the top of the unit. Threading the offset",
      "# through every z above would be the same number written eleven times.",
      "Q = hcat(sub(Q, 0, 0, rows(Q), 8), col(Q, 8) + _mz, col(Q, 9) + _mz, col(Q, 10))") },
    { after: "FrontsPlan = sub(compress(_WP, eq(col(_WP,3), 4)), 0, 0, _nwp, 3)", text: L(
      solid("Pulls3D", 6), solid("UnderLed3D", 7), planOf("PullsPlan", 6)) },
    { replace: "topLevel = _Ht", with: "topLevel = _Ht + _mz" },
    { append: L(
      "mountLift = _mz",
      "wallHung = base == 'Wall-hung' ? 1 : 0",
      "underLedRun = underLed > 0 ? (2 * max(0, _Ln - 0.06 * _s) + max(0, _Wd - 0.05 * _s)) : 0") },
  ],
  outputs: [
    { from: "Pulls3D", label: "Pulls — solid" }, { from: "UnderLed3D", label: "Under-unit LED — solid" },
    { from: "PullsPlan", label: "Pulls — plan" }, { from: "mountLift", label: "Mount lift (m)" },
    { from: "wallHung", label: "Wall-hung" }, { from: "underLedRun", label: "Under LED run (m)" },
  ],
  prims3d: [
    { id: "p3_pulls", from: "Pulls3D", kind: "polyhedron", name: "Pulls", color: "#c8a968", layer: "Nightstand", x: 0, y: 0, z: 0, show: true },
    { id: "p3_uled", from: "UnderLed3D", kind: "polyhedron", name: "Under-unit LED", color: "#fbbf24", layer: "Nightstand", x: 0, y: 0, z: 0, show: true },
  ],
  prims2d: [{ id: "p2_pulls", from: "PullsPlan", kind: "polygon", name: "Pulls", color: "#c8a968", layer: "Nightstand", show: true }],
};

/* ── TV UNIT ────────────────────────────────────────────────────────────────────────────────── */
PATCHES["tv-unit"] = {
  material: "light oak veneer drawer fronts, ivory stone top, matte",
  props: [{ after: "doorGap", add: [
    rng("mountHeight", "Wall-hung top height", 0.66, 0, 2.5, 0.005),
    chk("underLed", "LED under the unit", true),
    sel("pullType", "Pull", "Push", ["Handle", "Groove", "Push"]),
  ] }],
  expr: [
    { after: "_gap = doorGap * _s", text: L(
      "# A wall-hung console is dimensioned by the height of its TOP. The screen is NOT lifted with it:",
      "# screenHeight is an elevation from the floor and must stay one.",
      "_mz = base == 'Wall-hung' ? max(0, mountHeight * _s - _Ht) : 0",
      "_pullH = pullType == 'Handle' ? 1 : 0",
      "_pullG = pullType == 'Groove' ? 1 : 0") },
    { replace: "Q = vcat(vcat(_TOP, _CAR), vcat(_BASE, vcat(_DRW, _SC)))", with: L(
      "_bi = arange(_nB)",
      "_ob = ones(_nB, 1)",
      "_hu0 = _u0 + _bi * _bW + _gap",
      "_hu1 = _u0 + (_bi + 1) * _bW - _gap",
      "_hc = (_hu0 + _hu1) / 2",
      "_pfV = _v0 - 0.012 * _s",
      "_pwT = 0.018 * _s",
      "_pHalf = min(0.08 * _s, _bW * 0.3)",
      "_pzH = _carZ1 - 0.08 * _s",
      "_HDLq = hcat(_hc - _pHalf, _ob * (_pfV - _pwT), _hc + _pHalf, _ob * (_pfV - _pwT), _hc + _pHalf, _ob * _pfV, _hc - _pHalf, _ob * _pfV, _ob * _pzH, _ob * (_pzH + _pwT), _ob * 6)",
      "_HDL = _pullH > 0 ? _HDLq : zeros(0, 11)",
      "_GRVq = hcat(_hu0, _ob * (_pfV - 0.006 * _s), _hu1, _ob * (_pfV - 0.006 * _s), _hu1, _ob * _pfV, _hu0, _ob * _pfV, _ob * (_carZ1 - 0.032 * _s), _ob * (_carZ1 - 0.014 * _s), _ob * 6)",
      "_GRV = _pullG > 0 ? _GRVq : zeros(0, 11)",
      "_LEDq = hcat(_u0 + 0.04 * _s, _v0 + 0.04 * _s, _u1 - 0.04 * _s, _v0 + 0.04 * _s, _u1 - 0.04 * _s, _v1 - 0.02 * _s, _u0 + 0.04 * _s, _v1 - 0.02 * _s, _carZ0 - 0.014 * _s, _carZ0 - 0.004 * _s, 7)",
      "_LEDU = underLed > 0 ? _LEDq : zeros(0, 11)",
      "Q = vcat(vcat(vcat(_TOP, _CAR), vcat(_BASE, _DRW)), vcat(vcat(_HDL, _GRV), _LEDU))",
      "Q = hcat(sub(Q, 0, 0, rows(Q), 8), col(Q, 8) + _mz, col(Q, 9) + _mz, col(Q, 10))",
      "Q = vcat(Q, _SC)") },
    { after: "ScreenPlan = sub(compress(_WP, eq(col(_WP,3), 5)), 0, 0, _nwp, 3)", text: L(
      solid("Pulls3D", 6), solid("UnderLed3D", 7), planOf("PullsPlan", 6)) },
    { append: L(
      "mountLift = _mz",
      "wallHung = base == 'Wall-hung' ? 1 : 0",
      "topLevelAbs = _Ht + _mz",
      "underLedRun = underLed > 0 ? (2 * max(0, _Ln - 0.08 * _s) + max(0, _Wd - 0.06 * _s)) : 0") },
  ],
  outputs: [
    { from: "Pulls3D", label: "Pulls — solid" }, { from: "UnderLed3D", label: "Under-unit LED — solid" },
    { from: "PullsPlan", label: "Pulls — plan" }, { from: "mountLift", label: "Mount lift (m)" },
    { from: "wallHung", label: "Wall-hung" }, { from: "topLevelAbs", label: "Top of console (m)" },
    { from: "underLedRun", label: "Under LED run (m)" },
  ],
  prims3d: [
    { id: "p3_pulls", from: "Pulls3D", kind: "polyhedron", name: "Pulls", color: "#c8a968", layer: "TV unit", x: 0, y: 0, z: 0, show: true },
    { id: "p3_uled", from: "UnderLed3D", kind: "polyhedron", name: "Under-unit LED", color: "#fbbf24", layer: "TV unit", x: 0, y: 0, z: 0, show: true },
  ],
  prims2d: [{ id: "p2_pulls", from: "PullsPlan", kind: "polygon", name: "Pulls", color: "#c8a968", layer: "TV unit", show: true }],
};

/* ── TV ─────────────────────────────────────────────────────────────────────────────────────── */
PATCHES["tv"] = {
  material: "matte black bezel, anti-glare panel",
  props: [{ after: "centreHeight", add: [
    rng("standoff", "Standoff from face", 0.038, 0, 0.25, 0.002),
    chk("backLed", "Bias light behind the set", false),
  ] }],
  expr: [
    { replace: "_v0 = 0 - _Wd / 2", with: L(
      "# Standoff pushes the SET off whatever it is mounted on — fluting, a panel, a batten — while the",
      "# bracket still reaches back to that face. Both v planes move together so the depth is unchanged.",
      "_so = standoff * _s",
      "_v0 = 0 - _Wd / 2 - _so") },
    { replace: "_v1 = _Wd / 2", with: "_v1 = _Wd / 2 - _so" },
    { replace: "Q = vcat(vcat(_BODY, _SCR), vcat(_STAND, _BRC))", with: L(
      "# Bias light — a frame in the standoff gap, not a slab: a lit rectangle behind a TV would read",
      "# as a glowing box rather than as a wash on the wall.",
      "_lb = 0.02 * _s",
      "_lwT = 0.015 * _s",
      "_lv0 = _v1",
      "_lv1 = _v1 + max(0.008 * _s, _so)",
      "_E1 = hcat(_u0 + _lb, _lv0, _u0 + _lb + _lwT, _lv0, _u0 + _lb + _lwT, _lv1, _u0 + _lb, _lv1, _z0 + _lb, _z1 - _lb, 4)",
      "_E2 = hcat(_u1 - _lb - _lwT, _lv0, _u1 - _lb, _lv0, _u1 - _lb, _lv1, _u1 - _lb - _lwT, _lv1, _z0 + _lb, _z1 - _lb, 4)",
      "_E3 = hcat(_u0 + _lb + _lwT, _lv0, _u1 - _lb - _lwT, _lv0, _u1 - _lb - _lwT, _lv1, _u0 + _lb + _lwT, _lv1, _z1 - _lb - _lwT, _z1 - _lb, 4)",
      "_E4 = hcat(_u0 + _lb + _lwT, _lv0, _u1 - _lb - _lwT, _lv0, _u1 - _lb - _lwT, _lv1, _u0 + _lb + _lwT, _lv1, _z0 + _lb, _z0 + _lb + _lwT, 4)",
      "_LEDB = backLed > 0 ? vcat(vcat(_E1, _E2), vcat(_E3, _E4)) : zeros(0, 11)",
      "Q = vcat(vcat(vcat(_BODY, _SCR), vcat(_STAND, _BRC)), _LEDB)") },
    { after: "MountPlan = sub(compress(_WP, eq(col(_WP,3), 3)), 0, 0, _nwp, 3)", text: solid("BackLed3D", 4) },
    { append: L(
      "standoffGap = _so",
      "faceProjection = _Wd + _so",
      "backLedRun = backLed > 0 ? (2 * max(0, _Ln - 0.04 * _s) + 2 * max(0, _Ht - 0.04 * _s)) : 0") },
  ],
  outputs: [
    { from: "BackLed3D", label: "Bias light — solid" }, { from: "standoffGap", label: "Standoff (m)" },
    { from: "faceProjection", label: "Projection from face (m)" }, { from: "backLedRun", label: "Bias light run (m)" },
  ],
  prims3d: [{ id: "p3_bled", from: "BackLed3D", kind: "polyhedron", name: "Bias light", color: "#fbbf24", layer: "TV", x: 0, y: 0, z: 0, show: true }],
  prims2d: [],
};

/* ── WARDROBE ───────────────────────────────────────────────────────────────────────────────── */
PATCHES["wardrobe"] = {
  material: "light oak veneer, matte lacquer, bronze-tinted mirror panel",
  props: [{ after: "handles", add: [
    sel("mirrorPanel", "Mirror on", "None", ["None", "First panel", "Last panel", "All panels"]),
    sel("grooveStyle", "Grooves", "None", ["None", "Vertical", "Horizontal", "Handle only"]),
    rng("grooveWidth", "Groove width", 0.019, 0.004, 0.06, 0.001),
    rng("grooveCount", "Grooves per leaf", 3, 1, 12, 1),
    chk("topFiller", "Top filler to ceiling", false),
    rng("fillerTo", "Filler up to", 2.972, 1, 4.5, 0.001),
    sel("endPanel", "End panel", "None", ["None", "Left", "Right", "Both"]),
  ] }],
  expr: [
    { after: "_HD = (handles > 0 && _ndr > 0) ? _HDr : zeros(0, 11)", text: L(
      "# Mirror and grooves are applied to the DOOR TABLE THAT ALREADY EXISTS — the same _da / _db /",
      "# _dv0 the leaves were built from — so a leaf that moves takes its mirror and its grooves with it.",
      "_mSel = mirrorPanel == 'All panels' ? ones(_ndr, 1) : (mirrorPanel == 'First panel' ? eq(_di, 0) : (mirrorPanel == 'Last panel' ? eq(_di, _ndr - 1) : fill(_ndr, 1, 0)))",
      "_mIn = 0.05 * _s",
      "_mT = 0.004 * _s",
      "_MRt = hcat(_da + _mIn, _dv0 - _mT, _db - _mIn, _dv0 - _mT, _db - _mIn, _dv0, _da + _mIn, _dv0, fill(_ndr,1,_cz0 + _mIn), fill(_ndr,1,_cz1 - _mIn), fill(_ndr,1,7))",
      "_MIR = _ndr > 0 ? compress(_MRt, _mSel) : zeros(0, 11)",
      "# Grooves — leaves crossed with grooves-per-leaf in one kron pair, so one groove or twelve is",
      "# the same four lines. 'Handle only' is the same recess reduced to one per leading edge.",
      "_gV = grooveStyle == 'Vertical'",
      "_gH = grooveStyle == 'Horizontal'",
      "_gP = grooveStyle == 'Handle only'",
      "_gwT = grooveWidth * _s",
      "_gdT = 0.006 * _s",
      "_ng = max(1, round(grooveCount))",
      "_gn = _ndr * _ng",
      "_gj = kron(ones(_ndr, 1), arange(_ng))",
      "_gda = kron(_da, ones(_ng, 1))",
      "_gdb = kron(_db, ones(_ng, 1))",
      "_gdv = kron(_dv0, ones(_ng, 1))",
      "_gpx = (_gdb - _gda) / (_ng + 1)",
      "_gu0 = _gda + (_gj + 1) * _gpx - _gwT / 2",
      "_gVt = hcat(_gu0, _gdv - _gdT, _gu0 + _gwT, _gdv - _gdT, _gu0 + _gwT, _gdv, _gu0, _gdv, fill(_gn,1,_cz0), fill(_gn,1,_cz1), fill(_gn,1,8))",
      "_gpz = (_cz1 - _cz0) / (_ng + 1)",
      "_gz0 = _cz0 + (_gj + 1) * _gpz - _gwT / 2",
      "_gHt = hcat(_gda, _gdv - _gdT, _gdb, _gdv - _gdT, _gdb, _gdv, _gda, _gdv, _gz0, _gz0 + _gwT, fill(_gn,1,8))",
      "_gPt = hcat(_db - _gwT - 0.01 * _s, _dv0 - _gdT, _db - 0.01 * _s, _dv0 - _gdT, _db - 0.01 * _s, _dv0, _db - _gwT - 0.01 * _s, _dv0, fill(_ndr,1,_cz0 + _mIn), fill(_ndr,1,_cz1 - _mIn), fill(_ndr,1,8))",
      "_GRV = _ndr < 1 ? zeros(0, 11) : (_gV ? _gVt : (_gH ? _gHt : (_gP ? _gPt : zeros(0, 11))))",
      "# Top filler carries the carcass up to a ceiling line so there is no dust shelf above it.",
      "_fz = max(_cz1, fillerTo)",
      "_FILr = hcat(_u0, _v0, _u1, _v0, _u1, _v1, _u0, _v1, _cz1, _fz, 9)",
      "_FIL = (topFiller > 0 && _fz > _cz1 + 0.002) ? _FILr : zeros(0, 11)",
      "_epTop = topFiller > 0 ? _fz : _cz1",
      "_epL = endPanel == 'Left' || endPanel == 'Both'",
      "_epR = endPanel == 'Right' || endPanel == 'Both'",
      "_epT = _t * 1.6",
      "_EP1 = hcat(_u0 - _epT, _v0 - 0.02 * _s, _u0, _v0 - 0.02 * _s, _u0, _v1, _u0 - _epT, _v1, 0, _epTop, 10)",
      "_EP2 = hcat(_u1, _v0 - 0.02 * _s, _u1 + _epT, _v0 - 0.02 * _s, _u1 + _epT, _v1, _u1, _v1, 0, _epTop, 10)",
      "_EPN = vcat(_epL ? _EP1 : zeros(0, 11), _epR ? _EP2 : zeros(0, 11))") },
    { replace: "Q = vcat(_S1, _S2, _TP, _BT, _BK, _PL0, _SH, _RL, _DR, _HD)",
      with: "Q = vcat(_S1, _S2, _TP, _BT, _BK, _PL0, _SH, _RL, _DR, _HD, _MIR, _GRV, _FIL, _EPN)" },
    { after: "RailPlan = sub(compress(_WP, eq(col(_WP,3), 6)), 0, 0, _nwp, 3)", text: L(
      solid("Mirror3D", 7), solid("Grooves3D", 8), solid("Filler3D", 9), solid("EndPanels3D", 10),
      planOf("MirrorPlan", 7), planOf("EndPanelsPlan", 10)) },
    { append: L(
      "mirrorLeaves = mirrorPanel == 'None' ? 0 : (mirrorPanel == 'All panels' ? _ndr : min(1, _ndr))",
      "mirrorArea = mirrorLeaves * max(0, _dw - 2 * _mIn) * max(0, _cz1 - _cz0 - 2 * _mIn)",
      "grooveRun = grooveStyle == 'None' ? 0 : (_gV ? (_gn * (_cz1 - _cz0)) : (_gH ? (_gn * _dw) : (_ndr * (_cz1 - _cz0 - 2 * _mIn))))",
      "fillerHeight = (topFiller > 0) ? max(0, _fz - _cz1) : 0",
      "totalHeight = (topFiller > 0) ? _fz : _Ht",
      "endPanelCount = _epL + _epR") },
  ],
  outputs: [
    { from: "Mirror3D", label: "Mirror — solid" }, { from: "Grooves3D", label: "Grooves — solid" },
    { from: "Filler3D", label: "Top filler — solid" }, { from: "EndPanels3D", label: "End panels — solid" },
    { from: "MirrorPlan", label: "Mirror — plan" }, { from: "EndPanelsPlan", label: "End panels — plan" },
    { from: "mirrorLeaves", label: "Mirrored leaves" }, { from: "mirrorArea", label: "Mirror area (m²)" },
    { from: "grooveRun", label: "Groove run (m)" }, { from: "fillerHeight", label: "Top filler height (m)" },
    { from: "totalHeight", label: "Total height (m)" }, { from: "endPanelCount", label: "End panels" },
  ],
  prims3d: [
    { id: "p3_mir", from: "Mirror3D", kind: "polyhedron", name: "Mirror", color: "#b7c3c9", layer: "Wardrobe", x: 0, y: 0, z: 0, show: true },
    { id: "p3_grv", from: "Grooves3D", kind: "polyhedron", name: "Grooves", color: "#44403c", layer: "Wardrobe", x: 0, y: 0, z: 0, show: true },
    { id: "p3_fil", from: "Filler3D", kind: "polyhedron", name: "Top filler", color: "#a8a29e", layer: "Wardrobe", x: 0, y: 0, z: 0, show: true },
    { id: "p3_epn", from: "EndPanels3D", kind: "polyhedron", name: "End panels", color: "#8a6a45", layer: "Wardrobe", x: 0, y: 0, z: 0, show: true },
  ],
  prims2d: [
    { id: "p2_mir", from: "MirrorPlan", kind: "polygon", name: "Mirror", color: "#b7c3c9", layer: "Wardrobe", show: true },
    { id: "p2_epn", from: "EndPanelsPlan", kind: "polygon", name: "End panels", color: "#8a6a45", layer: "Wardrobe", show: true },
  ],
};

/* ── CURTAIN ────────────────────────────────────────────────────────────────────────────────── */
PATCHES["curtain"] = {
  material: "sheer linen inner, warm-beige blackout outer",
  props: [{ after: "railExtend", add: [
    sel("layers", "Layers", "Sheer + blackout", ["Sheer only", "Blackout only", "Sheer + blackout"]),
    rng("layerGap", "Gap between layers", 0.06, 0.02, 0.25, 0.005),
    sel("mount", "Mount", "Rod", ["Rod", "Ceiling track", "Recessed track"]),
    sel("stackSide", "Stack to", "Both", ["Both", "Left", "Right"]),
    rng("hemClearance", "Hem above floor", 0.006, 0, 0.12, 0.002),
  ] }],
  expr: [
    { replace: "_railR = railRadius * _s", with: L(
      "# A track is not a rod: no finials, and a slimmer section. One flag, read three times.",
      "_isRod = mount == 'Rod'",
      "_railR = _isRod ? (railRadius * _s) : (railRadius * _s * 0.6)") },
    { replace: "_zBot = max(0, _railZ - _Dr)", with: "_zBot = max(hemClearance * _s, _railZ - _Dr)" },
    { replace: "_bl = eq(_pi % 2, 0)", with: L(
      "# Stack side overrides the alternating bunch: asked for one end, EVERY panel gathers there.",
      "_stL = stackSide == 'Left'",
      "_stR = stackSide == 'Right'",
      "_nrw = rows(_pi)",
      "_bl = _stL ? fill(_nrw, 1, 1) : (_stR ? fill(_nrw, 1, 0) : eq(_pi % 2, 0))") },
    { replace: "Q = hcat(_ua, _va, _ub, _vb, _ub, _vb + _fT, _ua, _va + _fT, fill(_nqf,1,_zBot), fill(_nqf,1,_zTop), fill(_nqf,1,1))",
      with: L(
      "# Two layers are the SAME wave table offset in v and given its own group — a sheer and a",
      "# blackout are one curtain built twice, not two curtains that have to be kept in step.",
      "_lBoth = layers == 'Sheer + blackout'",
      "_lgap = layerGap * _s",
      "_Qa = hcat(_ua, _va, _ub, _vb, _ub, _vb + _fT, _ua, _va + _fT, fill(_nqf,1,_zBot), fill(_nqf,1,_zTop), fill(_nqf,1,1))",
      "_Qb = hcat(_ua, _va + _lgap, _ub, _vb + _lgap, _ub, _vb + _lgap + _fT, _ua, _va + _lgap + _fT, fill(_nqf,1,_zBot), fill(_nqf,1,_zTop), fill(_nqf,1,3))",
      "Q = _lBoth ? vcat(_Qa, _Qb) : _Qa") },
    { replace: "_FIN = vcat(hcat(_u0 - _ext - _finR, 0, _railZ, _u0 - _ext, 0, _railZ, _finR), hcat(_u1 + _ext, 0, _railZ, _u1 + _ext + _finR, 0, _railZ, _finR))",
      with: L(
      "_FINr = vcat(hcat(_u0 - _ext - _finR, 0, _railZ, _u0 - _ext, 0, _railZ, _finR), hcat(_u1 + _ext, 0, _railZ, _u1 + _ext + _finR, 0, _railZ, _finR))",
      "_FIN = _isRod ? _FINr : zeros(0, 7)") },
    { after: "FabricPlan = sub(compress(_WP, eq(col(_WP,3), 1)), 0, 0, _nwp, 3)", text: L(
      solid("Blackout3D", 3), planOf("BlackoutPlan", 3)) },
    { append: L(
      "layerCount = _lBoth ? 2 : 1",
      "hemGap = _zBot",
      "isTrack = _isRod ? 0 : 1",
      "stackToLeft = _stL ? 1 : 0",
      "stackToRight = _stR ? 1 : 0",
      "layerSpacing = _lBoth ? _lgap : 0") },
  ],
  outputs: [
    { from: "Blackout3D", label: "Blackout layer — solid" }, { from: "BlackoutPlan", label: "Blackout layer — plan" },
    { from: "layerCount", label: "Layers" }, { from: "hemGap", label: "Hem above floor (m)" },
    { from: "isTrack", label: "Track (not rod)" }, { from: "stackToLeft", label: "Stacks left" },
    { from: "stackToRight", label: "Stacks right" }, { from: "layerSpacing", label: "Layer spacing (m)" },
  ],
  prims3d: [{ id: "p3_blk", from: "Blackout3D", kind: "polyhedron", name: "Blackout layer", color: "#d9cbb5", layer: "Curtain", x: 0, y: 0, z: 0, show: true }],
  prims2d: [{ id: "p2_blk", from: "BlackoutPlan", kind: "polygon", name: "Blackout layer", color: "#d9cbb5", layer: "Curtain", show: true }],
};

/* ── TESSELLATION ───────────────────────────────────────────────────────────────────────────── */
PATCHES["tessellation"] = {
  material: "ivory marble-look porcelain, matt, 1 mm matching grout",
  props: [{ after: "cellSize", add: [
    rng("cellLength", "Cell length (0 = square)", 0, 0, 8, 0.01),
    sel("originCorner", "Start from", "NW", ["NW", "NE", "SW", "SE"]),
    rng("startOffsetX", "Start offset — X", 0, -4, 4, 0.01),
    rng("startOffsetY", "Start offset — Y", 0, -4, 4, 0.01),
  ] }],
  expr: [
    { after: "_S = max(max(0.02, cellSize), _Smin)", text: L(
      "# A RECTANGULAR cell is the square cell stretched in y. Only Square and Brick survive that",
      "# stretch as themselves — a stretched hexagon or triangle is a different tiling, not the same",
      "# one longer — so the aspect is ignored for the other three and `cellLengthUsed` says so.",
      "_cellRect = cellLength > 0.001 && (_isSq || _isBr)",
      "_cellY = _cellRect ? max(0.02, cellLength) : _S") },
    { replace: "_Tsq = vcat(hcat(0 - _S / 2, 0 - _S / 2), hcat(_S / 2, 0 - _S / 2), hcat(_S / 2, _S / 2), hcat(0 - _S / 2, _S / 2))",
      with: "_Tsq = vcat(hcat(0 - _S / 2, 0 - _cellY / 2), hcat(_S / 2, 0 - _cellY / 2), hcat(_S / 2, _cellY / 2), hcat(0 - _S / 2, _cellY / 2))" },
    { replace: "_Tbr = vcat(hcat(0 - _S / 2, 0 - _S / 4), hcat(_S / 2, 0 - _S / 4), hcat(_S / 2, _S / 4), hcat(0 - _S / 2, _S / 4))",
      with: "_Tbr = vcat(hcat(0 - _S / 2, 0 - _cellY / 4), hcat(_S / 2, 0 - _cellY / 4), hcat(_S / 2, _cellY / 4), hcat(0 - _S / 2, _cellY / 4))" },
    { replace: "_py = _isSq ? _S : (_isBr ? _S / 2 : (_isHx ? 1.5 * _R6 : _hT))",
      with: "_py = _isSq ? _cellY : (_isBr ? _cellY / 2 : (_isHx ? 1.5 * _R6 : _hT))" },
    { replace: "_ny = ceil((_bh + 2 * _S) / _py) + 2", with: "_ny = ceil((_bh + 2 * _cellY) / _py) + 2" },
    { replace: "_ox = _x0 - _S - _shift", with: L(
      "# The start corner phases the lattice; it does not move the tiles that are drawn. Measuring from",
      "# the far edge is the same expression with the lattice's own span taken off it.",
      "_fromE = originCorner == 'NE' || originCorner == 'SE'",
      "_fromN = originCorner == 'NW' || originCorner == 'NE'",
      "_ox = _fromE ? (_x1 + _S + _shift - _nx * _px + startOffsetX) : (_x0 - _S - _shift + startOffsetX)") },
    { replace: "_oy = _y0 - _S", with: "_oy = _fromN ? (_y1 + _cellY - _ny * _py + startOffsetY) : (_y0 - _cellY + startOffsetY)" },
    { append: L(
      "cellLengthUsed = _cellY",
      "cellAspect = _S > 0 ? (_cellY / _S) : 1",
      "rectangularCell = _cellRect ? 1 : 0",
      "startsFromEast = _fromE ? 1 : 0",
      "startsFromNorth = _fromN ? 1 : 0") },
  ],
  outputs: [
    { from: "cellLengthUsed", label: "Cell length used (m)" }, { from: "cellAspect", label: "Cell aspect" },
    { from: "rectangularCell", label: "Rectangular cell" }, { from: "startsFromEast", label: "Starts from east" },
    { from: "startsFromNorth", label: "Starts from north" },
  ],
  prims3d: [], prims2d: [],
};

/* ── LIGHT BULB ─────────────────────────────────────────────────────────────────────────────── */
PATCHES["light-bulb"] = {
  material: "brushed brass shade, clear glass lamp",
  props: [{ after: "cordRadius", add: [
    sel("shadeStyle", "Shade", "None", ["None", "Cylinder", "Drum", "Cone"]),
    rng("shadeDia", "Shade diameter", 0.051, 0.02, 0.8, 0.002),
    rng("shadeHeight", "Shade height", 0.305, 0.03, 1.2, 0.005),
    rng("dropTo", "Drop bottom to (0 = use cord)", 0, 0, 5, 0.01),
    rng("kelvin", "Colour temperature", 2700, 2200, 6500, 100),
  ] }],
  expr: [
    { replace: "_cord = _isPend ? cordLength * _s : 0", with: L(
      "# A pendant in a drawing is dimensioned by where its BOTTOM lands, not by how much cord was",
      "# ordered. `dropTo` inverts that: the cord becomes whatever puts the shade's bottom at the",
      "# level asked for, and 0 hands control back to the cord length.",
      "_shOn = shadeStyle != 'None'",
      "_shH = _shOn ? shadeHeight * _s : 0",
      "_shR = shadeDia * _s / 2",
      "_cordAuto = max(0, mountHeight * _s - dropTo - _shH)",
      "_cord = _isPend ? (dropTo > 0.001 ? _cordAuto : cordLength * _s) : 0") },
    { append: L(
      "# Shade — the same lathe the glass uses, with a two-radius profile. Cylinder and Drum differ",
      "# only in the two radii; Cone is the same profile with the top one pulled in.",
      "_isCyl = shadeStyle == 'Cylinder'",
      "_isDrum = shadeStyle == 'Drum'",
      "_isCone = shadeStyle == 'Cone'",
      "_shR0 = _isCone ? (_shR * 0.42) : (_isDrum ? (_shR * 1.04) : _shR)",
      "_shR1 = _isDrum ? (_shR * 0.92) : _shR",
      "_shTop = _capZ",
      "_shProf = vcat(hcat(0, 0), hcat(0, _shR0), hcat(_shH, _shR1), hcat(_shH, 0))",
      "_shSeg = hcat(_wcx, _wcy, _shTop, _wcx, _wcy, _shTop + _up)",
      "Shade3D = _shOn ? mlathe(_shSeg, _shProf, _sd) : zeros(0, 4)",
      "ShadePlan = _shOn ? hcat(_wcx, _wcy, max(_shR0, _shR1)) : zeros(0, 3)",
      "colourTemp = kelvin",
      "shadeDiameter = _shOn ? (2 * max(_shR0, _shR1)) : 0",
      "shadeDrop = _shH",
      "bottomLevel = _capZ + _up * _shH",
      "cordUsed = _cord") },
  ],
  outputs: [
    { from: "Shade3D", label: "Shade — solid" }, { from: "ShadePlan", label: "Shade — plan" },
    { from: "colourTemp", label: "Colour temperature (K)" }, { from: "shadeDiameter", label: "Shade diameter (m)" },
    { from: "shadeDrop", label: "Shade height (m)" }, { from: "bottomLevel", label: "Bottom of fitting (m)" },
    { from: "cordUsed", label: "Cord used (m)" },
  ],
  prims3d: [{ id: "p3_shade", from: "Shade3D", kind: "polyhedron", name: "Shade", color: "#c8a968", layer: "Lighting", x: 0, y: 0, z: 0, show: true }],
  prims2d: [{ id: "p2_shade", from: "ShadePlan", kind: "circle", name: "Shade", color: "#c8a968", layer: "Lighting", show: true }],
};

/* ── CEILING FAN ────────────────────────────────────────────────────────────────────────────── */
PATCHES["ceiling-fan"] = {
  material: "matte black blades, brushed brass hub, opal ring diffuser",
  props: [{ after: "lightRadius", add: [
    chk("ringLight", "Integrated ring light", false),
    rng("ringDia", "Ring diameter", 0.35, 0.1, 1.2, 0.01),
    rng("ringThk", "Ring section", 0.03, 0.008, 0.12, 0.002),
    rng("kelvin", "Colour temperature", 3000, 2200, 6500, 100),
  ] }],
  expr: [
    { after: "_bladeZ = _hubBot + _hubH / 2", text: L(
      "# The ring light is the answer to 'fan or chandelier' in a room too small for both — it is a",
      "# torus under the hub, sized independently of the lamp kit so the two can coexist.",
      "_rgR = max(_hubR + 0.02 * _s, ringDia * _s / 2)",
      "_rgT = max(0.004, ringThk * _s / 2)",
      "_rgZ = _hubBot - _rgT") },
    { append: L(
      "_RGr = hcat(0, 0, _rgZ, 0, 0, _rgZ + 0.01 * _s, _rgR, _rgT)",
      "_RGl = ringLight > 0 ? _RGr : zeros(0, 8)",
      "_r1u = _cu + col(_RGl,0)",
      "_r1v = _cv + col(_RGl,1)",
      "_r2u = _cu + col(_RGl,3)",
      "_r2v = _cv + col(_RGl,4)",
      "RingLight3D = hcat(_r1u * _ux + _r1v * _vx, _r1u * _uy + _r1v * _vy, col(_RGl,2), _r2u * _ux + _r2v * _vx, _r2u * _uy + _r2v * _vy, col(_RGl,5), col(_RGl,6), col(_RGl,7))",
      "_wcx2 = _cu * _ux + _cv * _vx",
      "_wcy2 = _cu * _uy + _cv * _vy",
      "RingLightPlan = ringLight > 0 ? hcat(_wcx2, _wcy2, _rgR + _rgT) : zeros(0, 3)",
      "ringDiameter = ringLight > 0 ? (2 * _rgR) : 0",
      "ringElevation = _rgZ",
      "colourTemp = kelvin") },
  ],
  outputs: [
    { from: "RingLight3D", label: "Ring light" }, { from: "RingLightPlan", label: "Ring light — plan" },
    { from: "ringDiameter", label: "Ring diameter (m)" }, { from: "ringElevation", label: "Ring elevation (m)" },
    { from: "colourTemp", label: "Colour temperature (K)" },
  ],
  prims3d: [{ id: "p3_ring", from: "RingLight3D", kind: "ring", name: "Ring light", color: "#fde68a", layer: "Lighting", x: 0, y: 0, z: 0, show: true }],
  prims2d: [{ id: "p2_ring", from: "RingLightPlan", kind: "circle", name: "Ring light", color: "#fde68a", layer: "Lighting", show: true }],
};

/* ── CHANDELIER ─────────────────────────────────────────────────────────────────────────────── */
PATCHES["chandelier"] = {
  material: "brushed brass frame, opal glass",
  props: [{ after: "arms", add: [
    sel("style", "Style", "Arms", ["Arms", "Linear bar", "Tiered rings", "Globe cluster", "Flush"]),
  ] }],
  expr: [
    { after: "_na = max(2, round(arms))", text: L(
      "# Style changes WHERE the lamps go, not what they are. Every expression after this reads",
      "# _ax / _ay / _zArm and needs no branch of its own.",
      "_stBar = style == 'Linear bar'",
      "_stRing = style == 'Tiered rings'",
      "_stGlobe = style == 'Globe cluster'",
      "_stFlush = style == 'Flush'") },
    { replace: "_colTop = _ceil - _chn", with: "_colTop = _ceil - (_stFlush ? 0 : _chn)" },
    { replace: "_zArm = _colBot + 0.06 * _s + _ti * _tR",
      with: "_zArm = _colBot + 0.06 * _s + _ti * _tR - (_stGlobe ? ((_ai % 3) * _tR * 0.7) : 0)" },
    { replace: "_ax = _rad * cos(_ang)", with: L(
      "# A linear bar is the same lamps on one axis instead of on a circle — one expression, not a",
      "# second body, which is why the tier and offset machinery above still applies to it.",
      "_barU = (_ai / max(1, _na - 1) - 0.5) * 2 * _rad",
      "_ax = _stBar ? _barU : _rad * cos(_ang)") },
    { replace: "_ay = _rad * sin(_ang)", with: "_ay = _stBar ? (_ai * 0) : _rad * sin(_ang)" },
    { replace: "_ARM = hcat(_hubX, _hubY, _zArm + _aD, _ax, _ay, _zArm, fill(_nrow,1,_colR * 0.35))",
      with: L(
      "_ARMq = hcat(_hubX, _hubY, _zArm + _aD, _ax, _ay, _zArm, fill(_nrow,1,_colR * 0.35))",
      "_ARM = (_stRing || _stFlush) ? zeros(0, 7) : _ARMq") },
    { replace: "_CUP = hcat(_ax, _ay, _zArm, _ax, _ay, _zArm + 0.03 * _s, fill(_nrow,1,_cupR))",
      with: L(
      "_CUPq = hcat(_ax, _ay, _zArm, _ax, _ay, _zArm + 0.03 * _s, fill(_nrow,1,_cupR))",
      "_CUP = (_stRing || _stFlush) ? zeros(0, 7) : _CUPq") },
    { replace: "_CAND = hcat(_ax, _ay, _zArm + 0.03 * _s, _ax, _ay, _zArm + 0.03 * _s + _cdH, fill(_nrow,1,_cdR))",
      with: L(
      "# A globe is a candle that is short and fat — the same tube row with two numbers changed.",
      "_cdHu = _stGlobe ? (_cdR * 2.2) : _cdH",
      "_cdRu = _stGlobe ? (_cdR * 2.2) : _cdR",
      "_CANDq = hcat(_ax, _ay, _zArm + 0.03 * _s, _ax, _ay, _zArm + 0.03 * _s + _cdHu, fill(_nrow,1,_cdRu))",
      "_CAND = (_stRing || _stFlush) ? zeros(0, 7) : _CANDq") },
    { replace: "_RGl = ring > 0 ? _RGr : zeros(0, 8)", with: L(
      "# Tiered rings gives every tier its own torus at that tier's radius and height — the same two",
      "# numbers the arms would have used, so the rings land exactly where the arms were.",
      "_tiR = arange(_nt)",
      "_RGm = hcat(fill(_nt,1,0), fill(_nt,1,0), _colBot + 0.06 * _s + _tiR * _tR, fill(_nt,1,0), fill(_nt,1,0), _colBot + 0.16 * _s + _tiR * _tR, _aR - _tiR * _tS, fill(_nt,1,_rgT))",
      "_RGl = _stRing ? _RGm : (ring > 0 ? _RGr : zeros(0, 8))") },
    { append: L(
      "isFlush = _stFlush ? 1 : 0",
      "isLinear = _stBar ? 1 : 0",
      "lampSpread = _stBar ? (2 * _aR) : (2 * _aR)",
      "ringsDrawn = _stRing ? _nt : (ring > 0 ? 1 : 0)",
      "visibleLamps = (_stRing || _stFlush) ? 0 : (_na * _nt)") },
  ],
  outputs: [
    { from: "isFlush", label: "Flush mounted" }, { from: "isLinear", label: "Linear bar" },
    { from: "lampSpread", label: "Lamp spread (m)" }, { from: "ringsDrawn", label: "Rings" },
    { from: "visibleLamps", label: "Visible lamps" },
  ],
  prims3d: [], prims2d: [],
};

/* ── MIRROR ─────────────────────────────────────────────────────────────────────────────────── */
PATCHES["mirror"] = {
  material: "bronze-tinted mirror, flush-set, no frame",
  props: [{ after: "showFrame", add: [
    sel("tint", "Tint", "Clear", ["Clear", "Bronze", "Grey", "Antique"]),
    chk("flushMount", "Flush-set (no frame, no standoff)", false),
  ] }],
  expr: [
    { replace: "_FRAME = (_hasF > 0 && _isRect > 0) ? vcat(vcat(_FR1, _FR2), vcat(_FR3, _FR4)) : zeros(0, 11)",
      with: L(
      "# Flush-set is what a mirror inside a wardrobe shutter is: no frame and no standoff, because",
      "# both would stop it sitting in the leaf.",
      "_flush = flushMount > 0",
      "_FRAME = (_hasF > 0 && _isRect > 0 && _flush == 0) ? vcat(vcat(_FR1, _FR2), vcat(_FR3, _FR4)) : zeros(0, 11)") },
    { replace: "_GLS = hcat(_gu0, _v0 + 0.01 * _s, _gu1, _v0 + 0.01 * _s, _gu1, _v1, _gu0, _v1, _gz0, _gz1, 2)",
      with: L(
      "_glV = _flush ? _v0 : (_v0 + 0.01 * _s)",
      "_GLS = hcat(_gu0, _glV, _gu1, _glV, _gu1, _v1, _gu0, _v1, _gz0, _gz1, 2)") },
    { append: L(
      "# Tint is not geometry, but it is the difference between a mirror that brightens a room and one",
      "# that darkens it, so it is carried as a reported reflectance rather than left to the renderer.",
      "tintLevel = tint == 'Clear' ? 0 : (tint == 'Bronze' ? 1 : (tint == 'Grey' ? 2 : 3))",
      "reflectance = tint == 'Clear' ? 0.92 : (tint == 'Bronze' ? 0.62 : (tint == 'Grey' ? 0.55 : 0.45))",
      "flushSet = _flush ? 1 : 0",
      "glassArea = max(0, _gu1 - _gu0) * max(0, _gz1 - _gz0)") },
  ],
  outputs: [
    { from: "tintLevel", label: "Tint level" }, { from: "reflectance", label: "Reflectance" },
    { from: "flushSet", label: "Flush-set" }, { from: "glassArea", label: "Glass area (m²)" },
  ],
  prims3d: [], prims2d: [],
};

/* ── WINDOW ─────────────────────────────────────────────────────────────────────────────────── */
PATCHES["window"] = {
  material: "slim aluminium frame, clear double glazing, stone sill",
  props: [{ after: "showFrame", add: [
    rng("sillProjection", "Sill projection into room", 0.03, 0, 0.35, 0.005),
    rng("sillThk", "Sill thickness", 0.03, 0.008, 0.15, 0.005),
    rng("sillOverhang", "Sill overhang each side", 0.05, 0, 0.3, 0.005),
  ] }],
  expr: [
    { after: "_T = _fr ? vcat(_T, hcat(0, 0, _W, _th, _zJ1, _lint, 1, 0, _th)) : _T", text: L(
      "# The sill is a real board, because the window seat next to it is dimensioned LEVEL WITH IT —",
      "# a sill that is only a number is a dimension nobody can build to.",
      "_spj = max(0, sillProjection)",
      "_sth = max(0.005, sillThk)",
      "_sov = max(0, sillOverhang)",
      "_sTh = _th + _spj",
      "_T = vcat(_T, hcat(0, 0 - _spj / 2, _W + 2 * _sov, _sTh, max(0, _sill - _sth), _sill, 3, 1, _sTh))") },
    { replace: "GlassMesh = zeros(0, 4)", with: L("GlassMesh = zeros(0, 4)", "SillMesh = zeros(0, 4)") },
    { replace: "GlassMesh = _g > 1.5 ? vcat(GlassMesh, _solid) : GlassMesh", with: L(
      "GlassMesh = (_g > 1.5 && _g < 2.5) ? vcat(GlassMesh, _solid) : GlassMesh",
      "SillMesh = _g > 2.5 ? vcat(SillMesh, _solid) : SillMesh") },
    { after: "GlassPlan = sub(compress(_All, eq(_gc, 2)), 0, 0, _nr, 3)",
      text: "SillPlan = sub(compress(_All, eq(_gc, 3)), 0, 0, _nr, 3)" },
    { append: L(
      "sillLevel = _sill",
      "sillProjectsBy = _spj",
      "sillBoardDepth = _sTh",
      "sillBoardLength = _W + 2 * _sov",
      "sillUnderside = max(0, _sill - _sth)") },
  ],
  outputs: [
    { from: "SillMesh", label: "Sill — solid" }, { from: "SillPlan", label: "Sill — plan" },
    { from: "sillLevel", label: "Sill level (m)" }, { from: "sillProjectsBy", label: "Sill projection (m)" },
    { from: "sillBoardDepth", label: "Sill board depth (m)" }, { from: "sillBoardLength", label: "Sill board length (m)" },
    { from: "sillUnderside", label: "Sill underside (m)" },
  ],
  prims3d: [{ id: "p3_sill", from: "SillMesh", kind: "polyhedron", name: "Sill", color: "#e7e5e4", layer: "Window", x: 0, y: 0, z: 0, show: true }],
  prims2d: [{ id: "p2_sill", from: "SillPlan", kind: "polygon", name: "Sill", color: "#e7e5e4", layer: "Window", show: true }],
};

/* ── BED ────────────────────────────────────────────────────────────────────────────────────── */
PATCHES["bed"] = {
  material: "ivory bouclé upholstery, light oak base, crisp linen",
  props: [{ after: "boardThk", add: [
    sel("headboardStyle", "Headboard", "Attached", ["Attached", "None", "Wide panel"]),
    rng("headboardOverhang", "Wide panel overhang each side", 0.3, 0, 1.2, 0.01),
    sel("baseStyle", "Base", "Legs", ["Legs", "Plinth", "Floating"]),
    chk("duvet", "Duvet over the mattress", false),
    rng("duvetDrop", "Duvet overhang", 0.12, 0, 0.5, 0.01),
  ] }],
  expr: [
    { after: "_hasFb = footboard > 0", text: L(
      "# Headboard style decides whether the bed carries its own board at all. 'None' is for a room",
      "# where an upholstered WALL panel does the job — the bed must then not draw a second one.",
      "_hbNone = headboardStyle == 'None'",
      "_hbWide = headboardStyle == 'Wide panel'",
      "_hbOver = _hbWide ? (headboardOverhang * _s) : 0",
      "_bsLegs = baseStyle == 'Legs'",
      "_bsPlinth = baseStyle == 'Plinth'",
      "_bsFloat = baseStyle == 'Floating'") },
    { replace: "_HB = hcat(_u0, _v0, _u0 + _bdT, _v0, _u0 + _bdT, _v1, _u0, _v1, _legH, _legH + _hbH, 3)",
      with: L(
      "_HBq = hcat(_u0, _v0 - _hbOver, _u0 + _bdT, _v0 - _hbOver, _u0 + _bdT, _v1 + _hbOver, _u0, _v1 + _hbOver, _legH, _legH + _hbH, 3)",
      "_HB = _hbNone ? zeros(0, 11) : _HBq") },
    { replace: "_BASE = hcat(_u0, _v0, _u1, _v0, _u1, _v1, _u0, _v1, _legH, _baseTop, 1)",
      with: L(
      "# Plinth and Floating are the same divan on a different foot: a plinth is a recessed box that",
      "# replaces the legs, and Floating simply leaves the gap empty so the divan reads cantilevered.",
      "_plIn = min(_Wd, _Ln) * 0.07",
      "_BASE = hcat(_u0, _v0, _u1, _v0, _u1, _v1, _u0, _v1, _legH, _baseTop, 1)",
      "_PLNq = hcat(_u0 + _plIn, _v0 + _plIn, _u1 - _plIn, _v0 + _plIn, _u1 - _plIn, _v1 - _plIn, _u0 + _plIn, _v1 - _plIn, 0, _legH, 6)",
      "_PLN = (_bsPlinth && _legH > 0.002) ? _PLNq : zeros(0, 11)") },
    { replace: "Q = vcat(_L1, _L2, _L3, _L4, _BASE, _HB, _FB, _MAT, _PIL)", with: L(
      "_LEGS = _bsLegs ? vcat(vcat(_L1, _L2), vcat(_L3, _L4)) : zeros(0, 11)",
      "_dOv = duvetDrop * _s",
      "_duT = 0.06 * _s",
      "_DUVq = hcat(_u0 + _bdT + _pilD + 0.06 * _s, _v0 - _dOv, _mu1, _v0 - _dOv, _mu1, _v1 + _dOv, _u0 + _bdT + _pilD + 0.06 * _s, _v1 + _dOv, _matTop, _matTop + _duT, 7)",
      "_DUV = duvet > 0 ? _DUVq : zeros(0, 11)",
      "Q = vcat(_LEGS, _BASE, _HB, _FB, _MAT, _PIL, _PLN, _DUV)") },
    { after: "PillowsPlan = sub(compress(_WP, eq(col(_WP,3), 4)), 0, 0, _nwp, 3)", text: L(
      solid("Plinth3D", 6), solid("Duvet3D", 7), planOf("DuvetPlan", 7)) },
    { append: L(
      "headboardDrawn = _hbNone ? 0 : 1",
      "headboardWidth = _hbNone ? 0 : (_Wd + 2 * _hbOver)",
      "headboardTop = _hbNone ? 0 : (_legH + _hbH)",
      "baseIsFloating = _bsFloat ? 1 : 0",
      "baseIsPlinth = _bsPlinth ? 1 : 0",
      "duvetArea = duvet > 0 ? ((_mu1 - _u0 - _bdT - _pilD - 0.06 * _s) * (_Wd + 2 * _dOv)) : 0") },
  ],
  outputs: [
    { from: "Plinth3D", label: "Plinth — solid" }, { from: "Duvet3D", label: "Duvet — solid" },
    { from: "DuvetPlan", label: "Duvet — plan" }, { from: "headboardDrawn", label: "Headboard drawn" },
    { from: "headboardWidth", label: "Headboard width (m)" }, { from: "headboardTop", label: "Headboard top (m)" },
    { from: "baseIsFloating", label: "Floating base" }, { from: "baseIsPlinth", label: "Plinth base" },
    { from: "duvetArea", label: "Duvet area (m²)" },
  ],
  prims3d: [
    { id: "p3_plinth", from: "Plinth3D", kind: "polyhedron", name: "Plinth", color: "#57534e", layer: "Bed", x: 0, y: 0, z: 0, show: true },
    { id: "p3_duvet", from: "Duvet3D", kind: "polyhedron", name: "Duvet", color: "#f8f6f1", layer: "Bed", x: 0, y: 0, z: 0, show: true },
  ],
  prims2d: [{ id: "p2_duvet", from: "DuvetPlan", kind: "polygon", name: "Duvet", color: "#f8f6f1", layer: "Bed", show: true }],
};

/* ── material-only ──────────────────────────────────────────────────────────────────────────── */
PATCHES["plant"] = { material: "healthy green foliage, terracotta pot", props: [], expr: [], outputs: [], prims3d: [], prims2d: [] };
PATCHES["planter-box"] = { material: "light oak trough, matte, green planting", props: [], expr: [], outputs: [], prims3d: [], prims2d: [] };
PATCHES["rug"] = { material: "grey wool, flat weave, plain", props: [], expr: [], outputs: [], prims3d: [], prims2d: [] };
PATCHES["wall"] = { material: "plastered masonry, warm white matte emulsion", props: [], expr: [], outputs: [], prims3d: [], prims2d: [] };

/* ═══════════════════════════════════════════════════════════════════════════════════════════════
   THE PATCHER
   ═══════════════════════════════════════════════════════════════════════════════════════════════ */
const HOSTS = { node: [[0, 0]], segment: [[0, 0], [4, 0]], space: [[0, 0], [3.962, 0], [3.962, 3.734], [0, 3.734]] };
const isM = (v) => Array.isArray(v) && (v.length === 0 || Array.isArray(v[0]));

function faceProblems(M) {
  if (!isM(M) || !M.length) return [];
  const bad = [];
  if (M.some((r) => r.length !== 4 || !r.every(Number.isFinite))) return ["bad row"];
  const seen = new Set();
  let i = 0;
  while (i < M.length) {
    const f = M[i][3];
    let j = i;
    while (j < M.length && M[j][3] === f) j++;
    if (j - i < 3) bad.push(`face ${f}: ${j - i} verts`);
    if (seen.has(f)) bad.push(`face ${f} split`);
    seen.add(f);
    i = j;
  }
  return bad;
}

/** Wiring + evaluation problems, so a patch can be judged on what it ADDED. */
/** The six spine nodes, found by TOOL. Ids differ across the folder's two generations — tessellation
 *  calls its output node `output_1`, window calls its source `source` — so an id is not an address. */
const spine = (flow) => {
  const by = (t) => flow.nodes.find((n) => n.data?.tool === t);
  const n = { geo: by("source"), props: by("input-props"), math: by("expr"), out: by("output"), r2d: by("render-2d"), r3d: by("render-3d") };
  for (const [k, v] of Object.entries(n)) if (!v) throw new Error(`no ${k} node`);
  return n;
};

function inspect(flow) {
  const problems = [];
  const N = spine(flow);
  const props = N.props.data.params.props;
  const mathBody = N.math.data.params.expr;
  const inputs = exprInputs(mathBody);
  const unwired = new Set(props.filter((p) => p.type === "text" && (p.id === "semantics" || p.id === "material")).map((p) => p.id));
  const wiredIds = props.filter((p) => !unwired.has(p.id)).map((p) => p.id);
  for (const p of wiredIds) if (!inputs.includes(p)) problems.push(`prop "${p}" never read by the body`);
  for (const v of inputs) if (!wiredIds.includes(v)) problems.push(`free variable "${v}" has no prop`);
  for (const t of unwired) if (inputs.includes(t)) problems.push(`"${t}" is read by the geometry`);

  const defined = new Set();
  for (const line of String(mathBody).split("\n")) {
    const m = line.trim().match(/^([A-Za-z_]\w*)\s*=(?!=)/);
    if (m) defined.add(m[1]);
  }
  const slotIds = new Set(N.out.data.params.slots.map((s) => s.id));
  const p2 = new Set(N.r2d.data.params.prims.map((p) => p.id));
  const p3 = new Set(N.r3d.data.params.prims.map((p) => p.id));
  for (const e of flow.edges) {
    if (e.source === N.math.id && !defined.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: math publishes no "${e.sourceHandle.slice(4)}"`);
    if (e.target === N.math.id && !inputs.includes(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: math has no input "${e.targetHandle.slice(6)}"`);
    if (e.target === N.out.id && !slotIds.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no slot ${e.targetHandle.slice(6)}`);
    if (e.source === N.out.id && !slotIds.has(e.sourceHandle.slice(4))) problems.push(`edge ${e.id}: no slot ${e.sourceHandle.slice(4)}`);
    if (e.target === N.r2d.id && !p2.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 2D row ${e.targetHandle.slice(6)}`);
    if (e.target === N.r3d.id && !p3.has(e.targetHandle.slice(6))) problems.push(`edge ${e.id}: no 3D row ${e.targetHandle.slice(6)}`);
  }
  const ids = flow.edges.map((e) => e.id);
  if (new Set(ids).size !== ids.length) problems.push("duplicate edge id");

  // Evaluate at the defaults and check every wired 3D row.
  try {
    const scope = { PI: Math.PI };
    for (const p of props) scope[p.id] = liftScopeValue(p.value);
    scope.P = HOSTS[flow.object?.hostKind] ?? HOSTS.node;
    const r = runExprBody(mathBody, scope);
    const out = r?.scope ?? r;
    const slotLabel = new Map(N.out.data.params.slots.map((s) => [s.id, s.label]));
    const nameOf = new Map();
    for (const e of flow.edges) if (e.source === N.math.id && e.target === N.out.id) nameOf.set(e.targetHandle.slice(6), e.sourceHandle.slice(4));
    for (const row of N.r3d.data.params.prims) {
      const edge = flow.edges.find((e) => e.target === N.r3d.id && e.targetHandle === `valin-${row.id}`);
      if (!edge) continue;
      const nm = nameOf.get(edge.sourceHandle.slice(4));
      const v = out[nm];
      if (v === undefined) { problems.push(`3D row ${row.id}: "${nm}" undefined`); continue; }
      if (!isM(v)) { problems.push(`3D row ${row.id}: "${nm}" not a matrix`); continue; }
      if (row.kind === "tube" || row.kind === "ring") {
        if (v.length && v.some((rr) => rr.length < 6 || !rr.every(Number.isFinite))) problems.push(`3D row ${row.id}: bad ${row.kind} row`);
      } else if (row.kind !== "loft") {
        faceProblems(v).forEach((b) => problems.push(`3D row ${row.id} (${nm}): ${b}`));
      }
    }
    for (const [sid, lbl] of slotLabel) {
      const nm = nameOf.get(sid);
      const v = out[nm];
      if (typeof v === "number" && !Number.isFinite(v)) problems.push(`metric ${lbl} = ${v}`);
    }
  } catch (err) {
    problems.push(`evaluation threw: ${err.message}`);
  }
  return problems;
}

function applyExpr(bodyText, ops, fileName) {
  let lines = bodyText.split("\n");
  for (const op of ops) {
    if (op.append !== undefined) { lines.push(...op.append.split("\n")); continue; }
    const anchor = op.replace ?? op.after ?? op.before;
    const hits = lines.map((l, i) => (l.trim() === anchor.trim() ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) throw new Error(`${fileName}: anchor matched ${hits.length}x -> ${anchor.slice(0, 72)}`);
    const i = hits[0];
    if (op.replace !== undefined) lines.splice(i, 1, ...op.with.split("\n"));
    else if (op.after !== undefined) lines.splice(i + 1, 0, ...op.text.split("\n"));
    else lines.splice(i, 0, ...op.text.split("\n"));
  }
  return lines.join("\n");
}

mkdirSync("out-bedroom", { recursive: true });
let failed = 0;
const report = [];

for (const [name, patch] of Object.entries(PATCHES)) {
  const before = JSON.parse(readFileSync(`live/${name}.json`, "utf8"));
  const preExisting = new Set(inspect(before));

  const flow = JSON.parse(JSON.stringify(before));
  const N = spine(flow);
  const props = N.props.data.params.props;
  const mathNode = N.math;
  const outNode = N.out;
  const r2dNode = N.r2d;
  const r3dNode = N.r3d;
  let err = null;

  try {
    // 1. props, inserted where they belong rather than pushed onto the placement tail
    for (const grp of patch.props ?? []) {
      const at = props.findIndex((p) => p.id === grp.after);
      if (at < 0) throw new Error(`${name}: no prop "${grp.after}" to insert after`);
      props.splice(at + 1, 0, ...grp.add);
      for (const p of grp.add) {
        flow.edges.push({ id: `e_props_math_${p.id}`, source: N.props.id, target: N.math.id, sourceHandle: `val-${p.id}`, targetHandle: `valin-${p.id}` });
      }
    }
    // 2. material — text, unwired, placed next to semantics
    if (!props.some((p) => p.id === "material")) {
      const at = props.findIndex((p) => p.id === "semantics");
      const mp = txt("material", "Material", patch.material);
      if (at >= 0) props.splice(at, 0, mp); else props.push(mp);
    }
    // 3. expression
    if (patch.expr?.length) mathNode.data.params.expr = applyExpr(mathNode.data.params.expr, patch.expr, name);
    // 4. new output slots
    const slots = outNode.data.params.slots;
    let next = slots.reduce((m, s) => Math.max(m, +String(s.id).replace(/^s/, "") || 0), 0);
    const slotFor = new Map();
    for (const o of patch.outputs ?? []) {
      const id = `s${++next}`;
      slots.push({ id, label: o.label });
      slotFor.set(o.from, id);
      flow.edges.push({ id: `e_math_out_${id}`, source: N.math.id, target: N.out.id, sourceHandle: `val-${o.from}`, targetHandle: `valin-${id}` });
    }
    // 5. new render rows
    for (const p of patch.prims3d ?? []) {
      const { from, ...row } = p;
      r3dNode.data.params.prims.push(row);
      flow.edges.push({ id: `e_out_r3d_${row.id}`, source: N.out.id, target: N.r3d.id, sourceHandle: `val-${slotFor.get(from)}`, targetHandle: `valin-${row.id}` });
    }
    for (const p of patch.prims2d ?? []) {
      const { from, ...row } = p;
      r2dNode.data.params.prims.push(row);
      flow.edges.push({ id: `e_out_r2d_${row.id}`, source: N.out.id, target: N.r2d.id, sourceHandle: `val-${slotFor.get(from)}`, targetHandle: `valin-${row.id}` });
    }
  } catch (e) { err = e.message; }

  const after = err ? [err] : inspect(flow);
  const introduced = after.filter((p) => !preExisting.has(p));
  const inherited = [...preExisting].filter((p) => after.includes(p));

  if (introduced.length) {
    failed++;
    console.log(`FAIL ${name}`);
    introduced.slice(0, 12).forEach((p) => console.log("      - " + p));
    if (introduced.length > 12) console.log(`      … ${introduced.length - 12} more`);
  } else {
    const json = JSON.stringify(flow, null, 2) + "\n";
    JSON.parse(json);
    writeFileSync(`out-bedroom/${name}.json`, json, "utf8");
    const nAdded = (patch.props ?? []).reduce((m, g) => m + g.add.length, 0);
    console.log(`ok   ${name.padEnd(14)} +${String(nAdded).padStart(2)} params  +${String((patch.outputs ?? []).length).padStart(2)} outputs  +${(patch.prims3d ?? []).length + (patch.prims2d ?? []).length} render rows  ${(json.length / 1024).toFixed(1)} KB${inherited.length ? `   [${inherited.length} pre-existing issue(s) left alone]` : ""}`);
    report.push({ name, params: nAdded, outputs: (patch.outputs ?? []).length });
  }
}
console.log(`\n${Object.keys(PATCHES).length} patched, ${failed} with problems`);
writeFileSync("out-bedroom/_patched.json", JSON.stringify(report, null, 2));
