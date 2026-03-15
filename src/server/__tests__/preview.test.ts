import { describe, it, expect, beforeEach, vi } from "vitest";
import { DaemonRegistry } from "../daemon-registry/registry.js";
import { DaemonWsHandler, type TokenLookup, type BrowserBroadcast } from "../daemon-registry/handler.js";
import type { DaemonInfo, PreviewProxyResponseMessage } from "../../shared/protocol.js";
import {
  resolvePreviewResponse,
  pendingRequests,
  forwardPreviewWsData,
  closePreviewWsChannel,
  wsChannels,
} from "../routes/preview.js";

/** Flush the microtask queue so async handling completes. */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

// --- Mock helpers ---

function createMockSocket() {
  const sent: string[] = [];
  let closeHandler: (() => void) | null = null;
  let messageHandler: ((data: string) => void) | null = null;
  let errorHandler: ((err: Error) => void) | null = null;
  return {
    sent,
    readyState: 1,
    OPEN: 1 as const,
    send(data: string) {
      sent.push(data);
    },
    close() {
      if (closeHandler) closeHandler();
    },
    terminate() {},
    ping() {},
    on(event: string, handler: (...args: unknown[]) => void) {
      if (event === "close") closeHandler = handler as () => void;
      if (event === "message") messageHandler = handler as (data: string) => void;
      if (event === "error") errorHandler = handler as (err: Error) => void;
    },
    simulateMessage(data: string) {
      if (messageHandler) messageHandler(data);
    },
    simulateClose() {
      if (closeHandler) closeHandler();
    },
  };
}

function createMockLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child() { return createMockLog(); },
    silent() {},
    level: "silent",
  };
}

function makeDaemonInfo(overrides?: Partial<DaemonInfo>): DaemonInfo {
  return {
    projectId: "owner/repo",
    projectName: "Test Project",
    runtimeTarget: "local",
    capabilities: ["terminal", "copilot"],
    version: "0.1.0",
    protocolVersion: "1.0.0" as DaemonInfo["protocolVersion"],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────
// Registry — preview fields
// ─────────────────────────────────────────────────────────

describe("DaemonRegistry — preview", () => {
  let registry: DaemonRegistry;

  beforeEach(() => {
    registry = new DaemonRegistry();
  });

  it("updatePreviewConfig sets preview fields on a tracked daemon", () => {
    const ws = createMockSocket() as never;
    const info = makeDaemonInfo();
    registry.register("d1", ws, info);

    registry.updatePreviewConfig("d1", 3000, true, "package-json");

    const daemon = registry.getDaemon("d1");
    expect(daemon?.previewPort).toBe(3000);
    expect(daemon?.previewAutoDetected).toBe(true);
    expect(daemon?.previewDetectedFrom).toBe("package-json");
  });

  it("updatePreviewConfig is a no-op for unknown daemon", () => {
    // Should not throw
    registry.updatePreviewConfig("unknown", 3000, false);
    expect(registry.getDaemon("unknown")).toBeUndefined();
  });

  it("preview fields appear in DaemonSummary", () => {
    const ws = createMockSocket() as never;
    registry.register("d1", ws, makeDaemonInfo());
    registry.updatePreviewConfig("d1", 5173, true, "config");

    const summaries = registry.getAllDaemons();
    expect(summaries[0]?.previewPort).toBe(5173);
    expect(summaries[0]?.previewAutoDetected).toBe(true);
    expect(summaries[0]?.previewDetectedFrom).toBe("config");
  });

  it("findDaemonByProjectId returns the matching daemon", () => {
    const ws = createMockSocket() as never;
    registry.register("d1", ws, makeDaemonInfo({ projectId: "owner/repo1" }));
    registry.register("d2", ws, makeDaemonInfo({ projectId: "owner/repo2" }));

    const found = registry.findDaemonByProjectId("owner/repo1");
    expect(found?.daemonId).toBe("d1");
  });

  it("findDaemonByProjectId returns undefined when not found", () => {
    const found = registry.findDaemonByProjectId("nonexistent");
    expect(found).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// Handler — preview message routing
// ─────────────────────────────────────────────────────────

describe("DaemonWsHandler — preview messages", () => {
  let registry: DaemonRegistry;
  let handler: DaemonWsHandler;
  let broadcasts: Array<{ channel: string; payload: unknown }>;

  beforeEach(() => {
    registry = new DaemonRegistry();
    broadcasts = [];
    const broadcast: BrowserBroadcast = (channel, payload) => {
      broadcasts.push({ channel, payload });
    };
    const tokenLookup: TokenLookup = () => "test-token";
    handler = new DaemonWsHandler(registry, tokenLookup, broadcast, createMockLog() as never);
  });

  async function connectAndRegister(projectId = "owner/repo") {
    const ws = createMockSocket();
    handler.handleConnection(ws as never);
    await tick();

    // Complete auth handshake
    const challenge = JSON.parse(ws.sent[0]!);
    ws.simulateMessage(JSON.stringify({
      type: "auth-response",
      timestamp: Date.now(),
      payload: { projectId, token: "test-token", nonce: challenge.payload.nonce },
    }));
    await tick();

    // Register
    ws.simulateMessage(JSON.stringify({
      type: "register",
      timestamp: Date.now(),
      payload: makeDaemonInfo({ projectId }),
    }));
    await tick();

    return ws;
  }

  it("routes preview-config and broadcasts to preview channel", async () => {
    const ws = await connectAndRegister("owner/repo");

    ws.simulateMessage(JSON.stringify({
      type: "preview-config",
      timestamp: Date.now(),
      payload: {
        projectId: "owner/repo",
        port: 3000,
        autoDetected: true,
        detectedFrom: "package-json",
      },
    }));
    await tick();

    // Check registry was updated
    const daemon = registry.findDaemonByProjectId("owner/repo");
    expect(daemon?.previewPort).toBe(3000);

    // Check broadcast
    const previewBroadcast = broadcasts.find((b) => b.channel === "preview");
    expect(previewBroadcast).toBeDefined();
    expect(previewBroadcast?.payload).toMatchObject({
      type: "preview:config",
      projectId: "owner/repo",
      port: 3000,
    });
  });

  it("routes preview-proxy-response to registry event", async () => {
    const ws = await connectAndRegister("owner/repo");

    const emitted: unknown[] = [];
    registry.on("preview:proxy-response" as never, (payload: unknown) => {
      emitted.push(payload);
    });

    ws.simulateMessage(JSON.stringify({
      type: "preview-proxy-response",
      timestamp: Date.now(),
      payload: {
        requestId: "req-123",
        statusCode: 200,
        headers: { "content-type": "text/html" },
        body: btoa("<html></html>"),
      },
    }));
    await tick();

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ requestId: "req-123", statusCode: 200 });
  });
});

// ─────────────────────────────────────────────────────────
// Request/Response matching
// ─────────────────────────────────────────────────────────

describe("resolvePreviewResponse", () => {
  beforeEach(() => {
    pendingRequests.clear();
  });

  it("resolves a pending request by requestId", async () => {
    const response: PreviewProxyResponseMessage["payload"] = {
      requestId: "r1",
      statusCode: 200,
      headers: { "content-type": "text/plain" },
      body: btoa("hello"),
    };

    const promise = new Promise<PreviewProxyResponseMessage["payload"]>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("timeout")), 5000);
      pendingRequests.set("r1", { resolve, reject, timeout });
    });

    resolvePreviewResponse("r1", response);

    const result = await promise;
    expect(result.statusCode).toBe(200);
    expect(pendingRequests.has("r1")).toBe(false);
  });

  it("is a no-op for unknown requestId", () => {
    // Should not throw
    resolvePreviewResponse("unknown", {
      requestId: "unknown",
      statusCode: 200,
      headers: {},
      body: "",
    });
  });

  it("times out after configured timeout", async () => {
    vi.useFakeTimers();

    const promise = new Promise<PreviewProxyResponseMessage["payload"]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete("r-timeout");
        reject(new Error("Preview proxy timeout"));
      }, 30_000);
      pendingRequests.set("r-timeout", { resolve, reject, timeout });
    });

    vi.advanceTimersByTime(30_001);

    await expect(promise).rejects.toThrow("Preview proxy timeout");
    expect(pendingRequests.has("r-timeout")).toBe(false);

    vi.useRealTimers();
  });
});

