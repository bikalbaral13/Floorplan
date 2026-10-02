/**
 * Plan phase workflow — the four steps shown at the top of the Drawing toolbar while the header's
 * phase toggle is on Plan:
 *
 *   ① Import image / PDF        — the existing image-underlay popover (passed in as `importSlot`)
 *   ② Trace automatically       — placeholder: needs Claude in the app (Floorplan Tracer skill)
 *   ③ Upload moodboard PDF      — placeholder: needs Claude in the app (Moodboard Creator skill)
 *   ④ Open moodboard picker     — the existing picker dialog; the picks are saved on the design
 *
 * Each step carries its number, or a ✓ once its result is on the design.
 */
import { type ReactNode } from "react";
import { toast } from "sonner";
import { Palette, ScanLine, FileUp } from "lucide-react";
import { ToolButton } from "@/components/toolbutton";

interface PlanPhaseToolbarProps {
  /** The image-underlay import control (its own trigger button + popover). */
  importSlot: ReactNode;
  onOpenMoodboardPicker: () => void;
  hasUnderlay: boolean;
  hasMoodboard: boolean;
}

const Step = ({ n, done, children }: { n: number; done?: boolean; children: ReactNode }) => (
  <div className="relative">
    {children}
    <span
      className={`pointer-events-none absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[8px] font-bold text-white ${done ? "bg-emerald-600" : "bg-slate-500"}`}
      aria-hidden
    >
      {done ? "✓" : n}
    </span>
  </div>
);

const needsClaude = (what: string) =>
  toast.info(`${what} needs Claude in the app, which is not connected yet.`);

export const PlanPhaseToolbar = ({ importSlot, onOpenMoodboardPicker, hasUnderlay, hasMoodboard }: PlanPhaseToolbarProps) => (
  <div className="flex flex-col items-center gap-2">
    <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Plan</span>
    <Step n={1} done={hasUnderlay}>{importSlot}</Step>
    <Step n={2}>
      <div className="opacity-50">
        <ToolButton
          icon={<ScanLine className="h-6 w-6 text-indigo-600" />}
          label="Trace automatically (needs Claude — coming soon)"
          onClick={() => needsClaude("Tracing")}
        />
      </div>
    </Step>
    <Step n={3}>
      <div className="opacity-50">
        <ToolButton
          icon={<FileUp className="h-6 w-6 text-amber-600" />}
          label="Upload moodboard PDF → make the picker (needs Claude — coming soon)"
          onClick={() => needsClaude("Making a moodboard picker from a PDF")}
        />
      </div>
    </Step>
    <Step n={4} done={hasMoodboard}>
      <ToolButton
        icon={<Palette className="h-6 w-6 text-amber-600" />}
        label="Open moodboard picker (your picks are saved on the design)"
        onClick={onOpenMoodboardPicker}
      />
    </Step>
    <hr className="w-full border-slate-200" />
  </div>
);
