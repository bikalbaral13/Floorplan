import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronsUpDown, LogIn, LogOut, Settings } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Who is signed in, as well as the browser knows: the email saved at sign-in, else the token's own claims. */
function readIdentity(): { name: string; email: string | null; signedIn: boolean } {
  let token: string | null = null, email: string | null = null, name: string | null = null;
  try {
    token = localStorage.getItem("token");
    email = localStorage.getItem("userEmail");
    name = localStorage.getItem("userName");
  } catch { /* storage blocked: treat as signed out */ }
  if (token && (!email || !name)) {
    try {
      const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      email ||= claims.email ?? null;
      name ||= claims.name ?? claims.username ?? null;
    } catch { /* not a JWT */ }
  }
  const fromEmail = email ? email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null;
  return { name: name || fromEmail || (token ? "Signed in" : "Guest"), email, signedIn: !!token };
}

/** The account row at the bottom-left of the navigator (Claude-style): avatar, name, and the Preferences gear.
 *  `preferences` is the Preferences panel's content; it opens upward from here. `compact` = the folded rail. */
export const AccountBar = ({ preferences, compact = false }: { preferences: ReactNode; compact?: boolean }) => {
  const navigate = useNavigate();
  const [rev, setRev] = useState(0);
  const me = useMemo(readIdentity, [rev]);
  const initial = me.name.trim().charAt(0).toUpperCase() || "?";

  const avatar = (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-800 text-xs font-semibold text-white">
      {initial}
    </span>
  );

  const signOut = () => {
    try { localStorage.removeItem("token"); localStorage.removeItem("userEmail"); localStorage.removeItem("userName"); } catch { /* ignore */ }
    setRev((r) => r + 1);
    navigate("/signin");
  };

  const prefsPopover = (trigger: ReactNode) => (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent side="top" align="start" sideOffset={8}
        className="max-h-[min(85vh,640px)] w-[22rem] overflow-y-auto p-4 shadow-xl">
        {preferences}
      </PopoverContent>
    </Popover>
  );

  if (compact) {
    return (
      <div className="mt-auto flex flex-col items-center gap-1.5 pt-2">
        {prefsPopover(
          <button type="button" title="Settings" aria-label="Settings"
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <Settings className="h-4 w-4" />
          </button>,
        )}
        <span title={me.email ?? me.name}>{avatar}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 border-t border-slate-100 px-2 py-2">
      <Popover>
        <PopoverTrigger asChild>
          <button type="button" className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-slate-100"
            title={me.email ?? me.name}>
            {avatar}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-slate-800">{me.name}</span>
              {me.email && <span className="block truncate text-[11px] text-slate-500">{me.email}</span>}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" sideOffset={8} className="w-56 p-1">
          {me.email && <p className="truncate px-2 py-1.5 text-xs text-slate-500">{me.email}</p>}
          {me.signedIn ? (
            <button type="button" onClick={signOut}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          ) : (
            <button type="button" onClick={() => navigate("/signin")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
              <LogIn className="h-4 w-4" /> Sign in
            </button>
          )}
        </PopoverContent>
      </Popover>
      {prefsPopover(
        <button type="button" title="Settings" aria-label="Settings"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
          <Settings className="h-4 w-4" />
        </button>,
      )}
    </div>
  );
};
