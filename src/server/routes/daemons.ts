import type { FastifyPluginAsync } from "fastify";
import type { CommandAction } from "../../shared/protocol.js";

/** Build daemon ID from route params */
function did(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

interface CopilotAgentCatalogEntry {
  name: string;
  displayName: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAgentCatalog(raw: unknown): CopilotAgentCatalogEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (!name) return [];
      return [{ name, displayName: name, description: "" }];
    }

    if (!isRecord(entry) || typeof entry.name !== "string") {
      return [];
    }

    const name = entry.name.trim();
    if (!name) return [];

    return [{
      name,
      displayName:
        typeof entry.displayName === "string" && entry.displayName.trim().length > 0
          ? entry.displayName.trim()
          : name,
      description: typeof entry.description === "string" ? entry.description : "",
    }];
  });
}

function extractCopilotAgents(daemon: { info: unknown } | undefined): CopilotAgentCatalogEntry[] {
  const info = isRecord(daemon?.info) ? daemon.info : null;
  if (!info) return [];

  const copilot = isRecord(info.copilot) ? info.copilot : null;
  const candidates = [
    info.copilotSdkAgents,
    info.copilotAgents,
    info.availableAgents,
    info.agentCatalog,
    copilot?.agents,
    copilot?.availableAgents,
    copilot?.agentCatalog,
  ];

  for (const candidate of candidates) {
    const agents = normalizeAgentCatalog(candidate);
    if (agents.length > 0) {
      return agents;
    }
  }

  return [];
}

const daemonRoutes: FastifyPluginAsync = async (server) => {
  /** GET /api/daemons — list all connected daemons */
  server.get("/api/daemons", async (_request, reply) => {
    const daemons = server.daemonRegistry.getAllDaemons();
    return reply.send(daemons);
  });

  /** GET /api/daemons/:owner/:repo — get detailed daemon info */
  server.get<{ Params: { owner: string; repo: string } }>("/api/daemons/:owner/:repo", async (request, reply) => {
    const id = did(request.params);
    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: "not_found", message: "Daemon not found" });
    }
    return reply.send({
      daemonId: daemon.daemonId,
      projectId: daemon.info.projectId,
      projectName: daemon.info.projectName,
      runtimeTarget: daemon.info.runtimeTarget,
      state: daemon.state,
      connectedAt: daemon.connectedAt,
      lastHeartbeat: daemon.lastHeartbeat,
      disconnectedAt: daemon.disconnectedAt,
      version: daemon.info.version,
      capabilities: daemon.info.capabilities,
      protocolVersion: daemon.info.protocolVersion,
    });
  });

  /** GET /api/daemons/:owner/:repo/copilot/agents — agent catalog + remembered preference */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/daemons/:owner/:repo/copilot/agents",
    async (request, reply) => {
      const id = did(request.params);
      const preferredAgent = await server.stateService.getProjectDefaultCopilotAgent(
        request.params.owner,
        request.params.repo,
      );

      if (preferredAgent === undefined) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${id} is not being tracked.`,
        });
      }

      const daemon = server.daemonRegistry.getDaemon(id);
      return reply.send({
        projectId: id,
        daemonOnline: daemon?.state === "connected",
        preferredAgent,
        agents: extractCopilotAgents(daemon),
      });
    },
  );

  /** PUT /api/daemons/:owner/:repo/copilot/agents — update remembered preference */
  server.put<{
    Params: { owner: string; repo: string };
    Body: { preferredAgent: string | null };
  }>(
    "/api/daemons/:owner/:repo/copilot/agents",
    async (request, reply) => {
      const id = did(request.params);
      const body = request.body as { preferredAgent?: unknown } | undefined;

      if (!body || !Object.prototype.hasOwnProperty.call(body, "preferredAgent")) {
        return reply.status(400).send({
          error: "bad_request",
          message: "Missing 'preferredAgent' field",
        });
      }

      if (body.preferredAgent !== null && typeof body.preferredAgent !== "string") {
        return reply.status(400).send({
          error: "bad_request",
          message: "'preferredAgent' must be a string or null",
        });
      }

      const preferredAgent =
        typeof body.preferredAgent === "string" ? body.preferredAgent.trim() : null;

      if (preferredAgent === "") {
        return reply.status(400).send({
          error: "bad_request",
          message: "'preferredAgent' cannot be an empty string. Use null for the default agent.",
        });
      }

      const daemon = server.daemonRegistry.getDaemon(id);
      const agents = extractCopilotAgents(daemon);
      if (
        preferredAgent &&
        agents.length > 0 &&
        !agents.some((agent) => agent.name === preferredAgent)
      ) {
        return reply.status(400).send({
          error: "bad_request",
          message: `Agent '${preferredAgent}' is not available for ${id}.`,
        });
      }

      const updated = await server.stateService.updateProjectDefaultCopilotAgent(
        request.params.owner,
        request.params.repo,
        preferredAgent,
      );

      if (!updated) {
        return reply.status(404).send({
          error: "not_found",
          message: `Project ${id} is not being tracked.`,
        });
      }

      return reply.send({
        ok: true,
        projectId: id,
        daemonOnline: daemon?.state === "connected",
        preferredAgent: updated.defaultCopilotSdkAgent ?? null,
        agents,
      });
    },
  );

  /** POST /api/daemons/:owner/:repo/command — send command to a specific daemon */
  server.post<{
    Params: { owner: string; repo: string };
    Body: { action: CommandAction; args?: Record<string, unknown> };
  }>("/api/daemons/:owner/:repo/command", async (request, reply) => {
    const id = did(request.params);
    const { action, args } = request.body ?? {};

    if (!action) {
      return reply.status(400).send({ error: "bad_request", message: "Missing 'action' field" });
    }

    const daemon = server.daemonRegistry.getDaemon(id);
    if (!daemon) {
      return reply.status(404).send({ error: "not_found", message: "Daemon not found" });
    }

    const sent = server.daemonRegistry.sendToDaemon(id, {
      type: "command",
      timestamp: Date.now(),
      payload: {
        projectId: daemon.info.projectId,
        action,
        args,
      },
    });

    if (!sent) {
      return reply.status(502).send({ error: "send_failed", message: "Daemon not connected" });
    }

    return reply.send({ ok: true });
  });
};

export default daemonRoutes;
