/** References block for a selected SPACE (after the INFRA reception architect HTML): the reference image of
 *  its finish, a caption / source link, and Upload · Library · Generate.
 *
 *  Stored on the space's Room object as two params (library/Objects/Architectural/room.json):
 *    referenceImage  library-relative path ("Images/References/x.jpg") or a full URL
 *    referenceNote   caption, or a source link (a URL is shown as a link)
 *  Upload puts the file in library/Images/References/. Library takes the image ticked in the Library tree.
 *  Generate is shown but not wired yet. */
import { useRef, useState } from "react";
import { ExternalLink, ImagePlus, Library, Loader2, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { uploadToBucket } from "../cloudLibrary";
import { useLibrarySelection } from "../librarySelection";

const isUrl = (s: string) => /^https?:\/\//i.test(s);

export function SpaceReferences({ image, note, libraryBase, hasRoomObject, onChange }: {
  image: string; note: string;
  /** Public base of the library, e.g. https://…r2.dev/library */
  libraryBase: string;
  /** False when the space has no Room object to store the params on. */
  hasRoomObject: boolean;
  onChange: (patch: { referenceImage?: string; referenceNote?: string }) => void;
}) {
  const selection = useLibrarySelection();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const src = !image ? "" : isUrl(image) ? image : `${libraryBase.replace(/\/+$/, "")}/${image.replace(/^\/*(library\/)?/, "").split("/").map(encodeURIComponent).join("/")}`;
  const toPath = (keyOrUrl: string) => keyOrUrl.replace(/^library\//, "");

  const upload = async (f: File) => {
    setBusy(true);
    const safe = f.name.replace(/[^\w.-]+/g, "_");
    const key = `library/Images/References/${Date.now().toString(36)}_${safe}`;
    const r = await uploadToBucket(key, f);
    setBusy(false);
    if (!r.ok) { toast.error(`Upload failed${r.error ? `: ${r.error}` : ""}`); return; }
    onChange({ referenceImage: toPath(r.key ?? key) });
    toast.success("Reference image uploaded");
  };

  const fromLibrary = () => {
    const img = selection.find((s) => /\.(png|jpe?g|webp|gif)$/i.test(s.key));
    if (!img) { toast.info("Tick an image in the Library first (e.g. under Images/), then press Library."); return; }
    onChange({ referenceImage: toPath(img.key) });
  };

  if (!hasRoomObject) {
    return (
      <div className="mt-3">
        <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">References</p>
        <p className="mt-1 text-[11px] text-slate-500">Attach the Room object to this space to keep reference images on it.</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-slate-400">References</p>
      {src ? (
        <div className="relative mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <img src={src} alt={note || "Reference"} crossOrigin="anonymous" className="block max-h-56 w-full object-cover" loading="lazy" />
          <button type="button" onClick={() => onChange({ referenceImage: "" })} title="Remove the reference image" aria-label="Remove reference image"
            className="absolute right-1.5 top-1.5 rounded-full bg-white/90 p-1 text-slate-600 shadow hover:bg-white hover:text-rose-600">
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => fileRef.current?.click()}
          className="mt-1.5 flex h-24 w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-[11px] text-slate-500 hover:border-slate-400 hover:bg-slate-50">
          <ImagePlus className="h-5 w-5 text-slate-400" /> Add a reference image
        </button>
      )}
      <div className="mt-1.5 flex items-center gap-1.5">
        <input value={note} onChange={(e) => onChange({ referenceNote: e.target.value })} placeholder="Caption or source link"
          className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] outline-none focus:border-slate-300" />
        {isUrl(note.trim()) && (
          <a href={note.trim()} target="_blank" rel="noreferrer" title="Open the source" className="rounded p-1 text-sky-700 hover:bg-sky-50">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Upload
        </button>
        <button type="button" onClick={fromLibrary} title="Use the image ticked in the Library tree"
          className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50">
          <Library className="h-3.5 w-3.5" /> Library
        </button>
        <button type="button" disabled title="Generate — coming soon"
          className="inline-flex cursor-not-allowed items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[11px] font-semibold text-slate-400">
          <Sparkles className="h-3.5 w-3.5" /> Generate
        </button>
      </div>
      <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void upload(f); }} />
    </div>
  );
}
