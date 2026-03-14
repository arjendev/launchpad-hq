import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { SessionProvider, useSelectedSession } from "../contexts/SessionContext.js";
import type { AggregatedSession } from "../services/types.js";

const mockResumeMutate = vi.fn();
const mockDisconnectMutate = vi.fn();

vi.mock("../services/hooks.js", () => ({
  useDisconnectSession: () => ({ mutate: mockDisconnectMutate }),
  useResumeSession: () => ({ mutate: mockResumeMutate }),
}));

vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: {
      owner: "owner",
      repo: "repo",
    },
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

const session: AggregatedSession = {
  sessionId: "sdk-session-1",
  sessionType: "copilot-sdk",
  status: "idle",
  startedAt: Date.now(),
  updatedAt: Date.now(),
};

function Harness() {
  const { selectSession } = useSelectedSession();
  return (
    <>
      <button type="button" onClick={() => selectSession(session, { resume: false })}>
        select-without-resume
      </button>
      <button type="button" onClick={() => selectSession(session)}>
        select-with-resume
      </button>
    </>
  );
}

describe("SessionContext", () => {
  beforeEach(() => {
    mockResumeMutate.mockReset();
    mockDisconnectMutate.mockReset();
  });

  it("skips resume when explicitly selecting a freshly created session", async () => {
    const user = userEvent.setup();
    render(
      <SessionProvider>
        <Harness />
      </SessionProvider>,
    );

    await user.click(screen.getByRole("button", { name: "select-without-resume" }));

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

    await user.click(screen.getByRole("button", { name: "select-with-resume" }));

    expect(mockResumeMutate).toHaveBeenCalledWith({ sessionId: "sdk-session-1" });
  });
});
