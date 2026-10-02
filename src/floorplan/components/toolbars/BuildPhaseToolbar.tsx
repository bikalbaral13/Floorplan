/**
 * Build phase workflow — shown at the top of the Drawing toolbar while the header's phase toggle is on Build.
 *
 *   Improve Floorplan — placeholder: will run the Floorplan Improver skill (R2 Skills/) on the traced plan
 *                       with the moodboard picked in Plan, and load the improved canvas JSON. Needs Claude in
 *                       the app, which is not connected yet.
 */
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { ToolButton } from "@/components/toolbutton";

interface BuildPhaseToolbarProps {
  hasPlan: boolean;
  hasMoodboard: boolean;
}

export const BuildPhaseToolbar = ({ hasPlan, hasMoodboard }: BuildPhaseToolbarProps) => {
  const improve = () => {
    if (!hasPlan) { toast.error("Improve needs a plan on the canvas — trace or import one in Plan first."); return; }
    if (!hasMoodboard) toast.warning("No moodboard picked in Plan — the Improver would use its own defaults.");
    toast.info("Improving the floorplan needs Claude in the app, which is not connected yet.");
  };
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Build</span>
      <div className="opacity-50">
        <ToolButton
          icon={<Sparkles className="h-6 w-6 text-violet-600" />}
          label="Improve Floorplan — Floorplan Improver with the Plan's moodboard (needs Claude — coming soon)"
          onClick={improve}
        />
      </div>
      <hr className="w-full border-slate-200" />
    </div>
  );
};
