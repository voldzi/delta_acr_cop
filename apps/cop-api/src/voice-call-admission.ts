import type { VoiceCallStore } from "./voice-call-store.js";
import { VoiceGrantError } from "./voice-grant-ledger.js";

export interface VoiceCallAdmissionTarget { callId: string; room: string }
export type VoiceCallAdmission = (target: VoiceCallAdmissionTarget, now: Date) => Promise<void>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const expiringPhases = new Set(["ringing", "accepted", "connecting_media"]);
const deniedPhases = new Set(["created", "declined", "missed", "cancelled", "failed", "ended"]);

/** Bound the admission request even for an injected/unresponsive store. A
 * timeout is unknown state, never proof that compensation or cleanup finished.
 */
export async function withVoiceCallStateDeadline<T>(operation: () => Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new VoiceGrantError(503, "VOICE_CALL_STATE_UNAVAILABLE")), 5000);
      timer.unref();
    })]);
  } finally { clearTimeout(timer); }
}

/** Current persisted call state is admission authority, never RTC quiescence
 * evidence. The Matrix roomId is intentionally not the LiveKit route room.
 * Mirrors existing invitation/media_timeout deadlines even between expiry
 * sweeps. Only an established connected call can outlive that deadline.
 */
export function createVoiceCallAdmission(store: Pick<VoiceCallStore, "get">): VoiceCallAdmission {
  return async (target, now) => {
    if (!uuid.test(target.callId) || target.room !== "cop-call-" + target.callId) {
      throw new VoiceGrantError(403, "VOICE_CALL_ADMISSION_DENIED");
    }
    if (!Number.isFinite(now.getTime())) throw new VoiceGrantError(503, "VOICE_CALL_STATE_UNAVAILABLE");
    let record: Awaited<ReturnType<VoiceCallStore["get"]>>;
    try { record = await withVoiceCallStateDeadline(() => store.get(target.callId)); }
    catch { throw new VoiceGrantError(503, "VOICE_CALL_STATE_UNAVAILABLE"); }
    if (!record || record.callId !== target.callId) throw new VoiceGrantError(403, "VOICE_CALL_ADMISSION_DENIED");
    if (record.phase === "connected") return;
    if (deniedPhases.has(record.phase)) throw new VoiceGrantError(403, "VOICE_CALL_ADMISSION_DENIED");
    if (!expiringPhases.has(record.phase) || !Number.isFinite(Date.parse(record.expiresAt))) {
      throw new VoiceGrantError(503, "VOICE_CALL_STATE_UNAVAILABLE");
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) throw new VoiceGrantError(403, "VOICE_CALL_ADMISSION_DENIED");
  };
}
