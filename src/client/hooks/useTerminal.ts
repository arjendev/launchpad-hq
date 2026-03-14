/**
 * Hook for managing a terminal WebSocket session.
 *
 * Handles join/leave lifecycle, input forwarding, resize,
 * and data/exit event subscriptions via the existing WS channel.
 */

import { useCallback, useEffect, useRef } from "react";
import { useWebSocket } from "../contexts/WebSocketContext.js";
import type { UpdateMessage } from "../services/ws-types.js";
import type { TerminalDataPayload, TerminalExitPayload } from "../services/ws-types.js";

export interface UseTerminalOptions {
  daemonId: string;
  terminalId: string;
  onData?: (data: string) => void;
  onExit?: (exitCode: number) => void;
}

export interface UseTerminalReturn {
  sendInput: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
}

export function useTerminal({
  daemonId,
  terminalId,
  onData,
  onExit,
}: UseTerminalOptions): UseTerminalReturn {
  const { subscribe, send } = useWebSocket();

  // Keep callbacks in refs to avoid re-subscribing on every render
  const onDataRef = useRef(onData);
  const onExitRef = useRef(onExit);
  onDataRef.current = onData;
  onExitRef.current = onExit;

  // Join/leave the terminal session and subscribe to terminal channel
  useEffect(() => {
    if (!daemonId || !terminalId) return;

    send({ type: "terminal:join", daemonId, terminalId });

    const unsub = subscribe("terminal", (msg: UpdateMessage) => {
      const payload = msg.payload as TerminalDataPayload | TerminalExitPayload;

      if (payload.type === "terminal:data") {
        const dp = payload as TerminalDataPayload;
        if (dp.terminalId === terminalId) {
          onDataRef.current?.(dp.data);
        }
      } else if (payload.type === "terminal:exit") {
        const ep = payload as TerminalExitPayload;
        if (ep.terminalId === terminalId) {
          onExitRef.current?.(ep.exitCode);
        }
      }
    });

    return () => {
      unsub();
      send({ type: "terminal:leave", daemonId, terminalId });
    };
  }, [daemonId, terminalId, subscribe, send]);

  const sendInput = useCallback(
    (data: string) => {
      send({ type: "terminal:input", daemonId, terminalId, data });
    },
    [daemonId, terminalId, send],
  );

  const sendResize = useCallback(
    (cols: number, rows: number) => {
      send({ type: "terminal:resize", daemonId, terminalId, cols, rows });
    },
    [daemonId, terminalId, send],
  );

  return { sendInput, sendResize };
}
