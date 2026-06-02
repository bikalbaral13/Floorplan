import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";
import {
  DEFAULT_REGULATIONS,
  OCCUPANCY_LABELS,
  ROAD_LOCATION_LABELS,
  insetPolygon,
  polygonArea,
  runCircularSetbackSolver,
} from "../../algorithms/dcr/circularSetbackSolver";
import { outsetRectangle } from "../../algorithms/layout/optimiseRect";
import {
  type Occupancy,
  type Regulations,
  type RoadLocation,
  type SolverResult,
} from "../../algorithms/dcr/circularSetbackSolver";

/**
 * Shape of the Space fields this block reads/writes. Mirrors the optional
 * Site-Area inputs that previously lived in the Properties panel.
 */
export interface BuaCalculatorRoom {
  id: string;
  points: Point[];
  // Building Regulations (read-only here; edited in Properties).
  maxFsi?: number;
  groundCoveragePct?: number;
  maxHeightM?: number;
  floorToFloorM?: number;
  // Plot & Open Space.
  amenityOsRate?: number;
  losRate?: number;
  // FSI Components.
  basicFsiMultiplier?: number;
  premiumFsiMultiplier?: number;
  tdrMultiplier?: number;
  fungibleRate?: number;
  schemeFsiSqm?: number;
  inSituFsiFactor?: number;
  // Build Program.
  carParksRequired?: number;
  areaPerCarParkSqm?: number;
  otherNonFsiSqm?: number;
  wingsPerFloor?: number;
  chosenPlateM2?: number;
  podiumOffsetM?: number;
}

