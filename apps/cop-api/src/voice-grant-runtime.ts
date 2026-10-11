import type { MobilityStore } from "./mobility-store.js";
import { VoiceGrantLedger } from "./voice-grant-ledger.js";
import { RemoteVoiceGrantRevoker, UnacceptedVoiceGrantRevoker, type VoiceGrantRevoker } from "./voice-grant-revocation.js";

export function createVoiceGrantLedgerFromEnv(store: MobilityStore | undefined,
  env: Record<string, string | undefined> = process.env): VoiceGrantLedger | undefined {
  const intake = flag(env.COP_VOICE_SCOPED_GRANTS_ENABLED);
  const accepted = flag(env.COP_VOICE_SIGNAL_GATEWAY_ACCEPTED);
  const singleAttempt = flag(env.COP_VOICE_SIGNAL_SINGLE_ATTEMPT_VERIFIED);
  if (intake && (!accepted || !singleAttempt)) {
    throw new Error("Scoped voice intake requires accepted sole-ingress and single-attempt admission.");
  }
  const configured = intake || !!env.COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL?.trim() || flag(env.COP_VOICE_SIGNAL_GATEWAY_ENABLED);
  if (!configured) return undefined;
  const issuer = env.COP_OIDC_ISSUER?.trim();
  const clientId = env.COP_JIZDA_OIDC_CLIENT_ID?.trim();
  const identitySecret = env.COP_LIVEKIT_API_SECRET?.trim();
  if (!store || !issuer || !clientId || !identitySecret || identitySecret.length < 32 ||
      !env.COP_LIVEKIT_API_KEY?.trim() || !env.COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL?.trim()) {
    throw new Error("Scoped voice requires the persistent store, dedicated verified app, existing LiveKit key and admission control URL.");
  }
  const seconds = Number(env.COP_VOICE_SCOPED_GRANT_MAX_AGE_SECONDS ?? 86_400);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86_400) throw new Error("Invalid scoped voice grant maximum age.");
  return new VoiceGrantLedger({ store, issuer, clientId, identitySecret, intakeEnabled: intake,
    requireAdmissionEpoch: true, maxGrantAgeMs: seconds * 1_000 });
}

export function createVoiceGrantRevokerFromEnv(env: Record<string, string | undefined> = process.env): VoiceGrantRevoker {
  const accepted = flag(env.COP_VOICE_SIGNAL_GATEWAY_ACCEPTED);
  const baseUrl = env.COP_VOICE_SIGNAL_GATEWAY_CONTROL_URL?.trim();
  const apiKey = env.COP_LIVEKIT_API_KEY?.trim();
  const apiSecret = env.COP_LIVEKIT_API_SECRET?.trim();
  if (!accepted) return new UnacceptedVoiceGrantRevoker();
  if (!baseUrl || !apiKey || !apiSecret) throw new Error("Accepted voice admission control requires its existing server credentials.");
  return new RemoteVoiceGrantRevoker({ baseUrl, apiKey, apiSecret, accepted });
}

function flag(value: string | undefined): boolean {
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  throw new Error("Scoped voice flags must be exactly true or false.");
}
