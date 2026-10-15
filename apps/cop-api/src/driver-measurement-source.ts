import { contributorIdDay as deriveContributorIdDay, DRIVER_MEASUREMENT_SIM_VERSION } from "./driver-measurement-contract.js";
import { z } from "zod";
import { createHmac } from "node:crypto";

export interface DriverRevocationIdentity {
  subjectId: string;
  contributorDay: string;
  actorSource: "verified_session" | "consent_ledger";
}
export interface DriverRevocationSigning {
  issuer: string;
  actorSecret: string;
  contributorSecret: string;
  now?: () => Date;
}

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
  constructor(readonly statusCode: number, readonly retryAfter?: string, readonly code?: "DRIVER_CONSENT_REVOKED") {
    super("Driver measurement source rejected request.");
  }
}

export interface DriverMeasurementSource {
  send(batch: Record<string, unknown>): Promise<SimDriverReceipt>;
  delete(contributorIdDay: string, identity?: DriverRevocationIdentity): Promise<void>;
}

export class HttpDriverMeasurementSource implements DriverMeasurementSource {
  private readonly root: string;
  private readonly revocation?: DriverRevocationSigning;
  constructor(baseUrl: string, private readonly token: string, private readonly timeoutMs = 10_000, revocation?: DriverRevocationSigning) {
    if (!baseUrl || !token || !/^https?:\/\//.test(baseUrl)) throw new Error("Driver measurement SIM connection is incomplete.");
    this.root = baseUrl.replace(/\/$/, "");
    if (revocation !== undefined) {
      try {
        const issuer = new URL(revocation.issuer);
        if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash ||
          revocation.actorSecret.length < 32 || revocation.contributorSecret.length < 32) throw new Error();
      } catch { throw new Error("Driver revocation signing is incomplete."); }
      this.revocation = { ...revocation };
    }
  }
  private async request(path: string, method: "POST" | "DELETE", body: unknown, actorHeaders: Record<string, string> = {}): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.root}${path}`, {
        method,
        redirect: "error",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json", ...actorHeaders },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs)
      });
    } catch { throw new DriverMeasurementSourceError(503); }
    if (!response.ok) {
      // SIM service authorization is a backend outage, never a client identity failure.
      let revoked = false;
      if (response.status === 403) {
        try {
          const body: unknown = JSON.parse(await readBoundedBody(response, 4096));
          revoked = isRevokedError(body);
        } catch { /* Malformed or oversized upstream errors fail closed. */ }
      } else {
        await response.body?.cancel().catch(() => undefined);
      }
      const status = revoked ? 403 : [400, 409, 413, 429].includes(response.status) ? response.status : 503;
      const retryAfter = response.headers.get("retry-after") ?? undefined;
      throw new DriverMeasurementSourceError(status, retryAfter, revoked ? "DRIVER_CONSENT_REVOKED" : undefined);
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
  async delete(contributorIdDay: string, identity?: DriverRevocationIdentity): Promise<void> {
    const actorHeaders: Record<string, string> = {};
    if (this.revocation) {
      if (!identity || !identity.subjectId || Buffer.byteLength(identity.subjectId) > 512 || /[\u0000-\u001f\u007f-\u009f]/u.test(identity.subjectId) ||
        !["verified_session", "consent_ledger"].includes(identity.actorSource) || !z.iso.date().safeParse(identity.contributorDay).success ||
        !/^[A-Za-z0-9_-]{32,128}$/u.test(contributorIdDay) ||
        contributorIdDay !== deriveContributorIdDay(this.revocation.contributorSecret, identity.subjectId, identity.contributorDay))
        throw new DriverMeasurementSourceError(503);
      const iat = Math.floor((this.revocation.now?.() ?? new Date()).getTime() / 1000);
      if (!Number.isSafeInteger(iat) || iat < 0) throw new DriverMeasurementSourceError(503);
      const claim = { iss: this.revocation.issuer, sub: identity.subjectId, aud: "sim-driver-revocation", iat, exp: iat + 60,
        contributorDay: identity.contributorDay, contributorIdDay, actorSource: identity.actorSource };
      const encoded = Buffer.from(JSON.stringify(claim)).toString("base64url");
      actorHeaders["x-cop-actor"] = encoded;
      actorHeaders["x-cop-actor-signature"] = createHmac("sha256", this.revocation.actorSecret).update(encoded).digest("hex");
    }
    const response = await this.request("/contributions", "DELETE", { contractVersion: DRIVER_MEASUREMENT_SIM_VERSION, contributorIdDay }, actorHeaders);
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new DriverMeasurementSourceError(503);
    }
    try {
      const receipt: unknown = JSON.parse(await readBoundedBody(response, 4096));
      if (!deletionReceiptSchema.safeParse(receipt).success) throw new Error("Invalid deletion receipt.");
    } catch { throw new DriverMeasurementSourceError(503); }
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

const deletionReceiptSchema = z.strictObject({
  contractVersion: z.literal(DRIVER_MEASUREMENT_SIM_VERSION),
  deletedBatchCount: z.number().int().nonnegative()
});

function isRevokedError(value: unknown): boolean {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return !!error && typeof error === "object" && "code" in error && error.code === "DRIVER_CONSENT_REVOKED";
}

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
