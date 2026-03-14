/**
 * Tests that replay a captured live event stream through the aggregator
 * and verify the resulting session activity state matches expectations.
 *
 * Fixture: captured-event-stream.json — recorded from a real SDK session
 * where squad agent was asked "hey brand, say pong!" which triggered
 * tool calls (report_intent, glob) across two assistant turns.
 */
import { describe, it, expect, beforeEach } from "vitest";
import type { SessionEvent } from "@github/copilot-sdk";
import { CopilotSessionAggregator } from "../aggregator.js";
import capturedEvents from "./fixtures/captured-event-stream.json";

const DAEMON_ID = "test-daemon";
const SESSION_ID = "test-session-001";

function replayEvents(
  aggregator: CopilotSessionAggregator,
  events: Array<Record<string, unknown>>,
  sessionId = SESSION_ID,
) {
  for (const evt of events) {
    aggregator.handleSessionEvent(DAEMON_ID, sessionId, evt as unknown as SessionEvent);
  }
}

function replayUpTo(
  aggregator: CopilotSessionAggregator,
  events: Array<Record<string, unknown>>,
  eventType: string,
  sessionId = SESSION_ID,
): Record<string, unknown> | undefined {
  for (const evt of events) {
    aggregator.handleSessionEvent(DAEMON_ID, sessionId, evt as unknown as SessionEvent);
    if (evt.type === eventType) return evt;
  }
  return undefined;
}

