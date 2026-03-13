import { cleanup, render, type RenderOptions } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { afterEach } from "vitest";
import type { ReactNode } from "react";

afterEach(() => {
  cleanup();
});

/**
 * Wrapper that provides Mantine context for component tests.
 */
function TestProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider defaultColorScheme="light">{children}</MantineProvider>
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
