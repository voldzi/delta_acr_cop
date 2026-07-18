import { describe, expect, it } from "vitest";
import { isPendingMapFocusRequest, shouldMaintainUserLocationWatch } from "./map-location-policy";

describe("map location policy", () => {
  it("keeps a GPS watch only for an explicitly enabled consumer", () => {
    expect(
      shouldMaintainUserLocationWatch({
        followEnabled: false,
        navigationActive: false,
        proximityAlertEnabled: false
      })
    ).toBe(false);
    expect(
      shouldMaintainUserLocationWatch({
        followEnabled: true,
        navigationActive: false,
        proximityAlertEnabled: false
      })
    ).toBe(true);
    expect(
      shouldMaintainUserLocationWatch({
        followEnabled: false,
        navigationActive: false,
        proximityAlertEnabled: true
      })
    ).toBe(true);
  });

  it("leaves location updates to active navigation", () => {
    expect(
      shouldMaintainUserLocationWatch({
        followEnabled: true,
        navigationActive: true,
        proximityAlertEnabled: true
      })
    ).toBe(false);
  });

  it("handles every camera focus request exactly once", () => {
    expect(isPendingMapFocusRequest(0, 0)).toBe(false);
    expect(isPendingMapFocusRequest(1, 0)).toBe(true);
    expect(isPendingMapFocusRequest(1, 1)).toBe(false);
    expect(isPendingMapFocusRequest(2, 1)).toBe(true);
  });
});
