import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { ProjectList } from "../components/ProjectList";
import { KanbanBoard } from "../components/KanbanBoard";
import { SessionsPanel } from "../components/SessionsPanel";

function Wrapper({ children }: { children: React.ReactNode }) {
  return (
    <MantineProvider defaultColorScheme="light">{children}</MantineProvider>
  );
}

afterEach(() => {
  cleanup();
});

describe("ProjectList", () => {
  it("renders the projects heading", () => {
    render(<ProjectList />, { wrapper: Wrapper });
    expect(screen.getByText("Projects")).toBeInTheDocument();
  });

  it("renders placeholder project names", () => {
    render(<ProjectList />, { wrapper: Wrapper });
    expect(screen.getByText(/repo-alpha/)).toBeInTheDocument();
    expect(screen.getByText(/repo-beta/)).toBeInTheDocument();
  });
});

describe("KanbanBoard", () => {
  it("renders the board heading", () => {
    render(<KanbanBoard />, { wrapper: Wrapper });
    expect(screen.getByText("Board")).toBeInTheDocument();
  });

  it("renders kanban columns", () => {
    render(<KanbanBoard />, { wrapper: Wrapper });
    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });
});

describe("SessionsPanel", () => {
  it("renders the sessions heading", () => {
    render(<SessionsPanel />, { wrapper: Wrapper });
    expect(screen.getByText("Sessions")).toBeInTheDocument();
  });
});
