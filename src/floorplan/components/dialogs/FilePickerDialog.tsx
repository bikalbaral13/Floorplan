import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** One choice in Files ▸ Import… / Export…: an icon card that closes the dialog and runs its action. */
export interface FilePickerOption {
  id: string;
  icon: ReactNode;
  label: string;
  /** One line under the label — what file it reads / writes. */
  hint: string;
  onSelect: () => void;
}

export interface FilePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  options: FilePickerOption[];
}

/** Files ▸ Import… and Files ▸ Export… — one button each in the Files menu, and this grid to pick what kind.
 *  Closes BEFORE running the action, so a native file picker or a follow-up dialog isn't stacked on it. */
export const FilePickerDialog = (p: FilePickerDialogProps) => (
  <Dialog open={p.open} onOpenChange={p.onOpenChange}>
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>{p.title}</DialogTitle>
        <DialogDescription>{p.description}</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {p.options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="flex flex-col items-start gap-1 rounded-md border border-slate-200 p-3 text-left hover:border-sky-400 hover:bg-sky-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
            onClick={() => { p.onOpenChange(false); setTimeout(o.onSelect, 0); }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded bg-slate-100">{o.icon}</span>
            <span className="text-[13px] font-semibold text-slate-800">{o.label}</span>
            <span className="text-[11px] leading-snug text-slate-500">{o.hint}</span>
          </button>
        ))}
      </div>
    </DialogContent>
  </Dialog>
);
