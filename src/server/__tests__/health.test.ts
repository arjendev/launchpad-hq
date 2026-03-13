import { describe, it, expect } from "vitest";
import { createTestServer } from "../../test-utils/index.js";
import healthRoutes from "../routes/health.js";

describe("Health endpoint", () => {
  it("GET /api/health returns status ok", async () => {
    const server = await createTestServer();
    await server.register(healthRoutes);

    const response = await server.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body).toHaveProperty("status", "ok");
    expect(body).toHaveProperty("uptime");
  });

  it("uptime is a positive number", async () => {
    const server = await createTestServer();
    await server.register(healthRoutes);

    const response = await server.inject({
      method: "GET",
      url: "/api/health",
    });

    const body = response.json();
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThan(0);
  });
});
