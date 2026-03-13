import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { ConnectedProjectPanel } from "../components/ConnectedProjectPanel.js";
import type {
  DaemonSummary,
  AggregatedSession,
  AttentionItem,
} from "../services/types.js";

// ── Mock data ──────────────────────────────────────────

const mockDaemons: DaemonSummary[] = [
  {
    daemonId: "owner/my-project",
    projectId: "owner/my-project",
    projectName: "owner/my-project",
    runtimeTarget: "wsl-devcontainer",
    state: "connected",
    connectedAt: Date.now() - 3600_000,
    lastHeartbeat: Date.now() - 2_000,
    version: "0.1.0",
    capabilities: ["terminal", "copilot"],
  },
];

const mockAggregatedSessions: AggregatedSession[] = [
  {
    sessionId: "abc12345-6789-0000-0000-000000000001",
    daemonId: "owner/my-project",
    projectId: "owner/my-project",
    repository: "owner/my-project",
    branch: "main",
    summary: "Refactoring auth module",
    status: "active",
    startedAt: Date.now() - 600_000,
    updatedAt: Date.now() - 30_000,
  },
  {
    sessionId: "def45678-9012-0000-0000-000000000002",
    daemonId: "owner/my-project",
    projectId: "owner/my-project",
    repository: "owner/my-project",
    branch: "feature-tests",
    summary: "Adding tests",
    status: "idle",
    startedAt: Date.now() - 1200_000,
    updatedAt: Date.now() - 120_000,
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
];

// ── Fetch mock ─────────────────────────────────────────

function setupFetchMock(overrides?: {
  daemons?: DaemonSummary[];
  sessions?: AggregatedSession[];
  attentionItems?: AttentionItem[];
  attentionCount?: { total: number; bySeverity: Record<string, number> };
}) {
  const daemons = overrides?.daemons ?? mockDaemons;
  const sessions = overrides?.sessions ?? mockAggregatedSessions;
  const attentionItems = overrides?.attentionItems ?? mockAttentionItems;
  const attentionCount = overrides?.attentionCount ?? {
    total: attentionItems.length,
    bySeverity: { info: 0, warning: 0, critical: 1 },
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/daemons")) {
        return { ok: true, json: async () => daemons };
      }
      if (typeof url === "string" && url.includes("/api/copilot/aggregated/sessions")) {
        return { ok: true, json: async () => ({ sessions, count: sessions.length }) };
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

// ── Mock ProjectContext ────────────────────────────────

const mockSelectProject = vi.fn();
let mockSelectedProject: ReturnType<typeof createMockProject> | null = null;

function createMockProject() {
  return {
    owner: "owner",
    repo: "my-project",
    openIssueCount: 5,
    openPrCount: 2,
    updatedAt: new Date().toISOString(),
    isArchived: false,
    runtimeTarget: "wsl-devcontainer",
    daemonStatus: "online" as const,
    workState: "working",
  };
}

vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: mockSelectedProject,
    selectProject: mockSelectProject,
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ── Tests ──────────────────────────────────────────────

describe("ConnectedProjectPanel", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockSelectedProject = null;
  });

  it("shows 'No project selected' when nothing is selected", () => {
    setupFetchMock();
    mockSelectedProject = null;
    render(<ConnectedProjectPanel />);

    expect(screen.getByText("Connected Project")).toBeInTheDocument();
    expect(screen.getByText("No project selected")).toBeInTheDocument();
  });

  it("shows daemon online status when project is selected", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText("Daemon: Online")).toBeInTheDocument();
    });
    expect(screen.getByText("WSL+DC")).toBeInTheDocument();
  });

  it("shows daemon offline when no daemon matches", async () => {
    setupFetchMock({ daemons: [] });
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText("Daemon: Offline")).toBeInTheDocument();
    });
  });

  it("shows aggregated copilot sessions for the project", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText("Session abc12345")).toBeInTheDocument();
    });
    expect(screen.getByText("Session def45678")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();
    expect(screen.getByText("feature-tests")).toBeInTheDocument();
  });

  it("shows session summaries", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(screen.getByText(/"Refactoring auth module"/)).toBeInTheDocument();
    });
    expect(screen.getByText(/"Adding tests"/)).toBeInTheDocument();
  });

  it("shows empty state for copilot sessions", async () => {
    setupFetchMock({ sessions: [] });
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("No active Copilot sessions"),
      ).toBeInTheDocument();
    });
  });

  it("shows attention items", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      expect(
        screen.getByText("CI build failing on main branch"),
      ).toBeInTheDocument();
    });
  });

  it("shows Open Terminal button (disabled)", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: "Open Terminal" });
      expect(btn).toBeInTheDocument();
      expect(btn).toBeDisabled();
    });
  });

  it("shows project name in header", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<ConnectedProjectPanel />);

    expect(screen.getByText("owner/my-project")).toBeInTheDocument();
  });

  it("dismiss button calls POST endpoint", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    const user = userEvent.setup();
    render(<ConnectedProjectPanel />);

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
});
