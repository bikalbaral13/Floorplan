import { useState } from "react";

/**
 * Floating "Push" button (dev server only): git add -A, commit and push to GitHub with this
 * machine's git login. Endpoints live in vite.config.ts (gitPush plugin).
 */
async function post<T>(url: string, body: unknown = {}): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(out.error ?? `HTTP ${res.status}`);
  return out as T;
}

export function PushButton() {
  const [pushing, setPushing] = useState(false);

  const push = async () => {
    setPushing(true);
    try {
      const st = await post<{ branch: string; remote: string; files: string[]; ahead: number }>("/__git/status");
      if (!st.files.length && !st.ahead) { alert(`Nothing to push — "${st.branch}" is up to date with GitHub.`); return; }
      const list = st.files.slice(0, 12).map((f) => "  " + f).join("\n") + (st.files.length > 12 ? `\n  … and ${st.files.length - 12} more` : "");
      const message = prompt(
        `Push to GitHub\n\nBranch: ${st.branch}\nRemote: ${st.remote}\n` +
          (st.files.length ? `${st.files.length} changed file(s):\n${list}\n` : "") +
          (st.ahead ? `${st.ahead} commit(s) not yet pushed.\n` : "") +
          `\nAll changes will be committed and pushed. Commit message:`,
        "Update",
      );
      if (message === null) return;
      const res = await post<{ branch: string; log: string }>("/__git/push", { message });
      alert(`Pushed to ${res.branch}.\n\n${res.log.slice(0, 1200)}`);
    } catch (e) {
      alert("Push failed:\n\n" + (e as Error).message + "\n\nPushing works only from this PC while the dev server is running, with git signed in.");
    } finally {
      setPushing(false);
    }
  };

  return (
    <button
      type="button"
      onClick={push}
      disabled={pushing}
      title="Commit all changes and push to GitHub"
      style={{
        position: "fixed", right: 16, bottom: 16, zIndex: 2147483000,
        padding: "8px 14px", borderRadius: 8, border: "1px solid #1f6feb",
        background: pushing ? "#8bb4f0" : "#1f6feb", color: "#fff",
        font: "600 13px system-ui, sans-serif", cursor: pushing ? "wait" : "pointer",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)",
      }}
    >
      ⬆ {pushing ? "Pushing…" : "Push"}
    </button>
  );
}
