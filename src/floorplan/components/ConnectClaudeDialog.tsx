import { useEffect, useState } from "react";
import { Check, Copy, Loader2, PlugZap, Unplug } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { claimRelayFromUrl, disconnectRelay, getRelaySession, pairRelay, type RelaySession, type RelayState } from "../agentBridge";

/** Toolbar button + dialog for the hosted MCP relay: pair this tab, show the one command to paste into
 *  Claude Code, show whether the tab is receiving calls, and disconnect. No accounts: the pasted token is
 *  the only credential, and it expires with the session (12 h). */
/** Asks the always-mounted dialog host to open — fired from the Preferences row, whose popover unmounts. */
export const OPEN_CONNECT_EVENT = "bp-open-connect";

/** "button" = the header button + its dialog (legacy) · "host" = the dialog only, opened by OPEN_CONNECT_EVENT,
 *  kept mounted so the dialog outlives the popover that asked for it · "row" = a full-width menu row (status
 *  light + label) that fires the event, with no dialog of its own. */
export function ConnectClaudeButton({ variant = "button" }: { variant?: "button" | "host" | "row" } = {}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (variant !== "host") return;
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_CONNECT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CONNECT_EVENT, onOpen);
  }, [variant]);
  const [session, setSession] = useState<RelaySession | null>(() => getRelaySession());
  const [state, setState] = useState<RelayState>(() => (getRelaySession() ? "connecting" : "off"));
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onChange = () => setSession(getRelaySession());
    const onState = (e: Event) => setState((e as CustomEvent<{ state: RelayState }>).detail.state);
    window.addEventListener("bp-relay-change", onChange);
    window.addEventListener("bp-relay-state", onState);
    return () => { window.removeEventListener("bp-relay-change", onChange); window.removeEventListener("bp-relay-state", onState); };
  }, []);
  // An open_editor link (#pair=…) connects this tab on load — the host is always mounted, so it runs once here.
  useEffect(() => {
    if (variant !== "host") return;
    claimRelayFromUrl()
      .then((s) => { if (s) { setSession(s); setState("connecting"); toast.success("Connected to Claude — this tab shows its work live."); } })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Could not connect to Claude"));
  }, [variant]);
  useEffect(() => { if (state === "expired") toast.info("Claude connection expired — click Connect Claude to start a new one."); }, [state]);

  const connect = async () => {
    setBusy(true);
    try { setSession(await pairRelay()); setState("connecting"); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Could not connect"); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    if (!session?.command) return;
    try { await navigator.clipboard.writeText(session.command); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast.info("Select the command and copy it by hand."); }
  };

  const light = !session ? "bg-slate-300" : state === "connected" ? "bg-emerald-500" : state === "offline" ? "bg-amber-500" : "bg-slate-400";
  const label = !session ? "Not connected" : state === "connected" ? "Connected — this tab receives Claude's calls"
    : state === "idle" ? "Connected — another tab of yours is receiving the calls" : state === "offline" ? "Reconnecting…" : "Connecting…";

  if (variant === "row") {
    return (
      <Button variant="outline" size="sm" title="Connect Claude Code to this tab" aria-label="Connect Claude"
        onClick={() => window.dispatchEvent(new Event(OPEN_CONNECT_EVENT))} className="w-full justify-start gap-2">
        <PlugZap className="h-4 w-4" />
        <span className="text-xs">Connect Claude</span>
        <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-500">
          <span className={`h-2 w-2 rounded-full ${light}`} aria-hidden />{!session ? "Off" : state === "connected" || state === "idle" ? "On" : "…"}
        </span>
      </Button>
    );
  }

  return (
    <>
      {variant === "button" && (
        <Button variant="outline" size="sm" title="Connect Claude Code to this tab" aria-label="Connect Claude" onClick={() => setOpen(true)} className="gap-1.5">
          <span className={`h-2 w-2 rounded-full ${light}`} aria-hidden />
          <PlugZap className="h-4 w-4" />
        </Button>
      )}
      {/* Non-modal: a checkpoint card can pop up while this is open, and it must stay clickable. */}
      <Dialog open={open} onOpenChange={setOpen} modal={false}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Connect Claude Code</DialogTitle>
            <DialogDescription>
              Let Claude Code on your computer draw in this tab. No sign-up: the command below carries a private token for this session only.
            </DialogDescription>
          </DialogHeader>
          {!session ? (
            <div className="space-y-3 text-sm">
              <ol className="list-decimal space-y-1 pl-5 text-slate-600">
                <li>Click Connect to start a session for this tab.</li>
                <li>Tell Claude (connector) the code it shows, or paste the command into Claude Code.</li>
                <li>Ask Claude to work on the plan. Keep this tab visible while it works.</li>
              </ol>
              <Button onClick={connect} disabled={busy} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />} Connect
              </Button>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${light}`} /><span>{label}</span></div>
              {session.linkCode ? (
                <div className="space-y-1">
                  <p className="text-slate-600">Using the Floorplan designer connector in Claude? Tell Claude:</p>
                  <p className="rounded border border-slate-200 bg-slate-50 p-2 text-center font-mono text-base tracking-widest select-all">connect editor {session.linkCode}</p>
                </div>
              ) : null}
              {session.command ? (
                <div className="space-y-1.5">
                  <p className="text-slate-600">{session.linkCode ? "Or, in Claude Code, run this once in your terminal:" : "Run this once in your terminal:"}</p>
                  <pre id="relay-command" className="whitespace-pre-wrap break-all rounded border border-slate-200 bg-slate-50 p-2 font-mono text-[11px] select-all">{session.command}</pre>
                  <Button variant="outline" size="sm" onClick={copy} className="gap-1.5">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy command"}
                  </Button>
                  <p className="text-[11px] text-slate-500">Shown in this tab only. Anyone with this command can draw in this tab until you disconnect.</p>
                </div>
              ) : (
                <p className="text-slate-600">This tab is connected. The command was shown when you connected; disconnect and connect again for a new one.</p>
              )}
              <p className="text-[11px] text-slate-500">Expires {new Date(session.expiresAt).toLocaleString()}.</p>
              <Button variant="outline" size="sm" onClick={() => void disconnectRelay().then(() => { setSession(null); setState("off"); })} className="gap-1.5 text-red-600">
                <Unplug className="h-3.5 w-3.5" /> Disconnect
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
