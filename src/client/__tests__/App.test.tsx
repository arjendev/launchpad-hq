import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TestProviders } from "../../test-utils/index.js";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { SessionsPanel } from "../components/SessionsPanel";

describe("ProjectList", () => {
  it("renders the projects heading", () => {
    render(
      <TestProviders>
        <ProjectList />
      </TestProviders>,
    );
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("renders placeholder project names", () => {
    render(
      <TestProviders>
        <ProjectList />
      </TestProviders>,
    );
    expect(screen.getByText(/repo-alpha/)).toBeInTheDocument();
    expect(screen.getByText(/repo-beta/)).toBeInTheDocument();
  });
});

describe("KanbanBoard", () => {
  it("renders the board heading", () => {
    render(
      <TestProviders>
        <KanbanBoard />
      </TestProviders>,
    );
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("renders kanban columns", () => {
    render(
      <TestProviders>
        <KanbanBoard />
      </TestProviders>,
    );
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});

describe("SessionsPanel", () => {
  it("renders the sessions heading", () => {
    render(
      <TestProviders>
        <SessionsPanel />
      </TestProviders>,
    );
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});
