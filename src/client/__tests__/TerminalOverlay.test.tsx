/**
 * Tests for the TerminalOverlay component.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { TerminalOverlay } from "../components/TerminalOverlay.js";

// ── Mock xterm.js (TerminalOverlay renders Terminal which uses xterm) ──

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    open = vi.fn();
    write = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    dispose = vi.fn();
    loadAddon = vi.fn();
    cols = 80;
    rows = 24;
    options: Record<string, unknown> = {};
  },
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit = vi.fn();
    dispose = vi.fn();
  },
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../contexts/WebSocketContext.js", async () => {
  const actual = await vi.importActual<typeof import("../contexts/WebSocketContext.js")>(
    "../contexts/WebSocketContext.js",
  );
  return {
    ...actual,
    useWebSocket: () => ({
      status: "connected" as const,
      subscribe: vi.fn(() => vi.fn()),
      send: vi.fn(),
      onMessage: vi.fn(() => vi.fn()),
      manager: {} as never,
    }),
  };
});

vi.mock("../contexts/ThemeContext.js", async () => {
  const actual = await vi.importActual<typeof import("../contexts/ThemeContext.js")>(
    "../contexts/ThemeContext.js",
  );
  return {
    ...actual,
    useTheme: () => ({
      theme: "dark" as const,
      toggleTheme: vi.fn(),
      setTheme: vi.fn(),
    }),
  };
});

// ── Tests ───────────────────────────────────────────────

describe("TerminalOverlay", () => {
  beforeAll(() => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ terminalId: "t-1" }),
    }) as unknown as typeof fetch;
  });

  it("renders when isOpen is true", () => {
    render(
      <TerminalOverlay daemonId="d1" isOpen={true} onClose={vi.fn()} />,
    );
    expect(screen.getByText("Terminal")).toBeInTheDocument();
  });

  it("does not render content when isOpen is false", () => {
    render(
      <TerminalOverlay daemonId="d1" isOpen={false} onClose={vi.fn()} />,
    );
    expect(screen.queryByText("Terminal")).not.toBeInTheDocument();
  });

  it("contains the terminal container when open", () => {
    render(
      <TerminalOverlay daemonId="d1" isOpen={true} onClose={vi.fn()} />,
    );
    expect(screen.getByTestId("terminal-container")).toBeInTheDocument();
  });

  it("calls onClose when the modal close button is clicked", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <TerminalOverlay daemonId="d1" isOpen={true} onClose={onClose} />,
    );

    // Mantine modal close button — query by CSS class
    const closeBtn = document.querySelector(".mantine-Modal-close") as HTMLElement;
    expect(closeBtn).toBeTruthy();
    await user.click(closeBtn);

    expect(onClose).toHaveBeenCalled();
  });
});
