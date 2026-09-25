import { describe, expect, it } from "vitest";
import { publicFloodDemoFeatures, publicFloodDemoScenarioId } from "./public-flood-demo-data";

describe("public flood demo projection", () => {
  it("keeps the public walkthrough separate from the operator seed and live sources", () => {
    expect(publicFloodDemoFeatures(0)).toEqual([]);
    const situation = publicFloodDemoFeatures(1);
    const approved = publicFloodDemoFeatures(2);
    const outage = publicFloodDemoFeatures(4);

    expect(situation).toHaveLength(4);
    expect(approved).toHaveLength(5);
    expect(outage).toHaveLength(5);
    expect(situation.some((feature) => feature.geometry.type === "Polygon")).toBe(true);
    expect(approved.some((feature) => feature.properties.featureId === "public-demo:municipal-notice")).toBe(true);
    for (const feature of outage) {
      expect(feature.properties.featureId).toMatch(/^public-demo:/u);
      expect(feature.properties.sourceId).toBe("demo-browser-only");
      expect(feature.properties.tags?.demoScenarioId).toBe(publicFloodDemoScenarioId);
      expect(feature.properties.stale).toBe(true);
    }
  });
});
