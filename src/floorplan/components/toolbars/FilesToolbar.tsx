import { useState, type ReactNode } from "react";
import { SectionHeader } from "./SectionHeader";

export interface FilesToolbarProps {
  /** Parent-rendered file/import/export controls. The parent owns the file-input refs
   *  and handlers, so the toolbar just lays out whatever JSX is passed in. */
  slot: ReactNode;
}

/** Foldable "Files" group — import / save / load / export controls in a 2-col grid. */
export const FilesToolbar = (p: FilesToolbarProps) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="Files" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="grid grid-cols-2 place-items-center gap-2 pt-1">
          {p.slot}
        </div>
      )}
    </div>
  );
};
