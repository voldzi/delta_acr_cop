import { buildServer } from "./server.js";
import { loadAccountErasureRuntime } from "./account-erasure-runtime.js";

const port = Number.parseInt(process.env.COP_API_PORT ?? "4310", 10);
const host = process.env.COP_API_HOST ?? "0.0.0.0";
const backlog = positiveInteger(process.env.COP_API_LISTEN_BACKLOG, 4096);

const erasureRuntime = await loadAccountErasureRuntime();
let app: ReturnType<typeof buildServer>;
try { app = buildServer({ logger: true, ...erasureRuntime.serverOptions }); }
catch (error) { await erasureRuntime.close(); throw error; }
app.addHook("onClose", async () => { await erasureRuntime.close(); });

try {
  await app.listen({ host, port, backlog });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
