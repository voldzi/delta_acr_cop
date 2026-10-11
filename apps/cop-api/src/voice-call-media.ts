import { AccessToken } from "livekit-server-sdk";
import { createHmac } from "node:crypto";
import type { AuthenticatedActor } from "./security.js";
import type { VoiceCallRecord } from "./voice-call-store.js";
import { VoiceGrantError, type VoiceGrantLedger } from "./voice-grant-ledger.js";

export interface VoiceCallMediaCredentials {
  e2eeKey: string;
  expiresAt: string;
  participantIdentity?: string;
  serverUrl: string;
  token: string;
}

export interface VoiceCallMediaIssuer {
  readonly enabled: boolean;
  issue(record: VoiceCallRecord, actor: AuthenticatedActor, now: Date, installationId?: string): Promise<VoiceCallMediaCredentials>;
}

export class DisabledVoiceCallMediaIssuer implements VoiceCallMediaIssuer {
  readonly enabled = false;

  async issue(): Promise<VoiceCallMediaCredentials> {
    throw new Error("Native voice-call media is not configured.");
  }
}

export class LiveKitVoiceCallMediaIssuer implements VoiceCallMediaIssuer {
  readonly enabled = true;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly e2eeSecret: string;
  private readonly publicUrl: string;
  private readonly tokenTtlSeconds: number;
  private readonly ledger?: VoiceGrantLedger;
  private readonly dedicatedClientId?: string;

  constructor(options: {
    apiKey: string;
    apiSecret: string;
    e2eeSecret: string;
    publicUrl: string;
    tokenTtlSeconds?: number;
    ledger?: VoiceGrantLedger;
    dedicatedClientId?: string;
  }) {
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.e2eeSecret = options.e2eeSecret;
    this.publicUrl = normalizeLiveKitURL(options.publicUrl);
    this.tokenTtlSeconds = Math.max(60, Math.min(3_600, options.tokenTtlSeconds ?? 600));
    this.ledger = options.ledger;
    this.dedicatedClientId = options.dedicatedClientId ?? options.ledger?.options.clientId;
  }

  async issue(
    record: VoiceCallRecord,
    actor: AuthenticatedActor,
    now: Date,
    installationId?: string
  ): Promise<VoiceCallMediaCredentials> {
    const scoped = this.ledger?.owns(actor) || (!!this.dedicatedClientId && actor.authorizedParty === this.dedicatedClientId);
    if (scoped && (!this.ledger || !installationId)) throw new VoiceGrantError(503, "VOICE_GRANTS_UNAVAILABLE");
    const grant = scoped ? await this.ledger!.issueGrant(actor, installationId!, record.callId, liveKitRoomName(record.callId), now) : undefined;
    const identity = grant?.identity ?? actor.subjectId;
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      // Existing clients retain their current identity. Scoped calls disclose no profile name.
      ...(grant ? {} : { name: actor.displayName || actor.username }),
      ttl: this.tokenTtlSeconds
    });
    token.addGrant({
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      room: liveKitRoomName(record.callId),
      roomJoin: true
    });
    const jwt = await token.toJwt();
    if (grant) await this.ledger!.assertAdmission(grant.identity, grant.room, now);
    return {
      e2eeKey: createHmac("sha256", this.e2eeSecret)
        .update(`cop-voice-call-e2ee:${record.callId}`, "utf8")
        .digest("base64url"),
      expiresAt: new Date(now.getTime() + this.tokenTtlSeconds * 1_000).toISOString(),
      ...(grant ? { participantIdentity: grant.identity } : {}),
      serverUrl: this.publicUrl,
      token: jwt
    };
  }
}

export function createVoiceCallMediaIssuerFromEnv(
  env: Record<string, string | undefined> = process.env,
  ledger?: VoiceGrantLedger
): VoiceCallMediaIssuer {
  const publicUrl = env.COP_LIVEKIT_PUBLIC_URL?.trim();
  const apiKey = env.COP_LIVEKIT_API_KEY?.trim();
  const apiSecret = env.COP_LIVEKIT_API_SECRET?.trim();
  const e2eeSecret = env.COP_VOICE_CALL_E2EE_SECRET?.trim();
  const explicitlyEnabled = /^(1|true|yes|on)$/iu.test(env.COP_VOICE_CALLS_ENABLED?.trim() ?? "");

  if (!explicitlyEnabled && !publicUrl && !apiKey && !apiSecret && !e2eeSecret) {
    return new DisabledVoiceCallMediaIssuer();
  }
  if (!publicUrl || !apiKey || !apiSecret || !e2eeSecret || e2eeSecret.length < 32) {
    throw new Error(
      "COP native voice calls require COP_LIVEKIT_PUBLIC_URL, COP_LIVEKIT_API_KEY, COP_LIVEKIT_API_SECRET and a COP_VOICE_CALL_E2EE_SECRET of at least 32 characters."
    );
  }
  return new LiveKitVoiceCallMediaIssuer({
    apiKey,
    apiSecret,
    e2eeSecret,
    publicUrl,
    ...(ledger ? { ledger } : {}),
    ...(env.COP_JIZDA_OIDC_CLIENT_ID?.trim() ? { dedicatedClientId: env.COP_JIZDA_OIDC_CLIENT_ID.trim() } : {}),
    tokenTtlSeconds: readPositiveInteger(env.COP_LIVEKIT_TOKEN_TTL_SECONDS, 600)
  });
}

export function liveKitRoomName(callId: string): string {
  return `cop-call-${callId}`;
}

function normalizeLiveKitURL(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "wss:" && url.protocol !== "ws:") {
    throw new Error("COP_LIVEKIT_PUBLIC_URL must use wss:// (or ws:// for local development).");
  }
  url.pathname = url.pathname.replace(/\/+$/u, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/u, "");
}

function readPositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
