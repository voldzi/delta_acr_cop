import { describe, expect, it } from "vitest";

import { inferAiQueryMeaning, normalizeAiQueryText } from "./ai-query-understanding.js";

describe("AI query understanding", () => {
  it.each([
    ["Jak bude dneska?", "weather.summary.forecast", "Jaké bude počasí dnes?"],
    ["Jak bude zejtra večer?", "weather.summary.forecast", "Jaké bude počasí zitra vecer?"],
    ["Jak to vypadá kolem mě?", "situation.summary", "Jaká je aktuální civilní situace?"],
    ["Hrozí něco?", "alerts.active", "Jaké jsou aktivní výstrahy"],
    ["Fungujou data?", "source.health", "Jsou datové zdroje COP/SIM"],
    ["Jak je na tom voda?", "flood.risk.summary", "Jaká je aktuální vodní"],
    ["Dá se tudy projet?", "traffic.restrictions", "Jaká jsou aktuální dopravní"],
    ["Kde hoří?", "fire.current.risk", "Kde jsou aktuálně hlášené požáry"],
    ["Jde tady proud?", "infrastructure.outage", "Jsou hlášené výpadky"],
    ["Co hlásí lidi?", "community.reports.summary", "Jaká jsou aktuální komunitní"]
  ])("canonicalizes %s as %s", (question, intentId, canonicalPrefix) => {
    expect(inferAiQueryMeaning(question)).toMatchObject({
      canonicalQuestion: expect.stringContaining(canonicalPrefix),
      confidence: expect.any(Number),
      intentId
    });
  });

  it("normalizes conversational Czech time expressions without changing their meaning", () => {
    expect(normalizeAiQueryText("Teďka, dneska nebo zítřejší večer?")).toBe("ted, dnes nebo zitra vecer?");
  });

  it.each(["Jak se dostanu do Brna?", "Co znamená ten symbol?", "Můžeš mi pomoci?"])(
    "does not force an unrelated domain for ambiguous query %s",
    (question) => {
      expect(inferAiQueryMeaning(question)).toBeUndefined();
    }
  );
});
