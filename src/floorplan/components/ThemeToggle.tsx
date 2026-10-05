/**
 * Header ▸ Theme — light / dark, per browser (localStorage). The editor's chrome is written with fixed
 * slate/white utility classes rather than theme tokens, so dark is done as one colour inversion of the
 * page (`html.bp-dark` in index.css) with photos, video and the 3D view inverted back. Not shadcn's
 * `.dark` class: its token swap plus the inversion would land back on light.
 */
import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

const KEY = "bp.editor.theme";
type Theme = "light" | "dark";

const readTheme = (): Theme => {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
};

const applyTheme = (t: Theme) => document.documentElement.classList.toggle("bp-dark", t === "dark");

// Apply before first paint of the editor so a dark user does not see a light flash.
if (typeof document !== "undefined") applyTheme(readTheme());

export const ThemeToggle = () => {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(KEY, theme);
    } catch {
      /* not persisted; this session still switches */
    }
  }, [theme]);
  const dark = theme === "dark";
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-9 w-9 shrink-0 p-0"
      title={dark ? "Theme: dark — switch to light" : "Theme: light — switch to dark"}
      aria-label="Theme"
      aria-pressed={dark}
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {dark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </Button>
  );
};
