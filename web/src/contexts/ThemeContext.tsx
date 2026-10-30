import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ThemeMode } from "../types/api";

const THEME_STORAGE_KEY = "edusms_theme";

interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: "dark" | "light";
  setThemeMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): "dark" | "light" {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }
  return "dark";
}

function readStoredTheme(): ThemeMode {
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "dark" || val === "light" || val === "system") {
      return val;
    }
  } catch {
    // ignore storage errors
  }
  return "dark";
}

function applyThemeToDOM(mode: ThemeMode, resolved: "dark" | "light"): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => readStoredTheme());
  const [systemTheme, setSystemTheme] = useState<"dark" | "light">(() => getSystemTheme());

  const resolvedTheme: "dark" | "light" = themeMode === "system" ? systemTheme : themeMode;

  useEffect(() => {
    applyThemeToDOM(themeMode, resolvedTheme);
  }, [themeMode, resolvedTheme]);

  // Live listener when in "system" mode per modern-web-guidance
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent) => {
      const next = e.matches ? "dark" : "light";
      setSystemTheme(next);
      if (themeMode === "system") {
        applyThemeToDOM("system", next);
      }
    };

    // Sync initial system value when switching into system mode
    setSystemTheme(mql.matches ? "dark" : "light");

    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", handleChange);
      return () => mql.removeEventListener("change", handleChange);
    }
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // ignore storage errors
    }
    const nextResolved = mode === "system" ? getSystemTheme() : mode;
    applyThemeToDOM(mode, nextResolved);
  }, []);

  const value = useMemo(
    () => ({ themeMode, resolvedTheme, setThemeMode }),
    [themeMode, resolvedTheme, setThemeMode]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
