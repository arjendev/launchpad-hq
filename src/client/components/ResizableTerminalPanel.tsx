/**
 * Resizable bottom panel that hosts either a Terminal (CLI sessions)
 * or a CopilotConversation (SDK sessions).
 *
 * VS Code–style horizontal split: drag the top handle to resize.
 * Wraps the existing Terminal component without modifying it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { Terminal } from "./Terminal.js";
import { CopilotConversation } from "./CopilotConversation.js";
import { useAggregatedSession, useEndSession } from "../services/hooks.js";

// ── Props ──────────────────────────────────────────────

export interface ResizableTerminalPanelProps {
  /** Daemon to connect the terminal to. */
  daemonId: string;
  /** Existing terminal id (for resuming CLI sessions). */
  terminalId?: string;
  /** Session id for data lookup. Omit for standalone terminal mode. */
  sessionId?: string;
  /** Session type — "copilot-cli" renders a terminal; anything else renders a conversation. */
  sessionType?: string;
  /** Called when the user detaches (minimizes) the panel. */
  onClose?: () => void;
  /** Initial panel height in pixels. @default 300 */
  defaultHeight?: number;
  /** Called when agent changes in the conversation dropdown (for coordinator sessions). */
  onAgentChange?: (agentId: string | null) => void;
  /** Minimum height the panel can be dragged to. @default 100 */
  minHeight?: number;
}

// ── Status display maps ────────────────────────────────

const statusColor: Record<string, string> = {
  active: "green",
  idle: "yellow",
  error: "red",
  ended: "gray",
};

const statusLabel: Record<string, string> = {
  active: "● active",
  idle: "● idle",
  error: "● error",
  ended: "● ended",
};

// ── Component ──────────────────────────────────────────

