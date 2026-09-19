#!/usr/bin/env node

const args = process.argv.slice(2).filter((argument) => argument !== "--");
const baseUrl = (args[0] ?? process.env.COP_LOAD_BASE_URL ?? "http://127.0.0.1:4310").replace(/\/$/, "");
const clientCount = positiveInteger(args[1] ?? process.env.COP_LOAD_CLIENTS, 40);
const durationMs = positiveInteger(args[2] ?? process.env.COP_LOAD_DURATION_MS, 8_000);
const token = process.env.COP_LOAD_TOKEN?.trim();
const maxOpenP95Ms = positiveInteger(process.env.COP_LOAD_MAX_OPEN_P95_MS, 5_000);
const rampMs = nonNegativeInteger(process.env.COP_LOAD_RAMP_MS, 0);
const endpoint = `${baseUrl}/api/v1/stream/cop/live`;
const controllers = Array.from({ length: clientCount }, () => new AbortController());
const result = { opened: 0, events: 0, bytes: 0, failed: 0 };
const openDurationsMs = [];
const errors = new Map();

const clients = controllers.map(async (controller, index) => {
  const launchDelayMs = clientCount > 1 ? Math.round((index / (clientCount - 1)) * rampMs) : 0;
  if (launchDelayMs > 0) await delay(launchDelayMs);
  const startedAt = performance.now();
  try {
    const response = await fetch(endpoint, {
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal
    });
    if (!response.ok || !response.body) {
      throw new Error(`HTTP ${response.status}`);
    }
    openDurationsMs.push(performance.now() - startedAt);
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
    if (!isAbortError(error)) {
      result.failed += 1;
      const message = formatError(error);
      errors.set(message, (errors.get(message) ?? 0) + 1);
    }
  }
});

await delay(rampMs + durationMs);
controllers.forEach((controller) => controller.abort());
await Promise.all(clients);

const openedPercent = Math.round((result.opened / clientCount) * 100);
const sortedOpenDurations = openDurationsMs.toSorted((left, right) => left - right);
const openP50Ms = percentile(sortedOpenDurations, 0.5);
const openP95Ms = percentile(sortedOpenDurations, 0.95);
const openP99Ms = percentile(sortedOpenDurations, 0.99);
console.log(
  JSON.stringify(
    {
      ...result,
      clients: clientCount,
      durationMs,
      rampMs,
      endpoint,
      openedPercent,
      openP50Ms,
      openP95Ms,
      openP99Ms,
      maxOpenP95Ms,
      errors: Object.fromEntries([...errors.entries()].sort(([left], [right]) => left.localeCompare(right)))
    },
    null,
    2
  )
);

if (result.failed > 0 || result.opened !== clientCount || openP95Ms > maxOpenP95Ms) {
  process.exitCode = 1;
}

function percentile(sortedValues, ratio) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(sortedValues.length * ratio) - 1));
  return Math.round(sortedValues[index]);
}

function isAbortError(error) {
  return error instanceof Error && (error.name === "AbortError" || error.cause?.name === "AbortError");
}

function formatError(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? `: ${error.cause.message}` : "";
  return `${error.message}${cause}`;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
