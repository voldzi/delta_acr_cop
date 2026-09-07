// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { readWatchedSafetyLocation, writeWatchedSafetyLocation } from "./watched-safety-location";

describe("watched public safety location", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists an explicit place independently for each account scope", () => {
    writeWatchedSafetyLocation({ label: "Tábor", lat: 49.4144, lon: 14.6578, source: "place" }, "alice");
    expect(readWatchedSafetyLocation("alice")?.label).toBe("Tábor");
    expect(readWatchedSafetyLocation("bob")).toBeNull();
  });

  it("rejects invalid stored coordinates", () => {
    window.localStorage.setItem(
      "cop.public-safety.location.v1",
      '{"label":"Chyba","lat":500,"lon":15,"source":"place"}'
    );
    expect(readWatchedSafetyLocation()).toBeNull();
  });

  it("returns to device location mode when the stored place is cleared", () => {
    writeWatchedSafetyLocation({ label: "Brno", lat: 49.1951, lon: 16.6068, source: "place" });
    writeWatchedSafetyLocation(null);
    expect(readWatchedSafetyLocation()).toBeNull();
  });
});
