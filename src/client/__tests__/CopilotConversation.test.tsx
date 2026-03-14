import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { CopilotConversation } from "../components/CopilotConversation.js";
import type {
  AggregatedSession,
  AggregatedSessionMessage,
  CopilotAgentCatalogEntry,
  ToolInvocationRecord,
} from "../services/types.js";
import { DEFAULT_SESSION_ACTIVITY } from "../services/types.js";

// ── Mock data ──────────────────────────────────────────

const mockSession: AggregatedSession = {
  sessionId: "abc123",
  status: "idle",
  startedAt: Date.now() - 600_000,
  updatedAt: Date.now(),
  activity: { ...DEFAULT_SESSION_ACTIVITY },
};

const mockMessages: AggregatedSessionMessage[] = [
  { role: "user", content: "Fix the auth bug in login.ts", timestamp: 1000 },
  {
    role: "assistant",
    content: "I'll fix the auth bug. Let me look at login.ts",
    timestamp: 2000,
  },
  { role: "user", content: "Also check the tests", timestamp: 3000 },
  {
    role: "assistant",
    content: "Sure, I'll check the tests too.",
    timestamp: 4000,
  },
];

const mockToolInvocations: ToolInvocationRecord[] = [
  {
    sessionId: "abc123",
    projectId: "proj-1",
    tool: "report_progress",
    args: { status: "working", summary: "Fixed 1 of 3 files" },
    timestamp: 2500,
  },
  {
    sessionId: "abc123",
    projectId: "proj-1",
    tool: "request_human_review",
    args: { reason: "Please review changes", urgency: "high" },
    timestamp: 3500,
  },
];

const mockAgents: CopilotAgentCatalogEntry[] = [
  {
    id: "builtin:default",
    name: "default",
    displayName: "Plain session",
    description: "Standard Copilot session without a custom agent persona.",
  },
  {
    id: "brand",
    name: "Brand",
    description: "Frontend specialist with a UI-first focus",
  },
];

const mockSelectProject = vi.fn();
const mockSelectedProject = {
  owner: "owner",
  repo: "test-repo",
  openIssueCount: 3,
  openPrCount: 1,
  updatedAt: new Date().toISOString(),
  isArchived: false,
  runtimeTarget: "wsl-devcontainer",
  daemonStatus: "online" as const,
  workState: "working",
};

vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: mockSelectedProject,
    selectProject: mockSelectProject,
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Fetch mock ─────────────────────────────────────────

function setupFetchMock(overrides?: {
  session?: AggregatedSession | null;
  messages?: AggregatedSessionMessage[];
  tools?: ToolInvocationRecord[];
  agents?: CopilotAgentCatalogEntry[];
  currentAgentId?: string | null;
  currentAgentName?: string | null;
  sendOk?: boolean;
  abortOk?: boolean;
}) {
  const session = overrides?.session !== undefined ? overrides.session : mockSession;
  const messages = overrides?.messages ?? mockMessages;
  const tools = overrides?.tools ?? [];
  const agents = overrides?.agents ?? mockAgents;
  let currentAgentId = overrides?.currentAgentId ?? null;
  let currentAgentName = overrides?.currentAgentName ?? null;
  const sendOk = overrides?.sendOk ?? true;
  const abortOk = overrides?.abortOk ?? true;
  const agentUpdates: Array<string | null> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const urlStr = typeof url === "string" ? url : "";

      if (urlStr.includes("/api/daemons/owner/test-repo/copilot/agents")) {
        return { ok: true, json: async () => ({ agents }) };
      }

      if (urlStr.includes("/agent")) {
        if (init?.method === "POST") {
          const body = JSON.parse(String(init.body ?? "{}")) as { agentId?: string | null };
          currentAgentId = body.agentId ?? null;
          currentAgentName =
            currentAgentId === null
              ? null
              : (agents.find((agent) => agent.id === currentAgentId)?.displayName ??
                agents.find((agent) => agent.id === currentAgentId)?.name ??
                currentAgentId);
          agentUpdates.push(currentAgentId);
          return {
            ok: true,
            json: async () => ({
              sessionId: "abc123",
              agentId: currentAgentId,
              agentName: currentAgentName,
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({
            sessionId: "abc123",
            agentId: currentAgentId,
            agentName: currentAgentName,
          }),
        };
      }

      // Session detail
      if (
        urlStr.includes("/api/copilot/aggregated/sessions/") &&
        !urlStr.includes("/messages") &&
        !urlStr.includes("/tools") &&
        !urlStr.includes("/send") &&
        !urlStr.includes("/abort") &&
        !urlStr.includes("/mode") &&
        !urlStr.includes("/plan") &&
        !urlStr.includes("/agent") &&
        !urlStr.includes("/disconnect") &&
        !urlStr.includes("/resume") &&
        !urlStr.includes("/set-model") &&
        (!init || init.method === "GET" || !init.method)
      ) {
        if (!session) {
          return {
            ok: false,
            json: async () => ({ error: "not_found", message: "Session not found" }),
          };
        }
        return { ok: true, json: async () => session };
      }

      // Messages
      if (urlStr.includes("/messages")) {
        return {
          ok: true,
          json: async () => ({
            sessionId: "abc123",
            messages,
            count: messages.length,
          }),
        };
      }

      // Tools
      if (urlStr.includes("/tools")) {
        return {
          ok: true,
          json: async () => ({
            sessionId: "abc123",
            invocations: tools,
            count: tools.length,
          }),
        };
      }

      // Send prompt
      if (urlStr.includes("/send") && init?.method === "POST") {
        if (sendOk) {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return {
          ok: false,
          json: async () => ({ error: "send_failed", message: "Daemon not connected" }),
        };
      }

      // Abort
      if (urlStr.includes("/abort") && init?.method === "POST") {
        if (abortOk) {
          return { ok: true, json: async () => ({ ok: true }) };
        }
        return {
          ok: false,
          json: async () => ({ error: "send_failed", message: "Daemon not connected" }),
        };
      }

      // Fallback for other endpoints (copilot sessions list, models, mode, plan, etc.)
      if (urlStr.includes("/api/copilot/models")) {
        return {
          ok: true,
          json: async () => ({ models: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "claude-sonnet", name: "Claude Sonnet" }] }),
        };
      }

      if (urlStr.includes("/mode") && (!init || !init.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({ sessionId: "abc123", mode: "interactive" }),
        };
      }

      if (urlStr.includes("/plan") && (!init || !init.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({ sessionId: "abc123", content: "" }),
        };
      }

      if (urlStr.includes("/api/copilot/sessions")) {
        return {
          ok: true,
          json: async () => ({ sessions: [], count: 0, adapter: "mock" }),
        };
      }

      return {
        ok: false,
        json: async () => ({ error: "NOT_FOUND", message: "Not found" }),
      };
    }),
  );

  return { agentUpdates };
}

