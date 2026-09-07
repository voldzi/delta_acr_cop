#!/usr/bin/env node

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const baseUrl = (args[0] ?? process.env.COP_LOAD_BASE_URL ?? "http://127.0.0.1:4310").replace(/\/$/, "");
const clientCount = positiveInteger(args[1] ?? process.env.COP_LOAD_CLIENTS, 40);
const durationMs = positiveInteger(args[2] ?? process.env.COP_LOAD_DURATION_MS, 8_000);
const token = process.env.COP_LOAD_TOKEN?.trim();
const endpoint = `${baseUrl}/api/v1/stream/cop/live`;
const controllers = Array.from({ length: clientCount }, () => new AbortController());
const result = { opened: 0, events: 0, bytes: 0, failed: 0 };

const clients = controllers.map(async (controller) => {
  try {
    const response = await fetch(endpoint, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    result.opened += 1;
    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let pending = "";
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      result.bytes += chunk.value.byteLength;
      pending += decoder.decode(chunk.value, { stream: true });
      const frames = pending.split("\n\n");
      pending = frames.pop() ?? "";
      result.events += frames.filter((frame) => frame.includes("data:")).length;
    }
  } catch (error) {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      result.failed += 1;
      console.error(error instanceof Error ? error.message : String(error));
    }
  }
});

await new Promise((resolve) => setTimeout(resolve, durationMs));
controllers.forEach((controller) => controller.abort());
await Promise.all(clients);

const openedPercent = Math.round((result.opened / clientCount) * 100);
console.log(
  JSON.stringify(
    {
      ...result,
      clients: clientCount,
      durationMs,
      endpoint,
      openedPercent
    },
    null,
    2
  )
);

if (result.failed > 0 || result.opened !== clientCount) {
  process.exitCode = 1;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
