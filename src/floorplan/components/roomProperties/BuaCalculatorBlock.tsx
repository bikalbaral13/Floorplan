import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Point } from "../../types";

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
}

export interface BuaCalculatorBlockProps {
  selectedRoom: BuaCalculatorRoom;
  pixelsPerMeter: number;
  expanded: boolean;
  setExpanded: (v: boolean | ((prev: boolean) => boolean)) => void;
  /** Persist one or more field updates back onto the room in history state. */
  onUpdateRoom: (updates: Partial<BuaCalculatorRoom>) => void;
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
  chosenPlate: number; floorsNeeded: number; htNeeded: number; htOk: boolean;
  sideSetback: number; bboxWm: number; bboxDm: number;
  maxPlateAllowed: number; plateOk: boolean;
  massingCoreM2: number; massingCorePct: number;
}

function computeStatement(room: BuaCalculatorRoom, pixelsPerMeter: number): ComputedStatement {
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

  // Massing (plate-driven)
  const chosenPlate  = room.chosenPlateM2 ?? 2500;
  const floorsNeeded = chosenPlate > 0 ? Math.ceil(maxGrossBua / chosenPlate) : 0;
  const htNeeded     = floorsNeeded * floorHt;
  const htOk         = htNeeded <= maxHt;
  const sideSetback  = htNeeded > 32 ? 0.25 * htNeeded : 3.6;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const bboxWm = (Math.max(...xs) - Math.min(...xs)) / ppm;
  const bboxDm = (Math.max(...ys) - Math.min(...ys)) / ppm;
  const frontSetback = 4.5;
  const maxPlateAllowed = Math.max(0, bboxWm - 2 * sideSetback) * Math.max(0, bboxDm - 2 * frontSetback);
  const plateOk        = chosenPlate <= maxPlateAllowed;
  const massingCoreM2  = corePerWing * wings * floorsNeeded;
  const massingCorePct = maxGrossBua > 0 ? massingCoreM2 / maxGrossBua : 0;

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
    chosenPlate, floorsNeeded, htNeeded, htOk,
    sideSetback, bboxWm, bboxDm, maxPlateAllowed, plateOk,
    massingCoreM2, massingCorePct,
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

  const onCalculate = () => setCalc(computeStatement(room, p.pixelsPerMeter));

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
              <NumCell roomId={room.id} label="Floor Plate (m²)" title="Chosen gross floor plate area (sq.m) used for Massing — how big each typical floor is"
                field="chosenPlateM2" value={room.chosenPlateM2 ?? 2500} min={100} step={50} onCommit={onCommit} />
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

              {/* Massing */}
              <div className="border-t border-slate-100 pt-2">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-500">Massing</span>
                <p className="text-[8px] italic text-slate-400">plate-driven · uses Floor Plate input above</p>
                <div className="mt-1.5 font-mono">
                  <div className={`${rowBase} ${cols2} border-b border-slate-300 pb-0.5 mb-0.5 font-semibold text-slate-500`}><span>Item</span><span className={right}>Value</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} text-slate-700`}><span>Chosen floor plate (m²)</span><span className={right}>{f(calc.chosenPlate)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Target BUA (m²)</span><span className={right}>{f(calc.maxGrossBua)}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} text-slate-700`}><span>Floors needed</span><span className={right}>{calc.floorsNeeded}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Building height needed (m)</span><span className={`${right} ${calc.htOk ? "" : "text-red-600 font-semibold"}`}>{f(calc.htNeeded)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Height ceiling (m)</span><span className={right}>{f(calc.maxHt)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Height OK?</span><span className={`${right} font-semibold ${calc.htOk ? "text-green-600" : "text-red-600"}`}>{calc.htOk ? "✓ OK" : "✗ OVER"}</span></div>

                  <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-slate-600">Setback feasibility (forward-pass, ≥32m → 0.25h)</div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Side setback at this ht (m)</span><span className={right}>{f(calc.sideSetback)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Plot W × D (m)</span><span className={right}>{calc.bboxWm.toFixed(1)}×{calc.bboxDm.toFixed(1)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Max plate (setbacks) (m²)</span><span className={right}>{f(calc.maxPlateAllowed)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Plate fits setbacks?</span><span className={`${right} font-semibold ${calc.plateOk ? "text-green-600" : "text-red-600"}`}>{calc.plateOk ? "✓ OK" : "✗ OVER"}</span></div>

                  <div className="mt-1.5 mb-0.5 text-[9px] font-semibold text-slate-600">Resulting program</div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>FSI BUA (m²)</span><span className={right}>{f(calc.maxGrossBua)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Parking (m²)</span><span className={right}>{f(calc.parkingM2)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-600`}><span>Other non-FSI (m²)</span><span className={right}>{f(calc.otherNonFsi)}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} border-t border-slate-200 text-slate-700`}><span>Total construction (m²)</span><span className={right}>{f(calc.totalConstM2)}</span></div>
                  <div className={`${rowBase} ${cols2} ${bold} rounded bg-amber-50 px-1 text-amber-800`}><span>Core estimate (m²)</span><span className={right}>{f(calc.massingCoreM2)}</span></div>
                  <div className={`${rowBase} ${cols2} text-slate-500`}><span className="pl-2">Core as % of BUA</span><span className={right}>{(calc.massingCorePct * 100).toFixed(1)}%</span></div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
