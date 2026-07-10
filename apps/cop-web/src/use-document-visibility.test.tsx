// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useDocumentVisible } from "./use-document-visibility";

const initialVisibilityState = document.visibilityState;

afterEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: initialVisibilityState
  });
});

describe("useDocumentVisible", () => {
  it("tracks hidden and visible lifecycle transitions", () => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const { result, unmount } = renderHook(() => useDocumentVisible());
    expect(result.current).toBe(true);

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);

    act(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(true);
    unmount();
  });
});
