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

  // Ensure a live (non-disposed) manager exists.  Called during render and
  // inside the effect so React 18 Strict Mode's unmount → remount cycle
  // always has a fresh manager after cleanup nulled the ref.
  function getOrCreateManager(): WebSocketManager {
    if (!managerRef.current) {
      managerRef.current = new WebSocketManager(url ? { url } : undefined);
    }
    return managerRef.current;
  }

  // Populate the ref synchronously so the first render has a manager.
  getOrCreateManager();

  useEffect(() => {
    const mgr = getOrCreateManager();
    const unsub = mgr.onStatusChange(setStatus);
    mgr.connect();

    return () => {
      unsub();
      mgr.dispose();
      managerRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<WebSocketContextValue>(() => {
    const mgr = getOrCreateManager();
    return {
      status,
      subscribe: mgr.subscribe.bind(mgr),
      send: mgr.send.bind(mgr),
      onMessage: mgr.onMessage.bind(mgr),
      manager: mgr,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
