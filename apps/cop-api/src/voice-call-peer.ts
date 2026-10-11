import type { VoiceCallRecord } from "./voice-call-store.js";
import type { UserProfileRecord } from "./user-profile-store.js";
export interface VoiceCallPeer { subjectId: string; displayName?: string }
/** Resolve presentation only from the exact other authenticated call participant. */
export async function readVoiceCallPeer(call: VoiceCallRecord, viewer: string, readProfile: (id: string) => Promise<UserProfileRecord | null>): Promise<VoiceCallPeer | undefined> {
  if (call.kind !== "direct" || call.participantSubjectIds.length !== 1) return undefined;
  const recipient = call.participantSubjectIds[0];
  if (!recipient || recipient === call.initiatorSubjectId) return undefined;
  const subjectId = viewer === call.initiatorSubjectId ? recipient : viewer === recipient ? call.initiatorSubjectId : undefined;
  if (!subjectId) return undefined;
  try {
    const profile = await readProfile(subjectId);
    const name = profile?.subjectId === subjectId ? profile.displayName.trim() : "";
    return {subjectId, ...(name && name.length <= 160 && !/[\u0000-\u001f\u007f]/u.test(name) ? {displayName: name} : {})};
  } catch { return {subjectId}; }
}
