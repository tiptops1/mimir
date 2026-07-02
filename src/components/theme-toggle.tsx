"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Light/dark switch. The chosen theme is a `data-theme` attribute on <html>
// (the design tokens in globals.css key off it) persisted in localStorage;
// the inline script in the root layout re-applies it before first paint so
// there is no flash. Default is light — the design system's home theme.

const STORAGE_KEY = "theme";

function appliedTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  // Server render assumes light; sync to the real attribute after mount so the
  // icon matches what the pre-paint script applied.
  const [theme, setTheme] = useState<"light" | "dark">("light");
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setTheme(appliedTheme()), []);

  const toggle = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    if (next === "dark") {
      document.documentElement.dataset.theme = "dark";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode) — the theme still applies this visit.
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      title={theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"}
      aria-label={
        theme === "dark" ? "Passer en mode clair" : "Passer en mode sombre"
      }
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted hover:bg-surface-2"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
