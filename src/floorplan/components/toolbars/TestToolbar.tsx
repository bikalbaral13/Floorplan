import { useState } from "react";
import { Sparkles } from "lucide-react";
import { ToolButton } from "@/components/toolbutton";
import { SectionHeader } from "./SectionHeader";

export interface TestToolbarProps {
  onTestDrawPolygon: () => void;
}

/** Dev/debug shortcuts — drops a random 5-sided polygon room on the canvas. */
export const TestToolbar = (p: TestToolbarProps) => {
  const [open, setOpen] = useState<boolean>(false);
  return (
    <div className="flex flex-col gap-1 px-1">
      <SectionHeader label="Test" open={open} onToggle={() => setOpen((v) => !v)} />
      {open && (
        <div className="flex justify-center pt-1">
          <ToolButton
            icon={<Sparkles className="h-6 w-6 text-amber-500" />}
            label="Test (random pentagon)"
            onClick={p.onTestDrawPolygon}
          />
        </div>
      )}
    </div>
  );
};
