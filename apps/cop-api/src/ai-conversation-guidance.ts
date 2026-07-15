import { randomUUID } from "node:crypto";
import type { AiCopQuery, AiCopResponse } from "@cop/ai-gateway";

import type { AiConversationContinuity } from "./ai-conversation-continuity.js";

export interface AiConversationSuggestion {
  id: string;
  label: string;
  question: string;
}

export function aiConversationClarificationResponse(
  aiRequest: AiCopQuery,
  requestNow: Date,
  continuity: AiConversationContinuity
): AiCopResponse {
  return {
    auditId: randomUUID(),
    model: "conversation-clarification-v1",
    policy: {
      allowed: true,
      reason: "A short follow-up did not have an unambiguous visible conversation anchor.",
      redactionsApplied: false
    },
    provider: "local",
    requestId: aiRequest.requestId,
    result: {
      structured: {
        clarification: {
          field: "conversation-context",
          originalQuestion: continuity.originalQuestion
        },
        generatedAt: requestNow.toISOString()
      },
      summary: `Na co má otázka „${continuity.originalQuestion}“ navazovat? Připište prosím krátce téma nebo místo, například „Proč je zvýšené riziko povodně?“.`
    },
    status: "COMPLETED"
  };
}

export function withAiConversationGuidance(
  response: AiCopResponse,
  input: {
    continuity: AiConversationContinuity;
    responsePlaybook?: Record<string, unknown>;
  }
): AiCopResponse {
  const structured = isRecord(response.result.structured) ? response.result.structured : {};
  const intentId = optionalText(input.responsePlaybook?.intentId);
  const suggestions = isRecord(structured.clarification)
    ? []
    : conversationSuggestions(intentId, input.responsePlaybook, input.continuity.originalQuestion);
  const confidence = conversationConfidence(response, structured, intentId);
  const summary = optionalText(response.result.summary);
  return {
    ...response,
    result: {
      ...response.result,
      structured: {
        ...structured,
        conversation: {
          assumptions: input.continuity.assumptions,
          confidence,
          contractVersion: "cop-ai-conversation-guidance-v1",
          followUp: input.continuity.followUp,
          ...(input.continuity.followUpKind ? { followUpKind: input.continuity.followUpKind } : {}),
          followUpSuggestions: suggestions,
          needsClarification: input.continuity.needsClarification,
          originalQuestion: input.continuity.originalQuestion,
          ...(input.continuity.previousQuestion ? { previousQuestion: input.continuity.previousQuestion } : {}),
          resolvedQuestion: input.continuity.resolvedQuestion,
          sourceMessageIds: input.continuity.sourceMessageIds
        }
      },
      ...(summary ? { summary: appendSuggestionFooter(summary, suggestions) } : {})
    }
  };
}

export function conversationSuggestions(
  intentId: string | undefined,
  responsePlaybook: Record<string, unknown> | undefined,
  originalQuestion: string
): AiConversationSuggestion[] {
  if (intentId === "emergency.immediate.help") {
    return [];
  }
  const suggestions = suggestionsForIntent(intentId, responsePlaybook);
  const original = normalize(originalQuestion);
  return suggestions
    .filter((suggestion) => !isRedundantSuggestion(original, normalize(suggestion.question)))
    .slice(0, 2);
}

function isRedundantSuggestion(original: string, candidate: string): boolean {
  if (candidate === original) {
    return true;
  }
  const timeMarkers = ["dnes", "zitra", "pozitri", "rano", "dopoledne", "odpoledne", "vecer", "v noci"];
  return timeMarkers.some((marker) => original.includes(marker) && candidate.includes(marker));
}

