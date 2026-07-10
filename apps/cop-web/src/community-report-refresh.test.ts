import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const mainPath = fileURLToPath(new URL("./main.tsx", import.meta.url));
const mainSource = readFileSync(mainPath, "utf8");

describe("COP community report refresh", () => {
  it("reloads the community map provider after an explicit report refresh", () => {
    const communityLoadIndex = mainSource.indexOf('setCommunityStatus("zoom")');
    const providerIndex = mainSource.indexOf('"cop.community",', communityLoadIndex);
    const effectStart = mainSource.lastIndexOf("React.useEffect(() => {", providerIndex);
    const dependencyEnd = mainSource.indexOf("\n  ]);", providerIndex);
    const communityEffect = mainSource.slice(effectStart, dependencyEnd);

    expect(communityLoadIndex).toBeGreaterThan(0);
    expect(providerIndex).toBeGreaterThan(communityLoadIndex);
    expect(effectStart).toBeGreaterThan(0);
    expect(dependencyEnd).toBeGreaterThan(providerIndex);
    expect(communityEffect).toContain("communityRefreshNonce");
  });

  it("focuses the map on the newly submitted report location", () => {
    const submitIndex = mainSource.indexOf("const submitted = await submitCommunityReport");
    const focusIndex = mainSource.indexOf("center: [submitted.location.lon, submitted.location.lat]", submitIndex);

    expect(submitIndex).toBeGreaterThan(0);
    expect(focusIndex).toBeGreaterThan(submitIndex);
  });
});
