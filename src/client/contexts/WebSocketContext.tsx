import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  WebSocketManager,
  type MessageHandler,
} from "../services/ws.js";
import type {
  Channel,
  ConnectionStatus,
  ServerMessage,
} from "../services/ws-types.js";

// --- Context shape ---

interface WebSocketContextValue {
  /** Current connection status. */
  status: ConnectionStatus;
  /** Subscribe to a channel with a handler. Returns unsubscribe function. */
  subscribe: (channel: Channel, handler: MessageHandler) => () => void;
  /** Send a raw client message. */
  send: WebSocketManager["send"];
  /** Listen to all server messages. */
  onMessage: (handler: (msg: ServerMessage) => void) => () => void;
  /** The underlying manager instance (escape hatch). */
  manager: WebSocketManager;
}

const WebSocketContext = createContext<WebSocketContextValue | null>(null);

// --- Provider ---

interface WebSocketProviderProps {
  children: ReactNode;
  /** Override the WS URL (mainly for testing). */
  url?: string;
}

export function WebSocketProvider({ children, url }: WebSocketProviderProps) {
  const managerRef = useRef<WebSocketManager | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");

  // Create and connect the manager once
  if (!managerRef.current) {
    managerRef.current = new WebSocketManager(url ? { url } : undefined);
  }

  useEffect(() => {
    const mgr = managerRef.current!;
    const unsub = mgr.onStatusChange(setStatus);
    mgr.connect();

    return () => {
      unsub();
      mgr.dispose();
      managerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WebSocketContextValue>(() => {
    const mgr = managerRef.current!;
    return {
      status,
      subscribe: mgr.subscribe.bind(mgr),
      send: mgr.send.bind(mgr),
      onMessage: mgr.onMessage.bind(mgr),
      manager: mgr,
    };
  }, [status]);

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}

// --- Hooks ---

/** Access the WebSocket connection. Must be used within WebSocketProvider. */
export function useWebSocket(): WebSocketContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used within a WebSocketProvider");
  }
  return ctx;
}

/**
 * Subscribe to a WebSocket channel. Re-subscribes automatically on reconnect.
 * Returns the latest message received on that channel (or null).
 */
export function useSubscription<T = unknown>(channel: Channel): {
  data: T | null;
  status: ConnectionStatus;
} {
  const { subscribe, status } = useWebSocket();
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const unsub = subscribe(channel, (msg) => {
      setData(msg.payload as T);
    });
    return unsub;
  }, [channel, subscribe]);

  return { data, status };
}