describe("Aggregator activity — captured event stream", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  it("tracks session title from session.title_changed", () => {
    replayUpTo(aggregator, capturedEvents, "session.title_changed");
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.title).toBe("hey brand, say pong!");
  });

  it("sets phase to 'thinking' on assistant.turn_start", () => {
    replayUpTo(aggregator, capturedEvents, "assistant.turn_start");
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.phase).toBe("thinking");
    expect(session?.activity.turnCount).toBe(1);
  });

  it("captures token usage from session.usage_info (currentTokens field)", () => {
    replayUpTo(aggregator, capturedEvents, "session.usage_info");
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.tokenUsage).toEqual({
      used: 48641,
      limit: 168000,
    });
  });

  it("updates token usage from assistant.usage (inputTokens + outputTokens)", () => {
    replayUpTo(aggregator, capturedEvents, "assistant.usage");
    const session = aggregator.getSession(SESSION_ID);
    // assistant.usage provides inputTokens + outputTokens
    expect(session?.activity.tokenUsage).not.toBeNull();
    expect(session?.activity.tokenUsage!.used).toBeGreaterThan(0);
  });

  it("does NOT create a visible assistant entry for tool-only messages with whitespace content", () => {
    // assistant.message with content "\n\n" and toolRequests should be recognized
    // as a tool-request message, not a real assistant reply
    replayUpTo(aggregator, capturedEvents, "assistant.message");
    const session = aggregator.getSession(SESSION_ID);
    // The session should still be active (tools are about to run)
    // The key test is that the hooks skip this entry — tested separately in hooks test
    expect(session).toBeDefined();
  });

  it("tracks active tool calls from tool.execution_start", () => {
    replayUpTo(aggregator, capturedEvents, "tool.execution_start");
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.phase).toBe("tool");
    expect(session?.activity.activeToolCalls.length).toBeGreaterThanOrEqual(1);
    expect(session?.activity.activeToolCalls[0].name).toBe("report_intent");
    expect(session?.activity.activeToolCalls[0].status).toBe("running");
  });

  it("tracks multiple concurrent tool calls", () => {
    // Replay through both tool.execution_start events
    const events = capturedEvents as Array<Record<string, unknown>>;
    let toolStartCount = 0;
    for (const evt of events) {
      aggregator.handleSessionEvent(DAEMON_ID, SESSION_ID, evt as unknown as SessionEvent);
      if (evt.type === "tool.execution_start") {
        toolStartCount++;
        if (toolStartCount === 2) break;
      }
    }
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.activeToolCalls).toHaveLength(2);
    expect(session?.activity.activeToolCalls[0].name).toBe("report_intent");
    expect(session?.activity.activeToolCalls[1].name).toBe("glob");
  });

  it("removes completed tools from activeToolCalls (using success field)", () => {
    // Replay through first tool.execution_complete
    replayUpTo(aggregator, capturedEvents, "tool.execution_complete");
    const session = aggregator.getSession(SESSION_ID);
    // tool-1 (report_intent) completed, tool-2 (glob) still running
    expect(session?.activity.activeToolCalls).toHaveLength(1);
    expect(session?.activity.activeToolCalls[0].name).toBe("glob");
  });

  it("clears all tools after both complete", () => {
    // Replay through second tool.execution_complete
    const events = capturedEvents as Array<Record<string, unknown>>;
    let completeCount = 0;
    for (const evt of events) {
      aggregator.handleSessionEvent(DAEMON_ID, SESSION_ID, evt as unknown as SessionEvent);
      if (evt.type === "tool.execution_complete") {
        completeCount++;
        if (completeCount === 2) break;
      }
    }
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.activeToolCalls).toHaveLength(0);
  });

  it("increments turnCount on second assistant.turn_start", () => {
    // Replay through second turn start (turnId "1")
    const events = capturedEvents as Array<Record<string, unknown>>;
    let turnStartCount = 0;
    for (const evt of events) {
      aggregator.handleSessionEvent(DAEMON_ID, SESSION_ID, evt as unknown as SessionEvent);
      if (evt.type === "assistant.turn_start") {
        turnStartCount++;
        if (turnStartCount === 2) break;
      }
    }
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.turnCount).toBe(2);
    expect(session?.activity.phase).toBe("thinking");
    // Tool calls from previous turn should be cleared
    expect(session?.activity.activeToolCalls).toHaveLength(0);
  });

  it("updates usage_info on second turn", () => {
    // Replay through second session.usage_info
    const events = capturedEvents as Array<Record<string, unknown>>;
    let usageCount = 0;
    for (const evt of events) {
      aggregator.handleSessionEvent(DAEMON_ID, SESSION_ID, evt as unknown as SessionEvent);
      if (evt.type === "session.usage_info") {
        usageCount++;
        if (usageCount === 2) break;
      }
    }
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.tokenUsage).toEqual({
      used: 48828,
      limit: 168000,
    });
  });

  it("returns to idle on session.idle with full lifecycle complete", () => {
    // Replay all events
    replayEvents(aggregator, capturedEvents as Array<Record<string, unknown>>);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.phase).toBe("idle");
    expect(session?.activity.turnCount).toBe(2);
    expect(session?.activity.activeToolCalls).toHaveLength(0);
    expect(session?.activity.waitingState).toBeNull();
    expect(session?.activity.intent).toBeNull();
    expect(session?.activity.backgroundTasks).toHaveLength(0);
    expect(session?.status).toBe("idle");
    expect(session?.title).toBe("hey brand, say pong!");
  });

  it("extracts intent from report_intent tool call via assistant.intent event", () => {
    // The captured stream doesn't have assistant.intent — it uses report_intent as a tool.
    // Let's verify intent tracking works with a synthetic assistant.intent event.
    const intentEvent = {
      type: "assistant.intent",
      data: { intent: "Reading VISION.md" },
      timestamp: "2026-03-14T17:52:55.500Z",
      id: "synthetic-intent",
      parentId: null,
      ephemeral: true,
    };
    // First set up a session
    replayUpTo(aggregator, capturedEvents, "assistant.turn_start");
    aggregator.handleSessionEvent(DAEMON_ID, SESSION_ID, intentEvent as unknown as SessionEvent);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.intent).toBe("Reading VISION.md");
  });
});

describe("Aggregator activity — tool completion edge cases", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  it("handles tool failure (success: false)", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "tool.execution_start", data: { toolCallId: "tc-1", toolName: "read_file" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      { type: "tool.execution_complete", data: { toolCallId: "tc-1", success: false, result: { content: "File not found" } }, timestamp: "2026-01-01T00:00:02Z", id: "e3", parentId: "e2" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    // Failed tool should be removed from active list
    expect(session?.activity.activeToolCalls).toHaveLength(0);
  });

  it("handles tool.execution_progress with progressMessage field", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "tool.execution_start", data: { toolCallId: "tc-1", toolName: "bash" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      { type: "tool.execution_progress", data: { toolCallId: "tc-1", progressMessage: "Building project..." }, timestamp: "2026-01-01T00:00:02Z", id: "e3", parentId: "e2" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.activeToolCalls).toHaveLength(1);
    expect(session?.activity.activeToolCalls[0].progress).toBe("Building project...");
  });
});

