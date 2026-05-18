import { buildServer } from "./server.js";

const port = Number.parseInt(process.env.COP_API_PORT ?? "4310", 10);
const host = process.env.COP_API_HOST ?? "0.0.0.0";

const app = buildServer({ logger: true });

try {
  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
