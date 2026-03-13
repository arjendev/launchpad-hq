import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { SessionsPanel } from "../components/SessionsPanel.js";
import type {
  DevContainer,
  CopilotSessionSummary,
  AttentionItem,
} from "../services/types.js";

// ── Mock data ──────────────────────────────────────────

const mockContainers: DevContainer[] = [
  {
    containerId: "abc123",
    name: "my-project-dev",
    status: "running",
    workspaceFolder: "/workspace",
    repository: "owner/my-project",
    ports: ["3000:3000", "5432:5432"],
    image: "mcr.microsoft.com/devcontainers/typescript-node",
    createdAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    containerId: "def456",
    name: "backend-service",
    status: "stopped",
    workspaceFolder: "/workspace",
    ports: [],
    image: "mcr.microsoft.com/devcontainers/python",
    createdAt: new Date(Date.now() - 7200_000).toISOString(),
  },
];

const mockSessions: CopilotSessionSummary[] = [
  {
    id: "s1",
    status: "active",
    startedAt: new Date(Date.now() - 600_000).toISOString(),
    repository: "owner/my-project",
    currentTask: "Implementing feature X",
    messageCount: 12,
    adapter: "mock",
  },
  {
    id: "s2",
    status: "idle",
    startedAt: new Date(Date.now() - 1800_000).toISOString(),
    repository: "owner/backend",
    currentTask: null,
    messageCount: 3,
    adapter: "sdk",
  },
];

const mockAttentionItems: AttentionItem[] = [
  {
    id: "a1",
    type: "ci_failing",
    severity: "critical",
    project: "owner/my-project",
    message: "CI build failing on main branch",
    createdAt: new Date(Date.now() - 300_000).toISOString(),
    dismissed: false,
  },
  {
    id: "a2",
    type: "pr_needs_review",
    severity: "warning",
    project: "owner/backend",
    message: "PR #42 needs review",
    createdAt: new Date(Date.now() - 600_000).toISOString(),
    dismissed: false,
  },
];

// ── Fetch mock ─────────────────────────────────────────

function setupFetchMock(overrides?: {
  containers?: DevContainer[];
  sessions?: CopilotSessionSummary[];
  attentionItems?: AttentionItem[];
  attentionCount?: { total: number; bySeverity: Record<string, number> };
}) {
  const containers = overrides?.containers ?? mockContainers;
  const sessions = overrides?.sessions ?? mockSessions;
  const attentionItems = overrides?.attentionItems ?? mockAttentionItems;
  const attentionCount = overrides?.attentionCount ?? {
    total: attentionItems.length,
    bySeverity: { info: 0, warning: 1, critical: 1 },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/devcontainers")) {
        return {
          ok: true,
          json: async () => ({
            containers,
            scannedAt: new Date().toISOString(),
            dockerAvailable: true,
          }),
        };
      }
      if (typeof url === "string" && url.includes("/api/copilot/sessions/")) {
        const id = url.split("/").pop();
        const session = sessions.find((s) => s.id === id);
        return {
          ok: true,
          json: async () =>
            session
              ? { ...session, conversationHistory: [] }
              : null,
        };
      }
      if (typeof url === "string" && url.includes("/api/copilot/sessions")) {
        return { ok: true, json: async () => sessions };
      }
      if (typeof url === "string" && url.includes("/api/attention/count")) {
        return { ok: true, json: async () => attentionCount };
      }
      if (
        typeof url === "string" &&
        url.includes("/api/attention") &&
        init?.method === "POST"
      ) {
        return {
          ok: true,
          json: async () => ({ ok: true, unreadCount: attentionCount.total - 1 }),
        };
      }
      if (typeof url === "string" && url.includes("/api/attention")) {
        return { ok: true, json: async () => ({ items: attentionItems }) };
      }
      return { ok: false, json: async () => ({ error: "NOT_FOUND", message: "Not found" }) };
    }),
  );
}

// ── Tests ──────────────────────────────────────────────

describe("SessionsPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the title and three accordion sections", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("🐳 Devcontainers")).toBeInTheDocument();
    expect(screen.getByText("🤖 Copilot Sessions")).toBeInTheDocument();
    expect(screen.getByText("🔔 Attention")).toBeInTheDocument();
  });

  it("shows devcontainer cards with name and status", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("my-project-dev")).toBeInTheDocument();
    });
    expect(screen.getByText("backend-service")).toBeInTheDocument();
    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("stopped")).toBeInTheDocument();
  });

  it("shows devcontainer ports as badges", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("3000:3000")).toBeInTheDocument();
    });
    expect(screen.getByText("5432:5432")).toBeInTheDocument();
  });

  it("shows devcontainer repository name", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("owner/my-project")).toBeInTheDocument();
    });
  });

  it("shows empty state for devcontainers", async () => {
    setupFetchMock({ containers: [] });
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("No devcontainers running"),
      ).toBeInTheDocument();
    });
  });

  it("shows copilot session cards", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Implementing feature X")).toBeInTheDocument();
    });
    expect(screen.getByText("12 msgs")).toBeInTheDocument();
    expect(screen.getByText("3 msgs")).toBeInTheDocument();
  });

  it("shows empty state for copilot sessions", async () => {
    setupFetchMock({ sessions: [] });
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("No active Copilot sessions"),
      ).toBeInTheDocument();
    });
  });

  it("shows attention items with severity", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("CI build failing on main branch"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("PR #42 needs review")).toBeInTheDocument();
    expect(screen.getByText("critical")).toBeInTheDocument();
    expect(screen.getByText("warning")).toBeInTheDocument();
  });

  it("shows attention badge count", async () => {
    setupFetchMock();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  it("shows empty state for attention items", async () => {
    setupFetchMock({
      attentionItems: [],
      attentionCount: {
        total: 0,
        bySeverity: { info: 0, warning: 0, critical: 0 },
      },
    });
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("All clear — no items need attention"),
      ).toBeInTheDocument();
    });
  });

  it("dismiss button calls POST endpoint", async () => {
    setupFetchMock();
    const user = userEvent.setup();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("CI build failing on main branch")).toBeInTheDocument();
    });

    const dismissButtons = screen.getAllByText("✕");
    expect(dismissButtons.length).toBeGreaterThan(0);
    await user.click(dismissButtons[0]);

    await waitFor(() => {
      const fetchMock = vi.mocked(fetch);
      const calls = fetchMock.mock.calls;
      const dismissCall = calls.find(
        ([url, init]) =>
          typeof url === "string" &&
          url.includes("/api/attention/") &&
          url.includes("/dismiss") &&
          (init as RequestInit)?.method === "POST",
      );
      expect(dismissCall).toBeDefined();
    });
  });

  it("expands copilot session to show conversation history", async () => {
    setupFetchMock();
    const user = userEvent.setup();
    render(<SessionsPanel />);

    await waitFor(() => {
      expect(screen.getByText("Implementing feature X")).toBeInTheDocument();
    });

    // Click to expand the session card
    const sessionCard = screen.getByText("Implementing feature X").closest("[class*='paper']") ??
      screen.getByText("Implementing feature X").parentElement?.parentElement?.parentElement;
    if (sessionCard) {
      await user.click(sessionCard);
    }

    // The conversation history component should have been rendered
    // (may show "No conversation history" since mock returns empty array)
    await waitFor(() => {
      expect(
        screen.queryByText("No conversation history") ||
          screen.queryByText("user") ||
          screen.queryByText("assistant"),
      ).toBeTruthy();
    });
  });
});
