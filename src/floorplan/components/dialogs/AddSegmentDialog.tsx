import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { DrawPathStyle, Unit, WallMethod } from "../../types";

/** The display parameters chosen before drawing a plain "Add Segment" line — mirrors the segment
 *  Display block (Mode / Buffer Style / Fill / Line Style / Colour / Thickness / Justification).
 *  "path" = the Buffered band PLUS a live Space derived from the connected run (Wall.asSpace). */
export interface AddSegmentConfig {
  mode: "line" | "buffered" | "path";
  /** Path geometry: "straight" draws plain line segments; the NURBS options turn the drawn
   *  polyline chain into a smooth curve (interpolating through vertices, or smoothing them). */
  pathType: DrawPathStyle;
  /** Thickness in the active display unit (string draft). */
  thickness: string;
  lineStyle: "solid" | "dashed" | "dotted";
  color: string;
  bufferStyle: "capsule" | "square" | "flat";
  fill: "filled" | "outlined" | "hatched";
  method: WallMethod;
  /** Draw this segment's label at its midpoint on the canvas. On by default. */
  showLabel: boolean;
}

interface SegmentDisplayFieldsProps {
  unit: Unit;
  config: AddSegmentConfig;
  onChange: (patch: Partial<AddSegmentConfig>) => void;
  /** Optional — invoked when Enter is pressed in the Thickness field. */
  onSubmit?: () => void;
  /** Focus the Thickness field on mount. */
  autoFocusThickness?: boolean;
}

/** The reusable Mode / Thickness / Line Style / Colour (+ buffered: Buffer Style / Fill / Justification)
 *  controls. Shared by {@link AddSegmentDialog} (plain segment) and the imported-wall object popup, so a
 *  parametric wall exposes the full set of segment display properties. */
