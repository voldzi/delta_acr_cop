import { AccessToken } from "livekit-server-sdk";
import type { AuthenticatedActor } from "./security.js";
import type { VoiceCallRecord } from "./voice-call-store.js";

export interface VoiceCallMediaCredentials {
  expiresAt: string;
  serverUrl: string;
  token: string;
}

export interface VoiceCallMediaIssuer {
  readonly enabled: boolean;
  issue(record: VoiceCallRecord, actor: AuthenticatedActor, now: Date): Promise<VoiceCallMediaCredentials>;
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
  private readonly publicUrl: string;
  private readonly tokenTtlSeconds: number;

  constructor(options: {
    apiKey: string;
    apiSecret: string;
    publicUrl: string;
    tokenTtlSeconds?: number;
  }) {
    this.apiKey = options.apiKey;
    this.apiSecret = options.apiSecret;
    this.publicUrl = normalizeLiveKitURL(options.publicUrl);
    this.tokenTtlSeconds = Math.max(60, Math.min(3_600, options.tokenTtlSeconds ?? 600));
  }

  async issue(
    record: VoiceCallRecord,
    actor: AuthenticatedActor,
    now: Date
  ): Promise<VoiceCallMediaCredentials> {
    const identity = actor.subjectId;
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name: actor.displayName || actor.username,
      ttl: this.tokenTtlSeconds
    });
    token.addGrant({
      canPublish: true,
      canPublishData: true,
      canSubscribe: true,
      room: liveKitRoomName(record.callId),
      roomJoin: true
    });
    return {
      expiresAt: new Date(now.getTime() + this.tokenTtlSeconds * 1_000).toISOString(),
      serverUrl: this.publicUrl,
      token: await token.toJwt()
    };
  }
}

export function createVoiceCallMediaIssuerFromEnv(
  env: Record<string, string | undefined> = process.env
): VoiceCallMediaIssuer {
  const publicUrl = env.COP_LIVEKIT_PUBLIC_URL?.trim();
  const apiKey = env.COP_LIVEKIT_API_KEY?.trim();
  const apiSecret = env.COP_LIVEKIT_API_SECRET?.trim();
  const explicitlyEnabled = /^(1|true|yes|on)$/iu.test(env.COP_VOICE_CALLS_ENABLED?.trim() ?? "");

  if (!explicitlyEnabled && !publicUrl && !apiKey && !apiSecret) {
    return new DisabledVoiceCallMediaIssuer();
  }
  if (!publicUrl || !apiKey || !apiSecret) {
    throw new Error(
      "COP native voice calls require COP_LIVEKIT_PUBLIC_URL, COP_LIVEKIT_API_KEY and COP_LIVEKIT_API_SECRET."
    );
  }
  return new LiveKitVoiceCallMediaIssuer({
    apiKey,
    apiSecret,
    publicUrl,
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
