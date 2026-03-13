import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createTestServer, type FastifyInstance } from "../../../test-utils/server.js";
import websocket from "../../ws/plugin.js";
import daemonRegistryPlugin from "../../daemon-registry/plugin.js";
import copilotAggregatorPlugin from "../plugin.js";
import type { CopilotSessionAggregator } from "../aggregator.js";

describe("Copilot aggregator plugin", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createTestServer();
    await server.register(websocket);
    await server.register(daemonRegistryPlugin);
    await server.register(copilotAggregatorPlugin);
  });

  afterEach(async () => {
    await server.close();
  });

  it("decorates fastify with copilotAggregator", () => {
    expect(server.copilotAggregator).toBeDefined();
    expect(typeof server.copilotAggregator.getAllSessions).toBe("function");
    expect(typeof server.copilotAggregator.updateSessions).toBe("function");
    expect(typeof server.copilotAggregator.removeDaemon).toBe("function");
  });

  it("routes copilot:session-update events from registry to aggregator", () => {
    const updateSpy = vi.spyOn(server.copilotAggregator, "updateSessions");

    const payload = {
      projectId: "proj-1",
      session: {
        sessionId: "s1",
        state: "active" as const,
        startedAt: 1000,
        lastActivityAt: 2000,
      },
    };

    server.daemonRegistry.emit("copilot:session-update" as never, "d1", payload);

    expect(updateSpy).toHaveBeenCalledWith("d1", "proj-1", [payload.session]);
  });

  it("routes copilot:session-list events from registry to aggregator", () => {
    const updateSpy = vi.spyOn(server.copilotAggregator, "updateSessions");

    const payload = {
      projectId: "proj-1",
      sessions: [
        { sessionId: "s1", state: "active" as const, startedAt: 1000, lastActivityAt: 2000 },
        { sessionId: "s2", state: "idle" as const, startedAt: 1000, lastActivityAt: 3000 },
      ],
    };

    server.daemonRegistry.emit("copilot:session-list" as never, "d1", payload);

    expect(updateSpy).toHaveBeenCalledWith("d1", "proj-1", payload.sessions);
  });

  it("routes copilot:session-event to aggregator", () => {
    const eventSpy = vi.spyOn(server.copilotAggregator, "handleSessionEvent");

    const payload = {
      projectId: "proj-1",
      sessionId: "s1",
      event: { type: "session.idle" as const, data: {}, timestamp: 5000 },
    };

    server.daemonRegistry.emit("copilot:session-event" as never, "d1", payload);

    expect(eventSpy).toHaveBeenCalledWith("d1", "s1", payload.event);
  });

  it("routes copilot:sdk-state to aggregator", () => {
    const stateSpy = vi.spyOn(server.copilotAggregator, "handleSdkStateChange");

    const payload = {
      projectId: "proj-1",
      state: "connected" as const,
    };

    server.daemonRegistry.emit("copilot:sdk-state" as never, "d1", payload);

    expect(stateSpy).toHaveBeenCalledWith("d1", "connected", undefined);
  });

  it("routes copilot:conversation to aggregator", () => {
    const appendSpy = vi.spyOn(server.copilotAggregator, "appendMessages");

    const payload = {
      sessionId: "s1",
      messages: [
        { role: "user" as const, content: "hello", timestamp: 1000 },
      ],
    };

    server.daemonRegistry.emit("copilot:conversation" as never, "d1", payload);

    expect(appendSpy).toHaveBeenCalledWith("s1", payload.messages);
  });

  it("cleans up sessions when daemon disconnects", () => {
    // Seed sessions for daemon d1
    server.copilotAggregator.updateSessions("d1", "proj-1", [
      { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
    ]);

    expect(server.copilotAggregator.size).toBe(1);

    // Simulate disconnect event
    server.daemonRegistry.emit("daemon:disconnected", {
      daemonId: "d1",
      projectId: "proj-1",
      projectName: "test",
      runtimeTarget: "local",
      state: "disconnected",
      connectedAt: 1000,
      lastHeartbeat: 2000,
      version: "1.0.0",
      capabilities: [],
    });

    expect(server.copilotAggregator.size).toBe(0);
  });

  it("broadcasts sessions-updated to copilot channel", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.updateSessions("d1", "proj-1", [
      { sessionId: "s1", state: "active", startedAt: 1000, lastActivityAt: 2000 },
    ]);

    expect(broadcastSpy).toHaveBeenCalledWith("copilot", expect.objectContaining({
      type: "copilot:sessions-updated",
      sessions: expect.any(Array),
    }));
  });

  it("broadcasts session-event to copilot channel", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleSessionEvent("d1", "s1", {
      type: "session.start",
      timestamp: 5000,
      data: {},
    });

    expect(broadcastSpy).toHaveBeenCalledWith("copilot", expect.objectContaining({
      type: "copilot:session-event",
      sessionId: "s1",
    }));
  });

  it("broadcasts sdk-state-changed to copilot channel", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleSdkStateChange("d1", "disconnected");

    expect(broadcastSpy).toHaveBeenCalledWith("copilot", expect.objectContaining({
      type: "copilot:sdk-state-changed",
      daemonId: "d1",
      state: "disconnected",
    }));
  });

  it("routes copilot:tool-invocation events from registry to aggregator", () => {
    const invocationSpy = vi.spyOn(server.copilotAggregator, "handleToolInvocation");

    const payload = {
      sessionId: "s1",
      projectId: "proj-1",
      tool: "report_progress" as const,
      args: { status: "working", summary: "On it" },
      timestamp: 5000,
    };

    server.daemonRegistry.emit("copilot:tool-invocation" as never, "d1", payload);

    expect(invocationSpy).toHaveBeenCalledWith("s1", "proj-1", "report_progress", payload.args, 5000);
  });

  it("broadcasts tool-invocation to copilot channel", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working", summary: "hi" }, 5000);

    expect(broadcastSpy).toHaveBeenCalledWith("copilot", expect.objectContaining({
      type: "copilot:tool-invocation",
      tool: "report_progress",
      sessionId: "s1",
    }));
  });

  it("broadcasts attention event for request_human_review", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleToolInvocation("s1", "proj-1", "request_human_review", { reason: "Need help", urgency: "high" }, 5000);

    expect(broadcastSpy).toHaveBeenCalledWith("attention", expect.objectContaining({
      type: "attention:copilot-tool",
      tool: "request_human_review",
      sessionId: "s1",
    }));
  });

  it("broadcasts attention event for report_blocker", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleToolInvocation("s1", "proj-1", "report_blocker", { blocker: "Cannot connect" }, 5000);

    expect(broadcastSpy).toHaveBeenCalledWith("attention", expect.objectContaining({
      type: "attention:copilot-tool",
      tool: "report_blocker",
    }));
  });

  it("does not broadcast attention event for report_progress", () => {
    const broadcastSpy = vi.spyOn(server.ws, "broadcast");

    server.copilotAggregator.handleToolInvocation("s1", "proj-1", "report_progress", { status: "working", summary: "hi" }, 5000);

    const attentionCalls = broadcastSpy.mock.calls.filter(
      (call) => call[0] === "attention",
    );
    expect(attentionCalls).toHaveLength(0);
  });
});
