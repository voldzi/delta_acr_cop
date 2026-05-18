import { describe, expect, it } from "vitest";
import { resolveSymbol } from "../src/index.js";

describe("resolveSymbol", () => {
  it("resolves friendly aircraft with exact mapping", () => {
    const result = resolveSymbol("AIRCRAFT", "FRIEND", "AIR", "ACTIVE", {
      synthetic: true,
      confidence: 0.95
    });

    expect(result).toMatchObject({
      symbolSet: "APP6",
      symbolCode: "APP6-AIR-FRIEND-AIRCRAFT-ACTIVE",
      fallback: false
    });
    expect(result.modifiers).toMatchObject({
      affiliation: "FRIEND",
      domain: "AIR",
      status: "ACTIVE",
      synthetic: true
    });
  });

  it("uses domain fallback for air missile track", () => {
    const result = resolveSymbol("MISSILE_TRACK", "UNKNOWN", "AIR", "CONFLICTED");

    expect(result.symbolCode).toBe("APP6-AIR-TRACK-GENERIC");
    expect(result.fallback).toBe(false);
  });

  it("resolves hostile air objects with explicit mapping", () => {
    const aircraft = resolveSymbol("AIRCRAFT", "HOSTILE", "AIR", "ACTIVE");
    const uav = resolveSymbol("UAV", "HOSTILE", "AIR", "ACTIVE");

    expect(aircraft).toMatchObject({
      symbolCode: "APP6-AIR-HOSTILE-AIRCRAFT-ACTIVE",
      fallback: false
    });
    expect(uav).toMatchObject({
      symbolCode: "APP6-AIR-HOSTILE-UAV-ACTIVE",
      fallback: false
    });
  });

  it("uses local extension for unknown object", () => {
    const result = resolveSymbol("UNKNOWN", "UNKNOWN", "OTHER", "STALE");

    expect(result.symbolCode).toBe("LOCAL-COP-UNKNOWN-OBJECT");
    expect(result.fallback).toBe(true);
    expect(result.extension?.catalog).toBe("local-extension");
  });
});
