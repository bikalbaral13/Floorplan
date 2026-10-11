import { Box, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MESH3D_FORMATS, MESH3D_UNIT_SCALE, type Mesh3DFormat, type Mesh3DOptions } from "../../export/flowMesh3dFormats";

/** What the user picked, ready to hand to the canvas's `exportScene`. */
export interface Export3DSettings extends Mesh3DOptions {
  format: Mesh3DFormat;
  /** Base name, no extension — the chosen format supplies that. */
  fileName: string;
}

export const DEFAULT_EXPORT_3D: Export3DSettings = {
  format: "glb",
  units: "m",
  axis: "z-up",
  fileName: "floorplan",
};

interface Export3DDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: Export3DSettings;
  onSettingsChange: (next: Export3DSettings) => void;
  onExport: () => void;
  busy?: boolean;
  /** Shown when the 3D view isn't mounted yet — exporting will switch to it first. */
  needsSwitchTo3D?: boolean;
}

const UNIT_LABELS: Record<string, string> = { m: "Metres", cm: "Centimetres", mm: "Millimetres", ft: "Feet" };

/**
 * Export the 3D view to a mesh file. The same three choices the Flow "Export 3D" node offers —
 * format, units, up-axis — so a plan exported from the menu and from a flow land identically in
 * whatever opens them.
 */
export const Export3DDialog = ({
  open,
  onOpenChange,
  settings,
  onSettingsChange,
  onExport,
  busy = false,
  needsSwitchTo3D = false,
}: Export3DDialogProps) => {
  const set = <K extends keyof Export3DSettings>(key: K, value: Export3DSettings[K]) =>
    onSettingsChange({ ...settings, [key]: value });
  const meta = MESH3D_FORMATS[settings.format];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Box className="h-4 w-4 text-violet-600" /> Export 3D
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 rounded-md border bg-slate-50 p-3">
          {/* Format ------------------------------------------------------------------ */}
          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-slate-500">Format</span>
            <select
              className="h-8 flex-1 rounded border border-slate-200 bg-white px-2 text-xs"
              value={settings.format}
              onChange={(e) => set("format", e.target.value as Mesh3DFormat)}
            >
              {(Object.keys(MESH3D_FORMATS) as Mesh3DFormat[]).map((f) => (
                <option key={f} value={f}>{MESH3D_FORMATS[f].label}</option>
              ))}
            </select>
          </label>
          {/* Colour survival differs per format, and finding out afterwards in Blender is worse than
              being told here. */}
          <p className="pl-[5.75rem] text-[10px] text-slate-500">
            {meta.colour ? "Keeps per-surface colour." : "Geometry only — this format drops colour."}
          </p>

          {/* Units ------------------------------------------------------------------- */}
          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-slate-500">Units</span>
            <select
              className="h-8 flex-1 rounded border border-slate-200 bg-white px-2 text-xs"
              value={settings.units}
              onChange={(e) => set("units", e.target.value)}
            >
              {Object.keys(MESH3D_UNIT_SCALE).map((u) => (
                <option key={u} value={u}>{UNIT_LABELS[u] ?? u}</option>
              ))}
            </select>
          </label>

          {/* Up axis ----------------------------------------------------------------- */}
          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-slate-500">Up axis</span>
            <div className="flex flex-1 gap-1">
              {(["z-up", "y-up"] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => set("axis", a)}
                  className={`flex-1 rounded border px-2 py-1 text-[11px] ${
                    settings.axis === a
                      ? "border-violet-400 bg-violet-50 font-medium text-violet-700"
                      : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {a === "z-up" ? "Z-up" : "Y-up"}
                </button>
              ))}
            </div>
          </div>
          <p className="pl-[5.75rem] text-[10px] text-slate-500">
            {settings.axis === "z-up" ? "CAD and Blender convention." : "glTF and game-engine convention."}
          </p>

          {/* File name --------------------------------------------------------------- */}
          <label className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-xs text-slate-500">File name</span>
            <div className="flex flex-1 items-center gap-1">
              <input
                type="text"
                className="h-8 min-w-0 flex-1 rounded border border-slate-200 bg-white px-2 text-xs"
                value={settings.fileName}
                onChange={(e) => set("fileName", e.target.value)}
                placeholder="floorplan"
              />
              <span className="shrink-0 font-mono text-[11px] text-slate-400">.{meta.ext}</span>
            </div>
          </label>
        </div>

        {needsSwitchTo3D && (
          <p className="text-[11px] text-amber-700">
            The 3D view isn't open — exporting will switch to it first, then write the file.
          </p>
        )}
        <p className="text-[11px] text-slate-500">
          Exports exactly what the 3D view shows: walls, slabs, placed objects and any flow meshes.
          Anything hidden on the canvas is left out.
        </p>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" className="gap-1.5" onClick={onExport} disabled={busy}>
            <Download className="h-3.5 w-3.5" />
            {busy ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
