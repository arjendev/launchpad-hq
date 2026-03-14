import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { SessionList } from "../components/SessionList.js";
import type {
  AggregatedSession,
  CopilotAgentCatalogEntry,
  DaemonSummary,
} from "../services/types.js";

const mockDaemons: DaemonSummary[] = [
  {
    daemonId: "owner/test-repo",
    projectId: "owner/test-repo",
    projectName: "owner/test-repo",
    runtimeTarget: "wsl-devcontainer",
    state: "connected",
    connectedAt: Date.now() - 3600_000,
    lastHeartbeat: Date.now() - 2_000,
    version: "0.1.0",
    capabilities: ["terminal", "copilot"],
  },
];

const mockSessions: AggregatedSession[] = [
  {
    sessionId: "sess-001",
    sessionType: "copilot-sdk",
    summary: "Refactoring auth module",
    status: "active",
    startedAt: Date.now() - 600_000,
    updatedAt: Date.now() - 30_000,
  },
  {
    sessionId: "sess-002",
    sessionType: "copilot-cli",
    summary: "Adding tests",
    status: "idle",
    startedAt: Date.now() - 1200_000,
    updatedAt: Date.now() - 120_000,
  },
  {
    sessionId: "sess-003",
    sessionType: "squad-sdk",
    summary: "Squad deployment review",
    status: "ended",
    startedAt: Date.now() - 3600_000,
    updatedAt: Date.now() - 600_000,
  },
];

const mockAgents: CopilotAgentCatalogEntry[] = [
  {
    id: "brand",
    name: "Brand",
    description: "Frontend specialist with a UI-first focus",
  },
  {
    id: "tars",
    name: "TARS",
    description: "Platform specialist for daemon and integration work",
  },
];

type FetchMockState = {
  createRequests: Array<Record<string, unknown>>;
  preferenceUpdates: Array<{ agentId: string | null }>;
  rememberedAgentId: string | null;
  rememberedAgentName: string | null;
};

function parseRequestBody(init?: RequestInit) {
  return JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
}

function setupFetchMock(overrides?: {
  daemons?: DaemonSummary[];
  sessions?: AggregatedSession[];
  agents?: CopilotAgentCatalogEntry[];
  rememberedAgentId?: string | null;
  rememberedAgentName?: string | null;
}) {
  const daemons = overrides?.daemons ?? mockDaemons;
  const sessions = overrides?.sessions ?? mockSessions;
  const agents = overrides?.agents ?? mockAgents;

  const state: FetchMockState = {
    createRequests: [],
    preferenceUpdates: [],
    rememberedAgentId: overrides?.rememberedAgentId ?? "brand",
    rememberedAgentName: overrides?.rememberedAgentName ?? "Brand",
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/api/daemons/owner/test-repo/copilot/agents")) {
        return { ok: true, json: async () => ({ agents }) };
      }

      if (
        typeof url === "string" &&
        url.includes("/api/projects/owner/test-repo/preferences/copilot-agent")
      ) {
        if (init?.method === "PUT") {
          const body = parseRequestBody(init) as { agentId?: string | null };
          state.preferenceUpdates.push({ agentId: body.agentId ?? null });
          state.rememberedAgentId = body.agentId ?? null;
          state.rememberedAgentName = state.rememberedAgentId
            ? (agents.find((agent) => agent.id === state.rememberedAgentId)?.name ??
              state.rememberedAgentId)
            : null;

          return {
            ok: true,
            json: async () => ({
              agentId: state.rememberedAgentId,
              agentName: state.rememberedAgentName,
            }),
          };
        }

        return {
          ok: true,
          json: async () => ({
            agentId: state.rememberedAgentId,
            agentName: state.rememberedAgentName,
          }),
        };
      }

      if (
        typeof url === "string" &&
        url.includes("/api/daemons/owner/test-repo/copilot/sessions") &&
        init?.method === "POST"
      ) {
        const body = parseRequestBody(init);
        state.createRequests.push(body);

        return {
          ok: true,
          json: async () => ({
            ok: true,
            sessionId: "new-sess-999",
            sessionType: typeof body.sessionType === "string" ? body.sessionType : "copilot-sdk",
          }),
        };
      }

      if (typeof url === "string" && url.includes("/api/daemons")) {
        return { ok: true, json: async () => daemons };
      }

      if (
        typeof url === "string" &&
        url.includes("/api/copilot/aggregated/sessions") &&
        !init?.method
      ) {
        return {
          ok: true,
          json: async () => ({ sessions, count: sessions.length }),
        };
      }

      if (
        typeof url === "string" &&
        url.includes("/api/copilot/aggregated/sessions/") &&
        init?.method === "POST"
      ) {
        return { ok: true, json: async () => ({ ok: true }) };
      }

      return {
        ok: false,
        json: async () => ({ error: "NOT_FOUND", message: "Not found" }),
      };
    }),
  );

  return state;
}

