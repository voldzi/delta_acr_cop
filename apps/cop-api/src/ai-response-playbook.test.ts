import { describe, expect, it } from "vitest";

import {
  aiResponsePlaybookGuidanceForQuestion,
  aiResponsePlaybookPromptGuidance,
  buildAiResponsePlaybookEvalCases,
  classifyAiResponseIntent
} from "./ai-response-playbook.js";

describe("AI response playbook", () => {
  it("classifies a general weather question as a forecast summary", () => {
    const match = classifyAiResponseIntent("Jaké bude počasí?");

    expect(match).toMatchObject({
      domain: "weather",
      intentId: "weather.summary.forecast"
    });
    expect(match?.rule.answerContract.mustNotInvent).toContain("interní názvy vrstev nebo zdrojů");
  });

  it("classifies weather rain questions with map-only actions", () => {
    const match = classifyAiResponseIntent("Bude dnes pršet?");

    expect(match).toMatchObject({
      domain: "weather",
      intentId: "weather.rain.now"
    });
    expect(match?.rule.allowedActions).toEqual(["focus-map"]);
    expect(match?.rule.forbiddenActions).toContain("route");
  });

  it("keeps navigable public-safety targets route-capable", () => {
    const match = classifyAiResponseIntent("Kde je nejbližší policie u mě?");

    expect(match).toMatchObject({
      domain: "security",
      intentId: "map.nearest.police"
    });
    expect(match?.rule.allowedActions).toEqual(expect.arrayContaining(["focus-map", "route"]));
    expect(match?.rule.forbiddenActions).not.toContain("route");
  });

  it("emits compact guidance for the chat-agent prompt and context", () => {
    const guidance = aiResponsePlaybookGuidanceForQuestion("Proč mi nefunguje poloha?");
    const promptGuidance = aiResponsePlaybookPromptGuidance("Proč mi nefunguje poloha?");

    expect(guidance).toMatchObject({
      domain: "application",
      intentId: "app.location.permission",
      requiredSources: ["app-runtime"]
    });
    expect(promptGuidance).toContain("ResponsePlaybook intent=app.location.permission");
    expect(promptGuidance).toContain("Forbidden UI actions: route");
  });

  it.each([
    ["Co umíš?", "cop.capabilities.help"],
    ["Jaká je situace v okolí?", "situation.summary"],
    ["Jaké jsou aktivní výstrahy?", "alerts.active"],
    ["Shrň komunitní hlášení.", "community.reports.summary"],
    ["Jsou datové zdroje v pořádku?", "source.health"],
    ["Shrň tento chat.", "chat.conversation.summary"],
    ["Kde je nejbližší hasičská stanice?", "map.nearest.fire_station"],
    ["Najdi defibrilátor.", "map.nearest.aed"],
    ["Vidím odeslanou zprávu dvakrát.", "chat.delivery.status"],
    ["Proč nejdou dešifrovat staré zprávy?", "chat.encryption.recovery"],
    ["Člověk nedýchá, co mám dělat?", "emergency.immediate.help"]
  ])("classifies broader assistant question %s", (question, intentId) => {
    expect(classifyAiResponseIntent(question)).toMatchObject({ intentId });
  });

  it.each([
    ["Jak bude dneska?", "weather.summary.forecast"],
    ["Jak to vypadá?", "situation.summary"],
    ["Na co si dát pozor?", "alerts.active"],
    ["Fungujou data?", "source.health"],
    ["Jak je na tom voda?", "flood.risk.summary"],
    ["Dá se tudy projet?", "traffic.restrictions"]
  ])("classifies conversational paraphrase %s", (question, intentId) => {
    expect(classifyAiResponseIntent(question)).toMatchObject({ intentId });
  });

  it("generates a ten-thousand-query eval set that maps back to expected intents", () => {
    const cases = buildAiResponsePlaybookEvalCases(10_000);
    const uniqueQuestions = new Set(cases.map((item) => item.question));
    const mismatches = cases.flatMap((item) => {
      const match = classifyAiResponseIntent(item.question);
      return match?.intentId === item.expectedIntentId
        ? []
        : [{ expected: item.expectedIntentId, id: item.id, question: item.question, actual: match?.intentId }];
    });

    expect(cases).toHaveLength(10_000);
    expect(uniqueQuestions.size).toBeGreaterThan(9_000);
    expect(mismatches).toEqual([]);
  });
});
