import { cleanup, render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach } from "vitest";
import type { ReactNode } from "react";
import { ProjectProvider } from "../client/contexts/ProjectContext.js";
import { SessionProvider } from "../client/contexts/SessionContext.js";
import { WebSocketProvider } from "../client/contexts/WebSocketContext.js";
import { ThemeProvider } from "../client/contexts/ThemeContext.js";

afterEach(() => {
  cleanup();
});

/**
 * Wrapper that provides Mantine, QueryClient, Theme, WebSocket, and ProjectContext for component tests.
 */
function TestProviders({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return (
    <QueryClientProvider client={queryClient}>
      <MantineProvider defaultColorScheme="light">
        <ThemeProvider>
          <WebSocketProvider url="ws://localhost:0/ws">
            <ProjectProvider>
              <SessionProvider>{children}</SessionProvider>
            </ProjectProvider>
          </WebSocketProvider>
        </ThemeProvider>
      </MantineProvider>
    </QueryClientProvider>
  );
}

/**
 * Custom render that wraps components in required providers.
 */
function renderWithProviders(
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  return render(ui, { wrapper: TestProviders, ...options });
}

export { renderWithProviders as render, TestProviders };