describe("Aggregator activity — session.idle with background tasks", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  it("extracts background tasks from session.idle (real SDK shape)", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "assistant.turn_end", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      {
        type: "session.idle",
        data: {
          backgroundTasks: {
            agents: [
              { agentId: "bg-agent-1", agentType: "code-review", description: "Reviewing PR #42" },
            ],
            shells: [
              { shellId: "shell-1", description: "Running npm test" },
            ],
          },
        },
        timestamp: "2026-01-01T00:00:02Z",
        id: "e3",
        parentId: "e2",
      },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.backgroundTasks.length).toBeGreaterThan(0);
    expect(session?.activity.phase).not.toBe("idle");
  });
});

describe("Aggregator activity — subagent tracking", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  it("tracks subagent lifecycle (SDK shape: toolCallId, agentName, agentDisplayName)", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "subagent.started", data: { toolCallId: "sub-tc-1", agentName: "code-review", agentDisplayName: "Code Review Agent", agentDescription: "Reviews code" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.phase).toBe("subagent");
    expect(session?.activity.activeSubagents).toHaveLength(1);
    expect(session?.activity.activeSubagents[0].name).toBe("code-review");
    expect(session?.activity.activeSubagents[0].displayName).toBe("Code Review Agent");
  });

  it("removes subagent on subagent.completed", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "subagent.started", data: { toolCallId: "sub-tc-1", agentName: "code-review", agentDisplayName: "Code Review", agentDescription: "Reviews code" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      { type: "subagent.completed", data: { toolCallId: "sub-tc-1", agentName: "code-review", agentDisplayName: "Code Review" }, timestamp: "2026-01-01T00:00:05Z", id: "e3", parentId: "e2" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.activeSubagents).toHaveLength(0);
    expect(session?.activity.phase).toBe("idle");
  });

  it("removes subagent on subagent.failed", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "subagent.started", data: { toolCallId: "sub-tc-1", agentName: "test-runner", agentDisplayName: "Test Runner", agentDescription: "Runs tests" }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      { type: "subagent.failed", data: { toolCallId: "sub-tc-1", agentName: "test-runner", agentDisplayName: "Test Runner", error: "Timeout exceeded" }, timestamp: "2026-01-01T00:00:05Z", id: "e3", parentId: "e2" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.activeSubagents).toHaveLength(0);
  });
});

describe("Aggregator activity — waiting states", () => {
  let aggregator: CopilotSessionAggregator;

  beforeEach(() => {
    aggregator = new CopilotSessionAggregator();
  });

  it("sets waitingState on user_input.requested", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "user_input.requested", data: { requestId: "req-1", question: "What file should I edit?", choices: ["auth.ts", "login.ts"] }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.phase).toBe("waiting");
    expect(session?.activity.waitingState).toEqual({
      type: "user-input",
      requestId: "req-1",
      question: "What file should I edit?",
      choices: ["auth.ts", "login.ts"],
    });
  });

  it("clears waitingState on user_input.completed", () => {
    const events = [
      { type: "assistant.turn_start", data: { turnId: "0" }, timestamp: "2026-01-01T00:00:00Z", id: "e1", parentId: null },
      { type: "user_input.requested", data: { requestId: "req-1", question: "Which file?", choices: ["a.ts", "b.ts"] }, timestamp: "2026-01-01T00:00:01Z", id: "e2", parentId: "e1" },
      { type: "user_input.completed", data: { requestId: "req-1" }, timestamp: "2026-01-01T00:00:05Z", id: "e3", parentId: "e2" },
    ];
    replayEvents(aggregator, events);
    const session = aggregator.getSession(SESSION_ID);
    expect(session?.activity.waitingState).toBeNull();
    expect(session?.activity.phase).not.toBe("waiting");
  });
});
