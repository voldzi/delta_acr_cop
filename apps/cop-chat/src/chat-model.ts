import type { MatrixTimelineMessage } from "@cop/messaging/types";
import type { MessageRetentionSeconds } from "./dialogs/messageRetention";

export interface ChatPreferences {
  hiddenByKey: Record<string, string>;
  manualUnreadKeys: string[];
  mutedUntilByKey: Record<string, string>;
  pinnedKeys: string[];
  readOverrideByKey: Record<string, string>;
}

export function buildTimelineRows(
  messages: MatrixTimelineMessage[]
): Array<
  { id: string; kind: "date"; label: string } | { grouped: boolean; kind: "message"; message: MatrixTimelineMessage }
> {
  const rows: Array<
    { id: string; kind: "date"; label: string } | { grouped: boolean; kind: "message"; message: MatrixTimelineMessage }
  > = [];
  let previousDay = "";
  let previousSender = "";
  messages.forEach((message) => {
    const day = formatDate(message.timestamp);
    if (day !== previousDay) {
      rows.push({ id: `date-${day}`, kind: "date", label: day });
      previousDay = day;
      previousSender = "";
    }
    const grouped = previousSender === message.sender;
    rows.push({ grouped, kind: "message", message });
    previousSender = message.sender;
  });
  return rows;
}

export function filterTimelineByRetention(
  messages: MatrixTimelineMessage[],
  seconds: MessageRetentionSeconds
): MatrixTimelineMessage[] {
  if (seconds === null) {
    return messages;
  }
  const minTimestamp = Date.now() - seconds * 1000;
  return messages.filter((message) => {
    const timestamp = Date.parse(message.timestamp);
    return !Number.isFinite(timestamp) || timestamp >= minTimestamp;
  });
}

export function mergeTimelineMessages(
  cached: MatrixTimelineMessage[],
  live: MatrixTimelineMessage[]
): MatrixTimelineMessage[] {
  const byEventId = new Map<string, MatrixTimelineMessage>();
  for (const message of cached) {
    byEventId.set(message.eventId, message);
  }
  for (const message of live) {
    byEventId.set(message.eventId, message);
  }
  return removeConfirmedLocalEchoes(Array.from(byEventId.values())).sort(
    (left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp)
  );
}

export function timelineNeedsBridgeBackfill(
  cachedOrMerged: MatrixTimelineMessage[],
  live: MatrixTimelineMessage[],
  minGapMs = 120_000
): boolean {
  if (cachedOrMerged.length === 0 || live.length === 0) {
    return false;
  }
  const liveEventIds = new Set(live.map((message) => message.eventId));
  const cachedOnly = cachedOrMerged.filter((message) => !liveEventIds.has(message.eventId));
  if (cachedOnly.length === 0) {
    return false;
  }
  const latestCachedOnlyAt = latestFiniteTimestamp(cachedOnly);
  const earliestLiveAt = earliestFiniteTimestamp(live);
  return (
    latestCachedOnlyAt !== null &&
    earliestLiveAt !== null &&
    latestCachedOnlyAt + minGapMs < earliestLiveAt
  );
}

export function normalizeChatPreferences(preferences: Partial<ChatPreferences>): ChatPreferences {
  const now = Date.now();
  const mutedUntilByKey = Object.fromEntries(
    Object.entries(preferences.mutedUntilByKey ?? {}).filter(
      ([key, value]) => key && (value === "forever" || Date.parse(value) > now)
    )
  );
  const hiddenByKey = Object.fromEntries(
    Object.entries(preferences.hiddenByKey ?? {})
      .filter(([key, value]) => key && typeof value === "string" && value)
      .slice(0, 200)
  );
  const readOverrideByKey = Object.fromEntries(
    Object.entries(preferences.readOverrideByKey ?? {})
      .filter(([key, value]) => key && typeof value === "string" && value)
      .slice(0, 200)
  );
  return {
    hiddenByKey,
    manualUnreadKeys: Array.from(new Set((preferences.manualUnreadKeys ?? []).filter(Boolean))).slice(0, 200),
    mutedUntilByKey,
    pinnedKeys: Array.from(new Set((preferences.pinnedKeys ?? []).filter(Boolean))).slice(0, 24),
    readOverrideByKey
  };
}

