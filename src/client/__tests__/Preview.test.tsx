import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { render } from "../../test-utils/client.js";
import { PreviewButton } from "../components/PreviewButton";
import { PreviewModal } from "../components/PreviewModal";
import { PreviewPanel } from "../components/PreviewPanel";
import { buildPreviewUrl, buildLocalPreviewUrl, formatDetectionSource } from "../services/preview-hooks";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock ProjectContext
vi.mock("../contexts/ProjectContext.js", () => ({
  useSelectedProject: () => ({
    selectedProject: null,
    selectProject: vi.fn(),
  }),
  ProjectProvider: ({ children }: { children: React.ReactNode }) => children,
}));

beforeEach(() => {
  mockFetch.mockReset();
  // Default: all API calls return empty/minimal responses
  mockFetch.mockImplementation((url: string) => {
    if (url.includes("/api/preview") && url.includes("/qr")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ previewUrl: "https://tunnel.example/preview/acme%2Fwidget/", qrDataUrl: "data:image/png;base64,abc" }),
      });
    }
    if (url.match(/\/api\/preview\/[^/]+$/)) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ projectId: "acme/widget", port: 5173, autoDetected: true, detectedFrom: "vite.config.ts", available: true }),
      });
    }
    if (url === "/api/preview") {
      return Promise.resolve({
        ok: true,
        json: async () => ([{ projectId: "acme/widget", port: 5173, autoDetected: true, detectedFrom: "vite.config.ts" }]),
      });
    }
    if (url === "/api/tunnel") {
      return Promise.resolve({
        ok: true,
        json: async () => ({ status: "running", info: null, shareUrl: "https://tunnel.example", error: null, configured: true }),
      });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

// ── PreviewButton tests ─────────────────────────────────────────────────────

describe("PreviewButton", () => {
  it("renders in disabled state when preview not available", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.match(/\/api\/preview\/[^/]+$/)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ projectId: "acme/widget", port: 0, autoDetected: false, available: false }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<PreviewButton projectId="acme/widget" projectName="acme/widget" />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /preview acme\/widget/i });
      expect(btn).toBeDisabled();
    });
  });

  it("renders in active state when preview is available", async () => {
    render(<PreviewButton projectId="acme/widget" projectName="acme/widget" />);

    await waitFor(() => {
      const btn = screen.getByRole("button", { name: /preview acme\/widget/i });
      expect(btn).not.toBeDisabled();
    });
  });

  it("opens modal on click when preview is available", async () => {
    const user = userEvent.setup();
    render(<PreviewButton projectId="acme/widget" projectName="acme/widget" />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /preview acme\/widget/i })).not.toBeDisabled();
    });

    await user.click(screen.getByRole("button", { name: /preview acme\/widget/i }));

    await waitFor(() => {
      expect(screen.getByText(/Preview — acme\/widget/)).toBeInTheDocument();
    });
  });
});

// ── PreviewModal tests ──────────────────────────────────────────────────────

describe("PreviewModal", () => {
  it("renders modal with project name title", () => {
    render(
      <PreviewModal
        projectId="acme/widget"
        projectName="acme/widget"
        opened={true}
        onClose={() => {}}
      />,
    );

    expect(screen.getByText("Preview — acme/widget")).toBeInTheDocument();
  });

  it("shows port info with detection source", async () => {
    render(
      <PreviewModal
        projectId="acme/widget"
        projectName="acme/widget"
        opened={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Port 5173/)).toBeInTheDocument();
      expect(screen.getByText("Vite")).toBeInTheDocument();
    });
  });

  it("shows QR code when loaded", async () => {
    render(
      <PreviewModal
        projectId="acme/widget"
        projectName="acme/widget"
        opened={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByAltText("Preview QR Code")).toBeInTheDocument();
    });
  });

  it("shows preview URL", async () => {
    render(
      <PreviewModal
        projectId="acme/widget"
        projectName="acme/widget"
        opened={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/tunnel\.example\/preview/)).toBeInTheDocument();
    });
  });

  it("has open in new tab button", async () => {
    render(
      <PreviewModal
        projectId="acme/widget"
        projectName="acme/widget"
        opened={true}
        onClose={() => {}}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Open in new tab")).toBeInTheDocument();
    });
  });
});

// ── PreviewPanel tests ──────────────────────────────────────────────────────

describe("PreviewPanel", () => {
  it("renders heading", () => {
    render(<PreviewPanel />);
    expect(screen.getByText("App Previews")).toBeInTheDocument();
  });

  it("shows empty state when no previews", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/preview") {
        return Promise.resolve({ ok: true, json: async () => [] });
      }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });

    render(<PreviewPanel />);

    await waitFor(() => {
      expect(screen.getByText(/No active previews/)).toBeInTheDocument();
    });
  });

  it("shows preview entries when available", async () => {
    render(<PreviewPanel />);

    await waitFor(() => {
      expect(screen.getByText("acme/widget")).toBeInTheDocument();
      expect(screen.getByText(":5173")).toBeInTheDocument();
    });
  });

  it("shows count badge for active previews", async () => {
    render(<PreviewPanel />);

    await waitFor(() => {
      expect(screen.getByText("1")).toBeInTheDocument();
    });
  });
});

// ── Helper function tests ───────────────────────────────────────────────────

describe("buildPreviewUrl", () => {
  it("returns null when tunnel has no shareUrl", () => {
    expect(buildPreviewUrl({ status: "stopped", info: null, shareUrl: null, error: null, configured: false }, "acme/widget")).toBeNull();
  });

  it("builds correct URL with tunnel shareUrl", () => {
    const tunnel = { status: "running" as const, info: null, shareUrl: "https://tunnel.example", error: null, configured: true };
    expect(buildPreviewUrl(tunnel, "acme/widget")).toBe("https://tunnel.example/preview/acme%2Fwidget/");
  });

  it("strips trailing slash from shareUrl", () => {
    const tunnel = { status: "running" as const, info: null, shareUrl: "https://tunnel.example/", error: null, configured: true };
    expect(buildPreviewUrl(tunnel, "acme/widget")).toBe("https://tunnel.example/preview/acme%2Fwidget/");
  });
});

describe("buildLocalPreviewUrl", () => {
  it("returns a relative preview path", () => {
    expect(buildLocalPreviewUrl("acme/widget")).toBe("/preview/acme%2Fwidget/");
  });

  it("encodes special characters in projectId", () => {
    expect(buildLocalPreviewUrl("org/my repo")).toBe("/preview/org%2Fmy%20repo/");
  });
});

describe("formatDetectionSource", () => {
  it("returns null for undefined", () => {
    expect(formatDetectionSource(undefined)).toBeNull();
  });

  it("detects Vite", () => {
    expect(formatDetectionSource("vite.config.ts")).toBe("Vite");
  });

  it("detects Next.js", () => {
    expect(formatDetectionSource("next.config.js")).toBe("Next.js");
  });

  it("detects Webpack", () => {
    expect(formatDetectionSource("webpack.config.js")).toBe("Webpack");
  });

  it("returns raw string for unknown source", () => {
    expect(formatDetectionSource("parcel")).toBe("parcel");
  });
});
