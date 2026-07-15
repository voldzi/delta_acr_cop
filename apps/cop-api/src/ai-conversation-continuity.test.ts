import { describe, expect, it } from "vitest";

import { resolveAiConversationContinuity } from "./ai-conversation-continuity.js";

describe("AI conversation continuity", () => {
  it("inherits the last visible weather question for a time follow-up", () => {
    const continuity = resolveAiConversationContinuity("A zítra?", {
      messages: [
        { body: "Jaké bude počasí ve Vrbně pod Pradědem?", eventId: "$q1", own: true },
        {
          ai: { question: "Jaké bude počasí ve Vrbně pod Pradědem?", type: "chat-agent" },
          body: "Dnes bude polojasno.",
          eventId: "$a1",
          own: true
        },
        { body: "A zítra?", eventId: "$q2", own: true }
      ]
    });

    expect(continuity).toMatchObject({
      followUp: true,
      followUpKind: "time",
      inheritedDomain: "weather",
      inheritedIntentId: "weather.summary.forecast",
      needsClarification: false,
      previousQuestion: "Jaké bude počasí ve Vrbně pod Pradědem?"
    });
    expect(continuity.resolvedQuestion).toContain("počasí ve Vrbně pod Pradědem");
    expect(continuity.resolvedQuestion).toContain("A zítra?");
    expect(continuity.sourceMessageIds).toEqual(["$a1"]);
  });

  it("uses a new explicit place without relying on a hidden room history", () => {
    const continuity = resolveAiConversationContinuity("A v Brně?", {
      messages: [
        {
          body: "COP AI agent\nDotaz: Hrozí dnes bouřka v Praze?\n\nRiziko je nízké.",
          eventId: "$a1",
          own: true
        }
      ]
    });

    expect(continuity).toMatchObject({
      explicitLocation: "Brně",
      followUp: true,
      followUpKind: "location",
      needsClarification: false,
      previousQuestion: "Hrozí dnes bouřka v Praze?"
    });
    expect(continuity.assumptions).toContain("Místo bylo změněno na „Brně“ podle aktuálního dotazu.");
  });

  it("asks for clarification when a short follow-up has no visible anchor", () => {
    expect(resolveAiConversationContinuity("Proč?", undefined)).toMatchObject({
      followUp: true,
      followUpKind: "explanation",
      needsClarification: true,
      resolvedQuestion: "Proč?"
    });
  });

  it("ignores unreadable placeholders and the current question", () => {
    const continuity = resolveAiConversationContinuity("A večer?", {
      messages: [
        { body: "Zprávu se nepodařilo dešifrovat na tomto zařízení.", own: true },
        { body: "A večer?", own: true }
      ]
    });

    expect(continuity.needsClarification).toBe(true);
    expect(continuity.previousQuestion).toBeUndefined();
  });

  it("does not rewrite a complete standalone question", () => {
    expect(resolveAiConversationContinuity("Jaká je situace v Brně?", {
      messages: [{ body: "Jaké bude počasí?", own: true }]
    })).toEqual({
      assumptions: [],
      contractVersion: "cop-ai-conversation-continuity-v1",
      followUp: false,
      needsClarification: false,
      originalQuestion: "Jaká je situace v Brně?",
      resolvedQuestion: "Jaká je situace v Brně?",
      sourceMessageIds: []
    });
  });
});