const mockSelectProject = vi.fn();
let mockSelectedProject: ReturnType<typeof createMockProject> | null = null;

function createMockProject() {
  return {
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
}

vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: mockSelectedProject,
    selectProject: mockSelectProject,
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

let mockSelectedSession: AggregatedSession | null = null;
const mockSelectSession = vi.fn();

vi.mock("../contexts/SessionContext.js", () => ({
  useSelectedSession: () => ({
    selectedSession: mockSelectedSession,
    selectSession: mockSelectSession,
  }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

describe("SessionList", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    mockSelectedProject = null;
    mockSelectedSession = null;
    mockSelectSession.mockReset();
    mockSelectProject.mockReset();
  });

  it("shows 'Select a project first' when no project is selected", () => {
    setupFetchMock();
    render(<SessionList />);
    expect(screen.getByText("Select a project first")).toBeInTheDocument();
  });

  it("renders session items and the remembered SDK choice", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Refactoring auth module")).toBeInTheDocument();
    });

    expect(screen.getByText("Adding tests")).toBeInTheDocument();
    expect(screen.getByText("Squad deployment review")).toBeInTheDocument();
    expect(screen.getByText("SDK: Brand")).toBeInTheDocument();
  });

  it("shows session type badges", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("SDK")).toBeInTheDocument();
    });

    expect(screen.getByText("CLI")).toBeInTheDocument();
    expect(screen.getByText("Squad")).toBeInTheDocument();
  });

  it("shows 'No sessions yet' when session list is empty", async () => {
    setupFetchMock({ sessions: [] });
    mockSelectedProject = createMockProject();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("No sessions yet")).toBeInTheDocument();
    });
  });

  it("calls selectSession when clicking a session", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    const user = userEvent.setup();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Refactoring auth module")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Refactoring auth module"));
    expect(mockSelectSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-001" }),
    );
  });

  it("deselects when clicking already-selected session", async () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    mockSelectedSession = mockSessions[0];
    const user = userEvent.setup();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("Refactoring auth module")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Refactoring auth module"));
    expect(mockSelectSession).toHaveBeenCalledWith(null);
  });

  it("uses the remembered agent when creating a Copilot SDK session", async () => {
    const fetchState = setupFetchMock();
    mockSelectedProject = createMockProject();
    const user = userEvent.setup();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("SDK: Brand")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "➕ New" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Create Copilot SDK session with remembered agent Brand",
      }),
    );

    await waitFor(() => {
      expect(fetchState.createRequests).toHaveLength(1);
    });

    expect(fetchState.createRequests[0]).toEqual({
      sessionType: "copilot-sdk",
      agentId: "brand",
    });
    expect(fetchState.preferenceUpdates).toEqual([]);
    expect(mockSelectSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "new-sess-999",
        sessionType: "copilot-sdk",
      }),
      { resume: false },
    );
  });

  it("switches back to the default SDK session and remembers it", async () => {
    const fetchState = setupFetchMock();
    mockSelectedProject = createMockProject();
    const user = userEvent.setup();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("SDK: Brand")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "➕ New" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Create default Copilot SDK session and remember it",
      }),
    );

    await waitFor(() => {
      expect(fetchState.preferenceUpdates).toEqual([{ agentId: null }]);
      expect(fetchState.createRequests).toHaveLength(1);
    });

    expect(fetchState.createRequests[0]).toEqual({
      sessionType: "copilot-sdk",
    });

    await waitFor(() => {
      expect(screen.getByText("SDK: Default")).toBeInTheDocument();
    });
  });

  it("lets the user pick a discovered agent and remembers it immediately", async () => {
    const fetchState = setupFetchMock({
      rememberedAgentId: null,
      rememberedAgentName: null,
    });
    mockSelectedProject = createMockProject();
    const user = userEvent.setup();
    render(<SessionList />);

    await waitFor(() => {
      expect(screen.getByText("SDK: Default")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "➕ New" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "Create Copilot SDK session with TARS and remember it",
      }),
    );

    await waitFor(() => {
      expect(fetchState.preferenceUpdates).toEqual([{ agentId: "tars" }]);
      expect(fetchState.createRequests).toHaveLength(1);
    });

    expect(fetchState.createRequests[0]).toEqual({
      sessionType: "copilot-sdk",
      agentId: "tars",
    });

    await waitFor(() => {
      expect(screen.getByText("SDK: TARS")).toBeInTheDocument();
    });
  });

  it("shows Sessions heading", () => {
    setupFetchMock();
    mockSelectedProject = createMockProject();
    render(<SessionList />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});