// ─────────────────────────────────────────────────────────
// WS relay helpers (Phase 3)
// ─────────────────────────────────────────────────────────

describe("Preview WS relay", () => {
  beforeEach(() => {
    wsChannels.clear();
  });

  it("forwardPreviewWsData sends decoded data to browser WS", () => {
    const sent: Buffer[] = [];
    const mockBrowserWs = {
      send: (data: Buffer) => sent.push(data),
      close: vi.fn(),
    };

    wsChannels.set("ch1", {
      browserWs: mockBrowserWs as never,
      daemonId: "d1",
    });

    forwardPreviewWsData("ch1", btoa("hello world"));

    expect(sent).toHaveLength(1);
    expect(sent[0]!.toString()).toBe("hello world");
  });

  it("forwardPreviewWsData is a no-op for unknown channel", () => {
    // Should not throw
    forwardPreviewWsData("unknown", btoa("data"));
  });

  it("closePreviewWsChannel closes browser WS and cleans up", () => {
    const mockBrowserWs = {
      send: vi.fn(),
      close: vi.fn(),
    };
    wsChannels.set("ch1", {
      browserWs: mockBrowserWs as never,
      daemonId: "d1",
    });

    closePreviewWsChannel("ch1", 1000, "done");

    expect(mockBrowserWs.close).toHaveBeenCalledWith(1000, "done");
    expect(wsChannels.has("ch1")).toBe(false);
  });

  it("closePreviewWsChannel uses defaults when code/reason omitted", () => {
    const mockBrowserWs = {
      send: vi.fn(),
      close: vi.fn(),
    };
    wsChannels.set("ch2", {
      browserWs: mockBrowserWs as never,
      daemonId: "d1",
    });

    closePreviewWsChannel("ch2");

    expect(mockBrowserWs.close).toHaveBeenCalledWith(1000, "");
    expect(wsChannels.has("ch2")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────
// QR code generation (unit-level)
// ─────────────────────────────────────────────────────────

describe("QR code generation", () => {
  it("QRCode.toDataURL produces a valid data URI", async () => {
    const QRCode = await import("qrcode");
    const url = "https://example.com/preview/owner%2Frepo/";
    const dataUrl = await QRCode.toDataURL(url);
    expect(dataUrl).toMatch(/^data:image\/png;base64,/);
  });
});
