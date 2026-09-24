/** "Where these files come from" — one line, shown by every dialog that lists Library content.
 *
 *  Import dialogs used to name `public/Library/Objects` (and friends) in their body text and empty
 *  states. That folder was published to the bucket and removed from the repo, so the path was both
 *  wrong and unopenable. This states the real base instead — the one configured in Preferences ▸
 *  Library Path, which every relative reference in the app resolves against.
 *
 *  NOT A LINK, deliberately. r2.dev serves objects but does not list them: `<base>/Objects` answers
 *  404 while `<base>/Objects/Architectural/plot.json` answers 200. A folder link would therefore be a
 *  dead link on every single click, which is worse than no link — so the address is shown as text and
 *  offered for COPYING, which is what someone actually does with it (paste into a browser next to a
 *  file name, or into another tool's library setting). Individual FILES do resolve, and those are
 *  linked where they are listed — see AccessSection in ChatAIPanel.
 */
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { useLibraryBase } from "../useLibraryBase";

export interface LibrarySourceNoteProps {
  /** Library root this dialog is browsing, e.g. "Objects" or "Tools". Omit for the library root. */
  folder?: string;
  /** Leading text, e.g. "Reading from". Defaults to "Source". */
  label?: string;
  className?: string;
}

export const LibrarySourceNote = ({ folder, label = "Source", className = "" }: LibrarySourceNoteProps) => {
  const { url, ready } = useLibraryBase();
  const [copied, setCopied] = useState(false);
  if (!ready) return null;

  if (!url) {
    return (
      <p className={`text-[11px] text-slate-500 ${className}`}>
        {label} the shared Library — no address configured (set one in Preferences ▸ Library Path).
      </p>
    );
  }

  const shown = folder ? `${url}/${folder}/` : url;
  const copy = () => {
    void navigator.clipboard?.writeText(shown).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1200); },
      () => { /* clipboard blocked — the address is still on screen to select */ },
    );
  };

  return (
    <p className={`flex min-w-0 items-center gap-1 text-[11px] text-slate-500 ${className}`}>
      <span className="shrink-0">{label}</span>
      <span className="truncate font-mono text-[10px] text-slate-600" title={shown}>{shown}</span>
      <button
        type="button"
        onClick={copy}
        className="shrink-0 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        title={copied ? "Copied" : "Copy address"}
        aria-label={copied ? "Copied" : "Copy library address"}
      >
        {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
      </button>
    </p>
  );
};
