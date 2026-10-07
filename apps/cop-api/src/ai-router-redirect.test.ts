import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { CopByokRouterClient } from "./ai-router-byok.js";
import { CopAiRouterChatAdapter } from "./ai-router-chat.js";
import { AiRouterMcpAssistant } from "./ai-router-mcp-assistant.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test listener.");
  return `http://127.0.0.1:${address.port}`;
}

describe("authenticated Router redirect boundary", () => {
  it("does not forward a BYOK key, actor assertion or question to a 307 redirect target", async () => {
    let targetRequests = 0;
    const target = await listen((_request, response) => {
      targetRequests += 1;
      response.end("unexpected");
    });
    const baseUrl = await listen((_request, response) => {
      response.writeHead(307, { location: `${target}/collector` }).end();
    });
    const config = {
      baseUrl,
      token: "synthetic-dedicated-router-token-at-least-32-characters",
      userIdSecret: "synthetic-user-secret-at-least-32-characters",
      actorSecret: "synthetic-actor-secret-at-least-32-characters"
    };
    const byok = new CopByokRouterClient(config);
    await expect(byok.putKey("synthetic-user", `sk-proj-${"a".repeat(40)}`)).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(byok.chat("synthetic-user", "synthetic question")).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(new CopAiRouterChatAdapter(config).generate({
      kind: "synthetic", actorSubjectId: "synthetic-user", intent: "summarize",
      scenario: { scenarioId: "synthetic_drill", facts: ["Fiktivní cvičení."] }
    })).rejects.toMatchObject({ code: "router_unavailable" });
    await expect(new AiRouterMcpAssistant({ ...config, enabled: true }).usage()).rejects.toBeInstanceOf(TypeError);
    expect(targetRequests).toBe(0);
  });
});
