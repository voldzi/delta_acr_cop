import { describe, expect, it } from "vitest";
import { buildAiRetrievalQuery, inferAiRetrievalIntent, isRoutineCivilAirText } from "./ai-retrieval-intent.js";

describe("AI retrieval intent", () => {
  it("treats a situational awareness question as general safety and suppresses routine civil air", () => {
    const intent = inferAiRetrievalIntent("Jaká je situace ve Vrbně pod Pradědem? Vytvoř mi situational awareness.");

    expect(intent).toMatchObject({
      airRelevant: false,
      primary: "general-safety",
      suppressRoutineCivilAir: true
    });
    expect(intent.categories).toEqual(["general-safety"]);
    expect(intent.queryExpansion).toContain("povodeň voda hladina řeky");
    expect(intent.queryExpansion).toContain("požár kouř");
    expect(intent.queryExpansion).not.toContain("letadla");
  });

  it("detects water, fire and police/security terms as safety-critical categories", () => {
    const intent = inferAiRetrievalIntent("Stav vody v řece, požár u lesa a policie chytá zloděje v oblasti.");

    expect(intent.categories).toEqual(expect.arrayContaining([
      "flood-water",
      "fire",
      "security-police"
    ]));
    expect(intent.suppressRoutineCivilAir).toBe(true);
  });

  it("keeps air tracks available for explicit air situation questions", () => {
    const intent = inferAiRetrievalIntent("Jaká je letecká situace a pohyb letadel?");

    expect(intent).toMatchObject({
      airRelevant: true,
      primary: "air",
      suppressRoutineCivilAir: false
    });
    expect(buildAiRetrievalQuery("letecká situace", intent)).toContain("air situation is explicitly relevant");
  });

  it("recognizes routine civil air text but not air-related safety incidents", () => {
    expect(isRoutineCivilAirText("Civilní let se starším trackem, stale track, public flight aggregate.")).toBe(true);
    expect(isRoutineCivilAirText("Letecký incident s výstrahou a evakuací.")).toBe(false);
  });
});
