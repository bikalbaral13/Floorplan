import { useState } from "react";
import { SquarePlus, SquareSlash } from "lucide-react";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";

export interface AddSemanticsToolbarProps {
  onAddRoomTypeClick: () => void;
  onAddSegmentTypeClick: () => void;
}

/** User-defined room and segment type builders — opens the corresponding dialog. */
export const AddSemanticsToolbar = (p: AddSemanticsToolbarProps) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="Add Semantics" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="grid grid-cols-2 place-items-center gap-2 pt-1">
          <ToolButton
            icon={<SquarePlus className="h-6 w-6 text-indigo-600" />}
            label="Add Room Type"
            onClick={p.onAddRoomTypeClick}
          />
          <ToolButton
            icon={<SquareSlash className="h-6 w-6 text-indigo-600" />}
            label="Add Segment Type"
            onClick={p.onAddSegmentTypeClick}
          />
        </div>
      )}
    </div>
  );
};
