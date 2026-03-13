import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import {
  useMantineColorScheme,
  useComputedColorScheme,
} from "@mantine/core";

// ── Public types ────────────────────────────────────────

export type Theme = "light" | "dark";

export interface ThemeContextValue {
  /** The resolved theme currently in effect. */
  theme: Theme;
  /** Toggle between light and dark. */
  toggleTheme: () => void;
  /** Set a specific theme. */
  setTheme: (theme: Theme) => void;
}

// ── Context ─────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ── Provider ────────────────────────────────────────────

/**
 * Wraps Mantine's color-scheme system with a simpler API and keeps the
 * `data-theme` attribute on `<html>` in sync (useful for CSS selectors
 * that don't rely on Mantine internals).
 *
 * Must be rendered **inside** MantineProvider.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { setColorScheme } = useMantineColorScheme();
  // "dark" fallback → mission control aesthetic is the default
  const computedScheme = useComputedColorScheme("dark");

  // Mirror to data-theme for non-Mantine CSS selectors
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", computedScheme);
  }, [computedScheme]);

  const toggleTheme = useCallback(() => {
    const next: Theme = computedScheme === "dark" ? "light" : "dark";
    setColorScheme(next);
  }, [computedScheme, setColorScheme]);

  const setTheme = useCallback(
    (t: Theme) => setColorScheme(t),
    [setColorScheme],
  );

  return (
    <ThemeContext.Provider
      value={{ theme: computedScheme as Theme, toggleTheme, setTheme }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return ctx;
}
