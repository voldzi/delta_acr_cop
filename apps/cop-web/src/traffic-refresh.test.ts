import { describe, expect, it } from "vitest";
import { resolveTrafficRefreshSeconds } from "./traffic-refresh";

describe("resolveTrafficRefreshSeconds", () => {
  it("uses the PID cadence published by the SIM catalog before vehicles load", () => {
    expect(
      resolveTrafficRefreshSeconds({
        catalogRefreshSeconds: 15,
        featureRefreshSeconds: [],
        layerId: "public.traffic.transit.pid"
      })
    ).toBe(15);
  });

  it("uses the most specific cadence published on individual PID vehicles", () => {
    expect(
      resolveTrafficRefreshSeconds({
        catalogRefreshSeconds: 30,
        featureRefreshSeconds: [15, 20],
        layerId: "public.traffic.transit.pid"
      })
    ).toBe(15);
  });

  it("ignores invalid element cadences and falls back to the catalog", () => {
    expect(
      resolveTrafficRefreshSeconds({
        catalogRefreshSeconds: 15,
        featureRefreshSeconds: [0, Number.NaN, -1],
        layerId: "public.traffic.transit.pid"
      })
    ).toBe(15);
  });

  it("keeps protective lower bounds for static stops and trains", () => {
    expect(
      resolveTrafficRefreshSeconds({
        catalogRefreshSeconds: 15,
        featureRefreshSeconds: [],
        layerId: "public.traffic.transit_stops"
      })
    ).toBe(300);
    expect(
      resolveTrafficRefreshSeconds({
        catalogRefreshSeconds: 15,
        featureRefreshSeconds: [],
        layerId: "public.traffic.transit.trains"
      })
    ).toBe(60);
  });
});
