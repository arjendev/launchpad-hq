/**
 * Resizable bottom panel that hosts either a Terminal (CLI sessions)
 * or a CopilotConversation (SDK / Squad sessions).
 *
 * VS Code–style horizontal split: drag the top handle to resize.
 * Wraps the existing Terminal component without modifying it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import { Terminal } from "./Terminal.js";
import { CopilotConversation } from "./CopilotConversation.js";
import { useAggregatedSession, useEndSession } from "../services/hooks.js";

// ── Props ──────────────────────────────────────────────

export interface ResizableTerminalPanelProps {
  /** Daemon to connect the terminal to. */
  daemonId: string;
  /** Existing terminal id (for resuming CLI sessions). */
  terminalId?: string;
  /** Session id for data lookup. */
  sessionId: string;
  /** Session type — "copilot-cli" renders a terminal; anything else renders a conversation. */
  sessionType?: string;
  /** Called when the user detaches (minimizes) the panel. */
  onClose?: () => void;
  /** Initial panel height in pixels. @default 300 */
  defaultHeight?: number;
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
}: ResizableTerminalPanelProps) {
  const { data: sessionData } = useAggregatedSession(sessionId);
  const endSession = useEndSession();

  // Resolve session type (prop wins, query fallback)
  const resolvedSessionType = propSessionType ?? sessionData?.sessionType;
  const isCliSession = resolvedSessionType === "copilot-cli";

  // ── Resize state ──────────────────────────────────────
  const [height, setHeight] = useState(defaultHeight);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startH = useRef(0);

  const onDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      startY.current = e.clientY;
      startH.current = height;
    },
    [height],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      // Dragging handle up → clientY decreases → panel grows
      const delta = startY.current - e.clientY;
      const maxH = window.innerHeight * 0.85;
      setHeight(Math.min(maxH, Math.max(minHeight, startH.current + delta)));
    };

    const onUp = () => {
      dragging.current = false;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [minHeight]);

  // ── End-session confirm pattern ───────────────────────
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout>>();

  const handleEndClick = () => {
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
  const handleDetach = () => {
    if (isCliSession && sessionId) {
      fetch(`/api/copilot/aggregated/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
        method: "POST",
      }).catch(() => {});
    }
    onClose?.();
  };

  // ── Derived display values ────────────────────────────
  const sessionStatus = sessionData?.status ?? "idle";
  const titleText = sessionData?.summary ?? sessionData?.title ?? sessionId.slice(0, 8);
  const typeBadgeColor =
    resolvedSessionType === "copilot-cli"
      ? "teal"
      : resolvedSessionType === "squad-sdk"
        ? "violet"
        : "blue";
  const typeBadgeLabel =
    resolvedSessionType === "copilot-cli"
      ? "CLI"
      : resolvedSessionType === "squad-sdk"
        ? "Squad"
        : "SDK";

  // ── Render ────────────────────────────────────────────
  return (
    <div
      data-testid="resizable-terminal-panel"
      style={{
        height,
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
        style={{
          height: 5,
          cursor: "row-resize",
          background: "var(--lp-border)",
          flexShrink: 0,
          transition: "background 0.15s ease",
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "var(--lp-accent)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.background = "var(--lp-border)";
        }}
      />

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
          <Tooltip label={sessionData?.summary ?? sessionId} openDelay={400}>
            <Text size="sm" fw={600} truncate style={{ color: "var(--lp-text)" }}>
              Session — {titleText}
            </Text>
          </Tooltip>
          {resolvedSessionType && (
            <Badge size="xs" variant="outline" color={typeBadgeColor}>
              {typeBadgeLabel}
            </Badge>
          )}
        </Group>
        <Group gap={4} wrap="nowrap">
          <Badge
            size="xs"
            variant="dot"
            color={statusColor[sessionStatus] ?? "gray"}
          >
            {statusLabel[sessionStatus] ?? sessionStatus}
          </Badge>
          <Button.Group>
            <Tooltip label="Minimize — session keeps running in background">
              <Button
                size="compact-xs"
                variant="default"
                onClick={handleDetach}
                data-testid="panel-detach"
                styles={{ root: { fontWeight: 500 } }}
              >
                Detach ↗
              </Button>
            </Tooltip>
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
          </Button.Group>
        </Group>
      </Group>

      {/* ── Body: Terminal or Conversation ───────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {isCliSession ? (
          <Terminal daemonId={daemonId} terminalId={terminalId ?? sessionId} onClose={handleDetach} />
        ) : (
          <CopilotConversation sessionId={sessionId} sessionType={resolvedSessionType} />
        )}
      </div>
    </div>
  );
}
