import { DRIVER_MEASUREMENT_SIM_VERSION } from "./driver-measurement-contract.js";
import { z } from "zod";

export interface SimDriverReceipt {
  contractVersion: string;
  batchId: string;
  receivedAt: string;
  acceptedIntervalCount: number;
  deduplicatedIntervalCount: number;
  rejectionCounts: Record<string, number>;
  etaAccepted: boolean;
  applicationMode: "shadow_only";
  rawPositionsStored: false;
}

export class DriverMeasurementSourceError extends Error {
  constructor(readonly statusCode: number, readonly retryAfter?: string) { super("Driver measurement source rejected request."); }
}

export interface DriverMeasurementSource {
  send(batch: Record<string, unknown>): Promise<SimDriverReceipt>;
  delete(contributorIdDay: string): Promise<void>;
}

export class HttpDriverMeasurementSource implements DriverMeasurementSource {
  private readonly root: string;
  constructor(baseUrl: string, private readonly token: string, private readonly timeoutMs = 10_000) {
    if (!baseUrl || !token || !/^https?:\/\//.test(baseUrl)) throw new Error("Driver measurement SIM connection is incomplete.");
    this.root = baseUrl.replace(/\/$/, "");
  }
  private async request(path: string, method: "POST" | "DELETE", body: unknown): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.root}${path}`, {
        method,
        redirect: "error",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch { throw new DriverMeasurementSourceError(503); }
    if (!response.ok) {
      // SIM service authorization is a backend outage, never a client identity failure.
      const status = [400, 409, 413, 429].includes(response.status) ? response.status : 503;
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      await response.body?.cancel().catch(() => undefined);
      throw new DriverMeasurementSourceError(status, retryAfter);
    }
    return response;
  }
  async send(batch: Record<string, unknown>): Promise<SimDriverReceipt> {
    const response = await this.request("/batches", "POST", batch);
    let receipt: unknown;
    try { receipt = JSON.parse(await readBoundedBody(response, 65_536)); }
    catch { throw new DriverMeasurementSourceError(503); }
    const parsed = receiptSchema.safeParse(receipt);
    if (!parsed.success || parsed.data.batchId !== batch.batchId) throw new DriverMeasurementSourceError(503);
    return parsed.data;
  }
  async delete(contributorIdDay: string): Promise<void> {
    const response = await this.request("/contributions", "DELETE", { contractVersion: DRIVER_MEASUREMENT_SIM_VERSION, contributorIdDay });
    await response.body?.cancel();
  }
}

const receiptSchema = z.strictObject({
  contractVersion: z.literal(DRIVER_MEASUREMENT_SIM_VERSION),
  batchId: z.uuid(),
  receivedAt: z.iso.datetime({ offset: false }),
  acceptedIntervalCount: z.number().int().nonnegative(),
  deduplicatedIntervalCount: z.number().int().nonnegative(),
  rejectionCounts: z.record(z.string(), z.number().int().nonnegative()),
  etaAccepted: z.boolean(),
  applicationMode: z.literal("shadow_only"),
  rawPositionsStored: z.literal(false)
});

async function readBoundedBody(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing response body.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error("Response too large.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  return Buffer.concat(chunks, total).toString("utf8");
}
