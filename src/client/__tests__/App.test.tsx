import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../../test-utils/client.js";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { SessionsPanel } from "../components/SessionsPanel";

describe("ProjectList", () => {
  it("renders the projects heading", () => {
    render(<ProjectList />);
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("renders placeholder project names", () => {
    render(<ProjectList />);
    expect(screen.getByText(/repo-alpha/)).toBeInTheDocument();
    expect(screen.getByText(/repo-beta/)).toBeInTheDocument();
  });
});

describe("KanbanBoard", () => {
  it("renders the board heading", () => {
    render(<KanbanBoard />);
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("renders kanban columns", () => {
    render(<KanbanBoard />);
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});

describe("SessionsPanel", () => {
  it("renders the sessions heading", () => {
    render(<SessionsPanel />);
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});
