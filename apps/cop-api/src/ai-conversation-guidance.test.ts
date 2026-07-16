import type { AiCopResponse } from "@cop/ai-gateway";
import { describe, expect, it } from "vitest";

import { resolveAiConversationContinuity } from "./ai-conversation-continuity.js";
import { conversationSuggestions, withAiConversationGuidance } from "./ai-conversation-guidance.js";

describe("AI conversation guidance", () => {
  it("adds human follow-up options and confidence to a grounded response", () => {
    const response = withAiConversationGuidance(completedResponse(), {
      continuity: resolveAiConversationContinuity("Jaké bude počasí v Praze?", undefined),
      responsePlaybook: {
        intentId: "weather.summary.forecast"
      }
    });

    expect(response.result.summary).toContain("Můžete navázat: „A co zítra?“");
    expect(response.result.structured).toMatchObject({
      conversation: {
        confidence: {
          label: "Vysoká opora v aktuálních datech",
          level: "high"
        },
        contractVersion: "cop-ai-conversation-guidance-v1",
        followUpSuggestions: [
          { id: "weather-next", question: "A co zítra?" },
          { id: "weather-risk", question: "Hrozí bouřka nebo výstraha?" }
        ],
        originalQuestion: "Jaké bude počasí v Praze?"
      }
    });
  });

  it("does not append suggestions to a clarification", () => {
    const response = withAiConversationGuidance({
      ...completedResponse(),
      result: {
        structured: { clarification: { field: "location" } },
        summary: "Pro jaké místo?"
      }
    }, {
      continuity: resolveAiConversationContinuity("Jaké bude počasí?", undefined),
      responsePlaybook: { intentId: "weather.summary.forecast" }
    });

    expect(response.result.summary).toBe("Pro jaké místo?");
    expect(response.result.structured).toMatchObject({
      conversation: { followUpSuggestions: [] }
    });
  });

  it("does not label alert-only weather evidence as a high-confidence forecast", () => {
    const base = completedResponse();
    const response = withAiConversationGuidance({
      ...base,
      model: "map-search-partial-fallback",
      result: {
        structured: {
          mapSearch: { resultCount: 2 },
          mapSearchFallback: { alertOnly: true }
        },
        summary: "Předpověď není dostupná, platí však meteorologické výstrahy."
      }
    }, {
      continuity: resolveAiConversationContinuity("A jak bude zítra?", undefined),
      responsePlaybook: { intentId: "weather.summary.forecast" }
    });

    expect(response.result.structured).toMatchObject({
      conversation: {
        confidence: {
          basis: [
            "Dostupné výstrahy mají konkrétní časovou platnost.",
            "Pro požadované období chybí předpověď nebo měření počasí."
          ],
          label: "Ověřené výstrahy, chybějící předpověď",
          level: "medium"
        }
      }
    });
  });

  it("never offers conversational shortcuts for an emergency answer", () => {
    expect(conversationSuggestions("emergency.immediate.help", {}, "Člověk nedýchá")).toEqual([]);
  });

  it("does not repeat the time period the user just asked about", () => {
    expect(conversationSuggestions("weather.summary.forecast", {}, "A zítra?")).toEqual([
      { id: "weather-risk", label: "Hrozí bouřka nebo výstraha?", question: "Hrozí bouřka nebo výstraha?" },
      { id: "weather-evening", label: "A co večer?", question: "A co večer?" }
    ]);
  });
});

function completedResponse(): AiCopResponse {
  return {
    auditId: "audit-1",
    model: "map-search-fallback",
    policy: { allowed: true, reason: "test", redactionsApplied: false },
    provider: "local",
    requestId: "request-1",
    result: {
      structured: {
        mapSearch: { resultCount: 1 }
      },
      summary: "V Praze bude polojasno."
    },
    status: "COMPLETED"
  };
}