export function ResizableTerminalPanel({
  daemonId,
  terminalId,
  sessionId,
  sessionType: propSessionType,
  onClose,
  defaultHeight = 300,
  minHeight = 100,
  onAgentChange,
}: ResizableTerminalPanelProps) {
  const isMobile = useMediaQuery("(max-width: 768px)");
  const { data: sessionData } = useAggregatedSession(sessionId ?? "");
  const endSession = useEndSession();

  const isStandaloneTerminal = !sessionId;

  // Resolve session type (prop wins, query fallback)
  const resolvedSessionType = isStandaloneTerminal ? undefined : (propSessionType ?? sessionData?.sessionType);
  const isCliSession = isStandaloneTerminal || resolvedSessionType === "copilot-cli";

  // ── Resize state ──────────────────────────────────────
  const [height, setHeight] = useState(defaultHeight);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  // On mobile, fill available space
  useEffect(() => {
    if (isMobile) setHeight(defaultHeight);
  }, [isMobile, defaultHeight]);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
    },
    [height],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      dragging.current = true;
      startY.current = e.touches[0].clientY;
      startH.current = height;
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.clientY;
      const maxH = window.innerHeight * 0.85;
      setHeight(Math.min(maxH, Math.max(minHeight, startH.current + delta)));
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - e.touches[0].clientY;
      const maxH = window.innerHeight * 0.85;
      setHeight(Math.min(maxH, Math.max(minHeight, startH.current + delta)));
    };

    const onUp = () => {
      dragging.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [minHeight]);

  // ── End-session confirm pattern ───────────────────────
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleEndClick = () => {
    if (!sessionId) return;
    if (!confirmingEnd) {
      setConfirmingEnd(true);
      confirmTimer.current = setTimeout(() => setConfirmingEnd(false), 3000);
      return;
    }
    clearTimeout(confirmTimer.current);
    endSession.mutate(sessionId, { onSuccess: () => onClose?.() });
  };

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  // ── Detach (minimize) ─────────────────────────────────
  // Just close the panel — SessionContext handles daemon-side disconnect
  // for CLI sessions when selectSession(null) is called via onClose.
  const handleDetach = () => {
    onClose?.();
  };

  // ── Derived display values ────────────────────────────
  const sessionStatus = isStandaloneTerminal ? "active" : (sessionData?.status ?? "idle");
  const titleText = isStandaloneTerminal ? "Terminal" : (sessionData?.summary ?? sessionData?.title ?? sessionId!.slice(0, 8));
  const typeBadgeColor =
    isStandaloneTerminal ? "cyan"
    : resolvedSessionType === "copilot-cli"
      ? "teal"
      : "blue";
  const typeBadgeLabel =
    isStandaloneTerminal ? "PTY"
    : resolvedSessionType === "copilot-cli"
      ? "CLI"
      : "SDK";

  // ── Render ────────────────────────────────────────────
  return (
    <div
      data-testid="resizable-terminal-panel"
      style={{
        height: isMobile ? "100%" : height,
        display: "flex",
        flexDirection: "column",
        borderTop: "1px solid var(--lp-border)",
        background: "var(--lp-surface)",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* ── Drag handle ─────────────────────────────────── */}
      <div
        data-testid="drag-handle"
        onMouseDown={onDragStart}
        onTouchStart={onTouchStart}
        style={{
          height: isMobile ? 12 : 5,
          cursor: "row-resize",
          touchAction: "none",
          background: "var(--lp-border)",
          flexShrink: 0,
          transition: "background 0.15s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "var(--lp-accent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "var(--lp-border)";
        }}
      >
        {isMobile && (
          <div style={{
            width: 32,
            height: 4,
            borderRadius: 2,
            background: "var(--lp-text-secondary)",
            opacity: 0.5,
          }} />
        )}
      </div>

      {/* ── Header bar ──────────────────────────────────── */}
      <Group
        justify="space-between"
        px="sm"
        py={6}
        style={{
          borderBottom: "1px solid var(--lp-border)",
          flexShrink: 0,
        }}
      >
        <Group gap="xs" style={{ flex: 1, minWidth: 0 }}>
          <Tooltip label={isStandaloneTerminal ? "Standalone terminal" : (sessionData?.summary ?? sessionId)} openDelay={400}>
            <Text size="sm" fw={600} truncate style={{ color: "var(--lp-text)" }}>
              {isStandaloneTerminal ? "Terminal" : `Session — ${titleText}`}
            </Text>
          </Tooltip>
          <Badge size="xs" variant="outline" color={typeBadgeColor}>
            {typeBadgeLabel}
          </Badge>
        </Group>
        <Group gap={4} wrap="nowrap">
          {!isStandaloneTerminal && sessionData?.activity?.tokenUsage && (
            <Tooltip label="Token usage" withArrow>
              <Badge size="xs" variant="light" color="gray">
                🪙 {sessionData.activity.tokenUsage.used.toLocaleString()}
                {sessionData.activity.tokenUsage.limit ? ` / ${sessionData.activity.tokenUsage.limit.toLocaleString()}` : ""}
              </Badge>
            </Tooltip>
          )}
          <Badge
            size="xs"
            variant="dot"
            color={statusColor[sessionStatus] ?? "gray"}
          >
            {statusLabel[sessionStatus] ?? sessionStatus}
          </Badge>
          <Button.Group>
            <Tooltip label={isStandaloneTerminal ? "Close terminal" : "Minimize — session keeps running in background"}>
              <Button
                size="compact-xs"
                variant="default"
                onClick={handleDetach}
                data-testid="panel-detach"
                styles={{ root: { fontWeight: 500 } }}
              >
                {isStandaloneTerminal ? "Close ✕" : "Detach ↗"}
              </Button>
            </Tooltip>
            {!isStandaloneTerminal && (
              <Tooltip label={confirmingEnd ? "Click again to confirm" : "End session — stops the process"}>
                <Button
                  size="compact-xs"
                  variant={confirmingEnd ? "filled" : "light"}
                  color="red"
                  onClick={handleEndClick}
                  loading={endSession.isPending}
                  data-testid="panel-end-session"
                  styles={{ root: { fontWeight: 500 } }}
                >
                  {confirmingEnd ? "Confirm? ■" : "End ■"}
                </Button>
              </Tooltip>
            )}
          </Button.Group>
        </Group>
      </Group>

      {/* ── Body: Terminal or Conversation ───────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {isCliSession ? (
          <Terminal daemonId={daemonId} terminalId={isStandaloneTerminal ? undefined : (terminalId ?? sessionId)} onClose={handleDetach} />
        ) : (
          <CopilotConversation sessionId={sessionId!} sessionType={resolvedSessionType} onAgentChange={onAgentChange} />
        )}
      </div>
    </div>
  );
}
