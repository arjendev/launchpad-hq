import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import type { LaunchpadConfig, TunnelState } from "../services/types.js";
import { OnboardingPage } from "../pages/OnboardingPage.js";
import { SettingsPage } from "../pages/SettingsPage.js";

const mockNavigate = vi.fn();
const mockMutate = vi.fn();
const mockValidateRepoMutate = vi.fn();
const mockValidateRepoReset = vi.fn();

let mockSettings: LaunchpadConfig;
let mockTunnelState: TunnelState | null;
let mockTunnelLoading = false;
let mockWsTunnelState: TunnelState | null = null;

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../services/hooks.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/hooks.js")>();
  return {
    ...actual,
    useSettings: () => ({ data: mockSettings, isLoading: false }),
    useUpdateSettings: () => ({
      mutate: mockMutate,
      isPending: false,
      isError: false,
      error: null,
      isSuccess: false,
      reset: vi.fn(),
    }),
    useListModels: () => ({ data: { models: [] } }),
    useValidateRepo: () => ({
      mutate: mockValidateRepoMutate,
      reset: mockValidateRepoReset,
      isPending: false,
      isSuccess: false,
      isError: false,
      data: null,
      error: null,
    }),
    useTunnelStatus: () => ({
      data: mockTunnelState,
      isLoading: mockTunnelLoading,
    }),
  };
});

vi.mock("../contexts/WebSocketContext.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../contexts/WebSocketContext.js")>();
  return {
    ...actual,
    useSubscription: () => ({ data: mockWsTunnelState, status: "connected" as const }),
  };
});

function buildSettings(overrides?: Partial<LaunchpadConfig>): LaunchpadConfig {
  return {
    version: 1,
    stateMode: "local",
    copilot: {
      defaultSessionType: "sdk",
      defaultModel: "claude-opus-4.6",
    },
    tunnel: {
      mode: "on-demand",
      configured: false,
    },
    onboardingComplete: false,
    ...overrides,
  };
}

function buildTunnelState(overrides?: Partial<TunnelState>): TunnelState {
  return {
    status: "stopped",
    info: null,
    shareUrl: null,
    error: null,
    configured: false,
    ...overrides,
  };
}

beforeEach(() => {
  mockNavigate.mockReset();
  mockMutate.mockReset();
  mockValidateRepoMutate.mockReset();
  mockValidateRepoReset.mockReset();
  mockSettings = buildSettings();
  mockTunnelState = buildTunnelState();
  mockTunnelLoading = false;
  mockWsTunnelState = null;
});

describe("OnboardingPage", () => {
  it("highlights the configured Copilot session type the first time the step renders", async () => {
    mockSettings = buildSettings({
      copilot: {
        defaultSessionType: "cli",
        defaultModel: "claude-opus-4.6",
      },
    });

    const user = userEvent.setup();
    render(<OnboardingPage />);

    await user.click(screen.getByRole("button", { name: /next/i }));

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: /cli mode/i })).toBeChecked();
    });
  });

  it("shows the active tunnel URL in onboarding when always-on tunnel is already running", async () => {
    const runningTunnel = buildTunnelState({
      status: "running",
      configured: true,
      info: {
        url: "https://launchpad.example.dev",
        tunnelId: "tunnel-123",
        port: 3000,
      },
      shareUrl: "https://launchpad.example.dev",
    });

    mockSettings = buildSettings({
      tunnel: {
        mode: "always",
        configured: true,
      },
    });
    mockTunnelState = runningTunnel;

    const user = userEvent.setup();
    render(<OnboardingPage />);

    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByText(/https:\/\/launchpad\.example\.dev/i)).toBeInTheDocument();
  });
});

describe("SettingsPage", () => {
  it("shows a loading state instead of 'not configured' while checking an always-on tunnel", () => {
    mockSettings = buildSettings({
      tunnel: {
        mode: "always",
        configured: true,
      },
    });
    mockTunnelState = null;
    mockTunnelLoading = true;

    render(<SettingsPage />);

    expect(screen.getByText("Checking…")).toBeInTheDocument();
    expect(screen.queryByText("Not configured")).not.toBeInTheDocument();
  });

  it("does not show duplicate tunnel success alerts when the tunnel is already running", async () => {
    const runningTunnel = buildTunnelState({
      status: "running",
      configured: true,
      info: {
        url: "https://launchpad.example.dev",
        tunnelId: "tunnel-123",
        port: 3000,
      },
      shareUrl: "https://launchpad.example.dev",
    });

    mockSettings = buildSettings({
      tunnel: {
        mode: "on-demand",
        configured: true,
      },
    });
    mockTunnelState = runningTunnel;
    mockWsTunnelState = runningTunnel;

    const user = userEvent.setup();
    render(<SettingsPage />);

    await user.click(screen.getByRole("radio", { name: /^Always$/i }));

    expect(await screen.findByText(/Tunnel URL:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tunnel started!/i)).not.toBeInTheDocument();
  });
});
