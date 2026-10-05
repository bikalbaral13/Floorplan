import { useEffect, useState } from "react";
import { cloudLibraryStatus, libraryToken, setLibraryToken } from "../cloudLibrary";

/** Preferences ▸ Cloud Library — one library token instead of the four Cloudflare R2 keys. The server
 *  signs with the R2 keys in its own env (Vercel / .env); reading and listing need nothing, and saving,
 *  uploading or deleting on the live site needs a token from the server's MCP_TOKENS. Stored in this
 *  browser only. Locally the dev server writes without a token. */
export function R2KeysSettings() {
  const [token, setToken] = useState(() => libraryToken());
  const [show, setShow] = useState(false);
  const [state, setState] = useState<"" | "checking" | "ok" | "readonly" | "fail">("");

  const check = async () => {
    setState("checking");
    const status = await cloudLibraryStatus(true);
    setState(status.writable ? "ok" : status.readable ? "readonly" : "fail");
  };

  useEffect(() => {
    void check();
  }, []);

  const save = () => {
    setLibraryToken(token);
    setToken(libraryToken());
    void check();
  };

  return (
    <div className="mt-3">
      <span className="text-[11px] font-medium text-slate-700">Cloud Library token</span>
      <input
        type={show ? "text" : "password"}
        className="mt-1 h-7 w-full rounded border border-slate-200 bg-white px-1.5 font-mono text-[10px]"
        placeholder="only needed to save / upload / delete on the live site"
        value={token}
        onChange={(e) => setToken(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        spellCheck={false}
        autoComplete="off"
      />
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          className="h-6 rounded bg-teal-600 px-2 text-[10px] font-medium text-white hover:bg-teal-700"
          onClick={save}
        >
          Save
        </button>
        <button type="button" className="text-[10px] text-slate-500 underline" onClick={() => { setToken(""); setLibraryToken(""); void check(); }}>
          Clear
        </button>
        <button type="button" className="text-[10px] text-slate-500 underline" onClick={() => setShow((v) => !v)}>
          {show ? "Hide" : "Show"}
        </button>
        <span
          className={`ml-auto text-[10px] ${state === "ok" ? "text-teal-700" : state === "fail" ? "text-rose-600" : "text-slate-400"}`}
        >
          {state === "checking" ? "Checking…" : state === "ok" ? "Can write" : state === "readonly" ? "Read-only" : state === "fail" ? "Not connected" : ""}
        </span>
      </div>
      <p className="mt-1 text-[9px] text-slate-400">
        The R2 keys stay on the server (Vercel env). Reading the library needs nothing; writing on the live
        site needs a token from the server's MCP_TOKENS. Stored in this browser only.
      </p>
    </div>
  );
}
