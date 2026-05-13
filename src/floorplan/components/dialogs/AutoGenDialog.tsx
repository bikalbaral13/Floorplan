import { type RefObject, type ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface AutoGenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  configJson: string;
  onConfigJsonChange: (value: string) => void;
  error: string | null;
  onErrorClear: () => void;
  fileInputRef: RefObject<HTMLInputElement>;
  onFileUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportGraph: () => void;
  onGenerate: () => void;
}

export const AutoGenDialog = ({
  open,
  onOpenChange,
  configJson,
  onConfigJsonChange,
  error,
  onErrorClear,
  fileInputRef,
  onFileUpload,
  onImportGraph,
  onGenerate,
}: AutoGenDialogProps) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>Auto Generate Floor Plan</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <p className="text-sm text-slate-500">
          Paste JSON below. Two formats supported: <b>BSP config</b> (boundary, rooms, connections) → click "Generate BSP", or <b>Graph</b> (nodes, edges with type wall/door/window) → click "Import as Graph". All coordinates in meters.
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            Upload JSON
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={onFileUpload}
            className="hidden"
          />
        </div>
        <Textarea
          className="h-80 font-mono text-xs"
          value={configJson}
          onChange={(e) => { onConfigJsonChange(e.target.value); onErrorClear(); }}
          spellCheck={false}
        />
        {error && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
      </div>
      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button variant="outline" onClick={onImportGraph}>Import as Graph</Button>
        <Button onClick={onGenerate}>Generate BSP</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);
