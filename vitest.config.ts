import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // OTEL packages have native bindings (gRPC) that Vite's import analysis can't handle
  ssr: {
    external: [/^@opentelemetry\//, /^@grpc\//],
  },
  test: {
    projects: [
      {
        test: {
          name: "server",
          include: ["src/server/**/*.test.ts", "src/shared/**/*.test.ts", "src/daemon/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        plugins: [react()],
        test: {
          name: "client",
          include: ["src/client/**/*.test.{ts,tsx}"],
          environment: "jsdom",
          setupFiles: ["./src/test-utils/setup-dom.ts"],
        },
      },
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      exclude: [
        "node_modules/**",
        "dist/**",
        "**/*.test.{ts,tsx}",
        "**/__tests__/**",
        "src/test-utils/**",
        "*.config.{ts,js}",
      ],
    },
  },
});
