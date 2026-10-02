/**
 * Present phase workflow — the whole Drawing toolbar while the header's phase toggle is on Present
 * (no drawing tools: the plan is finished by now).
 *
 *   Upload PDF  — the walkthrough / video brief. Uploaded to the library (Walkthroughs/) and its path
 *                 saved on the design as settings.walkthrough, so it travels with Export JSON.
 *   Render      — placeholder: Floorplan Renderer skill; needs Claude in the app.
 *   Make Video  — placeholder: needs Claude in the app.
 */
import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileUp, Camera, Clapperboard } from "lucide-react";
import { ToolButton } from "@/components/toolbutton";
import { uploadToBucket } from "../../cloudLibrary";

interface PresentPhaseToolbarProps {
  /** Library-relative path of the uploaded brief, if any. */
  walkthroughPath?: string;
  onWalkthroughUploaded: (relPath: string) => void;
}

const needsClaude = (what: string) => toast.info(`${what} needs Claude in the app, which is not connected yet.`);

export const PresentPhaseToolbar = ({ walkthroughPath, onWalkthroughUploaded }: PresentPhaseToolbarProps) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (file: File) => {
    const safe = file.name.replace(/[^\w.\- ]+/g, "_");
    const rel = `Walkthroughs/${safe}`;
    setBusy(true);
    const res = await uploadToBucket(`library/${rel}`, file);
    setBusy(false);
    if (!res.ok) { toast.error(`Upload failed: ${res.error}. Check Preferences ▸ Cloudflare R2.`); return; }
    onWalkthroughUploaded(rel);
    toast.success(`Saved ${safe} to the library (${rel}). It is recorded on this design.`);
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">Present</span>
      <div className="relative">
        <ToolButton
          active={busy}
          icon={<FileUp className="h-6 w-6 text-sky-600" />}
          label={walkthroughPath ? `Walkthrough brief: ${walkthroughPath} — click to replace` : "Upload PDF — walkthrough / video brief"}
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        />
        {walkthroughPath && (
          <span className="pointer-events-none absolute -left-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-600 text-[8px] font-bold text-white" aria-hidden>✓</span>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }}
        />
      </div>
      <div className="opacity-50">
        <ToolButton
          icon={<Camera className="h-6 w-6 text-indigo-600" />}
          label="Render (needs Claude — coming soon)"
          onClick={() => needsClaude("Rendering")}
        />
      </div>
      <div className="opacity-50">
        <ToolButton
          icon={<Clapperboard className="h-6 w-6 text-rose-600" />}
          label="Make Video (needs Claude — coming soon)"
          onClick={() => needsClaude("Making a video")}
        />
      </div>
    </div>
  );
};
