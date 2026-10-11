import { AccessToken } from "livekit-server-sdk";
import { createHash } from "node:crypto";
import { readBoundedBody } from "./bounded-upstream.js";
import { VoiceGrantError, type VoiceScopedGrant } from "./voice-grant-ledger.js";

export interface VoiceGrantRevoker {
  /** A durable COP fence alone is never a provider completion proof. */
  revoke(grants: readonly VoiceScopedGrant[], operationId: string): Promise<boolean>;
}

export class UnacceptedVoiceGrantRevoker implements VoiceGrantRevoker {
  async revoke(): Promise<boolean> { return false; }
}

export const VOICE_REVOCATION_CONTROL_ROOM = "cop-voice-grants-control-v1";

export class RemoteVoiceGrantRevoker implements VoiceGrantRevoker {
  private readonly url: string;
  constructor(private readonly options: { baseUrl: string; apiKey: string; apiSecret: string;
    accepted: boolean; fetch?: typeof fetch; timeoutMs?: number }) {
    const url = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error("Voice admission control requires a configured server URL without credentials or query.");
    }
    this.url = url.toString().replace(/\/$/u, "") + "/internal/voice-grants/revoke";
  }
  async revoke(grants: readonly VoiceScopedGrant[], operationId: string): Promise<boolean> {
    if (!this.options.accepted) return false;
    // The gateway bounds requests; app-wide cleanup is split into exact, idempotent batches.
    const batches = grants.length ? Array.from({ length: Math.ceil(grants.length / 128) },
      (_, index) => grants.slice(index * 128, (index + 1) * 128)) : [[]];
    for (const batch of batches) {
      const body = JSON.stringify({ operationId, grants: batch.map(({ identity, room }) => ({ identity, room })) });
      const token = new AccessToken(this.options.apiKey, this.options.apiSecret, { ttl: 30 });
      token.addGrant({ roomAdmin: true, room: VOICE_REVOCATION_CONTROL_ROOM });
      token.metadata = createHash("sha256").update(body).digest("hex");
      try {
        const response = await (this.options.fetch ?? fetch)(this.url, {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(this.options.timeoutMs ?? 10_000),
          headers: { authorization: `Bearer ${await token.toJwt()}`, "content-type": "application/json" }, body
        });
        if (response.status !== 200) { await response.body?.cancel(); throw new VoiceGrantError(503, "VOICE_GRANT_PROVIDER_UNAVAILABLE"); }
        const receipt: unknown = JSON.parse((await readBoundedBody(response, 4_096)).toString("utf8"));
        if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new VoiceGrantError(503, "VOICE_GRANT_PROVIDER_UNAVAILABLE");
        const value = receipt as Record<string, unknown>;
        if (Object.keys(value).length !== 3 || value.contractVersion !== "cop-voice-grant-revocation-v1" ||
            value.operationId !== operationId || typeof value.providerVerified !== "boolean") throw new VoiceGrantError(503, "VOICE_GRANT_PROVIDER_UNAVAILABLE");
        if (!value.providerVerified) return false;
      } catch { throw new VoiceGrantError(503, "VOICE_GRANT_PROVIDER_UNAVAILABLE"); } // No provider bodies or tokens in logs.
    }
    return true;
  }
}
