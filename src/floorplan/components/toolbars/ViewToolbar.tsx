import { useState, type ReactNode } from "react";
import { SectionHeader } from "./SectionHeader";

export interface ViewToolbarProps {
  /** 2D/3D toggle pill, parent-rendered (owns the viewMode state). */
  view2D3DToggle?: ReactNode;
  /** Snapping / Layers / View Mode popovers grouped from the parent. */
  settingsPopover: ReactNode;
  /** Default Settings popover. */
  defaultSettingsPopover: ReactNode;
}

/** Foldable "View" section — 2D/3D toggle on top, then Snapping / Layers / View Mode
 *  / Default Settings popovers in a 2-col grid below. */
export const ViewToolbar = (p: ViewToolbarProps) => {
  const [open, setOpen] = useState<boolean>(true);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="View" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="flex flex-col items-center gap-2 pt-1">
          {p.view2D3DToggle}
          <div className="grid w-full grid-cols-2 place-items-center gap-2">
            {p.settingsPopover}
            {p.defaultSettingsPopover}
          </div>
        </div>
      )}
    </div>
  );
};
