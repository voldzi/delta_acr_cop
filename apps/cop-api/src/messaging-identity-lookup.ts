/** Existing identities only. This endpoint must never call provisioning. */
export interface MessagingMatrixIdentityLookup {
  contractVersion: "cop-messaging-identity-lookup-v1";
  providerId: "csm.messaging";
  actorUserId: string;
  conversationId: string;
  matrixRoomId?: string;
  identities: Array<{userId: string; matrixUserId: string}>;
  unresolvedUserIds: string[];
  validUntil: string;
  status: "online";
  warnings: string[];
}
export interface MessagingMatrixIdentityLookupResult {
  statusCode: 200 | 403 | 404 | 503;
  body?: MessagingMatrixIdentityLookup;
}
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 160 && v.trim() === v && !/[\u0000-\u001f\u007f]/u.test(v);
export function validateIdentityLookup(value: unknown, actorUserId: string, conversationId: string, now: Date): MessagingMatrixIdentityLookup | undefined {
  if (!object(value) || value.contractVersion !== "csm-messaging-identity-lookup-v1" || value.providerId !== "csm.messaging" || value.status !== "ready" || value.actorUserId !== actorUserId || value.conversationId !== conversationId || !Array.isArray(value.warnings) || value.warnings.length || !Array.isArray(value.identities) || !Array.isArray(value.unresolvedUserIds)) return undefined;
  const allowed = ["contractVersion", "providerId", "status", "warnings", "actorUserId", "conversationId", "matrixRoomId", "identities", "unresolvedUserIds"];
  if (Object.keys(value).some(k => !allowed.includes(k)) || (value.matrixRoomId !== undefined && (!id(value.matrixRoomId) || !value.matrixRoomId.startsWith("!")))) return undefined;
  const identities: Array<{userId: string; matrixUserId: string}> = [];
  for (const item of value.identities) {
    if (!object(item) || Object.keys(item).length !== 2 || !id(item.userId) || item.userId.startsWith("@") || !id(item.matrixUserId) || !/^@[^\s:]+:[^\s]+$/u.test(item.matrixUserId)) return undefined;
    identities.push({userId: item.userId, matrixUserId: item.matrixUserId});
  }
  if (!value.unresolvedUserIds.every(v => id(v) && !v.startsWith("@"))) return undefined;
  const unresolvedUserIds = value.unresolvedUserIds as string[];
  const members = [...identities.map(v => v.userId), ...unresolvedUserIds];
  if (!members.length || members.length > 100 || new Set(members).size !== members.length || !members.includes(actorUserId) || new Set(identities.map(v => v.matrixUserId)).size !== identities.length) return undefined;
  return {contractVersion: "cop-messaging-identity-lookup-v1", providerId: "csm.messaging", actorUserId, conversationId, ...(typeof value.matrixRoomId === "string" ? {matrixRoomId: value.matrixRoomId} : {}), identities, unresolvedUserIds, validUntil: new Date(now.getTime() + 30_000).toISOString(), status: "online", warnings: []};
}
