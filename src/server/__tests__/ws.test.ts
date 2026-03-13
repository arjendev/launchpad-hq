import { describe, it, expect, beforeEach } from "vitest";
import { ConnectionManager } from "../ws/connections.js";
import { handleMessage } from "../ws/handler.js";
import { VALID_CHANNELS } from "../ws/types.js";
import type { ServerMessage } from "../ws/types.js";

// --- Minimal WebSocket stub for unit tests ---

function createMockSocket() {
  const sent: string[] = [];
  return {
    sent,
    readyState: 1, // OPEN
    OPEN: 1 as const,
    send(data: string) {
      sent.push(data);
    },
    ping() {},
    terminate() {},
    on() {},
  };
}

function createMockLog() {
  return {
    info() {},
    debug() {},
    warn() {},
    error() {},
    fatal() {},
    trace() {},
    child() {
      return createMockLog();
    },
    silent() {},
    level: "silent",
  };
}

// --- ConnectionManager tests ---

describe("ConnectionManager", () => {
  let manager: ConnectionManager;

  beforeEach(() => {
    manager = new ConnectionManager();
  });

  it("adds and removes clients", () => {
    const ws = createMockSocket();
    const id = manager.add(ws as never);

    expect(manager.size).toBe(1);
    expect(manager.get(id)).toBeDefined();

    manager.remove(id);
    expect(manager.size).toBe(0);
    expect(manager.get(id)).toBeUndefined();
  });

  it("subscribes and unsubscribes from channels", () => {
    const ws = createMockSocket();
    const id = manager.add(ws as never);

    expect(manager.subscribe(id, "daemon")).toBe(true);
    expect(manager.subscriptions(id).has("daemon")).toBe(true);

    expect(manager.unsubscribe(id, "daemon")).toBe(true);
    expect(manager.subscriptions(id).has("daemon")).toBe(false);
  });

  it("returns false for subscribe/unsubscribe on unknown client", () => {
    expect(manager.subscribe("ghost", "copilot")).toBe(false);
    expect(manager.unsubscribe("ghost", "copilot")).toBe(false);
  });

  it("broadcasts to subscribers only", () => {
    const ws1 = createMockSocket();
    const ws2 = createMockSocket();
    const ws3 = createMockSocket();

    const id1 = manager.add(ws1 as never);
    const id2 = manager.add(ws2 as never);
    manager.add(ws3 as never); // not subscribed

    manager.subscribe(id1, "copilot");
    manager.subscribe(id2, "copilot");

    manager.broadcast("copilot", { status: "active" });

    expect(ws1.sent).toHaveLength(1);
    expect(ws2.sent).toHaveLength(1);
    expect(ws3.sent).toHaveLength(0);

    const msg: ServerMessage = JSON.parse(ws1.sent[0]);
    expect(msg.type).toBe("update");
    expect(msg).toHaveProperty("channel", "copilot");
    expect(msg).toHaveProperty("payload", { status: "active" });
  });

  it("send returns false for missing client", () => {
    expect(manager.send("ghost", { type: "pong" })).toBe(false);
  });

  it("send delivers to a specific client", () => {
    const ws = createMockSocket();
    const id = manager.add(ws as never);

    expect(manager.send(id, { type: "pong" })).toBe(true);
    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "pong" });
  });
});

// --- Message handler tests ---

describe("handleMessage", () => {
  let manager: ConnectionManager;
  let clientId: string;
  let ws: ReturnType<typeof createMockSocket>;
  const log = createMockLog() as never;

  beforeEach(() => {
    manager = new ConnectionManager();
    ws = createMockSocket();
    clientId = manager.add(ws as never);
  });

  it("responds to ping with pong", () => {
    handleMessage(clientId, JSON.stringify({ type: "ping" }), manager, log);

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({ type: "pong" });
  });

  it("subscribes to a valid channel", () => {
    handleMessage(clientId, JSON.stringify({ type: "subscribe", channel: "terminal" }), manager, log);

    expect(manager.subscriptions(clientId).has("terminal")).toBe(true);
    // No error sent
    expect(ws.sent).toHaveLength(0);
  });

  it("unsubscribes from a valid channel", () => {
    manager.subscribe(clientId, "terminal");
    handleMessage(clientId, JSON.stringify({ type: "unsubscribe", channel: "terminal" }), manager, log);

    expect(manager.subscriptions(clientId).has("terminal")).toBe(false);
  });

  it("returns error for invalid JSON", () => {
    handleMessage(clientId, "not json!!!", manager, log);

    expect(ws.sent).toHaveLength(1);
    const msg: ServerMessage = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe("error");
  });

  it("returns error for missing type field", () => {
    handleMessage(clientId, JSON.stringify({ channel: "copilot" }), manager, log);

    expect(ws.sent).toHaveLength(1);
    const msg: ServerMessage = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe("error");
    expect(msg).toHaveProperty("message", "Missing 'type' field");
  });

  it("returns error for unknown channel", () => {
    handleMessage(clientId, JSON.stringify({ type: "subscribe", channel: "nope" }), manager, log);

    expect(ws.sent).toHaveLength(1);
    const msg: ServerMessage = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe("error");
    expect((msg as { message: string }).message).toContain("Unknown channel");
  });

  it("returns error for unknown message type", () => {
    handleMessage(clientId, JSON.stringify({ type: "explode" }), manager, log);

    expect(ws.sent).toHaveLength(1);
    const msg: ServerMessage = JSON.parse(ws.sent[0]);
    expect(msg.type).toBe("error");
    expect((msg as { message: string }).message).toContain("Unknown message type");
  });
});

// --- Channel constants ---

describe("VALID_CHANNELS", () => {
  it("contains the expected channels", () => {
    expect(VALID_CHANNELS.has("daemon")).toBe(true);
    expect(VALID_CHANNELS.has("copilot")).toBe(true);
    expect(VALID_CHANNELS.has("terminal")).toBe(true);
    expect(VALID_CHANNELS.has("devcontainer")).toBe(false);
    expect(VALID_CHANNELS.has("unknown")).toBe(false);
  });
});
