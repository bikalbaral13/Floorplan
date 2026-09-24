import { useEffect, useState } from "react";
import { cloudLibraryStatus, listCloudLibraryFiles, r2Credentials, setR2Credentials, type R2Credentials } from "../cloudLibrary";

/** Preferences ▸ Cloudflare R2 — the keys that let this browser list, upload, save and delete in the
 *  library bucket. The deployed app holds no keys of its own, so on the live site these are the only way
 *  in; locally the dev server falls back to .env when they are empty. Stored in this browser only. */
export function R2KeysSettings() {
  const [keys, setKeys] = useState<R2Credentials>(() => r2Credentials());
  const [showSecret, setShowSecret] = useState(false);
  const [state, setState] = useState<"" | "checking" | "ok" | "fail">("");

  const check = async () => {
    setState("checking");
    const status = await cloudLibraryStatus(true);
    // A real signed listing, so "Connected" means the keys work, not merely that they are filled in.
    setState(status.writable && (await listCloudLibraryFiles("Agents")) !== null ? "ok" : "fail");
  };

  useEffect(() => {
    void check();
  }, []);

  const save = () => {
    setR2Credentials(keys);
    setKeys(r2Credentials());
    void check();
  };

  const clear = () => {
    const empty = { endpoint: "", accessKeyId: "", secretAccessKey: "", bucket: "" };
    setR2Credentials(empty);
    setKeys(empty);
    void check();
  };

  const field = (id: keyof R2Credentials, label: string, placeholder: string, secret = false) => (
    <label className="mt-1.5 block">
      <span className="text-[10px] text-slate-600">{label}</span>
      <input
        type={secret && !showSecret ? "password" : "text"}
        className="mt-0.5 h-7 w-full rounded border border-slate-200 bg-white px-1.5 font-mono text-[10px]"
        placeholder={placeholder}
        value={keys[id]}
        onChange={(e) => setKeys((k) => ({ ...k, [id]: e.target.value }))}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); save(); } }}
        spellCheck={false}
        autoComplete="off"
      />
    </label>
  );

  return (
    <div className="mt-3">
      <span className="text-[11px] font-medium text-slate-700">Cloudflare R2 keys</span>
      {field("endpoint", "Endpoint", "https://<account-id>.r2.cloudflarestorage.com")}
      {field("accessKeyId", "Access Key ID", "32-character key id")}
      {field("secretAccessKey", "Secret Access Key", "secret", true)}
      {field("bucket", "Bucket", "builderpluss")}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          className="h-6 rounded bg-teal-600 px-2 text-[10px] font-medium text-white hover:bg-teal-700"
          onClick={save}
        >
          Save keys
        </button>
        <button type="button" className="text-[10px] text-slate-500 underline" onClick={clear}>
          Clear
        </button>
        <button type="button" className="text-[10px] text-slate-500 underline" onClick={() => setShowSecret((v) => !v)}>
          {showSecret ? "Hide secret" : "Show secret"}
        </button>
        <span
          className={`ml-auto text-[10px] ${state === "ok" ? "text-teal-700" : state === "fail" ? "text-rose-600" : "text-slate-400"}`}
        >
          {state === "checking" ? "Checking…" : state === "ok" ? "Connected" : state === "fail" ? "Not connected" : ""}
        </span>
      </div>
      <p className="mt-1 text-[9px] text-slate-400">
        Needed to list, upload, save and delete in the library bucket. Stored in this browser only and sent
        to this app's own server, never shared. Reading library files needs no keys.
      </p>
    </div>
  );
}
