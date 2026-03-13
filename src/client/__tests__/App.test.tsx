import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../App";

describe("App component", () => {
  it("renders the heading", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { level: 3 }),
    ).toHaveTextContent(/launchpad-hq/);
  });

  it("renders the dashboard panes", () => {
    render(<App />);
    expect(screen.getByText(/projects/i)).toBeInTheDocument();
    expect(screen.getByText(/board/i)).toBeInTheDocument();
    expect(screen.getByText(/sessions/i)).toBeInTheDocument();
  });
});
