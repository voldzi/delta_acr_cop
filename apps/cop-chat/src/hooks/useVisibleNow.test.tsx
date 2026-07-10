// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useVisibleNow } from "./useVisibleNow";

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
});

describe("useVisibleNow", () => {
  it("pauses clock updates while the chat document is hidden and resumes immediately", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T00:00:00.000Z"));
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const { result } = renderHook(() => useVisibleNow(true, 1_000));

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current).toBe(Date.parse("2026-07-11T00:00:01.000Z"));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(result.current).toBe(Date.parse("2026-07-11T00:00:01.000Z"));

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(result.current).toBe(Date.parse("2026-07-11T00:00:06.000Z"));
  });
});
