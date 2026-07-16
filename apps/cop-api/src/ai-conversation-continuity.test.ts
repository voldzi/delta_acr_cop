import { describe, expect, it } from "vitest";

import {
  resolveAiConversationContinuity,
  resolveAiConversationTimeWindow
} from "./ai-conversation-continuity.js";

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
    expect(continuity.resolvedQuestion).toContain("Časové upřesnění: zítra");
    expect(continuity.sourceMessageIds).toEqual(["$a1"]);
  });

  it.each(["A jak bude zítra?", "Jak bude zítra?", "A co bude zítra?"])(
    "understands the natural elliptical weather follow-up %s",
    (question) => {
      const continuity = resolveAiConversationContinuity(question, {
        messages: [
          {
            ai: {
              question: "Jaké bude dnes počasí?",
              responsePlaybook: { domain: "weather", intentId: "weather.summary.forecast" },
              type: "chat-agent"
            },
            body: "Dnes bude polojasno.",
            eventId: "$a1",
            own: true
          },
          { body: question, eventId: "$q2", own: true }
        ]
      });

      expect(continuity).toMatchObject({
        followUp: true,
        followUpKind: "time",
        inheritedDomain: "weather",
        inheritedIntentId: "weather.summary.forecast",
        needsClarification: false,
        timeReference: { dayOffset: 1, label: "zítra" }
      });
      expect(continuity.resolvedQuestion).toBe("Jaké bude počasí. Časové upřesnění: zítra.");
    }
  );

  it.each(["Jak bude dneska?", "Jak bude zejtra?", "Jak bude zítřejší večer?"])(
    "understands the standalone conversational weather query %s",
    (question) => {
      const continuity = resolveAiConversationContinuity(question, undefined);

      expect(continuity).toMatchObject({
        followUp: false,
        inheritedDomain: "weather",
        inheritedIntentId: "weather.summary.forecast",
        needsClarification: false
      });
      expect(continuity.resolvedQuestion).toContain("počasí");
      expect(continuity.timeReference).toBeDefined();
    }
  );

  it("uses an explicit contextual cue to inherit a non-weather topic", () => {
    const continuity = resolveAiConversationContinuity("A jak to bude dneska?", {
      messages: [
        {
          ai: {
            question: "Dá se tudy projet?",
            responsePlaybook: { domain: "traffic", intentId: "traffic.restrictions" },
            type: "chat-agent"
          },
          body: "Silnice je průjezdná s omezením.",
          eventId: "$traffic-answer",
          own: true
        }
      ]
    });

    expect(continuity).toMatchObject({
      followUp: true,
      inheritedDomain: "traffic",
      inheritedIntentId: "traffic.restrictions",
      needsClarification: false,
      timeReference: { dayOffset: 0, label: "dnes" }
    });
    expect(continuity.resolvedQuestion).toContain("dopravní omezení a průjezdnost");
  });

  it("turns a tomorrow follow-up into an explicit Prague-time query window", () => {
    const continuity = resolveAiConversationContinuity("A jak bude zítra?", {
      messages: [
        {
          ai: { question: "Jaké bude dnes počasí?", type: "chat-agent" },
          body: "Dnes bude polojasno.",
          own: true
        }
      ]
    });

    expect(resolveAiConversationTimeWindow(continuity, new Date("2026-07-16T08:15:00.000Z"))).toEqual({
      from: "2026-07-16T22:00:00.000Z",
      label: "zítra",
      to: "2026-07-17T22:00:00.000Z",
      validAt: "2026-07-17T10:00:00.000Z"
    });
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

  it.each(["Pro aktuální polohu", "Podle mojí polohy", "U mě", "Tady"])(
    "keeps the weather domain for the current-location follow-up %s",
    (question) => {
      const continuity = resolveAiConversationContinuity(question, {
        messages: [
          {
            ai: {
              question: "Jak bude dneska?",
              responsePlaybook: { domain: "weather", intentId: "weather.summary.forecast" },
              type: "chat-agent"
            },
            body: "Pro jaké místo chcete předpověď?",
            eventId: "$weather-location-question",
            own: true
          }
        ]
      });

      expect(continuity).toMatchObject({
        followUp: true,
        followUpKind: "location",
        inheritedDomain: "weather",
        inheritedIntentId: "weather.summary.forecast",
        needsClarification: false,
        previousQuestion: "Jak bude dneska?",
        usesCurrentLocation: true
      });
      expect(continuity.explicitLocation).toBeUndefined();
      expect(continuity.resolvedQuestion).toContain("počasí");
      expect(continuity.resolvedQuestion).toContain("Použij aktuální polohu zařízení");
    }
  );

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
