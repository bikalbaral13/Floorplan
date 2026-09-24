import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Cloud, CloudOff, Download, FolderDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { saveLibraryFile, LIB_DESIGNS } from "../../libraryFiles";
import { cloudLibraryStatus, saveToCloudLibrary, type CloudLibraryStatus } from "../../cloudLibrary";

export interface ExportJsonDialogProps {
  open: boolean;
  /** Serialised design. A thunk, not a string: building it walks the whole model, and the
   *  dialog re-renders on every keystroke in the name field. */
  getPayload: () => string;
  /** Suggested file name without extension. */
  defaultName: string;
  onClose: () => void;
}

/** Where a design goes when you export it.
 *
 *  Three destinations, because they are genuinely different things and the old code did the first
 *  two at once — a download AND a library write on every click, with the result reported as a toast
 *  after the fact. Splitting them makes the cloud copy a decision rather than a side effect.
 *
 *    Download        the file, to your machine. Always available.
 *    Local Library   ../library/content/Designs — the git-tracked checkout. Dev server only.
 *    Cloud Library   the shared R2 bucket, which new_app and any other app read. Dev server only,
 *                    because the signing keys cannot ship to the browser (see cloudLibrary.ts).
 *
 *  Unavailable destinations are shown disabled with the reason, rather than hidden: "no cloud in a
 *  production build" is a fact worth stating once, and a button that vanishes reads as a bug.
 */
export function ExportJsonDialog({ open, getPayload, defaultName, onClose }: ExportJsonDialogProps) {
  const [name, setName] = useState(defaultName);
  const [cloud, setCloud] = useState<CloudLibraryStatus | null>(null);
  const [busy, setBusy] = useState<"" | "local" | "cloud">("");

  // Re-seed on OPEN only. `defaultName` carries a timestamp, so it is a new string on every parent
  // render — depending on it here would reset the field under the user mid-keystroke.
  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setBusy("");
    void cloudLibraryStatus().then(setCloud);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** A file name safe for both a disk download and an object key. */
  const fileName = `${name.replace(/[^a-z0-9_.-]+/gi, "_").replace(/\.json$/i, "") || "floorplan"}.json`;
  const relPath = `${LIB_DESIGNS}/${fileName}`;

  const download = () => {
    const blob = new Blob([getPayload()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    toast.success(`Downloaded ${fileName}`);
    onClose();
  };

  const saveLocal = async () => {
    setBusy("local");
    const r = await saveLibraryFile(relPath, getPayload());
    setBusy("");
    if (!r.ok) return toast.error(`Could not save to the local Library: ${r.error ?? "unknown error"}`);
    toast.success(`Saved to Library/${r.path}`);
    onClose();
  };

  const saveCloud = async () => {
    setBusy("cloud");
    const r = await saveToCloudLibrary(relPath, getPayload());
    setBusy("");
    if (!r.ok) return toast.error(`Could not save to the Cloud Library: ${r.error ?? "unknown error"}`);
    // The public URL is the point of saving here — it is what another app fetches — so it is shown
    // rather than just the key.
    toast.success(`Saved to the Cloud Library — ${r.key}`, {
      description: r.url,
      duration: 8000,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Export design</DialogTitle>
          <DialogDescription>Download the JSON, or save it into a Library other apps can read.</DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="export-json-name">
            File name
          </label>
          <Input
            id="export-json-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            spellCheck={false}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">Saves as {fileName}</p>
        </div>

        <div className="grid gap-2 pt-1">
          <Button variant="outline" className="justify-start gap-2" onClick={download} disabled={!!busy}>
            <Download className="h-4 w-4 shrink-0" />
            <span className="flex flex-col items-start text-left leading-tight">
              <span>Download file</span>
              <span className="text-xs font-normal text-muted-foreground">To your computer</span>
            </span>
          </Button>

          <Button
            variant="outline"
            className="justify-start gap-2"
            onClick={() => void saveLocal()}
            disabled={!!busy}
          >
            {busy === "local" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : (
              <FolderDown className="h-4 w-4 shrink-0" />
            )}
            <span className="flex flex-col items-start text-left leading-tight">
              <span>Save to Library</span>
              <span className="text-xs font-normal text-muted-foreground">The local checkout — dev server only</span>
            </span>
          </Button>

          <Button
            variant="outline"
            className="justify-start gap-2"
            onClick={() => void saveCloud()}
            disabled={!!busy || !cloud?.writable}
          >
            {busy === "cloud" ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            ) : cloud?.writable ? (
              <Cloud className="h-4 w-4 shrink-0" />
            ) : (
              <CloudOff className="h-4 w-4 shrink-0" />
            )}
            <span className="flex flex-col items-start text-left leading-tight">
              <span>Save to Cloud Library</span>
              <span className="text-xs font-normal text-muted-foreground">
                {cloud === null
                  ? "Checking…"
                  : cloud.writable
                    ? `Cloudflare R2 — ${cloud.bucket}/${cloud.prefix}, shared with other apps`
                    : "Unavailable — needs the dev server, or a Worker in production"}
              </span>
            </span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
