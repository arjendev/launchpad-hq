import type { FastifyPluginAsync } from "fastify";
import { randomUUID } from "node:crypto";
import type { CommandAction, CopilotAgentCatalogEntry } from "../../shared/protocol.js";

/** Build daemon ID from route params */
function did(params: { owner: string; repo: string }): string {
  return `${params.owner}/${params.repo}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentKind(value: unknown): value is CopilotAgentCatalogEntry["kind"] {
  return value === "default" || value === "custom";
}

function isAgentSource(value: unknown): value is CopilotAgentCatalogEntry["source"] {
  return value === "builtin" || value === "github-agent-file";
}

function trimString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function trimStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const trimmed = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return trimmed.length > 0 ? trimmed : undefined;
}

function defaultAgentKind(id: string): CopilotAgentCatalogEntry["kind"] {
  return id === "builtin:default" ? "default" : "custom";
}

function defaultAgentSource(
  kind: CopilotAgentCatalogEntry["kind"],
): CopilotAgentCatalogEntry["source"] {
  return kind === "default" ? "builtin" : "github-agent-file";
}

function normalizeAgentCatalog(raw: unknown): CopilotAgentCatalogEntry[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry === "string") {
      const name = entry.trim();
      if (!name) return [];
      const kind = defaultAgentKind(name);
      return [{
        id: name,
        name,
        displayName: name,
        description: "",
        kind,
        source: defaultAgentSource(kind),
      }];
    }

    if (!isRecord(entry)) {
      return [];
    }

    const id = trimString(entry.id) ?? trimString(entry.name);
    const name = trimString(entry.name) ?? trimString(entry.id);
    if (!id || !name) return [];

    const displayName = trimString(entry.displayName) ?? name;
    const description = typeof entry.description === "string" ? entry.description : "";
    const kind = isAgentKind(entry.kind) ? entry.kind : defaultAgentKind(id);
    const source = isAgentSource(entry.source) ? entry.source : defaultAgentSource(kind);
    const path = trimString(entry.path);
    const model = trimString(entry.model);
    const tools = trimStringArray(entry.tools);
    const target = trimString(entry.target);

    return [{
      id,
      name,
      displayName,
      description,
      kind,
      source,
      ...(path ? { path } : {}),
      ...(model ? { model } : {}),
      ...(tools ? { tools } : {}),
      ...(typeof entry.userInvocable === "boolean" ? { userInvocable: entry.userInvocable } : {}),
      ...(target ? { target } : {}),
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
        !agents.some((agent) => agent.id === preferredAgent || agent.name === preferredAgent)
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

  /** GET /api/daemons/:owner/:repo/copilot/sessions — list available SDK sessions (for resume picker) */
  server.get<{ Params: { owner: string; repo: string } }>(
    "/api/daemons/:owner/:repo/copilot/sessions",
    async (request, reply) => {
      const id = did(request.params);
      const daemon = server.daemonRegistry.getDaemon(id);
      if (!daemon || daemon.state !== "connected") {
        return reply.status(404).send({ error: "not_found", message: "Daemon not connected" });
      }

      const requestId = randomUUID();
      const sent = server.daemonRegistry.sendToDaemon(id, {
        type: "copilot-list-sessions",
        timestamp: Date.now(),
        payload: { requestId },
      });
      if (!sent) {
        return reply.status(502).send({ error: "send_failed", message: "Daemon not reachable" });
      }

      try {
        const result = await server.copilotAggregator.waitForResponse<{ sessions: unknown[] }>(requestId, 10_000);
        return reply.send(result);
      } catch {
        return reply.status(504).send({ error: "timeout", message: "Daemon did not respond in time" });
      }
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
