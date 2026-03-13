import Fastify from "fastify";

const server = Fastify({ logger: true });

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";

server.get("/api/health", async () => {
  return { status: "ok", timestamp: new Date().toISOString() };
});

async function start() {
  try {
    await server.listen({ port: PORT, host: HOST });
    console.log(`🚀 launchpad-hq server running on http://${HOST}:${PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

start();
