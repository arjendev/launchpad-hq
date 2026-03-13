import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { SessionsPanel } from "../components/SessionsPanel";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("ProjectList", () => {
  it("renders the projects heading", () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalProjects: 0, totalOpenIssues: 0, totalOpenPrs: 0, projects: [] }),
    });
    render(<ProjectList />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("shows loading state initially", () => {
    mockFetch.mockReturnValue(new Promise(() => {})); // never resolves
    render(<ProjectList />);
    expect(screen.getByText("Loading projects…")).toBeInTheDocument();
  });

  it("shows empty state when no projects", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalProjects: 0, totalOpenIssues: 0, totalOpenPrs: 0, projects: [] }),
    });
    render(<ProjectList />);
    await waitFor(() => {
      expect(screen.getByText("No projects added yet")).toBeInTheDocument();
    });
  });

  it("renders project items with badges", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        totalProjects: 1,
        totalOpenIssues: 5,
        totalOpenPrs: 2,
        projects: [
          { owner: "acme", repo: "widget", openIssueCount: 5, openPrCount: 2, updatedAt: "2026-01-01T00:00:00Z", isArchived: false, runtimeTarget: "local", daemonStatus: "offline", workState: "stopped" },
        ],
      }),
    });
    render(<ProjectList />);
    await waitFor(() => {
      expect(screen.getByText("acme/widget")).toBeInTheDocument();
    });
    expect(screen.getByText("5 issues")).toBeInTheDocument();
    expect(screen.getByText("2 PRs")).toBeInTheDocument();
  });

  it("shows error state on fetch failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: "server_error", message: "Internal error" }),
    });
    render(<ProjectList />);
    await waitFor(() => {
      expect(screen.getByText("Internal error")).toBeInTheDocument();
    });
  });

  it("opens add project dialog", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ totalProjects: 0, totalOpenIssues: 0, totalOpenPrs: 0, projects: [] }),
    });
    const user = userEvent.setup();
    render(<ProjectList />);
    await user.click(screen.getByText("+ Add"));
    await waitFor(() => {
      expect(screen.getByText("Add Project")).toBeInTheDocument();
    });
  });
});

describe("KanbanBoard", () => {
  it("renders empty state when no project is selected", () => {
    render(<KanbanBoard />);
    expect(
      screen.getByText("Select a project from the sidebar"),
    ).toBeInTheDocument();
  });
});

describe("SessionsPanel", () => {
  it("renders the sessions heading", () => {
    render(<SessionsPanel />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});
