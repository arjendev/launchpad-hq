import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { ThemeToggle } from "../components/ThemeToggle";
import { useTheme } from "../contexts/ThemeContext";

// ── Helper to read current theme ────────────────────────

function ThemeReader() {
  const { theme } = useTheme();
  return <span data-testid="current-theme">{theme}</span>;
}

function ThemeControls() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <button data-testid="toggle" onClick={toggleTheme}>
        toggle
      </button>
      <button data-testid="set-light" onClick={() => setTheme("light")}>
        light
      </button>
      <button data-testid="set-dark" onClick={() => setTheme("dark")}>
        dark
      </button>
    </div>
  );
}

// ── Cleanup ─────────────────────────────────────────────

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mantine-color-scheme");
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-mantine-color-scheme");
});

// ── ThemeContext tests ──────────────────────────────────

describe("ThemeContext", () => {
  it("provides a theme value", () => {
    render(<ThemeReader />);
    const el = screen.getByTestId("current-theme");
    expect(["light", "dark"]).toContain(el.textContent);
  });

  it("toggleTheme switches between light and dark", async () => {
    const user = userEvent.setup();
    render(<ThemeControls />);

    const el = screen.getByTestId("current-theme");
    const initial = el.textContent;
    const expected = initial === "dark" ? "light" : "dark";

    await user.click(screen.getByTestId("toggle"));
    expect(el.textContent).toBe(expected);
  });

  it("setTheme sets a specific theme", async () => {
    const user = userEvent.setup();
    render(<ThemeControls />);

    await user.click(screen.getByTestId("set-dark"));
    expect(screen.getByTestId("current-theme").textContent).toBe("dark");

    await user.click(screen.getByTestId("set-light"));
    expect(screen.getByTestId("current-theme").textContent).toBe("light");
  });

  it("sets data-theme attribute on <html>", async () => {
    const user = userEvent.setup();
    render(<ThemeControls />);

    await user.click(screen.getByTestId("set-dark"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    await user.click(screen.getByTestId("set-light"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });
});

// ── ThemeToggle component tests ────────────────────────

describe("ThemeToggle", () => {
  it("renders a toggle button", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /toggle color theme/i })).toBeInTheDocument();
  });

  it("toggles theme on click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <ThemeToggle />
        <ThemeReader />
      </>,
    );

    const initial = screen.getByTestId("current-theme").textContent;
    const expected = initial === "dark" ? "light" : "dark";

    await user.click(screen.getByRole("button", { name: /toggle color theme/i }));
    expect(screen.getByTestId("current-theme").textContent).toBe(expected);
  });
});