export function isChatMuted(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  return value === "forever" || Date.parse(value) > Date.now();
}

export function messageMatchesQuery(message: MatrixTimelineMessage, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase("cs-CZ");
  if (!normalized) {
    return false;
  }
  return messageSearchText(message).toLocaleLowerCase("cs-CZ").includes(normalized);
}

function removeConfirmedLocalEchoes(messages: MatrixTimelineMessage[]): MatrixTimelineMessage[] {
  const confirmedOwnMessages = messages.filter((message) => message.own && isServerMatrixEventId(message.eventId));
  if (confirmedOwnMessages.length === 0) {
    return messages;
  }
  return messages.filter((message) => {
    if (!message.own || !isTemporaryMatrixEventId(message.eventId)) {
      return true;
    }
    return !confirmedOwnMessages.some((confirmed) => isConfirmedLocalEchoPair(message, confirmed));
  });
}

function isConfirmedLocalEchoPair(localEcho: MatrixTimelineMessage, confirmed: MatrixTimelineMessage): boolean {
  if (localEcho.sender !== confirmed.sender || localEcho.kind !== confirmed.kind || localEcho.body !== confirmed.body) {
    return false;
  }
  if ((localEcho.replyToEventId ?? "") !== (confirmed.replyToEventId ?? "")) {
    return false;
  }
  if (
    attachmentSignature(localEcho) !== attachmentSignature(confirmed) ||
    locationSignature(localEcho) !== locationSignature(confirmed)
  ) {
    return false;
  }
  const localAt = Date.parse(localEcho.timestamp);
  const confirmedAt = Date.parse(confirmed.timestamp);
  return Number.isFinite(localAt) && Number.isFinite(confirmedAt) && Math.abs(localAt - confirmedAt) <= 90_000;
}

function isServerMatrixEventId(eventId: string): boolean {
  return eventId.startsWith("$");
}

function isTemporaryMatrixEventId(eventId: string): boolean {
  return eventId.startsWith("~") || eventId.startsWith("local-") || !isServerMatrixEventId(eventId);
}

function earliestFiniteTimestamp(messages: MatrixTimelineMessage[]): number | null {
  let earliest: number | null = null;
  for (const message of messages) {
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    earliest = earliest === null ? timestamp : Math.min(earliest, timestamp);
  }
  return earliest;
}

function latestFiniteTimestamp(messages: MatrixTimelineMessage[]): number | null {
  let latest: number | null = null;
  for (const message of messages) {
    const timestamp = Date.parse(message.timestamp);
    if (!Number.isFinite(timestamp)) {
      continue;
    }
    latest = latest === null ? timestamp : Math.max(latest, timestamp);
  }
  return latest;
}

function attachmentSignature(message: MatrixTimelineMessage): string {
  const attachment = message.attachment;
  return attachment
    ? `${attachment.contentType ?? ""}:${attachment.fileName}:${attachment.size ?? ""}:${attachment.mediaUrl ?? ""}`
    : "";
}

function locationSignature(message: MatrixTimelineMessage): string {
  return message.location ? `${message.location.lat.toFixed(5)}:${message.location.lon.toFixed(5)}` : "";
}

function messageSearchText(message: MatrixTimelineMessage): string {
  return [
    message.body,
    message.attachment?.fileName,
    message.location ? `${message.location.lat.toFixed(5)}, ${message.location.lon.toFixed(5)}` : "",
    message.location?.label ?? ""
  ]
    .filter(Boolean)
    .join(" ");
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("cs-CZ", {
    day: "numeric",
    month: "long"
  }).format(date);
}
