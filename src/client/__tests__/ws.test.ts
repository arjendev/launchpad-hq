import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WebSocketManager } from "../services/ws.js";
import type { ConnectionStatus, ServerMessage } from "../services/ws-types.js";

// --- Mock WebSocket ---

type WSHandler = ((event: { data: string }) => void) | (() => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: WSHandler = null;
  onclose: WSHandler = null;
  onerror: WSHandler = null;
  onmessage: ((event: { data: string }) => void) | null = null;

  sent: string[] = [];

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) (this.onclose as () => void)();
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) (this.onopen as () => void)();
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) (this.onclose as () => void)();
  }

  simulateMessage(data: ServerMessage) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(data) });
  }

  simulateError() {
    if (this.onerror) (this.onerror as () => void)();
  }
}

let mockInstances: MockWebSocket[] = [];

function getLatestMock(): MockWebSocket {
  return mockInstances[mockInstances.length - 1];
}

beforeEach(() => {
  mockInstances = [];
  vi.useFakeTimers();
  vi.stubGlobal(
    "WebSocket",
    Object.assign(
      function MockWSConstructor(this: MockWebSocket, ..._args: unknown[]) {
        const instance = new MockWebSocket();
        mockInstances.push(instance);
        return instance;
      },
      { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 },
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WebSocketManager", () => {
  describe("connection lifecycle", () => {
    it("connects and reports connected status", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      const statuses: ConnectionStatus[] = [];
      mgr.onStatusChange((s) => statuses.push(s));

      mgr.connect();
      expect(statuses).toContain("connecting");

      getLatestMock().simulateOpen();
      expect(statuses).toContain("connected");
      expect(mgr.status).toBe("connected");

      mgr.dispose();
    });

    it("transitions to reconnecting on close", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 100 });
      const statuses: ConnectionStatus[] = [];
      mgr.onStatusChange((s) => statuses.push(s));

      mgr.connect();
      getLatestMock().simulateOpen();
      getLatestMock().simulateClose();

      expect(statuses).toContain("reconnecting");
      expect(mgr.status).toBe("reconnecting");

      mgr.dispose();
    });

    it("disposes cleanly and reports disconnected", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      mgr.dispose();
      expect(mgr.status).toBe("disconnected");
    });

    it("does not reconnect after dispose", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 100 });
      mgr.connect();
      getLatestMock().simulateOpen();
      mgr.dispose();

      const countBefore = mockInstances.length;
      vi.advanceTimersByTime(10_000);
      expect(mockInstances.length).toBe(countBefore);
    });
  });

  describe("exponential backoff", () => {
    it("increases delay: 1s, 2s, 4s", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 1000, maxReconnectDelay: 30000 });
      mgr.connect();
      getLatestMock().simulateOpen();

      // First disconnect → 1s backoff
      getLatestMock().simulateClose();
      expect(mockInstances.length).toBe(1);
      vi.advanceTimersByTime(999);
      expect(mockInstances.length).toBe(1);
      vi.advanceTimersByTime(1);
      expect(mockInstances.length).toBe(2);

      // Second disconnect → 2s backoff
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(1999);
      expect(mockInstances.length).toBe(2);
      vi.advanceTimersByTime(1);
      expect(mockInstances.length).toBe(3);

      // Third disconnect → 4s backoff
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(3999);
      expect(mockInstances.length).toBe(3);
      vi.advanceTimersByTime(1);
      expect(mockInstances.length).toBe(4);

      mgr.dispose();
    });

    it("caps at maxReconnectDelay", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 1000, maxReconnectDelay: 5000 });
      mgr.connect();
      getLatestMock().simulateOpen();

      // Disconnect without reconnecting successfully to accumulate backoff
      // Attempt 0: 1s, Attempt 1: 2s, Attempt 2: 4s, Attempt 3: 8s→capped to 5s
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(1000); // attempt 0 → 1s
      getLatestMock().simulateClose(); // fail again immediately
      vi.advanceTimersByTime(2000); // attempt 1 → 2s
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(4000); // attempt 2 → 4s
      getLatestMock().simulateClose();

      // Next attempt should be capped at 5s (not 8s)
      const countBefore = mockInstances.length;
      vi.advanceTimersByTime(4999);
      expect(mockInstances.length).toBe(countBefore);
      vi.advanceTimersByTime(1);
      expect(mockInstances.length).toBe(countBefore + 1);

      mgr.dispose();
    });

    it("resets backoff after successful connection", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 1000 });
      mgr.connect();
      getLatestMock().simulateOpen();

      // Disconnect twice to bump backoff to 2s
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(1000);
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(2000);

      // Now connect successfully — should reset
      getLatestMock().simulateOpen();
      getLatestMock().simulateClose();

      // Should be back to 1s (not 4s)
      const countBefore = mockInstances.length;
      vi.advanceTimersByTime(999);
      expect(mockInstances.length).toBe(countBefore);
      vi.advanceTimersByTime(1);
      expect(mockInstances.length).toBe(countBefore + 1);

      mgr.dispose();
    });
  });

  describe("channel subscriptions", () => {
    it("sends subscribe message to server", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      mgr.subscribe("daemon", vi.fn());
      const sent = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(sent).toContainEqual({ type: "subscribe", channel: "daemon" });

      mgr.dispose();
    });

    it("delivers update messages to channel handlers", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const handler = vi.fn();
      mgr.subscribe("copilot", handler);

      getLatestMock().simulateMessage({
        type: "update",
        channel: "copilot",
        payload: { session: "abc" },
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({
        type: "update",
        channel: "copilot",
        payload: { session: "abc" },
      });

      mgr.dispose();
    });

    it("does not deliver messages for other channels", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const handler = vi.fn();
      mgr.subscribe("terminal", handler);

      getLatestMock().simulateMessage({
        type: "update",
        channel: "copilot",
        payload: {},
      });

      expect(handler).not.toHaveBeenCalled();

      mgr.dispose();
    });

    it("unsubscribes and sends unsubscribe message when last handler removed", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const unsub = mgr.subscribe("daemon", vi.fn());
      getLatestMock().sent = []; // clear subscribe message

      unsub();

      const sent = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(sent).toContainEqual({ type: "unsubscribe", channel: "daemon" });
      expect(mgr.getSubscriptions().has("daemon")).toBe(false);

      mgr.dispose();
    });

    it("re-subscribes to all channels on reconnect", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", reconnectDelay: 100 });
      mgr.connect();
      getLatestMock().simulateOpen();

      mgr.subscribe("daemon", vi.fn());
      mgr.subscribe("copilot", vi.fn());

      // Disconnect and reconnect
      getLatestMock().simulateClose();
      vi.advanceTimersByTime(100);
      getLatestMock().simulateOpen();

      const sent = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(sent).toContainEqual({ type: "subscribe", channel: "daemon" });
      expect(sent).toContainEqual({ type: "subscribe", channel: "copilot" });

      mgr.dispose();
    });
  });

  describe("message queuing", () => {
    it("queues messages sent while disconnected", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      // Not yet open — messages should queue
      mgr.send({ type: "ping" });
      mgr.send({ type: "subscribe", channel: "terminal" });

      expect(getLatestMock().sent.length).toBe(0);

      getLatestMock().simulateOpen();

      // subscribe messages from resubscribe + flushed queue
      const sent = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(sent).toContainEqual({ type: "ping" });
      expect(sent).toContainEqual({ type: "subscribe", channel: "terminal" });

      mgr.dispose();
    });

    it("respects maxQueueSize", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", maxQueueSize: 2 });
      mgr.connect();

      mgr.send({ type: "ping" });
      mgr.send({ type: "ping" });
      mgr.send({ type: "ping" }); // should be dropped

      getLatestMock().simulateOpen();

      // Only 2 pings should have been sent
      const pings = getLatestMock().sent
        .map((s) => JSON.parse(s))
        .filter((m: { type: string }) => m.type === "ping");
      expect(pings.length).toBe(2);

      mgr.dispose();
    });
  });

  describe("ping keep-alive", () => {
    it("sends periodic pings when connected", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", pingInterval: 5000 });
      mgr.connect();
      getLatestMock().simulateOpen();
      getLatestMock().sent = []; // clear subscribe messages

      vi.advanceTimersByTime(5000);
      const pings = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(pings).toContainEqual({ type: "ping" });

      mgr.dispose();
    });

    it("stops pings after disconnect", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", pingInterval: 5000 });
      mgr.connect();
      getLatestMock().simulateOpen();
      getLatestMock().simulateClose();

      getLatestMock().sent = [];
      vi.advanceTimersByTime(10_000);
      // No pings should have been sent to the old socket
      expect(getLatestMock().sent.length).toBe(0);

      mgr.dispose();
    });
  });

  describe("pong handling", () => {
    it("pong message does not trigger channel handlers", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const channelHandler = vi.fn();
      mgr.subscribe("daemon", channelHandler);

      // Server sends a pong — should NOT go to channel handlers
      getLatestMock().simulateMessage({ type: "pong" });

      expect(channelHandler).not.toHaveBeenCalled();

      mgr.dispose();
    });

    it("pong message triggers global message listeners", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const globalListener = vi.fn();
      mgr.onMessage(globalListener);

      getLatestMock().simulateMessage({ type: "pong" });

      expect(globalListener).toHaveBeenCalledTimes(1);
      expect(globalListener).toHaveBeenCalledWith({ type: "pong" });

      mgr.dispose();
    });

    it("multiple pong responses are each delivered to listeners", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const globalListener = vi.fn();
      mgr.onMessage(globalListener);

      getLatestMock().simulateMessage({ type: "pong" });
      getLatestMock().simulateMessage({ type: "pong" });
      getLatestMock().simulateMessage({ type: "pong" });

      expect(globalListener).toHaveBeenCalledTimes(3);

      mgr.dispose();
    });

    it("ping-pong round trip: client sends ping, server responds with pong", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws", pingInterval: 5000 });
      mgr.connect();
      getLatestMock().simulateOpen();
      getLatestMock().sent = [];

      const pongReceived = vi.fn();
      mgr.onMessage((msg) => {
        if (msg.type === "pong") pongReceived();
      });

      // Advance time to trigger a ping
      vi.advanceTimersByTime(5000);
      const pings = getLatestMock().sent.map((s) => JSON.parse(s));
      expect(pings).toContainEqual({ type: "ping" });

      // Simulate server responding with pong
      getLatestMock().simulateMessage({ type: "pong" });
      expect(pongReceived).toHaveBeenCalledTimes(1);

      mgr.dispose();
    });

    it("pong received after dispose does not throw", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      const mock = getLatestMock();
      mock.simulateOpen();

      mgr.dispose();

      // Simulate a late pong arriving after dispose — should not throw
      expect(() => {
        mock.simulateMessage({ type: "pong" });
      }).not.toThrow();
    });
  });

  describe("global message listeners", () => {
    it("notifies listeners of all message types", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const listener = vi.fn();
      mgr.onMessage(listener);

      getLatestMock().simulateMessage({ type: "pong" });
      getLatestMock().simulateMessage({ type: "error", message: "bad" });

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener).toHaveBeenCalledWith({ type: "pong" });
      expect(listener).toHaveBeenCalledWith({ type: "error", message: "bad" });

      mgr.dispose();
    });

    it("can unsubscribe global listeners", () => {
      const mgr = new WebSocketManager({ url: "ws://test/ws" });
      mgr.connect();
      getLatestMock().simulateOpen();

      const listener = vi.fn();
      const unsub = mgr.onMessage(listener);
      unsub();

      getLatestMock().simulateMessage({ type: "pong" });
      expect(listener).not.toHaveBeenCalled();

      mgr.dispose();
    });
  });
});
