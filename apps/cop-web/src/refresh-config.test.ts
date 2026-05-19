import { describe, expect, it } from "vitest";
import { normalizeRefreshSeconds, parseRefreshSeconds, refreshMillisecondsToSeconds } from "./refresh-config";

describe("refresh config helpers", () => {
  it("normalizes arbitrary values to the nearest supported refresh cadence", () => {
    expect(normalizeRefreshSeconds("1")).toBe(1);
    expect(normalizeRefreshSeconds(3)).toBe(2);
    expect(normalizeRefreshSeconds(7)).toBe(5);
    expect(normalizeRefreshSeconds("bad", 10)).toBe(10);
  });

  it("parses refresh query parameters in seconds or milliseconds", () => {
    expect(parseRefreshSeconds("?refresh=2")).toBe(2);
    expect(parseRefreshSeconds("?refreshSeconds=10")).toBe(10);
    expect(parseRefreshSeconds("?refreshMs=1000")).toBe(1);
    expect(parseRefreshSeconds("?refreshMs=15000")).toBe(10);
  });

  it("uses environment style millisecond values as defaults", () => {
    expect(refreshMillisecondsToSeconds("5000")).toBe(5);
    expect(refreshMillisecondsToSeconds(1000)).toBe(1);
    expect(refreshMillisecondsToSeconds("invalid", 30)).toBe(30);
  });
});
