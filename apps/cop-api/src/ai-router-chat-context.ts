import type { ReviewedInternalItem } from "./ai-router-chat.js";

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function clean(value: unknown, limit: number): string {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/gu, " ").replace(/\s+/gu, " ").trim().slice(0, limit)
    : "";
}

function textParts(value: unknown, fields: string[]): string {
  const item = record(value);
  if (!item) return "";
  return fields.map((field) => clean(item[field], 260)).filter(Boolean).join(" · ").slice(0, 600);
}

/** All categories are internal and may only be processed by the Router's local tier. */
export function reviewedInternalChatItems(input: {
  chatContext?: unknown;
  alerts: unknown[];
  communityReports: unknown[];
  mapResults: unknown[];
  sourceHealth: unknown[];
}): ReviewedInternalItem[] {
  const items: ReviewedInternalItem[] = [];
  const add = (kind: ReviewedInternalItem["kind"], value: unknown, fields: string[]) => {
    const text = textParts(value, fields);
    if (text) items.push({ kind, text });
  };
  const chat = record(input.chatContext);
  if (chat?.source === "browser-visible-decrypted-timeline" && Array.isArray(chat.messages)) {
    for (const message of chat.messages.slice(-4)) add("chat_message", message, ["senderDisplayName", "body", "timestamp"]);
  }
  for (const alert of input.alerts.slice(0, 3)) add("alert", alert, ["title", "severity", "status", "detail"]);
  for (const report of input.communityReports.slice(0, 3)) add("community_report", report, ["title", "category", "status", "description"]);
  for (const result of input.mapResults.slice(0, 3)) add("map_result", result, ["label", "title", "name", "status"]);
  for (const source of input.sourceHealth.slice(0, 3)) add("source_health", source, ["displayName", "health", "status"]);
  return items.slice(0, 16);
}
