import Fastify, { type FastifyInstance } from "fastify";
import { MantineProvider } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * Create a lightweight Fastify instance for testing with `inject()`.
 * Caller is responsible for registering routes/plugins before calling inject.
 */
export async function createTestServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  return server;
}

/**
 * Wrapper that provides Mantine context for component tests.
 */
export function TestProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider defaultColorScheme="light">{children}</MantineProvider>
  );
}

export { type FastifyInstance };
