// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCurrentUserLocation } from "./user-location";

const original = navigator.geolocation;
const position = {
  coords: { latitude: 50, longitude: 15, accuracy: 30, heading: null, speed: null }
} as GeolocationPosition;
function install(value: Partial<Geolocation>) {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value });
}
afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: original });
  vi.useRealTimers();
});
describe("explicit device location", () => {
  it("returns a valid position without starting a watch", async () => {
    const watchPosition = vi.fn();
    install({ getCurrentPosition: (success) => success(position), watchPosition });
    expect(await readCurrentUserLocation()).toMatchObject({ lat: 50, lon: 15, accuracyM: 30 });
    expect(watchPosition).not.toHaveBeenCalled();
  });
  it("explains denied permission without retrying", async () => {
    const watchPosition = vi.fn();
    install({ getCurrentPosition: (_, error) => error?.({ code: 1 } as GeolocationPositionError), watchPosition });
    await expect(readCurrentUserLocation()).rejects.toThrow("Přístup k poloze je zakázaný");
    expect(watchPosition).not.toHaveBeenCalled();
  });
  it("retries unavailable GPS with a coarse-capable watch and clears a synchronous watch", async () => {
    const clearWatch = vi.fn();
    const watchPosition = vi.fn(
      (success: PositionCallback, _error?: PositionErrorCallback | null, _options?: PositionOptions) => {
        success(position);
        return 17;
      }
    );
    install({
      getCurrentPosition: (_, error) => error?.({ code: 2 } as GeolocationPositionError),
      watchPosition,
      clearWatch
    });
    expect(await readCurrentUserLocation()).toMatchObject({ lat: 50, lon: 15 });
    expect(watchPosition.mock.calls[0]?.[2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 0 });
    expect(clearWatch).toHaveBeenCalledWith(17);
  });
  it("bounds silent browsers, clears the watch and ignores a late position", async () => {
    vi.useFakeTimers();
    let late: PositionCallback | undefined;
    const clearWatch = vi.fn();
    install({
      getCurrentPosition: () => {},
      watchPosition: (success) => {
        late = success;
        return 21;
      },
      clearWatch
    });
    const result = readCurrentUserLocation();
    const rejection = expect(result).rejects.toThrow("časovém limitu");
    await vi.advanceTimersByTimeAsync(24_000);
    await rejection;
    expect(clearWatch).toHaveBeenCalledWith(21);
    late?.(position);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("does not use invalid coordinates from either provider", async () => {
    const invalid = { ...position, coords: { ...position.coords, latitude: NaN } };
    install({ getCurrentPosition: (success) => success(invalid) });
    await expect(readCurrentUserLocation()).rejects.toThrow("platné souřadnice");
  });
});
