import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import settingsRoutes from "../settings.js";
import { LocalStateManager } from "../../state/local-state-manager.js";
import type { LaunchpadConfig, StateService } from "../../state/types.js";
import { defaultLaunchpadConfig } from "../../state/types.js";
import * as launchpadConfigModule from "../../state/launchpad-config.js";

let tmpDir: string;
let configPath: string;
let currentConfig: LaunchpadConfig;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "lp-settings-test-"));
  configPath = join(tmpDir, "config.json");
  currentConfig = { ...defaultLaunchpadConfig(), onboardingComplete: true };
  writeFileSync(configPath, JSON.stringify(currentConfig, null, 2));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function buildServer(): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });

  vi.spyOn(launchpadConfigModule, "loadLaunchpadConfig").mockResolvedValue({
    ...currentConfig,
  });
  vi.spyOn(launchpadConfigModule, "saveLaunchpadConfig").mockImplementation(
    async (config) => {
      currentConfig = config;
    },
  );
  vi.spyOn(launchpadConfigModule, "saveBootstrapConfig").mockResolvedValue(undefined);

  const localManager = new LocalStateManager({ root: join(tmpDir, "state") });
  await localManager.sync();

  server.decorate("stateService", localManager as StateService);
  server.decorate("launchpadConfig", { ...currentConfig });
  server.decorate("githubToken", "ghp_fake");
  server.decorate("githubUser", { login: "testuser" });

  const reinitSpy = vi.fn(async (config: LaunchpadConfig) => {
    const newLocal = new LocalStateManager({ root: join(tmpDir, "state2") });
    await newLocal.sync();
    server.stateService = newLocal;
    server.launchpadConfig = config;
  });
  server.decorate("reinitializeStateService", reinitSpy);

  await server.register(settingsRoutes);
  await server.ready();

  return server;
}

describe("GET /api/settings", () => {
  it("returns the current launchpadConfig from the server", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "GET",
      url: "/api/settings",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.onboardingComplete).toBe(true);
    expect(body.stateMode).toBe("local");

    await server.close();
  });
});

describe("PUT /api/settings — state mode hot-swap", () => {
  it("calls reinitializeStateService when stateMode changes", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { stateMode: "git", stateRepo: "testuser/launchpad-state" },
    });

    expect(response.statusCode).toBe(200);

    const body = response.json();
    expect(body.stateMode).toBe("git");
    expect(body.stateRepo).toBe("testuser/launchpad-state");

    const reinitFn = server.reinitializeStateService as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(reinitFn).toHaveBeenCalledOnce();
    const calledWith = reinitFn.mock.calls[0][0] as LaunchpadConfig;
    expect(calledWith.stateMode).toBe("git");

    await server.close();
  });

  it("does NOT call reinitializeStateService when stateMode stays the same", async () => {
    currentConfig.stateMode = "local";
    const server = await buildServer();

    const response = await server.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { stateMode: "local" },
    });

    expect(response.statusCode).toBe(200);

    const reinitFn = server.reinitializeStateService as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(reinitFn).not.toHaveBeenCalled();

    await server.close();
  });

  it("does NOT call reinitializeStateService for non-stateMode changes", async () => {
    const server = await buildServer();

    const response = await server.inject({
      method: "PUT",
      url: "/api/settings",
      payload: {
        copilot: { defaultSessionType: "cli", defaultModel: "gpt-4" },
      },
    });

    expect(response.statusCode).toBe(200);

    const reinitFn = server.reinitializeStateService as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(reinitFn).not.toHaveBeenCalled();

    await server.close();
  });

  it("returns updated config even if reinitialize fails", async () => {
    const server = await buildServer();

    (
      server.reinitializeStateService as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error("sync failed"));

    const response = await server.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { stateMode: "git", stateRepo: "testuser/launchpad-state" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.stateMode).toBe("git");

    await server.close();
  });
});
