import type { AiCopQuery, AiCopResponse } from "@cop/ai-gateway";
import { describe, expect, it } from "vitest";

import {
  aiGroundedPlaybookResponse,
  aiProviderResponseNeedsUserFacingFallback,
  shouldAnswerAiPlaybookDeterministically
} from "./ai-grounded-response.js";

describe("grounded AI responses", () => {
  it("answers capability questions locally without a provider", () => {
    const request = aiRequest("cop.capabilities.help");

    expect(shouldAnswerAiPlaybookDeterministically(request)).toBe(true);
    const response = aiGroundedPlaybookResponse(request, new Date("2026-07-15T19:30:00Z"), "test");

    expect(response).toMatchObject({ model: "grounded-playbook-v1", provider: "local", status: "COMPLETED" });
    expect(response.result.summary).toContain("COP AI umí shrnout aktuální situaci");
    expect(response.result.summary).toContain("Nevykonává nevratné akce bez potvrzení");
  });

  it("returns deterministic emergency guidance and does not claim dispatch", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("emergency.immediate.help"),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("volejte ihned 112");
    expect(response.result.summary).toContain("155");
    expect(response.result.summary).toContain("neumí potvrdit, že už byla pomoc vyslána");
  });

  it("summarizes only supplied situation evidence", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("situation.summary", {
        alerts: [{ severity: "HIGH", status: "ACTIVE", title: "Výstraha před povodní" }],
        communityReports: [{ severity: "MEDIUM", status: "PUBLISHED", title: "Zaplavená komunikace" }],
        incidents: [{ severity: "CRITICAL", status: "MONITORING", title: "Poškozený most" }]
      }),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("1 výstrah, 1 incidentů a 1 komunitních hlášení");
    expect(response.result.summary).toContain("Výstraha před povodní");
    expect(response.result.summary).toContain("Poškozený most");
    expect(response.result.summary).toContain("nemusí pokrývat všechny zdroje");
  });

  it("reports source-health limitations in user-facing language", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("source.health", {
        sourceHealth: [
          { displayName: "Hydrologie", health: "ONLINE" },
          { displayName: "Dopravní události", health: "DEGRADED" }
        ]
      }),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("1 z 2 dostupných zdrojů");
    expect(response.result.summary).toContain("Dopravní události");
    expect(response.result.summary).not.toContain("sourceSystemId");
  });

  it("does not invent invisible chat history", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("chat.conversation.summary"),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("není dostupný žádný viditelný dešifrovaný výňatek");
    expect(response.result.summary).toContain("nedoplňuje neviděnou ani nečitelnou historii");
  });

  it("explains delivery state without encouraging duplicate sends", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("chat.delivery.status"),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(shouldAnswerAiPlaybookDeterministically(aiRequest("chat.delivery.status"))).toBe(true);
    expect(response.result.summary).toContain("Stejnou zprávu neposílejte ručně znovu");
    expect(response.result.summary).toContain("sloučit lokální a serverovou kopii");
  });

  it("keeps E2EE recovery guidance inside native COP Mobile", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("chat.encryption.recovery"),
      new Date("2026-07-15T19:30:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("pouze v nativním COP Mobile");
    expect(response.result.summary).toContain("nesmí se odesílat do chatu");
    expect(response.result.summary).not.toContain("webovém chatu");
  });

  it("rejects completed provider summaries that expose technical identifiers", () => {
    const response: AiCopResponse = {
      auditId: "audit-technical",
      model: "provider-model",
      policy: { allowed: true, reason: "test", redactionsApplied: false },
      provider: "local",
      requestId: "request-technical",
      result: { summary: "Meteo informace: ČHMÚ radar MAX_Z ze zdroje chmi_weather_radar." },
      status: "COMPLETED"
    };

    expect(aiProviderResponseNeedsUserFacingFallback(response)).toBe(true);
    expect(aiProviderResponseNeedsUserFacingFallback({
      ...response,
      result: { summary: "V okolí je nyní 15 °C a bez významných srážek. Zdroj: COP/SIM." }
    })).toBe(false);
  });

  it("uses a weather-specific no-data answer without unrelated emergency advice", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("weather.summary.forecast"),
      new Date("2026-07-16T08:15:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("nemám v COP/SIM dostupnou ověřenou meteorologickou předpověď");
    expect(response.result.summary).toContain("zítra odpoledne");
    expect(response.result.summary).not.toContain("112");
  });

  it("keeps emergency numbers out of a generic harmless no-data fallback", () => {
    const response = aiGroundedPlaybookResponse(
      aiRequest("unclassified"),
      new Date("2026-07-16T08:15:00Z"),
      "test"
    );

    expect(response.result.summary).toContain("Upřesněte prosím místo");
    expect(response.result.summary).not.toContain("112");
  });
});

function aiRequest(intentId: string, context: Record<string, unknown> = {}): AiCopQuery {
  return {
    context: {
      ...context,
      responsePlaybook: { intentId }
    },
    outputFormat: "MARKDOWN",
    prompt: "test",
    providerPreference: "auto",
    purpose: "COP_EXPLANATION",
    requestId: `request-${intentId}`,
    safetyScope: "COP_DATA_ASSISTANCE_ONLY"
  };
}
