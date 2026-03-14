import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { SessionProvider, useSelectedSession } from "../contexts/SessionContext.js";
import type { AggregatedSession } from "../services/types.js";

const mockResumeMutate = vi.fn();
const mockDisconnectMutate = vi.fn();
let mockSelectedProject = {
  owner: "owner",
  repo: "repo",
};

vi.mock("../services/hooks.js", () => ({
  useDisconnectSession: () => ({ mutate: mockDisconnectMutate }),
  useResumeSession: () => ({ mutate: mockResumeMutate }),
}));

vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: mockSelectedProject,
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const sdkSession: AggregatedSession = {
  sessionId: "sdk-session-1",
  sessionType: "copilot-sdk",
  status: "idle",
  startedAt: Date.now(),
  updatedAt: Date.now(),
  activity: { phase: "idle", intent: null, activeToolCalls: [], activeSubagents: [], backgroundTasks: [], waitingState: null, tokenUsage: null, turnCount: 0 },
};

const cliSession: AggregatedSession = {
  sessionId: "cli-session-1",
  sessionType: "copilot-cli",
  status: "idle",
  startedAt: Date.now(),
  updatedAt: Date.now(),
  activity: { phase: "idle", intent: null, activeToolCalls: [], activeSubagents: [], backgroundTasks: [], waitingState: null, tokenUsage: null, turnCount: 0 },
};

function Harness() {
  const { selectSession } = useSelectedSession();
  return (
    <>
      <button type="button" onClick={() => selectSession(sdkSession, { resume: false })}>
        select-sdk-without-resume
      </button>
      <button type="button" onClick={() => selectSession(sdkSession)}>
        select-sdk-with-resume
      </button>
      <button type="button" onClick={() => selectSession(cliSession, { resume: false })}>
        select-cli-without-resume
      </button>
      <button type="button" onClick={() => selectSession(null)}>
        clear-selection
      </button>
    </>
  );
}

describe("SessionContext", () => {
  beforeEach(() => {
    mockResumeMutate.mockReset();
    mockDisconnectMutate.mockReset();
    mockSelectedProject = {
      owner: "owner",
      repo: "repo",
    };
  });

  it("skips resume when explicitly selecting a freshly created session", async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-sdk-without-resume" }));

    expect(mockResumeMutate).not.toHaveBeenCalled();
    expect(mockDisconnectMutate).not.toHaveBeenCalled();
  });

  it("resumes when selecting an existing session normally", async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-sdk-with-resume" }));

    expect(mockResumeMutate).toHaveBeenCalledWith({ sessionId: "sdk-session-1" });
  });

  it("does not disconnect an SDK session when switching to another session", async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-sdk-without-resume" }));
    await user.click(screen.getByRole("button", { name: "select-cli-without-resume" }));

    expect(mockDisconnectMutate).not.toHaveBeenCalled();
  });

  it("disconnects a CLI session when clearing the selection", async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-cli-without-resume" }));
    await user.click(screen.getByRole("button", { name: "clear-selection" }));

    expect(mockDisconnectMutate).toHaveBeenCalledWith("cli-session-1");
  });

  it("does not disconnect an SDK session when the project changes", async () => {
    const user = userEvent.setup();
    const ui = render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-sdk-without-resume" }));

    mockSelectedProject = {
      owner: "other",
      repo: "repo",
    };
    ui.rerender(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    expect(mockDisconnectMutate).not.toHaveBeenCalled();
  });
});
