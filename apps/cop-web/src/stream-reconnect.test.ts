import { describe, expect, it } from "vitest";
import { appendBoundedStreamMessage, streamReconnectDelayMs } from "./stream-reconnect";

describe("stream reconnect policy", () => {
  it("uses bounded exponential delay with jitter", () => {
    expect(streamReconnectDelayMs(0, () => 0)).toBe(975);
    expect(streamReconnectDelayMs(3, () => 1)).toBe(12_000);
    expect(streamReconnectDelayMs(99, () => 1)).toBe(30_000);
  });

  it("drops the oldest messages before a browser queue can grow without limit", () => {
    const messages = [1, 2, 3];
    expect(appendBoundedStreamMessage(messages, 4, 3)).toBe(1);
    expect(messages).toEqual([2, 3, 4]);
  });
});