function suggestionsForIntent(
  intentId: string | undefined,
  responsePlaybook: Record<string, unknown> | undefined
): AiConversationSuggestion[] {
  if (intentId?.startsWith("weather.")) {
    return [
      suggestion("weather-next", "A co zítra?"),
      suggestion("weather-risk", "Hrozí bouřka nebo výstraha?"),
      suggestion("weather-evening", "A co večer?")
    ];
  }
  if (intentId === "situation.summary") {
    return [
      suggestion("situation-alerts", "Ukaž aktivní výstrahy"),
      suggestion("situation-traffic", "Jsou v okolí dopravní omezení?")
    ];
  }
  if (intentId === "alerts.active") {
    return [
      suggestion("alerts-priority", "Co je nejzávažnější?"),
      suggestion("alerts-map", "Ukaž výstrahy na mapě")
    ];
  }
  if (intentId === "community.reports.summary") {
    return [
      suggestion("reports-priority", "Které hlášení je nejzávažnější?"),
      suggestion("reports-map", "Ukaž hlášení na mapě")
    ];
  }
  if (intentId === "chat.conversation.summary") {
    return [
      suggestion("chat-open", "Jaké body zůstaly nevyřešené?"),
      suggestion("chat-next", "Co z toho plyne?")
    ];
  }
  if (intentId?.startsWith("map.nearest.")) {
    const allowedActions = textList(responsePlaybook?.allowedActions);
    return [
      suggestion("map-focus", "Ukaž to na mapě"),
      ...(allowedActions.includes("route") ? [suggestion("map-route", "Jak se tam dostanu?")] : [])
    ];
  }
  if (intentId === "traffic.restrictions" || intentId === "infrastructure.outage") {
    return [
      suggestion("impact", "Co to znamená pro moje okolí?"),
      suggestion("map-focus", "Ukaž to na mapě")
    ];
  }
  if (intentId === "fire.current.risk" || intentId?.startsWith("flood.")) {
    return [
      suggestion("risk-change", "Jak se riziko vyvíjí?"),
      suggestion("risk-alerts", "Jsou vydané výstrahy?")
    ];
  }
  if (intentId?.startsWith("chat.")) {
    return [
      suggestion("chat-help", "Co mám zkontrolovat jako první?"),
      suggestion("chat-explain", "Co tento stav znamená?")
    ];
  }
  return [
    suggestion("explain", "Co z toho plyne?"),
    suggestion("sources", "Uveď zdroje a čas dat")
  ];
}

function conversationConfidence(
  response: AiCopResponse,
  structured: Record<string, unknown>,
  intentId: string | undefined
): Record<string, unknown> {
  const evidence = isRecord(structured.evidence) ? structured.evidence : {};
  const mapSearch = isRecord(structured.mapSearch) ? structured.mapSearch : {};
  const mapResultCount = finiteNumber(mapSearch.resultCount) ?? 0;
  const semantic = isRecord(evidence.semantic) ? evidence.semantic : {};
  const indexed = isRecord(evidence.indexed) ? evidence.indexed : {};
  const evidenceCount = (finiteNumber(semantic.documentCount) ?? 0) + (finiteNumber(indexed.documentCount) ?? 0);
  const statuses = [optionalText(semantic.status), optionalText(indexed.status)].filter(Boolean);
  const degraded = statuses.includes("degraded");

  if (response.status !== "COMPLETED") {
    return confidence("low", "Odpověď vyžaduje kontrolu", ["AI požadavek nebyl dokončen bez výhrad."]);
  }
  if (mapResultCount > 0) {
    return confidence("high", "Vysoká opora v aktuálních datech", ["Odpověď vychází z konkrétního výsledku COP mapy."]);
  }
  if (response.provider === "local" && intentId && intentId !== "unclassified") {
    return confidence("high", "Vysoká opora v pravidlech COP", ["Odpověď používá deterministický COP postup pro rozpoznaný záměr."]);
  }
  if (evidenceCount > 0 && !degraded) {
    return confidence("medium", "Střední opora v dostupných datech", ["Odpověď používá aktuální COP evidenci, úplnost zdrojů se může lišit."]);
  }
  return confidence("low", "Omezená opora v datech", ["V požadavku nebylo dost přímé evidence; odpověď je potřeba ověřit."]);
}

function confidence(level: "high" | "low" | "medium", label: string, basis: string[]): Record<string, unknown> {
  return { basis, label, level };
}

function appendSuggestionFooter(summary: string, suggestions: AiConversationSuggestion[]): string {
  if (suggestions.length === 0 || /Můžete navázat:/iu.test(summary)) {
    return summary;
  }
  return `${summary.trim()}\n\nMůžete navázat: ${suggestions.map((item) => `„${item.label}“`).join(" · ")}`;
}

function suggestion(id: string, question: string): AiConversationSuggestion {
  return { id, label: question, question };
}

function textList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => typeof item === "string" && item.trim() ? [item.trim()] : [])
    : [];
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[?.!]+$/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("cs-CZ");
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