export const SegmentDisplayFields = ({ unit, config, onChange, onSubmit, autoFocusThickness }: SegmentDisplayFieldsProps) => (
  <>
    {/* Mode — Line (thin stroke), Buffered (thickness band) or Path (band + live Space). */}
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Mode</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={config.mode === "line" ? "default" : "outline"} onClick={() => onChange({ mode: "line" })}>Line</Button>
        <Button size="sm" variant={config.mode === "buffered" ? "default" : "outline"} onClick={() => onChange({ mode: "buffered" })}>Buffered</Button>
        <Button size="sm" variant={config.mode === "path" ? "default" : "outline"} onClick={() => onChange({ mode: "path" })}>Path</Button>
      </div>
      {config.mode === "path" && (
        <p className="mt-0.5 text-[9px] text-slate-400">
          Draws the same band AND derives a live Space from the connected run — select the Space to attach
          objects; it follows segment edits. (Straight path type only; NURBS draws a curved ribbon.)
        </p>
      )}
    </div>

    {/* Path Type — Straight draws plain line segments; NURBS turns the drawn polyline chain into a
        smooth curve. Thickness is honoured either way (thin → curved line, thick → curved ribbon). */}
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Path Type</p>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant={config.pathType === "straight" ? "default" : "outline"} onClick={() => onChange({ pathType: "straight" })}>Straight</Button>
        <Button size="sm" variant={config.pathType === "nurbs-through" ? "default" : "outline"} onClick={() => onChange({ pathType: "nurbs-through" })}>NURBS · through vertices</Button>
        <Button size="sm" variant={config.pathType === "nurbs-smooth" ? "default" : "outline"} onClick={() => onChange({ pathType: "nurbs-smooth" })}>NURBS · smooth</Button>
      </div>
      {config.pathType !== "straight" && (
        <p className="mt-0.5 text-[9px] text-slate-400">
          "Through vertices" interpolates each click; "smooth" approximates the polyline. Justification defaults to centre.
        </p>
      )}
    </div>

    {/* Thickness — in feet, allow ft-inches drafts like 5' 6.5" (parsed via parseTypedLength on submit),
        so use a free-text field there; other units keep the numeric stepper. */}
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Thickness ({unit})</p>
      <Input
        type={unit === "ft" ? "text" : "number"}
        {...(unit === "ft"
          ? { inputMode: "text" as const, placeholder: `e.g. 0.5 or 5' 6.5"` }
          : { min: 0, step: unit === "cm" ? 1 : 0.05 })}
        value={config.thickness}
        onChange={(e) => onChange({ thickness: e.target.value })}
        onKeyDown={(e) => { if (e.key === "Enter") onSubmit?.(); }}
        autoFocus={autoFocusThickness}
      />
    </div>

    {/* Line style */}
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Line Style</p>
      <div className="flex flex-wrap gap-1.5">
        {(["solid", "dashed", "dotted"] as const).map((s) => (
          <Button key={s} size="sm" className="capitalize" variant={config.lineStyle === s ? "default" : "outline"} onClick={() => onChange({ lineStyle: s })}>{s}</Button>
        ))}
      </div>
    </div>

    {/* Colour */}
    <div>
      <p className="mb-1 text-xs font-semibold text-slate-600">Colour</p>
      <div className="flex items-center gap-2">
        <input type="color" value={config.color} onChange={(e) => onChange({ color: e.target.value })} className="h-7 w-10 cursor-pointer rounded border border-slate-200 bg-white p-0.5" />
        <span className="text-[10px] text-slate-500">{config.color}</span>
      </div>
    </div>

    {/* Show Label — draw the segment's label at its midpoint. */}
    <label className="flex items-center justify-between gap-2">
      <span className="text-xs font-semibold text-slate-600">Show Label</span>
      <input type="checkbox" className="h-4 w-4" checked={config.showLabel} onChange={(e) => onChange({ showLabel: e.target.checked })} />
    </label>

    {/* Band options (Buffered + Path modes) */}
    {(config.mode === "buffered" || config.mode === "path") && (
      <>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Buffer Style</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={config.bufferStyle === "capsule" ? "default" : "outline"} onClick={() => onChange({ bufferStyle: "capsule" })}>Capsule</Button>
            <Button size="sm" variant={config.bufferStyle === "square" ? "default" : "outline"} onClick={() => onChange({ bufferStyle: "square" })}>Square</Button>
            <Button size="sm" variant={config.bufferStyle === "flat" ? "default" : "outline"} onClick={() => onChange({ bufferStyle: "flat" })}>Flat (Butt)</Button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Fill</p>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant={config.fill === "filled" ? "default" : "outline"} onClick={() => onChange({ fill: "filled" })}>Filled</Button>
            <Button size="sm" variant={config.fill === "outlined" ? "default" : "outline"} onClick={() => onChange({ fill: "outlined" })}>Outlined</Button>
            <Button size="sm" variant={config.fill === "hatched" ? "default" : "outline"} onClick={() => onChange({ fill: "hatched" })}>Hatched</Button>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs font-semibold text-slate-600">Justification</p>
          <div className="flex flex-wrap gap-1.5">
            {(["left", "center", "right"] as const).map((m) => (
              <Button key={m} size="sm" className="capitalize" variant={config.method === m ? "default" : "outline"} onClick={() => onChange({ method: m })}>{m}</Button>
            ))}
          </div>
        </div>
      </>
    )}
  </>
);

interface AddSegmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  unit: Unit;
  config: AddSegmentConfig;
  onChange: (patch: Partial<AddSegmentConfig>) => void;
  onStart: () => void;
}

/** Prompts for segment display parameters (like Draw Path), then starts the single-segment draw with
 *  those values applied to each drawn line. */
export const AddSegmentDialog = ({ open, onOpenChange, unit, config, onChange, onStart }: AddSegmentDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Add Segment</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <SegmentDisplayFields unit={unit} config={config} onChange={onChange} onSubmit={onStart} autoFocusThickness />
        <p className="text-[11px] text-slate-500">Click on the canvas to drop vertices; double-click or press Esc to finish.</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button onClick={onStart}>Start drawing</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
