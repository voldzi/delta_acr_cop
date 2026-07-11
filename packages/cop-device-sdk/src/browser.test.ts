import { describe, expect, it } from "vitest";
import { BrowserCopDeviceAdapter } from "./browser";
import { CopDeviceError } from "./error";

describe("BrowserCopDeviceAdapter", () => {
  it("reports capabilities from available browser APIs without a permission prompt", async () => {
    const adapter = new BrowserCopDeviceAdapter({
      geolocation: fakeGeolocation(),
      online: () => false,
      now: () => new Date("2026-07-11T10:00:00.000Z"),
      randomUUID: () => "40000000-0000-4000-8000-000000000001"
    });

    const snapshot = await adapter.system.getCapabilities();
    expect(snapshot.adapter).toBe("browser");
    expect(snapshot.capabilities.location.availability).toBe("supported");
    expect(snapshot.capabilities.tracking.availability).toBe("unsupported");
    await expect(adapter.connectivity.getState()).resolves.toMatchObject({ status: "offline" });
  });

  it("maps browser location and rejects native-only operations explicitly", async () => {
    const adapter = new BrowserCopDeviceAdapter({
      geolocation: fakeGeolocation(),
      now: () => new Date("2026-07-11T10:00:00.000Z"),
      randomUUID: () => "40000000-0000-4000-8000-000000000001"
    });

    await expect(adapter.location.getCurrent()).resolves.toMatchObject({
      latitude: 50.0755,
      longitude: 14.4378,
      valid: true
    });
    await expect(adapter.tracking.startSession()).rejects.toMatchObject<CopDeviceError>({ code: "UNSUPPORTED" });
  });
});

function fakeGeolocation(): Geolocation {
  const position = {
    coords: {
      accuracy: 4,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      latitude: 50.0755,
      longitude: 14.4378,
      speed: null,
      toJSON: () => ({})
    },
    timestamp: Date.parse("2026-07-11T10:00:00.000Z"),
    toJSON: () => ({})
  } satisfies GeolocationPosition;
  return {
    getCurrentPosition: (success) => success(position),
    watchPosition: (success) => {
      success(position);
      return 1;
    },
    clearWatch: () => undefined
  };
}