export interface BuaCalculatorBlockProps {
  selectedRoom: BuaCalculatorRoom;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Persist one or more field updates back onto the room in history state. */
  onUpdateRoom: (updates: Partial<BuaCalculatorRoom>) => void;
  /** Indices of `selectedRoom.points` whose outgoing edge is tagged as Front
   *  via Segment Properties → Edge Role = Front. Drives the setback solver. */
  frontEdgeIndices?: number[];
  /** Paint a preview inset polygon on the canvas using the supplied per-edge
   *  setback distances (metres). Also hands the amenity deduction (m²) over to
   *  the Inset Polygon block so the same Deduct Area overlay updates live.
   *  Implementation should drive the Inset Polygon block's per-room setbacks,
   *  enable Live, and enable Deduct Area with the supplied deduction. */
  onShowOnCanvas?: (
    room: { id: string; points: Point[] },
    perEdgeDistancesM: number[],
    deductionM2: number,
    stack?: {
      /** Uniform inward offset from plot boundary for the basement footprint (m). */
      basementOffsetM: number;
      /** FSI tower floor count (extrude upward). */
      nFsi: number;
      /** Basement floor count (extrude downward). */
      nBasement: number;
      /** Floor-to-floor height (m), used for both stacks in v1. */
      floorHtM: number;
      /** Max-rect tower footprint in METRE coordinates (4 corners). Caller scales
       *  to pixels. Empty array when the solver didn't find a rectangle. */
      towerRectM: Point[];
      /** Raw setback inset polygon (m) — drives the Inset Area Space. */
      insetPolyM: Point[];
      /** Inset minus the amenity-deduction half-plane (m) — drives the
       *  Buildable Area Space. Equals insetPolyM when deduction is zero. */
      buildablePolyM: Point[];
      /** The amenity-deduction piece carved out of the inset (m) — drives the
       *  Deduction Area Space. Empty when the deduction is zero. */
      deductionPolyM: Point[];
      /** Basement polygon (m), max-rect outset by podium offset. Drives the
       *  Basement Area Space. */
      basementPolyM: Point[];
    },
  ) => void;
  /** Remove any inset preview walls previously painted by onShowOnCanvas. */
  onClearPreview?: () => void;
  /** Commit the converged max-rect as a Footprint Area Space tagged to this
   *  source plot. Called automatically at the end of Calculate so the user
   *  doesn't need a separate Show-on-Canvas click to materialise the tower.
   *  `rectPolyM` is in METRES (caller scales to pixels). When `rectPolyM.length`
   *  < 3, the parent should treat it as "no rectangle — clear any existing
   *  derived footprint." */
  onCommitFootprintArea?: (
    sourceRoom: { id: string; points: Point[] },
    rectPolyM: Point[],
    nFsi: number,
  ) => void;
  /** Commit the basement polygon (max-rect outset by podium offset) as a
   *  Basement Area Space tagged to this source plot. Mirrors
   *  onCommitFootprintArea — called automatically at the end of Calculate. */
  onCommitBasementArea?: (
    sourceRoom: { id: string; points: Point[] },
    basementPolyM: Point[],
    nBasement: number,
  ) => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure compute — single function so the UI just renders what comes back.
// Mirrors the calculation that previously ran inline in the Metrics tab.
// ─────────────────────────────────────────────────────────────────────────────

interface ComputedStatement {
  plotAreaM2: number;
  gcrPct: number; gcrCapM2: number;
  maxFsi: number; maxBuaM2: number;
  amenityOsRate: number; losRate: number;
  basicMult: number; premiumMult: number; tdrMult: number;
  schemeFsi: number; fungRate: number; inSituFactor: number;
  amenityOsM2: number; netPlotM2: number; losM2: number;
  zonalM2: number; premiumM2: number; tdrM2: number;
  totalExFungible: number; fungOnZonal: number; fungOnOthers: number;
  totalFungible: number; maxGrossBua: number; maxGrossBuaSqFt: number;
  inSituFsiM2: number;
  carParks: number; areaPerPark: number; otherNonFsi: number;
  parkingM2: number; totalConstM2: number; totalConstSqFt: number;
  maxHt: number; floorHt: number; wings: number;
  floorsMaxHt: number; stairsPerCore: number;
  stairFootprintEach: number; liftLobby: number; corePerWing: number;
  totalCoreM2: number; corePctBua: number;
  // Stack decomposition (simple v1): same plate for FSI and non-FSI; underground
  // floor count = ceil(non-FSI area / plate area).
  plateUsedM2: number;
  nonFsiTotalM2: number;
  nFsiFloors: number;
  nBasementLevels: number;
  podiumOffsetM: number;
  podiumPlateM2: number;
  /** Basement polygon (m), derived from max-rect outset by podium offset.
   *  Empty until a Calculate run produces a max-rect. */
  basementPolyM: Point[];
}

function computeStatement(
  room: BuaCalculatorRoom,
  pixelsPerMeter: number,
  solverPlateM2?: number,
  maxRectCornersM?: Point[],
): ComputedStatement {
  const ppm = pixelsPerMeter;
  const ppm2 = ppm * ppm;
  const pts = room.points;

  // Plot area (shoelace) in m².
  let plotAreaPx = 0;
  for (let pi = 0; pi < pts.length; pi++) {
    const pj = (pi + 1) % pts.length;
    plotAreaPx += pts[pi].x * pts[pj].y - pts[pj].x * pts[pi].y;
  }
  const plotAreaM2 = Math.abs(plotAreaPx) / 2 / ppm2;

  const gcrPct = room.groundCoveragePct ?? 40;
  const maxFsi = room.maxFsi ?? 2.5;
  const gcrCapM2 = plotAreaM2 * (gcrPct / 100);
  const maxBuaM2 = plotAreaM2 * maxFsi;

  // FSI Statement
  const amenityOsRate = room.amenityOsRate ?? 0.1;
  const losRate       = room.losRate ?? 0.15;
  const basicMult     = room.basicFsiMultiplier ?? 1.0;
  const premiumMult   = room.premiumFsiMultiplier ?? 0.5;
  const tdrMult       = room.tdrMultiplier ?? 0.9;
  const schemeFsi     = room.schemeFsiSqm ?? 11721.6;
  const fungRate      = room.fungibleRate ?? 0.35;
  const inSituFactor  = room.inSituFsiFactor ?? 2;

  const amenityOsM2     = plotAreaM2 * amenityOsRate;
  const netPlotM2       = plotAreaM2 - amenityOsM2;
  const losM2           = netPlotM2 * losRate;
  const zonalM2         = netPlotM2 * basicMult;
  const premiumM2       = netPlotM2 * premiumMult;
  const tdrM2           = netPlotM2 * tdrMult;
  const totalExFungible = zonalM2 + premiumM2 + tdrM2 + schemeFsi;
  const fungOnZonal     = zonalM2 * fungRate;
  const fungOnOthers    = (premiumM2 + tdrM2 + schemeFsi) * fungRate;
  const totalFungible   = fungOnZonal + fungOnOthers;
  const maxGrossBua     = totalExFungible + totalFungible;
  const maxGrossBuaSqFt = maxGrossBua * 10.7639;
  const inSituFsiM2     = amenityOsM2 * inSituFactor;

  // Construction Area
  const carParks    = room.carParksRequired ?? 417;
  const areaPerPark = room.areaPerCarParkSqm ?? 30;
  const otherNonFsi = room.otherNonFsiSqm ?? 6000;
  const parkingM2   = carParks * areaPerPark;
  const totalConstM2 = maxGrossBua + parkingM2 + otherNonFsi;
  const totalConstSqFt = totalConstM2 * 10.7639;

  // Core Estimate (height-based)
  const maxHt    = room.maxHeightM ?? 76;
  const floorHt  = room.floorToFloorM ?? 3.2;
  const wings    = room.wingsPerFloor ?? 5;
  const floorsMaxHt = Math.floor(maxHt / floorHt);
  const stairsPerCore = maxHt > 70 ? 2 : maxHt > 32 ? 2 : 1;
  const stairFootprintEach = 13.2;
  const liftLobby = 25.6;
  const corePerWing = stairsPerCore * stairFootprintEach + liftLobby;
  const totalCoreM2 = corePerWing * wings * floorsMaxHt;
  const corePctBua = maxGrossBua > 0 ? totalCoreM2 / maxGrossBua : 0;

  // Stack decomposition (v2): tower plate from the setback solver; basement
  // footprint is the plot polygon inset uniformly by the podium offset (a
  // minimum permissible setback, default 3.5 m). The basement plate is always
  // larger than the tower plate because tower setbacks > podium offset.
  const plateUsedM2 = (solverPlateM2 && solverPlateM2 > 0) ? solverPlateM2 : (room.chosenPlateM2 ?? 0);
  const nonFsiTotalM2 = parkingM2 + otherNonFsi;
  const nFsiFloors = plateUsedM2 > 0 ? Math.ceil(maxGrossBua / plateUsedM2) : 0;
  const podiumOffsetM = room.podiumOffsetM ?? 3.5;
  const plotPolygonM: Point[] = pts.map((q) => ({ x: q.x / ppm, y: q.y / ppm }));
  // Basement polygon = max-rect tower OUTSET by the podium offset on all sides
  // (preferred — keeps the same rotation as the tower, so basement is a clean
  // rectangle slightly larger than the tower). Falls back to plot inset by
  // podium offset when max-rect isn't available yet (first Calculate pass).
  let podiumPoly: Point[] | null = null;
  if (maxRectCornersM && maxRectCornersM.length === 4) {
    podiumPoly = outsetRectangle(maxRectCornersM, podiumOffsetM);
  } else if (plotPolygonM.length >= 3) {
    podiumPoly = insetPolygon(plotPolygonM, plotPolygonM.map(() => podiumOffsetM));
  }
  const podiumPlateM2 = podiumPoly && podiumPoly.length >= 3 ? polygonArea(podiumPoly) : 0;
  const nBasementLevels = podiumPlateM2 > 0 ? Math.ceil(nonFsiTotalM2 / podiumPlateM2) : 0;

  return {
    plotAreaM2, gcrPct, gcrCapM2, maxFsi, maxBuaM2,
    amenityOsRate, losRate, basicMult, premiumMult, tdrMult,
    schemeFsi, fungRate, inSituFactor,
    amenityOsM2, netPlotM2, losM2, zonalM2, premiumM2, tdrM2,
    totalExFungible, fungOnZonal, fungOnOthers, totalFungible,
    maxGrossBua, maxGrossBuaSqFt, inSituFsiM2,
    carParks, areaPerPark, otherNonFsi, parkingM2, totalConstM2, totalConstSqFt,
    maxHt, floorHt, wings, floorsMaxHt, stairsPerCore,
    stairFootprintEach, liftLobby, corePerWing, totalCoreM2, corePctBua,
    plateUsedM2, nonFsiTotalM2, nFsiFloors, nBasementLevels,
    podiumOffsetM, podiumPlateM2,
    basementPolyM: podiumPoly ?? [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Small input cell — uncontrolled to match the existing Properties pattern
// (commits on blur or Enter, so users can type freely without re-renders
// fighting them mid-keystroke). `field` keys are forwarded as the update key.
// ─────────────────────────────────────────────────────────────────────────────

interface NumCellProps {
  label: string;
  title?: string;
  value: number;
  field: keyof BuaCalculatorRoom;
  onCommit: (field: keyof BuaCalculatorRoom, value: number) => void;
  min?: number; max?: number; step?: number;
  roomId: string;
}
const NumCell = (p: NumCellProps) => (
  <div title={p.title}>
    <span className="text-[10px] text-slate-400">{p.label}</span>
    <input
      key={`${String(p.field)}-${p.roomId}`}
      type="number"
      min={p.min} max={p.max} step={p.step ?? 0.1}
      defaultValue={p.value}
      className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1.5 text-xs font-mono"
      onBlur={(e) => {
        const v = +e.target.value;
        if (!isFinite(v)) return;
        if (p.min != null && v < p.min) return;
        if (p.max != null && v > p.max) return;
        p.onCommit(p.field, v);
      }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  </div>
);

// ─────────────────────────────────────────────────────────────────────────────
// Block
// ─────────────────────────────────────────────────────────────────────────────

export const BuaCalculatorBlock = (p: BuaCalculatorBlockProps) => {
  const [calc, setCalc] = useState<ComputedStatement | null>(null);
  // Setback Solver inputs (merged in from the standalone Circular Setback Solver block).
  // The solver no longer needs a Total BUA input — it'll consume `maxGrossBua` directly
  // off the BUA calc result. The amenity deduction is computed from `amenityOsRate × plotArea`.
  const [occupancy, setOccupancy] = useState<Occupancy>("residential");
  const [roadLocation, setRoadLocation] = useState<RoadLocation>("areas-in-city");
  const [regsText, setRegsText] = useState<string>(() => JSON.stringify(DEFAULT_REGULATIONS, null, 2));
  const [regsExpanded, setRegsExpanded] = useState<boolean>(false);
  const [regsParseError, setRegsParseError] = useState<string | null>(null);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  // Live preview of the resolved front setback / height cap from the current dropdowns.
  const liveRegs = useMemo(() => {
    try { return JSON.parse(regsText) as typeof DEFAULT_REGULATIONS; } catch { return null; }
  }, [regsText]);
  const occRulesPreview = liveRegs?.occupancies?.[occupancy];
  const previewFront = occRulesPreview?.frontSetbacks.find((r) => r.location === roadLocation)?.setbackM
    ?? occRulesPreview?.frontSetbacks[0]?.setbackM ?? null;
  const previewHeightCap = occRulesPreview?.permissibleHeightM ?? null;

  const onCommit = (field: keyof BuaCalculatorRoom, value: number) => {
    p.onUpdateRoom({ [field]: value } as Partial<BuaCalculatorRoom>);
  };

  // Snapshot the current room props each render so the inputs reflect what's
  // actually stored, not a stale computed copy.
  const room = p.selectedRoom;
  const plotAreaPreview = useMemo(() => {
    const ppm2 = p.pixelsPerMeter * p.pixelsPerMeter;
    const pts = room.points;
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
    }
    return Math.abs(a) / 2 / ppm2;
  }, [room.points, p.pixelsPerMeter]);

  const onCalculate = () => {
    // 1. Existing BUA calc — solver plate is unknown on first pass, so pass
    // undefined; the recompute below (after solver runs) refreshes the calc
    // with the converged plate so n_fsi reflects it.
    const next = computeStatement(room, p.pixelsPerMeter);
    setCalc(next);

    // 2. Setback solver — Total BUA = max gross BUA from the calc above;
    //    Deduction = amenity OS area (rate × plot area) already computed.
    let regs: Regulations;
    try {
      regs = JSON.parse(regsText) as Regulations;
      setRegsParseError(null);
    } catch (e) {
      setRegsParseError(e instanceof Error ? e.message : String(e));
      setSolverResult(null);
      return;
    }
    const polygonM: Point[] = (room.points ?? []).map((q) => ({
      x: q.x / p.pixelsPerMeter,
      y: q.y / p.pixelsPerMeter,
    }));
    if (polygonM.length < 3) { setSolverResult(null); return; }
    const frontSet = new Set<number>(p.frontEdgeIndices ?? []);
    const polygonAreaM2 = polygonArea(polygonM);
    const startPlate = Math.max(1, polygonAreaM2 - next.amenityOsM2);
    const res = runCircularSetbackSolver({
      plotPolygonM: polygonM,
      frontEdgeIndices: frontSet,
      amenityDeductionM2: next.amenityOsM2,
      // Default deduction half-plane angle = 99° (~vertical cut, leaning slightly
      // east-of-north) — matches typical amenity-OS placement on the long side of
      // an Indian residential plot, so the max-rect search excludes a strip on
      // that side instead of cutting from the top.
      amenityDeductionAngleDeg: 99,
      // Bounding-box dimensions are informational on the solver row; the real
      // buildable area comes from the inset of the actual polygon.
      plotWidthM: 0,
      plotDepthM: 0,
      totalBuaM2: next.maxGrossBua,
      regs,
      occupancy,
      roadLocation,
      startPlateGuessM2: startPlate,
    });
    setSolverResult(res);

    // Recompute with the solver's converged plate so n_fsi uses it as the
    // default tower plate (unless the user overrode towerPlateM2 explicitly).
    const finalRow = res.rows.find((r) => r.note === "CONVERGED") ?? res.rows[res.rows.length - 1];
    const solvedPlate = finalRow && finalRow.floors > 0 ? res.totalBuaM2 / finalRow.floors : undefined;
    const rectCorners = finalRow ? finalRow.maxRectCornersM : undefined;
    let finalCalc = next;
    if (solvedPlate && solvedPlate > 0) {
      finalCalc = computeStatement(room, p.pixelsPerMeter, solvedPlate, rectCorners);
      setCalc(finalCalc);
    } else if (rectCorners && rectCorners.length >= 3) {
      // No solver convergence but we still have a max-rect — recompute so the
      // basement polygon (outset of the rect) is available for "Show on canvas".
      finalCalc = computeStatement(room, p.pixelsPerMeter, undefined, rectCorners);
      setCalc(finalCalc);
    }

    // Calculate is compute-only: it updates the panel numbers but draws nothing
    // on the canvas. The Footprint / Basement / Inset / Buildable / Deduction
    // Spaces are materialised solely by the "Show on canvas" button below.
  };

  // Shared row-style helpers (preserved from the original render).
  const rowBase = "grid gap-x-1 py-[1px] text-[9px]";
  const cols3   = "grid-cols-[1fr_52px_72px]";
  const cols2   = "grid-cols-[1fr_80px]";
  const bold    = "font-semibold";
  const right   = "text-right tabular-nums";
  const f = (n: number) => n.toFixed(2);

  return (
    <div className="rounded border border-teal-300 bg-teal-50 p-2 space-y-2">
      <button
        type="button"
        className="flex w-full items-center justify-between text-left"
        onClick={() => p.setExpanded((v) => !v)}
      >
        <span className="text-[9px] font-semibold uppercase tracking-wide text-teal-700">BUA Calculator</span>
        <span className="text-[11px] text-teal-500">{p.expanded ? "▼" : "▶"}</span>
      </button>
      {p.expanded && (
        <>
          <p className="text-[9px] italic text-teal-600 leading-tight">
            FSI components → fungible → BUA → parking → core. Click Calculate to refresh.
          </p>

          {/* ── Plot & Open Space ───────────────────────────────────────── */}
          <div className="rounded border border-slate-200 bg-white p-1.5">
            <p className="mb-1 border-b border-slate-200 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Plot &amp; Open Space</p>
            <div className="grid grid-cols-2 gap-1.5">
              <NumCell roomId={room.id} label="Amenity OS Rate" title="Fraction of gross plot surrendered as amenity open space (e.g. 0.10 = 10%)"
                field="amenityOsRate" value={room.amenityOsRate ?? 0.1} min={0} max={1} step={0.01} onCommit={onCommit} />
              <NumCell roomId={room.id} label="LOS Rate" title="Layout open space rate on net plot area (e.g. 0.15 = 15%)"
                field="losRate" value={room.losRate ?? 0.15} min={0} max={1} step={0.01} onCommit={onCommit} />
            </div>
          </div>

          {/* ── FSI Components ──────────────────────────────────────────── */}
          <div className="rounded border border-slate-200 bg-white p-1.5">
            <p className="mb-1 border-b border-slate-200 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">FSI Components</p>
            <div className="grid grid-cols-2 gap-1.5">
              <NumCell roomId={room.id} label="Basic FSI" title="Zonal / basic FSI multiplier on net plot (e.g. 1.0)"
                field="basicFsiMultiplier" value={room.basicFsiMultiplier ?? 1.0} min={0} step={0.1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Premium FSI" title="Premium FSI multiplier on net plot — on payment (e.g. 0.5)"
                field="premiumFsiMultiplier" value={room.premiumFsiMultiplier ?? 0.5} min={0} step={0.1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="TDR FSI" title="TDR multiplier — max permissible (e.g. 0.9)"
                field="tdrMultiplier" value={room.tdrMultiplier ?? 0.9} min={0} step={0.1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Fungible Rate" title="Fungible FSI rate applied on all FSI components (e.g. 0.35 = 35%)"
                field="fungibleRate" value={room.fungibleRate ?? 0.35} min={0} max={1} step={0.05} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Scheme FSI (m²)" title="Scheme-specific balance FSI as an absolute area (sq.m) — not a multiplier"
                field="schemeFsiSqm" value={room.schemeFsiSqm ?? 11721.6} min={0} step={10} onCommit={onCommit} />
              <NumCell roomId={room.id} label="In-Situ FSI (×)" title="In-situ FSI credit factor per sq.m of surrendered amenity OS (e.g. 2 = 2×)"
                field="inSituFsiFactor" value={room.inSituFsiFactor ?? 2} min={0} step={0.5} onCommit={onCommit} />
            </div>
          </div>

          {/* ── Build Program ──────────────────────────────────────────── */}
          <div className="rounded border border-slate-200 bg-white p-1.5">
            <p className="mb-1 border-b border-slate-200 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">Build Program</p>
            <div className="grid grid-cols-2 gap-1.5">
              <NumCell roomId={room.id} label="Car Parks (nos)" title="Total car parks required (nos)"
                field="carParksRequired" value={room.carParksRequired ?? 417} min={0} step={1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Area/Car Park (m²)" title="Area per car park stall in sq.m (e.g. 30 for ramp parking)"
                field="areaPerCarParkSqm" value={room.areaPerCarParkSqm ?? 30} min={0} step={1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Other Non-FSI (m²)" title="Other non-FSI area in sq.m — terraces, utilities, refuge floors"
                field="otherNonFsiSqm" value={room.otherNonFsiSqm ?? 6000} min={0} step={100} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Wings / Cores" title="Number of wings / cores per floor"
                field="wingsPerFloor" value={room.wingsPerFloor ?? 5} min={1} step={1} onCommit={onCommit} />
              <NumCell roomId={room.id} label="Podium Offset (m)" title="Uniform inward offset from plot boundary for the podium / basement footprint (default 3.5 m — the minimum setback at grade)."
                field="podiumOffsetM" value={room.podiumOffsetM ?? 3.5} min={0} step={0.5} onCommit={onCommit} />
            </div>
          </div>

          {/* ── Setback Regulations ────────────────────────────────────── */}
          <div className="rounded border border-slate-200 bg-white p-1.5">
            <p className="mb-1 border-b border-slate-200 pb-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
              Setback Regulations
            </p>
            <div className="grid grid-cols-1 gap-1.5">
              <div>
                <span className="text-[9px] text-slate-500">Building type</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
                  value={occupancy}
                  onChange={(e) => setOccupancy(e.target.value as Occupancy)}
                >
                  {(Object.keys(OCCUPANCY_LABELS) as Occupancy[]).map((k) => (
                    <option key={k} value={k}>{OCCUPANCY_LABELS[k]}</option>
                  ))}
                </select>
                {previewHeightCap != null && (
                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Permissible height: <span className="font-mono text-slate-600">{previewHeightCap} m</span>
                  </p>
                )}
              </div>
              <div>
                <span className="text-[9px] text-slate-500">Road location (front setback)</span>
                <select
                  className="mt-0.5 h-6 w-full rounded-md border border-slate-200 bg-white px-1 text-[11px]"
                  value={roadLocation}
                  onChange={(e) => setRoadLocation(e.target.value as RoadLocation)}
                >
                  {(Object.keys(ROAD_LOCATION_LABELS) as RoadLocation[]).map((k) => (
                    <option key={k} value={k}>{ROAD_LOCATION_LABELS[k]}</option>
                  ))}
                </select>
                {previewFront != null && (
                  <p className="mt-0.5 text-[9px] text-slate-400">
                    Front setback: <span className="font-mono text-slate-600">{previewFront} m</span>
                  </p>
                )}
              </div>
              <div>
                <button
                  type="button"
                  className="flex w-full items-center justify-between text-left text-[9px] font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-700"
                  onClick={() => setRegsExpanded((v) => !v)}
                >
                  <span>Regulations (JSON)</span>
                  <span className="text-[10px] text-slate-400">{regsExpanded ? "▼" : "▶"}</span>
                </button>
                {regsExpanded && (
                  <>
                    <textarea
                      className="mt-0.5 w-full rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[10px] font-mono text-slate-700"
                      rows={12}
                      value={regsText}
                      onChange={(e) => {
                        setRegsText(e.target.value);
                        try { JSON.parse(e.target.value); setRegsParseError(null); }
                        catch (err) { setRegsParseError(err instanceof Error ? err.message : String(err)); }
                      }}
                      spellCheck={false}
                    />
                    {regsParseError && (
                      <p className="mt-1 text-[9px] text-red-600">JSON parse error: {regsParseError}</p>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[9px] text-slate-500">
            <span>Plot area: <span className="font-mono text-slate-700">{plotAreaPreview.toFixed(2)} m²</span></span>
            <span>Uses Max FSI / GCR / Max Ht / Floor Ht from Properties.</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full text-[11px] border-teal-400 bg-teal-100 hover:bg-teal-200"
            onClick={onCalculate}
            disabled={!(room.points?.length >= 3)}
          >
            Calculate
          </Button>

          {/* ── Calculation output ─────────────────────────────────────── */}
          {calc && (
            <div className="rounded border border-slate-200 bg-white p-2 space-y-3">

              {/* Site Areas summary */}
              <div>
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Site Areas</span>
                <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10px]">
                  <div><span className="text-[9px] text-slate-400">Plot Area</span><p className="text-slate-700">{f(calc.plotAreaM2)} m²</p></div>
                  <div><span className="text-[9px] text-slate-400">GCR Cap ({calc.gcrPct}%)</span><p className="text-purple-700">{f(calc.gcrCapM2)} m²</p></div>
                  <div><span className="text-[9px] text-slate-400">Max BUA (FSI)</span><p className="text-blue-700">{f(calc.maxBuaM2)} m²</p></div>
                </div>
              </div>

              {/* FSI Statement */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">FSI Statement</span>
                <div className="mt-1.5 font-mono">
                  <div className={`${rowBase} ${cols3} border-b border-slate-300 pb-0.5 mb-0.5 font-semibold text-slate-500`}>
                    <span>Particulars</span><span className={right}>Mult.</span><span className={right}>Area (m²)</span>
                  </div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>Gross plot area</span><span/><span className={right}>{f(calc.plotAreaM2)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>Less: amenity OS (surrendered)</span><span/><span className={`${right} text-red-600`}>({f(calc.amenityOsM2)})</span></div>
                  <div className={`${rowBase} ${cols3} ${bold} border-t border-slate-200 text-slate-700`}><span>Net plot area (FSI base)</span><span/><span className={right}>{f(calc.netPlotM2)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-500`}><span>Layout open space (LOS)</span><span/><span className={right}>{f(calc.losM2)}</span></div>

                  <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-slate-600">FSI components (× net plot)</div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>Zonal (basic) FSI</span><span className={right}>{calc.basicMult.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.zonalM2)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>Premium FSI (on payment)</span><span className={right}>{calc.premiumMult.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.premiumM2)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>TDR (max permissible)</span><span className={right}>{calc.tdrMult.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.tdrM2)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>Scheme-specific balance FSI</span><span/><span className={`${right} text-green-700`}>{f(calc.schemeFsi)}</span></div>
                  <div className={`${rowBase} ${cols3} ${bold} border-t border-slate-200 text-slate-700`}><span>Total BUA (excl. fungible)</span><span/><span className={right}>{f(calc.totalExFungible)}</span></div>

                  <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-slate-600">Fungible FSI (+{(calc.fungRate * 100).toFixed(0)}%)</div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>On zonal (basic) FSI</span><span className={right}>{calc.fungRate.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.fungOnZonal)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>On incentive &amp; other FSIs</span><span className={right}>{calc.fungRate.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.fungOnOthers)}</span></div>
                  <div className={`${rowBase} ${cols3} ${bold} border-t border-slate-200 text-slate-700`}><span>Total fungible</span><span/><span className={right}>{f(calc.totalFungible)}</span></div>
                  <div className={`${rowBase} ${cols3} ${bold} rounded bg-blue-50 px-1 text-blue-800`}><span>Max permissible gross BUA</span><span/><span className={right}>{f(calc.maxGrossBua)}</span></div>
                  <div className={`${rowBase} ${cols3} text-slate-500`}><span className="pl-2">in sq.ft.</span><span/><span className={right}>{Math.round(calc.maxGrossBuaSqFt).toLocaleString()}</span></div>

                  <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-slate-600">In-situ / Side Reservations</div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}><span>FSI against amenity OS</span><span className={right}>{calc.inSituFactor.toFixed(2)}</span><span className={`${right} text-green-700`}>{f(calc.inSituFsiM2)}</span></div>
                </div>
              </div>

              {/* Construction Area */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Construction Area</span>
                <div className="mt-1.5 font-mono">
                  <div className={`${rowBase} ${cols2} border-b border-slate-300 pb-0.5 mb-0.5 font-semibold text-slate-500`}><span>Component</span><span className={right}>Area (m²)</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>FSI BUA (incl. fungible)</span><span className={`${right} text-blue-700`}>{f(calc.maxGrossBua)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Parking ({calc.carParks} × {calc.areaPerPark} m²)</span><span className={right}>{f(calc.parkingM2)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Other non-FSI</span><span className={right}>{f(calc.otherNonFsi)}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} rounded bg-blue-50 px-1 text-blue-800`}><span>Total construction area</span><span className={right}>{f(calc.totalConstM2)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-500`}><span className="pl-2">in sq.ft.</span><span className={right}>{Math.round(calc.totalConstSqFt).toLocaleString()}</span></div>
                </div>
              </div>

              {/* Stack Decomposition (v2) — tower plate from solver, basement plate from podium offset */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Stack Decomposition</span>
                <p className="text-[8px] italic text-slate-400">
                  tower plate = solver inset · basement plate = plot inset by podium offset ({calc.podiumOffsetM} m) · n_basement = non-FSI / basement plate
                </p>
                <div className="mt-1.5 font-mono">
                  <div className={`${rowBase} ${cols3} border-b border-slate-300 pb-0.5 mb-0.5 font-semibold text-slate-500`}>
                    <span>Stack</span><span className={right}>Plate (m²)</span><span className={right}>Floors</span>
                  </div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}>
                    <span>FSI Tower (above grade)</span>
                    <span className={right}>{calc.plateUsedM2 > 0 ? f(calc.plateUsedM2) : "—"}</span>
                    <span className={`${right} font-semibold text-blue-700`}>{calc.nFsiFloors || "—"}</span>
                  </div>
                  <div className={`${rowBase} ${cols3} text-slate-600`}>
                    <span>Basement (plot − {calc.podiumOffsetM} m offset)</span>
                    <span className={right}>{calc.podiumPlateM2 > 0 ? f(calc.podiumPlateM2) : "—"}</span>
                    <span className={`${right} font-semibold text-emerald-700`}>{calc.nBasementLevels || "—"}</span>
                  </div>
                  <div className={`${rowBase} ${cols2} ${bold} border-t border-slate-200 mt-1 pt-1 text-slate-700`}>
                    <span>Non-FSI total (parking + other)</span>
                    <span className={right}>{f(calc.nonFsiTotalM2)} m²</span>
                  </div>
                  <div className={`${rowBase} ${cols2} text-slate-500`}>
                    <span className="pl-2">basement plate gain vs. tower</span>
                    <span className={right}>
                      {calc.plateUsedM2 > 0 && calc.podiumPlateM2 > 0
                        ? `+${f(calc.podiumPlateM2 - calc.plateUsedM2)} m² (×${(calc.podiumPlateM2 / calc.plateUsedM2).toFixed(2)})`
                        : "—"}
                    </span>
                  </div>
                  {calc.plateUsedM2 <= 0 && (
                    <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[9px] text-amber-700">
                      ⚠ No tower plate yet — run the Setback Solver (Calculate) to get a converged plate.
                    </div>
                  )}
                  {calc.podiumPlateM2 <= 0 && (
                    <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[9px] text-amber-700">
                      ⚠ Podium offset ({calc.podiumOffsetM} m) leaves no basement footprint — reduce the offset.
                    </div>
                  )}
                </div>
              </div>

              {/* Core Estimate */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Core Estimate</span>
                <p className="text-[8px] italic text-slate-400">staircase + lift lobby · height-based ({calc.floorsMaxHt} floors)</p>
                <div className="mt-1.5 font-mono">
                  <div className={`${rowBase} ${cols2} border-b border-slate-300 pb-0.5 mb-0.5 font-semibold text-slate-500`}><span>Parameter</span><span className={right}>Value</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Floors within ht ({calc.maxHt} m ÷ {calc.floorHt} m)</span><span className={right}>{calc.floorsMaxHt}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Stairs per core</span><span className={right}>{calc.stairsPerCore}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Stair footprint each (m²)</span><span className={right}>{f(calc.stairFootprintEach)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Lift + lobby per core (m²)</span><span className={right}>{f(calc.liftLobby)}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} border-t border-slate-200 text-slate-700`}><span>Core area per wing (m²)</span><span className={right}>{f(calc.corePerWing)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Wings per floor</span><span className={right}>{calc.wings}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} rounded bg-amber-50 px-1 text-amber-800`}><span>Total core — all floors (m²)</span><span className={right}>{f(calc.totalCoreM2)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-500`}><span className="pl-2">Core as % of FSI BUA</span><span className={right}>{(calc.corePctBua * 100).toFixed(1)}%</span></div>
                </div>
              </div>

              {/* Setback Solver — fed by maxGrossBua (target BUA) and amenityOsM2 (deduction). */}
              {solverResult && (
                <div className="border-t border-slate-100 pt-2">
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Setback Solver</span>
                  <p className="text-[8px] italic text-slate-400">
                    target BUA = max gross BUA ({f(solverResult.totalBuaM2)} m²) · deduction = amenity OS ({f(calc.amenityOsM2)} m²)
                  </p>
                  <div className={`mt-1 rounded border px-2 py-1 text-[10px] ${
                    solverResult.status === "converged" ? "border-emerald-300 bg-emerald-50 text-emerald-700" :
                    solverResult.status === "invalid-input" ? "border-slate-300 bg-slate-50 text-slate-700" :
                    "border-red-300 bg-red-50 text-red-700"
                  }`}>
                    <div className="font-semibold uppercase tracking-wide">{solverResult.status.replace(/-/g, " ")}</div>
                    <div>{solverResult.message}</div>
                    <div className="mt-0.5 text-[9px] opacity-80">
                      front: {solverResult.frontSetbackUsedM.toFixed(2)} m · cap: {solverResult.heightCapUsedM} m
                    </div>
                  </div>
                  {solverResult.rows.length > 0 && p.onShowOnCanvas && (
                    <div className="mt-1.5 flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 text-[11px] border-indigo-400 bg-white hover:bg-indigo-50"
                        title="Paint the final-iteration setback as an Inset Polygon preview (no commit)"
                        onClick={() => {
                          if (!p.onShowOnCanvas) return;
                          // Prefer the converged row's setbacks + max-rect; fall back to last row.
                          const finalRow =
                            solverResult.rows.find((r) => r.note === "CONVERGED") ??
                            solverResult.rows[solverResult.rows.length - 1];
                          const side = Number.isFinite(finalRow.sideSetbackM) ? finalRow.sideSetbackM : 0;
                          const front = solverResult.frontSetbackUsedM;
                          const frontSet = new Set<number>(p.frontEdgeIndices ?? []);
                          const distances = room.points.map((_, i) => (frontSet.has(i) ? front : side));
                          // Hand the amenity OS area to Inset Polygon as the deduction so the
                          // red half-plane overlay matches what the solver subtracted.
                          const deductionM2 = calc?.amenityOsM2 ?? 0;
                          p.onClearPreview?.();
                          p.onShowOnCanvas(
                            { id: room.id, points: room.points },
                            distances,
                            deductionM2,
                            calc
                              ? {
                                  basementOffsetM: calc.podiumOffsetM,
                                  nFsi: calc.nFsiFloors,
                                  nBasement: calc.nBasementLevels,
                                  floorHtM: calc.floorHt,
                                  towerRectM: finalRow.maxRectCornersM ?? [],
                                  insetPolyM: finalRow.insetPolyM ?? [],
                                  buildablePolyM: finalRow.buildablePolyM ?? [],
                                  deductionPolyM: finalRow.deductionPolyM ?? [],
                                  basementPolyM: calc.basementPolyM ?? [],
                                }
                              : undefined,
                          );
                        }}
                      >
                        Show on Canvas
                      </Button>
                      {p.onClearPreview && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-[11px] border-slate-300 bg-white hover:bg-slate-50"
                          onClick={() => p.onClearPreview?.()}
                        >
                          Clear
                        </Button>
                      )}
                    </div>
                  )}
                  {solverResult.rows.length > 0 && (
                    <div className="mt-1.5 overflow-x-auto rounded border border-slate-200 bg-white">
                      <table className="w-full text-[9px] tabular-nums">
                        <thead className="bg-slate-100 text-slate-600">
                          <tr>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">Plate</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">Floors</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">Height</th>
                            <th colSpan={2} className="px-1 py-0.5 text-center border-b border-slate-200">Setbacks</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">Inset Area</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom" title="Largest free-angle rectangle inscribed in the inset polygon — the actual tower footprint">Max Rect</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">W × D (m)</th>
                            <th rowSpan={2} className="px-1 py-0.5 text-right align-bottom">Plate After Deduction</th>
                          </tr>
                          <tr>
                            <th className="px-1 py-0.5 text-right font-normal">Front</th>
                            <th className="px-1 py-0.5 text-right font-normal">Remaining</th>
                          </tr>
                        </thead>
                        <tbody>
                          {solverResult.rows.map((r) => (
                            <tr key={r.iter} className="border-t border-slate-100">
                              <td className="px-1 py-0.5 text-right font-mono">{r.plateInM2.toFixed(1)}</td>
                              <td className="px-1 py-0.5 text-right font-mono">{r.floors}</td>
                              <td className="px-1 py-0.5 text-right font-mono">{r.heightM.toFixed(1)}</td>
                              <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.frontSetbackM) ? r.frontSetbackM.toFixed(2) : "—"}</td>
                              <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.sideSetbackM) ? r.sideSetbackM.toFixed(2) : "—"}</td>
                              <td className="px-1 py-0.5 text-right font-mono">{Number.isFinite(r.insetAreaM2) ? r.insetAreaM2.toFixed(1) : "—"}</td>
                              <td className="px-1 py-0.5 text-right font-mono text-indigo-700">{Number.isFinite(r.maxRectAreaM2) && r.maxRectAreaM2 > 0 ? r.maxRectAreaM2.toFixed(1) : "—"}</td>
                              <td className="px-1 py-0.5 text-right font-mono text-slate-500">
                                {Number.isFinite(r.maxRectWidthM) && r.maxRectWidthM > 0
                                  ? `${r.maxRectWidthM.toFixed(1)} × ${r.maxRectDepthM.toFixed(1)}`
                                  : "—"}
                              </td>
                              <td className={`px-1 py-0.5 text-right font-mono ${r.note === "CONVERGED" ? "font-semibold text-emerald-700" : ""}`}>
                                {Number.isFinite(r.buildableM2) ? r.buildableM2.toFixed(1) : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {solverResult.rows.length > 0 && (() => {
                    // Final plate area = Total BUA / Floors using the row that actually settled.
                    // Prefer the converged row; fall back to the last row otherwise.
                    const finalRow =
                      solverResult.rows.find((r) => r.note === "CONVERGED") ??
                      solverResult.rows[solverResult.rows.length - 1];
                    const floors = finalRow.floors;
                    const exactPlateM2 = floors > 0 ? solverResult.totalBuaM2 / floors : 0;
                    const finalBuildable = Number.isFinite(finalRow.buildableM2) ? finalRow.buildableM2 : NaN;
                    const tight = Number.isFinite(finalBuildable) && exactPlateM2 > finalBuildable + 0.5;
                    return (
                      <div className={`mt-1.5 rounded border px-2 py-1 text-[10px] ${
                        tight ? "border-red-300 bg-red-50 text-red-700" : "border-emerald-300 bg-emerald-50 text-emerald-800"
                      }`}>
                        <div className="font-semibold">
                          Final plate area = Total BUA / Floors = {f(solverResult.totalBuaM2)} ÷ {floors} ={" "}
                          <span className="font-mono">{f(exactPlateM2)} m²</span>
                        </div>
                        {Number.isFinite(finalRow.maxRectAreaM2) && finalRow.maxRectAreaM2 > 0 && (
                          <div className="text-[9px] opacity-80">
                            tower rectangle: <span className="font-mono">{f(finalRow.maxRectAreaM2)} m²</span>
                            {" "}({finalRow.maxRectWidthM.toFixed(1)} × {finalRow.maxRectDepthM.toFixed(1)} m, {finalRow.maxRectAngleDeg.toFixed(0)}° from horizontal)
                          </div>
                        )}
                        {Number.isFinite(finalBuildable) && (
                          <div className="text-[9px] opacity-80">
                            {tight
                              ? `⚠ exceeds plate after deduction (${f(finalBuildable)} m²) — at the limit`
                              : `fits within plate after deduction (${f(finalBuildable)} m²)`}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* ── Final Summary ──────────────────────────────────────────
                  Superstructure (FSI tower) + Substructure (basement) totals,
                  built from the stack decomposition, then compared against the
                  required total construction area. Floors are ceil'd so the
                  built area is ≥ the requirement; the delta shows the slack. */}
              {(() => {
                const superFloors = calc.nFsiFloors;
                const superPlateM2 = calc.plateUsedM2;
                const superTotalM2 = superFloors * superPlateM2;
                const subFloors = calc.nBasementLevels;
                const subPlateM2 = calc.podiumPlateM2;
                const subTotalM2 = subFloors * subPlateM2;
                const finalAreaM2 = superTotalM2 + subTotalM2;
                const reqM2 = calc.totalConstM2;
                const deltaM2 = finalAreaM2 - reqM2;
                const coveragePct = reqM2 > 0 ? (finalAreaM2 / reqM2) * 100 : 0;
                const meets = finalAreaM2 + 0.5 >= reqM2;
                return (
                  <div className="border-t border-slate-200 pt-2">
                    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Final Summary</span>
                    <p className="text-[8px] italic text-slate-400">
                      total area = floors × plate · final = superstructure + substructure
                    </p>
                    <div className="mt-1.5 font-mono">
                      {/* Superstructure */}
                      <div className="mb-0.5 text-[9px] font-semibold text-blue-700">Superstructure (above grade)</div>
                      <div className={`${rowBase} ${cols2} text-slate-600`}><span>Number of floors</span><span className={right}>{superFloors || "—"}</span></div>
                      <div className={`${rowBase} ${cols2} text-slate-600`}><span>Plate area</span><span className={right}>{superPlateM2 > 0 ? `${f(superPlateM2)} m²` : "—"}</span></div>
                      <div className={`${rowBase} ${cols2} ${bold} border-t border-slate-200 text-slate-700`}><span>Total area</span><span className={right}>{superTotalM2 > 0 ? `${f(superTotalM2)} m²` : "—"}</span></div>

                      {/* Substructure */}
                      <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-emerald-700">Substructure (below grade)</div>
                      <div className={`${rowBase} ${cols2} text-slate-600`}><span>Number of floors</span><span className={right}>{subFloors || "—"}</span></div>
                      <div className={`${rowBase} ${cols2} text-slate-600`}><span>Plate area (plate + podium offset {calc.podiumOffsetM} m)</span><span className={right}>{subPlateM2 > 0 ? `${f(subPlateM2)} m²` : "—"}</span></div>
                      <div className={`${rowBase} ${cols2} ${bold} border-t border-slate-200 text-slate-700`}><span>Total area</span><span className={right}>{subTotalM2 > 0 ? `${f(subTotalM2)} m²` : "—"}</span></div>

                      {/* Final + comparison */}
                      <div className={`${rowBase} ${cols2} ${bold} mt-1.5 rounded bg-blue-50 px-1 text-blue-800`}><span>Final area (super + sub)</span><span className={right}>{f(finalAreaM2)} m²</span></div>
                      <div className={`${rowBase} ${cols2} text-slate-600`}><span>Total construction area (required)</span><span className={right}>{f(reqM2)} m²</span></div>
                      <div className={`${rowBase} ${cols2} ${bold} ${meets ? "text-emerald-700" : "text-red-600"}`}>
                        <span>{meets ? "Surplus vs. required" : "Shortfall vs. required"}</span>
                        <span className={right}>{deltaM2 >= 0 ? "+" : ""}{f(deltaM2)} m²</span>
                      </div>
                      <div className={`${rowBase} ${cols2} text-slate-500`}>
                        <span className="pl-2">coverage (final ÷ required)</span>
                        <span className={right}>{reqM2 > 0 ? `${coveragePct.toFixed(1)}%` : "—"}</span>
                      </div>
                      {(superPlateM2 <= 0 || subPlateM2 <= 0) && (
                        <div className="mt-1 rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-[9px] text-amber-700">
                          ⚠ Run Calculate (with a converged setback solver) so both plate areas are available — totals are incomplete otherwise.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

            </div>
          )}
        </>
      )}
    </div>
  );
};