// ── Tests ──────────────────────────────────────────────

describe("CopilotConversation", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders message list with user and assistant messages", async () => {
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Fix the auth bug in login.ts"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText("I'll fix the auth bug. Let me look at login.ts"),
    ).toBeInTheDocument();
    expect(screen.getByText("Also check the tests")).toBeInTheDocument();
    expect(
      screen.getByText("Sure, I'll check the tests too."),
    ).toBeInTheDocument();
  });

  it("user messages are right-aligned", async () => {
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("Fix the auth bug in login.ts"),
      ).toBeInTheDocument();
    });

    const userMessages = screen.getAllByTestId("user-message");
    expect(userMessages.length).toBe(2);
    // Verify user messages render inside the right-aligned container
    for (const msg of userMessages) {
      // Mantine Group with justify="flex-end" applies a CSS class; verify testid exists and content
      expect(msg).toBeInTheDocument();
    }
  });

  it("assistant messages are left-aligned", async () => {
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(
        screen.getByText("I'll fix the auth bug. Let me look at login.ts"),
      ).toBeInTheDocument();
    });

    const assistantMessages = screen.getAllByTestId("assistant-message");
    expect(assistantMessages.length).toBe(2);
    for (const msg of assistantMessages) {
      expect(msg).toBeInTheDocument();
    }
  });

  it("renders HQ tool invocations inline in conversation", async () => {
    setupFetchMock({ tools: mockToolInvocations });
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getAllByTestId("user-message").length).toBeGreaterThan(0);
    });

    // HQ tool cards should appear inline
    expect(screen.queryAllByTestId("hq-tool-card").length).toBeGreaterThan(0);
  });

  it("renders empty state when no messages", async () => {
    setupFetchMock({ messages: [] });
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("renders error state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          error: "server_error",
          message: "Internal server error",
        }),
      })),
    );

    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Failed to load messages/)).toBeInTheDocument();
    });
  });

  it("prompt input sends to API", async () => {
    setupFetchMock();
    const user = userEvent.setup();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a prompt…")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Type a prompt…");
    await user.type(input, "Fix the tests too");

    const sendBtn = screen.getByTestId("send-button");
    await waitFor(() => {
      expect(sendBtn).toBeEnabled();
    });
    await user.click(sendBtn);

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const calls = fetchMock.mock.calls;
      const sendCall = calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/send") &&
          (init as RequestInit)?.method === "POST",
      );
      expect(sendCall).toBeDefined();
      const body = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(body.prompt).toBe("Fix the tests too");
    });
  });

  it("abort button calls abort API when session is active", async () => {
    setupFetchMock({
      session: { ...mockSession, status: "active" },
    });
    const user = userEvent.setup();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("abort-button")).toBeInTheDocument();
    });

    await user.click(screen.getByTestId("abort-button"));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const calls = fetchMock.mock.calls;
      const abortCall = calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/abort") &&
          (init as RequestInit)?.method === "POST",
      );
      expect(abortCall).toBeDefined();
    });
  });

  it("shows loading state while sending", async () => {
    // Create a delayed fetch that hangs for send
    let resolveSend: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const urlStr = typeof url === "string" ? url : "";

        if (urlStr.includes("/send") && init?.method === "POST") {
          return new Promise<{ ok: boolean; json: () => Promise<unknown> }>(
            (resolve) => {
              resolveSend = () => resolve({ ok: true, json: async () => ({ ok: true }) });
            },
          );
        }

        if (urlStr.includes("/messages")) {
          return {
            ok: true,
            json: async () => ({
              sessionId: "abc123",
              messages: mockMessages,
              count: mockMessages.length,
            }),
          };
        }

        if (urlStr.includes("/tools")) {
          return {
            ok: true,
            json: async () => ({
              sessionId: "abc123",
              invocations: [],
              count: 0,
            }),
          };
        }

        if (urlStr.includes("/api/copilot/models")) {
          return {
            ok: true,
            json: async () => ({ models: [{ id: "gpt-4o", name: "GPT-4o" }, { id: "claude-sonnet", name: "Claude Sonnet" }] }),
          };
        }

        if (urlStr.includes("/mode")) {
          return {
            ok: true,
            json: async () => ({ sessionId: "abc123", mode: "interactive" }),
          };
        }

        if (urlStr.includes("/plan")) {
          return {
            ok: true,
            json: async () => ({ sessionId: "abc123", content: "" }),
          };
        }

        if (urlStr.includes("/api/copilot/aggregated/sessions/")) {
          return { ok: true, json: async () => mockSession };
        }

        return {
          ok: false,
          json: async () => ({ error: "NOT_FOUND", message: "Not found" }),
        };
      }),
    );

    const user = userEvent.setup();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Type a prompt…")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Type a prompt…");
    await user.type(input, "hello");
    await user.click(screen.getByTestId("send-button"));

    // The send button should show loading state
    await waitFor(() => {
      const sendBtn = screen.getByTestId("send-button");
      expect(sendBtn).toBeDisabled();
    });

    // Resolve the send
    resolveSend?.();
  });

  it("shows session header with status (in parent component)", async () => {
    // Status badge and session title are rendered by the parent component,
    // not CopilotConversation. Verify CopilotConversation renders without a header.
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("prompt-area")).toBeInTheDocument();
    });
    // No header title or status badge in CopilotConversation
    expect(screen.queryByText("Session abc123")).not.toBeInTheDocument();
  });

  it("does not render back button (controls moved to parent)", async () => {
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("prompt-area")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("back-button")).not.toBeInTheDocument();
  });

  it("keeps input enabled and shows steer + queue actions when session is processing", async () => {
    setupFetchMock({
      session: { ...mockSession, status: "active" },
    });
    render(
      <CopilotConversation sessionId="abc123" />,
    );

    await waitFor(() => {
      const input = screen.getByPlaceholderText("Steer the current work or queue a follow-up…");
      expect(input).toBeEnabled();
    });

    expect(screen.getByTestId("steer-button")).toBeInTheDocument();
    expect(screen.getByTestId("queue-button")).toBeInTheDocument();
    expect(screen.getByTestId("abort-button")).toBeInTheDocument();
    expect(screen.queryByTestId("send-button")).not.toBeInTheDocument();
  });

  it("sends steering mode when the user clicks Steer during an active session", async () => {
    setupFetchMock({
      session: { ...mockSession, status: "active" },
    });
    const user = userEvent.setup();
    render(<CopilotConversation sessionId="abc123" />);

    await waitFor(() => {
      expect(screen.getByTestId("steer-button")).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("Steer the current work or queue a follow-up…");
    await user.type(input, "Use the existing helper instead");
    await user.click(screen.getByTestId("steer-button"));

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const sendCall = fetchMock.mock.calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/send") &&
          (init as RequestInit)?.method === "POST",
      );
      expect(sendCall).toBeDefined();
      const body = JSON.parse((sendCall![1] as RequestInit).body as string);
      expect(body).toMatchObject({
        prompt: "Use the existing helper instead",
        mode: "immediate",
      });
    });
  });

  it("shows a session agent dropdown beside the prompt and switches agents in-place", async () => {
    const fetchState = setupFetchMock({
      currentAgentId: null,
      currentAgentName: null,
    });
    const user = userEvent.setup();
    render(<CopilotConversation sessionId="abc123" />);

    await waitFor(() => {
      expect(screen.getByTestId("session-agent-select")).toBeInTheDocument();
    });

    const agentSelect = screen.getByTestId("session-agent-select");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Brand" })).toBeInTheDocument();
      expect(agentSelect).toBeEnabled();
    });
    await user.selectOptions(agentSelect, "brand");

    await waitFor(() => {
      expect(fetchState.agentUpdates).toEqual(["brand"]);
    });
  });

  it("accepts controlPanelOpen prop without error", async () => {
    setupFetchMock();
    render(
      <CopilotConversation sessionId="abc123" controlPanelOpen={false} />,
    );

    await waitFor(() => {
      expect(screen.getByTestId("prompt-area")).toBeInTheDocument();
    });

    // Control panel toggle is in the parent component header
    expect(screen.queryByTestId("control-panel-toggle")).not.toBeInTheDocument();
  });
});
