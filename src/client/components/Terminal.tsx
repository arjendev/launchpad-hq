/**
 * Full terminal emulator component powered by xterm.js.
 *
 * - Spawns a PTY on mount (unless terminalId is provided)
 * - Connects to the WebSocket terminal channel for I/O
 * - Auto-sizes via FitAddon
 * - Theme-aware (dark/light via --lp-* CSS variables)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { useTerminal as useTerminalWs } from "../hooks/useTerminal.js";
import { useTheme } from "../contexts/ThemeContext.js";

// ── Theme maps ──────────────────────────────────────────

const DARK_THEME = {
  background: "#0b1120",
  foreground: "#e4e8f1",
  cursor: "#4c9aff",
  cursorAccent: "#0b1120",
  selectionBackground: "#253044",
  selectionForeground: "#e4e8f1",
  black: "#141d2f",
  red: "#ff5630",
  green: "#36b37e",
  yellow: "#ffab00",
  blue: "#4c9aff",
  magenta: "#b48ead",
  cyan: "#88c0d0",
  white: "#e4e8f1",
  brightBlack: "#8892a8",
  brightRed: "#ff7452",
  brightGreen: "#57d9a3",
  brightYellow: "#ffc400",
  brightBlue: "#6cb8ff",
  brightMagenta: "#c8a8d4",
  brightCyan: "#a3d4e0",
  brightWhite: "#ffffff",
};

const LIGHT_THEME = {
  background: "#f5f7fa",
  foreground: "#1a1d23",
  cursor: "#2563eb",
  cursorAccent: "#f5f7fa",
  selectionBackground: "#dde1e8",
  selectionForeground: "#1a1d23",
  black: "#1a1d23",
  red: "#dc2626",
  green: "#16a34a",
  yellow: "#d97706",
  blue: "#2563eb",
  magenta: "#9333ea",
  cyan: "#0891b2",
  white: "#f5f7fa",
  brightBlack: "#6b7280",
  brightRed: "#ef4444",
  brightGreen: "#22c55e",
  brightYellow: "#eab308",
  brightBlue: "#3b82f6",
  brightMagenta: "#a855f7",
  brightCyan: "#06b6d4",
  brightWhite: "#ffffff",
};

// ── Props ───────────────────────────────────────────────

export interface TerminalProps {
  /** Daemon to connect to. */
  daemonId: string;
  /** Resume an existing terminal session. If omitted a new PTY is spawned. */
  terminalId?: string;
  /** Called when the terminal session exits or user explicitly closes. */
  onClose?: () => void;
}

// ── Component ───────────────────────────────────────────

export function Terminal({ daemonId, terminalId: externalTerminalId, onClose }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(
    externalTerminalId ?? null,
  );
  const [spawning, setSpawning] = useState(!externalTerminalId);
  const [exited, setExited] = useState(false);
  const exitedRef = useRef(false);
  const spawnedByUsRef = useRef(false);

  const { theme } = useTheme();

  // ── Spawn PTY if needed ─────────────────────────────
  useEffect(() => {
    if (externalTerminalId || activeTerminalId) return;

    let cancelled = false;

    async function spawn() {
      try {
        const res = await fetch(`/api/daemons/${daemonId}/terminal`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cols: xtermRef.current?.cols ?? 80,
            rows: xtermRef.current?.rows ?? 24,
          }),
        });
        if (!res.ok) throw new Error(`Spawn failed: ${res.status}`);
        const { terminalId } = (await res.json()) as { terminalId: string };
        if (!cancelled) {
          spawnedByUsRef.current = true;
          setActiveTerminalId(terminalId);
          setSpawning(false);
        }
      } catch {
        if (!cancelled) setSpawning(false);
      }
    }

    spawn();
    return () => {
      cancelled = true;
    };
  }, [daemonId, externalTerminalId, activeTerminalId]);

  // ── Kill PTY on unmount if we spawned it ────────────
  useEffect(() => {
    return () => {
      if (spawnedByUsRef.current && activeTerminalId) {
        fetch(`/api/daemons/${daemonId}/terminal/${activeTerminalId}`, {
          method: "DELETE",
        }).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daemonId, activeTerminalId]);

  // ── WebSocket terminal hook ─────────────────────────
  const handleData = useCallback((data: string) => {
    xtermRef.current?.write(data);
  }, []);

  const handleExit = useCallback(
    (exitCode: number) => {
      setExited(true);
      exitedRef.current = true;
      xtermRef.current?.write(`\r\n\x1b[90m[Session ended — exit code ${exitCode}]\x1b[0m\r\n`);
    },
    [],
  );

  const { sendInput, sendResize } = useTerminalWs({
    daemonId,
    terminalId: activeTerminalId ?? "",
    onData: activeTerminalId ? handleData : undefined,
    onExit: activeTerminalId ? handleExit : undefined,
  });

  // Keep sendInput/sendResize in refs so the one-time xterm effect
  // always calls the latest version (avoids stale-closure with empty terminalId).
  const sendInputRef = useRef(sendInput);
  const sendResizeRef = useRef(sendResize);
  sendInputRef.current = sendInput;
  sendResizeRef.current = sendResize;

  // ── Initialize xterm.js ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const themeColors = theme === "dark" ? DARK_THEME : LIGHT_THEME;

    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      theme: themeColors,
      allowProposedApi: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);

    // Initial fit
    try {
      fit.fit();
    } catch {
      // Container may not be visible yet
    }

    xtermRef.current = term;
    fitRef.current = fit;

    // Forward user keystrokes to the daemon via ref (never stale)
    const dataDisposable = term.onData((data: string) => {
      if (!exitedRef.current) sendInputRef.current(data);
    });

    // Forward terminal resize events via ref (never stale)
    const resizeDisposable = term.onResize(({ cols, rows }) => {
      sendResizeRef.current(cols, rows);
    });

    return () => {
      dataDisposable.dispose();
      resizeDisposable.dispose();
      term.dispose();
      xtermRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update theme when it changes ────────────────────
  useEffect(() => {
    const term = xtermRef.current;
    if (!term) return;
    term.options.theme = theme === "dark" ? DARK_THEME : LIGHT_THEME;
  }, [theme]);

  // ── Resize on window resize ─────────────────────────
  useEffect(() => {
    const fit = fitRef.current;
    if (!fit) return;

    const onResize = () => {
      try {
        fit.fit();
      } catch {
        // noop
      }
    };

    window.addEventListener("resize", onResize);

    // Also fit when container becomes visible (e.g. modal open animation)
    const ro = new ResizeObserver(onResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      window.removeEventListener("resize", onResize);
      ro.disconnect();
    };
  }, []);

  // ── Render ──────────────────────────────────────────
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {spawning && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--lp-text-secondary)",
            fontSize: 14,
            zIndex: 1,
          }}
        >
          Connecting…
        </div>
      )}
      <div
        ref={containerRef}
        data-testid="terminal-container"
        style={{
          width: "100%",
          height: "100%",
          opacity: spawning ? 0 : 1,
        }}
      />
    </div>
  );
}
